import type { JobStatus } from "../domain/enums";
import { canTransition, isClosed } from "../domain/jobStateMachine";
import type { IdPath } from "../domain/refs";
import type { StagedToolName, ToolArgs } from "../tools/registry";
import type { IssueCode } from "./issues";
import type { EntitySnapshot } from "./repository";

export interface ProjectedJob {
  clientId: string;
  status: JobStatus;
  scheduledStart: string | null;
  latestQuoteId: string | null;
  hasQuote: boolean;
}

/**
 * The state the ChangeSet would produce, built up one operation at a time, so later
 * operations are checked against the effect of earlier ones (e.g. accepted → scheduled → in_progress
 * in one capture). Keys are real IDs or temp IDs.
 */
export class Projection {
  readonly jobs = new Map<string, ProjectedJob>();
  readonly sites = new Map<string, { clientId: string }>();
  readonly materials = new Map<string, { jobId: string; removed: boolean }>();
  readonly quotes = new Map<string, { jobId: string }>();
  /** Temp IDs of clients created in this ChangeSet with a site address. */
  readonly newClientsWithSite = new Set<string>();

  constructor(snapshots: Iterable<EntitySnapshot>) {
    for (const s of snapshots) {
      switch (s.entity) {
        case "job":
          this.jobs.set(s.id, {
            clientId: s.clientId,
            status: s.status,
            scheduledStart: s.scheduledStart,
            latestQuoteId: s.latestQuoteId,
            hasQuote: s.latestQuoteId !== null,
          });
          break;
        case "site":
          this.sites.set(s.id, { clientId: s.clientId });
          break;
        case "material":
          this.materials.set(s.id, { jobId: s.jobId, removed: s.removed });
          break;
        case "quote":
          this.quotes.set(s.id, { jobId: s.jobId });
          break;
      }
    }
  }
}

export interface RuleContext {
  projection: Projection;
  now: Date;
  report(code: IssueCode, message: string, path?: IdPath): void;
}

type Rule<N extends StagedToolName> = (args: ToolArgs<N>, ctx: RuleContext) => void;

/** Statuses in which a quote can still be revised (change orders allowed until the work is done). */
const QUOTABLE_STATUSES: readonly JobStatus[] = ["lead", "quoted", "accepted", "scheduled", "in_progress"];

function openJob(ctx: RuleContext, jobId: string, path: IdPath): ProjectedJob | undefined {
  const job = ctx.projection.jobs.get(jobId);
  if (!job) return undefined; // reference checks already reported it
  if (isClosed(job.status)) {
    ctx.report("JOB_CLOSED", `Job ${jobId} is ${job.status}; only notes can be added to it.`, path);
    return undefined;
  }
  return job;
}

function liveMaterial(ctx: RuleContext, materialId: string, path: IdPath) {
  const material = ctx.projection.materials.get(materialId);
  if (material?.removed) {
    ctx.report("BUSINESS_RULE", `Material ${materialId} has been removed.`, path);
    return undefined;
  }
  return material;
}

function materialBelongsToJob(ctx: RuleContext, materialId: string, jobId: string, path: IdPath) {
  const material = liveMaterial(ctx, materialId, path);
  if (material && material.jobId !== jobId) {
    ctx.report("WRONG_PARENT", `Material ${materialId} belongs to a different job.`, path);
  }
}

function siteBelongsToClient(ctx: RuleContext, siteId: string, clientId: string, path: IdPath) {
  const site = ctx.projection.sites.get(siteId);
  if (site && site.clientId !== clientId) {
    ctx.report("WRONG_PARENT", `Site ${siteId} belongs to a different client.`, path);
  }
}

function transition(ctx: RuleContext, job: ProjectedJob, jobId: string, to: JobStatus, path: IdPath): boolean {
  if (!canTransition(job.status, to)) {
    ctx.report("ILLEGAL_STATUS_TRANSITION", `Job ${jobId} cannot move from ${job.status} to ${to}.`, path);
    return false;
  }
  job.status = to;
  return true;
}

function requireChanges(ctx: RuleContext, changes: object) {
  if (Object.values(changes).every((v) => v === undefined)) {
    ctx.report("BUSINESS_RULE", "No fields to change.", ["changes"]);
  }
}

/**
 * Business rules per staged tool. Typed as a complete record so adding a tool to TOOLS
 * without deciding its rules is a compile error.
 */
