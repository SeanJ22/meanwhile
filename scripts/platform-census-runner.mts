import { readRuntimeAdminConfig } from "../lib/control-plane/runtime-admin-config.ts";
import { neon } from "@neondatabase/serverless";
import { join } from "node:path";
import { createPgRepositories, controlPlaneUrlFromEnv } from "../lib/control-plane/repository/pg-store.ts";
import { isAdminConfig } from "../lib/control-plane/gateway/admin-config.ts";
import { readIntents, RESEARCH_INTENT_LOG_KEY } from "../lib/control-plane/scheduler/research-policy.ts";
import { FleetSafetyController } from "../lib/control-plane/fleet-safety.ts";
import { hostSpacer } from "../lib/control-plane/scheduler/http-executor.ts";
import { cycleVault, VAULT_DIR } from "../lib/control-plane/scheduler/vault.ts";
import { websiteSizeFromHoldings } from "../lib/control-plane/scheduler/host-supervision.ts";
import { REGISTRATION_TARGETS } from "../lib/registration/publication.ts";
import { loadRegistrationReference } from "../lib/registration/reference.ts";
import { censusDivisionPrefix, censusStateNotDue, censusStateCoverage, runCensusState } from "../lib/control-plane/discovery/census-lane.ts";
import { readPlatformCensusNeeds, refreshDotgovCensusLeads } from "../lib/control-plane/discovery/platform-census.ts";
import { acquireDotGov, dotGovArchiveCache, type DotGovAcquisition } from "../lib/civic-data/dotgov-acquisition.ts";
import { rawCaptureVault } from "../lib/civic-data/raw-capture-remote.ts";
import { fieldManualEntryId, newFieldManualEntry, writeFieldManual } from "../lib/control-plane/field-manual.ts";
import { DEFAULT_SEARCH_BUDGET, durableSearchBudget, makeDiscoverySearch } from "../lib/control-plane/discovery/search-runtime.ts";
import { acquireProcessSingleton } from "../lib/civic-data/process-singleton.ts";
import type { DiscoveryRuntime } from "../lib/control-plane/discovery/meetings-discovery-executor.ts";
import { runPageDoorChecks, recheckShutDoors } from "../lib/doors/page-check.ts";
import { readPlacePackage } from "../lib/reader/place.ts";

