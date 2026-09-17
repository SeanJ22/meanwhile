import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  CivicDataStoreUnavailableError,
  civicDataReadNotInitialized,
  mayUseTestFixture,
  readPromotedOrBootstrap,
  type CivicDataBootstrap,
  type CivicDataReadResult,
  type PromotedCivicDataReadOptions,
} from "../civic-data/read-model.ts";
import {
  REGISTRY_RUNTIME_SCOPE,
  REGISTRY_RUNTIME_SOURCE_ID,
  registryRuntimeProjectionIssues,
  type RegistryRuntimeReadModel,
  type OfficialCandidacyBridge,
} from "./runtime-data-plane.ts";
import type { Body, Registry } from "./types.ts";
import { BODY_ROSTERS, ROSTER_READER_DISPOSITIONS, type BodyRoster } from "./body-rosters.ts";
import { STATEWIDE_EXECUTIVES } from "../officials/statewide-executives.ts";

let cache: RegistryRuntimeReadModel | null = null;
let readState: CivicDataReadResult<RegistryRuntimeReadModel> = civicDataReadNotInitialized(
  "REGISTRY_RUNTIME_BINDING",
  REGISTRY_RUNTIME_SCOPE,
  "The Reader registry runtime pointer has not been read for this process.",
);

function validate(value: RegistryRuntimeReadModel, versionId: string): void {
  const issues = registryRuntimeProjectionIssues(value);
  if (issues.length) throw new Error(`Registry runtime projection ${versionId} is invalid: ${issues.join(", ")}.`);
}

/** Exact frozen-Git payload and provenance for one explicit durable first-seed import. */
export function registryRuntimeFirstSeed(): CivicDataBootstrap<RegistryRuntimeReadModel> {
  const registry = JSON.parse(readFileSync(join(process.cwd(), "lib", "registry", "registry.json"), "utf8")) as Registry;
  const promoted = JSON.parse(readFileSync(join(process.cwd(), "lib", "registry", "promoted-bodies.json"), "utf8")) as { bodies?: Body[] };
  const held = new Set(registry.bodies.map((body) => body.id));
  const bodies = [...registry.bodies, ...(promoted.bodies ?? []).filter((body) => !held.has(body.id))];
  const officialPhotos = JSON.parse(readFileSync(join(process.cwd(), "lib", "registry", "official-photos.json"), "utf8"));
  const rosterPhotos = JSON.parse(readFileSync(join(process.cwd(), "lib", "registry", "roster-photos.json"), "utf8"));
  const legacyCandidacies = JSON.parse(readFileSync(join(process.cwd(), "lib", "registry", "fixtures", "official-candidacies-first-seed.json"), "utf8")) as {
    readonly formatVersion: 1;
    readonly rule: "EXACT_SEAT_CONSERVATIVE_NAME_OFFLINE_UNIQUE";
    readonly rows: readonly {
      readonly holder: { readonly id: string; readonly name: string; readonly officeTitle: string; readonly divisions: readonly string[]; readonly sourcePath: string; readonly sourceUrl: string | null };
      readonly status: "RESOLVED" | "NO_APPLICABLE_CANDIDACY" | "IDENTITY_UNRESOLVED";
      readonly candidacy: { readonly candidacyId: string; readonly contestId: string; readonly contestTitle: string; readonly divisionId: string; readonly electionId: string; readonly candidateName: string; readonly sourceUrl: string } | null;
      readonly reason: string;
      readonly unresolvedCandidacyIds: readonly string[];
    }[];
  };
  const authorityForPath = (path: string): OfficialCandidacyBridge["rows"][number]["holder"]["authority"] => {
    if (path === "lib/registry/officeholders-us.json") return "FEDERAL_DIRECTORY";
    if (path === "lib/officials/statewide-executives.ts") return "REGISTRY_STATEWIDE_EXECUTIVE";
    if (path === "lib/registry/body-rosters.ts") return "REGISTRY_BODY_ROSTER";
    throw new Error(`Unsupported first-seed official/candidacy authority path: ${path}`);
  };
  const officialCandidacies: OfficialCandidacyBridge = {
    formatVersion: legacyCandidacies.formatVersion,
    rule: legacyCandidacies.rule,
    rows: legacyCandidacies.rows.map((row) => ({
      holder: {
        id: row.holder.id,
        name: row.holder.name,
        officeTitle: row.holder.officeTitle,
        divisions: row.holder.divisions,
        authority: authorityForPath(row.holder.sourcePath),
        sourceUrl: row.holder.sourceUrl,
      },
      status: row.status,
      candidacy: row.candidacy ? {
        candidacyId: row.candidacy.candidacyId,
        contestId: row.candidacy.contestId,
        contestTitle: row.candidacy.contestTitle,
        divisionId: row.candidacy.divisionId,
        electionId: row.candidacy.electionId,
        candidateName: row.candidacy.candidateName,
        sourceUrl: row.candidacy.sourceUrl,
      } : null,
      reason: row.reason,
      unresolvedCandidacyIds: row.unresolvedCandidacyIds,
    })),
  };
  const value: RegistryRuntimeReadModel = {
    formatVersion: 1,
    registry: { ...registry, bodies },
    bodyRosters: BODY_ROSTERS,
    rosterReaderDispositions: ROSTER_READER_DISPOSITIONS,
    statewideExecutives: STATEWIDE_EXECUTIVES,
    officialCandidacies,
    officialPhotos,
    rosterPhotos,
  };
  validate(value, "bundled first seed");
  const retrievedAt = /^\d{4}-\d{2}-\d{2}$/.test(registry.generatedAt) ? `${registry.generatedAt}T00:00:00.000Z` : registry.generatedAt;
  return {
    value,
    sourceId: REGISTRY_RUNTIME_SOURCE_ID,
    version: registry.generatedAt,
    versionId: `bootstrap:REGISTRY_RUNTIME_BINDING:${registry.generatedAt}`,
    sourceThrough: retrievedAt,
    retrievedAt,
    detail: "The canonical registry runtime store answered with no pointer; serving the bundled first-seed projection explicitly.",
  };
}

