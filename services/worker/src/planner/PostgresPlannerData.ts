import { centsToDollars, type ToolArgs } from "@contractorsight/shared";
import type { Queryable } from "../db/sql";
import { phoneDigits, searchWords } from "./searchText";
import type { Candidates, CandidateFinder, GlossaryEntry, LookupExecutor } from "./types";

const MAX_CANDIDATE_CLIENTS = 5;
const MAX_CANDIDATE_JOBS = 10;

const likePatterns = (words: string[]) => words.map((w) => `%${w.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);

interface ClientRow {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  sites: { id: string; label: string | null; address: string }[];
}

/**
 * Read-only data the planner needs, from Postgres: lookup tools, pre-search, and prompt context.
 * Every query is filtered by org; the worker's connection bypasses RLS.
 * Matching uses ILIKE on words from the text, served by the trigram indexes on names and titles.
 */
export class PostgresPlannerData implements LookupExecutor, CandidateFinder {
  constructor(private readonly sql: Queryable) {}

  async findClients(orgId: string, args: ToolArgs<"find_client">) {
    return this.searchClients(orgId, args.query, args.limit);
  }

  async findJobs(orgId: string, args: ToolArgs<"find_job">) {
    const patterns = likePatterns(searchWords(args.query ?? ""));
    const rows = await this.sql<{ id: string }[]>`
      select j.id
      from jobs j join clients c on c.id = j.client_id
      where j.org_id = ${orgId}
        ${args.clientId ? this.sql`and j.client_id = ${args.clientId}` : this.sql``}
        ${args.statuses ? this.sql`and j.status = any(${args.statuses}::job_status[])` : this.sql``}
        ${args.jobType ? this.sql`and j.job_type ilike ${`%${args.jobType}%`}` : this.sql``}
        ${patterns.length ? this.sql`and (j.title ilike any(${patterns}::text[]) or c.name ilike any(${patterns}::text[]) or j.job_type ilike any(${patterns}::text[]))` : this.sql``}
      order by
        (select count(*) from unnest(${patterns}::text[]) p where j.title ilike p or c.name ilike p) desc,
        j.updated_at desc
      limit ${args.limit}`;
    return this.jobViews(rows.map((r) => r.id));
  }

  /** Pre-search: clients named (or phoned) in the text with all their recent jobs, plus jobs whose title matches 2+ words. */
  async find(orgId: string, captureText: string): Promise<Candidates> {
    const clients = await this.searchClients(orgId, captureText, MAX_CANDIDATE_CLIENTS);
    const patterns = likePatterns(searchWords(captureText));
    const clientIds = clients.map((c) => c.id);
    const jobRows = await this.sql<{ id: string }[]>`
      select j.id from jobs j
      where j.org_id = ${orgId}
        and (
          j.client_id = any(${clientIds}::uuid[])
          or (select count(*) from unnest(${patterns}::text[]) p where j.title ilike p) >= 2
        )
        -- Closed jobs only matter if recent (a returning problem, a late payment).
        and (j.status not in ('paid', 'declined', 'cancelled') or j.updated_at > now() - interval '120 days')
      order by (j.status in ('paid', 'declined', 'cancelled')), j.updated_at desc
      limit ${MAX_CANDIDATE_JOBS}`;
    return { clients, jobs: await this.jobViews(jobRows.map((r) => r.id)) };
  }

  async promptContext(orgId: string): Promise<{ orgName: string; glossary: GlossaryEntry[]; supplyHouses: { id: string; name: string }[] }> {
    const [org] = await this.sql<{ name: string }[]>`select name from organizations where id = ${orgId}`;
    const glossary = await this.sql<GlossaryEntry[]>`select term, expansion from glossary_terms where org_id = ${orgId} order by lower(term)`;
    const supplyHouses = await this.sql<{ id: string; name: string }[]>`select id, name from supply_houses where org_id = ${orgId} order by name`;
    return { orgName: org?.name ?? "the contractor", glossary: [...glossary], supplyHouses: [...supplyHouses] };
  }

  private async searchClients(orgId: string, text: string, limit: number): Promise<ClientRow[]> {
    const patterns = likePatterns(searchWords(text));
    const phones = phoneDigits(text);
    if (!patterns.length && !phones.length) return [];
    const rows = await this.sql<ClientRow[]>`
      select c.id, c.name, c.phone, c.email,
        coalesce(
          json_agg(json_build_object('id', s.id, 'label', s.label, 'address', concat_ws(', ', s.line1, s.line2, s.city, s.region)))
            filter (where s.id is not null),
          '[]'
        ) as sites
      from clients c
      left join sites s on s.client_id = c.id
      where c.org_id = ${orgId}
        and (
          c.name ilike any(${patterns}::text[])
          or regexp_replace(coalesce(c.phone, ''), '\\D', '', 'g') = any(${phones}::text[])
          or exists (select 1 from sites s2 where s2.client_id = c.id and (s2.line1 ilike any(${patterns}::text[]) or s2.label ilike any(${patterns}::text[])))
        )
      group by c.id
      order by (select count(*) from unnest(${patterns}::text[]) p where c.name ilike p) desc, c.updated_at desc
      limit ${limit}`;
    return [...rows];
  }

  /** Jobs as the model sees them: status, site, latest quote (dollars), and live materials. */
  private async jobViews(jobIds: string[]) {
    if (!jobIds.length) return [];
    const jobs = await this.sql<
      {
        id: string;
        title: string;
        jobType: string | null;
        status: string;
        clientId: string;
        clientName: string;
        siteId: string | null;
        siteAddress: string | null;
        siteLabel: string | null;
        scheduledStart: Date | null;
        scheduledEnd: Date | null;
      }[]
    >`
      select j.id, j.title, j.job_type, j.status, c.id as client_id, c.name as client_name,
             s.id as site_id, concat_ws(', ', s.line1, s.line2, s.city) as site_address, s.label as site_label,
             j.scheduled_start, j.scheduled_end
      from jobs j
      join clients c on c.id = j.client_id
      left join sites s on s.id = j.site_id
      where j.id = any(${jobIds}::uuid[])`;

    const quotes = await this.sql<{ id: string; jobId: string; version: number }[]>`
      select distinct on (job_id) id, job_id, version from quotes
      where job_id = any(${jobIds}::uuid[]) order by job_id, version desc`;
    const lines = quotes.length
      ? await this.sql<{ quoteId: string; kind: string; description: string; quantity: string; unit: string | null; unitPriceCents: string; materialItemId: string | null }[]>`
          select quote_id, kind, description, quantity, unit, unit_price_cents, material_item_id
          from quote_line_items where quote_id = any(${quotes.map((q) => q.id)}::uuid[]) order by position`
      : [];
    const materials = await this.sql<{ id: string; jobId: string; description: string; quantity: string; unit: string | null; status: string }[]>`
      select id, job_id, description, quantity, unit, status from material_items
      where job_id = any(${jobIds}::uuid[]) and removed_at is null order by created_at`;

    const byId = new Map(jobs.map((j) => [j.id, j]));
    return jobIds.flatMap((id) => {
      const j = byId.get(id);
      if (!j) return [];
      const quote = quotes.find((q) => q.jobId === id);
      return [
        {
          id: j.id,
          title: j.title,
          jobType: j.jobType,
          status: j.status,
          client: { id: j.clientId, name: j.clientName },
          site: j.siteId ? { id: j.siteId, address: j.siteAddress, label: j.siteLabel } : null,
          scheduledStart: j.scheduledStart?.toISOString() ?? null,
          scheduledEnd: j.scheduledEnd?.toISOString() ?? null,
          // Quote lines in the same shape revise_quote takes, so the model can copy and edit them.
          latestQuote: quote
            ? {
                id: quote.id,
                version: quote.version,
                lineItems: lines
                  .filter((l) => l.quoteId === quote.id)
                  .map((l) =>
                    l.kind === "labor"
                      ? { kind: "labor", description: l.description, hours: Number(l.quantity), hourlyRateDollars: centsToDollars(Number(l.unitPriceCents)) }
                      : {
                          kind: "material",
                          description: l.description,
                          quantity: Number(l.quantity),
                          unit: l.unit,
                          unitPriceDollars: centsToDollars(Number(l.unitPriceCents)),
                          ...(l.materialItemId ? { materialId: l.materialItemId } : {}),
                        },
                  ),
              }
            : null,
          materials: materials
            .filter((m) => m.jobId === id)
            .map((m) => ({ id: m.id, description: m.description, quantity: Number(m.quantity), unit: m.unit, status: m.status })),
        },
      ];
    });
  }
}
