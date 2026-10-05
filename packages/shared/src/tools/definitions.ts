import { z } from "zod";
import { expenseCategorySchema, jobStatusSchema, jobTypeSchema, materialStatusSchema, paymentMethodSchema } from "../domain/enums";
import { dollarsSchema } from "../domain/money";
import { entityRef, existingRef, tempIdDecl } from "../domain/refs";
import { defineTool } from "./defineTool";

// Tool inputs use strict objects: unknown keys are rejected at runtime and
// `additionalProperties: false` is emitted in the JSON Schema.

const text = (max: number, description: string) => z.string().trim().min(1).max(max).meta({ description });
const optionalText = (max: number, description: string) => text(max, description).optional();
const quantity = (description: string) => z.number().positive().max(1_000_000).meta({ description });
const unit = z
  .string()
  .trim()
  .min(1)
  .max(20)
  .meta({ description: 'Unit of measure as spoken or written, e.g. "ea", "ft", "box", "hr".' })
  .optional();

const addressSchema = z
  .strictObject({
    line1: text(200, "Street address."),
    line2: optionalText(200, "Unit, suite, etc."),
    city: optionalText(100, "City."),
    region: optionalText(100, "State or province."),
    postalCode: optionalText(20, "ZIP or postal code."),
    label: optionalText(80, 'Short name for the site, e.g. "Rental on 5th".'),
  })
  .meta({ description: "A service address." });

const jobType = jobTypeSchema.meta({
  description: 'Kind of work. Pick the closest; "service call" for small diagnostic visits, "other" only if nothing fits.',
});

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

export const findClient = defineTool({
  name: "find_client",
  kind: "lookup",
  description:
    "Search the contractor's existing clients by name, phone, email, or address. Call this before create_client so you don't create duplicates. If more than one plausible match comes back, call flag_ambiguity instead of guessing.",
  input: z.strictObject({
    query: text(200, "Name, phone, email, or address fragment as it appeared in the capture."),
    limit: z.int().min(1).max(20).default(5).meta({ description: "Maximum results." }),
  }),
});

export const findJob = defineTool({
  name: "find_job",
  kind: "lookup",
  description:
    "Search existing jobs. Combine filters to narrow results. Use this to resolve references like \"the Henderson water heater job\" to a job ID.",
  input: z.strictObject({
    query: optionalText(200, "Free text matched against job title and client name."),
    clientId: existingRef("client", "Only jobs for this client.").optional(),
    statuses: z.array(jobStatusSchema).min(1).optional().meta({ description: "Only jobs in these statuses." }),
    jobType: jobType.optional(),
    limit: z.int().min(1).max(20).default(5).meta({ description: "Maximum results." }),
  }),
});

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export const createClient = defineTool({
  name: "create_client",
  kind: "mutation",
  description:
    "Create a new client. Only use this after find_client found no match. Include a site address if one was mentioned.",
  input: z.strictObject({
    tempId: tempIdDecl("client").optional(),
    name: text(200, "Client's name (person or business)."),
    phone: optionalText(40, "Phone number as given."),
    email: z.email().optional().meta({ description: "Email address." }),
    notes: optionalText(2000, "Anything else worth remembering about the client."),
    siteAddress: addressSchema
      .optional()
      .meta({ description: "The client's service address, if mentioned. A job created for this client in the same capture uses it automatically; don't repeat it on create_job." }),
  }),
});

export const createJob = defineTool({
  name: "create_job",
  kind: "mutation",
  description:
    "Create a new job for a client. New jobs start in the `lead` status. Give either siteId (an existing site of this client) or siteAddress (a new site), not both. Omit both when the client has a single site, including a client created earlier in this capture with an address: the job uses that site.",
  input: z.strictObject({
    tempId: tempIdDecl("job").optional(),
    clientId: entityRef("client", "Client the job is for."),
    siteId: entityRef("site", "Existing site where the work happens.").optional(),
    siteAddress: addressSchema.optional(),
    title: text(200, 'Short title, e.g. "Replace 50gal water heater".'),
    jobType: jobType.optional(),
    description: optionalText(4000, "Scope of work in plain language."),
  }),
});

