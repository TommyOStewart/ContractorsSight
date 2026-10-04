import { Hono } from "hono";
import { z } from "zod";
import { createTextCapture, type CaptureDeps } from "../capture/captureService";
import { approveChangeSet, ChangeSetError, rejectChangeSet } from "../commit/changeSetService";
import type { Sql } from "../db/sql";

/** Resolves a bearer token to a user ID, or null if the token is missing, invalid, or expired. */
export type VerifyUser = (accessToken: string) => Promise<string | null>;

export interface AppDeps {
  sql: Sql;
  verifyUser: VerifyUser;
  /** Planner wiring; captures are disabled (503) without it. */
  capture?: Omit<CaptureDeps, "sql">;
}

type Env = { Variables: { userId: string } };

const uuid = z.uuid();

/**
 * The worker's HTTP API. Every route requires the user's Supabase access token; the worker then
 * acts with database-level access, so each handler checks org membership itself.
 */
export function createApp({ sql, verifyUser, capture }: AppDeps) {
  const app = new Hono<Env>();

  app.get("/health", (c) => c.json({ ok: true }));

  app.use("*", async (c, next) => {
    if (c.req.path === "/health") return next();
    const token = c.req.header("authorization")?.match(/^Bearer (.+)$/i)?.[1];
    const userId = token ? await verifyUser(token) : null;
    if (!userId) return c.json({ error: "Not signed in." }, 401);
    c.set("userId", userId);
    await next();
  });

  const captureBody = z.object({
    orgId: uuid,
    text: z.string().trim().min(1).max(20_000),
    targetJobId: uuid.optional(),
  });

  app.post("/captures", async (c) => {
    if (!capture) return c.json({ error: "Captures aren't configured on this worker." }, 503);
    const body = captureBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "Invalid capture." }, 400);
    const result = await createTextCapture({ sql, ...capture }, { userId: c.get("userId"), ...body.data });
    return c.json(result, 201);
  });

  app.post("/change-sets/:id/approve", async (c) => {
    const id = uuid.safeParse(c.req.param("id"));
    if (!id.success) return c.json({ error: "Change set not found." }, 404);
    const result = await approveChangeSet(sql, { changeSetId: id.data, userId: c.get("userId") });
    return result.ok ? c.json(result) : c.json(result, 409);
  });

  app.post("/change-sets/:id/reject", async (c) => {
    const id = uuid.safeParse(c.req.param("id"));
    if (!id.success) return c.json({ error: "Change set not found." }, 404);
    await rejectChangeSet(sql, { changeSetId: id.data, userId: c.get("userId") });
    return c.json({ ok: true });
  });

  app.onError((error, c) => {
    if (error instanceof ChangeSetError) return c.json({ error: error.message }, error.status);
    console.error(error);
    return c.json({ error: "Something went wrong saving these changes. Nothing was saved." }, 500);
  });

  return app;
}
