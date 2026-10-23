/** @freshness-reads-here — the held capture keeps the date the source bytes were read. */
import { parse } from "yaml";
import { pathToFileURL } from "node:url";
import { failedFederalDirectoryCandidate, heldDirectoryCandidate, federalDirectoryContractId, federalDirectoryForState, federalDirectoryStateOf,
  FEDERAL_DIRECTORY_PARSER_VERSION, type FederalDirectoryCapture } from "../lib/officials/federal-directory-data-plane.ts";
import { normalizeCongressDirectory } from "../lib/officials/congress-normalize.ts";
import { readStateFederalDirectory } from "../lib/officials/federal-directory-read-model.ts";
import { requiredAssignment } from "./cli-args.mts";
import { readContractHandoff } from "../lib/civic-data/contract-handoff.ts";
import { holdRawCapture } from "../lib/civic-data/raw-capture-vault.ts";
import { passDeadlineFromEnv } from "../lib/ops/independent-runtime-pass.ts";
import { processRegisteredManualCandidate, type PromotionOutcome } from "../lib/civic-data/promotion.ts";
import { printSourceRunnerReceipt } from "../lib/civic-data/runner-receipt.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { PostgresRoutineDataStore, type RoutineDataStore } from "../lib/civic-data/store.ts";
import { rawCaptureVault } from "../lib/civic-data/raw-capture-remote.ts";
import type { EvidenceStore } from "../lib/control-plane/evidence/store.ts";
import type { RoutineCandidate } from "../lib/civic-data/types.ts";
import { acquireCongressSourceRevision } from "../lib/officials/congress-source-revision.ts";
import { acquireKnownRelease, knownReleaseSourceCheck } from "../lib/sources/known-release.ts";
import { rosterChanges } from "../lib/officials/roster-changes.ts";
import { CHAMBER_DIRECTORY_URLS, parseChamberDirectory, withChamberDirectories } from "../lib/officials/chamber-directory.ts";
import type { FederalDirectoryReadModel } from "../lib/officials/federal-directory-data-plane.ts";

const changesFrom = (prior: FederalDirectoryReadModel | null, next: FederalDirectoryReadModel) =>
  rosterChanges(prior?.roster ?? null, next.roster, { prior: prior?.vacancies ?? [], next: next.vacancies ?? [] });
