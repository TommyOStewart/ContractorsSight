import type { EntitySnapshot, JobStatus, ToolArgs } from "@contractorsight/shared";
import { InMemoryRepository } from "@contractorsight/shared/testing";
import type { GlossaryEntry, LookupExecutor } from "../src/planner/types";

// A small, fixed plumbing business for the planner eval. IDs are readable on purpose so failures
// are easy to read in the results.

export const ORG_ID = "00000000-0000-4000-8000-0000000000aa";
const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;

export const ids = {
  jebHenderson: id(101),
  jebWalters: id(102),
  maria: id(103),
  kim: id(104),
  sarah: id(105),

  siteElm: id(201),
  siteOak: id(202),
  sitePine: id(203),
  siteBirch: id(204),
  siteMain: id(205),
  siteCedar: id(206),

  hendersonWaterHeater: id(301),
  waltersDrain: id(302),
  mariaRepipe: id(303),
  mariaRentalToilet: id(304),
  kimSump: id(305),
  sarahDisposal: id(306),
  hendersonSpigot: id(307),

  hendersonQuote: id(401),
  mariaQuote: id(402),

  mariaPex: id(501),
  mariaValves: id(502),
  kimPump: id(503),

  ferguson: id(601),
  homeDepot: id(602),
  winsupply: id(603),
};

interface Site {
  id: string;
  clientId: string;
  label?: string;
  address: string;
}
interface Client {
  id: string;
  name: string;
  phone: string;
  email?: string;
}
interface Job {
  id: string;
  clientId: string;
  siteId: string;
  title: string;
  jobType: string;
  status: JobStatus;
  version: number;
  scheduledStart: string | null;
  scheduledEnd?: string;
  quote?: { id: string; version: number; lineItems: unknown[] };
}
interface Material {
  id: string;
  jobId: string;
  description: string;
  quantity: number;
  unit?: string;
  status: string;
}

const clients: Client[] = [
  { id: ids.jebHenderson, name: "Jeb Henderson", phone: "555-0101" },
  { id: ids.jebWalters, name: "Jeb Walters", phone: "555-0199" },
  { id: ids.maria, name: "Maria Lopez", phone: "555-0123", email: "maria.lopez@example.com" },
  { id: ids.kim, name: "Dave Kim (Kim Property Management)", phone: "555-0150" },
  { id: ids.sarah, name: "Sarah O'Neil", phone: "555-0166" },
];

const sites: Site[] = [
  { id: ids.siteElm, clientId: ids.jebHenderson, address: "12 Elm St" },
  { id: ids.siteOak, clientId: ids.jebWalters, address: "88 Oak Ave" },
  { id: ids.sitePine, clientId: ids.maria, label: "Home", address: "410 Pine Rd" },
  { id: ids.siteBirch, clientId: ids.maria, label: "Rental", address: "22 Birch Ln" },
  { id: ids.siteMain, clientId: ids.kim, address: "1500 Main St, Unit 3" },
  { id: ids.siteCedar, clientId: ids.sarah, address: "7 Cedar Ct" },
];

const jobs: Job[] = [
  {
    id: ids.hendersonWaterHeater,
    clientId: ids.jebHenderson,
    siteId: ids.siteElm,
    title: "Replace 50 gal gas water heater",
    jobType: "water heater replacement",
    status: "quoted",
    version: 4,
    scheduledStart: null,
    quote: {
      id: ids.hendersonQuote,
      version: 1,
      lineItems: [
        { kind: "labor", description: "Remove old heater and install new", hours: 4, hourlyRateDollars: 125 },
        { kind: "material", description: "50 gal gas water heater", quantity: 1, unitPriceDollars: 1150 },
        { kind: "material", description: "Expansion tank", quantity: 1, unitPriceDollars: 85 },
      ],
    },
  },
  { id: ids.waltersDrain, clientId: ids.jebWalters, siteId: ids.siteOak, title: "Kitchen drain clog", jobType: "drain cleaning", status: "lead", version: 1, scheduledStart: null },
  {
    id: ids.mariaRepipe,
    clientId: ids.maria,
    siteId: ids.sitePine,
    title: "Repipe master bath with PEX",
    jobType: "repipe",
    status: "accepted",
    version: 6,
    scheduledStart: null,
    quote: { id: ids.mariaQuote, version: 2, lineItems: [{ kind: "labor", description: "Repipe master bath", hours: 16, hourlyRateDollars: 115 }] },
  },
  {
    id: ids.mariaRentalToilet,
    clientId: ids.maria,
    siteId: ids.siteBirch,
    title: "Leaking toilet at rental",
    jobType: "toilet repair",
    status: "scheduled",
    version: 3,
    scheduledStart: "2026-10-07T14:00:00.000Z", // Wed 9:00 local
    scheduledEnd: "2026-10-07T16:00:00.000Z",
  },
  { id: ids.kimSump, clientId: ids.kim, siteId: ids.siteMain, title: "Sump pump replacement", jobType: "sump pump", status: "in_progress", version: 5, scheduledStart: "2026-10-05T13:00:00.000Z" },
  { id: ids.sarahDisposal, clientId: ids.sarah, siteId: ids.siteCedar, title: "Garbage disposal install", jobType: "disposal", status: "completed", version: 8, scheduledStart: "2026-10-01T15:00:00.000Z" },
  { id: ids.hendersonSpigot, clientId: ids.jebHenderson, siteId: ids.siteElm, title: "Fix outdoor spigot", jobType: "repair", status: "paid", version: 9, scheduledStart: "2026-08-12T15:00:00.000Z" },
];

