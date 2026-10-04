/**
 * Writes the LLM-facing JSON Schema for every tool to generated/tools.json (or the path
 * given as the first argument). The output is derived from the Zod definitions in
 * src/tools/definitions.ts; never edit it by hand.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TOOLS, toLlmToolSchemas } from "../src/index";

const here = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(process.argv[2] ?? resolve(here, "../generated/tools.json"));

const tools = toLlmToolSchemas().map((schema, i) => ({ ...schema, kind: TOOLS[i]!.kind }));

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify({ tools }, null, 2)}\n`);
console.log(`Wrote ${tools.length} tool schemas to ${outPath}`);