export const addMaterial = defineTool({
  name: "add_material",
  kind: "mutation",
  description:
    "Add a material item to a job's materials list (parts needed, ordered, or used). Expand trade shorthand using the org glossary where possible, and keep the original wording in the description if unsure.",
  input: z.strictObject({
    tempId: tempIdDecl("material").optional(),
    jobId: entityRef("job", "Job the material is for."),
    description: text(300, 'What the part is, e.g. "1/2in SharkBite coupling".'),
    quantity: quantity("How many."),
    unit,
    unitCostDollars: dollarsSchema("Cost per unit, if known.").optional(),
    supplyHouseId: entityRef("supplyHouse", "Where it is being bought, if known.").optional(),
    status: materialStatusSchema.default("needed").meta({ description: "Where this material is in its lifecycle." }),
  }),
});

export const addNote = defineTool({
  name: "add_note",
  kind: "mutation",
  description:
    "Attach a free-text note to exactly one job or one client. Use for observations that don't fit a structured field (gate codes, dog in yard, customer preferences).",
  input: z.strictObject({
    jobId: entityRef("job", "Job to attach the note to.").optional(),
    clientId: entityRef("client", "Client to attach the note to.").optional(),
    body: text(8000, "The note text."),
  }),
});

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export const updateJobFields = defineTool({
  name: "update_job_fields",
  kind: "mutation",
  description:
    "Change descriptive fields on a job. Status cannot be changed here (use request_status_change), nor schedule (use schedule_job).",
  input: z.strictObject({
    jobId: entityRef("job", "Job to update."),
    changes: z
      .strictObject({
        title: optionalText(200, "New title."),
        jobType: jobType.optional(),
        description: optionalText(4000, "New scope description. Replaces the old one."),
        siteId: entityRef("site", "Move the job to another site of the same client.").optional(),
      })
      .meta({ description: "Only the fields that change." }),
  }),
});

const laborLineSchema = z.strictObject({
  kind: z.literal("labor"),
  description: text(300, 'What the labor covers, e.g. "Remove and haul away old heater".'),
  hours: quantity("Hours of labor."),
  hourlyRateDollars: dollarsSchema("Hourly rate."),
});

const materialLineSchema = z.strictObject({
  kind: z.literal("material"),
  description: text(300, "Material being quoted."),
  quantity: quantity("How many."),
  unit,
  unitPriceDollars: dollarsSchema("Price per unit charged to the customer."),
  materialId: entityRef("material", "Job material item this line prices, if any.").optional(),
});

export const reviseQuote = defineTool({
  name: "revise_quote",
  kind: "mutation",
  description:
    "Create a new version of the job's quote. Always send the complete list of line items; the new version replaces the previous one, which is kept as history.",
  input: z.strictObject({
    jobId: entityRef("job", "Job being quoted."),
    basedOnQuoteId: existingRef("quote", "The quote version this revision starts from, if the job already has one.").optional(),
    lineItems: z
      .array(z.discriminatedUnion("kind", [laborLineSchema, materialLineSchema]))
      .min(1)
      .max(200)
      .meta({ description: "All line items in the new version." }),
    notes: optionalText(4000, "Terms, exclusions, or notes shown on the quote."),
    validUntil: z.iso.date().optional().meta({ description: "Last day the quote is valid (YYYY-MM-DD)." }),
  }),
});

export const updateMaterial = defineTool({
  name: "update_material",
  kind: "mutation",
  description: "Change a material item already on a job (quantity, cost, status, supplier).",
  input: z.strictObject({
    materialId: entityRef("material", "Material item to update."),
    changes: z
      .strictObject({
        description: optionalText(300, "New description."),
        quantity: quantity("New quantity.").optional(),
        unit,
        unitCostDollars: dollarsSchema("New cost per unit.").optional(),
        supplyHouseId: entityRef("supplyHouse", "Supply house it is bought from.").optional(),
        status: materialStatusSchema.optional(),
      })
      .meta({ description: "Only the fields that change." }),
  }),
});

