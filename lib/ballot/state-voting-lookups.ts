import {readCanonicalShelf} from "../reader/canonical.ts";
import { ballotNavigationDivision, ballotNavigationScope } from "../civic-data/ballot-navigation-scope.ts";
import { electionFieldIssue, type PublishedElectionField } from "../civic-data/election-fields.ts";
import { readerQuery } from "../civic-data/promoted-reader-query.ts";
import type { ReadOnlyQuery } from "../control-plane/admin-view/promoted-slices.ts";
import { stateName } from "../facts/entity-read.ts";
import { readerRecordsWithOwnerChoices } from "../facts/owner-flags.ts";

export interface StateVotingLookup {
  readonly state: string;
  readonly name: string;
  readonly url: string;
  readonly sourceUrl: string;
  readonly sourceOrg: string;
  readonly checkedAt: string;
}

/** Only the state's published lookup rows leave Postgres. The database reader checks
 * result fingerprints, so unchanged bodies are reused without a whole-state read. */
export async function readStateVotingLookups(states: readonly string[], deadlineMs?: number,
  query: ReadOnlyQuery | null = readerQuery(deadlineMs)): Promise<StateVotingLookup[]> {
  const selected = [...new Set(states.map(state => state.toUpperCase()))];
  if (!selected.length) return [];
  if (!query) throw new Error("VOTING_LOOKUP_DATABASE_UNAVAILABLE");
  const shelf=await readCanonicalShelf(selected.map(state=>({recordClass:"CURATED_READER_RECORD" as const,scope:ballotNavigationScope(state)})),query);
  const records:PublishedElectionField[]=[];
  for(const state of selected) {
    const entry=await shelf.readPromotedEntry!("CURATED_READER_RECORD",ballotNavigationScope(state));
    if(entry.kind!=="PROMOTED")continue;
    if(entry.projection.sourceId!=="curated-reader-primary-sources")throw new Error("VOTING_LOOKUP_PUBLISHED_PROOF_INVALID");
    const payload=entry.projection.payload as {records:PublishedElectionField[]};
    records.push(...payload.records.filter(row=>row.kind==='ELECTION_FIELD'&&row.value.fieldKind==='polling_lookup'));
  }
  const chosen = await readerRecordsWithOwnerChoices(async (text, params = []) => (await query([{ text, params }]))[0] ?? [],
    "ballot-navigation", records);
  const latest = new Map<string, StateVotingLookup>();
  for (const record of chosen) {
    if (electionFieldIssue(record)) throw new Error("VOTING_LOOKUP_INVALID");
    const value = record.value;
    if (!selected.includes(value.state) || value.divisionId !== ballotNavigationDivision(value.state)) throw new Error("VOTING_LOOKUP_WRONG_STATE");
    const prior = latest.get(value.state);
    if (prior && Date.parse(prior.checkedAt) > Date.parse(value.verifiedAt)) continue;
    latest.set(value.state, { state: value.state, name: stateName(value.state)!,
      url: value.navigationUrl!, sourceUrl: value.url, sourceOrg: value.sourceOrg, checkedAt: value.verifiedAt });
  }
  return selected.flatMap(state => latest.has(state) ? [latest.get(state)!] : []);
}
