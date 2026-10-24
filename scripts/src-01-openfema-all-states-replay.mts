import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { neon } from "@neondatabase/serverless";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FederalMoneySection } from "../components/funding/federal-money-section.tsx";
import { requiredRoutineContract } from "../lib/civic-data/contracts.ts";
import { routineTaskDue, routineTaskFromContract } from "../lib/civic-data/runner.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { DurableEvidenceStore } from "../lib/control-plane/evidence/durable-store.ts";
import { acquireFederalMoney } from "../lib/federal-money/acquire.ts";
import { parseFederalMoney } from "../lib/federal-money/parse.ts";
import { saveFederalMoneyCapture } from "../lib/federal-money/vault.ts";
import { publishFederalMoneyPartition, publishFederalMoneyProgress } from "../lib/federal-money/edge-publication.ts";
import type { FederalMoneyJoinInput } from "../lib/federal-money/join.ts";
import type { FederalMoneyProjection, FederalMoneyPage } from "../lib/federal-money/model.ts";
import { readFederalMoneyForPlace } from "../lib/federal-money/reader.ts";
import { refreshFederalMoney } from "../lib/federal-money/refresh.ts";
import { FEDERAL_MONEY_CONFIG, federalMoneySourceStates } from "../lib/federal-money/sources.ts";
import { federalMoneyStateDivision } from "../lib/federal-money/view.ts";
import { LocalFileArtifactStore } from "../lib/meetings/edge-store.ts";

