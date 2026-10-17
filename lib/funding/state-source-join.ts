import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, rm } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { federalCsvRecords, federalZipBytes, federalZipEntries } from "../federal-money/streams.ts";
import { csvRows } from "../reference/csv.ts";
import { sortSourceRecords } from "../reference/external-sort.ts";
import type { CampaignFinanceResource } from "./state-sources.ts";

type Row = Record<string, unknown>;
function rowKey(row: Row, keys: readonly string[]): string | null {
  const values = keys.map(key => row[key]);
  if (values.some(value => value === undefined || value === null || value === "")) return null;
  return createHash("sha256").update(JSON.stringify(values)).digest("hex");
}
async function* keyedRows(path: string) {
  const lines = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of lines) {
    const tab = line.indexOf("\t");
    if (tab < 0) throw new Error("A source-native join row has no key.");
    yield { key: line.slice(0, tab), row: JSON.parse(line.slice(tab + 1)) as Row };
  }
}

export async function* joinedCampaignSourceRows(path: string, resource: CampaignFinanceResource, directory: string, signal: AbortSignal): AsyncGenerator<Uint8Array> {
  const lookup = resource.lookup;
  if (!lookup) throw new Error("The source-native cover join has no declared keys.");
  await mkdir(directory, { recursive: true });
  const leftPath = join(directory, "filings"), rightPath = join(directory, "covers");
  const left = await open(leftPath, "w"), right = await open(rightPath, "w");
  let foundCover = false, foundFilings = false;
  try {
    try {
      for await (const entry of federalZipEntries(path)) {
        const cover = new RegExp(lookup.entryPattern, "i").test(entry.name);
        const filing = resource.filePattern ? new RegExp(resource.filePattern, "i").test(entry.name) : false;
        if (!cover && !filing) continue;
        foundCover ||= cover; foundFilings ||= filing;
        let header: string[] | null = null;
        for await (const line of federalCsvRecords(federalZipBytes(path, entry), resource.encoding, resource.quote)) {
          signal.throwIfAborted();
          const row = [...csvRows(line.replace(/^\uFEFF/, ""), resource.delimiter, resource.quote)][0];
          if (!header) {
            if (!row?.length || new Set(row).size !== row.length || (cover ? lookup.keys : lookup.filingKeys ?? lookup.keys).some(key => !row.includes(key))) throw new Error("Campaign cover or filing columns no longer contain their native join keys.");
            header = row; continue;
          }
          if (row.length === 1 && !row[0]) continue;
          const keys = cover ? lookup.keys : lookup.filingKeys ?? lookup.keys;
          const malformed = row.length !== header.length;
          const prefix = keys.every((key, index) => header![index] === key && /^\d+$/.test(row[index] ?? ""));
          const values: Row = malformed ? { ...(prefix ? Object.fromEntries(keys.map((key, index) => [key, row[index]])) : {}),
            __sourceRowIssue: "The official row has an unexpected number of fields; its details remain unattributed." }
            : Object.fromEntries(header.map((field, index) => [field, row[index]]));
          const selected = cover ? { ...Object.fromEntries([...new Set([...lookup.keys, ...lookup.fields])].map(field => [field, values[field]])),
            ...(malformed ? { __sourceRowIssue: values.__sourceRowIssue } : {}) } : values;
          const key = rowKey(values, cover ? lookup.keys : lookup.filingKeys ?? lookup.keys) ?? `unjoined:${cover ? "cover" : "filing"}`;
          await (cover ? right : left).write(`${key}\t${JSON.stringify(selected)}\n`);
        }
      }
    } finally { await left.close(); await right.close(); }
    if (!foundCover || !foundFilings) throw new Error("The source archive is missing its declared cover or filing table.");
    const sortedLeft = `${leftPath}.sorted`, sortedRight = `${rightPath}.sorted`;
    await sortSourceRecords(leftPath, sortedLeft, signal);
    await rm(leftPath);
    await sortSourceRecords(rightPath, sortedRight, signal);
    await rm(rightPath);
    const covers = keyedRows(sortedRight)[Symbol.asyncIterator]();
    let next = await covers.next(), heldKey = "", held: Row | null = null;
    try {
      yield Buffer.from("[");
      let first = true;
      const encode = (row: Row) => { const prefix = first ? "" : ","; first = false; return Buffer.from(prefix + JSON.stringify(row)); };
      const unmatchedCover = (row: Row) => ({ ...row, __sourceRowIssue: "The source cover has no matching filing row; its native details remain held." });
      for await (const filing of keyedRows(sortedLeft)) {
        signal.throwIfAborted();
        if (heldKey !== filing.key) {
          while (!next.done && next.value.key < filing.key) {
            yield encode(unmatchedCover(next.value.row));
            next = await covers.next();
          }
          heldKey = filing.key; held = null;
          let ambiguous = false, encoded: string | null = null;
          while (!next.done && next.value.key === filing.key) {
            const value = JSON.stringify(next.value.row);
            if (encoded !== null && encoded !== value) ambiguous = true;
            encoded = value; held = next.value.row; next = await covers.next();
          }
          if (ambiguous) held = { __ambiguousLookup: true };
        }
        const conflict = held && lookup.consistentFields?.some(pair => held![pair.cover] && filing.row[pair.filing] && held![pair.cover] !== filing.row[pair.filing]);
        yield encode({ ...(conflict ? { __ambiguousLookup: true } : held), ...filing.row });
      }
      while (!next.done) { yield encode(unmatchedCover(next.value.row)); next = await covers.next(); }
      yield Buffer.from("]");
    } finally { await covers.return?.(); }
  } finally { await rm(directory, { recursive: true, force: true }); }
}
