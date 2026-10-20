/** Read-only RH-01 comparison of the exact national and state FEC projections.
 * This checks source/identity/amount preservation; it is not a runner peak measurement. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { neon } from "@neondatabase/serverless";
import { enableProductionReadAccounting } from "./rh01-network.mjs";
import { fecBulkUrls, parseFecBulk } from "../lib/funding/fec-bulk.ts";
import { projectFecDiscovery } from "../lib/funding/fec-collector.ts";
import { readFecStateSnapshot } from "../lib/funding/fec-state-read.ts";
import { REGISTRY_STATES } from "../lib/civic-data/state-scopes.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { federalDirectoryScope, type FederalDirectoryReadModel } from "../lib/officials/federal-directory-data-plane.ts";
import { installReaderDatabaseQuery } from "../lib/reader/database.ts";
import type { FundingCandidate, FundingSnapshot } from "../lib/funding/types.ts";
import type { OfficeholderSet } from "../lib/officials/types.ts";

enableProductionReadAccounting("fec-parity-preparation");
const option = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const beforeRoot = resolve(option("before") ?? "/tmp/rh01-before"), directory = resolve(option("output") ?? ".scratch/rh01/fec-production-parity");
const cycle = Number(option("cycle") ?? "2026"), connection = process.env.WTP_PRODUCTION_DATABASE_URL_READONLY;
if (!connection || decodeURIComponent(new URL(connection).username) !== "readonly") throw Error("RH01 FEC parity requires the production reader role");
process.env.DATABASE_URL = connection;
await mkdir(directory, { recursive: true });
const sql = neon(connection);
let readerBytes = 0;
installReaderDatabaseQuery(async statements => {
  const rows = [];
  for (const statement of statements) {
    assert.match(statement.text, /^\s*(?:SELECT|WITH)\b/i);
    assert.doesNotMatch(statement.text, /\b(?:INSERT|UPDATE|DELETE|MERGE|CALL)\b/i);
    const result = await sql.query(statement.text, [...statement.params]);
    readerBytes += Buffer.byteLength(JSON.stringify(result)); rows.push(result);
  }
  return rows;
});
const { fecBulkText, parseFecBulk: parseBefore } = await import(pathToFileURL(join(beforeRoot, "lib/funding/fec-bulk.ts")).href);
const { projectFecDiscovery: projectBefore } = await import(pathToFileURL(join(beforeRoot, "lib/funding/fec-collector.ts")).href);
const source = [];
for (const [name, url] of Object.entries(fecBulkUrls(cycle))) {
  const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(120_000) });
  if (!response.ok || !response.body) throw Error(`FEC_SOURCE_${response.status}:${url}`);
  const path = join(directory, `${name}.zip`), hash = createHash("sha256"); let bytes = 0;
  await pipeline(Readable.fromWeb(response.body as import("node:stream/web").ReadableStream), new Transform({ transform(chunk, _encoding, done) { hash.update(chunk); bytes += chunk.length; done(null, chunk); } }), createWriteStream(path));
  source.push({ name, url, finalUrl: response.url, path, bytes, sha256: hash.digest("hex"), retrievedAt: new Date().toISOString(), sourceObservedAt: response.headers.get("last-modified") });
}
await writeFile(join(directory, "sources.json"), JSON.stringify(source, null, 2) + "\n");
const observedAt = source.map(row => row.sourceObservedAt ? new Date(row.sourceObservedAt).toISOString() : row.retrievedAt).sort()[0];
const master = source.find(row => row.name === "master")!, summary = source.find(row => row.name === "summary")!;
const before = parseBefore(fecBulkText(await readFile(master.path), "cn.txt"), fecBulkText(await readFile(summary.path), `weball${String(cycle).slice(-2)}.txt`), cycle, observedAt);
const store = new PostgresRoutineDataStore();
const priorPublication = await store.readPromotion<FundingSnapshot>("FEC_FUNDING", "federal-supported");
const prior = priorPublication?.payload ?? JSON.parse(await readFile(join(beforeRoot, "data/fec/fec-2026.json"), "utf8")) as FundingSnapshot;
const rosters = new Map<string, OfficeholderSet>();
for (const state of REGISTRY_STATES) {
  const directory = await store.readPromotion<FederalDirectoryReadModel>("FEDERAL_DIRECTORY", federalDirectoryScope(state));
  if (directory) rosters.set(state, directory.payload.roster);
}
const places = [...rosters.values()], roster = places.length ? { ...places[0], officeholders: places.flatMap(row => row.officeholders), divisions: places.flatMap(row => row.divisions), unmatched: places.flatMap(row => row.unmatched) } : undefined;
const expected = projectBefore(before, cycle, roster, prior.candidates) as FundingCandidate[];
const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, held]) => `${JSON.stringify(key)}:${stable(held)}`).join(",")}}`;
  return JSON.stringify(value);
};
const summaryOf = (rows: readonly FundingCandidate[]) => {
  const sorted = [...rows].sort((a, b) => a.fecCandidateId.localeCompare(b.fecCandidateId));
  return { candidates: rows.length, people: new Set(rows.flatMap(row => row.targetKeys.filter(key => key.startsWith("congress:")))).size,
    nativeCandidateIdsSha256: createHash("sha256").update(stable(sorted.map(row => row.fecCandidateId))).digest("hex"),
    fullRecordsSha256: createHash("sha256").update(stable(sorted)).digest("hex"),
    filedTotals: rows.filter(row => row.acquisition?.totalsComplete).length,
    totalsSha256: createHash("sha256").update(stable(sorted.map(row => ({ id: row.fecCandidateId, totals: row.totals })))).digest("hex") };
};
const actual: FundingCandidate[] = [], states = [];
for (const state of REGISTRY_STATES) {
  const discovery = await parseFecBulk(master.path, summary.path, cycle, observedAt, state);
  const current = await readFecStateSnapshot(state, { store, bypassCache: true });
  if (current.kind !== "PROMOTED" && current.kind !== "NOT_RECORDED") throw Error(`FEC_PRIOR_${state}:${current.kind}`);
  const previous = current.kind === "PROMOTED" ? current.value.candidates : [];
  const rows = projectFecDiscovery(discovery, cycle, rosters.get(state), previous);
  const wanted = expected.filter(row => row.state === state);
  assert.deepEqual(summaryOf(rows), summaryOf(wanted), `FEC identity/amount/projection changed for ${state}`);
  actual.push(...rows); states.push({ state, ...summaryOf(rows) });
  await writeFile(join(directory, "progress.json"), JSON.stringify({ completedStates: states.length, totalStates: REGISTRY_STATES.length, states }, null, 2) + "\n");
}
const beforeSummary = summaryOf(expected), afterSummary = summaryOf(actual);
assert.deepEqual(afterSummary, beforeSummary);
const report = { complete: true, measuredAt: new Date().toISOString(), cycle, baseline: "011443fad6cfca5bb943f5c307925808fc8974c4", productionPriorVersion: priorPublication?.versionId ?? null,
  priorSource: priorPublication ? "production" : "baseline-shipped-seed", sources: source, before: beforeSummary, after: afterSummary, states, readerBytes,
  limitation: "Exact source discovery/projection and prior preservation comparison; optional committee/receipt acquisition and complete runner memory remain separate required measurements." };
await writeFile(join(directory, "results.json"), JSON.stringify(report, null, 2) + "\n");
console.log(`RH01_FEC_PARITY ${JSON.stringify(report)}`);
