import type { JobStatus } from "../domain/enums";
import type { EntityKind } from "../domain/refs";

export interface EntityKey {
  entity: EntityKind;
  id: string;
}

/** The minimum the validator needs to know about each referenced record. */
export type EntitySnapshot =
  | { entity: "client"; id: string; orgId: string }
  | { entity: "site"; id: string; orgId: string; clientId: string }
  | {
      entity: "job";
      id: string;
      orgId: string;
      clientId: string;
      status: JobStatus;
      version: number;
      scheduledStart: string | null;
      /** Highest-version quote for the job, or null if it has never been quoted. */
      latestQuoteId: string | null;
    }
  | { entity: "quote"; id: string; orgId: string; jobId: string }
  | { entity: "material"; id: string; orgId: string; jobId: string; removed: boolean }
  | { entity: "equipment"; id: string; orgId: string; siteId: string }
  | { entity: "supplyHouse" | "supplyOrder" | "attachment"; id: string; orgId: string };

/**
 * Read access the validator needs. The production implementation lives in the worker and
 * queries Postgres with the service role. It must NOT filter by org: the validator has to
 * see records in other orgs to report CROSS_ORG_REFERENCE instead of silently missing them.
 */
export interface ValidationRepository {
  /** Returns a snapshot for each key that exists; keys that don't exist are simply omitted. */
  getEntities(keys: readonly EntityKey[]): Promise<EntitySnapshot[]>;
}
