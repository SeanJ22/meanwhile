import type { ElectionResultStatus, ElectionSummary, ResultSource } from "../election-results/types.ts";
import type { BallotSet } from "./types.ts";
import { withCandidateTickets } from "./tickets.ts";

interface ResultAttribution {
  readonly sources: readonly ResultSource[];
  readonly checkedAt: string;
  readonly sourceId?: string;
  readonly sourceRaceId?: string;
  readonly electionDate?: string;
}

export interface ContestResult extends ResultAttribution {
  readonly status: ElectionResultStatus;
  readonly percentCounted?: number | null;
  readonly statusChangedAt?: string | null;
  readonly seatsToFill?: number | null;
  readonly flipped?: boolean | null;
  readonly gainedByParty?: string | null;
  readonly incumbentLost?: boolean | null;
}

export interface CandidateResult extends ResultAttribution {
  readonly votes?: number | null;
  readonly percent?: number | null;
  readonly won?: boolean | null;
  readonly runoff?: boolean | null;
}

export interface MeasureResult extends ResultAttribution {
  readonly yesVotes?: number | null;
  readonly noVotes?: number | null;
  readonly yesPercent?: number | null;
  readonly outcome: "passed" | "failed" | "counting";
}

/** Source text stays transient; the reader carries only the published summary and its attribution. */
export type BallotElectionSummary = Omit<ElectionSummary, "quote" | "quotes" | "chambers"> & {
  readonly sourceClockKey?: string;
  readonly sources?: readonly ResultSource[];
  readonly chambers: (ElectionSummary["chambers"][number] & {
    readonly source?: ResultSource; readonly creditedSources?: readonly ResultSource[]; readonly checkedAt?: string;
  })[];
};
export type BallotResultFacts = Readonly<Record<string, unknown>>;

const statePlace = (state: string) => `ocd-division/country:us/${state === "DC" ? "district" :
  ["AS", "GU", "MP", "PR", "VI"].includes(state) ? "territory" : "state"}:${state.toLowerCase()}`;

function nationalSummary(facts: BallotResultFacts): BallotElectionSummary | undefined {
  const nation = "ocd-division/country:us";
  const base = facts[nation] as BallotElectionSummary | undefined;
  const parts = ["us_senate", "us_house"].flatMap(chamber => {
    const value = facts[`${nation}#election_summary:${chamber}`];
    return value ? [value as BallotElectionSummary] : [];
  });
  if (!parts.length) return base;
  const summaries = [...base ? [base] : [], ...parts], first = summaries[0];
  const chambers = new Map(summaries.flatMap(summary => summary.chambers.map(chamber => [chamber.name, {
    ...chamber, source: summary.source, creditedSources: summary.creditedSources, checkedAt: summary.checkedAt,
  }] as const)));
  const sources = new Map(summaries.flatMap(summary => [summary.source, ...summary.creditedSources].map(source => [JSON.stringify(source), source])));
  return { ...first, chambers: [...chambers.values()], sources: [...sources.values()],
    checkedAt: summaries.map(summary => summary.checkedAt).sort().at(-1)! };
}

/** Attach already checked facts to the ballot the reader loaded, without another database request. */
export function withBallotResultFacts<T extends { readonly ballots: Readonly<Record<string, BallotSet>> }>(projection: T,
  facts: BallotResultFacts): T {
  if (!Object.keys(facts).length) return projection;
  const resultFor = (row: { id: string; aliases?: readonly string[] }) =>
    [row.id, ...row.aliases ?? []].map(id => facts[id]).find(value => value !== undefined);
  return { ...projection, ballots: Object.fromEntries(Object.entries(projection.ballots).map(([key, original]) => {
    const ballot = withCandidateTickets(original);
    const state = facts[statePlace(ballot.election.state)], nation = nationalSummary(facts);
    const attach = <R extends { id: string; aliases?: readonly string[] }>(row: R): R => {
      const result = resultFor(row);
      return result === undefined ? row : { ...row, result };
    };
    return [key, { ...ballot, contests: ballot.contests.map(attach), candidacies: ballot.candidacies.map(attach),
      measures: ballot.measures.map(attach),
      ...(state !== undefined || nation !== undefined ? { results: { ...ballot.results,
        ...(state !== undefined ? { state: state as BallotElectionSummary } : {}),
        ...(nation !== undefined ? { nation: nation as BallotElectionSummary } : {}) } } : {}) }];
  })) };
}

