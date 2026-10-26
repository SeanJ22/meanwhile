import { createHash } from "node:crypto";

export interface FixtureField { readonly name: string; readonly dataTypeID: number; readonly [key: string]: unknown }
export interface FixtureWireResult { readonly fields: readonly FixtureField[]; readonly rows: readonly (readonly unknown[])[]; readonly [key: string]: unknown }

/** Skip SQL text that cannot contain a CTE delimiter or a source boundary. */
function quotedEnd(query: string, at: number): number | null {
  if (query.startsWith("--", at)) {
    const end = query.indexOf("\n", at + 2); return end < 0 ? query.length : end + 1;
  }
  if (query.startsWith("/*", at)) {
    let depth = 1; at += 2;
    while (at < query.length && depth) {
      if (query.startsWith("/*", at)) { depth++; at += 2; }
      else if (query.startsWith("*/", at)) { depth--; at += 2; }
      else at++;
    }
    return at;
  }
  const dollar = /^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/.exec(query.slice(at))?.[0];
  if (dollar) {
    const end = query.indexOf(dollar, at + dollar.length); return end < 0 ? query.length : end + dollar.length;
  }
  if (query[at] !== "'" && query[at] !== '"') return null;
  const quote = query[at], escaped = quote === "'" && /(?:^|[^A-Za-z_0-9$])E$/i.test(query.slice(0, at));
  at++;
  while (at < query.length) {
    if (query[at] === quote) { at++; if (query[at] !== quote) break; }
    else if (query[at] === "\\" && escaped) at++;
    at++;
  }
  return at;
}
function sourceCte(query: string): { readonly token: string; readonly at: number; readonly start: number; readonly end: number } | null {
  let depth = 0;
  for (let at = 0; at < query.length;) {
    const quoted = quotedEnd(query, at);
    if (quoted !== null) { at = quoted; continue; }
    const match = depth === 0 && /^db04_source_([a-f0-9]+)\s+AS\s+MATERIALIZED\s*\(/.exec(query.slice(at));
    if (match) {
      const start = at + match[0].length;
      let end = start, nested = 1;
      while (end < query.length && nested) {
        const quoted = quotedEnd(query, end);
        if (quoted !== null) { end = quoted; continue; }
        if (query[end] === "(") nested++;
        else if (query[end] === ")") nested--;
        end++;
      }
      if (nested === 0 && new RegExp(`^\\s*,\\s*db04_rows_${match[1]}\\s+AS\\s+MATERIALIZED`).test(query.slice(end))) {
        return { token: match[1], at, start, end: end - 1 };
      }
    }
    if (query[at] === "(") depth++;
    else if (query[at] === ")") depth--;
    at++;
  }
  return null;
}

/** Only hand-written transport fixtures need this. Real PostgreSQL tests execute
 * the whole generated statement and independently prove the version protocol. */
export function unwrapVersionedStatement(query: string, params: readonly unknown[] = []) {
  const source = sourceCte(query);
  if (!source) return { query, params, wrap: (result: FixtureWireResult) => result };
  const prefix = query.slice(0, source.at).replace(/,\s*$/, "");
  const original = (/^\s*WITH\s*$/i.test(prefix) ? "" : prefix) + query.slice(source.start, source.end).trimEnd();
  const token=source.token,encoded=params.at(-1);
  const held=new Set(Array.isArray(encoded)?encoded:typeof encoded==="string"?encoded.match(/[a-f0-9]{64}/g)??[]:[]);
  return {
    query: original, params: params.slice(0, -1),
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
