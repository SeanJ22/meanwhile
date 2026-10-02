import { jurisdictionFromOcdId } from "../coverage/states.ts";

/** Geographic identity only. Ballot availability belongs to the sourced records. */
export function stateFromOcdIds(ocdIds: readonly (string | null)[]): string | null {
  for (const id of ocdIds) {
    const state = jurisdictionFromOcdId(id);
    if (state) return state.slug;
  }
  return null;
}
