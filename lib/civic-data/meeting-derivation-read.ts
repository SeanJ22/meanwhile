import { promotedInputRef, type DerivedInputRef } from "./derived-authority.ts";
import { meetingDerivationScope, type MeetingDerivationFamily } from "./meeting-derivation-scope.ts";
import { readPromotedCivicData, type CivicDataReadResult, type PromotedCivicDataReadOptions } from "./read-model.ts";
import { readPublishedArraySlice } from "./published-array-slice.ts";
import { requireRegistryState } from "./state-scopes.ts";
import { PostgresRoutineDataStore } from "./store.ts";
import { requiredManualProductionContract } from "./manual-contracts.ts";

export interface MeetingDerivationReadOptions extends PromotedCivicDataReadOptions { readonly state?: string }
export type MeetingDerivationRead<T> = CivicDataReadResult<T> & { readonly sourceInput?: Extract<DerivedInputRef, { kind: "PROMOTED_VERSION" }> };

/** Preserve a legacy publication's source identity while reading only its state partition. */
export async function readMeetingDerivationProjection<T>(input: {
  readonly family: MeetingDerivationFamily | "meeting-body-crosswalk" | "meeting-doors";
  readonly options: MeetingDerivationReadOptions;
  readonly value: (records: readonly unknown[]) => T;
  readonly statePath: readonly string[];
  readonly path?: readonly string[];
}): Promise<MeetingDerivationRead<T>> {
  const state = input.options.state === undefined ? undefined : requireRegistryState(input.options.state);
  const legacyScope = input.family === "meeting-body-crosswalk" ? requiredManualProductionContract("meeting-body-crosswalk").scope : `US:${input.family}`;
  const scope = state === undefined ? legacyScope : input.family === "meeting-body-crosswalk"
    ? `US-${state}:meeting-body-crosswalk` : input.family === "meeting-doors" ? `meeting-doors:${state}` : meetingDerivationScope(input.family, state);
  const options = state === undefined || input.options.store ? input.options : { ...input.options, store: new PostgresRoutineDataStore() };
  const result = await readPromotedCivicData<T>("CURATED_READER_RECORD", scope, options);
  if (result.kind !== "NOT_RECORDED" || state === undefined ||
    input.options.store && !(input.options.store instanceof PostgresRoutineDataStore)) return result;
  const statePattern = input.statePath.at(-1) === "state" ? `^US-${state}$` : `/(state|district|territory):${state.toLowerCase()}(/|$)`;
  const slice = await readPublishedArraySlice<unknown>({ recordClass: "CURATED_READER_RECORD", scope: legacyScope,
    path: input.path ?? ["records"], statePath: input.statePath, statePattern, selectors: [
      { path: input.statePath, pattern: statePattern },
      // A held curated body may predate its division binding; its exact scoped
      // body id still names the state and keeps its verified door usable.
      ...(input.family === "meeting-doors" ? [{ path: ["bodyIds"], pattern: `"curated:${state.toLowerCase()}/` }] : []),
    ] });
  if (!slice) return result;
  const value = input.value(slice.records), ref = slice.input;
  const projection = { key: `CURATED_READER_RECORD:${legacyScope}`, recordClass: "CURATED_READER_RECORD" as const,
    scope: legacyScope, sourceId: slice.sourceId, versionId: ref.versionId, lastKnownGoodVersionId: ref.versionId,
    promotedAt: ref.promotedAt, receipt: slice.receipt, payload: value };
  return { kind: "PROMOTED", value, projection, sourceInput: ref,
    metadata: { recordClass: "CURATED_READER_RECORD", scope: legacyScope, sourceId: slice.sourceId, version: null,
      versionId: ref.versionId, lastKnownGoodVersionId: ref.versionId, promotedAt: ref.promotedAt,
      retrievedAt: slice.retrievedAt, sourceThrough: slice.retrievedAt, stale: "UNKNOWN", staleAt: null } };
}

export function meetingDerivationInput<T>(read: MeetingDerivationRead<T>): Extract<DerivedInputRef, { kind: "PROMOTED_VERSION" }> | null {
  if (read.kind !== "PROMOTED") return null;
  const input = read.sourceInput ?? promotedInputRef(read.metadata.recordClass, read.metadata.scope,
    read.metadata.versionId, read.value, read.metadata.promotedAt);
  return input?.kind === "PROMOTED_VERSION" ? input : null;
}
