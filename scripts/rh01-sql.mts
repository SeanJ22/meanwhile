/** Measurement SQL keeps the actual predicate; subquery FROM tokens cannot replace the outer projection. */
export function outerKeyword(text: string, keyword: string): number {
  let depth = 0;
  for (let at = 0; at < text.length;) {
    if (text.startsWith("--", at)) { const end = text.indexOf("\n", at + 2); at = end < 0 ? text.length : end + 1; continue; }
    if (text.startsWith("/*", at)) { const end = text.indexOf("*/", at + 2); at = end < 0 ? text.length : end + 2; continue; }
    const quote = text[at];
    if (quote === "'" || quote === '"') {
      at++;
      while (at < text.length) { if (text[at++] === quote) { if (text[at] === quote) at++; else break; } }
      continue;
    }
    if (quote === "$") {
      const delimiter = /^\$(?:[a-z_][a-z_0-9]*)?\$/i.exec(text.slice(at))?.[0];
      if (delimiter) { const end = text.indexOf(delimiter, at + delimiter.length); at = end < 0 ? text.length : end + delimiter.length; continue; }
    }
    if (quote === "(") { depth++; at++; continue; }
    if (quote === ")") { depth--; at++; continue; }
    if (/[a-z_]/i.test(quote ?? "")) {
      const token = /^[a-z_][a-z_0-9]*/i.exec(text.slice(at))![0];
      if (depth === 0 && token.toUpperCase() === keyword.toUpperCase()) return at;
      at += token.length; continue;
    }
    at++;
  }
  return -1;
}

export function projectedRead(text: string, projection: string): string | null {
  if (!/^\s*SELECT\b/i.test(text)) return null;
  const from = outerKeyword(text, "FROM");
  if (from < 0) return null;
  return `SELECT ${projection} ${text.slice(from)}`.replace(/FOR\s+UPDATE(?:\s+OF\s+\w+)?/gi, "");
}

/** UPDATE is never sent remotely: only its original matching rows are read into the temporary transaction. */
export function updateRead(text: string): { readonly table: string; readonly text: string } | null {
  const start = /^\s*UPDATE\s+(fact|entity|entity_host|entity_external_id|entity_place|source_copy)\s+(?:(\w+)\s+)?SET\b/i.exec(text);
  if (!start) return null;
  const table = start[1]!, alias = start[2] ?? table;
  const where = outerKeyword(text, "WHERE"), from = outerKeyword(text, "FROM"), returning = outerKeyword(text, "RETURNING");
  if (where < 0) return null;
  const source = from >= 0 && from < where ? `, ${text.slice(from + 4, where)}` : "";
  let result = `SELECT ${alias}.* FROM ${table} ${alias}${source} ${text.slice(where, returning < 0 ? undefined : returning)}`;
  const used = new Set([...result.matchAll(/\$(\d+)/g)].map(match => match[1]));
  const unused = [...new Set([...text.matchAll(/\$(\d+)/g)].map(match => match[1]))].filter(index => !used.has(index));
  if (unused.length) result = `WITH rh01_unused AS (SELECT ${unused.map(index => `$${index}::text`).join(",")}) ${result}`;
  return { table, text: result };
}

export interface SqlShadow {
  readonly table: string;
  readonly keys: readonly string[];
  readonly rows: readonly Record<string, unknown>[];
}

/** PostgreSQL evaluates the original read over committed local rows plus every untouched production row.
 * This retains joins, subqueries, filtering, keysets and aggregates without materializing their country input.
 * The production statement is still SELECT-only; JSON parameters represent temporary local writes.
 */
export function shadowRead(text: string, params: readonly unknown[], shadows: readonly SqlShadow[]): { text: string; params: unknown[] } {
  if (!/^\s*(?:SELECT|WITH)\b/i.test(text) || /\b(?:INSERT|DELETE|MERGE|CALL|UPDATE)\b/i.test(text.replace(/FOR\s+UPDATE(?:\s+OF\s+\w+)?/gi, "")))
    throw Error("RH01_SQL_SHADOW_REQUIRES_READ");
  const values = [...params], ctes: string[] = [];
  for (const shadow of shadows) {
    if (!shadow.rows.length) continue;
    if (!/^[a-z_][a-z_0-9]*$/.test(shadow.table) || !shadow.keys.length || shadow.keys.some(key => !/^[a-z_][a-z_0-9]*$/.test(key)))
      throw Error("RH01_SQL_SHADOW_IDENTITY_INVALID");
    if (new RegExp(`\\b${shadow.table}\\s+AS\\s*\\(`, "i").test(text)) throw Error("RH01_SQL_SHADOW_NAME_COLLISION");
    const table = `"${shadow.table}"`, local = `"rh01_local_${shadow.table}"`, at = `$${values.push(JSON.stringify(shadow.rows))}`;
    ctes.push(`${local} AS (SELECT * FROM jsonb_populate_recordset(NULL::public.${table},${at}::jsonb))`,
      `${table} AS (SELECT p.* FROM public.${table} p WHERE NOT EXISTS (SELECT 1 FROM ${local} l WHERE ${shadow.keys.map(key => `p."${key}" IS NOT DISTINCT FROM l."${key}"`).join(" AND ")}) UNION ALL SELECT * FROM ${local})`);
  }
  if (!ctes.length) return { text: text.replace(/FOR\s+UPDATE(?:\s+OF\s+\w+)?/gi, ""), params: values };
  let original = text.replace(/FOR\s+UPDATE(?:\s+OF\s+\w+)?/gi, "");
  for (const { table } of shadows) original = original.replace(new RegExp(`\\b(FROM|JOIN)\\s+public\\.("?${table}"?)(?=\\s|,|\\))`, "gi"), "$1 $2");
  const prefix = /^\s*WITH\s+(RECURSIVE\s+)?/i.exec(original);
  return { text: prefix ? `WITH ${prefix[1] ?? ""}${ctes.join(",")},${original.slice(prefix[0].length)}` : `WITH ${ctes.join(",")} ${original}`, params: values };
}
