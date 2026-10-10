import { afterAll, describe, expect, it } from "vitest";
import { approveChangeSet } from "../../src/commit/changeSetService";
import { createApp } from "../../src/http/app";
import { approveSharedQuote, loadSharedDocument, shareInvoice, shareQuote } from "../../src/sharing/shareService";
import { seedOrg, sql, stageChangeSet } from "./seed";

afterAll(() => sql.end());

type Org = Awaited<ReturnType<typeof seedOrg>>;

/** A new lead job for the org's client with a one-version quote; returns the job and quote IDs. */
async function leadWithQuote(org: Org) {
  const [job] = await sql<{ id: string }[]>`
    insert into jobs (org_id, client_id, title) values (${org.orgId}, ${org.clientId}, 'Tankless install') returning id`;
  const staged = await stageChangeSet(org, [
    {
      tool: "revise_quote",
      args: {
        jobId: job!.id,
        lineItems: [
          { kind: "material", description: "Tankless heater", quantity: 1, unitPriceDollars: 1800 },
          { kind: "labor", description: "Install", hours: 6, hourlyRateDollars: 125 },
        ],
      },
    },
  ]);
  const approved = await approveChangeSet(sql, { changeSetId: staged.changeSetId, userId: org.userId });
  if (!approved.ok) throw new Error(JSON.stringify(approved.issues));
  const [quote] = await sql<{ id: string }[]>`select id from quotes where job_id = ${job!.id}`;
  return { jobId: job!.id, quoteId: quote!.id };
}

describe("sending a quote", () => {
  it("marks it sent, moves a lead to quoted, and returns a stable link token", async () => {
    const org = await seedOrg();
    const { jobId, quoteId } = await leadWithQuote(org);

    const first = await shareQuote(sql, { userId: org.userId, quoteId });
    const again = await shareQuote(sql, { userId: org.userId, quoteId });
    expect(first.token).toHaveLength(43);
    expect(again.token).toBe(first.token);

    const [quote] = await sql`select status, sent_at from quotes where id = ${quoteId}`;
    expect(quote!.status).toBe("sent");
    expect(quote!.sentAt).not.toBeNull();
    const [job] = await sql`select status from jobs where id = ${jobId}`;
    expect(job!.status).toBe("quoted");

    const doc = await loadSharedDocument(sql, first.token);
    expect(doc).toMatchObject({ kind: "quote", company: "Test Plumbing", client: "Jeb Henderson", totalCents: 180000 + 75000 });
    expect(doc?.lines).toHaveLength(2);
  });

  it("refuses another company's quote", async () => {
    const owner = await seedOrg();
    const outsider = await seedOrg();
    const { quoteId } = await leadWithQuote(owner);
    await expect(shareQuote(sql, { userId: outsider.userId, quoteId })).rejects.toMatchObject({ status: 404 });
  });
});

describe("the customer approving", () => {
  it("accepts the job and the quote, audited as the customer", async () => {
    const org = await seedOrg();
    const { jobId, quoteId } = await leadWithQuote(org);
    const { token } = await shareQuote(sql, { userId: org.userId, quoteId });

    await approveSharedQuote(sql, { token, name: "Jeb Henderson" });
    await approveSharedQuote(sql, { token, name: "Jeb Henderson" }); // twice is harmless

    const [job] = await sql`select status from jobs where id = ${jobId}`;
    expect(job!.status).toBe("accepted");
    const [quote] = await sql`select status, accepted_by_name, accepted_at from quotes where id = ${quoteId}`;
    expect(quote).toMatchObject({ status: "accepted", acceptedByName: "Jeb Henderson" });

    const audits = await sql`select source, actor_user_id, entity_type from audit_events where source = 'customer' and org_id = ${org.orgId}`;
    expect(audits.map((a) => a.entityType).sort()).toEqual(["job", "quote"]);
    expect(audits.every((a) => a.actorUserId === null)).toBe(true);
  });

  it("can't approve a quote that has been replaced", async () => {
    const org = await seedOrg();
    const { jobId, quoteId } = await leadWithQuote(org);
    const { token } = await shareQuote(sql, { userId: org.userId, quoteId });

    const revision = await stageChangeSet(org, [
      { tool: "revise_quote", args: { jobId, basedOnQuoteId: quoteId, lineItems: [{ kind: "labor", description: "Install", hours: 5, hourlyRateDollars: 125 }] } },
    ]);
    expect((await approveChangeSet(sql, { changeSetId: revision.changeSetId, userId: org.userId })).ok).toBe(true);

    await expect(approveSharedQuote(sql, { token, name: "Jeb" })).rejects.toMatchObject({ status: 409 });
    expect(await loadSharedDocument(sql, token)).toMatchObject({ superseded: true });
  });
});

describe("sending an invoice", () => {
  it("returns a link showing what's still owed", async () => {
    const org = await seedOrg();
    const [invoice] = await sql<{ id: string }[]>`
      insert into invoices (org_id, job_id, number, status, total_cents) values (${org.orgId}, ${org.jobId}, 1001, 'sent', 50000) returning id`;
    await sql`insert into invoice_line_items (org_id, invoice_id, position, kind, description, quantity, unit_price_cents)
              values (${org.orgId}, ${invoice!.id}, 0, 'labor', 'Repair', 4, 12500)`;
    await sql`insert into payments (org_id, invoice_id, amount_cents, method) values (${org.orgId}, ${invoice!.id}, 20000, 'cash')`;

    const { token } = await shareInvoice(sql, { userId: org.userId, invoiceId: invoice!.id });
    expect(await loadSharedDocument(sql, token)).toMatchObject({ kind: "invoice", number: 1001, totalCents: 50000, paidCents: 20000 });
  });
});

describe("customer page over HTTP", () => {
  it("shows the quote without sign-in, approves by form post, and 404s unknown links", async () => {
    const org = await seedOrg();
    const { quoteId } = await leadWithQuote(org);
    const app = createApp({ sql, verifyUser: async (token) => (token === "good" ? org.userId : null) });

    const shared = await app.request(`/quotes/${quoteId}/share`, { method: "POST", headers: { authorization: "Bearer good", host: "worker.test" } });
    expect(shared.status).toBe(200);
    const { url } = (await shared.json()) as { url: string };
    const path = new URL(url).pathname;

    const page = await app.request(path);
    expect(page.status).toBe(200);
    expect(page.headers.get("referrer-policy")).toBe("no-referrer");
    expect(await page.text()).toContain("$2,550.00");

    const noName = await app.request(path, { method: "POST", body: new URLSearchParams({ name: "" }) });
    expect(noName.status).toBe(400);
    const approved = await app.request(path, { method: "POST", body: new URLSearchParams({ name: "Jeb Henderson" }) });
    expect(approved.status).toBe(303);
    expect(await (await app.request(path)).text()).toContain("Approved by Jeb Henderson");

    expect((await app.request(`/p/${"x".repeat(43)}`)).status).toBe(404);
  });
});