const root = process.env.WTP_PROJECT_ROOT ?? process.cwd();
const url = controlPlaneUrlFromEnv();
if (!url) throw new Error("Census control-plane store is unavailable");
const singleton = await acquireProcessSingleton("platform-census", 49_375);
const repos = await createPgRepositories(url);
const now = () => new Date().toISOString();
let stopped = false;
process.on("message", message => { if ((message as { kind?: string })?.kind === "RUNTIME_RELEASE_DRAIN") stopped = true; });
const vault = cycleVault(join(root, ...VAULT_DIR));
let dotgov: Promise<DotGovAcquisition> | undefined;
const dotgovSource = () => dotgov ??= acquireDotGov(undefined, { archive: dotGovArchiveCache(rawCaptureVault()) });
function stateRuntime(state: string): DiscoveryRuntime {
  const sizeFor = websiteSizeFromHoldings([state], root);
  const fleet = new FleetSafetyController({ now: now(), charges: [], modelHold: "Plain-code census lane", websitePacing: repos.websitePacing,
    websiteSize: sizeFor });
  return {
    now, spaceOut: hostSpacer(), vault: vault.put, budget: { spent: () => stopped }, websiteSize: sizeFor,
    open: input => {
      const read = async () => {
        const got = await fleet.guardedOpenBytes("discovery-web", "platform-census",
          (target, init) => {
            // Probes visit many publishers; release each connection after its body is read.
            const headers = new Headers(init?.headers); headers.set("connection", "close");
            return fetch(target, { ...init, headers, signal: AbortSignal.timeout(input.timeoutMs), redirect: "manual" });
          },
          { followRedirects: false })(input);
        return { status: got.status, body: new TextDecoder().decode(got.bytes), bytes: got.bytes.byteLength,
          contentType: got.contentType, location: got.location ?? null, transportError: got.transportError };
      };
      return read();
    },
  };
}
const states = REGISTRATION_TARGETS.map(target => target.state.toLowerCase());
const controlQuery = neon(url);
const stateDoors = async (state: string) => {
  const ids = await controlQuery.query(`SELECT d.id FROM cp_doors d WHERE
    d.value->>'ocdId' LIKE $1 OR (d.value->'bodyIds')::text LIKE $2 OR
    EXISTS (SELECT 1 FROM cp_work_items w WHERE w.value #>> '{publicationOutcome,doorId}' = d.id
      AND upper(w.value #>> '{autonomousPlan,jurisdiction}') = $3)`,
    [`${censusDivisionPrefix(state)}%`, `%/${censusDivisionPrefix(state).split("/").at(-1)}%`, state.toUpperCase()]);
  return (await Promise.all(ids.map(row => repos.doors.read(String(row.id))))).flatMap(row => row ? [row.value] : []);
};
try {
  for (const state of states) {
    if (stopped || readIntents(await repos.researchIntents.read(RESEARCH_INTENT_LOG_KEY)).runnerPause.paused) break;
    const runtime = stateRuntime(state);
    console.log(`CENSUS_SHUT ${state}: ${JSON.stringify(await recheckShutDoors(repos, runtime, await stateDoors(state)))}`);
  }
  for (const state of states) {
    if (stopped) break;
    const intents = readIntents(await repos.researchIntents.read(RESEARCH_INTENT_LOG_KEY));
    if (intents.runnerPause.paused) break;
    const runtime = stateRuntime(state);
    const query = neon(url);
    const coverage = async () => {
      try {
        return await censusStateCoverage((sql, parameters) => query.query(sql, parameters), state, async () => {
          if (!process.env.DATABASE_URL) return null;
          try {
            const reader = neon(process.env.DATABASE_URL);
            const held = await readPlacePackage({ state: state.toUpperCase(), divisionIds: [], allBodies: true, includeAgenda: false },
              (sql, parameters) => reader.query(sql, [...parameters ?? []]));
            return new Set(held.meetings.filter(meeting => meeting.ocdId?.startsWith(censusDivisionPrefix(state)))
              .map(meeting => meeting.ocdId)).size;
          } catch { console.error(`CENSUS_METRICS ${state}: published meeting counts could not be read`); return null; }
        });
      } catch { console.error(`CENSUS_METRICS ${state}: coverage counts could not be read`); return null; }
    };
    const doors = await stateDoors(state);
    console.log(`CENSUS_PAGES ${state}: ${JSON.stringify(await runPageDoorChecks(repos, runtime, doors, root))}`);
    const reference = loadRegistrationReference(root, state);
    if (await censusStateNotDue(repos, state, reference.sha256, now())) {
      console.log(`CENSUS_STATE ${state}: discoveries are not due`);
      continue;
    }
    const coverageBefore = await coverage();
    try { await refreshDotgovCensusLeads(repos, runtime, state, dotgovSource); }
    catch (error) { console.error(`CENSUS_SOURCE ${state}: ${error instanceof Error ? error.message : String(error)}`); }
    const schoolSites = (reference.listings ?? []).filter(row => row.nativeIds.nces_leaid && row.website).map(row =>
      newFieldManualEntry("nces-website", row.id, { role: "SHARED", kind: "NCES_WEBSITE", title: row.name,
        summary: `${row.name} website in the NCES directory`, states: [state], outcome: "REFERENCE", url: row.website,
        observedAt: row.provenance.collectedAt, payload: { jurisdictionId: row.jurisdictionId, name: row.name,
          sourceUrl: row.provenance.sourceUrl, referenceSha256: reference.sha256 } }));
    const saved = await writeFieldManual(repos, schoolSites, now());
    if (saved.error) throw new Error(saved.error);
    const reading = await readPlatformCensusNeeds(state, null, { repos, root });
    for (const failure of reading.failures) console.error(`CENSUS_SOURCE ${state}: ${failure}`);
    const config = (await readRuntimeAdminConfig(repos, ["discoverySearch"]))?.value;
    const search = config && isAdminConfig(config) && config.discoverySearch?.enabled ? makeDiscoverySearch({
      braveKey: process.env.BRAVE_SEARCH_API_KEY, exaKey: process.env.EXA_API_KEY,
      budget: durableSearchBudget({ repos, perCycle: DEFAULT_SEARCH_BUDGET.perCycle, perDay: DEFAULT_SEARCH_BUDGET.perDay,
        admit: () => null, now }),
    }) : null;
    const discoveryRuntime = { ...runtime, ...(search ? { search } : {}),
      recordCost: async (entry: Parameters<NonNullable<DiscoveryRuntime["recordCost"]>>[0]) => {
        await repos.costs.append(entry.workItemId, entry.attemptId, entry, now());
      } };
    const report = await runCensusState({ repos, state, needs: reading.needs, runtime: discoveryRuntime,
      onProgress: report => { if (report.checked % 25 === 0) console.log(`CENSUS_PROGRESS ${state}: ${report.checked} checked, ${report.walked} walked`); } });
    console.log(`CENSUS_STATE ${JSON.stringify(report)}`);
    const coverageAfter = await coverage();
    const priorRun = await repos.fieldManual.readNarrowed(fieldManualEntryId("census-lane", state), { payload: ["baseline"] });
    const baseline = (priorRun?.value as { payload?: { baseline?: unknown } } | undefined)?.payload?.baseline ?? { at: now(), ...coverageBefore };
    const written = await writeFieldManual(repos, [newFieldManualEntry("census-lane", state, { role: "SHARED", kind: "PLATFORM_CENSUS_RUN",
      title: `${state.toUpperCase()} meeting platforms`, summary: `${report.walked} governments walked; ${report.failures.length} source failures`,
      states: [state], observedAt: now(), outcome: report.failures.length ? "FAILED" : "YIELDED", payload: { ...report, referenceSha256: reference.sha256, baseline, current: coverageAfter } })], now());
    if (written.error) throw new Error(written.error);
  }
} finally {
  await dotgov?.then(source => source.dispose()).catch(() => {});
  await singleton.release();
}
