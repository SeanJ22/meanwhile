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
import type { Query } from "../facts/publish.ts";
import { PostgresRoutineDataStore } from "../civic-data/store.ts";
import type { BodyRoster } from "./body-rosters.ts";
import { CENSUS_PLACEHOLDER_BODY_ISSUE } from "./census-placeholders.ts";
import { currentReaderRoute, currentReaderSelection } from "../db/reader-route.ts";
import { currentRegistryRuntimeEdge, currentReaderAuthorityEdge } from "./runtime-edge.ts";

const selectedStates = new WeakMap<object, CivicDataReadResult<RegistryRuntimeReadModel>>();
let cache: RegistryRuntimeReadModel | null = null;
let readState: CivicDataReadResult<RegistryRuntimeReadModel> = civicDataReadNotInitialized(
  "REGISTRY_RUNTIME_BINDING",
  REGISTRY_RUNTIME_SCOPE,
  "The Reader registry runtime pointer has not been read for this process.",
);

export async function registryWithFactFields(carton: RegistryRuntimeCarton, query: Query | null,
  photos?: (keys: readonly string[]) => Promise<Pick<RegistryRuntimeCarton, "officialPhotos" | "rosterPhotos"> | null>): Promise<RegistryRuntimeReadModel> {
  const value = await withFactRegistry(carton, carton.registry.bodies.length ? query : null);
  if (!photos) return value;
  const keys = [...new Set([
    ...value.bodyRosters.flatMap(roster => roster.members.flatMap(member => member.personId ? [member.id, member.personId] : [member.id])),
    ...(value.statewideExecutives ?? []).map(row => row.holder.id), ...(value.officialCandidacies?.rows ?? []).map(row => row.holder.id),
  ])];
  if (!keys.length) return value;
  // Exact person IDs let a newer accepted portrait advance beside the place's held fields.
  const held = await photos(keys);
  if (!held) throw new Error("REGISTRY_PHOTO_STORE_UNAVAILABLE");
  return { ...value, ...held };
}

function validate(value: RegistryRuntimeCarton, versionId: string): void {
  const sliced = currentReaderSelection() !== undefined;
  const empty = new Set(["REGISTRY_EMPTY", "STATEWIDE_EXECUTIVES_EMPTY", "OFFICIAL_CANDIDACY_BRIDGE_EMPTY"]);
  const issues = registryRuntimeProjectionIssues(value).filter(issue => !issue.startsWith(`${CENSUS_PLACEHOLDER_BODY_ISSUE}:`) && !(sliced && empty.has(issue)));
  if (issues.length) throw new Error(`Registry runtime projection ${versionId} is invalid: ${issues.join(", ")}.`);
}

/** Store failures remain failures. Members and schedules come from live facts. */
export async function readRegistryRuntimeProjection(
  options: PromotedCivicDataReadOptions = {},
): Promise<CivicDataReadResult<RegistryRuntimeReadModel>> {
  const edge = currentRegistryRuntimeEdge();
  if (!options.store && edge && (!options.bypassCache || currentReaderSelection() || currentReaderRoute() !== "unattributed" || currentReaderAuthorityEdge()?.edgeOnly)) {
    primeRegistryRuntimeFromValue(edge.value, edge.versionId);
    return readState;
  }
  const read = await readPromotedCivicData<RegistryRuntimeCarton>("REGISTRY_RUNTIME_BINDING", REGISTRY_RUNTIME_SCOPE, options);
  const result = (read.kind === "PROMOTED" || read.kind === "BOOTSTRAP"
    ? { ...read, value: await registryWithFactFields(read.value, factReader(), !options.store && currentReaderSelection() && read.metadata.versionId
      ? keys => new PostgresRoutineDataStore().readRegistryPhotos(REGISTRY_RUNTIME_SCOPE, keys)
      : undefined) } : read) as CivicDataReadResult<RegistryRuntimeReadModel>;
  readState = result;
  const selection = currentReaderSelection();
  if (selection) selectedStates.set(selection, result);
  if (result.kind === "PROMOTED" || result.kind === "BOOTSTRAP") {
    validate(result.value, result.metadata.versionId ?? result.kind);
    if (!selection) cache = result.value;
  } else {
    if (!selection) cache = null;
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
  const selection = currentReaderSelection();
  if (!selection) cache = value;
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
  if (selection) selectedStates.set(selection, readState);
}

export function registryRuntimeReadState(): CivicDataReadResult<RegistryRuntimeReadModel> {
  const selection = currentReaderSelection();
  return selection ? selectedStates.get(selection) ?? readState : readState;
}

export function getRegistryRuntimeReadModel(): RegistryRuntimeReadModel {
  const selection = currentReaderSelection();
  if (selection) {
    const edge = currentRegistryRuntimeEdge();
    if (edge) return edge.value;
    const state = selectedStates.get(selection);
    if (state?.kind === "PROMOTED" || state?.kind === "BOOTSTRAP") return state.value;
    if (state) throw new Error("The requested authority could not be read for this request.");
  }
  if (!cache) throw new Error(`Registry runtime bindings are ${readState.kind}; call readRegistryRuntimeProjection before using the synchronous projection.`);
  return cache;
}

export function getRuntimeBodyRosters(): readonly BodyRoster[] {
  return getRegistryRuntimeReadModel().bodyRosters;
}
