import { createHmac, timingSafeEqual } from "node:crypto";

// A preview shows a member exactly what the customer will see, before anything is sent. Its link
// is signed rather than stored: it names the document and an expiry, so it needs no share token
// (which would mark the document sent) and stops working on its own.

export type PreviewKind = "quote" | "invoice";

const TTL_MS = 30 * 60_000;

const sign = (secret: Buffer, payload: string) => createHmac("sha256", secret).update(payload).digest("base64url");

/** A token for `/p/preview/<token>`, good for 30 minutes. */
export function previewToken(secret: Buffer, doc: { kind: PreviewKind; id: string }, now = Date.now()): string {
  const payload = `${doc.kind === "quote" ? "q" : "i"}.${doc.id}.${(now + TTL_MS).toString(36)}`;
  return `${payload}.${sign(secret, payload)}`;
}

/** The document a preview token names, or null if it's malformed, forged, or expired. */
export function readPreviewToken(secret: Buffer, token: string, now = Date.now()): { kind: PreviewKind; id: string } | null {
  const match = /^([qi])\.([0-9a-f-]{36})\.([0-9a-z]{1,12})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!match) return null;
  const [, kind, id, expires, signature] = match;
  const expected = Buffer.from(sign(secret, `${kind}.${id}.${expires}`));
  const given = Buffer.from(signature!);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  if (parseInt(expires!, 36) < now) return null;
  return { kind: kind === "q" ? "quote" : "invoice", id: id! };
}
