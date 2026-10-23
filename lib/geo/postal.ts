import { readFileSync } from "node:fs";
import { join } from "node:path";
import { postalAreaIn, postalAreaNeedsAddress, type PostalRow, type PostalTable } from "./postal-core.ts";
import { serverReaderValue } from "../reader/memory.ts";

const source = serverReaderValue("postal-source", () => ({ text: undefined as string | undefined,
  table: undefined as PostalTable | undefined, rows: new Map<string, PostalRow | null>() }));
const sourceText = () => source.text ??= readFileSync(join(process.cwd(), "lib/geo/postal-zips.json"), "utf8");

/** Enumeration still has the complete table; point reads parse only their postal row. */
export function postalTable(): PostalTable {
  if (!source.table) {
    source.table = (JSON.parse(sourceText()) as { zips: PostalTable }).zips;
    source.text = undefined;
    source.rows.clear();
  }
  return source.table;
}

export function postalRow(zip: string): PostalRow | null {
  if (!/^\d{5}$/.test(zip)) return null;
  if (source.table) return source.table[zip] ?? null;
  if (source.rows.has(zip)) return source.rows.get(zip)!;
  // PostalRow is a flat array of JSON scalars. Quoted fields may contain
  // brackets or escaped quotes, so match entire strings before delimiters.
  const match = new RegExp(`"${zip}"\\s*:\\s*(\\[(?:[^"\\[\\]]|"(?:[^"\\\\]|\\\\.)*")*\\])`).exec(sourceText());
  const row = match ? JSON.parse(match[1]) as PostalRow : null;
  source.rows.set(zip,row);
  return row;
}

/** Server-only postal metadata; the browser loads it through zcta-table's lazy import. */
export function postalArea(zip: string) {
  const row = postalRow(zip);
  return row ? postalAreaIn({[zip]:row},zip) : null;
}

export function zipNeedsAddress(zip: string): boolean {
  return postalAreaNeedsAddress(zip, postalArea(zip));
}
