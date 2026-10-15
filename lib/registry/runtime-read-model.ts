import {
  CivicDataStoreUnavailableError,
  civicDataReadNotInitialized,
  readPromotedCivicData,
  type CivicDataReadResult,
  type PromotedCivicDataReadOptions,
} from "../civic-data/read-model.ts";
import { validateOnce } from "../civic-data/validated-once.ts";
import {
  REGISTRY_RUNTIME_SCOPE,
  REGISTRY_RUNTIME_SOURCE_ID,
  registryRuntimeProjectionIssues,
  type RegistryRuntimeCarton,
  type RegistryRuntimeReadModel,
} from "./runtime-data-plane.ts";
import { factReader } from "../facts/db.ts";
import { withFactRegistry } from "../facts/registry-overlay.ts";
import type { BodyRoster } from "./body-rosters.ts";
import { CENSUS_PLACEHOLDER_BODY_ISSUE } from "./census-placeholders.ts";
import type { Body, Division } from "./types.ts";
import type { Query } from "../facts/publish.ts";

export async function readRegistryBodyIdentity(bodyId: string, query: Query): Promise<{ body: Body; division: Division | null } | null> {
  const identities = await query(`WITH body AS (
    SELECT d.value FROM civic_meeting_dependencies d JOIN civic_data_promotions p
      ON p.scope=d.pointer_scope AND p.current_version_id=d.version_id
      AND p.record_class=CASE d.kind WHEN 'body' THEN 'REGISTRY_RUNTIME_BINDING' ELSE 'REGISTRATION' END
    WHERE d.kind IN ('body','registered-body') AND d.member_id=$1 ORDER BY d.kind LIMIT 1
  ) SELECT body.value AS body, division.value AS division FROM body LEFT JOIN LATERAL (
    SELECT d.value FROM civic_meeting_dependencies d JOIN civic_data_promotions p
      ON p.scope=d.pointer_scope AND p.current_version_id=d.version_id
      AND p.record_class=CASE d.kind WHEN 'division' THEN 'REGISTRY_RUNTIME_BINDING' ELSE 'REGISTRATION' END
    WHERE d.kind IN ('division','registered-division') AND d.member_id=body.value->>'ocdId'
    ORDER BY d.kind LIMIT 1
  ) division ON true`, [bodyId]);
  return identities[0] ? { body: identities[0].body as Body, division: identities[0].division as Division | null } : null;
}

let cache: RegistryRuntimeReadModel | null = null;
let readState: CivicDataReadResult<RegistryRuntimeReadModel> = civicDataReadNotInitialized(
  "REGISTRY_RUNTIME_BINDING",
  REGISTRY_RUNTIME_SCOPE,
  "The Reader registry runtime pointer has not been read for this process.",
);

function validate(value: RegistryRuntimeCarton, versionId: string): void {
  const issues = registryRuntimeProjectionIssues(value).filter((issue) => !issue.startsWith(`${CENSUS_PLACEHOLDER_BODY_ISSUE}:`));
  if (issues.length) throw new Error(`Registry runtime projection ${versionId} is invalid: ${issues.join(", ")}.`);
}

/** Store failures remain failures. Members and schedules come from live facts. */
export async function readRegistryRuntimeProjection(
  options: PromotedCivicDataReadOptions = {},
): Promise<CivicDataReadResult<RegistryRuntimeReadModel>> {
  const read = await readPromotedCivicData<RegistryRuntimeCarton>("REGISTRY_RUNTIME_BINDING", REGISTRY_RUNTIME_SCOPE, options);
  const result = (read.kind === "PROMOTED" || read.kind === "BOOTSTRAP"
    ? { ...read, value: await withFactRegistry(read.value, factReader()) } : read) as CivicDataReadResult<RegistryRuntimeReadModel>;
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

export function primeRegistryRuntimeFromValue(value: RegistryRuntimeReadModel, versionId: string): void {
  validateOnce("registry-runtime", value, versionId, () => validate(value, versionId));
  cache = value;
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

export async function installMeetingRegistryProjection(registry: import("./types.ts").Registry, versionId: string,
  query: import("../facts/publish.ts").Query): Promise<void> {
  cache = await withFactRegistry({ formatVersion: 1, registry, statewideExecutives: [],
    officialCandidacies: { formatVersion: 1, rule: "EXACT_SEAT_CONSERVATIVE_NAME_OFFLINE_UNIQUE", rows: [] },
    officialPhotos: { photos: [] }, rosterPhotos: {} }, query);
  readState = { kind: "BOOTSTRAP", value: cache, detail: "Meeting dependencies from the promoted member index.",
    metadata: { recordClass: "REGISTRY_RUNTIME_BINDING", scope: registry.bodies[0]?.id ?? REGISTRY_RUNTIME_SCOPE,
      sourceId: REGISTRY_RUNTIME_SOURCE_ID, version: null, versionId, lastKnownGoodVersionId: versionId,
      sourceThrough: null, retrievedAt: null, promotedAt: null, stale: "CURRENT", staleAt: null } };
}
