/** Loads the held Census publisher facts into the per-state table; an unchanged state costs one read. */
import { createHash } from "node:crypto";
import { createReadStream, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { US_JURISDICTIONS } from "../coverage/states.ts";
import type { FactDb, Query } from "../facts/publish.ts";
import { dataPath, notePath, parseCsv } from "../reference/index.ts";
import { censusPublisherSize, type PublisherSizeHolding } from "./publisher-size.ts";

const PARSER = "publisher-size/1";
const DATASETS = ["census_govt_units_2022", "census_govt_units_2022_dependent_school_systems"] as const;
const BATCH = 500;

async function sha256OfFile(path: string): Promise<string> {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest("hex");
}

/** Each listed state whose Census inputs changed since its last load is replaced; the rest are left alone. */
export async function ensurePublisherSizes(db: FactDb & { readonly query: Query }, states: readonly string[]): Promise<readonly string[]> {
  const slugs = [...new Set(states.map(state => state.toLowerCase()))];
  for (const state of slugs) if (!US_JURISDICTIONS.some(j => j.slug === state)) throw new Error(`Unknown state: ${state}`);
  const archiveNote = readFileSync(notePath(DATASETS[0]), "utf8");
  const archiveSha256 = /`sha256\([^)]*\)`\s*=\s*`([a-f0-9]{64})`/.exec(archiveNote)?.[1];
  if (!archiveSha256) throw new Error("The held Census source note has no archive identity.");
  const hashes = await Promise.all(DATASETS.map(dataset => sha256OfFile(dataPath(dataset))));
  const release = createHash("sha256").update([PARSER, archiveSha256, ...hashes].join("\n")).digest("hex");
  const loaded = new Map((await db.query("SELECT source, sha256 FROM fact_store_load WHERE source LIKE 'publisher-size:%'"))
    .map(row => [String(row.source), String(row.sha256)]));
  const stale = new Set(slugs.filter(state => loaded.get(`publisher-size:${state}`) !== release));
  if (stale.size === 0) return [];

  const pending = new Map<string, { dataset: string; row: number; holding: PublisherSizeHolding }[]>();
  const flush = async (state: string, all: boolean) => {
    const rows = pending.get(state) ?? [];
    if (rows.length === 0 || rows.length < BATCH && !all) return;
    pending.set(state, []);
    await db.query(`INSERT INTO publisher_size (state, dataset, source_row, host, release, holding)
      SELECT $1, dataset, source_row, holding::jsonb ->> 'host', $5, holding::jsonb
      FROM unnest($2::text[], $3::int[], $4::text[]) AS t(dataset, source_row, holding)
      ON CONFLICT (state, dataset, source_row) DO UPDATE SET host = EXCLUDED.host, release = EXCLUDED.release, holding = EXCLUDED.holding`,
    [state, rows.map(r => r.dataset), rows.map(r => r.row), rows.map(r => JSON.stringify(r.holding)), release]);
  };
  for (const [index, dataset] of DATASETS.entries()) {
    const note = readFileSync(notePath(dataset), "utf8");
    const url = /Source URL[^\n]*?(https:\/\/\S+)/.exec(note)?.[1];
    if (!url) throw new Error(`Source URL absent from ${dataset}'s held source note.`);
    let header: string[] | null = null, record = "", row = 0;
    for await (const line of createInterface({ input: createReadStream(dataPath(dataset)), crlfDelay: Infinity })) {
      record += `${line}\n`;
      if ((record.match(/"/g)?.length ?? 0) % 2) continue;
      const values = parseCsv(record)[0]; record = "";
      if (!header) { header = values; continue; }
      row++;
      const fields = Object.fromEntries(header.map((name, i) => [name, values[i] ?? ""]));
      if (!stale.has(fields.state.toLowerCase())) continue;
      const holding = censusPublisherSize(fields, { url, dataset, sha256: hashes[index]!, archiveSha256, row, sheet: fields.source_sheet });
      if (!holding) continue;
      const rows = pending.get(holding.state) ?? [];
      rows.push({ dataset, row, holding });
      pending.set(holding.state, rows);
      await flush(holding.state, false);
    }
    if (record.trim()) throw new Error(`Incomplete quoted CSV record in ${dataset}.`);
  }
  for (const state of stale) {
    await flush(state, true);
    await db.transaction(async query => {
      await query("DELETE FROM publisher_size WHERE state = $1 AND release <> $2", [state, release]);
      await query(`INSERT INTO fact_store_load (source, sha256) VALUES ($1, $2)
        ON CONFLICT (source) DO UPDATE SET sha256 = EXCLUDED.sha256, loaded_at = now()`, [`publisher-size:${state}`, release]);
    });
  }
  return [...stale];
}
