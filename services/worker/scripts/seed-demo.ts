/**
 * Loads the eval's demo plumbing business (Jeb Henderson, Maria Lopez, ...) into a real org so
 * captures have something to match while testing. IDs are freshly generated; the org must be empty
 * of clients unless --force is given.
 *
 *   pnpm --filter @contractorsight/worker seed:demo              # lists orgs
 *   pnpm --filter @contractorsight/worker seed:demo -- --org <org id>
 */
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { dollarsToCents } from "@contractorsight/shared";
import { createSql } from "../src/db/sql";
import { fixture } from "../evals/world";

const { values } = parseArgs({ options: { org: { type: "string" }, force: { type: "boolean", default: false } } });
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set (services/worker/.env).");
const sql = createSql(url);

try {
  if (!values.org) {
    const orgs = await sql<{ id: string; name: string; clients: number }[]>`
      select o.id, o.name, (select count(*) from clients c where c.org_id = o.id)::int as clients from organizations o order by o.created_at`;
    console.log("Companies (pass one with --org):");
    for (const o of orgs) console.log(`  ${o.id}  ${o.name}  (${o.clients} clients)`);
  } else {
    const orgId = values.org;
    const [row] = await sql<{ count: number }[]>`select count(*)::int as count from clients where org_id = ${orgId}`;
    const count = row?.count ?? 0;
    if (count > 0 && !values.force) throw new Error(`That company already has ${count} clients. Re-run with --force to add the demo data anyway.`);

    const newId = new Map<string, string>();
    const id = (fixtureId: string) => newId.get(fixtureId) ?? newId.set(fixtureId, randomUUID()).get(fixtureId)!;

    await sql.begin(async (tx) => {
      for (const s of fixture.supplyHouses) await tx`insert into supply_houses ${tx({ id: id(s.id), orgId, name: s.name })}`;
      for (const g of fixture.glossary) await tx`insert into glossary_terms ${tx({ orgId, term: g.term, expansion: g.expansion })} on conflict do nothing`;
      for (const c of fixture.clients) await tx`insert into clients ${tx({ id: id(c.id), orgId, name: c.name, phone: c.phone, email: c.email ?? null })}`;
      for (const s of fixture.sites) await tx`insert into sites ${tx({ id: id(s.id), orgId, clientId: id(s.clientId), label: s.label ?? null, line1: s.address })}`;
      for (const j of fixture.jobs) {
        await tx`insert into jobs ${tx({
          id: id(j.id),
          orgId,
          clientId: id(j.clientId),
          siteId: id(j.siteId),
          title: j.title,
          jobType: j.jobType,
          status: j.status,
          scheduledStart: j.scheduledStart ? new Date(j.scheduledStart) : null,
          scheduledEnd: j.scheduledEnd ? new Date(j.scheduledEnd) : null,
        })}`;
        if (j.quote) {
          const lines = (j.quote.lineItems as Record<string, any>[]).map((l, position) => // eslint-disable-line @typescript-eslint/no-explicit-any
            l.kind === "labor"
              ? { position, kind: "labor", description: l.description, quantity: l.hours, unit: "hr", unitPriceCents: dollarsToCents(l.hourlyRateDollars) }
              : { position, kind: "material", description: l.description, quantity: l.quantity, unit: l.unit ?? null, unitPriceCents: dollarsToCents(l.unitPriceDollars) },
          );
          const total = lines.reduce((s, l) => s + Math.round(l.quantity * l.unitPriceCents), 0);
          await tx`insert into quotes ${tx({ id: id(j.quote.id), orgId, jobId: id(j.id), version: j.quote.version, status: "sent", totalCents: total })}`;
          await tx`insert into quote_line_items ${tx(lines.map((l) => ({ ...l, orgId, quoteId: id(j.quote!.id) })))}`;
        }
      }
      for (const m of fixture.materials) {
        await tx`insert into material_items ${tx({ id: id(m.id), orgId, jobId: id(m.jobId), description: m.description, quantity: m.quantity, unit: m.unit ?? null, status: m.status })}`;
      }
    });
    console.log(`Added ${fixture.clients.length} clients, ${fixture.jobs.length} jobs, ${fixture.materials.length} materials, ${fixture.supplyHouses.length} supply houses and the glossary.`);
  }
} finally {
  await sql.end();
}
