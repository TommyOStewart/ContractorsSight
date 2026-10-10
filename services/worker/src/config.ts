import { z } from "zod";

const envSchema = z.object({
  /** Direct Postgres connection (service-level; bypasses RLS). Validation enforces org ownership. */
  DATABASE_URL: z.string().min(1),
  SUPABASE_URL: z.url(),
  /** Used only to verify users' access tokens. */
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  PORT: z.coerce.number().int().default(8787),
  /** Base address for customer links to quotes and invoices; defaults to the address requests arrive on. */
  PUBLIC_URL: z.url().optional(),
  /** 0.0.0.0 so a phone on the same Wi-Fi can reach a worker running on a dev PC. */
  HOST: z.string().default("0.0.0.0"),

  /** Planner model via OpenRouter. Without a key the worker runs, but captures return 503. */
  OPENROUTER_API_KEY: z.string().min(1).optional(),
  PLANNER_MODEL: z.string().default("openai/gpt-6.1-sol"),
  PLANNER_EFFORT: z.enum(["minimal", "low", "medium", "high"]).default("medium"),
  /**
   * Client-side cap on planner requests per minute; 0 turns it off. Only needed for an OpenRouter
   * account with no credits (20/minute); pacing otherwise just adds seconds to every capture.
   */
  PLANNER_RPM: z.coerce.number().int().nonnegative().default(0),
  /** Speech-to-text model via OpenRouter, for voice notes. */
  TRANSCRIBE_MODEL: z.string().default("openai/gpt-transcribe"),
  /** Vision model via OpenRouter that reads photos of notes and receipts into text. */
  READ_IMAGE_MODEL: z.string().default("google/gemini-3.8-flash"),
  /** IANA timezone for interpreting dates in captures (becomes a per-org setting later). */
  TIMEZONE: z.string().default("America/Chicago"),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Worker config invalid or missing: ${missing}. Copy services/worker/.env.example to .env (locally) or set them as environment variables (on the host).`);
  }
  return parsed.data;
}
