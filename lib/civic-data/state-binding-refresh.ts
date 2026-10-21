import { createHash } from "node:crypto";
import { FIPS_TO_STATE } from "../ocd/fips.ts";
import type { Division } from "../registry/types.ts";
import { readRegistryRuntimePrior, registryRuntimeCandidate, registryRuntimeProjectionIssues, type RegistryRuntimePackage, type RegistryRuntimePrior } from "../registry/runtime-data-plane.ts";
import { acquireKnownRelease, type KnownRelease, type KnownReleaseOptions } from "../sources/known-release.ts";
import { requireRegistryState, stateRegistryRuntimeContractId } from "./state-scopes.ts";
import { processRegisteredManualCandidate, type PromotionOutcome } from "./promotion.ts";
import { failedAcquisitionCandidate } from "./candidate-builders.ts";
import { REGISTRY_RUNTIME_PARSER_VERSION, REGISTRY_RUNTIME_SOURCE_ID } from "../registry/runtime-data-plane.ts";
import { printSourceRunnerReceipt } from "./runner-receipt.ts";
import type { RoutineDataStore } from "./store.ts";

export const CENSUS_STATE_IDENTITIES_URL = "https://www2.census.gov/geo/docs/reference/state.txt";

/** These are the actual official rows, not a second state-name roster maintained in code. */
export function censusStateIdentity(release: KnownRelease, value: string): Division {
  const state = requireRegistryState(value);
  if (release.requestedUrl !== CENSUS_STATE_IDENTITIES_URL || release.finalUrl !== CENSUS_STATE_IDENTITIES_URL ||
      release.httpStatus !== 200 || createHash("sha256").update(release.bytes).digest("hex") !== release.sha256)
    throw new Error("STATE_BINDING_CENSUS_CAPTURE_INVALID");
  const lines = new TextDecoder("utf-8", { fatal: true }).decode(release.bytes).trim().split(/\r?\n/);
  if (lines.shift() !== "STATE|STUSAB|STATE_NAME|STATENS") throw new Error("STATE_BINDING_CENSUS_HEADER_INVALID");
  const rows = lines.map(line => line.split("|")).filter(row => row[1] === state);
  if (rows.length !== 1) throw new Error(`STATE_BINDING_CENSUS_STATE_UNRESOLVED:${state}`);
  const [fips, postal, name, ansi] = rows[0];
  const held = FIPS_TO_STATE[fips];
  if (held?.postal !== postal || !name || !/^\d{8}$/.test(ansi)) throw new Error(`STATE_BINDING_CENSUS_IDENTITY_INVALID:${state}`);
  const root = `ocd-division/country:us/${held.prefix}:${state.toLowerCase()}`;
  return { ocdId: root, divisionType: held.prefix, tier: "state", state, label: name,
    parentOcdId: "ocd-division/country:us", lsad: null, funcstat: null, classfp: null, geoid: fips,
    canonicalOcdId: root, canonicalMatch: "exact", sourceDataset: "DERIVED",
    provenance: { kind: "OFFICIAL", sourceUrl: release.finalUrl, sourceOrg: "U.S. Census Bureau — state FIPS reference",
      collectedAt: release.retrievedAt, verifiedAt: release.checkedAt } };
}

/** Rebuild only the state identity binding. The exact prior GOOD base carries every
 * body, official, contact, portrait, candidacy, and their original source dates. */
export function stateBindingRefreshPackage(release: KnownRelease, state: string, prior: RegistryRuntimePrior | null, now: string): RegistryRuntimePackage {
  const root = censusStateIdentity(release, state);
  const previousRoot = prior?.payload.registry.divisions.find(row => row.ocdId === root.ocdId);
  if (previousRoot && (previousRoot.state !== root.state || previousRoot.geoid !== null && previousRoot.geoid !== root.geoid))
    throw new Error(`STATE_BINDING_CURRENT_ROOT_IDENTITY_MISMATCH:${state}`);
  if (prior && registryRuntimeProjectionIssues(prior.payload).length)
    throw new Error(`STATE_BINDING_PRIOR_INVALID:${state}`);
  return {
    contractId: stateRegistryRuntimeContractId(state), version: now, sourceThrough: release.retrievedAt, scope: "MEMBERS",
    sourceReceipt: { contractVersion: 1, reviewedAt: now, reviewedBy: "state-binding-refresh",
      sources: [{ requestedUrl: release.requestedUrl, finalUrl: release.finalUrl, publisher: "U.S. Census Bureau",
        sourceClass: "OFFICIAL_PUBLISHER", retrievedAt: release.retrievedAt, httpStatus: release.httpStatus,
        rawHash: release.sha256, reviewedEvidence: `The saved state reference row uniquely names ${root.label}, postal ${root.state}, FIPS ${root.geoid}; code binds it to ${root.ocdId}.` }] },
    payload: { formatVersion: 1, registry: { generatedAt: prior?.payload.registry.generatedAt ?? now, divisions: previousRoot ? [] : [root], bodies: [] },
      bodyRosters: [], rosterReaderDispositions: [], statewideExecutives: [],
      officialCandidacies: { formatVersion: 1, rule: "EXACT_SEAT_CONSERVATIVE_NAME_OFFLINE_UNIQUE", rows: [] },
      officialPhotos: { photos: [] }, rosterPhotos: {} },
  };
}

