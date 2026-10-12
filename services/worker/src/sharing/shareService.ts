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
  /** How the customer reaches the company; each null until the owner fills it in. */
  companyPhone: string | null;
  companyEmail: string | null;
  /** One printed line per row. */
  companyAddress: string | null;
  licenseNumber: string | null;
  client: string | null;
  clientPhone: string | null;
  clientEmail: string | null;
  jobTitle: string;
  /** The job site as printed lines ("412 Oak St", "Springfield, IL 62701"), or empty. */
  siteAddress: string[];
  lines: SharedLine[];
  totalCents: number;
  notes: string | null;
}

export type SharedDocument =
  | (SharedCommon & {
      kind: "quote";
      version: number;
      status: string;
      /** The day it was sent, or today for one not sent yet (a preview). */
      quotedOn: string;
      /** A newer version exists, so this one can't be approved. */
      superseded: boolean;
      validUntil: string | null;
      acceptedAt: Date | null;
      acceptedByName: string | null;
    })
  | (SharedCommon & { kind: "invoice"; number: number; status: string; issuedOn: string; dueOn: string | null; paidCents: number });

interface PartyRow {
  company: string;
  companyPhone: string | null;
  companyEmail: string | null;
  companyAddress: string | null;
  licenseNumber: string | null;
  client: string | null;
  clientPhone: string | null;
  clientEmail: string | null;
  jobTitle: string;
  line1: string | null;
  line2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
}

// The company, customer and job site, for a query whose job is aliased `j` and org `o`.
const partyColumns = (sql: Sql) => sql`
  o.name as company, o.phone as company_phone, o.email as company_email, o.address as company_address, o.license_number,
  c.name as client, c.phone as client_phone, c.email as client_email, j.title as job_title,
  s.line1, s.line2, s.city, s.region, s.postal_code`;

function parties(row: PartyRow): Omit<SharedCommon, "lines" | "totalCents" | "notes"> {
  const place = [row.city, [row.region, row.postalCode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return {
    company: row.company,
    companyPhone: row.companyPhone,
    companyEmail: row.companyEmail,
    companyAddress: row.companyAddress,
    licenseNumber: row.licenseNumber,
    client: row.client,
    clientPhone: row.clientPhone,
    clientEmail: row.clientEmail,
    jobTitle: row.jobTitle,
    siteAddress: [row.line1, row.line2, place].filter((l): l is string => !!l),
  };
}

type Fragment = postgres.PendingQuery<postgres.Row[]>;

/** Which document to load: by the customer's link token, or by ID for a member's preview. */
type DocumentKey = { token: string } | { kind: "quote" | "invoice"; id: string };

async function loadQuote(sql: Sql, where: Fragment): Promise<SharedDocument | null> {
  const [quote] = await sql<
    (PartyRow & {
      id: string;
      version: number;
      status: string;
      notes: string | null;
      quotedOn: string;
      validUntil: string | null;
      totalCents: string;
      acceptedAt: Date | null;
      acceptedByName: string | null;
      superseded: boolean;
    })[]
  >`
    select q.id, q.version, q.status, q.notes, coalesce(q.sent_at, now())::date::text as quoted_on, q.valid_until::text,
           q.total_cents, q.accepted_at, q.accepted_by_name,
           exists (select 1 from quotes n where n.job_id = q.job_id and n.version > q.version) as superseded,
           ${partyColumns(sql)}
    from quotes q
    join jobs j on j.id = q.job_id
    join organizations o on o.id = q.org_id
    left join clients c on c.id = j.client_id
    left join sites s on s.id = j.site_id
    where ${where}`;
  if (!quote) return null;
  const lines = await sql<SharedLine[]>`
    select description, quantity::float8 as quantity, unit, unit_price_cents::float8 as unit_price_cents
    from quote_line_items where quote_id = ${quote.id} order by position`;
  return {
    kind: "quote",
    ...parties(quote),
    lines,
    totalCents: Number(quote.totalCents),
    notes: quote.notes,
    version: quote.version,
    status: quote.status,
    quotedOn: quote.quotedOn,
    superseded: quote.superseded || quote.status === "superseded",
    validUntil: quote.validUntil,
    acceptedAt: quote.acceptedAt,
    acceptedByName: quote.acceptedByName,
  };
}

async function loadInvoice(sql: Sql, where: Fragment): Promise<SharedDocument | null> {
  const [invoice] = await sql<
    (PartyRow & {
      id: string;
      number: number;
      status: string;
      notes: string | null;
      issuedOn: string;
      dueOn: string | null;
      totalCents: string;
      paidCents: string;
    })[]
  >`
    select i.id, i.number, i.status, i.notes, i.issued_on::text, i.due_on::text, i.total_cents,
           (select coalesce(sum(amount_cents), 0) from payments p where p.invoice_id = i.id) as paid_cents,
           ${partyColumns(sql)}
    from invoices i
    join jobs j on j.id = i.job_id
    join organizations o on o.id = i.org_id
    left join clients c on c.id = j.client_id
    left join sites s on s.id = j.site_id
    where ${where}`;
  if (!invoice) return null;
  const lines = await sql<SharedLine[]>`
    select description, quantity::float8 as quantity, unit, unit_price_cents::float8 as unit_price_cents
    from invoice_line_items where invoice_id = ${invoice.id} order by position`;
  return {
    kind: "invoice",
    ...parties(invoice),
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

/** The document behind a link token (or, for a preview, an ID), or null if there is none. */
export async function loadSharedDocument(sql: Sql, key: string | DocumentKey): Promise<SharedDocument | null> {
  const k = typeof key === "string" ? { token: key } : key;
  if ("token" in k) return (await loadQuote(sql, sql`q.share_token = ${k.token}`)) ?? loadInvoice(sql, sql`i.share_token = ${k.token}`);
  return k.kind === "quote" ? loadQuote(sql, sql`q.id = ${k.id}`) : loadInvoice(sql, sql`i.id = ${k.id}`);
}

/** Whether the user belongs to the company that owns this quote or invoice. */
export async function canPreview(sql: Sql, input: { userId: string; kind: "quote" | "invoice"; id: string }): Promise<boolean> {
  const table = sql(input.kind === "quote" ? "quotes" : "invoices");
  const [row] = await sql`
    select 1 from ${table} d
    where d.id = ${input.id}
      and exists (select 1 from org_members m where m.org_id = d.org_id and m.user_id = ${input.userId})`;
  return !!row;
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
