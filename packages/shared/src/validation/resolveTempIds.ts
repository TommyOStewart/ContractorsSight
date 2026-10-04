import type { StagedOperation, ValidatedChangeSet } from "../changeset/types";
import { isTempId, mapIdFields } from "../domain/refs";
import { getTool } from "../tools/registry";

export interface ResolvedChangeSet extends ValidatedChangeSet {
  /** Temp ID → the real UUID assigned to the created record. */
  tempIdMap: Record<string, string>;
}

/**
 * Replaces every temp ID (declarations and references) with a real UUID. Called at commit
 * time, on a ChangeSet that already passed validateChangeSet. Throws if a reference has
 * no earlier declaration, since validation should have made that impossible.
 */
export function resolveTempIds(
  changeSet: ValidatedChangeSet,
  newId: () => string = () => crypto.randomUUID(),
): ResolvedChangeSet {
  const tempIdMap: Record<string, string> = {};

  const operations = changeSet.operations.map((op, index) => {
    const tool = getTool(op.tool);
    if (!tool) throw new Error(`Unknown tool "${op.tool}" in operation ${index}.`);

    const args = mapIdFields(tool.input, op.args, (field) => {
      if (field.meta.role === "decl") {
        const id = newId();
        tempIdMap[field.value] = id;
        return id;
      }
      if (!isTempId(field.value)) return field.value;
      const id = tempIdMap[field.value];
      if (!id) throw new Error(`Temp ID ${field.value} in operation ${index} has no earlier declaration.`);
      return id;
    });
    return { tool: op.tool, args } as StagedOperation;
  });

  return { ...changeSet, operations, tempIdMap };
}
