import { collectIdFields, isTempId } from "../domain/refs";
import { getTool } from "../tools/registry";
import type { EntityKey, ValidationRepository } from "./repository";

/**
 * Reads the current version of every existing job the operations touch, directly or through
 * a material or quote, for ChangeSetDraft.baseJobVersions. Call it when the proposal is built,
 * so approval can detect edits made in between. Unparseable operations are skipped; validation
 * reports them.
 */
export async function computeBaseJobVersions(
  operations: { tool: string; args: unknown }[],
  repository: ValidationRepository,
): Promise<Record<string, number>> {
  const keys: EntityKey[] = [];
  for (const op of operations) {
    const tool = getTool(op.tool);
    const parsed = tool?.input.safeParse(op.args);
    if (!tool || !parsed?.success) continue;
    for (const f of collectIdFields(tool.input, parsed.data)) {
      if (f.meta.role !== "ref" || isTempId(f.value)) continue;
      if (f.meta.entity === "job" || f.meta.entity === "material" || f.meta.entity === "quote") {
        keys.push({ entity: f.meta.entity, id: f.value });
      }
    }
  }

  const snapshots = keys.length ? await repository.getEntities(keys) : [];
  const jobIds = new Set<string>();
  for (const s of snapshots) {
    if (s.entity === "job") jobIds.add(s.id);
    if (s.entity === "material" || s.entity === "quote") jobIds.add(s.jobId);
  }
  const jobs = jobIds.size ? await repository.getEntities([...jobIds].map((id) => ({ entity: "job" as const, id }))) : [];

  const versions: Record<string, number> = {};
  for (const job of jobs) if (job.entity === "job") versions[job.id] = job.version;
  return versions;
}