/** Store failures remain failures; only an answered absent pointer selects the tracked first seed. */
export async function readRegistryRuntimeProjection(
  options: PromotedCivicDataReadOptions = {},
): Promise<CivicDataReadResult<RegistryRuntimeReadModel>> {
  const result = await readPromotedOrBootstrap({
    ...options,
    recordClass: "REGISTRY_RUNTIME_BINDING",
    scope: REGISTRY_RUNTIME_SCOPE,
    bootstrap: registryRuntimeFirstSeed,
    allowUnconfiguredBootstrap: process.env.NODE_ENV === "development" || mayUseTestFixture(),
  });
  readState = result;
  if (result.kind === "PROMOTED" || result.kind === "BOOTSTRAP") {
    validate(result.value, result.metadata.versionId ?? result.kind);
    cache = result.value;
  } else {
    cache = null;
  }
  return result;
}

export async function refreshRegistryRuntimeFromPromoted(options: PromotedCivicDataReadOptions = {}): Promise<string | null> {
  const result = await readRegistryRuntimeProjection(options);
  if (result.kind === "STORE_UNREACHABLE") throw new CivicDataStoreUnavailableError(result);
  if (result.kind === "NOT_RECORDED") throw new Error(result.detail);
  return result.kind === "PROMOTED" ? result.metadata.versionId : null;
}

/**
 * Prime the registry-runtime cache from a validated EDGE serving artifact,
 * with NO database read. This is the reader's normal path: the runner has
 * already published the promoted registry-runtime as a compressed edge artifact,
 * and `settleRegistryAuthorityReads` calls this (request-scoped, see
 * `lib/registry/runtime-edge.ts`) instead of `refreshRegistryRuntimeFromPromoted`
 * for ordinary visitors. It deliberately does NOT alter that DB reader, which
 * the standing runner and workers still use for the authoritative path.
 */
export function primeRegistryRuntimeFromValue(value: RegistryRuntimeReadModel, versionId: string): void {
  validate(value, versionId);
  cache = value;
  // BOOTSTRAP, not PROMOTED: the serving copy carries the validated value and its
  // version, but not the full promotion receipt (that stays on the authoritative
  // DB path the runner/workers use). This is the honest kind — no fabricated
  // receipt. The version drives the registry authority cache key.
  readState = {
    kind: "BOOTSTRAP",
    value,
    metadata: {
      recordClass: "REGISTRY_RUNTIME_BINDING",
      scope: REGISTRY_RUNTIME_SCOPE,
      sourceId: REGISTRY_RUNTIME_SOURCE_ID,
      version: null,
      versionId,
      lastKnownGoodVersionId: versionId,
      sourceThrough: null,
      retrievedAt: null,
      promotedAt: null,
      stale: "CURRENT",
      staleAt: null,
    },
    detail: `Served from the registry-runtime edge artifact (version ${versionId}); the promotion receipt stays on the authoritative database path.`,
  };
}

export function registryRuntimeReadState(): CivicDataReadResult<RegistryRuntimeReadModel> {
  return readState;
}

export function getRegistryRuntimeReadModel(): RegistryRuntimeReadModel {
  if (!cache) throw new Error(`Registry runtime bindings are ${readState.kind}; call readRegistryRuntimeProjection before using the synchronous projection.`);
  return cache;
}

export function getRuntimeBodyRosters(): readonly BodyRoster[] {
  return getRegistryRuntimeReadModel().bodyRosters;
}
