import { afterAll, describe, expect, it } from "vitest";
import { approveChangeSet } from "../../src/commit/changeSetService";
import { jobVersion, seedOrg, sql, stageChangeSet, type Org } from "./seed";

afterAll(() => sql.end());

/** Stage + approve with the job's current version; fails the test if validation rejects it. */
async function commit(org: Org, operations: { tool: string; args: unknown }[]) {
  const { changeSetId } = await stageChangeSet(org, operations, { [org.jobId]: await jobVersion(org.jobId) });
  const result = await approveChangeSet(sql, { changeSetId, userId: org.userId });
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result;
}

const QUOTE = {
  tool: "revise_quote",
  args: {
    lineItems: [
      { kind: "labor", description: "Install", hours: 4, hourlyRateDollars: 125 },
      { kind: "material", description: "50 gal heater", quantity: 1, unitPriceDollars: 1150 },
    ],
  },
};

async function completeJob(jobId: string) {
  await sql`update jobs set status = 'scheduled', scheduled_start = now() where id = ${jobId}`;
  await sql`update jobs set status = 'in_progress' where id = ${jobId}`;
  await sql`update jobs set status = 'completed' where id = ${jobId}`;
}

describe("invoices and payments", () => {
  it("bills the latest quote as-is, numbered from #1001", async () => {
    const org = await seedOrg();
    await commit(org, [{ ...QUOTE, args: { ...QUOTE.args, jobId: org.jobId } }]);
    const result = await commit(org, [{ tool: "create_invoice", args: { tempId: "$i1", jobId: org.jobId, dueInDays: 30 } }]);

    const [invoice] = await sql`select number, status, total_cents, due_on, issued_on from invoices where id = ${result.tempIdMap.$i1!}`;
    expect(invoice).toMatchObject({ number: 1001, status: "sent", totalCents: "165000" });
    const lines = await sql`select kind, description, unit_price_cents from invoice_line_items where invoice_id = ${result.tempIdMap.$i1!} order by position`;
    expect(lines.map((l) => l.description)).toEqual(["Install", "50 gal heater"]);
    const [job] = await sql`select status from jobs where id = ${org.jobId}`;
    expect(job!.status).toBe("accepted"); // a deposit-stage invoice doesn't move the job

    const second = await commit(org, [{ tool: "create_invoice", args: { tempId: "$i2", jobId: org.jobId, lineItems: [{ kind: "labor", description: "Extra hour", hours: 1, hourlyRateDollars: 125 }] } }]);
    const [next] = await sql`select number, total_cents from invoices where id = ${second.tempIdMap.$i2!}`;
    expect(next).toMatchObject({ number: 1002, totalCents: "12500" });
  });

  it("walks a finished job to invoiced, then paid once the money is all in", async () => {
    const org = await seedOrg();
    await commit(org, [{ ...QUOTE, args: { ...QUOTE.args, jobId: org.jobId } }]);
    await completeJob(org.jobId);

    const billed = await commit(org, [{ tool: "create_invoice", args: { tempId: "$i1", jobId: org.jobId } }]);
    const invoiceId = billed.tempIdMap.$i1!;
    expect((await sql`select status from jobs where id = ${org.jobId}`)[0]!.status).toBe("invoiced");

    await commit(org, [{ tool: "record_payment", args: { invoiceId, amountDollars: 650, method: "check", reference: "1042" } }]);
    expect((await sql`select status from invoices where id = ${invoiceId}`)[0]!.status).toBe("sent");
    expect((await sql`select status from jobs where id = ${org.jobId}`)[0]!.status).toBe("invoiced");

    await commit(org, [{ tool: "record_payment", args: { invoiceId, amountDollars: 1000, method: "transfer" } }]);
    expect((await sql`select status from invoices where id = ${invoiceId}`)[0]!.status).toBe("paid");
    expect((await sql`select status from jobs where id = ${org.jobId}`)[0]!.status).toBe("paid");

    const payments = await sql`select amount_cents, method, reference from payments where invoice_id = ${invoiceId} order by created_at`;
    expect(payments).toMatchObject([
      { amountCents: "65000", method: "check", reference: "1042" },
      { amountCents: "100000", method: "transfer" },
    ]);
  });

  it("refuses an overpayment at approval time", async () => {
    const org = await seedOrg();
    await commit(org, [{ ...QUOTE, args: { ...QUOTE.args, jobId: org.jobId } }]);
    const billed = await commit(org, [{ tool: "create_invoice", args: { tempId: "$i1", jobId: org.jobId } }]);
    const { changeSetId } = await stageChangeSet(org, [{ tool: "record_payment", args: { invoiceId: billed.tempIdMap.$i1!, amountDollars: 2000 } }], {
      [org.jobId]: await jobVersion(org.jobId),
    });
    const result = await approveChangeSet(sql, { changeSetId, userId: org.userId });
    expect(result.ok).toBe(false);
  });
});

