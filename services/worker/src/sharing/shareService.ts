import { randomBytes } from "node:crypto";
import type { JobStatus } from "@contractorsight/shared";
import type postgres from "postgres";
import { ChangeSetError } from "../commit/changeSetService";
import { validateAndApply } from "../commit/manualEdits";
import type { Sql } from "../db/sql";

type Tx = postgres.TransactionSql<Record<string, never>>;

// A quote or invoice is shared as a link with a long random token. Anyone with the link can view
// that one document (and approve a quote); nothing else. Members can send the same link again.

const newToken = () => randomBytes(32).toString("base64url");

async function auditDocument(
  tx: Tx,
  event: { orgId: string; actorUserId: string | null; source: "manual" | "customer"; entityType: "quote" | "invoice"; entityId: string; before: unknown; after: unknown },
) {
  await tx`
    insert into audit_events ${tx({
      orgId: event.orgId,
      actorUserId: event.actorUserId,
      source: event.source,
      entityType: event.entityType,
      entityId: event.entityId,
      action: "update",
      before: tx.json(event.before as postgres.JSONValue),
      after: tx.json(event.after as postgres.JSONValue),
    })}`;
}

/**
 * Marks a quote as sent and returns its link token. A lead whose quote goes out moves to `quoted`.
 * Only the latest version can be sent; older ones are superseded.
 */
export async function shareQuote(sql: Sql, input: { userId: string; quoteId: string }): Promise<{ token: string }> {
  return sql.begin(async (tx) => {
    const [quote] = await tx<{ id: string; orgId: string; jobId: string; status: string; jobStatus: JobStatus; latest: boolean }[]>`
      select q.id, q.org_id, q.job_id, q.status, j.status as job_status,
             q.version = (select max(version) from quotes where job_id = q.job_id) as latest
      from quotes q join jobs j on j.id = q.job_id
      where q.id = ${input.quoteId}
        and exists (select 1 from org_members m where m.org_id = q.org_id and m.user_id = ${input.userId})
      for update of q`;
    if (!quote) throw new ChangeSetError(404, "Quote not found.");
    if (!quote.latest || quote.status === "superseded") throw new ChangeSetError(409, "There's a newer version of this quote. Send that one.");
    if (quote.status === "rejected") throw new ChangeSetError(409, "This quote was turned down.");

    if (quote.jobStatus === "lead") {
      const moved = await validateAndApply(tx, {
        orgId: quote.orgId,
        actorUserId: input.userId,
        source: "manual",
        operations: [{ tool: "request_status_change", args: { jobId: quote.jobId, toStatus: "quoted", reason: "Quote sent to the customer" } }],
      });
      if (!moved.ok) throw new ChangeSetError(409, moved.issues[0]?.message ?? "This job can't be marked quoted.");
    }

    const [before] = await tx`select * from quotes where id = ${quote.id}`;
    const [after] = await tx<{ shareToken: string }[]>`
      update quotes
      set share_token = coalesce(share_token, ${newToken()}),
          sent_at = coalesce(sent_at, now()),
          status = case when status = 'draft' then 'sent'::quote_status else status end
      where id = ${quote.id}
      returning *`;
    await auditDocument(tx, { orgId: quote.orgId, actorUserId: input.userId, source: "manual", entityType: "quote", entityId: quote.id, before, after });
    return { token: after!.shareToken };
  });
}

/** Marks an invoice as sent and returns its link token. */
export async function shareInvoice(sql: Sql, input: { userId: string; invoiceId: string }): Promise<{ token: string }> {
  return sql.begin(async (tx) => {
    const [before] = await tx<{ id: string; orgId: string; status: string }[]>`
      select * from invoices i
      where i.id = ${input.invoiceId}
        and exists (select 1 from org_members m where m.org_id = i.org_id and m.user_id = ${input.userId})
      for update`;
    if (!before) throw new ChangeSetError(404, "Invoice not found.");
    if (before.status === "void") throw new ChangeSetError(409, "This invoice was voided.");
    const [after] = await tx<{ shareToken: string }[]>`
      update invoices
      set share_token = coalesce(share_token, ${newToken()}),
          sent_at = coalesce(sent_at, now()),
          status = case when status = 'draft' then 'sent'::invoice_status else status end
      where id = ${before.id}
      returning *`;
    await auditDocument(tx, { orgId: before.orgId, actorUserId: input.userId, source: "manual", entityType: "invoice", entityId: before.id, before, after });
    return { token: after!.shareToken };
  });
}

export interface SharedLine {
  description: string;
  quantity: number;
  unit: string | null;
  unitPriceCents: number;
}

interface SharedCommon {
  company: string;
  client: string | null;
  jobTitle: string;
  address: string | null;
  lines: SharedLine[];
  totalCents: number;
  notes: string | null;
}

export type SharedDocument =
  | (SharedCommon & {
      kind: "quote";
      version: number;
      status: string;
      /** A newer version exists, so this one can't be approved. */
      superseded: boolean;
      validUntil: string | null;
      acceptedAt: Date | null;
      acceptedByName: string | null;
    })
  | (SharedCommon & { kind: "invoice"; number: number; status: string; issuedOn: string; dueOn: string | null; paidCents: number });

