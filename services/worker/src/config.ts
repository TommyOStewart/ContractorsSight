import { z } from "zod";

const envSchema = z.object({
  /** Direct Postgres connection (service-level; bypasses RLS). Validation enforces org ownership. */
  DATABASE_URL: z.string().min(1),
  SUPABASE_URL: z.url(),
  /** Used only to verify users' access tokens. */
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  PORT: z.coerce.number().int().default(8787),
  /** 0.0.0.0 so a phone on the same Wi-Fi can reach a worker running on a dev PC. */
  HOST: z.string().default("0.0.0.0"),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Worker config invalid or missing: ${missing}. Copy services/worker/.env.example to .env.`);
  }
  return parsed.data;
}
