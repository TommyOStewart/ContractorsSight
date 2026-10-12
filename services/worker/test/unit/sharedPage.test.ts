import { describe, expect, it } from "vitest";
import { renderSharedPage } from "../../src/sharing/page";
import { previewToken, readPreviewToken } from "../../src/sharing/previewLink";
import type { SharedDocument } from "../../src/sharing/shareService";

const quote: SharedDocument = {
  kind: "quote",
  company: "Stewart Plumbing",
  companyPhone: "(774) 392-0103",
  companyEmail: "office@stewartplumbing.test",
  companyAddress: "37 Nancy Ave\nEast Falmouth, MA 02536",
  licenseNumber: "PL-12345",
  client: "Maria <script>alert(1)</script>",
  clientPhone: null,
  clientEmail: "maria@example.test",
  jobTitle: "Replace water heater",
  siteAddress: ["412 Oak St", "Springfield, IL 62701"],
  lines: [
    { description: "50gal heater", quantity: 1, unit: null, unitPriceCents: 115000 },
    { description: "Labor", quantity: 4, unit: "hr", unitPriceCents: 12500 },
  ],
  totalCents: 165000,
  notes: null,
  version: 1,
  status: "sent",
  quotedOn: "2026-10-10",
  superseded: false,
  validUntil: "2026-11-09",
  acceptedAt: null,
  acceptedByName: null,
};

const invoice: SharedDocument = {
  kind: "invoice",
  company: "Stewart Plumbing",
  companyPhone: null,
  companyEmail: null,
  companyAddress: null,
  licenseNumber: null,
  client: "Kim Park",
  clientPhone: null,
  clientEmail: null,
  jobTitle: "Sump pump",
  siteAddress: [],
  lines: [{ description: "Sump pump install", quantity: 1, unit: null, unitPriceCents: 60000 }],
  totalCents: 60000,
  notes: null,
  number: 1001,
  status: "sent",
  issuedOn: "2026-10-01",
  dueOn: "2026-10-31",
  paidCents: 20000,
};

describe("renderSharedPage", () => {
  it("escapes everything that came from the database", () => {
    const html = renderSharedPage(quote);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("Maria &lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("heads the page with the company's contact details, the customer and the job site", () => {
    const html = renderSharedPage(quote);
    expect(html).toContain("37 Nancy Ave<br>East Falmouth, MA 02536");
    expect(html).toContain("(774) 392-0103<br>office@stewartplumbing.test");
    expect(html).toContain("License #PL-12345");
    expect(html).toContain("maria@example.test");
    expect(html).toContain("412 Oak St<br>Springfield, IL 62701");
  });

  it("shows lines, the total, the dates, and an approve form for an open quote", () => {
    const html = renderSharedPage(quote);
    expect(html).toContain("$1,650.00");
    expect(html).toContain("4 hr × $125.00");
    expect(html).toContain("<dt>Valid until</dt><dd>Nov 9, 2026</dd>");
    expect(html).toContain("<dt>Date</dt><dd>Oct 10, 2026</dd>");
    expect(html).toContain('<form method="post"');
  });

  it("shows a line's first row as its name and the rest as its scope of work", () => {
    const html = renderSharedPage({
      ...quote,
      lines: [{ description: "Copper to PEX conversion\n- Remove accessible copper\n- Insulate outside walls", quantity: 1, unit: null, unitPriceCents: 380000 }],
    });
    expect(html).toContain('<div class="item">Copper to PEX conversion</div>');
    expect(html).toContain('<div class="scope">- Remove accessible copper<br>- Insulate outside walls</div>');
  });

  it("has no approve form once approved or replaced", () => {
    expect(renderSharedPage({ ...quote, status: "accepted", acceptedAt: new Date("2026-10-10T15:00:00Z"), acceptedByName: "Maria D" })).toContain(
      "Approved by Maria D",
    );
    expect(renderSharedPage({ ...quote, superseded: true })).not.toContain("<form");
  });

  it("marks a preview and makes its approve form unsubmittable", () => {
    const html = renderSharedPage(quote, null, { preview: true });
    expect(html).toContain("It hasn't been sent.");
    expect(html).not.toContain('method="post"');
    expect(html).toContain("<fieldset disabled>");
    expect(renderSharedPage(quote)).not.toContain("hasn't been sent");
  });

  it("shows the invoice number, terms, and what's still owed", () => {
    const html = renderSharedPage(invoice);
    expect(html).toContain("<dt>Invoice no.</dt><dd>1001</dd>");
    expect(html).toContain("<dt>Terms</dt><dd>Net 30</dd>");
    expect(html).toContain("<span>Balance due</span><span>$400.00</span>");
    expect(html).toContain("Please pay $400.00 by Oct 31, 2026.");
  });
});

describe("preview links", () => {
  const secret = Buffer.alloc(32, 7);
  const doc = { kind: "quote" as const, id: "4b1f7c1e-2f43-4d55-9d6a-0c5a3f8e9b10" };

  it("name the document they were made for until they expire", () => {
    const token = previewToken(secret, doc, 0);
    expect(readPreviewToken(secret, token, 29 * 60_000)).toEqual(doc);
    expect(readPreviewToken(secret, token, 31 * 60_000)).toBeNull();
  });

  it("can't be forged or pointed at another document", () => {
    const token = previewToken(secret, doc, 0);
    expect(readPreviewToken(Buffer.alloc(32, 8), token, 0)).toBeNull();
    expect(readPreviewToken(secret, token.replace(doc.id, "00000000-0000-0000-0000-000000000000"), 0)).toBeNull();
    expect(readPreviewToken(secret, token.replace(/^q/, "i"), 0)).toBeNull();
  });
});
