import { serve } from "@hono/node-server";
import { supabaseVerifyUser } from "./auth";
import { loadConfig } from "./config";
import { createSql } from "./db/sql";
import { createApp } from "./http/app";

const config = loadConfig();
const sql = createSql(config.DATABASE_URL);
const app = createApp({ sql, verifyUser: supabaseVerifyUser(config.SUPABASE_URL, config.SUPABASE_PUBLISHABLE_KEY) });

serve({ fetch: app.fetch, port: config.PORT, hostname: config.HOST }, (info) => {
  console.log(`Worker listening on http://${info.address}:${info.port}`);
});
