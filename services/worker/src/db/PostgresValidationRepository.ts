import type { EntityKey, EntityKind, EntitySnapshot, InvoiceStatus, JobStatus, ValidationRepository } from "@contractorsight/shared";
import type { Queryable } from "./sql";

/**
 * ValidationRepository backed by Postgres. Deliberately not org-filtered: the validator needs
 * to see other orgs' rows to report CROSS_ORG_REFERENCE.
 *
 * With `lockJobs`, job rows are read `for update`, so inside a transaction no one can change
 * a job between validation and commit. Use it on the approve path.
 */
export class PostgresValidationRepository implements ValidationRepository {
  constructor(
    private readonly sql: Queryable,
    private readonly options: { lockJobs?: boolean } = {},
  ) {}

  async getEntities(keys: readonly EntityKey[]): Promise<EntitySnapshot[]> {
    const byKind = new Map<EntityKind, string[]>();
    for (const { entity, id } of keys) byKind.set(entity, [...(byKind.get(entity) ?? []), id]);

    const results = await Promise.all([...byKind].map(([entity, ids]) => this.load(entity, [...new Set(ids)])));
    return results.flat();
  }

  private async load(entity: EntityKind, ids: string[]): Promise<EntitySnapshot[]> {
    const sql = this.sql;
    switch (entity) {
      case "client": {
        const rows = await sql<{ id: string; orgId: string }[]>`select id, org_id from public.clients where id = any(${ids}::uuid[])`;
        return rows.map((r) => ({ entity, ...r }));
      }
      case "site": {
        const rows = await sql<{ id: string; orgId: string; clientId: string }[]>`
          select id, org_id, client_id from public.sites where id = any(${ids}::uuid[])`;
        return rows.map((r) => ({ entity, ...r }));
      }
      case "job": {
        const lock = this.options.lockJobs ? sql`for update of j` : sql``;
        const rows = await sql<
          { id: string; orgId: string; clientId: string; status: JobStatus; version: number; scheduledStart: Date | null; latestQuoteId: string | null }[]
        >`
          select j.id, j.org_id, j.client_id, j.status, j.version, j.scheduled_start,
                 (select q.id from public.quotes q where q.job_id = j.id order by q.version desc limit 1) as latest_quote_id
          from public.jobs j
          where j.id = any(${ids}::uuid[])
          order by j.id
          ${lock}`;
        return rows.map((r) => ({ entity, ...r, scheduledStart: r.scheduledStart?.toISOString() ?? null }));
      }
      case "quote": {
        const rows = await sql<{ id: string; orgId: string; jobId: string }[]>`
          select id, org_id, job_id from public.quotes where id = any(${ids}::uuid[])`;
        return rows.map((r) => ({ entity, ...r }));
      }
      case "material": {
        const rows = await sql<{ id: string; orgId: string; jobId: string; removed: boolean }[]>`
          select id, org_id, job_id, removed_at is not null as removed from public.material_items where id = any(${ids}::uuid[])`;
        return rows.map((r) => ({ entity, ...r }));
      }
      case "equipment": {
        const rows = await sql<{ id: string; orgId: string; siteId: string }[]>`
          select id, org_id, site_id from public.equipment where id = any(${ids}::uuid[])`;
        return rows.map((r) => ({ entity, ...r }));
      }
      case "invoice": {
        const rows = await sql<{ id: string; orgId: string; jobId: string; status: InvoiceStatus; totalCents: string; paidCents: string }[]>`
          select i.id, i.org_id, i.job_id, i.status, i.total_cents,
                 coalesce((select sum(p.amount_cents) from public.payments p where p.invoice_id = i.id), 0) as paid_cents
          from public.invoices i where i.id = any(${ids}::uuid[])`;
        return rows.map((r) => ({ entity, ...r, totalCents: Number(r.totalCents), paidCents: Number(r.paidCents) }));
      }
      case "supplyHouse": {
        const rows = await sql<{ id: string; orgId: string }[]>`select id, org_id from public.supply_houses where id = any(${ids}::uuid[])`;
        return rows.map((r) => ({ entity, ...r }));
      }
      case "supplyOrder": {
        const rows = await sql<{ id: string; orgId: string }[]>`select id, org_id from public.supply_orders where id = any(${ids}::uuid[])`;
        return rows.map((r) => ({ entity, ...r }));
      }
      case "attachment": {
        const rows = await sql<{ id: string; orgId: string }[]>`select id, org_id from public.attachments where id = any(${ids}::uuid[])`;
        return rows.map((r) => ({ entity, ...r }));
      }
    }
  }
}
