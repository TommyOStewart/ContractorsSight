import {
  dollarsToCents,
  type AuditSource,
  type StagedOperation,
  type StagedToolName,
  type ToolArgs,
} from "@contractorsight/shared";
import type postgres from "postgres";

type Tx = postgres.TransactionSql<Record<string, never>>;
type Row = Record<string, unknown>;

export interface ApplyContext {
  tx: Tx;
  orgId: string;
  actorUserId: string;
  source: AuditSource;
  /** Both null for a manual edit made directly in the app. */
  changeSetId: string | null;
  captureId: string | null;
}

/** postgres.js rejects `undefined`; optional tool args that weren't given are simply left out. */
function defined<T extends Row>(row: T): Partial<T> {
  return Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined)) as Partial<T>;
}

async function insertOne(ctx: ApplyContext, table: string, row: Row): Promise<Row> {
  const [inserted] = await ctx.tx`insert into ${ctx.tx(table)} ${ctx.tx(defined(row))} returning *`;
  return inserted!;
}

async function selectForUpdate(ctx: ApplyContext, table: string, id: string): Promise<Row> {
  const [row] = await ctx.tx`select * from ${ctx.tx(table)} where id = ${id} and org_id = ${ctx.orgId} for update`;
  if (!row) throw new Error(`${table} ${id} not found in org`); // validation makes this unreachable
  return row;
}

async function updateOne(ctx: ApplyContext, table: string, id: string, changes: Row): Promise<{ before: Row; after: Row }> {
  const before = await selectForUpdate(ctx, table, id);
  const [after] = await ctx.tx`update ${ctx.tx(table)} set ${ctx.tx(defined(changes))} where id = ${id} returning *`;
  return { before, after: after! };
}

async function audit(
  ctx: ApplyContext,
  event: { entityType: string; entityId: string; action: "create" | "update" | "delete" | "status_change"; before?: unknown; after?: unknown },
) {
  await ctx.tx`
    insert into audit_events ${ctx.tx({
      orgId: ctx.orgId,
      actorUserId: ctx.actorUserId,
      source: ctx.source,
      entityType: event.entityType,
      entityId: event.entityId,
      action: event.action,
      before: event.before === undefined ? null : ctx.tx.json(event.before as postgres.JSONValue),
      after: event.after === undefined ? null : ctx.tx.json(event.after as postgres.JSONValue),
      changeSetId: ctx.changeSetId,
      captureId: ctx.captureId,
    })}`;
}

const cents = (dollars: number | undefined) => (dollars === undefined ? undefined : dollarsToCents(dollars));

async function createSite(ctx: ApplyContext, clientId: string, address: NonNullable<ToolArgs<"create_client">["siteAddress"]>) {
  const site = await insertOne(ctx, "sites", { orgId: ctx.orgId, clientId, ...address });
  await audit(ctx, { entityType: "site", entityId: site.id as string, action: "create", after: site });
  return site;
}

type Applier<N extends StagedToolName> = (args: ToolArgs<N>, ctx: ApplyContext) => Promise<void>;

/**
 * How each staged tool writes to the database. Runs inside the approve transaction, after
 * validation and temp-ID resolution, so every ID here is a real UUID in the caller's org.
 * A complete record: adding a tool without deciding how it commits is a compile error.
 */
