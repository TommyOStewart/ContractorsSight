import { serve } from "@hono/node-server";
import { supabaseVerifyUser } from "./auth";
import { loadConfig } from "./config";
import { createSql } from "./db/sql";
import { createApp } from "./http/app";
import { OpenRouterChatModel } from "./planner/openRouter";
import { PostgresPlannerData } from "./planner/PostgresPlannerData";
import { supabaseFileDownloader } from "./speech/supabaseStorage";
import { OpenRouterTranscriber } from "./speech/transcriber";
import { OpenRouterImageReader } from "./vision/imageReader";

const config = loadConfig();
const sql = createSql(config.DATABASE_URL);

const capture = config.OPENROUTER_API_KEY
  ? {
      model: new OpenRouterChatModel({ apiKey: config.OPENROUTER_API_KEY, model: config.PLANNER_MODEL, effort: config.PLANNER_EFFORT, requestsPerMinute: config.PLANNER_RPM }),
      data: new PostgresPlannerData(sql),
      timezone: config.TIMEZONE,
    }
  : undefined;

const downloadFile = supabaseFileDownloader(config.SUPABASE_URL, config.SUPABASE_PUBLISHABLE_KEY);
const audio = config.OPENROUTER_API_KEY
  ? { transcriber: new OpenRouterTranscriber({ apiKey: config.OPENROUTER_API_KEY, model: config.TRANSCRIBE_MODEL }), downloadFile }
  : undefined;
const images = config.OPENROUTER_API_KEY
  ? { imageReader: new OpenRouterImageReader({ apiKey: config.OPENROUTER_API_KEY, model: config.READ_IMAGE_MODEL }), downloadFile }
  : undefined;

const app = createApp({ sql, verifyUser: supabaseVerifyUser(config.SUPABASE_URL, config.SUPABASE_PUBLISHABLE_KEY), capture, audio, images });

serve({ fetch: app.fetch, port: config.PORT, hostname: config.HOST }, (info) => {
  console.log(`Worker listening on http://${info.address}:${info.port}`);
  console.log(capture ? `Captures enabled: ${config.PLANNER_MODEL} (effort ${config.PLANNER_EFFORT}), ${config.TIMEZONE}` : "Captures disabled: OPENROUTER_API_KEY not set");
  if (audio) console.log(`Voice notes enabled: ${config.TRANSCRIBE_MODEL}`);
  if (images) console.log(`Photos enabled: ${config.READ_IMAGE_MODEL}`);
});
