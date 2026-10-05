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

export const INVOICE_STATUSES = ["draft", "sent", "paid", "void"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const PAYMENT_METHODS = ["cash", "check", "card", "transfer", "other"] as const;
export const paymentMethodSchema = z.enum(PAYMENT_METHODS);
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

/** Business expense categories for the tax view, roughly following Schedule C lines. Your accountant decides what's deductible. */
export const EXPENSE_CATEGORIES = [
  "materials",
  "subcontractors",
  "tools_equipment",
  "equipment_rental",
  "vehicle",
  "supplies",
  "permits_licenses",
  "insurance",
  "phone_software",
  "advertising",
  "office",
  "meals",
  "disposal",
  "training",
  "bank_fees",
  "other",
] as const;
export const expenseCategorySchema = z.enum(EXPENSE_CATEGORIES);
export type ExpenseCategory = z.infer<typeof expenseCategorySchema>;

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  materials: "Materials",
  subcontractors: "Subcontractors",
  tools_equipment: "Tools & equipment",
  equipment_rental: "Equipment rental",
  vehicle: "Fuel & vehicle",
  supplies: "Shop supplies",
  permits_licenses: "Permits & licenses",
  insurance: "Insurance",
  phone_software: "Phone & software",
  advertising: "Advertising",
  office: "Office & admin",
  meals: "Meals",
  disposal: "Dump & disposal",
  training: "Training & certs",
  bank_fees: "Bank & card fees",
  other: "Other",
};

// Not a Postgres enum: jobs.job_type stays free text so other trades can bring their own list later.
// The planner must pick from this list, which keeps filters and charts grouped.
/** Kinds of plumbing work, for filtering jobs and comparing what each kind earns. */
export const JOB_TYPES = [
  "service call",
  "leak repair",
  "drain cleaning",
  "sewer line",
  "water heater",
  "tankless water heater",
  "toilet",
  "faucet & sink",
  "garbage disposal",
  "shower & tub",
  "fixture install",
  "repipe",
  "water line",
  "gas line",
  "sump pump",
  "well pump",
  "water treatment",
  "backflow",
  "inspection",
  "remodel",
  "new construction",
  "other",
] as const;
export const jobTypeSchema = z.enum(JOB_TYPES);
export type JobType = z.infer<typeof jobTypeSchema>;

/** Display label for a stored category, falling back to the raw value for anything unknown. */
export const expenseCategoryLabel = (category: string): string => (EXPENSE_CATEGORY_LABELS as Record<string, string>)[category] ?? category;