const APPLIERS: { [N in StagedToolName]: Applier<N> } = {
  async create_client(args, ctx) {
    const client = await insertOne(ctx, "clients", {
      id: args.tempId,
      orgId: ctx.orgId,
      name: args.name,
      phone: args.phone,
      email: args.email,
      notes: args.notes,
      createdBy: ctx.actorUserId,
    });
    await audit(ctx, { entityType: "client", entityId: client.id as string, action: "create", after: client });
    if (args.siteAddress) await createSite(ctx, client.id as string, args.siteAddress);
  },

  async create_job(args, ctx) {
    let siteId = args.siteAddress ? ((await createSite(ctx, args.clientId, args.siteAddress)).id as string) : args.siteId;
    if (!siteId) {
      // No site given: use the client's site if it has exactly one (e.g. created with the client just now).
      const sites = await ctx.tx<{ id: string }[]>`select id from sites where client_id = ${args.clientId} and org_id = ${ctx.orgId} limit 2`;
      if (sites.length === 1) siteId = sites[0]!.id;
    }
    const job = await insertOne(ctx, "jobs", {
      id: args.tempId,
      orgId: ctx.orgId,
      clientId: args.clientId,
      siteId,
      title: args.title,
      jobType: args.jobType,
      description: args.description,
      createdBy: ctx.actorUserId,
    });
    await audit(ctx, { entityType: "job", entityId: job.id as string, action: "create", after: job });
  },

  async add_material(args, ctx) {
    const material = await insertOne(ctx, "material_items", {
      id: args.tempId,
      orgId: ctx.orgId,
      jobId: args.jobId,
      description: args.description,
      quantity: args.quantity,
      unit: args.unit,
      unitCostCents: cents(args.unitCostDollars),
      supplyHouseId: args.supplyHouseId,
      status: args.status,
    });
    await audit(ctx, { entityType: "material", entityId: material.id as string, action: "create", after: material });
  },

  async add_note(args, ctx) {
    const note = await insertOne(ctx, "notes", {
      orgId: ctx.orgId,
      jobId: args.jobId,
      clientId: args.clientId,
      body: args.body,
      authorId: ctx.actorUserId,
    });
    await audit(ctx, { entityType: "note", entityId: note.id as string, action: "create", after: note });
  },

  async update_job_fields(args, ctx) {
    const { before, after } = await updateOne(ctx, "jobs", args.jobId, { ...args.changes });
    await audit(ctx, { entityType: "job", entityId: args.jobId, action: "update", before, after });
  },

  async update_client(args, ctx) {
    const { before, after } = await updateOne(ctx, "clients", args.clientId, { ...args.changes });
    await audit(ctx, { entityType: "client", entityId: args.clientId, action: "update", before, after });
  },

  async update_site(args, ctx) {
    const { before, after } = await updateOne(ctx, "sites", args.siteId, { ...args.changes });
    await audit(ctx, { entityType: "site", entityId: args.siteId, action: "update", before, after });
  },

  async revise_quote(args, ctx) {
    const [previous] = await ctx.tx<{ id: string; version: number; status: string }[]>`
      select id, version, status from quotes where job_id = ${args.jobId} order by version desc limit 1 for update`;

    const lines = args.lineItems.map((line, position) =>
      line.kind === "labor"
        ? { position, kind: line.kind, description: line.description, quantity: line.hours, unit: "hr", unitPriceCents: dollarsToCents(line.hourlyRateDollars), materialItemId: null }
        : { position, kind: line.kind, description: line.description, quantity: line.quantity, unit: line.unit ?? null, unitPriceCents: dollarsToCents(line.unitPriceDollars), materialItemId: line.materialId ?? null },
    );
    const totalCents = lines.reduce((sum, l) => sum + Math.round(l.quantity * l.unitPriceCents), 0);

    const quote = await insertOne(ctx, "quotes", {
      orgId: ctx.orgId,
      jobId: args.jobId,
      version: (previous?.version ?? 0) + 1,
      supersedesQuoteId: previous?.id,
      notes: args.notes,
      validUntil: args.validUntil,
      totalCents,
      createdBy: ctx.actorUserId,
    });
    const lineRows = await ctx.tx`
      insert into quote_line_items ${ctx.tx(lines.map((l) => ({ ...l, orgId: ctx.orgId, quoteId: quote.id as string })))} returning *`;
    await audit(ctx, { entityType: "quote", entityId: quote.id as string, action: "create", after: { ...quote, lineItems: lineRows } });

    if (previous && previous.status !== "rejected" && previous.status !== "superseded") {
      const { before, after } = await updateOne(ctx, "quotes", previous.id, { status: "superseded" });
      await audit(ctx, { entityType: "quote", entityId: previous.id, action: "status_change", before, after });
    }
  },

  async update_material(args, ctx) {
    const { unitCostDollars, ...rest } = args.changes;
    const { before, after } = await updateOne(ctx, "material_items", args.materialId, { ...rest, unitCostCents: cents(unitCostDollars) });
    await audit(ctx, { entityType: "material", entityId: args.materialId, action: "update", before, after });
  },

  async remove_material(args, ctx) {
    // Soft delete: quotes and orders may still reference it.
    const { before, after } = await updateOne(ctx, "material_items", args.materialId, {
      removedAt: new Date(),
      removedReason: args.reason,
    });
    await audit(ctx, { entityType: "material", entityId: args.materialId, action: "delete", before, after });
  },

  async request_status_change(args, ctx) {
    // The jobs trigger rejects illegal transitions even if validation were bypassed.
    const { before, after } = await updateOne(ctx, "jobs", args.jobId, { status: args.toStatus });
    await audit(ctx, { entityType: "job", entityId: args.jobId, action: "status_change", before, after: { ...after, reason: args.reason ?? null } });
  },

  async schedule_job(args, ctx) {
    const current = await selectForUpdate(ctx, "jobs", args.jobId);
    const { before, after } = await updateOne(ctx, "jobs", args.jobId, {
      scheduledStart: new Date(args.start),
      scheduledEnd: args.end ? new Date(args.end) : null,
      status: current.status === "accepted" ? "scheduled" : undefined,
    });
    const action = before.status === after.status ? "update" : "status_change";
    await audit(ctx, { entityType: "job", entityId: args.jobId, action, before, after });
  },

  async flag_ambiguity() {
    // A signal for the reviewer; approving the ChangeSet means they accepted the rest as-is.
  },

  async draft_supply_order(args, ctx) {
    const order = await insertOne(ctx, "supply_orders", {
      id: args.tempId,
      orgId: ctx.orgId,
      supplyHouseId: args.supplyHouseId,
      jobId: args.jobId,
      notes: args.notes,
      createdBy: ctx.actorUserId,
    });
    const lines = await ctx.tx`
      insert into order_lines ${ctx.tx(
        args.lines.map((line, position) => ({
          orgId: ctx.orgId,
          supplyOrderId: order.id as string,
          position,
          description: line.description,
          sku: line.sku ?? null,
          quantity: line.quantity,
          unit: line.unit ?? null,
          materialItemId: line.materialId ?? null,
        })),
      )} returning *`;
    await audit(ctx, { entityType: "supplyOrder", entityId: order.id as string, action: "create", after: { ...order, lines } });
  },

  async create_invoice(args, ctx) {
    let lines: { kind: string; description: string; quantity: number; unit: string | null; unitPriceCents: number }[];
    if (args.lineItems) {
      lines = args.lineItems.map((l) =>
        l.kind === "labor"
          ? { kind: "labor", description: l.description, quantity: l.hours, unit: "hr", unitPriceCents: dollarsToCents(l.hourlyRateDollars) }
          : { kind: "material", description: l.description, quantity: l.quantity, unit: l.unit ?? null, unitPriceCents: dollarsToCents(l.unitPriceDollars) },
      );
    } else {
      // Bill the latest quote as it stands.
      lines = await ctx.tx<{ kind: string; description: string; quantity: number; unit: string | null; unitPriceCents: number }[]>`
        select li.kind, li.description, li.quantity::float8 as quantity, li.unit, li.unit_price_cents::float8 as unit_price_cents
        from quote_line_items li
        where li.quote_id = (select id from quotes where job_id = ${args.jobId} order by version desc limit 1)
        order by li.position`;
      if (!lines.length) throw new Error("The job's latest quote has no lines to bill.");
    }
    const totalCents = lines.reduce((sum, l) => sum + Math.round(l.quantity * l.unitPriceCents), 0);
    const issuedOn = new Date().toISOString().slice(0, 10);
    const invoice = await insertOne(ctx, "invoices", {
      id: args.tempId,
      orgId: ctx.orgId,
      jobId: args.jobId,
      number: await nextInvoiceNumber(ctx),
      status: "sent",
      issuedOn,
      dueOn: args.dueInDays === undefined ? undefined : new Date(Date.now() + args.dueInDays * 86_400_000).toISOString().slice(0, 10),
      notes: args.notes,
      totalCents,
      createdBy: ctx.actorUserId,
    });
    const lineRows = await ctx.tx`
      insert into invoice_line_items ${ctx.tx(lines.map((l, position) => ({ ...l, position, orgId: ctx.orgId, invoiceId: invoice.id as string })))} returning *`;
    await audit(ctx, { entityType: "invoice", entityId: invoice.id as string, action: "create", after: { ...invoice, lineItems: lineRows } });

    const job = await selectForUpdate(ctx, "jobs", args.jobId);
    if (job.status === "completed") {
      const { before, after } = await updateOne(ctx, "jobs", args.jobId, { status: "invoiced" });
      await audit(ctx, { entityType: "job", entityId: args.jobId, action: "status_change", before, after });
    }
  },

  async record_payment(args, ctx) {
    const invoice = await selectForUpdate(ctx, "invoices", args.invoiceId);
    const payment = await insertOne(ctx, "payments", {
      orgId: ctx.orgId,
      invoiceId: args.invoiceId,
      amountCents: dollarsToCents(args.amountDollars),
      paidOn: args.paidOn,
      method: args.method,
      reference: args.reference,
      createdBy: ctx.actorUserId,
    });
    await audit(ctx, { entityType: "payment", entityId: payment.id as string, action: "create", after: payment });

    const [sum] = await ctx.tx<{ paid: string }[]>`select coalesce(sum(amount_cents), 0) as paid from payments where invoice_id = ${args.invoiceId}`;
    if (Number(sum!.paid) >= Number(invoice.totalCents) && invoice.status !== "paid") {
      const { before, after } = await updateOne(ctx, "invoices", args.invoiceId, { status: "paid" });
      await audit(ctx, { entityType: "invoice", entityId: args.invoiceId, action: "status_change", before, after });
      await closeJobIfFullyPaid(ctx, invoice.jobId as string);
    }
  },

  async record_expense(args, ctx) {
    const expense = await insertOne(ctx, "expenses", {
      orgId: ctx.orgId,
      spentOn: args.spentOn,
      category: args.category,
      totalCents: dollarsToCents(args.totalDollars),
      description: args.description,
      supplyHouseId: args.supplyHouseId,
      vendorName: args.vendorName,
      jobId: args.jobId,
      receiptAttachmentId: args.receiptAttachmentId,
      captureId: ctx.captureId,
      createdBy: ctx.actorUserId,
    });
    await audit(ctx, { entityType: "expense", entityId: expense.id as string, action: "create", after: expense });
  },

  async record_purchase(args, ctx) {
    const linesTotal = args.lines.reduce((sum, l) => sum + (l.unitCostDollars ?? 0) * l.quantity, 0);
    const expense = await insertOne(ctx, "expenses", {
      orgId: ctx.orgId,
      spentOn: args.purchasedOn,
      category: "materials",
      totalCents: dollarsToCents(args.totalDollars ?? linesTotal),
      description: args.lines.map((l) => l.description).join(", ").slice(0, 300),
      supplyHouseId: args.supplyHouseId,
      vendorName: args.vendorName,
      jobId: args.jobId,
      receiptAttachmentId: args.receiptAttachmentId,
      captureId: ctx.captureId,
      createdBy: ctx.actorUserId,
    });
    await audit(ctx, { entityType: "expense", entityId: expense.id as string, action: "create", after: expense });

    for (const line of args.lines) {
      const material = await insertOne(ctx, "material_items", {
        expenseId: expense.id,
        orgId: ctx.orgId,
        jobId: args.jobId,
        description: line.description,
        quantity: line.quantity,
        unit: line.unit,
        unitCostCents: cents(line.unitCostDollars),
        supplyHouseId: args.supplyHouseId,
        status: "purchased",
      });
      await audit(ctx, { entityType: "material", entityId: material.id as string, action: "create", after: material });
    }

    if (args.receiptAttachmentId) {
      const { before, after } = await updateOne(ctx, "attachments", args.receiptAttachmentId, { jobId: args.jobId });
      await audit(ctx, { entityType: "attachment", entityId: args.receiptAttachmentId, action: "update", before, after });
    }
  },
};

