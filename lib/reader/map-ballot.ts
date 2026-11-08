import { stateBallotScope } from "../civic-data/state-scopes.ts";
import { ballotResultFactsSql, withBallotResultFacts, type BallotResultFacts } from "../ballot/election-results.ts";
import type { GenericBallotProjection } from "../ballot/generic-projection.ts";
import type { BallotSet } from "../ballot/types.ts";
import { selectedMetadataSql, selectedPointerSql } from "./selected-entry.ts";

/** `state` draws one state's districts and U.S. Senate seat; `nation` draws only the federal races every state shares. */
export type MapBallotKinds = "state" | "nation";

/**
 * The contests the results map draws, and their candidates, with filed results attached: selected inside the database,
 * so a national view moves a few hundred kilobytes in one request, never fifty whole ballots. The title test for the
 * Senate is deliberately loose; the map's own office check is exact.
 */
export function mapBallotStatement(states: readonly string[], kinds: MapBallotKinds) {
  const ocd = "reader_payload_node(m.item)->>'ocdId'", title = "reader_payload_node(m.item)->>'title'";
  return { params: [states.map(state => `BALLOT_CANDIDACY:${stateBallotScope("ballot-contests", state)}`), kinds], text: `WITH RECURSIVE
    pointer AS MATERIALIZED (${selectedPointerSql.replace("p.key=$1", "p.key=ANY($1::text[])")}),
    roots AS MATERIALIZED (SELECT key,reader_payload_node(payload) AS value FROM pointer WHERE published),
    ballots AS MATERIALIZED (SELECT r.key AS pointer_key,b.key AS ballot_key,reader_payload_node(b.value) AS value
      FROM roots r,LATERAL jsonb_each(reader_payload_node(r.value->'ballots')) b),
    contests AS MATERIALIZED (SELECT b.pointer_key,b.ballot_key,m.ordinal_index,reader_payload_node(m.item) AS value
      FROM ballots b,LATERAL reader_payload_members(b.value->'contests') m
      WHERE ${ocd} ~ '/cd:[^/]+$' OR ($2='state' AND ${ocd} ~ '/(sldu|sldl):[^/]+$')
        OR (${ocd} ~ '^ocd-division/country:us/(state|district|territory):[a-z]{2}$' AND ${title} ~* 'senat')),
    selected AS (SELECT b.pointer_key,b.ballot_key,jsonb_build_object(
      'election',reader_payload_value(reader_payload_node(b.value->'election')),
      'contests',coalesce((SELECT jsonb_agg(reader_payload_value(c.value) ORDER BY c.ordinal_index) FROM contests c
        WHERE c.pointer_key=b.pointer_key AND c.ballot_key=b.ballot_key),'[]'::jsonb),
      'candidacies',coalesce((SELECT jsonb_agg(reader_payload_value(reader_payload_node(m.item)) ORDER BY m.ordinal_index)
        FROM reader_payload_members(b.value->'candidacies') m WHERE reader_payload_node(m.item)->>'contestId' IN
          (SELECT c.value->>'id' FROM contests c WHERE c.pointer_key=b.pointer_key AND c.ballot_key=b.ballot_key)),'[]'::jsonb),
      'measures','[]'::jsonb) AS value FROM ballots b),
    projected AS (SELECT ${selectedMetadataSql},CASE WHEN published THEN jsonb_build_object('ballots',
      coalesce((SELECT jsonb_object_agg(s.ballot_key,s.value) FROM selected s WHERE s.pointer_key=pointer.key),'{}'::jsonb)) END AS payload
      FROM pointer)
    SELECT projected.*,${ballotResultFactsSql("projected.payload")} AS election_results FROM projected` };
}

type Rows = readonly Record<string, unknown>[];

/** The sliced ballots of every state the statement covered, with each state's result facts attached. */
export function mapBallotsFromRows(rows: Rows): BallotSet[] {
  return rows.flatMap(row => {
    if (row.published !== true) throw new Error("READER_PUBLISHED_POINTER_INVALID");
    const payload = row.payload as GenericBallotProjection;
    const withResults = row.election_results ? withBallotResultFacts(payload, row.election_results as BallotResultFacts) : payload;
    return Object.values(withResults.ballots) as BallotSet[];
  });
}
