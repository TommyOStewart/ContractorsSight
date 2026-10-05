import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AUDIT_SOURCES,
  CAPTURE_STATUSES,
  CAPTURE_TYPES,
  CHANGE_SET_STATUSES,
  EXPENSE_CATEGORIES,
  INVOICE_STATUSES,
  JOB_STATUSES,
  JOB_STATUS_TRANSITIONS,
  MATERIAL_STATUSES,
  ORG_ROLES,
  PAYMENT_METHODS,
  QUOTE_LINE_KINDS,
  QUOTE_STATUSES,
  SUPPLY_INTEGRATION_TYPES,
  SUPPLY_ORDER_STATUSES,
} from "../src";

// Enums and the job state machine exist in both TypeScript and SQL. These tests keep them identical.

const migrationsDir = resolve(__dirname, "../../../supabase/migrations");
const sql = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(resolve(migrationsDir, f), "utf8"))
  .join("\n");

function sqlEnum(name: string): string[] {
  const match = new RegExp(`create type public\\.${name} as enum \\(([^)]*)\\)`).exec(sql);
  if (!match) throw new Error(`enum ${name} not found in migrations`);
  const values = [...match[1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!);
  // Later migrations extend enums with `alter type ... add value 'x' [after|before 'y']`.
  for (const m of sql.matchAll(new RegExp(`alter type public\.${name} add value '([^']+)'(?: (after|before) '([^']+)')?`, "g"))) {
    const at = m[3] ? values.indexOf(m[3]) : -1;
    if (at === -1) values.push(m[1]!);
    else values.splice(m[2] === "after" ? at + 1 : at, 0, m[1]!);
  }
  return values;
}

describe("migrations match shared enums", () => {
  it.each([
    ["job_status", JOB_STATUSES],
    ["material_status", MATERIAL_STATUSES],
    ["quote_status", QUOTE_STATUSES],
    ["quote_line_kind", QUOTE_LINE_KINDS],
    ["supply_integration_type", SUPPLY_INTEGRATION_TYPES],
    ["supply_order_status", SUPPLY_ORDER_STATUSES],
    ["capture_type", CAPTURE_TYPES],
    ["capture_status", CAPTURE_STATUSES],
    ["change_set_status", CHANGE_SET_STATUSES],
    ["audit_source", AUDIT_SOURCES],
    ["org_role", ORG_ROLES],
    ["invoice_status", INVOICE_STATUSES],
    ["payment_method", PAYMENT_METHODS],
    ["expense_category", EXPENSE_CATEGORIES],
  ] as const)("%s", (name, values) => {
    expect(sqlEnum(name)).toEqual([...values]);
  });

  it("job_status_transitions seed matches JOB_STATUS_TRANSITIONS", () => {
    const seed = /insert into public\.job_status_transitions[^;]*;/.exec(sql)?.[0];
    expect(seed).toBeDefined();
    const fromSql = [...seed!.matchAll(/\('(\w+)', '(\w+)'\)/g)].map((m) => `${m[1]}->${m[2]}`).sort();
    const fromTs = Object.entries(JOB_STATUS_TRANSITIONS)
      .flatMap(([from, tos]) => tos.map((to) => `${from}->${to}`))
      .sort();
    expect(fromSql).toEqual(fromTs);
  });
});
