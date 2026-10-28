import type { RoutineDataStore } from "../civic-data/store.ts";
import type { PromotedPointerIdentity } from "../civic-data/types.ts";
import { federalMoneyScope, type FederalMoneyCheckpoint, type FederalMoneyCounts, type FederalMoneySource } from "./model.ts";

export interface FederalMoneyProgress extends Pick<PromotedPointerIdentity,"versionId"|"promotedAt"|"latestConfirmation"> {
  readonly counts: FederalMoneyCounts;
  readonly checkpoint: FederalMoneyCheckpoint["checkpoint"] | null;
}

/** A source resumes from its cursor and counts, never the held source record or candidate. */
export async function readFederalMoneyProgress(store: RoutineDataStore, source: FederalMoneySource, state: string): Promise<FederalMoneyProgress | null> {
  const pointer = await store.readPromotionIdentity("FEDERAL_MONEY",federalMoneyScope(source,state));
  if(!pointer)return null;
  const [counts,checkpoint]=await Promise.all([
    store.readCandidatePath<FederalMoneyCounts>(pointer.versionId,["readModel","counts"]),
    store.readCandidatePath<FederalMoneyCheckpoint["checkpoint"]>(pointer.versionId,["readModel","checkpoint"]),
  ]);
  if(!counts)throw new Error(`Federal source progress has no saved counts: ${source}:${state}`);
  return {versionId:pointer.versionId,promotedAt:pointer.promotedAt,latestConfirmation:pointer.latestConfirmation,counts,checkpoint};
}