export const removeMaterial = defineTool({
  name: "remove_material",
  kind: "mutation",
  description: "Remove a material item from a job's list (e.g. no longer needed). Returned parts should use update_material with status `returned` instead.",
  input: z.strictObject({
    materialId: existingRef("material", "Material item to remove."),
    reason: optionalText(500, "Why it was removed."),
  }),
});

export const requestStatusChange = defineTool({
  name: "request_status_change",
  kind: "mutation",
  description:
    "Move a job to a new status. Allowed moves: lead→quoted, quoted→accepted, accepted→scheduled, scheduled→in_progress, in_progress→completed, completed→invoiced, invoiced→paid; declined from lead or quoted; cancelled from any status before completed. Prefer schedule_job for scheduling.",
  input: z.strictObject({
    jobId: entityRef("job", "Job whose status changes."),
    toStatus: jobStatusSchema.meta({ description: "The new status." }),
    reason: optionalText(500, "What in the capture indicated this change."),
  }),
});

export const scheduleJob = defineTool({
  name: "schedule_job",
  kind: "mutation",
  description:
    "Set or change when a job is scheduled. The job must be `accepted` (it becomes `scheduled`) or already `scheduled` (it is rescheduled).",
  input: z.strictObject({
    jobId: entityRef("job", "Job to schedule."),
    start: z.iso.datetime({ offset: true }).meta({ description: "Start time, ISO 8601 with timezone offset." }),
    end: z.iso.datetime({ offset: true }).optional().meta({ description: "End time, ISO 8601 with timezone offset." }),
  }),
});

// ---------------------------------------------------------------------------
// Other
// ---------------------------------------------------------------------------

export const flagAmbiguity = defineTool({
  name: "flag_ambiguity",
  kind: "signal",
  description:
    'Tell the reviewer something is unclear instead of guessing, e.g. "two clients named Jeb" or "can\'t read the quantity". Writes nothing; the reviewer resolves it.',
  input: z.strictObject({
    question: text(500, "The question the contractor needs to answer."),
    about: z.enum(["client", "job", "site", "material", "quote", "schedule", "other"]).meta({ description: "What kind of thing is ambiguous." }),
    sourceExcerpt: optionalText(500, "The words or text in the capture that caused the ambiguity."),
    candidates: z
      .array(
        z.strictObject({
          label: text(200, "How to describe this option to the contractor."),
          clientId: existingRef("client", "Set if this option is an existing client.").optional(),
          jobId: existingRef("job", "Set if this option is an existing job.").optional(),
          siteId: existingRef("site", "Set if this option is an existing site.").optional(),
          materialId: existingRef("material", "Set if this option is an existing material item.").optional(),
        }),
      )
      .max(10)
      .default([])
      .meta({ description: "The plausible options, if any." }),
  }),
});

export const draftSupplyOrder = defineTool({
  name: "draft_supply_order",
  kind: "mutation",
  description:
    "Draft an order to a supply house. This only creates a draft; sending it is a separate action the contractor takes.",
  input: z.strictObject({
    tempId: tempIdDecl("supplyOrder").optional(),
    supplyHouseId: entityRef("supplyHouse", "Supply house to order from."),
    jobId: entityRef("job", "Job the order is for, if any.").optional(),
    lines: z
      .array(
        z.strictObject({
          description: text(300, "Part description."),
          quantity: quantity("How many."),
          unit,
          sku: optionalText(80, "Supplier part number, if known."),
          materialId: entityRef("material", "Job material item this line fulfils, if any.").optional(),
        }),
      )
      .min(1)
      .max(200),
    notes: optionalText(2000, "Notes for the supplier (pickup vs delivery, etc.)."),
  }),
});

export const recordPurchase = defineTool({
  name: "record_purchase",
  kind: "mutation",
  description:
    "Record parts bought for a job from a receipt: each line becomes a `purchased` material item on the job, and the purchase is logged as a materials expense. Use supplyHouseId if the store is a known supply house, otherwise vendorName. For spending that isn't parts for a specific job (tools, fuel, phone bill, shop supplies), use record_expense instead.",
  input: z.strictObject({
    jobId: entityRef("job", "Job the parts were bought for."),
    supplyHouseId: entityRef("supplyHouse", "Known supply house the receipt is from.").optional(),
    vendorName: optionalText(200, "Store name as printed, if not a known supply house."),
    purchasedOn: z.iso.date().optional().meta({ description: "Date on the receipt (YYYY-MM-DD)." }),
    receiptAttachmentId: existingRef("attachment", "The scanned receipt image.").optional(),
    totalDollars: dollarsSchema("Receipt total including tax.").optional(),
    lines: z
      .array(
        z.strictObject({
          description: text(300, "Item as printed, expanded if it is obvious shorthand."),
          quantity: quantity("How many."),
          unit,
          unitCostDollars: dollarsSchema("Price per unit before tax.").optional(),
        }),
      )
      .min(1)
      .max(200),
  }),
});

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

