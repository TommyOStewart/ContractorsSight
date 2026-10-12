import type { SharedDocument, SharedLine } from "./shareService";

// The page a customer opens from a texted or emailed link. Plain server-rendered HTML: no
// scripts, no tracking, readable on any phone, and laid out like a printed quote or invoice so it
// prints (or saves as a PDF) cleanly. Every value from the database is escaped.

const escape = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Escaped, with line breaks kept. */
const multiline = (value: string) => escape(value.trim()).replace(/\r?\n/g, "<br>");

const money = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** "2026-10-14" → "Oct 14, 2026" (a calendar day, so no timezone shift). */
const day = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

const qty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, ""));

/** "Net 30" from issue and due days, when the gap is a round number of days. */
const terms = (issuedOn: string, dueOn: string) => {
  const days = Math.round((Date.parse(dueOn) - Date.parse(issuedOn)) / 86_400_000);
  return days === 0 ? "Due on receipt" : `Net ${days}`;
};

/**
 * A line's first row is its name ("Copper to PEX conversion"); any rows after it are the scope of
 * work, shown underneath like a written estimate.
 */
function lineItem(l: SharedLine, n: number) {
  const [title = "", ...rest] = l.description.trim().split(/\r?\n/);
  const scope = rest.join("\n").trim();
  const amount = money(Math.round(l.quantity * l.unitPriceCents));
  const quantity = `${qty(l.quantity)}${l.unit ? ` ${escape(l.unit)}` : ""}`;
  return `<tr>
        <td class="n">${n}</td>
        <td class="desc">
          <div class="item">${escape(title)}</div>
          ${scope ? `<div class="scope">${multiline(scope)}</div>` : ""}
          <div class="calc">${quantity} × ${money(l.unitPriceCents)}</div>
        </td>
        <td class="num col">${quantity}</td>
        <td class="num col">${money(l.unitPriceCents)}</td>
        <td class="num amt">${amount}</td>
      </tr>`;
}

function itemsTable(doc: SharedDocument) {
  return `<table class="items">
    <thead><tr><th class="n">#</th><th>Description</th><th class="num col">Qty</th><th class="num col">Rate</th><th class="num">Amount</th></tr></thead>
    <tbody>${doc.lines.map((l, i) => lineItem(l, i + 1)).join("")}</tbody>
  </table>`;
}

function totals(doc: SharedDocument) {
  const rows: [string, string, string?][] = [];
  if (doc.kind === "invoice" && doc.paidCents > 0 && doc.status !== "void") {
    rows.push(["Total", money(doc.totalCents)], ["Paid", `−${money(doc.paidCents)}`], ["Balance due", money(Math.max(0, doc.totalCents - doc.paidCents)), "grand"]);
  } else {
    rows.push([doc.kind === "invoice" ? "Amount due" : "Total", money(doc.totalCents), "grand"]);
  }
  return `<div class="totals">${rows.map(([label, value, cls]) => `<div class="${cls ?? ""}"><span>${label}</span><span>${value}</span></div>`).join("")}</div>`;
}

/** Key facts in the top right: number, dates, terms. */
function facts(doc: SharedDocument) {
  const rows: [string, string][] =
    doc.kind === "quote"
      ? [
          ["Date", day(doc.quotedOn)],
          ...(doc.validUntil ? ([["Valid until", day(doc.validUntil)]] as [string, string][]) : []),
          ...(doc.version > 1 ? ([["Revision", String(doc.version)]] as [string, string][]) : []),
        ]
      : [
          ["Invoice no.", String(doc.number)],
          ["Invoice date", day(doc.issuedOn)],
          ...(doc.dueOn ? ([["Terms", terms(doc.issuedOn, doc.dueOn)], ["Due date", day(doc.dueOn)]] as [string, string][]) : []),
        ];
  return `<dl class="facts">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${escape(v)}</dd>`).join("")}</dl>`;
}

function parties(doc: SharedDocument) {
  const billTo = [doc.client, doc.clientPhone, doc.clientEmail].filter((v): v is string => !!v);
  const blocks = [
    billTo.length ? `<div><h2>${doc.kind === "quote" ? "Prepared for" : "Bill to"}</h2><p>${billTo.map(escape).join("<br>")}</p></div>` : "",
    doc.siteAddress.length ? `<div><h2>Job site</h2><p>${doc.siteAddress.map(escape).join("<br>")}</p></div>` : "",
    `<div><h2>Project</h2><p>${escape(doc.jobTitle)}</p></div>`,
  ];
  return `<section class="parties">${blocks.join("")}</section>`;
}

function companyBlock(doc: SharedDocument) {
  const contact = [
    doc.companyAddress ? multiline(doc.companyAddress) : "",
    [doc.companyPhone, doc.companyEmail].filter((v): v is string => !!v).map(escape).join("<br>"),
    doc.licenseNumber ? `License #${escape(doc.licenseNumber)}` : "",
  ].filter(Boolean);
  return `<div class="from">
      <div class="company">${escape(doc.company)}</div>
      ${contact.length ? `<p>${contact.join("<br>")}</p>` : ""}
    </div>`;
}

