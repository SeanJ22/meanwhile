import type { BallotSet } from "../ballot/types.ts";
import type { BallotResultFacts } from "../ballot/election-results.ts";
import { withCandidateTickets } from "../ballot/tickets.ts";
import { withCurrentCandidacies } from "../ballot/filing-changes.ts";
import { canonicalCivicDataHash } from "../civic-data/canonical-hash.ts";
import type { StateResultFeed } from "./feed-types.ts";
import type { GenericBallotProjection } from "../ballot/generic-projection.ts";
import type { ResultProgress } from "./publisher.ts";
import { readBallotResultPublication, readCanonicalShelf } from "../reader/canonical.ts";
import { stateBallotScope } from "../civic-data/state-scopes.ts";
import type { Query } from "../facts/publish.ts";

export interface ResultProjection {
  readonly key: string;
  readonly versionId: string;
  readonly hash: string | null;
  readonly payload: GenericBallotProjection;
  readonly facts: BallotResultFacts;
}

/** The job's authority and existing Slide facts share its one state-ballot read. */
export async function readResultProjection(query: Query, state: string): Promise<ResultProjection | null> {
  const scope = stateBallotScope("ballot-contests", state), key = `BALLOT_CANDIDACY:${scope}`;
  const store = await readBallotResultPublication(scope, resultFactsForPublicationSql("p.payload"), async statements => {
    const rows = [];
    for (const statement of statements) rows.push(await query(statement.text, statement.params));
    return rows;
  });
  const entry = await store.readPromotedEntry!("BALLOT_CANDIDACY", scope);
  if (entry.kind === "NOT_RECORDED") return null;
  if (entry.kind !== "PROMOTED") throw new Error(`Election results cannot read ${state}'s served ballot`);
  return { key, versionId: entry.projection.versionId, payload: entry.projection.payload as GenericBallotProjection,
    hash: null,
    facts: store.additionalRows[0]?.facts as BallotResultFacts ?? {} };
}

/** Every state's served ballot and its already filed result facts in one read. A state with no served ballot is null. */
export async function readResultProjections(query: Query, states: readonly string[]): Promise<Map<string, ResultProjection | null>> {
  const scopes = states.map(state => stateBallotScope("ballot-contests", state)), keys = scopes.map(scope => `BALLOT_CANDIDACY:${scope}`);
  const store = await readCanonicalShelf(scopes.map(scope => ({ recordClass: "BALLOT_CANDIDACY" as const, scope })), async statements => {
    const rows = [];
    for (const statement of statements) rows.push(await query(statement.text, statement.params));
    return rows;
  }, { text: `SELECT p.key,${resultFactsForPublicationSql("p.payload")} AS facts FROM civic_data_promotions p WHERE p.key=ANY($1::text[])`, params: [keys] });
  const out = new Map<string, ResultProjection | null>();
  for (const [index, state] of states.entries()) {
    const entry = await store.readPromotedEntry!("BALLOT_CANDIDACY", scopes[index]);
    if (entry.kind === "NOT_RECORDED") { out.set(state, null); continue; }
    if (entry.kind !== "PROMOTED") throw new Error(`Election results cannot read ${state}'s served ballot`);
    out.set(state, { key: keys[index], versionId: entry.projection.versionId, payload: entry.projection.payload as GenericBallotProjection, hash: null,
      facts: store.additionalRows.find(row => row.key === keys[index])?.facts as BallotResultFacts ?? {} });
  }
  return out;
}

/** Confirmation dates change in the prepared feed, never at ballot request time. */
export function refreshedResultFacts(facts: BallotResultFacts, progress: ResultProgress & {
  sourceChecks?: Readonly<Record<string, { lastSucceededAt?: string }>> }, nation?: ResultProgress & {
  sourceChecks?: Readonly<Record<string, { lastSucceededAt?: string }>> }): BallotResultFacts {
  return Object.fromEntries(Object.entries(facts).map(([id, raw]) => {
    if (!raw || typeof raw !== "object") return [id, raw];
    const value = raw as Record<string, unknown>, clock = id.startsWith("ocd-division/country:us#") || id === "ocd-division/country:us" ? nation : progress;
    const race = `${value.sourceId}:${value.electionDate}:${value.sourceRaceId}`;
    const checkedAt = clock?.races[race]?.lastCheckedAt ?? clock?.sourceChecks?.[String(value.sourceClockKey)]?.lastSucceededAt;
    return [id, checkedAt && checkedAt > String(value.checkedAt ?? "") ? { ...value, checkedAt } : raw];
  }));
}

/** Publish only card facts and their grouping; the source ballot and source documents never enter the feed. */
export function preparedStateResultFeed(projection: ResultProjection, facts: BallotResultFacts, state: string, checkedAt: string): StateResultFeed {
  const normalized: Record<string, unknown> = {}, contestIds: Record<string, string[]> = {};
  const attach = (row: { id: string; aliases?: readonly string[] }) => {
    const ids = [row.id, ...row.aliases ?? []];
    const found = ids.map(id => facts[id]).find(value => value !== undefined);
    if (found !== undefined) for (const id of ids) normalized[id] = found;
  };
  for (const source of projectionBallots(projection)) {
    const ballot = withCandidateTickets(withCurrentCandidacies(source));
    for (const contest of ballot.contests) {
      const rows = [contest, ...ballot.candidacies.filter(row => row.contestId === contest.id), ...ballot.measures.filter(row => row.contestId === contest.id)];
      const ids = [...new Set(rows.flatMap(row => [row.id, ...("aliases" in row ? row.aliases ?? [] : [])]))];
      for (const id of [contest.id, ...contest.aliases ?? []]) contestIds[id] = ids;
      for (const row of rows) attach(row);
    }
  }
  const place = `ocd-division/country:us/${state === "DC" ? "district" : ["AS", "GU", "MP", "PR", "VI"].includes(state) ? "territory" : "state"}:${state.toLowerCase()}`;
  for (const [id, value] of Object.entries(facts)) if (id === place || /^ocd-division\/country:us(?:#election_summary:(?:us_house|us_senate))?$/.test(id)) normalized[id] = value;
  const value = { formatVersion: 1 as const, state, ballotVersion: projection.versionId, checkedAt, facts: normalized, contestIds };
  return { ...value, fingerprint: canonicalCivicDataHash(value, { durable: true }) };
}

export const projectionBallots = (projection: ResultProjection): readonly BallotSet[] => Object.values(projection.payload.ballots);

/** Only this ballot's ids and aliases are looked up. A district number never joins results to a race. */
export function resultFactsForPublicationSql(payload: string): string {
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

