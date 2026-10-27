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
  const scopes = selected.map(ballotNavigationScope), divisions = selected.map(ballotNavigationDivision);
  if (!query) throw new Error("VOTING_LOOKUP_DATABASE_UNAVAILABLE");
  const [rows] = await query([{ text: `WITH pointers AS MATERIALIZED (
    SELECT p.scope,p.payload,
      (p.current_version_id=p.last_known_good_version_id AND c.id=p.current_version_id AND c.source_id=p.source_id
       AND p.source_id='curated-reader-primary-sources' AND c.record_class=p.record_class AND c.scope=p.scope
       AND c.state='PROMOTED' AND c.acquisition_succeeded AND c.promoted_version_id=c.id AND c.last_known_good_version_id=c.id
       AND c.candidate#>'{normalization,succeeded}'='true'::jsonb AND p.payload=c.candidate->'readModel'
       AND c.normalized_hash ~ '^[a-f0-9]{64}$' AND c.candidate#>>'{normalization,normalizedHash}'=c.normalized_hash
       AND p.validation_receipt=c.validation_receipt AND p.validation_receipt->>'decision'='GOOD'
       AND p.validation_receipt->>'candidateId'=c.id AND p.validation_receipt->>'sourceId'=c.source_id
       AND p.validation_receipt->>'recordClass'=p.record_class AND p.validation_receipt->>'scope'=p.scope) AS valid
    FROM civic_data_promotions p LEFT JOIN civic_data_candidates c ON c.id=p.current_version_id
    WHERE p.record_class='CURATED_READER_RECORD' AND p.scope=ANY($1::text[])
  ), records AS (
    SELECT p.scope,reader_payload_node(r.item) AS record FROM pointers p,
      LATERAL reader_payload_members(reader_payload_node(p.payload)->'records') r WHERE p.valid
  ), lookups AS (
    SELECT scope,record->>'id' AS id,record->>'kind' AS kind,reader_payload_node(record->'value') AS value FROM records
  ) SELECT scope,true AS valid,id,kind,reader_payload_value(value) AS value FROM lookups
    WHERE kind='ELECTION_FIELD' AND value->>'fieldKind'='polling_lookup' AND value->>'divisionId'=ANY($2::text[])
  UNION ALL SELECT scope,false,NULL,NULL,NULL FROM pointers WHERE NOT coalesce(valid,false)`, params: [scopes, divisions] }]);
  if (rows.some(row => row.valid !== true)) throw new Error("VOTING_LOOKUP_PUBLISHED_PROOF_INVALID");
  const records = rows.map(row => ({ id: String(row.id), kind: row.kind, value: row.value })) as PublishedElectionField[];
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
