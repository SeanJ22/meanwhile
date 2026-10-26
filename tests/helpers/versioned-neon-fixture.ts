import { createHash } from "node:crypto";

export interface FixtureField { readonly name: string; readonly dataTypeID: number; readonly [key: string]: unknown }
export interface FixtureWireResult { readonly fields: readonly FixtureField[]; readonly rows: readonly (readonly unknown[])[]; readonly [key: string]: unknown }

/** Only hand-written transport fixtures need this. Real PostgreSQL tests execute
 * the whole generated statement and independently prove the version protocol. */
export function unwrapVersionedStatement(query: string, params: readonly unknown[] = []) {
  const match = /^\s*WITH db04_source_([a-f0-9]+) AS MATERIALIZED \(/.exec(query);
  if (!match) return { query, params, wrap: (result: FixtureWireResult) => result };
  let at = match[0].length, depth = 1, quote = "", escaped = false;
  const start = at;
  while (at < query.length && depth) {
    const char = query[at++];
    if (quote) {
      if (char === quote) { if (query[at] === quote) at++; else quote = ""; }
      else if (char === "\\" && escaped) at++;
    } else if (char === "'" || char === '"') { quote = char; escaped = char === "'" && /(?:^|[^A-Za-z_0-9$])E$/i.test(query.slice(0, at - 1)); }
    else if (char === "(") depth++;
    else if (char === ")") depth--;
  }
  const token = match[1], held = new Set((params.at(-1) as readonly string[]) ?? []);
  return {
    query: query.slice(start, at - 1), params: params.slice(0, -1),
    wrap(result: FixtureWireResult): FixtureWireResult {
      const seen = new Set<string>();
      const extras: FixtureField[] = [
        { name: `db04_ordinal_${token}`, dataTypeID: 20 }, { name: `db04_etag_${token}`, dataTypeID: 25 },
        { name: `db04_unchanged_${token}`, dataTypeID: 16 }, { name: `db04_version_${token}`, dataTypeID: 25 },
        { name: `db04_retained_${token}`, dataTypeID: 16 },
      ];
      return { ...result, command: "SELECT", rowCount: result.rows.length, fields: [...result.fields, ...extras],
        rows: result.rows.map((row, index) => {
          const tag = createHash("sha256").update(JSON.stringify([result.fields.map(field => [field.name, field.dataTypeID]), row])).digest("hex");
          const retained = held.has(tag) || seen.has(tag); seen.add(tag);
          return [...(retained ? row.map(() => null) : row), ...(retained ? [null, null, null] : [String(index + 1), tag, "f"]), tag, retained ? "t" : "f"];
        }),
      };
    },
  };
}