/** Next invoice number for the company (#1001 first). Serialized per org so two approvals can't collide. */
async function nextInvoiceNumber(ctx: ApplyContext): Promise<number> {
  await ctx.tx`select pg_advisory_xact_lock(hashtext('invoice-number:' || ${ctx.orgId}))`;
  const [row] = await ctx.tx<{ next: number }[]>`select coalesce(max(number), 1000) + 1 as next from invoices where org_id = ${ctx.orgId}`;
  return row!.next;
}

/** Once every non-void invoice on a job is paid, an invoiced job moves to paid. */
async function closeJobIfFullyPaid(ctx: ApplyContext, jobId: string) {
  const [open] = await ctx.tx<{ unpaid: number }[]>`
    select count(*)::int as unpaid from invoices where job_id = ${jobId} and status not in ('paid', 'void')`;
  if (open!.unpaid > 0) return;
  const job = await selectForUpdate(ctx, "jobs", jobId);
  if (job.status !== "invoiced") return;
  const { before, after } = await updateOne(ctx, "jobs", jobId, { status: "paid" });
  await audit(ctx, { entityType: "job", entityId: jobId, action: "status_change", before, after });
}

/** Applies already-validated, temp-ID-resolved operations in order. Throws (rolling back) on any DB error. */
export async function applyOperations(operations: StagedOperation[], ctx: ApplyContext): Promise<void> {
  for (const op of operations) {
    await (APPLIERS[op.tool] as (args: unknown, ctx: ApplyContext) => Promise<void>)(op.args, ctx);
  }
}