function quoteActions(doc: Extract<SharedDocument, { kind: "quote" }>, error: string | null, preview: boolean) {
  if (doc.acceptedAt) {
    const when = doc.acceptedAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    return `<div class="banner ok"><strong>Approved${doc.acceptedByName ? ` by ${escape(doc.acceptedByName)}` : ""} on ${when}.</strong> Thank you! ${escape(doc.company)} will be in touch to schedule.</div>`;
  }
  if (doc.superseded) return `<div class="banner">This quote has been replaced by a newer version. Please use the latest link from ${escape(doc.company)}.</div>`;
  if (doc.status === "rejected") return `<div class="banner">This quote is no longer open.</div>`;
  // In a preview the form is shown as the customer will see it, but can't be submitted.
  return `
    <form ${preview ? "" : 'method="post"'} class="approve">
      <fieldset ${preview ? "disabled" : ""}>
        <h2>Approve this quote</h2>
        <p class="fine">Type your name and tap Approve to accept this quote and its total of ${money(doc.totalCents)}.</p>
        <label for="name">Your full name</label>
        <input id="name" name="name" autocomplete="name" required maxlength="120" placeholder="Your full name">
        ${error ? `<div class="banner err">${escape(error)}</div>` : ""}
        <button type="submit">Approve quote</button>
      </fieldset>
    </form>`;
}

function invoiceStatus(doc: Extract<SharedDocument, { kind: "invoice" }>) {
  if (doc.status === "void") return `<div class="banner">This invoice was cancelled.</div>`;
  if (doc.totalCents - doc.paidCents <= 0) return `<div class="banner ok"><strong>Paid in full.</strong> Thank you!</div>`;
  return doc.dueOn ? `<p class="due-note">Please pay ${money(doc.totalCents - doc.paidCents)} by ${day(doc.dueOn)}.</p>` : "";
}