/** Only this ballot's ids and aliases are looked up. A district number never joins results to a race. */
export function ballotResultFactsSql(payload: string): string {
  return `(WITH result_root AS (SELECT reader_payload_node(${payload}) AS value),
    result_ballots AS MATERIALIZED (SELECT reader_payload_node(b.value) AS value FROM result_root,
      LATERAL jsonb_each(reader_payload_node(result_root.value->'ballots')) b),
    result_clocks AS MATERIALIZED (SELECT name,position::jsonb AS value FROM pass_cursor WHERE name IN (
      SELECT 'election-results:'||(value#>>'{election,state}') FROM result_ballots UNION SELECT 'election-results:US')),
    result_records AS MATERIALIZED (SELECT reader_payload_node(r.item) AS value,b.value#>>'{election,state}' AS state FROM result_ballots b,
      LATERAL (VALUES ('contests'),('candidacies'),('measures')) fields(name),
      LATERAL reader_payload_members(b.value->fields.name) r),
    result_ids AS (
      SELECT value->>'id' AS id,'election_result'::text AS field,state FROM result_records
      UNION SELECT a.id,'election_result',r.state FROM result_records r,
        LATERAL jsonb_array_elements_text(coalesce(reader_payload_value(r.value->'aliases'),'[]'::jsonb)) a(id)
      UNION SELECT (reader_payload_node(c.item)->>'contestId')||'|'||(reader_payload_node(n.item)->>'name'),'election_result',b.value#>>'{election,state}'
        FROM result_ballots b,LATERAL reader_payload_members(reader_payload_node(b.value->'generalLineup')->'contests') c,
        LATERAL reader_payload_members(reader_payload_node(c.item)->'nominees') n
      UNION SELECT 'ocd-division/country:us/'||CASE WHEN value#>>'{election,state}'='DC' THEN 'district'
          WHEN value#>>'{election,state}' IN ('AS','GU','MP','PR','VI') THEN 'territory' ELSE 'state' END
        ||':'||lower(value#>>'{election,state}'),'election_summary',value#>>'{election,state}' FROM result_ballots
      UNION SELECT 'ocd-division/country:us','election_summary','US' WHERE EXISTS(SELECT 1 FROM result_ballots)
      UNION SELECT 'ocd-division/country:us',field,'US' FROM (VALUES ('election_summary:us_senate'),('election_summary:us_house')) chambers(field)
        WHERE EXISTS(SELECT 1 FROM result_ballots)
    ) SELECT coalesce(jsonb_object_agg(CASE WHEN f.field LIKE 'election_summary:%' THEN ids.id||'#'||f.field ELSE ids.id END,
      f.value||jsonb_build_object('checkedAt',CASE WHEN receipt.at~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T' AND receipt.at>=checked.at
        THEN receipt.at ELSE checked.at END)),'{}'::jsonb) FROM result_ids ids
      LEFT JOIN entity_external_id alias ON alias.scheme='body-alias' AND alias.value=ids.id
      JOIN checked_fact f ON f.entity_id=coalesce(alias.entity_id,ids.id) AND f.field=ids.field AND f.status='live'
      CROSS JOIN LATERAL (SELECT to_char(f.checked_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at) checked
      LEFT JOIN result_clocks clock ON clock.name='election-results:'||ids.state
      LEFT JOIN LATERAL (SELECT CASE WHEN f.field='election_result' THEN
        clock.value->'races'->((f.value->>'sourceId')||':'||(f.value->>'electionDate')||':'||(f.value->>'sourceRaceId'))->>'lastCheckedAt'
        ELSE clock.value->'sourceChecks'->(f.value->>'sourceClockKey')->>'lastSucceededAt' END AS at) receipt ON true)`;
}

/** Publication metadata and result changes share the existing small fingerprint request. */
export const BALLOT_RESULT_VERSION_SQL = `(SELECT coalesce(string_agg(jsonb_build_array(id,version)::text,'|' ORDER BY id),'') FROM (
  SELECT f.id::text,f.xmin::text||coalesce((SELECT string_agg(c.xmin::text,',' ORDER BY c.source_copy_id,c.scope)
    FROM fact_confirmation c WHERE c.fact_ids @> ARRAY[f.id]),'') AS version FROM entity e JOIN fact f ON f.entity_id=e.id
    WHERE e.state=ANY(ARRAY(SELECT substring(key FROM '^BALLOT_CANDIDACY:US-([A-Z]{2}):') FROM unnest($1::text[]) key))
      AND f.status='live' AND (f.field IN ('election_result','election_summary') OR f.field LIKE 'election_summary:%')
  UNION ALL SELECT f.id::text,f.xmin::text||coalesce((SELECT string_agg(c.xmin::text,',' ORDER BY c.source_copy_id,c.scope)
    FROM fact_confirmation c WHERE c.fact_ids @> ARRAY[f.id]),'') FROM fact f WHERE f.entity_id='ocd-division/country:us'
    AND f.status='live' AND (f.field='election_summary' OR f.field LIKE 'election_summary:%')
  UNION ALL SELECT c.name,c.xmin::text FROM pass_cursor c WHERE c.name=ANY(ARRAY(
    SELECT 'election-results:'||substring(key FROM '^BALLOT_CANDIDACY:US-([A-Z]{2}):') FROM unnest($1::text[]) key
    UNION SELECT 'election-results:US'))) versions)`;