const source = "openfema", configuredStates = federalMoneySourceStates(source);
const output = process.argv.find(value => value.startsWith("--output="))?.slice(9) ?? "docs/measurements/src-01/openfema-all-states.json";
const mergePaths = process.argv.find(value => value.startsWith("--merge-parts="))?.slice(14).split(",");
if (mergePaths) {
  const harnessPath = process.argv.find(value => value.startsWith("--harness-failures="))?.slice(19);
  const parts = await Promise.all(mergePaths.map(async path => JSON.parse(await readFile(path, "utf8"))));
  type ReplayState = { state: string; status: string; observedAt?: string; sourceRows?: number; exactCountyRows?: number; stateOnlyRows?: number; failure?: string;
    runs: { candidateState: string; counts?: { loaded: number } }[] };
  const byState = new Map<string, ReplayState>(parts.flatMap(part => (part.states as ReplayState[]).map(state => [state.state, state] as const)));
  const states = configuredStates.map(state => byState.get(state) ?? { state, status: "PENDING", runs: [] });
  const counts = { configuredJurisdictions: configuredStates.length, passed: states.filter(state => state.status === "PASS").length,
    failed: states.filter(state => state.status === "FAIL").length, pending: states.filter(state => !["PASS", "FAIL"].includes(state.status)).length,
    publishedRecords: states.reduce((sum, state) => sum + Number(state.sourceRows ?? 0), 0),
    exactCountyRecords: states.reduce((sum, state) => sum + Number(state.exactCountyRows ?? 0), 0),
    stateOnlyRecords: states.reduce((sum, state) => sum + Number(state.stateOnlyRows ?? 0), 0),
    promotedRuns: states.reduce((sum, state) => sum + state.runs.filter((run: { candidateState: string }) => run.candidateState === "PROMOTED").length, 0) };
  const merged = { ...parts[0], observedAt: states.flatMap(state => state.observedAt ? [state.observedAt] : []).sort()[0] ?? parts.map(part => part.observedAt).sort()[0], workingRoot: undefined, workingRoots: parts.map(part => part.workingRoot),
    completedAt: parts.every(part => part.completedAt) ? parts.map(part => part.completedAt).sort().at(-1) : null, boundedWorkers: parts.length,
    replayCommand: "TMPDIR=/workspace/src01-scratch node --use-env-proxy --experimental-strip-types --import ./scripts/register-test-loader.mjs scripts/src-01-openfema-all-states-replay.mts --readonly-url-file=/path/to/existing-production-readonly-url",
    harnessInterruptions: harnessPath ? [JSON.parse(await readFile(harnessPath, "utf8"))] : [],
    counts, failures: states.filter(state => state.status !== "PASS").map(state => ({ state: state.state, status: state.status, reason: state.failure ?? "Replay not complete", actualPublishedRows: state.runs.at(-1)?.counts?.loaded ?? null })),
    states };
  await writeFile(output, JSON.stringify(merged, null, 2) + "\n");
  console.log(JSON.stringify({ output, counts, failures: merged.failures }));
  process.exit(counts.failed || counts.pending ? 1 : 0);
}
const selected = process.argv.find(value => value.startsWith("--states="))?.slice(9).split(",") ?? [...configuredStates];
if (selected.some(state => !configuredStates.includes(state))) throw new Error("Only configured source states may be replayed.");
const connectionPath = process.argv.find(value => value.startsWith("--readonly-url-file="))?.slice(20) ?? "/tmp/src-01-prod-readonly-url";
const heldPath = process.argv.find(value => value.startsWith("--held-manifest="))?.slice(16);
type HeldCapture = { rawHash: string; url: string; retrievedAt: string; byteLength: number };
type HeldState = { state: string; localArtifacts: string; productionRegistrationVersion: string; captures: HeldCapture[]; originalFailure?: unknown };
const heldManifest = heldPath ? JSON.parse(await readFile(heldPath, "utf8")) as { states: HeldState[] } : null;
const connection = (await readFile(connectionPath, "utf8")).trim();
const sql = neon(connection);
const query = async (text: string, params: unknown[] = []) => (await sql.transaction([sql.query(text, params)], { readOnly: true }))[0];
const [identity] = await query("SELECT current_user AS role, current_setting('transaction_read_only') AS read_only");
assert.match(String(identity.role), /^readonly(?:_|$)/); assert.equal(identity.read_only, "on");
const revision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const workingRoot = await mkdtemp(join(tmpdir(), "src-01-openfema-all-"));
const task = routineTaskFromContract(requiredRoutineContract(source));
const baseTime = new Date().toISOString();
const report: Record<string, unknown> & { states: Record<string, unknown>[] } = {
  source, revision, observedAt: baseTime, configuredStates, cadenceMs: FEDERAL_MONEY_CONFIG.openfema.everyMs,
  cadenceCorrection: "OpenFEMA is scheduled every20minutes. Daily is not the configured cadence. This replay checks both the next20minute admission and tomorrow separately.",
  productionReadOnly: { role: identity.role, transactionReadOnly: identity.read_only, identitySource: "civic_data_promotions REGISTRATION, one configured state per query" },
  upstream: "OpenFEMA state-filtered DisasterDeclarationsSummaries, every source page, joined to the state's real production Census county identities",
  downstream: "registered source publication -> local reader artifacts -> readFederalMoneyForPlace -> actual FederalMoneySection card renderer",
  limitations: "All writes are local replay data. Controlled future clocks test admission, retention and publication with real current source responses; they do not predict future publisher updates or prove a deployed scheduled run.",
  inputMode: heldManifest ? "Saved real publisher bytes with original URL/time/hash. No publisher network requests. Later runs use previously held incremental responses when available, otherwise repeat the full saved response as a superset." : "Live read-only publisher requests",
  heldManifest: heldPath ?? null,
  workingRoot, states: [],
};
try { const prior = JSON.parse(await readFile(output, "utf8")); report.states = prior.states.filter((row: { state: string }) => !selected.includes(row.state)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
const save = async () => {
  report.states.sort((a, b) => String(a.state).localeCompare(String(b.state)));
  const temporary = `${output}.${process.pid}.tmp`;
  try { await writeFile(temporary, JSON.stringify(report, null, 2) + "\n"); await rename(temporary, output); }
  finally { await rm(temporary, { force: true }); }
};
await mkdir("docs/measurements/src-01", { recursive: true });
const systemNow = Date.now;
try {
  for (const state of selected) {
    const stateReport: Record<string, unknown> = { state, observedAt: new Date(systemNow()).toISOString(), status: "RUNNING", runs: [] };
    report.states.push(stateReport); await save();
    let clock: string | null = null;
    Date.now = () => clock === null ? systemNow() : Date.parse(clock);
    try {
      const [held] = await query("SELECT p.current_version_id, COALESCE(jsonb_agg(jsonb_build_object('ocdId', d->>'ocdId', 'geoid', d->>'geoid', 'divisionType', d->>'divisionType')) FILTER (WHERE d->>'divisionType' = 'county' AND d->>'geoid' ~ '^[0-9]{5}$'), '[]'::jsonb) AS divisions FROM civic_data_promotions p LEFT JOIN LATERAL jsonb_array_elements(p.payload->'divisions') d ON true WHERE p.record_class = 'REGISTRATION' AND p.scope = $1 GROUP BY p.current_version_id", [`US-${state}:registration:v1`]);
      const divisions = (held?.divisions ?? []) as FederalMoneyJoinInput["divisions"];
      stateReport.productionRegistrationVersion = held?.current_version_id ?? null;
      stateReport.productionCounties = divisions.length;
      const heldState = heldManifest?.states.find(row => row.state === state);
      if (heldManifest) {
        assert.ok(heldState, `No saved source captures for ${state}.`);
        assert.equal(heldState.productionRegistrationVersion, held?.current_version_id, "Production county identity versions must match the original capture replay.");
        if (heldState.originalFailure) stateReport.priorAcquisitionFailure = heldState.originalFailure;
      }
      const stateRoot = join(workingRoot, state), evidenceStore = new DurableEvidenceStore(join(stateRoot, "vault"), { remote: null });
      const artifactStore = new LocalFileArtifactStore(join(stateRoot, "edge")), store = new MemoryRoutineDataStore();
      const factsByCounty = new Map<string, Set<string>>(), allIds = new Set<string>(), requests: Record<string, unknown>[] = [];
      const byGeoid = new Map(divisions.map(division => [division.geoid, division.ocdId]));
      const visibleDivision = federalMoneyStateDivision(state);
      let firstVisibleId: string | null = null, firstReaderVersion: string | null = null;
      const captures: Record<string, unknown>[] = [];
      stateReport.captures = captures; stateReport.requests = requests;
      const input = { source: source as "openfema", store, states: [state], now: () => clock ?? new Date(systemNow()).toISOString(),
        acquireOptions: { evidenceStore, cacheRoot: join(stateRoot, "cache") },
        identities: async () => ({ divisions, bodies: [], governments: [] }),
        acquire: async (_source: Parameters<typeof acquireFederalMoney>[0], _state: string, options: Parameters<typeof acquireFederalMoney>[2]) => {
          let page: FederalMoneyPage;
          if (heldState) {
            const offset = options?.cursor?.offset ?? 0;
            const incremental = Boolean(options?.since ?? options?.cursor?.since);
            const deltas = heldState.captures.filter(row => new URL(row.url).searchParams.get("$filter")?.includes("lastRefresh"));
            const inputs = incremental && deltas.length ? deltas : heldState.captures.filter(row => !new URL(row.url).searchParams.get("$filter")?.includes("lastRefresh"));
            const saved = inputs.find(row => Number(new URL(row.url).searchParams.get("$skip") ?? 0) === offset);
            assert.ok(saved, `No saved ${incremental && deltas.length ? "incremental" : "full"} page for ${state} offset${offset}.`);
            const bytes = await readFile(join(heldState.localArtifacts, "vault", "project/meanwhile/source/federal-money", saved.rawHash));
            assert.equal(bytes.length, saved.byteLength); assert.equal(createHash("sha256").update(bytes).digest("hex"), saved.rawHash);
            const body = bytes.toString("utf8"), native = JSON.parse(body);
            const capture = await saveFederalMoneyCapture({ body, url: saved.url, retrievedAt: saved.retrievedAt, publicationDate: null }, evidenceStore);
            const facts = parseFederalMoney(source, capture, state, body), total = native.metadata.count;
            assert.ok(Number.isSafeInteger(total) && total >= 0);
            const complete = offset + facts.length >= total;
            page = { facts, captures: [capture], declaredTotal: total, complete, continuation: complete ? null : { source, phase: "declarations", offset: offset + facts.length, ...(incremental ? { since: options?.since ?? options?.cursor?.since } : {}) } };
            requests.push({ url: saved.url, status: 200, observedAt: saved.retrievedAt, kind: "held-capture", input: incremental && deltas.length ? "saved-incremental-response" : "saved-full-response" });
          } else page = await acquireFederalMoney(_source, _state, { ...options, now: () => new Date(systemNow()).toISOString(),
            fetch: async (url, init) => { const response = await fetch(url, init); requests.push({ url: String(url), status: response.status, observedAt: new Date(systemNow()).toISOString(), kind: "publisher-request" }); return response; } });
          for (const capture of page.captures) captures.push({ rawHash: capture.rawHash, url: capture.url, retrievedAt: capture.retrievedAt, byteLength: capture.byteLength });
          for (const fact of page.facts) {
            allIds.add(fact.id);
            for (const geography of fact.geography) {
              const division = geography.type === "county" ? byGeoid.get(geography.geoid) : null;
              if (!division) continue;
              const ids = factsByCounty.get(division) ?? new Set<string>(); ids.add(fact.id); factsByCounty.set(division, ids);
            }
          }
          stateReport.acquiredRows = allIds.size;
          return page;
        },
        onPartition: (change: { projection: FederalMoneyProjection; previous: FederalMoneyProjection | null; versionId: string; checkedAt: string }) => publishFederalMoneyPartition({ ...change, store: artifactStore }),
        onProgress: (row: { state: string; status: string; reason: string | null }, checkedAt: string) => publishFederalMoneyProgress({ store: artifactStore, state: row.state, source, checkedAt, complete: row.status === "COMPLETE", reason: row.reason }),
      };
      let initialSucceededAt = "";
      for (const [index, offset] of [0, task.cadenceMs, 24 * 60 * 60_000].entries()) {
        clock = index ? new Date(Date.parse(initialSucceededAt) + offset).toISOString() : null;
        let due = true;
        if (index) { assert.ok(clock); const previous = await store.clock(task.sourceId, task.recordClass, task.scope, task.parserVersion); due = routineTaskDue(task, previous, Date.parse(clock)); assert.ok(due, "The next configured source run must be admitted."); }
        const start = requests.length, result = await refreshFederalMoney(input);
        if (index === 0) {
          const publishedClock = await store.clock(task.sourceId, task.recordClass, task.scope, task.parserVersion);
          initialSucceededAt = publishedClock.lastSucceededObservedAt ?? result.outcome.candidate.candidate.retrieval.retrievedAt;
          assert.ok(captures.every(capture => Date.parse(String(capture.retrievedAt)) <= Date.parse(result.outcome.candidate.candidate.retrieval.retrievedAt)), "Initial publication must follow every actual source observation.");
        }
        const run: Record<string, unknown> = { kind: ["initial", "next20minutes", "tomorrow"][index], replayAt: result.outcome.candidate.candidate.retrieval.retrievedAt, schedulerDue: due, requests: requests.length - start,
          candidateState: result.outcome.candidate.state, counts: result.projection.counts, status: result.projection.states[0]?.status ?? null,
          reason: result.outcome.candidate.failureDetail ?? result.projection.states[0]?.reason ?? null, readerReadback: result.outcome.readerReadback?.status ?? null };
        (stateReport.runs as unknown[]).push(run); await save();
        assert.ok(result.outcome.promoted, result.outcome.candidate.failureDetail ?? "The registered source did not promote.");
        assert.equal(result.projection.states[0].status, "COMPLETE");
        assert.equal(result.projection.counts.loaded, allIds.size, "Every acquired native record must remain published.");
        assert.ok(run.requests as number > 0, "The next run must actually read the source.");
        if (allIds.size) {
          assert.ok(visibleDivision, "The configured jurisdiction must have an exact reader state division.");
          const readerStart = performance.now();
          const reader = await readFederalMoneyForPlace({ divisionId: visibleDivision }, { artifactStore });
          const native = reader.sources.find(row => row.source === source)!;
          assert.equal(native.status, "HELD"); assert.ok(native.records.length > 0);
          const html = renderToStaticMarkup(createElement(FederalMoneySection, { divisionId: visibleDivision, data: reader }));
          assert.ok(html.includes(`data-federal-record="${native.records[0].id}"`));
          const usableMs = performance.now() - readerStart;
          assert.ok(usableMs < 3000, "The cold reader card must be usable within3seconds.");
          if (index === 0) { firstVisibleId = native.records[0].id; firstReaderVersion = native.versionId; }
          let page = reader, retained = native.records.some(fact => fact.id === firstVisibleId), pages = 1;
          const ids = new Set(native.records.map(fact => fact.id));
          const retainedSnapshot = index > 0 && native.versionId === firstReaderVersion;
          if (!retainedSnapshot) while (page.nextCursor) { page = await readFederalMoneyForPlace({ divisionId: visibleDivision }, { artifactStore, cursor: page.nextCursor }); for (const fact of page.sources.find(row => row.source === source)!.records) ids.add(fact.id); retained ||= ids.has(firstVisibleId!); pages++; }
          if (!retainedSnapshot) { assert.equal(ids.size, allIds.size, "Every published native record must be reachable through the state reader's actual pagination."); assert.ok([...allIds].every(id => ids.has(id))); }
          assert.ok(retained, "The accepted initial record must remain reachable through reader pagination.");
          const htmlPath = join(stateRoot, `${run.kind}.html`); await writeFile(htmlPath, html);
          run.reader = { divisionId: visibleDivision, firstPageRows: native.records.length, allReachableRows: allIds.size, immutableInitialSnapshotRetained: retainedSnapshot, readerVersion: native.versionId, initialRecordRetained: retained, usableMs: Math.round(usableMs), htmlPath, htmlSha256: createHash("sha256").update(html).digest("hex"), paginationPagesChecked: pages };
        } else run.reader = { status: "NO_SOURCE_ROWS", reason: "The real publisher returned zero records for this configured jurisdiction; no reader record is claimed." };
      }
      if (captures.length) {
        const firstCapture = await evidenceStore.get(`project/meanwhile/source/federal-money/${captures[0].rawHash}`);
        assert.ok(firstCapture);
        const raw = JSON.parse(Buffer.from(firstCapture.bytes).toString("utf8"));
        stateReport.publisherDeclaredInitialRows = raw.metadata?.count ?? null;
        stateReport.initialRecordCountReconciles = raw.metadata?.count === (stateReport.runs as { counts: { loaded: number } }[])[0].counts.loaded;
        assert.ok(stateReport.initialRecordCountReconciles, "Publisher initial declared count must match every actual promoted record.");
      }
      stateReport.status = "PASS";
      stateReport.sourceRows = allIds.size;
      stateReport.sourceCountyMatches = factsByCounty.size;
      stateReport.exactCountyRows = new Set([...factsByCounty.values()].flatMap(ids => [...ids])).size;
      stateReport.stateOnlyRows = allIds.size - Number(stateReport.exactCountyRows);
      stateReport.captures = captures; stateReport.requests = requests;
      stateReport.localArtifacts = stateRoot;
      stateReport.processPeakRssKiB = process.resourceUsage().maxRSS;
    } catch (error) { stateReport.status = "FAIL"; stateReport.failure = error instanceof Error ? error.message : String(error); }
    await save();
    console.log(JSON.stringify({ state, status: stateReport.status, rows: stateReport.sourceRows ?? null, failure: stateReport.failure ?? null }));
    Date.now = systemNow;
  }
} finally { Date.now = systemNow; }
report.completedAt = new Date().toISOString(); await save();
console.log(JSON.stringify({ report: output, passed: report.states.filter(row => row.status === "PASS").length, failed: report.states.filter(row => row.status !== "PASS").map(row => ({ state: row.state, failure: row.failure })) }));