export const createInvoice = defineTool({
  name: "create_invoice",
  kind: "mutation",
  description:
    "Bill a job. Omit lineItems to bill the job's latest quote as it stands; give lineItems for a deposit, a partial bill, or extra work. The invoice is marked sent today, and a completed job moves to `invoiced`. Don't also call request_status_change for that.",
  input: z.strictObject({
    tempId: tempIdDecl("invoice").optional(),
    jobId: entityRef("job", "Job being billed."),
    lineItems: z
      .array(z.discriminatedUnion("kind", [laborLineSchema, materialLineSchema]))
      .min(1)
      .max(200)
      .optional()
      .meta({ description: "What's being billed. Leave out to copy the latest quote." }),
    dueInDays: z.int().min(0).max(120).optional().meta({ description: 'Days until payment is due, if stated ("net 30" = 30).' }),
    notes: optionalText(2000, "Notes printed on the invoice."),
  }),
});

export const recordPayment = defineTool({
  name: "record_payment",
  kind: "mutation",
  description:
    "Record money received against an invoice (find the invoice ID in find_job results). When the invoice is fully paid it's marked paid, and when all of a job's invoices are paid the job moves to `paid` automatically. Don't also call request_status_change for that.",
  input: z.strictObject({
    invoiceId: entityRef("invoice", "Invoice being paid."),
    amountDollars: dollarsSchema("Amount received."),
    paidOn: z.iso.date().optional().meta({ description: "Date received (YYYY-MM-DD), if not today." }),
    method: paymentMethodSchema.optional().meta({ description: "How they paid." }),
    reference: optionalText(80, "Check number or other reference."),
  }),
});

export const recordExpense = defineTool({
  name: "record_expense",
  kind: "mutation",
  description:
    "Log a business expense that isn't parts for a specific job: tools, fuel, subcontractors, permits, insurance, dump fees, phone bills and the like. Parts for a job go through record_purchase.",
  input: z.strictObject({
    category: expenseCategorySchema.meta({
      description:
        "materials (parts not tied to one job), subcontractors, tools_equipment (buying tools), equipment_rental, vehicle (fuel, repairs, tolls, parking), supplies (rags, tape, gloves, consumables), permits_licenses, insurance (liability, vehicle, bonding), phone_software, advertising, office (paperwork, postage, accounting), meals, disposal (dump fees), training (classes, certifications), bank_fees (card processing), other.",
    }),
    totalDollars: dollarsSchema("Total paid, including tax."),
    description: text(300, 'What it was, e.g. "Milwaukee M18 impact driver" or "Fuel".'),
    spentOn: z.iso.date().optional().meta({ description: "Date of the purchase (YYYY-MM-DD), if not today." }),
    supplyHouseId: entityRef("supplyHouse", "Known supply house it was bought from.").optional(),
    vendorName: optionalText(200, "Store or company name, if not a known supply house."),
    jobId: entityRef("job", "Job this was for, if any.").optional(),
    receiptAttachmentId: existingRef("attachment", "The scanned receipt image.").optional(),
  }),
});

/** Every tool, in the order they are presented to the LLM. */
export const TOOLS = [
  findClient,
  findJob,
  createClient,
  createJob,
  addMaterial,
  addNote,
  updateJobFields,
  reviseQuote,
  updateMaterial,
  removeMaterial,
  requestStatusChange,
  scheduleJob,
  flagAmbiguity,
  draftSupplyOrder,
  recordPurchase,
  createInvoice,
  recordPayment,
  recordExpense,
] as const;