/** The document behind a link token, or null if there is none. */
export async function loadSharedDocument(sql: Sql, token: string): Promise<SharedDocument | null> {
  const [quote] = await sql<
    {
      id: string;
      version: number;
      status: string;
      notes: string | null;
      validUntil: string | null;
      totalCents: string;
      acceptedAt: Date | null;
      acceptedByName: string | null;
      superseded: boolean;
      company: string;
      client: string | null;
      jobTitle: string;
      line1: string | null;
      city: string | null;
    }[]
  >`
    select q.id, q.version, q.status, q.notes, q.valid_until::text, q.total_cents, q.accepted_at, q.accepted_by_name,
           exists (select 1 from quotes n where n.job_id = q.job_id and n.version > q.version) as superseded,
           o.name as company, c.name as client, j.title as job_title, s.line1, s.city
    from quotes q
    join jobs j on j.id = q.job_id
    join organizations o on o.id = q.org_id
    left join clients c on c.id = j.client_id
    left join sites s on s.id = j.site_id
    where q.share_token = ${token}`;
  if (quote) {
    const lines = await sql<SharedLine[]>`
      select description, quantity::float8 as quantity, unit, unit_price_cents::float8 as unit_price_cents
      from quote_line_items where quote_id = ${quote.id} order by position`;
    return {
      kind: "quote",
      company: quote.company,
      client: quote.client,
      jobTitle: quote.jobTitle,
      address: [quote.line1, quote.city].filter(Boolean).join(", ") || null,
      lines,
      totalCents: Number(quote.totalCents),
      notes: quote.notes,
      version: quote.version,
      status: quote.status,
      superseded: quote.superseded || quote.status === "superseded",
      validUntil: quote.validUntil,
      acceptedAt: quote.acceptedAt,
      acceptedByName: quote.acceptedByName,
    };
  }

  const [invoice] = await sql<
    {
      id: string;
      number: number;
      status: string;
      notes: string | null;
      issuedOn: string;
      dueOn: string | null;
      totalCents: string;
      paidCents: string;
      company: string;
      client: string | null;
      jobTitle: string;
      line1: string | null;
      city: string | null;
    }[]
  >`
    select i.id, i.number, i.status, i.notes, i.issued_on::text, i.due_on::text, i.total_cents,
           (select coalesce(sum(amount_cents), 0) from payments p where p.invoice_id = i.id) as paid_cents,
           o.name as company, c.name as client, j.title as job_title, s.line1, s.city
    from invoices i
    join jobs j on j.id = i.job_id
    join organizations o on o.id = i.org_id
    left join clients c on c.id = j.client_id
    left join sites s on s.id = j.site_id
    where i.share_token = ${token}`;
  if (!invoice) return null;
  const lines = await sql<SharedLine[]>`
    select description, quantity::float8 as quantity, unit, unit_price_cents::float8 as unit_price_cents
    from invoice_line_items where invoice_id = ${invoice.id} order by position`;
  return {
    kind: "invoice",
    company: invoice.company,
    client: invoice.client,
    jobTitle: invoice.jobTitle,
    address: [invoice.line1, invoice.city].filter(Boolean).join(", ") || null,
    lines,
    totalCents: Number(invoice.totalCents),
    notes: invoice.notes,
    number: invoice.number,
    status: invoice.status,
    issuedOn: invoice.issuedOn,
    dueOn: invoice.dueOn,
    paidCents: Number(invoice.paidCents),
  };
}

/**
 * The customer approved a quote on its page. Moves the job to `accepted` through the same
 * validation as any other change (audited as `customer`, no signed-in user) and records who
 * approved it. Approving twice is harmless.
 */
export async function approveSharedQuote(sql: Sql, input: { token: string; name: string }): Promise<void> {
  await sql.begin(async (tx) => {
    const [quote] = await tx<{ id: string; orgId: string; jobId: string; status: string; jobStatus: JobStatus; latest: boolean }[]>`
      select q.id, q.org_id, q.job_id, q.status, j.status as job_status,
             q.version = (select max(version) from quotes where job_id = q.job_id) as latest
      from quotes q join jobs j on j.id = q.job_id
      where q.share_token = ${input.token}
      for update of q`;
    if (!quote) throw new ChangeSetError(404, "This link isn't valid.");
    if (quote.status === "accepted") return;
    if (!quote.latest || quote.status === "superseded") throw new ChangeSetError(409, "This quote has been replaced by a newer version.");
    if (quote.status === "rejected") throw new ChangeSetError(409, "This quote is no longer open.");

    const steps: JobStatus[] = quote.jobStatus === "lead" ? ["quoted", "accepted"] : quote.jobStatus === "quoted" ? ["accepted"] : [];
    if (steps.length) {
      const moved = await validateAndApply(tx, {
        orgId: quote.orgId,
        actorUserId: null,
        source: "customer",
        operations: steps.map((toStatus) => ({
          tool: "request_status_change",
          args: { jobId: quote.jobId, toStatus, reason: `Quote approved online by ${input.name}` },
        })),
      });
      if (!moved.ok) throw new ChangeSetError(409, "This quote can't be approved right now. Please contact us.");
    } else if (quote.jobStatus === "declined" || quote.jobStatus === "cancelled") {
      throw new ChangeSetError(409, "This job is closed. Please contact us.");
    }

    const [before] = await tx`select * from quotes where id = ${quote.id}`;
    const [after] = await tx`
      update quotes set status = 'accepted', accepted_at = now(), accepted_by_name = ${input.name}
      where id = ${quote.id} returning *`;
    await auditDocument(tx, { orgId: quote.orgId, actorUserId: null, source: "customer", entityType: "quote", entityId: quote.id, before, after });
  });
}
