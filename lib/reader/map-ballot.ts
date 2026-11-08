import { stateBallotScope } from "../civic-data/state-scopes.ts";
import type { GenericBallotProjection } from "../ballot/generic-projection.ts";
import type { BallotSet } from "../ballot/types.ts";
import { selectedMetadataSql, selectedPointerSql } from "./selected-entry.ts";

/**
 * One state's contests the results map draws (districts and the U.S. Senate seat) and their candidates, selected inside
 * the database: a state with thousands of local races answers in a few kilobytes, never as a whole ballot. Results are
 * not here; the results job publishes them separately and the map joins them by contest id. The title test for the
 * Senate is deliberately loose; the map's own office check is exact.
 */
export function mapBallotStatement(state: string) {
  const ocd = "reader_payload_node(m.item)->>'ocdId'", title = "reader_payload_node(m.item)->>'title'";
  return { params: [`BALLOT_CANDIDACY:${stateBallotScope("ballot-contests", state)}`], text: `WITH
    pointer AS MATERIALIZED (${selectedPointerSql}),
    root AS MATERIALIZED (SELECT reader_payload_node(payload) AS value FROM pointer WHERE published),
    ballots AS MATERIALIZED (SELECT b.key AS ballot_key,reader_payload_node(b.value) AS value
      FROM root r,LATERAL jsonb_each(reader_payload_node(r.value->'ballots')) b),
    contests AS MATERIALIZED (SELECT b.ballot_key,m.ordinal_index,reader_payload_node(m.item) AS value
      FROM ballots b,LATERAL reader_payload_members(b.value->'contests') m
      WHERE ${ocd} ~ '/(cd|sldu|sldl):[^/]+$'
        OR (${ocd} ~ '^ocd-division/country:us/(state|district|territory):[a-z]{2}$' AND ${title} ~* 'senat')),
    selected AS (SELECT b.ballot_key,jsonb_build_object(
      'election',reader_payload_value(reader_payload_node(b.value->'election')),
      'contests',coalesce((SELECT jsonb_agg(reader_payload_value(c.value) ORDER BY c.ordinal_index) FROM contests c WHERE c.ballot_key=b.ballot_key),'[]'::jsonb),
      'candidacies',coalesce((SELECT jsonb_agg(reader_payload_value(reader_payload_node(m.item)) ORDER BY m.ordinal_index)
        FROM reader_payload_members(b.value->'candidacies') m WHERE reader_payload_node(m.item)->>'contestId' IN
          (SELECT c.value->>'id' FROM contests c WHERE c.ballot_key=b.ballot_key)),'[]'::jsonb),
      'measures','[]'::jsonb) AS value FROM ballots b)
    SELECT ${selectedMetadataSql},CASE WHEN published THEN jsonb_build_object('ballots',
      coalesce((SELECT jsonb_object_agg(s.ballot_key,s.value) FROM selected s),'{}'::jsonb)) END AS payload
    FROM pointer` };
}

/** The sliced ballots of the state the statement covered; none when the state has no published ballot. */
export function mapBallotsFromRows(rows: readonly Record<string, unknown>[]): BallotSet[] {
  return rows.flatMap(row => {
    if (row.published !== true) throw new Error("READER_PUBLISHED_POINTER_INVALID");
    return Object.values((row.payload as GenericBallotProjection).ballots) as BallotSet[];
  });
}
