import { randomUUID } from "node:crypto";
import { createSql, type Sql } from "../../src/db/sql";

/** Local Supabase by default; CI starts the same stack with `supabase db start`. */
export const sql: Sql = createSql(process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres");

export interface Org {
  orgId: string;
  userId: string;
  clientId: string;
  jobId: string;
}

/** A fresh org with one owner, one client, and one `accepted` job. Random IDs keep tests independent. */
export async function seedOrg(): Promise<Org> {
  const userId = randomUUID();
  const orgId = randomUUID();
  const clientId = randomUUID();
  const jobId = randomUUID();
  await sql`insert into auth.users (id, email) values (${userId}, ${`${userId}@example.test`})`;
  await sql`insert into organizations (id, name) values (${orgId}, 'Test Plumbing')`;
  await sql`insert into org_members (org_id, user_id, role) values (${orgId}, ${userId}, 'owner')`;
  await sql`insert into clients (id, org_id, name) values (${clientId}, ${orgId}, 'Jeb Henderson')`;
  await sql`insert into jobs (id, org_id, client_id, title) values (${jobId}, ${orgId}, ${clientId}, 'Leaky water heater')`;
  // lead → quoted → accepted (the trigger enforces legal steps)
  await sql`update jobs set status = 'quoted' where id = ${jobId}`;
  await sql`update jobs set status = 'accepted' where id = ${jobId}`;
  return { orgId, userId, clientId, jobId };
}

export async function jobVersion(jobId: string): Promise<number> {
  const [row] = await sql<{ version: number }[]>`select version from jobs where id = ${jobId}`;
  return row!.version;
}

/** Inserts a text capture and a pending ChangeSet, as the pipeline would. */
export async function stageChangeSet(
  org: Org,
  operations: { tool: string; args: unknown }[],
  baseJobVersions: Record<string, number> = {},
): Promise<{ changeSetId: string; captureId: string }> {
  const [capture] = await sql<{ id: string }[]>`
    insert into captures (org_id, created_by, type, raw_text, status)
    values (${org.orgId}, ${org.userId}, 'text', 'typed note', 'ready_for_review') returning id`;
  const [changeSet] = await sql<{ id: string }[]>`
    insert into change_sets (org_id, capture_id, operations, base_job_versions)
    values (${org.orgId}, ${capture!.id}, ${sql.json(operations as never)}, ${sql.json(baseJobVersions)}) returning id`;
  return { changeSetId: changeSet!.id, captureId: capture!.id };
}
