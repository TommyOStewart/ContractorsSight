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
  changeSetId: string;
  captureId: string;
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
    const siteId = args.siteAddress ? ((await createSite(ctx, args.clientId, args.siteAddress)).id as string) : args.siteId;
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

  async record_purchase(args, ctx) {
    for (const line of args.lines) {
      const material = await insertOne(ctx, "material_items", {
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

    // Receipt details with no column of their own are kept as a note on the job.
    const details = [
      args.vendorName && `from ${args.vendorName}`,
      args.purchasedOn && `on ${args.purchasedOn}`,
      args.totalDollars !== undefined && `total $${args.totalDollars.toFixed(2)}`,
    ].filter(Boolean);
    if (details.length) {
      const note = await insertOne(ctx, "notes", {
        orgId: ctx.orgId,
        jobId: args.jobId,
        body: `Purchase recorded ${details.join(", ")} (${args.lines.length} item${args.lines.length === 1 ? "" : "s"}).`,
        authorId: ctx.actorUserId,
      });
      await audit(ctx, { entityType: "note", entityId: note.id as string, action: "create", after: note });
    }
  },
};

/** Applies already-validated, temp-ID-resolved operations in order. Throws (rolling back) on any DB error. */
export async function applyOperations(operations: StagedOperation[], ctx: ApplyContext): Promise<void> {
  for (const op of operations) {
    await (APPLIERS[op.tool] as (args: unknown, ctx: ApplyContext) => Promise<void>)(op.args, ctx);
  }
}
