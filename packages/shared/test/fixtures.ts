import type { ChangeSetDraft, EntitySnapshot } from "../src";
import { InMemoryRepository } from "../src/testing";

export const ORG = "00000000-0000-4000-8000-000000000001";
export const OTHER_ORG = "00000000-0000-4000-8000-000000000002";
export const CAPTURE = "00000000-0000-4000-8000-0000000000ca";

export const ids = {
  client: "11111111-1111-4111-8111-111111111111",
  site: "22222222-2222-4222-8222-222222222222",
  otherSite: "22222222-2222-4222-8222-222222222223",
  leadJob: "33333333-3333-4333-8333-333333333331",
  acceptedJob: "33333333-3333-4333-8333-333333333332",
  paidJob: "33333333-3333-4333-8333-333333333333",
  quote: "44444444-4444-4444-8444-444444444441",
  oldQuote: "44444444-4444-4444-8444-444444444440",
  material: "55555555-5555-4555-8555-555555555555",
  supplyHouse: "66666666-6666-4666-8666-666666666666",
  otherOrgClient: "77777777-7777-4777-8777-777777777777",
  otherOrgJob: "77777777-7777-4777-8777-777777777778",
  missing: "99999999-9999-4999-8999-999999999999",
};

export const versions = { leadJob: 1, acceptedJob: 3, paidJob: 9 };

export function seedRepository(): InMemoryRepository {
  const snapshots: EntitySnapshot[] = [
    { entity: "client", id: ids.client, orgId: ORG },
    { entity: "site", id: ids.site, orgId: ORG, clientId: ids.client },
    { entity: "site", id: ids.otherSite, orgId: ORG, clientId: "11111111-1111-4111-8111-000000000000" },
    {
      entity: "job",
      id: ids.leadJob,
      orgId: ORG,
      clientId: ids.client,
      status: "lead",
      version: versions.leadJob,
      scheduledStart: null,
      latestQuoteId: null,
    },
    {
      entity: "job",
      id: ids.acceptedJob,
      orgId: ORG,
      clientId: ids.client,
      status: "accepted",
      version: versions.acceptedJob,
      scheduledStart: null,
      latestQuoteId: ids.quote,
    },
    {
      entity: "job",
      id: ids.paidJob,
      orgId: ORG,
      clientId: ids.client,
      status: "paid",
      version: versions.paidJob,
      scheduledStart: null,
      latestQuoteId: null,
    },
    { entity: "quote", id: ids.quote, orgId: ORG, jobId: ids.acceptedJob },
    { entity: "quote", id: ids.oldQuote, orgId: ORG, jobId: ids.acceptedJob },
    { entity: "material", id: ids.material, orgId: ORG, jobId: ids.acceptedJob, removed: false },
    { entity: "supplyHouse", id: ids.supplyHouse, orgId: ORG },
    { entity: "client", id: ids.otherOrgClient, orgId: OTHER_ORG },
    {
      entity: "job",
      id: ids.otherOrgJob,
      orgId: OTHER_ORG,
      clientId: ids.otherOrgClient,
      status: "lead",
      version: 1,
      scheduledStart: null,
      latestQuoteId: null,
    },
  ];
  return new InMemoryRepository(snapshots);
}

export function draft(
  operations: ChangeSetDraft["operations"],
  baseJobVersions: Record<string, number> = { [ids.leadJob]: versions.leadJob, [ids.acceptedJob]: versions.acceptedJob, [ids.paidJob]: versions.paidJob },
): ChangeSetDraft {
  return { captureId: CAPTURE, baseJobVersions, operations };
}
