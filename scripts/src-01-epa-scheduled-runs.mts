/** SRC-01 EPA proof: the real scheduled refreshEchoNational against the live publisher into isolated stores (production read-only for
 * registrations), then the normal GET /api/open-data reader in every US jurisdiction; run twice to prove the next scheduled run.
 * Usage: NODE_USE_ENV_PROXY=1 node --experimental-strip-types --import ./scripts/register-test-loader.mjs scripts/src-01-epa-scheduled-runs.mts <work-root> */
import assert from "node:assert/strict";
import { mkdir, writeFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { neon } from "@neondatabase/serverless";
import { US_JURISDICTIONS } from "../lib/coverage/states.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { DurableEvidenceStore } from "../lib/control-plane/evidence/durable-store.ts";
import { readRegistrationProjection } from "../lib/registration/reader.ts";
import { governmentJoinRows } from "../lib/sources/open-data/portals.ts";
import type { GovernmentJoin } from "../lib/sources/open-data/normalize.ts";
import { OpenDataSpool } from "../lib/sources/open-data/spool.ts";
import { readOpenDataPartition } from "../lib/sources/open-data/artifacts.ts";
import { readOpenDataProjection } from "../lib/sources/open-data/publication.ts";
import { requiredRoutineContract } from "../lib/civic-data/contracts.ts";
import { verifyRoutineReaderProjection } from "../lib/civic-data/reader-verification.ts";
import { installReaderDatabaseQuery } from "../lib/reader/database.ts";
import { readZipLocation } from "../lib/place-map/locations.ts";
import { openDataArchiveStore, refreshEchoNational } from "./open-data-refresh.mts";
import { FederalMoneyBenchmarkStore } from "./lib/federal-money-benchmark-store.mts";
import { installOpenDataReaderSql, installOpenDataReplayMap, installOpenDataReplayVault, normalOpenDataPage } from "./lib/open-data-replay-reader.mts";
import { compressedReplayVault } from "./lib/open-data-replay-vault.mts";

const root = process.argv[2]; assert.ok(root, "work root required");
const output = join(root, "epa-proof.json");
await mkdir(root, { recursive: true });
const connection = process.env.WTP_PRODUCTION_DATABASE_URL_READONLY!;
const access = (await neon(connection).query("SELECT current_user::text AS role, has_table_privilege(current_user,'public.civic_data_candidates','INSERT, UPDATE, DELETE') AS can_write"))[0];
assert.match(String(access.role), /^readonly/); assert.equal(access.can_write, false);
installOpenDataReplayMap(connection);
const before = await neon(connection).query("SELECT count(*)::int AS promotions FROM civic_data_promotions WHERE source_id='epa-echo'");
process.env.DATABASE_URL = connection; process.env.WTP_CIVIC_READ_CACHE_URL = "";
const production = new PostgresRoutineDataStore();
const joins = new Map<string, GovernmentJoin[]>(), registrations: Record<string, string> = {};
for (const { usps } of US_JURISDICTIONS) {
  const registration = await readRegistrationProjection(usps, { store: production, bypassCache: true });
  registrations[usps] = registration.kind;
  joins.set(usps, registration.kind === "PROMOTED" ? governmentJoinRows(registration.value.governments ?? []) : []);
}
const proof: Record<string, unknown> = { productionRole: access.role, productionWritePrivilege: access.can_write, productionEpaPromotionsBefore: before[0].promotions, registrations, runs: [] };
const save = () => writeFile(output, JSON.stringify(proof, null, 2));
const store = await FederalMoneyBenchmarkStore.open(join(root, "reader-pglite"), "epa-echo", "epa-echo");
const vault = compressedReplayVault(join(root, "reader-vault")), archiveVault = new DurableEvidenceStore(join(root, "archive-vault"), { remote: null });
async function diskBytes(path: string): Promise<number> { let bytes = 0; for (const entry of await readdir(path, { withFileTypes: true })) { const at = join(path, entry.name); bytes += entry.isDirectory() ? await diskBytes(at) : (await stat(at)).size; } return bytes; }
try {
  for (const label of ["first scheduled run", "next scheduled run"]) {
    const started = performance.now(), spool = await OpenDataSpool.create(), requests: { status: number; conditional: string | null }[] = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => { const response = await fetch(url, init); requests.push({ status: response.status, conditional: new Headers(init?.headers).get("if-none-match") }); return response; }) as typeof fetch;
    let result;
    try { result = await refreshEchoNational({ store, vault, archive: openDataArchiveStore(archiveVault), spool, signal: AbortSignal.timeout(90 * 60_000), now: () => new Date().toISOString(), readStateJoins: async state => joins.get(state) ?? [], fetchImpl }); }
    finally { await spool.dispose(); }
    const elapsedMs = Math.round(performance.now() - started);
    const projection = await readOpenDataProjection("epa-echo", "national", { store, bypassCache: true });
    assert.equal(projection.kind, "PROMOTED"); if (projection.kind !== "PROMOTED") throw Error("unpublished");
    const typed = await verifyRoutineReaderProjection(requiredRoutineContract("epa-echo"), { store, now: new Date().toISOString(), expectedVersionId: projection.metadata.versionId! });
    const run: Record<string, unknown> = { label, elapsedMs, requests, unchanged: result.unchanged, promoted: !!result.publication.outcome.promoted, confirmed: !!result.publication.outcome.confirmed,
      candidateState: result.publication.outcome.candidate.state, versionId: projection.metadata.versionId, typedReader: typed.status, gaps: result.gaps.map(gap => ({ id: gap.id, state: gap.state, reason: gap.fact.detail })),
      partitions: projection.value.partitions?.length ?? 0, published: projection.value.reports.reduce((n, r) => n + r.loaded, 0), archiveKeys: (await archiveVault.list("project/freshness/source/src-so/archive/")).length,
      archiveDiskBytes: await diskBytes(join(root, "archive-vault")), states: [] as Record<string, unknown>[] };
    (proof.runs as unknown[]).push(run); await save();
    // The normal public reader: GET /api/open-data -> reader SQL -> Netlify SDK over the isolated vault.
    await installOpenDataReaderSql(store.query); installReaderDatabaseQuery(store.query);
    const transport = installOpenDataReplayVault(vault);
    try {
      const byState = new Map<string, string[]>();
      for (const reference of projection.value.partitions ?? []) { const m = /^zip:\d+:state:([A-Z]{2}):/.exec(reference.id); if (m) byState.set(m[1], [...byState.get(m[1]) ?? [], reference.id]); }
      for (const report of [...projection.value.reports].sort((a, b) => a.state.localeCompare(b.state))) {
        const row: Record<string, unknown> = { state: report.state, loaded: report.loaded, joined: report.joined, unjoined: report.unjoined };
        (run.states as Record<string, unknown>[]).push(row);
        if (!US_JURISDICTIONS.some(j => j.usps === report.state) || !report.loaded) continue;
        try {
          let sample: { id: string; zip: string } | null = null;
          for (const id of byState.get(report.state) ?? []) {
            const reference = projection.value.partitions!.find(p => p.id === id)!;
            const part = await readOpenDataPartition("epa-echo", reference, vault);
            for (const hit of part.records) if (hit.zip && await readZipLocation(hit.zip)) { sample = { id: hit.id, zip: hit.zip }; break; }
            if (sample) break;
          }
          if (!sample) { row.reader = "NO_USABLE_ZIP"; continue; }
          const page = await normalOpenDataPage(sample.zip, sample.id);
          row.reader = { status: "PASS", zip: sample.zip, id: sample.id, title: page.row.title, pages: page.pages, ms: Math.round(page.elapsedMs) };
        } catch (error) { row.reader = { status: "FAIL", error: String(error instanceof Error ? error.message : error).slice(0, 500) }; }
        console.log(JSON.stringify({ label, ...row }));
      }
    } finally { transport.restore(); installReaderDatabaseQuery(undefined); }
    run.readerPass = (run.states as { reader?: { status?: string } }[]).filter(r => r.reader?.status === "PASS").length;
    run.readerFail = (run.states as { reader?: { status?: string } | string }[]).filter(r => typeof r.reader === "object" && r.reader?.status === "FAIL").map(r => (r as { state: string }).state);
    await save(); console.log(JSON.stringify({ label, elapsedMs, unchanged: run.unchanged, promoted: run.promoted, confirmed: run.confirmed, published: run.published, readerPass: run.readerPass, readerFail: run.readerFail }));
  }
} finally { await store.close(); await save(); }
