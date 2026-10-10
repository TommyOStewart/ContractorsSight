import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import {
  answerQuestion,
  correctCapture,
  correctCaptureByAudio,
  createAudioCapture,
  createImageCapture,
  createTextCapture,
  type AudioDeps,
  type CaptureDeps,
  type ImageDeps,
} from "../capture/captureService";
import { approveChangeSet, ChangeSetError, rejectChangeSet, updateOperation } from "../commit/changeSetService";
import { applyManualEdit } from "../commit/manualEdits";
import { renderMissingPage, renderSharedPage } from "../sharing/page";
import { approveSharedQuote, loadSharedDocument, shareInvoice, shareQuote } from "../sharing/shareService";
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
  /** Photo reading; photo captures are disabled (503) without it. */
  images?: ImageDeps;
  /** Base for customer links (e.g. https://worker.example.com); defaults to the address requests arrive on. */
  publicUrl?: string;
}

type Env = { Variables: { userId: string; accessToken: string } };

const uuid = z.uuid();

/**
 * The worker's HTTP API. Every route requires the user's Supabase access token; the worker then
 * acts with database-level access, so each handler checks org membership itself.
 */
export function createApp({ sql, verifyUser, capture, audio, images, publicUrl }: AppDeps) {
  const app = new Hono<Env>();

  // Browsers (the web build) need CORS; phones don't. Any origin is fine: every request carries its
  // own bearer token and the worker uses no cookies.
  app.use("*", cors({ origin: "*", allowHeaders: ["authorization", "content-type"], allowMethods: ["GET", "POST", "OPTIONS"] }));

  app.get("/health", (c) => c.json({ ok: true }));

  // --- Customer pages: no sign-in; the token in the link is the credential. ---------------------
  const shareToken = z.string().regex(/^[A-Za-z0-9_-]{32,100}$/);
  const pageHeaders = {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    // The token is in the URL: keep it out of referrers and search engines.
    "referrer-policy": "no-referrer",
    "x-robots-tag": "noindex",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  };

  app.get("/p/:token", async (c) => {
    const token = shareToken.safeParse(c.req.param("token"));
    const doc = token.success ? await loadSharedDocument(sql, token.data) : null;
    return c.body(doc ? renderSharedPage(doc) : renderMissingPage(), doc ? 200 : 404, pageHeaders);
  });

  app.post("/p/:token", async (c) => {
    const token = shareToken.safeParse(c.req.param("token"));
    const doc = token.success ? await loadSharedDocument(sql, token.data) : null;
    if (!token.success || !doc) return c.body(renderMissingPage(), 404, pageHeaders);
    const form = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    const name = typeof form.name === "string" ? form.name.trim().slice(0, 120) : "";
    if (!name) return c.body(renderSharedPage(doc, "Please type your name to approve."), 400, pageHeaders);
    try {
      await approveSharedQuote(sql, { token: token.data, name });
    } catch (error) {
      if (!(error instanceof ChangeSetError)) throw error;
      return c.body(renderSharedPage(doc, error.message), error.status, pageHeaders);
    }
    // Post/redirect/get, so a refresh doesn't resubmit.
    return c.redirect(`/p/${token.data}`, 303);
  });

  app.use("*", async (c, next) => {
    if (c.req.path === "/health" || c.req.path.startsWith("/p/")) return next();
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
    clientCaptureId: uuid.optional(),
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

  const audioBody = z.object({ orgId: uuid, audioPath: z.string().min(1).max(500), targetJobId: uuid.optional(), clientCaptureId: uuid.optional() });

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

  const imageBody = z.object({
    orgId: uuid,
    imagePaths: z.array(z.string().min(1).max(500)).min(1).max(5),
    targetJobId: uuid.optional(),
    clientCaptureId: uuid.optional(),
  });

  app.post("/captures/image", async (c) => {
    if (!capture || !images) return c.json({ error: "Photos aren't configured on this worker." }, 503);
    const body = imageBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "Invalid photos." }, 400);
    const result = await createImageCapture(
      { sql, ...capture, ...images },
      { userId: c.get("userId"), accessToken: c.get("accessToken"), ...body.data },
    );
    return c.json(result, 201);
  });

  const reviseBody = z.union([
    z.object({ text: z.string().trim().min(1).max(4000) }),
    z.object({ audioPath: z.string().min(1).max(500) }),
  ]);

  // A typed or spoken correction to a pending proposal; returns the re-planned proposal.
  app.post("/change-sets/:id/revise", async (c) => {
    if (!capture) return c.json({ error: "Captures aren't configured on this worker." }, 503);
    const id = uuid.safeParse(c.req.param("id"));
    if (!id.success) return c.json({ error: "Change set not found." }, 404);
    const body = reviseBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "Say or type what to change." }, 400);
    const userId = c.get("userId");
    if ("text" in body.data) return c.json(await correctCapture({ sql, ...capture }, { userId, changeSetId: id.data, text: body.data.text }), 201);
    if (!audio) return c.json({ error: "Voice notes aren't configured on this worker." }, 503);
    const result = await correctCaptureByAudio(
      { sql, ...capture, ...audio },
      { userId, changeSetId: id.data, accessToken: c.get("accessToken"), audioPath: body.data.audioPath },
    );
    return c.json(result, 201);
  });

  const editBody = z.object({ args: z.record(z.string(), z.unknown()) });

  // The reviewer edited one proposed change by hand.
  app.post("/change-sets/:id/operations/:index", async (c) => {
    const id = uuid.safeParse(c.req.param("id"));
    const index = z.coerce.number().int().nonnegative().safeParse(c.req.param("index"));
    if (!id.success || !index.success) return c.json({ error: "Change not found." }, 404);
    const body = editBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "Invalid edit." }, 400);
    return c.json(await updateOperation(sql, { changeSetId: id.data, userId: c.get("userId"), index: index.data, args: body.data.args }));
  });

  const editsBody = z.object({
    orgId: uuid,
    operations: z.array(z.object({ tool: z.string(), args: z.unknown() })).min(1).max(20),
    baseJobVersions: z.record(uuid, z.int().nonnegative()).optional(),
  });

  // A hand edit from the app (no capture, no LLM): validated, applied and audited as `manual`.
  app.post("/edits", async (c) => {
    const body = editsBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "Invalid edit." }, 400);
    const result = await applyManualEdit(sql, { userId: c.get("userId"), ...body.data });
    return result.ok ? c.json(result) : c.json(result, 409);
  });

  /** Where customer links point: the configured address, or the one this request came in on. */
  const linkFor = (c: { req: { url: string; header(name: string): string | undefined } }, token: string) => {
    if (publicUrl) return `${publicUrl.replace(/\/$/, "")}/p/${token}`;
    const url = new URL(c.req.url);
    const proto = c.req.header("x-forwarded-proto")?.split(",")[0]?.trim() ?? url.protocol.replace(":", "");
    const host = c.req.header("x-forwarded-host") ?? c.req.header("host") ?? url.host;
    return `${proto}://${host}/p/${token}`;
  };

  // Send a quote or invoice: marks it sent and returns the customer's link.
  app.post("/quotes/:id/share", async (c) => {
    const id = uuid.safeParse(c.req.param("id"));
    if (!id.success) return c.json({ error: "Quote not found." }, 404);
    const { token } = await shareQuote(sql, { userId: c.get("userId"), quoteId: id.data });
    return c.json({ url: linkFor(c, token) });
  });

  app.post("/invoices/:id/share", async (c) => {
    const id = uuid.safeParse(c.req.param("id"));
    if (!id.success) return c.json({ error: "Invoice not found." }, 404);
    const { token } = await shareInvoice(sql, { userId: c.get("userId"), invoiceId: id.data });
    return c.json({ url: linkFor(c, token) });
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
