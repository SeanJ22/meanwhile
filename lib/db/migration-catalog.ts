/** Catalog objects a committed SQL migration requires the server to hold. */
export interface DeclaredMigrationCatalog {
  readonly tables: ReadonlyMap<string, readonly string[]>;
  readonly indexes: readonly string[];
  readonly constraints: readonly { readonly table: string; readonly name: string }[];
  readonly functions: readonly string[];
  readonly triggers: readonly { readonly table: string; readonly name: string; readonly constraint: boolean }[];
}

function unique<T>(rows: readonly T[], key: (row: T) => string, kind: string): readonly T[] {
  const seen = new Set<string>();
  for (const row of rows) {
    const identity = key(row);
    if (seen.has(identity)) throw new Error(`MIGRATION_CATALOG_DUPLICATE_${kind}:${identity}`);
    seen.add(identity);
  }
  return rows;
}

/**
 * Parse only executable declaration forms emitted by this repository's SQL
 * migrations. A migration with another DDL form remains fail-closed in the
 * verifier because its journal hash is checked even when it declares no new
 * catalog object.
 */
export function declaredMigrationCatalog(sql: string): DeclaredMigrationCatalog {
  const tables = new Map<string, readonly string[]>();
  for (const match of sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?"([^"]+)" \(([\s\S]*?)\n\);/g)) {
    const columns = match[2]!
      .split("\n")
      .map((line) => /^\s*"([^"]+)"/.exec(line)?.[1])
      .filter((column): column is string => Boolean(column));
    if (tables.has(match[1]!)) throw new Error(`MIGRATION_CATALOG_DUPLICATE_TABLE:${match[1]}`);
    tables.set(match[1]!, columns);
  }

  const indexes = unique(
    [...sql.matchAll(/CREATE (?:UNIQUE )?INDEX "([^"]+)"/g)].map((match) => match[1]!),
    (name) => name,
    "INDEX",
  );
  const constraints = unique(
    [...sql.matchAll(/ALTER TABLE "([^"]+)" ADD CONSTRAINT "([^"]+)"/g)].map((match) => ({
      table: match[1]!,
      name: match[2]!,
    })),
    ({ table, name }) => `${table}:${name}`,
    "CONSTRAINT",
  );
  const functions = unique(
    [...sql.matchAll(/CREATE OR REPLACE FUNCTION ([a-z_][a-z0-9_]*)\s*\(/gi)].map((match) => match[1]!),
    (name) => name,
    "FUNCTION",
  );
  const triggers = unique(
    [...sql.matchAll(/CREATE (CONSTRAINT )?TRIGGER ([a-z_][a-z0-9_]*)[\s\S]*? ON "([^"]+)"/gi)].map((match) => ({
      constraint: Boolean(match[1]),
      name: match[2]!,
      table: match[3]!,
    })),
    ({ table, name }) => `${table}:${name}`,
    "TRIGGER",
  );

  return { tables, indexes, constraints, functions, triggers };
}

export function declaredMigrationCatalogCount(catalog: DeclaredMigrationCatalog): number {
  return catalog.tables.size + catalog.indexes.length + catalog.constraints.length +
    catalog.functions.length + catalog.triggers.length;
}
