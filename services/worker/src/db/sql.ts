import postgres from "postgres";

/**
 * Postgres client with camelCase ↔ snake_case conversion: result columns come back camelCased,
 * and objects passed to `sql(obj)` in inserts/updates are written to snake_case columns.
 */
export function createSql(url: string) {
  return postgres(url, {
    // Column names only. `postgres.camel` would also rewrite keys inside jsonb values,
    // corrupting stored tool args and temp IDs like "$c_1".
    transform: { column: { from: postgres.toCamel, to: postgres.fromCamel } },
    // Supabase's transaction pooler doesn't support prepared statements.
    prepare: false,
    max: 10,
  });
}

export type Sql = ReturnType<typeof createSql>;
/** A pool or a transaction; both run queries the same way. */
export type Queryable = Sql | postgres.TransactionSql<Record<string, never>>;