describe("expenses", () => {
  it("logs a receipt as a materials expense and links its parts", async () => {
    const org = await seedOrg();
    await commit(org, [
      {
        tool: "record_purchase",
        args: {
          jobId: org.jobId,
          vendorName: "Ferguson",
          purchasedOn: "2026-10-03",
          totalDollars: 126.42,
          lines: [
            { description: "PEX coil", quantity: 1, unitCostDollars: 54.2 },
            { description: "SharkBite coupling", quantity: 4, unitCostDollars: 6.89 },
          ],
        },
      },
    ]);
    const [expense] = await sql`select id, category, total_cents, vendor_name, spent_on, job_id from expenses where org_id = ${org.orgId}`;
    expect(expense).toMatchObject({ category: "materials", totalCents: "12642", vendorName: "Ferguson", jobId: org.jobId });
    const parts = await sql`select description, status from material_items where expense_id = ${expense!.id} order by description`;
    expect(parts.map((p) => p.description)).toEqual(["PEX coil", "SharkBite coupling"]);
    expect((await sql`select 1 from notes where job_id = ${org.jobId}`).length).toBe(0); // no more receipt notes
  });

  it("logs a general business expense", async () => {
    const org = await seedOrg();
    await commit(org, [{ tool: "record_expense", args: { category: "tools_equipment", totalDollars: 189, description: "Impact driver", vendorName: "Home Depot", spentOn: "2026-10-02" } }]);
    const [expense] = await sql`select category, total_cents, description, job_id from expenses where org_id = ${org.orgId}`;
    expect(expense).toMatchObject({ category: "tools_equipment", totalCents: "18900", description: "Impact driver", jobId: null });
  });
});

describe("dashboard_summary", () => {
  /** Calls the function as a signed-in user, through row-level security. */
  async function summaryAs(userId: string, orgId: string) {
    return sql.begin(async (tx) => {
      await tx`select set_config('role', 'authenticated', true)`;
      await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: "authenticated" })}, true)`;
      const [row] = await tx<{ summary: Record<string, any> }[]>`select public.dashboard_summary(${orgId}) as summary`; // eslint-disable-line @typescript-eslint/no-explicit-any
      return row!.summary;
    });
  }

  it("adds up payments, money owed, expenses, and profit by job type", async () => {
    const org = await seedOrg();
    await sql`update jobs set job_type = 'water heater replacement' where id = ${org.jobId}`;
    await commit(org, [{ ...QUOTE, args: { ...QUOTE.args, jobId: org.jobId } }]);
    const billed = await commit(org, [{ tool: "create_invoice", args: { tempId: "$i1", jobId: org.jobId } }]);
    await commit(org, [{ tool: "record_payment", args: { invoiceId: billed.tempIdMap.$i1!, amountDollars: 1000 } }]);
    await commit(org, [
      { tool: "record_purchase", args: { jobId: org.jobId, vendorName: "Ferguson", totalDollars: 300, lines: [{ description: "Heater", quantity: 1, unitCostDollars: 300 }] } },
      { tool: "record_expense", args: { category: "vehicle", totalDollars: 60, description: "Fuel" } },
    ]);

    const s = await summaryAs(org.userId, org.orgId);
    expect(s.paidByMonth).toHaveLength(12);
    expect(s.paidByMonth.at(-1).cents).toBe(100000);
    expect(s.owed).toMatchObject({ cents: 65000, invoices: 1 });
    expect(s.expensesTotal).toMatchObject({ cents: 36000, count: 2 });
    expect(s.expensesByCategory.map((e: { category: string }) => e.category).sort()).toEqual(["materials", "vehicle"]);
    expect(s.materialsBySupplier).toEqual([{ name: "Ferguson", cents: 30000 }]);
    expect(s.profitByJobType).toMatchObject([{ jobType: "water heater replacement", paidCents: 100000, materialCents: 30000, profitCents: 70000 }]);
    expect(s.missingReceipts).toBe(2);
  });

  it("shows another company's user nothing", async () => {
    const org = await seedOrg();
    const outsider = await seedOrg();
    await commit(org, [{ tool: "record_expense", args: { category: "vehicle", totalDollars: 60, description: "Fuel" } }]);
    const s = await summaryAs(outsider.userId, org.orgId);
    expect(s.expensesTotal).toMatchObject({ cents: 0, count: 0 });
    expect(s.jobsByStatus).toEqual({});
  });
});
