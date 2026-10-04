import { z } from "zod";

/** Entity kinds that tool arguments can point at. */
export const ENTITY_KINDS = [
  "client",
  "site",
  "job",
  "quote",
  "material",
  "supplyHouse",
  "supplyOrder",
  "attachment",
  "equipment",
] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

const ENTITY_LABELS: Record<EntityKind, string> = {
  client: "client",
  site: "site (service address)",
  job: "job",
  quote: "quote",
  material: "material item",
  supplyHouse: "supply house",
  supplyOrder: "supply order",
  attachment: "attachment",
  equipment: "piece of equipment",
};

const TEMP_ID_PREFIX: Record<EntityKind, string> = {
  client: "c",
  site: "s",
  job: "j",
  quote: "q",
  material: "m",
  supplyHouse: "sh",
  supplyOrder: "o",
  attachment: "a",
  equipment: "e",
};

const UUID_SOURCE = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const TEMP_ID_SOURCE = "\\$[A-Za-z][A-Za-z0-9_]{0,31}";

export const UUID_PATTERN = new RegExp(`^${UUID_SOURCE}$`);
export const TEMP_ID_PATTERN = new RegExp(`^${TEMP_ID_SOURCE}$`);
const REF_PATTERN = new RegExp(`^(?:${UUID_SOURCE}|${TEMP_ID_SOURCE})$`);

export function isTempId(value: string): boolean {
  return TEMP_ID_PATTERN.test(value);
}

/**
 * Metadata attached to ID-bearing schemas. Validation and temp-ID resolution walk tool
 * schemas looking for these, so a tool never lists its ID fields twice.
 *
 * - `ref`:  points at an entity that already exists, or (if `allowTempId`) one created
 *           earlier in the same ChangeSet.
 * - `decl`: declares the temp ID of the entity this operation creates.
 */
export type IdFieldMeta =
  | { role: "ref"; entity: EntityKind; allowTempId: boolean }
  | { role: "decl"; entity: EntityKind };

export const idFieldRegistry = z.registry<IdFieldMeta>();

/** An ID that may be a real UUID or a temp ID (e.g. "$c1") created earlier in this capture. */
export function entityRef(entity: EntityKind, description: string) {
  const prefix = TEMP_ID_PREFIX[entity];
  const schema = z
    .string()
    .regex(REF_PATTERN)
    .meta({
      description: `${description} ID of a ${ENTITY_LABELS[entity]}: a UUID from a lookup, or a temp ID like "$${prefix}1" created earlier in this capture.`,
    });
  idFieldRegistry.add(schema, { role: "ref", entity, allowTempId: true });
  return schema;
}

/** An ID that must already exist (lookups, ambiguity candidates). */
export function existingRef(entity: EntityKind, description: string) {
  const schema = z
    .string()
    .regex(UUID_PATTERN)
    .meta({ description: `${description} UUID of an existing ${ENTITY_LABELS[entity]}.` });
  idFieldRegistry.add(schema, { role: "ref", entity, allowTempId: false });
  return schema;
}

/** The temp ID a create operation assigns to its new entity, so later operations can refer to it. */
export function tempIdDecl(entity: EntityKind) {
  const prefix = TEMP_ID_PREFIX[entity];
  const schema = z
    .string()
    .regex(TEMP_ID_PATTERN)
    .meta({
      description: `Optional temp ID for the new ${ENTITY_LABELS[entity]}, e.g. "$${prefix}1". Set it only if a later operation in this capture needs to reference it.`,
    });
  idFieldRegistry.add(schema, { role: "decl", entity });
  return schema;
}

export type IdPath = (string | number)[];

export interface IdField {
  meta: IdFieldMeta;
  value: string;
  path: IdPath;
}

// Zod's internal definition is the only stable way to walk a schema generically.
type AnyDef = {
  type: string;
  shape?: Record<string, z.ZodType>;
  element?: z.ZodType;
  innerType?: z.ZodType;
  options?: z.ZodType[];
  in?: z.ZodType;
};
const defOf = (schema: z.ZodType) => (schema as unknown as { _zod: { def: AnyDef } })._zod.def;

/**
 * Rebuilds `value` (already parsed by `schema`), passing every ID field through `visit`.
 * Return the value unchanged from `visit` to just collect; return a different string to rewrite.
 */
export function mapIdFields(
  schema: z.ZodType,
  value: unknown,
  visit: (field: IdField) => string,
  path: IdPath = [],
): unknown {
  const meta = idFieldRegistry.get(schema);
  if (meta) {
    return typeof value === "string" ? visit({ meta, value, path }) : value;
  }
  if (value === undefined || value === null) return value;

  const def = defOf(schema);
  switch (def.type) {
    case "object": {
      const record = value as Record<string, unknown>;
      const out: Record<string, unknown> = { ...record };
      for (const [key, child] of Object.entries(def.shape ?? {})) {
        if (key in record) out[key] = mapIdFields(child, record[key], visit, [...path, key]);
      }
      return out;
    }
    case "array":
      return (value as unknown[]).map((item, i) => mapIdFields(def.element!, item, visit, [...path, i]));
    case "optional":
    case "nullable":
    case "default":
    case "prefault":
    case "readonly":
    case "nonoptional":
      return mapIdFields(def.innerType!, value, visit, path);
    case "pipe":
      return mapIdFields(def.in!, value, visit, path);
    case "union": {
      const match = def.options!.find((option) => option.safeParse(value).success);
      return match ? mapIdFields(match, value, visit, path) : value;
    }
    default:
      return value;
  }
}

export function collectIdFields(schema: z.ZodType, value: unknown): IdField[] {
  const fields: IdField[] = [];
  mapIdFields(schema, value, (field) => {
    fields.push(field);
    return field.value;
  });
  return fields;
}
