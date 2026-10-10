import { describe, expect, it } from "vitest";
import { renderSharedPage } from "../../src/sharing/page";
import type { SharedDocument } from "../../src/sharing/shareService";

const quote: SharedDocument = {
  kind: "quote",
  company: "Stewart Plumbing",
  client: "Maria <script>alert(1)</script>",
  jobTitle: "Replace water heater",
  address: "412 Oak St, Springfield",
  lines: [
    { description: "50gal heater", quantity: 1, unit: null, unitPriceCents: 115000 },
    { description: "Labor", quantity: 4, unit: "hr", unitPriceCents: 12500 },
  ],
  totalCents: 165000,
  notes: null,
  version: 1,
  status: "sent",
  superseded: false,
  validUntil: "2026-11-09",
  acceptedAt: null,
  acceptedByName: null,
};

describe("renderSharedPage", () => {
  it("escapes everything that came from the database", () => {
    const html = renderSharedPage(quote);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("Maria &lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("shows lines, the total, the valid-until day, and an approve form for an open quote", () => {
    const html = renderSharedPage(quote);
    expect(html).toContain("$1,650.00");
    expect(html).toContain("4 hr × $125.00");
    expect(html).toContain("Valid until Nov 9, 2026");
    expect(html).toContain('<form method="post">');
  });

  it("has no approve form once approved or replaced", () => {
    expect(renderSharedPage({ ...quote, status: "accepted", acceptedAt: new Date("2026-10-10T15:00:00Z"), acceptedByName: "Maria D" })).toContain(
      "Approved by Maria D",
    );
    expect(renderSharedPage({ ...quote, superseded: true })).not.toContain("<form");
  });

  it("shows what's still owed on an invoice", () => {
    const html = renderSharedPage({
      kind: "invoice",
      company: "Stewart Plumbing",
      client: "Kim Park",
      jobTitle: "Sump pump",
      address: null,
      lines: [{ description: "Sump pump install", quantity: 1, unit: null, unitPriceCents: 60000 }],
      totalCents: 60000,
      notes: null,
      number: 1001,
      status: "sent",
      issuedOn: "2026-10-10",
      dueOn: "2026-10-25",
      paidCents: 20000,
    });
    expect(html).toContain("Invoice #1001");
    expect(html).toContain("Amount due <span>$400.00</span>");
    expect(html).toContain("Due by Oct 25, 2026");
  });
});
