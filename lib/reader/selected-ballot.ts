import { stateBallotScope } from "../civic-data/state-scopes.ts";
import { selectedPointerSql, selectedMetadataSql } from "./selected-entry.ts";

/** The same contest, candidate and related-record membership as ballotForDivisions, selected before transport. */
export function selectedBallotStatement(state: string, divisions: readonly string[], divisionSql = "SELECT unnest($2::text[]) AS id") {
  const array = (field: string, predicate: string) => `coalesce((SELECT jsonb_agg(reader_payload_value(v) ORDER BY ordinal_index)
    FROM reader_payload_members(ballot.value->'${field}') member,
      LATERAL (SELECT reader_payload_node(member.item) AS v) item WHERE ${predicate}),'[]'::jsonb)`;
  const contestIds = "SELECT value->>'id' FROM contests";
  const filingIds = `${contestIds} UNION SELECT value->>'id' FROM held_contests`;
  const fields: [string,string][] = [
    ["contests", "coalesce((SELECT jsonb_agg(reader_payload_value(value) ORDER BY ordinal_index) FROM contests),'[]'::jsonb)"],
    ["absences", array("absences", "v->>'ocdId' IN (SELECT id FROM districts)")],
    ["candidacies", array("candidacies", `v->>'contestId' IN (${contestIds})`)],
    ["measures", array("measures", `v->>'contestId' IN (${contestIds})`)],
  ];
  const optional: [string,string][] = [
    ["heldContests", "coalesce((SELECT jsonb_agg(reader_payload_value(value) ORDER BY ordinal_index) FROM held_contests),'[]'::jsonb)"],
    ["filingCandidacies", array("filingCandidacies", `v->>'contestId' IN (${filingIds})`)],
    ["contacts", array("contacts", `v->>'candidacyId' IN (SELECT reader_payload_node(c.item)->>'id'
      FROM reader_payload_members(ballot.value->'candidacies') c WHERE reader_payload_node(c.item)->>'contestId' IN (${contestIds}))`)],
    ...["measureRecords", "removals"].map(field => [field, array(field, `v->>'contestId' IN (${contestIds})`)] as [string,string]),
    ...[["generalLineup","contests"],["measureAnalyses","analyses"],["lineupReconciliation","rows"]].map(([field, list]) => [field,
      `reader_payload_value(reader_payload_node(ballot.value->'${field}')-'${list}')||jsonb_build_object('${list}',
        coalesce((SELECT jsonb_agg(reader_payload_value(v) ORDER BY ordinal_index)
          FROM reader_payload_members(reader_payload_node(ballot.value->'${field}')->'${list}') member,
            LATERAL (SELECT reader_payload_node(member.item) AS v) item WHERE v->>'contestId' IN (${contestIds})),'[]'::jsonb))`] as [string,string]),
  ];
  const removed = [...fields,...optional].map(([key]) => `-'${key}'`).join("");
  return {params:[`BALLOT_CANDIDACY:${stateBallotScope("ballot-contests",state)}`,divisions],text:`WITH RECURSIVE
    selected_divisions AS MATERIALIZED (${divisionSql}), pointer AS MATERIALIZED (${selectedPointerSql}),
    root AS MATERIALIZED (SELECT reader_payload_node(payload) AS value FROM pointer WHERE published),
    ballot_values AS MATERIALIZED (SELECT b.key,reader_payload_node(b.value) AS value FROM root,
      LATERAL jsonb_each(reader_payload_node(root.value->'ballots')) b),
    selected AS (SELECT ballot.key, sliced.value FROM ballot_values ballot CROSS JOIN LATERAL (
      WITH RECURSIVE memberships AS MATERIALIZED (
        SELECT reader_payload_node(m.item) AS value FROM reader_payload_members(ballot.value->'districtMemberships') m
      ), districts(id) AS (
        SELECT id FROM selected_divisions UNION
        SELECT value->>'districtOcdId' FROM districts d JOIN memberships ON value->>'memberOcdId'=d.id
          AND trim(reader_payload_value(reader_payload_node(value->'provenance')->'sourceUrl')#>>'{}')<>''
          AND substring(value->>'memberOcdId' FROM '^ocd-division/country:us/(?:state|district|territory):[a-z]{2}')
            =substring(value->>'districtOcdId' FROM '^ocd-division/country:us/(?:state|district|territory):[a-z]{2}')
      ), contests AS MATERIALIZED (
        SELECT ordinal_index,reader_payload_node(c.item) AS value FROM reader_payload_members(ballot.value->'contests') c
          WHERE reader_payload_node(c.item)->>'ocdId' IN (SELECT id FROM districts)
      ), held_contests AS MATERIALIZED (
        SELECT ordinal_index,reader_payload_node(c.item) AS value FROM reader_payload_members(ballot.value->'heldContests') c
          WHERE reader_payload_node(c.item)->>'ocdId' IN (SELECT id FROM districts)
      ) SELECT reader_payload_value(ballot.value${removed})||jsonb_build_object(${fields.map(([key,value])=>`'${key}',${value}`).join(",")})
        ${optional.map(([key,value])=>`||CASE WHEN ballot.value?'${key}' THEN jsonb_build_object('${key}',${value}) ELSE '{}'::jsonb END`).join("\n")}
        AS value WHERE EXISTS(SELECT 1 FROM contests UNION ALL SELECT 1 FROM held_contests)
    ) sliced)
    SELECT ${selectedMetadataSql},CASE WHEN published THEN reader_payload_value(root.value-'ballots')||jsonb_build_object('ballots',
      coalesce((SELECT jsonb_object_agg(key,value) FROM selected),'{}'::jsonb)) END AS payload
    FROM pointer LEFT JOIN root ON true`};
}