const FILES = ["legislators-current", "legislators-social-media", "legislators-district-offices", "committees-current", "committee-membership-current"] as const;
export async function refreshCongressDirectory(input: {
  state?: string;
  states?: readonly string[];
  store: RoutineDataStore;
  vault: EvidenceStore;
  acquire?: typeof acquireKnownRelease;
  revision?: typeof acquireCongressSourceRevision;
  now?: () => string;
}): Promise<void> {
  const { store, vault } = input, clock = input.now ?? (() => new Date().toISOString());
  const states = [...new Set(input.states ?? (input.state ? [input.state] : []))];
  if (!states.length) throw Error("CONGRESS_STATE_REQUIRED");
  const acquire = input.acquire ?? acquireKnownRelease;
  const priors = new Map<string, FederalDirectoryReadModel | null>(), latest = new Map<string, FederalDirectoryReadModel>();
  const receipts = new Map<string, { candidate: RoutineCandidate; outcome: PromotionOutcome }>();
  const failures: unknown[] = [];
  const deadline = passDeadlineFromEnv(process.env) ?? Infinity;
  const publish = async (state: string, acquisitions: readonly FederalDirectoryCapture[], projection: FederalDirectoryReadModel, retrievedAt: string) => {
    if (Date.now() >= deadline) return;
    try {
      const candidate = heldDirectoryCandidate({ state, acquisitions, retrievedAt, projection, changes: changesFrom(priors.get(state) ?? null, projection) });
      const outcome = await processRegisteredManualCandidate(store, federalDirectoryContractId(state), candidate, clock());
      receipts.set(state, { candidate, outcome });
      if (!outcome.promoted && !outcome.confirmed) throw Error(`Federal directory held as ${outcome.candidate.state}: ${outcome.candidate.failureDetail ?? "validation refused"}`);
      latest.set(state, projection);
    } catch (error) { failures.push(error); console.error(`${state}: ${String(error)}`); }
  };
  try {
    const now = clock();
    for (const state of states) {
      const prior = await readStateFederalDirectory(state, { store, now, bypassCache: true });
      if (prior.kind === "STORE_UNREACHABLE") throw Error(`CONGRESS_PRIOR_UNAVAILABLE:${state}`);
      priors.set(state, prior.kind === "PROMOTED" || prior.kind === "BOOTSTRAP" ? prior.value : null);
    }
    const { sha: sourceSha, sourceCheck } = await (input.revision ?? acquireCongressSourceRevision)();
    const raw: Record<string, unknown> = {}, dates: Record<string, string> = {}, acquisitions: FederalDirectoryCapture[] = [];
    for (const name of FILES) {
      if (Date.now() >= deadline) break;
      const url = `https://raw.githubusercontent.com/unitedstates/congress-legislators/${sourceSha}/${name}.yaml`;
      try {
        let decoded: { text: string; value: unknown } | undefined;
        const decode = (bytes: Uint8Array) => {
          const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
          if (text.trimStart().startsWith("<")) throw Error("CONGRESS_HTML_RESPONSE");
          const value: unknown = parse(text, { maxAliasCount: 0, uniqueKeys: true });
          if (name === "committee-membership-current" ? !value || typeof value !== "object" || Array.isArray(value) : !Array.isArray(value)) throw Error("CONGRESS_FILE_SHAPE_INVALID");
          if (name === "legislators-current" && !(value as unknown[]).length) throw Error("CONGRESS_CORE_EMPTY");
          return { text, value };
        };
        const held = await acquire({ sourceId: "congress-directory-project", releaseId: `${sourceSha}/${name}`, url,
          parserVersion: FEDERAL_DIRECTORY_PARSER_VERSION, maxBytes: 16 * 1024 * 1024, checkAfterMs: 365 * 86400000,
          signal: AbortSignal.timeout(Math.max(1, Math.min(30000, deadline - Date.now()))), headers: { accept: "text/plain" },
          validate: bytes => { decoded = decode(bytes); } });
        const parsed = decoded ?? decode(held.bytes);
        raw[name] = parsed.value; dates[name] = held.retrievedAt;
        acquisitions.push({ requestedUrl: held.requestedUrl, finalUrl: held.finalUrl, httpStatus: held.httpStatus,
          raw: await holdRawCapture(vault, "congress-directory-project", parsed.text, "text/plain"), retrievedAt: held.retrievedAt, sourceCheck });
      } catch (error) {
        if (name === "legislators-current") throw error;
        console.error(`${name}: optional facts retained from last good holding (${String(error)})`);
      }
      // One national acquisition feeds every due place before the next optional file is read.
      for (const state of states) {
        const prior = priors.get(state) ?? null;
        const projection = withChamberDirectories(federalDirectoryForState(normalizeCongressDirectory(raw, sourceSha, dates["legislators-current"]!, prior, dates, now), state), state, [], prior);
        await publish(state, acquisitions, projection, dates["legislators-current"]!);
      }
    }
    for (const [chamber, url] of Object.entries(CHAMBER_DIRECTORY_URLS)) {
      if (Date.now() >= deadline) break;
      try {
        const held = await acquire({ sourceId: "congress-directory-project", releaseId: `chamber-directory:${chamber}`, url,
          parserVersion: FEDERAL_DIRECTORY_PARSER_VERSION, maxBytes: 4 * 1024 * 1024, checkAfterMs: 86400000,
          signal: AbortSignal.timeout(Math.max(1, Math.min(30000, deadline - Date.now()))), headers: { accept: "application/xml" },
          validate: bytes => { parseChamberDirectory({ body: new TextDecoder().decode(bytes), finalUrl: url, retrievedAt: clock() }, states[0]!); } });
        const body = new TextDecoder("utf-8", { fatal: true }).decode(held.bytes);
        const capture = { requestedUrl: held.requestedUrl, finalUrl: held.finalUrl, httpStatus: held.httpStatus,
          body, retrievedAt: held.retrievedAt, sourceCheck: knownReleaseSourceCheck(held) };
        acquisitions.push({ ...capture, raw: await holdRawCapture(vault, "congress-directory-project", body, "text/plain") });
        for (const state of states) {
          const previous = latest.get(state);
          if (previous) await publish(state, acquisitions, withChamberDirectories(previous, state, [capture], previous), held.retrievedAt);
        }
      } catch (error) { console.error(`${chamber} directory: contacts retained; ${String(error)}`); }
    }
  } catch (error) {
    failures.push(error);
    for (const state of states) {
      if (receipts.has(state) || Date.now() >= deadline) continue;
      try {
        const now = clock(), candidate = failedFederalDirectoryCandidate(state, now, String(error));
        const outcome = await processRegisteredManualCandidate(store, federalDirectoryContractId(state), candidate, now);
        receipts.set(state, { candidate, outcome });
      } catch (receiptError) { console.error(`Failed attempt receipt ${state}: ${String(receiptError)}`); }
    }
  } finally {
    for (const state of states) {
      const receipt = receipts.get(state);
      if (receipt) printSourceRunnerReceipt(federalDirectoryContractId(state), receipt.candidate, receipt.outcome);
    }
  }
  if (failures.length) throw failures[0];
}

async function main() {
  if (!process.argv.includes("--promote")) throw Error("Run with --promote; tracked federal files are first-seed/test evidence only.");
  prepareProductionCivicDataWrite();
  const args = process.argv.slice(2);
  const states = args.some(arg => arg.startsWith("--contracts-file="))
    ? readContractHandoff<string>(args).map(id => { const state = federalDirectoryStateOf(id); if (!state) throw Error(`CONGRESS_CONTRACT_INVALID:${id}`); return state; })
    : [requiredAssignment(args, "state", "CONGRESS_STATE_REQUIRED")];
  await refreshCongressDirectory({ states, store: new PostgresRoutineDataStore(), vault: rawCaptureVault() });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main().catch((error:unknown)=>{
  console.error(error instanceof Error ? error.message : String(error)); process.exitCode=1;
});