export function parseStateBindingRefreshArguments(args: readonly string[]): string {
  const states = args.filter(arg => arg.startsWith("--state="));
  if (states.length !== 1 || args.filter(arg => arg === "--promote").length !== 1 || args.length !== 2)
    throw new Error("STATE_BINDING_EXACT_STATE_AND_PROMOTE_REQUIRED");
  return requireRegistryState(states[0].slice("--state=".length));
}

export async function refreshStateBinding(input: {
  readonly state: string; readonly store: RoutineDataStore; readonly signal?: AbortSignal;
}, dependencies: Pick<KnownReleaseOptions, "fetchImpl" | "locks" | "store"> & {
  readonly now?: () => string;
  readonly acquire?: typeof acquireKnownRelease;
  readonly printReceipt?: typeof printSourceRunnerReceipt;
} = {}): Promise<PromotionOutcome> {
  const state = requireRegistryState(input.state), clock = dependencies.now ?? (() => new Date().toISOString());
  let now = clock();
  const contractId = stateRegistryRuntimeContractId(state);
  const prior = await readRegistryRuntimePrior(input.store, now, state);
  let candidate, release: KnownRelease | undefined;
  try {
    release = await (dependencies.acquire ?? acquireKnownRelease)({ ...dependencies,
      sourceId: REGISTRY_RUNTIME_SOURCE_ID, releaseId: "census-state-identities", url: CENSUS_STATE_IDENTITIES_URL,
      parserVersion: REGISTRY_RUNTIME_PARSER_VERSION, signal: input.signal ?? new AbortController().signal,
      maxBytes: 64 * 1024, checkAfterMs: 86_400_000, allowedHosts: ["www2.census.gov"],
      validate: (_bytes, captured) => { censusStateIdentity(captured, state); },
    });
    now = clock();
    candidate = registryRuntimeCandidate(stateBindingRefreshPackage(release, state, prior, now), { prior });
  } catch (error) {
    now = clock();
    // No source bytes or final route were obtained. The failed attempt names its
    // requested page in the failure detail, without manufacturing a manual source receipt.
    candidate = failedAcquisitionCandidate({ sourceId: REGISTRY_RUNTIME_SOURCE_ID, recordClass: "REGISTRY_RUNTIME_BINDING",
      scope: `US-${state}:reader-registry-runtime`, requestedUrl: "", attemptedAt: now,
      parserVersion: REGISTRY_RUNTIME_PARSER_VERSION,
      failureDetail: `${CENSUS_STATE_IDENTITIES_URL}: ${error instanceof Error ? error.message : String(error)}` });
  }
  let outcome = await processRegisteredManualCandidate(input.store, contractId, candidate, now, prior?.versionId ?? null,
    { confirmUnchanged: !prior || prior.sourceReceipt !== undefined });
  if (release && outcome.confirmed) {
    if (!input.store.confirmUnchanged) throw new Error("STATE_BINDING_CONFIRMATION_STORE_UNAVAILABLE");
    const confirmation = await input.store.confirmUnchanged({
      sourceId: REGISTRY_RUNTIME_SOURCE_ID, recordClass: "REGISTRY_RUNTIME_BINDING", scope: candidate.scope,
      parserVersion: REGISTRY_RUNTIME_PARSER_VERSION, pointerVersionId: outcome.confirmed.versionId,
      readModelHash: outcome.candidate.candidate.normalization.normalizedHash!, basis: "READ_MODEL_RECOMPUTED",
      retrieval: { requestedUrl: release.requestedUrl, finalUrl: release.finalUrl, httpStatus: release.httpStatus,
        retrievedAt: release.retrievedAt, rawHash: release.sha256 },
    }, now);
    if (confirmation.kind !== "CONFIRMED") throw new Error(`STATE_BINDING_CONFIRMATION_REFUSED:${confirmation.kind}:${confirmation.detail}`);
    outcome = { ...outcome, confirmed: { ...outcome.confirmed, at: confirmation.at } };
  }
  (dependencies.printReceipt ?? printSourceRunnerReceipt)(contractId, candidate, outcome);
  return outcome;
}
