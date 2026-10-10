import type { SharedDocument } from "./shareService";

// The page a customer opens from a texted or emailed link. Plain server-rendered HTML: no
// scripts, no tracking, readable on any phone. Every value from the database is escaped.

const escape = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const money = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** "2026-10-14" → "Oct 14, 2026" (a calendar day, so no timezone shift). */
const day = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

const qty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, ""));

function linesTable(doc: SharedDocument) {
  const rows = doc.lines
    .map(
      (l) => `<tr>
        <td>${escape(l.description)}<div class="sub">${qty(l.quantity)}${l.unit ? ` ${escape(l.unit)}` : ""} × ${money(l.unitPriceCents)}</div></td>
        <td class="num">${money(Math.round(l.quantity * l.unitPriceCents))}</td>
      </tr>`,
    )
    .join("");
  return `<table>${rows}<tr class="total"><td>Total</td><td class="num">${money(doc.totalCents)}</td></tr></table>`;
}

function quoteActions(doc: Extract<SharedDocument, { kind: "quote" }>, error: string | null) {
  if (doc.acceptedAt) {
    const when = doc.acceptedAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    return `<div class="banner ok">Approved${doc.acceptedByName ? ` by ${escape(doc.acceptedByName)}` : ""} on ${when}. Thank you! ${escape(doc.company)} will be in touch to schedule.</div>`;
  }
  if (doc.superseded) return `<div class="banner">This quote has been replaced by a newer version. Please use the latest link from ${escape(doc.company)}.</div>`;
  if (doc.status === "rejected") return `<div class="banner">This quote is no longer open.</div>`;
  return `
    <form method="post">
      <label for="name">Your name</label>
      <input id="name" name="name" autocomplete="name" required maxlength="120" placeholder="Type your full name">
      <p class="fine">By tapping Approve you accept this quote and its total of ${money(doc.totalCents)}.</p>
      ${error ? `<div class="banner err">${escape(error)}</div>` : ""}
      <button type="submit">Approve quote</button>
    </form>`;
}

function invoiceSummary(doc: Extract<SharedDocument, { kind: "invoice" }>) {
  const owed = Math.max(0, doc.totalCents - doc.paidCents);
  if (doc.status === "void") return `<div class="banner">This invoice was cancelled.</div>`;
  if (owed === 0) return `<div class="banner ok">Paid in full. Thank you!</div>`;
  return `<div class="due">
      ${doc.paidCents > 0 ? `<div>Paid so far <span>${money(doc.paidCents)}</span></div>` : ""}
      <div class="owed">Amount due <span>${money(owed)}</span></div>
      ${doc.dueOn ? `<div class="fine">Due by ${day(doc.dueOn)}</div>` : ""}
    </div>`;
}

export function renderSharedPage(doc: SharedDocument, error: string | null = null): string {
  const heading = doc.kind === "quote" ? "Quote" : `Invoice #${doc.number}`;
  const meta =
    doc.kind === "quote"
      ? doc.validUntil
        ? `Valid until ${day(doc.validUntil)}`
        : ""
      : `Issued ${day(doc.issuedOn)}`;
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escape(heading)} · ${escape(doc.company)}</title>
<style>
  :root { --bg:#16181B; --card:#22262B; --line:#3A3F46; --text:#F2EEE6; --soft:#C9C2B4; --muted:#8A8F98; --accent:#E8650E; --ok:#3FAE6A; --err:#E5484D; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:17px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width:560px; margin:0 auto; padding:24px 16px 48px; }
  .company { color:var(--accent); font-weight:800; letter-spacing:.12em; text-transform:uppercase; font-size:14px; }
  h1 { margin:6px 0 2px; font-size:30px; text-transform:uppercase; letter-spacing:.02em; }
  .meta, .sub, .fine { color:var(--muted); font-size:14px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:16px; margin-top:16px; }
  table { width:100%; border-collapse:collapse; }
  td { padding:10px 0; border-bottom:1px solid var(--line); vertical-align:top; }
  .num { text-align:right; white-space:nowrap; padding-left:12px; }
  tr.total td { border-bottom:0; font-weight:800; font-size:20px; padding-top:14px; }
  .notes { white-space:pre-wrap; color:var(--soft); }
  label { display:block; font-weight:600; margin-bottom:6px; }
  input { width:100%; font:inherit; padding:14px; border-radius:12px; border:2px solid var(--line); background:var(--bg); color:var(--text); }
  button { width:100%; margin-top:12px; font:inherit; font-weight:800; font-size:19px; padding:16px; border:0; border-radius:14px; background:var(--accent); color:#16181B; }
  .banner { margin-top:16px; padding:14px; border-radius:12px; border:1px solid var(--line); background:var(--card); }
  .banner.ok { border-color:var(--ok); }
  .banner.err { border-color:var(--err); }
  .due div { display:flex; justify-content:space-between; }
  .owed { font-weight:800; font-size:20px; }
</style>
</head><body><main>
  <div class="company">${escape(doc.company)}</div>
  <h1>${escape(heading)}</h1>
  <div class="meta">${[doc.client, doc.jobTitle, doc.address].filter(Boolean).map((v) => escape(v!)).join(" · ")}${meta ? `<br>${meta}` : ""}</div>
  <div class="card">${linesTable(doc)}</div>
  ${doc.notes ? `<div class="card notes">${escape(doc.notes)}</div>` : ""}
  <div class="card">${doc.kind === "quote" ? quoteActions(doc, error) : invoiceSummary(doc)}</div>
  <p class="fine">Questions? Reply to the message this link came in.</p>
</main></body></html>`;
}

export function renderMissingPage(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Link not found</title>
<style>body{margin:0;background:#16181B;color:#F2EEE6;font:17px/1.45 system-ui,sans-serif}main{max-width:560px;margin:0 auto;padding:48px 16px}</style></head>
<body><main><h1>This link isn't valid</h1><p>It may have been mistyped. Please ask whoever sent it for a new one.</p></main></body></html>`;
}
