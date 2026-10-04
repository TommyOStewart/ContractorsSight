import { Hono } from "hono";
import { z } from "zod";
import { answerQuestion, createAudioCapture, createTextCapture, type AudioDeps, type CaptureDeps } from "../capture/captureService";
import { approveChangeSet, ChangeSetError, rejectChangeSet } from "../commit/changeSetService";
import type { Sql } from "../db/sql";

/** Resolves a bearer token to a user ID, or null if the token is missing, invalid, or expired. */
export type VerifyUser = (accessToken: string) => Promise<string | null>;

export interface AppDeps {
  sql: Sql;
  verifyUser: VerifyUser;
  /** Planner wiring; captures are disabled (503) without it. */
  capture?: Omit<CaptureDeps, "sql">;
  /** Speech-to-text wiring; voice captures are disabled (503) without it. */
  audio?: AudioDeps;
}

type Env = { Variables: { userId: string; accessToken: string } };

const uuid = z.uuid();

/**
 * The worker's HTTP API. Every route requires the user's Supabase access token; the worker then
 * acts with database-level access, so each handler checks org membership itself.
 */
export function createApp({ sql, verifyUser, capture, audio }: AppDeps) {
  const app = new Hono<Env>();

  app.get("/health", (c) => c.json({ ok: true }));

  app.use("*", async (c, next) => {
    if (c.req.path === "/health") return next();
    const token = c.req.header("authorization")?.match(/^Bearer (.+)$/i)?.[1];
    const userId = token ? await verifyUser(token) : null;
    if (!userId) return c.json({ error: "Not signed in." }, 401);
    c.set("userId", userId);
    c.set("accessToken", token!);
    await next();
  });

  const approveBody = z.object({ include: z.array(z.int().nonnegative()).max(200).optional() });
  const answerBody = z.object({ question: z.string().trim().min(1).max(1000), answer: z.string().trim().min(1).max(1000) });

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
    const body = approveBody.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json({ error: "Invalid selection." }, 400);
    const result = await approveChangeSet(sql, { changeSetId: id.data, userId: c.get("userId"), include: body.data.include });
    return result.ok ? c.json(result) : c.json(result, 409);
  });

  const audioBody = z.object({ orgId: uuid, audioPath: z.string().min(1).max(500) });

  app.post("/captures/audio", async (c) => {
    if (!capture || !audio) return c.json({ error: "Voice notes aren't configured on this worker." }, 503);
    const body = audioBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "Invalid recording." }, 400);
    const result = await createAudioCapture(
      { sql, ...capture, ...audio },
      { userId: c.get("userId"), accessToken: c.get("accessToken"), ...body.data },
    );
    return c.json(result, 201);
  });

  app.post("/change-sets/:id/answer", async (c) => {
    if (!capture) return c.json({ error: "Captures aren't configured on this worker." }, 503);
    const id = uuid.safeParse(c.req.param("id"));
    if (!id.success) return c.json({ error: "Change set not found." }, 404);
    const body = answerBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "Invalid answer." }, 400);
    const result = await answerQuestion({ sql, ...capture }, { userId: c.get("userId"), changeSetId: id.data, ...body.data });
    return c.json(result, 201);
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