export function renderSharedPage(doc: SharedDocument, error: string | null = null, options: { preview?: boolean } = {}): string {
  const preview = !!options.preview;
  const title = doc.kind === "quote" ? "Quote" : "Invoice";
  const tabTitle = doc.kind === "quote" ? "Quote" : `Invoice #${doc.number}`;
  const reach = [doc.companyPhone, doc.companyEmail].filter((v): v is string => !!v).map(escape).join(" or ");
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${preview ? "Preview: " : ""}${escape(tabTitle)} · ${escape(doc.company)}</title>
<style>
  :root { --page:#ECEEF1; --paper:#FFFFFF; --ink:#1B1E22; --soft:#4A515B; --muted:#7A828D; --line:#E2E5E9; --band:#F5F6F8; --accent:#E8650E; --ok:#2E8B57; --err:#D0383D; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--page); color:var(--ink); font:16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif; -webkit-text-size-adjust:100%; }
  .preview-bar { background:#1B1E22; color:#fff; text-align:center; padding:10px 16px; font-size:14px; }
  .preview-bar strong { color:var(--accent); text-transform:uppercase; letter-spacing:.08em; margin-right:6px; }
  .sheet { max-width:820px; margin:24px auto; background:var(--paper); border-radius:6px; box-shadow:0 1px 3px rgba(0,0,0,.08), 0 8px 24px rgba(0,0,0,.06); overflow:hidden; }
  .sheet::before { content:""; display:block; height:6px; background:var(--accent); }
  .pad { padding:40px 48px; }
  .head { display:flex; justify-content:space-between; gap:24px; flex-wrap:wrap; }
  .company { font-size:22px; font-weight:800; letter-spacing:-.01em; }
  .from p { margin:6px 0 0; color:var(--soft); font-size:14px; }
  .doc-title { text-align:right; }
  h1 { margin:0; font-size:34px; line-height:1; font-weight:800; letter-spacing:.14em; text-transform:uppercase; color:var(--accent); }
  .facts { display:grid; grid-template-columns:auto auto; gap:2px 14px; margin:14px 0 0; font-size:14px; justify-content:end; }
  .facts dt { color:var(--muted); text-align:right; }
  .facts dd { margin:0; font-weight:600; text-align:right; }
  h2 { margin:0 0 4px; font-size:12px; font-weight:700; letter-spacing:.1em; text-transform:uppercase; color:var(--muted); }
  .parties { display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:20px; background:var(--band); border-top:1px solid var(--line); border-bottom:1px solid var(--line); padding:20px 48px; }
  .parties p { margin:0; }
  table.items { width:100%; border-collapse:collapse; }
  .items th { font-size:12px; font-weight:700; letter-spacing:.1em; text-transform:uppercase; color:var(--muted); text-align:left; padding:0 0 10px; border-bottom:2px solid var(--ink); }
  .items td { padding:16px 0; border-bottom:1px solid var(--line); vertical-align:top; }
  .items th + th, .items td + td { padding-left:16px; }
  .n { width:28px; color:var(--muted); }
  .item { font-weight:700; }
  .scope { color:var(--soft); font-size:14px; margin-top:4px; }
  .calc { display:none; color:var(--muted); font-size:14px; margin-top:4px; }
  .num { text-align:right; white-space:nowrap; }
  .amt { font-weight:600; }
  .totals { margin:20px 0 0 auto; max-width:300px; }
  .totals div { display:flex; justify-content:space-between; padding:6px 0; color:var(--soft); }
  .totals .grand { border-top:2px solid var(--ink); margin-top:4px; padding-top:12px; color:var(--ink); font-size:22px; font-weight:800; }
  .notes { margin-top:32px; padding-top:20px; border-top:1px solid var(--line); }
  .notes p { margin:0; color:var(--soft); white-space:pre-wrap; font-size:15px; }
  .action { margin-top:32px; }
  .approve fieldset { border:1px solid var(--line); border-radius:10px; padding:20px; margin:0; background:var(--band); }
  .approve h2 { font-size:14px; color:var(--ink); }
  label { display:block; font-weight:600; font-size:14px; margin:14px 0 6px; }
  input { width:100%; font:inherit; font-size:17px; padding:13px 14px; border-radius:8px; border:1px solid #C9CED5; background:#fff; color:var(--ink); }
  input:focus { outline:2px solid var(--accent); outline-offset:1px; border-color:transparent; }
  button { width:100%; margin-top:14px; font:inherit; font-weight:700; font-size:18px; padding:15px; border:0; border-radius:8px; background:var(--accent); color:#fff; cursor:pointer; }
  fieldset[disabled] button { opacity:.55; cursor:not-allowed; }
  .fine { color:var(--muted); font-size:14px; margin:0; }
  .banner { padding:14px 16px; border-radius:8px; border:1px solid var(--line); background:var(--band); }
  .banner.ok { border-color:var(--ok); background:#EEF8F2; color:#1F5F3B; }
  .banner.err { margin-top:12px; border-color:var(--err); background:#FDF0F0; color:#8F2427; }
  .due-note { margin:0; font-weight:600; }
  .foot { padding:18px 48px; border-top:1px solid var(--line); color:var(--muted); font-size:14px; text-align:center; }
  @media (max-width: 640px) {
    .sheet { margin:0; border-radius:0; box-shadow:none; }
    .pad { padding:24px 16px; }
    .parties { padding:16px; }
    .foot { padding:16px; }
    .doc-title { text-align:left; width:100%; }
    .facts { justify-content:start; }
    .facts dt, .facts dd { text-align:left; }
    .items .col, .items .n { display:none; }
    .items td.desc { padding-left:0; }
    .calc { display:block; }
  }
  @media print {
    body { background:#fff; }
    .preview-bar, .action form, .foot { display:none; }
    .sheet { margin:0; max-width:none; box-shadow:none; border-radius:0; }
    .items tr { break-inside:avoid; }
  }
</style>
</head><body>
${preview ? `<div class="preview-bar"><strong>Preview</strong> This is what your customer will see. It hasn't been sent.</div>` : ""}
<main class="sheet">
  <div class="pad head">
    ${companyBlock(doc)}
    <div class="doc-title">
      <h1>${title}</h1>
      ${facts(doc)}
    </div>
  </div>
  ${parties(doc)}
  <div class="pad">
    ${itemsTable(doc)}
    ${totals(doc)}
    ${doc.notes ? `<section class="notes"><h2>Notes &amp; terms</h2><p>${escape(doc.notes.trim())}</p></section>` : ""}
    <section class="action">${doc.kind === "quote" ? quoteActions(doc, error, preview) : invoiceStatus(doc)}</section>
  </div>
  <div class="foot">Thank you for your business. Questions? ${reach ? `Contact ${escape(doc.company)} at ${reach}, or reply` : "Reply"} to the message this link came in.</div>
</main>
</body></html>`;
}

export function renderMissingPage(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Link not found</title>
<style>body{margin:0;background:#ECEEF1;color:#1B1E22;font:17px/1.5 system-ui,sans-serif}main{max-width:560px;margin:48px auto;padding:32px 24px;background:#fff;border-radius:6px}</style></head>
<body><main><h1>This link isn't valid</h1><p>It may have been mistyped or expired. Please ask whoever sent it for a new one.</p></main></body></html>`;
}
