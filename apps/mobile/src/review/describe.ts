// Turns staged tool calls into plain-language lines for the review screen.
// `names` resolves IDs (real or temp) to labels; anything unknown falls back to "a job" etc.

type Args = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface Names {
  job: Map<string, string>;
  client: Map<string, string>;
  material: Map<string, string>;
  supplyHouse: Map<string, string>;
  site: Map<string, string>;
  invoice: Map<string, string>;
}

export interface Described {
  title: string;
  details: string[];
  /** Questions for the contractor rather than changes. */
  isQuestion?: boolean;
}

const STATUS_LABEL: Record<string, string> = {
  lead: 'Lead',
  quoted: 'Quoted',
  accepted: 'Accepted',
  scheduled: 'Scheduled',
  in_progress: 'In progress',
  completed: 'Completed',
  invoiced: 'Invoiced',
  paid: 'Paid',
  declined: 'Declined',
  cancelled: 'Cancelled',
};

const EXPENSE_LABEL: Record<string, string> = {
  materials: 'Materials',
  tools_equipment: 'Tools & equipment',
  vehicle: 'Vehicle',
  supplies: 'Shop supplies',
  phone_software: 'Phone & software',
  other: 'Other',
};

const money = (dollars: number | undefined) =>
  dollars === undefined ? undefined : `$${dollars.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const qty = (n: number, unit?: string) => `${n}${unit ? ` ${unit}` : ''}`;
const when = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const address = (a?: Args) => (a ? [a.line1, a.line2, a.city, a.region, a.postalCode].filter(Boolean).join(', ') : undefined);
const compact = (xs: (string | undefined | false)[]) => xs.filter((x): x is string => !!x);

/** Collects labels for temp IDs created within the same change set ("$c1" → "Tom Baker"). */
export function addTempNames(operations: { tool: string; args: Args }[], names: Names) {
  for (const { tool, args } of operations) {
    if (!args.tempId) continue;
    if (tool === 'create_client') names.client.set(args.tempId, `${args.name} (new)`);
    if (tool === 'create_job') names.job.set(args.tempId, `${args.title} (new)`);
    if (tool === 'add_material') names.material.set(args.tempId, `${args.description} (new)`);
    if (tool === 'create_invoice') names.invoice.set(args.tempId, 'On the new invoice');
  }
}

export function describeOperation(tool: string, args: Args, names: Names): Described {
  const job = (id?: string) => (id ? names.job.get(id) ?? 'a job' : 'a job');
  const client = (id?: string) => (id ? names.client.get(id) ?? 'a client' : 'a client');
  const material = (id?: string) => (id ? names.material.get(id) ?? 'a material' : 'a material');
  const supplier = (id?: string) => (id ? names.supplyHouse.get(id) : undefined);

  switch (tool) {
    case 'create_client':
      return { title: `New client: ${args.name}`, details: compact([args.phone, args.email, address(args.siteAddress), args.notes]) };
    case 'create_job':
      return {
        title: `New job: ${args.title}`,
        details: compact([
          `For ${client(args.clientId)}`,
          args.siteAddress ? `At ${address(args.siteAddress)}` : args.siteId && `At ${names.site.get(args.siteId) ?? 'an existing site'}`,
          args.jobType && `Type: ${args.jobType}`,
          args.description,
        ]),
      };
    case 'add_material':
      return {
        title: `Add ${qty(args.quantity, args.unit)} × ${args.description}`,
        details: compact([`To ${job(args.jobId)}`, money(args.unitCostDollars) && `${money(args.unitCostDollars)} each`, supplier(args.supplyHouseId) && `From ${supplier(args.supplyHouseId)}`]),
      };
    case 'add_note':
      return { title: `Note on ${args.jobId ? job(args.jobId) : client(args.clientId)}`, details: [`“${args.body}”`] };
    case 'update_job_fields': {
      const c = args.changes ?? {};
      return {
        title: `Update ${job(args.jobId)}`,
        details: compact([
          c.title && `Title → ${c.title}`,
          c.jobType && `Type → ${c.jobType}`,
          c.description && `Description → ${c.description}`,
          c.siteId && `Site → ${names.site.get(c.siteId) ?? 'another site'}`,
        ]),
      };
    }
    case 'revise_quote': {
      const lines: Args[] = args.lineItems ?? [];
      const total = lines.reduce((s, l) => s + (l.kind === 'labor' ? l.hours * l.hourlyRateDollars : l.quantity * l.unitPriceDollars), 0);
      return {
        title: `${args.basedOnQuoteId ? 'Revise' : 'New'} quote for ${job(args.jobId)}: ${money(total)}`,
        details: [
          ...lines.map((l) =>
            l.kind === 'labor'
              ? `Labor: ${l.description}, ${l.hours} h × ${money(l.hourlyRateDollars)}`
              : `${l.description}: ${qty(l.quantity, l.unit)} × ${money(l.unitPriceDollars)}`,
          ),
          ...compact([args.validUntil && `Valid until ${args.validUntil}`, args.notes]),
        ],
      };
    }
    case 'update_material': {
      const c = args.changes ?? {};
      return {
        title: `Change ${material(args.materialId)}`,
        details: compact([
          c.description && `Description → ${c.description}`,
          c.quantity !== undefined && `Quantity → ${qty(c.quantity, c.unit)}`,
          c.unitCostDollars !== undefined && `Cost → ${money(c.unitCostDollars)} each`,
          c.supplyHouseId && `Supplier → ${supplier(c.supplyHouseId) ?? 'a supply house'}`,
          c.status && `Status → ${c.status}`,
        ]),
      };
    }
    case 'remove_material':
      return { title: `Remove ${material(args.materialId)}`, details: compact([args.reason]) };
    case 'request_status_change':
      return { title: `${job(args.jobId)} → ${STATUS_LABEL[args.toStatus] ?? args.toStatus}`, details: compact([args.reason]) };
    case 'schedule_job':
      return { title: `Schedule ${job(args.jobId)}`, details: [args.end ? `${when(args.start)} – ${when(args.end)}` : when(args.start)] };
    case 'flag_ambiguity':
      return {
        title: args.question,
        details: compact([args.sourceExcerpt && `From: “${args.sourceExcerpt}”`, ...(args.candidates ?? []).map((c: Args) => `• ${c.label}`)]),
        isQuestion: true,
      };
    case 'draft_supply_order':
      return {
        title: `Draft order to ${supplier(args.supplyHouseId) ?? 'a supply house'}`,
        details: compact([args.jobId && `For ${job(args.jobId)}`, ...(args.lines ?? []).map((l: Args) => `${qty(l.quantity, l.unit)} × ${l.description}${l.sku ? ` (${l.sku})` : ''}`), args.notes, 'Not sent: you send it separately.']),
      };
    case 'record_purchase':
      return {
        title: `Purchase from ${supplier(args.supplyHouseId) ?? args.vendorName ?? 'a store'}${args.totalDollars !== undefined ? `: ${money(args.totalDollars)}` : ''}`,
        details: compact([
          `For ${job(args.jobId)}`,
          args.purchasedOn && `On ${args.purchasedOn}`,
          ...(args.lines ?? []).map((l: Args) => `${qty(l.quantity, l.unit)} × ${l.description}${l.unitCostDollars !== undefined ? ` @ ${money(l.unitCostDollars)}` : ''}`),
        ]),
      };
    case 'create_invoice': {
      const lines: Args[] | undefined = args.lineItems;
      const total = lines?.reduce((s, l) => s + (l.kind === 'labor' ? l.hours * l.hourlyRateDollars : l.quantity * l.unitPriceDollars), 0);
      return {
        title: `Send invoice${total !== undefined ? ` for ${money(total)}` : ''}`,
        details: compact([
          `For ${job(args.jobId)}`,
          lines ? `${lines.length} line${lines.length === 1 ? '' : 's'}` : 'Bills the latest quote as it stands',
          args.dueInDays !== undefined && `Due in ${args.dueInDays} days`,
          args.notes,
        ]),
      };
    }
    case 'record_payment':
      return {
        title: `Payment received: ${money(args.amountDollars)}`,
        details: compact([
          names.invoice.get(args.invoiceId) ?? 'On an invoice',
          args.method && `By ${args.method}${args.reference ? ` #${args.reference}` : ''}`,
          args.paidOn && `On ${args.paidOn}`,
        ]),
      };
    case 'record_expense':
      return {
        title: `Expense: ${args.description} · ${money(args.totalDollars)}`,
        details: compact([
          EXPENSE_LABEL[args.category] ?? args.category,
          supplier(args.supplyHouseId) ?? args.vendorName,
          args.spentOn && `On ${args.spentOn}`,
          args.jobId && `For ${job(args.jobId)}`,
        ]),
      };
    default:
      return { title: tool, details: [JSON.stringify(args)] };
  }
}

/** Every real (non-temp) ID an operation refers to, by kind, so the screen can fetch labels. */
export function referencedIds(operations: { args: Args }[]) {
  const ids = { job: new Set<string>(), client: new Set<string>(), material: new Set<string>(), supplyHouse: new Set<string>(), site: new Set<string>(), invoice: new Set<string>() };
  const visit = (value: unknown, key?: string) => {
    if (Array.isArray(value)) return value.forEach((v) => visit(v));
    if (value && typeof value === 'object') return Object.entries(value).forEach(([k, v]) => visit(v, k));
    if (typeof value !== 'string' || value.startsWith('$')) return;
    if (key === 'jobId') ids.job.add(value);
    if (key === 'clientId') ids.client.add(value);
    if (key === 'materialId') ids.material.add(value);
    if (key === 'supplyHouseId') ids.supplyHouse.add(value);
    if (key === 'siteId') ids.site.add(value);
    if (key === 'invoiceId') ids.invoice.add(value);
  };
  operations.forEach((op) => visit(op.args));
  return ids;
}
