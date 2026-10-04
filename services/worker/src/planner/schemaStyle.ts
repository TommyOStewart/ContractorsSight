/**
 * Providers differ in how they treat optional tool parameters.
 *
 * - "standard": optional fields are simply absent from `required` (Anthropic, Google).
 * - "nullable-optionals": every field is listed in `required` and optional ones also accept null.
 *   OpenAI models fill in every field (with placeholders like "Unknown" or a nil UUID) unless
 *   they are given a way to say "not provided"; null is that way. The planner strips nulls
 *   before validation, so a null means the same as an omitted field.
 */
export type SchemaStyle = "standard" | "nullable-optionals";

type Json = Record<string, unknown>;

export function adaptSchema(schema: Json, style: SchemaStyle): Json {
  return style === "standard" ? schema : nullableOptionals(schema);
}

function nullableOptionals(node: unknown): Json {
  if (!node || typeof node !== "object" || Array.isArray(node)) return node as Json;
  const schema = node as Json;
  const out: Json = { ...schema };

  if (schema.properties && typeof schema.properties === "object") {
    const required = new Set((schema.required as string[] | undefined) ?? []);
    const properties: Json = {};
    for (const [key, child] of Object.entries(schema.properties as Json)) {
      const adapted = nullableOptionals(child);
      properties[key] = required.has(key) ? adapted : { anyOf: [stripDefault(adapted), { type: "null" }], ...describe(adapted) };
    }
    out.properties = properties;
    out.required = Object.keys(properties);
  }
  if (schema.items) out.items = nullableOptionals(schema.items);
  for (const combinator of ["anyOf", "oneOf", "allOf"] as const) {
    if (Array.isArray(schema[combinator])) out[combinator] = (schema[combinator] as unknown[]).map(nullableOptionals);
  }
  return out;
}

// Keep the description on the outer schema so the model still sees it.
function describe(schema: Json): Json {
  return typeof schema.description === "string" ? { description: schema.description } : {};
}
function stripDefault(schema: Json): Json {
  const { default: _default, ...rest } = schema;
  return rest;
}

/** Removes null-valued properties recursively, so `{ city: null }` validates like `{}`. */
export function stripNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripNulls);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Json)
        .filter(([, v]) => v !== null)
        .map(([k, v]) => [k, stripNulls(v)]),
    );
  }
  return value;
}
