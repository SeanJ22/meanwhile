/** Partition already-held Census publisher facts; no network or country inventory in memory. */
import { createReadStream, closeSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { parseCsv } from "../lib/reference/index.ts";
import { dataPath, notePath } from "./lib/reference-paths.ts";
import { US_JURISDICTIONS } from "../lib/coverage/states.ts";
import { censusPublisherSize } from "../lib/sources/publisher-size.ts";

const selected = process.argv.find(arg => arg.startsWith("--states="))?.slice(9);
if (!selected) throw new Error("Pass --states=<postal codes> or --states=all; only held counts will be written.");
const states = new Set(selected === "all" ? US_JURISDICTIONS.map(j => j.slug) : selected.toLowerCase().split(","));
for (const state of states) if (!US_JURISDICTIONS.some(j => j.slug === state)) throw new Error(`Unknown state: ${state}`);
const mainNote = readFileSync(notePath("census_govt_units_2022"), "utf8");
const archiveSha256 = /`sha256\([^)]*\)`\s*=\s*`([a-f0-9]{64})`/.exec(mainNote)?.[1];
if (!archiveSha256) throw new Error("The held Census source note has no archive identity.");
const files = new Map<string, { fd: number; path: string; temporary: string; rows: number }>();
try {
  for (const dataset of ["census_govt_units_2022", "census_govt_units_2022_dependent_school_systems"] as const) {
    const note = readFileSync(notePath(dataset), "utf8");
    const url = /Source URL[^\n]*?(https:\/\/\S+)/.exec(note)?.[1];
    if (!url) throw new Error(`Source URL absent from ${dataset}'s held source note.`);
    const digest = createHash("sha256");
    for await (const chunk of createReadStream(dataPath(dataset))) digest.update(chunk);
    const sha256 = digest.digest("hex");
    let header: string[] | null = null, record = "", row = 0;
    for await (const line of createInterface({ input: createReadStream(dataPath(dataset)), crlfDelay: Infinity })) {
      record += `${line}\n`;
      if ((record.match(/"/g)?.length ?? 0) % 2) continue;
      const values = parseCsv(record)[0]; record = "";
      if (!header) { header = values; continue; }
      row++;
      const fields = Object.fromEntries(header.map((name, i) => [name, values[i] ?? ""]));
      if (!states.has(fields.state.toLowerCase())) continue;
      const holding = censusPublisherSize(fields, { url, dataset, sha256, archiveSha256, row, sheet: fields.source_sheet });
      if (!holding) continue;
      let file = files.get(holding.state);
      if (!file) {
        const path = join(process.cwd(), "data", "states", holding.state, "reference", "publisher-sizes.jsonl");
        mkdirSync(dirname(path), { recursive: true });
        const temporary = `${path}.tmp`;
        file = { fd: openSync(temporary, "w"), path, temporary, rows: 0 };
        files.set(holding.state, file);
      }
      writeSync(file.fd, `${JSON.stringify(holding)}\n`); file.rows++;
    }
    if (record.trim()) throw new Error(`Incomplete quoted CSV record in ${dataset}.`);
  }
} finally { for (const file of files.values()) closeSync(file.fd); }
for (const [state, file] of files) {
  renameSync(file.temporary, file.path);
  console.log(`${state}: ${file.rows} sourced publisher rows`);
}
// A source removal replaces old data too; states with no rows have no known size.
for (const state of states) if (!files.has(state)) {
  const path = join(process.cwd(), "data", "states", state, "reference", "publisher-sizes.jsonl");
  try { unlinkSync(path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}