const materials: Material[] = [
  { id: ids.mariaPex, jobId: ids.mariaRepipe, description: "1/2in PEX-A pipe", quantity: 100, unit: "ft", status: "needed" },
  { id: ids.mariaValves, jobId: ids.mariaRepipe, description: "1/2in SharkBite ball valve", quantity: 2, unit: "ea", status: "needed" },
  { id: ids.kimPump, jobId: ids.kimSump, description: "1/3 HP submersible sump pump", quantity: 1, unit: "ea", status: "ordered" },
];

const supplyHouses: { id: string; name: string }[] = [
  { id: ids.ferguson, name: "Ferguson" },
  { id: ids.homeDepot, name: "Home Depot" },
  { id: ids.winsupply, name: "Winsupply" },
];

export const glossary: GlossaryEntry[] = [
  { term: "SB", expansion: "SharkBite push-to-connect fitting" },
  { term: "PEX", expansion: "cross-linked polyethylene pipe (we use PEX-A)" },
  { term: "WH", expansion: "water heater" },
  { term: "PRV", expansion: "pressure reducing valve" },
  { term: "T&P", expansion: "temperature and pressure relief valve" },
  { term: "Ferg", expansion: "Ferguson (supply house)" },
  { term: "HD", expansion: "Home Depot" },
];

export const promptContext = {
  orgName: "Stewart Plumbing",
  glossary,
  supplyHouses,
  today: "Monday, 2026-10-05",
  timezone: "America/Chicago",
  utcOffset: "-05:00",
};

/** Snapshot data the validator sees. Includes a record from another org to make cross-org leaks visible. */
export function evalRepository(): InMemoryRepository {
  const snapshots: EntitySnapshot[] = [
    ...clients.map((c) => ({ entity: "client" as const, id: c.id, orgId: ORG_ID })),
    ...sites.map((s) => ({ entity: "site" as const, id: s.id, orgId: ORG_ID, clientId: s.clientId })),
    ...jobs.map((j) => ({
      entity: "job" as const,
      id: j.id,
      orgId: ORG_ID,
      clientId: j.clientId,
      status: j.status,
      version: j.version,
      scheduledStart: j.scheduledStart,
      latestQuoteId: j.quote?.id ?? null,
    })),
    ...jobs.flatMap((j) => (j.quote ? [{ entity: "quote" as const, id: j.quote.id, orgId: ORG_ID, jobId: j.id }] : [])),
    ...materials.map((m) => ({ entity: "material" as const, id: m.id, orgId: ORG_ID, jobId: m.jobId, removed: false })),
    ...supplyHouses.map((s) => ({ entity: "supplyHouse" as const, id: s.id, orgId: ORG_ID })),
  ];
  return new InMemoryRepository(snapshots);
}

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9']+/).filter((w) => w.length > 1);
function score(query: string, haystack: string): number {
  const hay = haystack.toLowerCase();
  return words(query).filter((w) => hay.includes(w)).length;
}

const clientName = (clientId: string) => clients.find((c) => c.id === clientId)!.name;
const siteOf = (siteId: string) => sites.find((s) => s.id === siteId)!;

/** Lookups over the fixture, shaped like the production results will be. */
export const evalLookups: LookupExecutor = {
  async findClients(_orgId, args: ToolArgs<"find_client">) {
    return clients
      .map((c) => {
        const clientSites = sites.filter((s) => s.clientId === c.id);
        return {
          c,
          clientSites,
          s: score(args.query, [c.name, c.phone, c.email ?? "", ...clientSites.map((s) => `${s.label ?? ""} ${s.address}`)].join(" ")),
        };
      })
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, args.limit)
      .map(({ c, clientSites }) => ({
        id: c.id,
        name: c.name,
        phone: c.phone,
        email: c.email ?? null,
        sites: clientSites.map((s) => ({ id: s.id, label: s.label ?? null, address: s.address })),
      }));
  },

  async findJobs(_orgId, args: ToolArgs<"find_job">) {
    return jobs
      .filter((j) => !args.clientId || j.clientId === args.clientId)
      .filter((j) => !args.statuses || args.statuses.includes(j.status))
      .filter((j) => !args.jobType || j.jobType.includes(args.jobType))
      .map((j) => ({ j, s: args.query ? score(args.query, `${j.title} ${j.jobType} ${clientName(j.clientId)} ${siteOf(j.siteId).address} ${siteOf(j.siteId).label ?? ""}`) : 1 }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, args.limit)
      .map(({ j }) => ({
        id: j.id,
        title: j.title,
        jobType: j.jobType,
        status: j.status,
        client: { id: j.clientId, name: clientName(j.clientId) },
        site: { id: j.siteId, address: siteOf(j.siteId).address, label: siteOf(j.siteId).label ?? null },
        scheduledStart: j.scheduledStart,
        scheduledEnd: j.scheduledEnd ?? null,
        latestQuote: j.quote ? { id: j.quote.id, version: j.quote.version, lineItems: j.quote.lineItems } : null,
        materials: materials
          .filter((m) => m.jobId === j.id)
          .map((m) => ({ id: m.id, description: m.description, quantity: m.quantity, unit: m.unit ?? null, status: m.status })),
      }));
  },
};

export const fixtureSupplyHouses = supplyHouses;
