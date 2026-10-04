import { z } from "zod";

// Each enum here mirrors a Postgres enum type in supabase/migrations.
// test/migrationParity.test.ts fails if the two drift apart.

export const JOB_STATUSES = [
  "lead",
  "quoted",
  "accepted",
  "scheduled",
  "in_progress",
  "completed",
  "invoiced",
  "paid",
  "declined",
  "cancelled",
] as const;
export const jobStatusSchema = z.enum(JOB_STATUSES);
export type JobStatus = z.infer<typeof jobStatusSchema>;

export const MATERIAL_STATUSES = ["needed", "ordered", "purchased", "installed", "returned"] as const;
export const materialStatusSchema = z.enum(MATERIAL_STATUSES);
export type MaterialStatus = z.infer<typeof materialStatusSchema>;

export const QUOTE_STATUSES = ["draft", "sent", "accepted", "rejected", "superseded"] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export const QUOTE_LINE_KINDS = ["labor", "material"] as const;
export type QuoteLineKind = (typeof QUOTE_LINE_KINDS)[number];

export const SUPPLY_INTEGRATION_TYPES = ["email", "api", "manual"] as const;
export type SupplyIntegrationType = (typeof SUPPLY_INTEGRATION_TYPES)[number];

export const SUPPLY_ORDER_STATUSES = ["draft", "sent", "confirmed", "received", "cancelled"] as const;
export type SupplyOrderStatus = (typeof SUPPLY_ORDER_STATUSES)[number];

export const CAPTURE_TYPES = ["audio", "image", "text"] as const;
export const captureTypeSchema = z.enum(CAPTURE_TYPES);
export type CaptureType = z.infer<typeof captureTypeSchema>;

export const CAPTURE_STATUSES = [
  "uploaded",
  "processing",
  "ready_for_review",
  "committed",
  "rejected",
  "failed",
] as const;
export type CaptureStatus = (typeof CAPTURE_STATUSES)[number];

export const CHANGE_SET_STATUSES = ["pending", "approved", "rejected"] as const;
export type ChangeSetStatus = (typeof CHANGE_SET_STATUSES)[number];

/**
 * Where a committed change came from. `text` is a typed capture that went through
 * the LLM pipeline; `manual` is a direct edit in the app with no LLM involved.
 */
export const AUDIT_SOURCES = ["manual", "voice", "image", "text", "system"] as const;
export type AuditSource = (typeof AUDIT_SOURCES)[number];

export const AUDIT_SOURCE_BY_CAPTURE_TYPE: Record<CaptureType, AuditSource> = {
  audio: "voice",
  image: "image",
  text: "text",
};

export const ORG_ROLES = ["owner", "admin", "member"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];
