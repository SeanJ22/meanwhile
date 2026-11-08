import { resultFeedStore, type ElectionResultFeedStore } from "../election-results/feed-store.ts";
import type { StateResultFeed } from "../election-results/feed-types.ts";
import type { NationalCongressSummary } from "../election-results/summary.ts";

/** The job already published this document. A reader never opens a database connection. */
export function readNationalElectionResults(store: ElectionResultFeedStore = resultFeedStore()): Promise<NationalCongressSummary | null> {
  return store.readNation();
}

export async function readStateElectionResults(state: string, contests?: readonly string[],
  store: ElectionResultFeedStore = resultFeedStore()): Promise<StateResultFeed | null> {
  const feed = await store.readState(state);
  if (!feed || !contests) return feed;
  const indexed = (id: string) => feed.contestIds && Object.hasOwn(feed.contestIds, id) ? feed.contestIds[id] : undefined;
  const ids = new Set(contests.flatMap(id => [id, ...indexed(id) ?? []]));
  const summaryId = (id: string) => /^ocd-division\/country:us(?:#election_summary:(?:us_house|us_senate))?$/.test(id)
    || id === `ocd-division/country:us/${state === "DC" ? "district" : ["AS", "GU", "MP", "PR", "VI"].includes(state) ? "territory" : "state"}:${state.toLowerCase()}`;
  return { ...feed, facts: Object.fromEntries(Object.entries(feed.facts).filter(([id]) => ids.has(id) || summaryId(id))),
    ...(feed.contestIds ? { contestIds: Object.fromEntries(contests.flatMap(id => indexed(id) ? [[id, indexed(id)!]] : [])) } : {}) };
}
