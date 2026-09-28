import type { ControlPlaneRepositories } from "../repository/types.ts";
import type { ChecklistCensus } from "./checklist-census.ts";
import type { OwnerSnapshot } from "../owner-surface.ts";

/** One narrow durable read. A failed request never becomes an empty census. */
export async function readChecklistCensuses(repos:ControlPlaneRepositories):Promise<
  {kind:"HELD";publishedAt:string;rows:readonly ChecklistCensus[]} | {kind:"UNREAD";detail:string}
> {
  try {
    const row=await repos.ownerSnapshots.readNarrowed("current",{publishedAt:true,checklists:true});
    const value=row?.value as Pick<OwnerSnapshot,"publishedAt"|"checklists">|undefined;
    if (!value?.checklists) return {kind:"UNREAD",detail:"The installed runner has not published the checklist inventory yet."};
    return {kind:"HELD",publishedAt:value.publishedAt,rows:value.checklists};
  } catch {
    return {kind:"UNREAD",detail:"The checklist inventory could not be read. Its obligations and denominator remain unmeasured."};
  }
}
