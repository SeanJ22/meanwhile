import { FEDERAL_MONEY_RECORD_CLASS, FEDERAL_MONEY_SOURCES, federalMoneyScope } from "./model.ts";
import { FEDERAL_MONEY_STATES } from "./sources.ts";
import { FEDERAL_MONEY_EDGE_SCOPES } from "./edge.ts";
import { readFederalMoneyProjection } from "./reader.ts";
import { promotedEdgeEntryOf, readPromotedCivicData, type PromotedEdgeEntry } from "../civic-data/read-model.ts";
import { promotedFamilyVersion, promotedPointerVersion } from "../civic-data/promoted-edge-publication.ts";
import type { RoutineDataStore } from "../civic-data/store.ts";
import type { PromotedFamilyArtifactValue, ReaderManifest } from "../meetings/edge-artifacts.ts";
import type { PublishAuthorityCarried, PublishAuthorityValue, PublishFederalMoney } from "../meetings/edge-serving.ts";

/** Read changed state pointers once on the runner; every other state keeps its accepted artifact. */
export async function readFederalMoneyEdgePublication(input: {
  readonly store: RoutineDataStore;
  readonly servedManifest: Pick<ReaderManifest, "federalMoney"> | null;
  readonly now: string;
  readonly readServedState: (state: string) => Promise<PromotedFamilyArtifactValue | null>;
}): Promise<{ readonly states: PublishFederalMoney; readonly skipped: readonly string[] }> {
  const states: Record<string, PublishAuthorityValue | PublishAuthorityCarried> = Object.fromEntries(
    Object.entries(input.servedManifest?.federalMoney ?? {}).map(([state, ref]) => [state, { versionId: ref.version, carried: true }]));
  const skipped: string[] = [];
  const identities = new Map((await input.store.readPromotionIdentities(FEDERAL_MONEY_RECORD_CLASS, FEDERAL_MONEY_EDGE_SCOPES))
    .map(pointer => [pointer.scope, pointer]));
  for (const state of FEDERAL_MONEY_STATES) {
    const lower = state.toLowerCase();
    const scopes = FEDERAL_MONEY_SOURCES.map(source => federalMoneyScope(source, state));
    const served = input.servedManifest?.federalMoney?.[lower];
    if (!served && !scopes.some(scope => identities.has(scope))) continue;
    const currentVersion = promotedFamilyVersion(scopes.map(scope =>
      promotedPointerVersion(FEDERAL_MONEY_RECORD_CLASS, scope, identities.get(scope) ?? null)));
    if (served?.version === currentVersion) continue;
    try {
      const entries: PromotedEdgeEntry[] = [];
      const versions: string[] = [];
      let prior: PromotedFamilyArtifactValue | null | undefined;
      for (const source of FEDERAL_MONEY_SOURCES) {
        const scope = federalMoneyScope(source, state);
        let entry: PromotedEdgeEntry;
        try {
          if (!identities.has(scope)) entry = { kind: "NOT_RECORDED", recordClass: FEDERAL_MONEY_RECORD_CLASS, scope };
          else {
            const read = await readPromotedCivicData(FEDERAL_MONEY_RECORD_CLASS, scope, { store: input.store, now: input.now });
            const proven = promotedEdgeEntryOf(read, FEDERAL_MONEY_RECORD_CLASS, scope, input.store);
            if (proven === null || proven.kind !== "PROMOTED") throw new Error(`${source}:${state} read ${read.kind}`);
            const accepted = await readFederalMoneyProjection(source, state, { edge: proven, now: input.now });
            if (accepted.kind !== "PROMOTED" || accepted.metadata.versionId !== proven.projection.versionId)
              throw new Error(`${source}:${state} typed reader answered ${accepted.kind}`);
            entry = proven;
          }
        } catch (error) {
          if (prior === undefined) prior = await input.readServedState(lower);
          const held = prior?.entries.find(candidate => candidate.kind === "PROMOTED"
            ? candidate.projection.recordClass === FEDERAL_MONEY_RECORD_CLASS && candidate.projection.scope === scope
            : candidate.recordClass === FEDERAL_MONEY_RECORD_CLASS && candidate.scope === scope);
          if (!held) throw error;
          skipped.push(`${source}:${state} ${error instanceof Error ? error.message : String(error)}; retaining the accepted prior version`);
          entry = held;
        }
        entries.push(entry);
        versions.push(promotedPointerVersion(FEDERAL_MONEY_RECORD_CLASS, scope, entry.kind === "PROMOTED" ? entry.projection : null));
      }
      states[lower] = { value: { kind: "PROMOTED_POINTERS", entries } satisfies PromotedFamilyArtifactValue,
        versionId: promotedFamilyVersion(versions) };
    } catch (error) { skipped.push(`federal-money/${lower} ${error instanceof Error ? error.message : String(error)}`); }
  }
  return { states, skipped };
}