export const BUSINESS_RULES: { [N in StagedToolName]: Rule<N> } = {
  create_client(args, ctx) {
    if (args.tempId && args.siteAddress) ctx.projection.newClientsWithSite.add(args.tempId);
  },

  create_job(args, ctx) {
    if (args.siteId && args.siteAddress) {
      ctx.report("BUSINESS_RULE", "Give either siteId or siteAddress, not both.", ["siteAddress"]);
    }
    if (args.siteId) siteBelongsToClient(ctx, args.siteId, args.clientId, ["siteId"]);
    if (args.siteAddress && ctx.projection.newClientsWithSite.has(args.clientId)) {
      ctx.report(
        "BUSINESS_RULE",
        "This client's address is already on create_client, which would create a duplicate site. Omit siteAddress here; the job uses the client's site.",
        ["siteAddress"],
      );
    }
    if (args.tempId) {
      ctx.projection.jobs.set(args.tempId, {
        clientId: args.clientId,
        status: "lead",
        scheduledStart: null,
        latestQuoteId: null,
        hasQuote: false,
      });
    }
  },

  add_material(args, ctx) {
    openJob(ctx, args.jobId, ["jobId"]);
    if (args.tempId) ctx.projection.materials.set(args.tempId, { jobId: args.jobId, removed: false });
  },

  add_note(args, ctx) {
    if ((args.jobId === undefined) === (args.clientId === undefined)) {
      ctx.report("BUSINESS_RULE", "A note must be attached to exactly one job or one client.", []);
    }
  },

  update_job_fields(args, ctx) {
    requireChanges(ctx, args.changes);
    const job = openJob(ctx, args.jobId, ["jobId"]);
    if (job && args.changes.siteId) siteBelongsToClient(ctx, args.changes.siteId, job.clientId, ["changes", "siteId"]);
  },

  revise_quote(args, ctx) {
    const job = openJob(ctx, args.jobId, ["jobId"]);
    if (!job) return;
    if (!QUOTABLE_STATUSES.includes(job.status)) {
      ctx.report("BUSINESS_RULE", `Quotes can't be revised once a job is ${job.status}.`, ["jobId"]);
    }
    if (args.basedOnQuoteId) {
      const quote = ctx.projection.quotes.get(args.basedOnQuoteId);
      if (quote && quote.jobId !== args.jobId) {
        ctx.report("WRONG_PARENT", `Quote ${args.basedOnQuoteId} belongs to a different job.`, ["basedOnQuoteId"]);
      } else if (job.latestQuoteId !== args.basedOnQuoteId) {
        ctx.report("STALE_QUOTE", "The quote has been revised since this version; revise the latest one.", ["basedOnQuoteId"]);
      }
    }
    args.lineItems.forEach((line, i) => {
      if (line.kind === "material" && line.materialId) {
        materialBelongsToJob(ctx, line.materialId, args.jobId, ["lineItems", i, "materialId"]);
      }
    });
    job.hasQuote = true;
  },

  update_material(args, ctx) {
    requireChanges(ctx, args.changes);
    const material = liveMaterial(ctx, args.materialId, ["materialId"]);
    if (material) openJob(ctx, material.jobId, ["materialId"]);
  },

  remove_material(args, ctx) {
    const material = liveMaterial(ctx, args.materialId, ["materialId"]);
    if (!material) return;
    openJob(ctx, material.jobId, ["materialId"]);
    material.removed = true;
  },

  request_status_change(args, ctx) {
    const job = ctx.projection.jobs.get(args.jobId);
    if (!job) return;
    if (args.toStatus === "quoted" && !job.hasQuote) {
      ctx.report("BUSINESS_RULE", "A job needs a quote before it can be marked quoted.", ["toStatus"]);
      return;
    }
    if (args.toStatus === "scheduled" && !job.scheduledStart) {
      ctx.report("BUSINESS_RULE", "Use schedule_job to schedule a job; it needs a start time.", ["toStatus"]);
      return;
    }
    transition(ctx, job, args.jobId, args.toStatus, ["toStatus"]);
  },

  schedule_job(args, ctx) {
    if (args.end && Date.parse(args.end) <= Date.parse(args.start)) {
      ctx.report("BUSINESS_RULE", "End must be after start.", ["end"]);
    }
    const job = openJob(ctx, args.jobId, ["jobId"]);
    if (!job) return;
    if (job.status !== "scheduled" && !transition(ctx, job, args.jobId, "scheduled", ["jobId"])) return;
    job.scheduledStart = args.start;
  },

  flag_ambiguity(args, ctx) {
    args.candidates.forEach((candidate, i) => {
      const ids = [candidate.clientId, candidate.jobId, candidate.siteId, candidate.materialId].filter(Boolean);
      if (ids.length > 1) ctx.report("BUSINESS_RULE", "A candidate can point at one record at most.", ["candidates", i]);
    });
  },

  draft_supply_order(args, ctx) {
    if (args.jobId) openJob(ctx, args.jobId, ["jobId"]);
    args.lines.forEach((line, i) => {
      if (!line.materialId) return;
      if (args.jobId) materialBelongsToJob(ctx, line.materialId, args.jobId, ["lines", i, "materialId"]);
      else liveMaterial(ctx, line.materialId, ["lines", i, "materialId"]);
    });
  },

  record_purchase(args, ctx) {
    openJob(ctx, args.jobId, ["jobId"]);
    if (args.supplyHouseId && args.vendorName) {
      ctx.report("BUSINESS_RULE", "Give either supplyHouseId or vendorName, not both.", ["vendorName"]);
    }
    if (args.purchasedOn) {
      // Compare whole days; allow a day of slack for time zones.
      const tomorrow = new Date(ctx.now.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      if (args.purchasedOn > tomorrow) {
        ctx.report("BUSINESS_RULE", "Purchase date is in the future.", ["purchasedOn"]);
      }
    }
  },
};
