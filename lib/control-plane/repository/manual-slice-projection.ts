import { coveringPlaces, queryState, type FieldManualEntry, type FieldManualQuery } from "../field-manual.ts";
import { mergePlaceResults, type PlaceResult } from "../field-manual-places.ts";
import { stateOfPlace } from "../../method/fix-map.ts";
import type { AggregateRepository, Persisted, RecordProjection } from "./types.ts";

/** The reusable procedure, rather than the places that accumulated under it. */
export const MANUAL_PROCEDURE_FIELDS = ["procedure", "source", "label", "haveAdapter", "hostPattern", "flags", "markup", "text", "model", "modelReviewed", "installed", "implementationVersion", "tried", "nextAction", "id", "routeId", "title", "tier", "kind", "fields", "applicability", "origin", "learnedAtVersion", "learnedOn", "retiredOn", "retiredReason", "effort", "claims", "version", "updatedOn", "recordClass", "host", "fieldNames", "subjectId", "platform", "recordClasses", "linkingArtifactId", "sourceAttemptId", "sourceUrls", "stream", "files", "evidence", "outcome", "reason", "adapter", "command", "fingerprint", "pattern", "patterns", "url", "body", "contentType", "headers", "selectors", "steps", "config", "methodId", "parserId", "notes", "divisionId", "kindLabel", "owedSince", "sourceUrl", "firstRecordId"] as const;
export const MANUAL_METADATA_PROJECTION: RecordProjection = { id: true, role: true, kind: true, title: true, summary: true, states: true,
  recordClasses: true, platforms: true, portable: true, foundBy: true, outcome: true, url: true, source: true, observedAt: true, tier: true,
  reach: ["states", "platforms", "everywhere", "method"], payload: MANUAL_PROCEDURE_FIELDS };

/** File/local providers use their streaming array reader, never a full method row. */
export async function projectManualRow(repo: AggregateRepository<FieldManualEntry>, id: string, query: FieldManualQuery): Promise<Persisted<FieldManualEntry> | null> {
  const row = await repo.readNarrowed(id, MANUAL_METADATA_PROJECTION);
  if (!row) return null;
  if (!repo.readArrayPage) throw new Error("FIELD_MANUAL_STREAMED_ARRAY_REQUIRED");
  const value = row.value as FieldManualEntry, covering = new Set(coveringPlaces(query)), state = queryState(query);
  const ocdIds: string[] = [], bodyIds: string[] = [], reachPlaces: string[] = [], placeResults: PlaceResult[] = [], states = new Set<string>(), places: string[] = [];
  let hasExplicit = false, here: "WORKS" | "FAILS" | null = null;
  const visit = async (field: string | readonly string[], read: (value: unknown) => void | Promise<void>) => {
    let after = 0;
    for (;;) {
      const page = await repo.readArrayPage!(id, field, { after, limit: 128 });
      if (!page) throw new Error(`FIELD_MANUAL_METHOD_MISSING:${id}`);
      for (const item of page.values) await read(item);
      if (page.next === null) break;
      after = page.next;
    }
  };
  const observe = (result: PlaceResult) => {
    const exact = covering.has(result.place);
    if (exact && (result.outcome === "FAILED" || result.outcome === "BLOCKED")) here = "FAILS";
    else if (exact && result.outcome === "YIELDED" && here === null) here = "WORKS";
    if (exact || (state && result.place === `state:${state}`)) placeResults.push(result);
    if (result.outcome !== "YIELDED" || result.place === "any") return;
    const st = result.place.startsWith("state:") ? result.place.slice(6) : stateOfPlace(result.place);
    if (st) states.add(st);
    if (!result.place.startsWith("state:")) { places.push(result.place); places.sort(); if (places.length > 3) places.pop(); }
  };
  await visit("placeResults", item => { hasExplicit = true; observe(item as PlaceResult); });
  const partial = await repo.readNarrowed(id, { placeResultsPartial: true });
  const implicit = async (place: string) => {
    if (hasExplicit && !(partial?.value as { placeResultsPartial?: boolean }).placeResultsPartial) return;
    const found = await repo.readArrayPage!(id, "placeResults", { match: { path: ["place"], value: place }, limit: 2 });
    observe(mergePlaceResults([{ place, outcome: value.outcome, observedAt: value.observedAt }], found?.values as PlaceResult[] ?? [])[0]);
  };
  let hasSpecific = false;
  await visit("ocdIds", async item => { const place = String(item); hasSpecific = true; if (covering.has(place)) ocdIds.push(place); await implicit(place); });
  await visit("bodyIds", async item => { const body = String(item); hasSpecific = true; if (covering.has(`body:${body}`)) bodyIds.push(body); await implicit(`body:${body}`); });
  if (!hasSpecific) for (const st of value.states) await implicit(`state:${st}`);
  await visit(["reach", "places"], item => { if (covering.has(String(item))) reachPlaces.push(String(item)); });
  const outcomes: unknown[] = [], subBranches: unknown[] = [];
  const inJob = (item: unknown) => {
    const jurisdiction = (item as { jurisdiction?: unknown } | null)?.jurisdiction;
    return typeof jurisdiction === "string" && (covering.has(jurisdiction.toLowerCase().split("#")[0]) || (covering.size === 0 && state &&
      (stateOfPlace(jurisdiction) === state || jurisdiction.toLowerCase().startsWith(`${state}:`))));
  };
  await visit(["payload", "outcomes"], item => { if (inJob(item)) outcomes.push(item); });
  await visit(["payload", "subBranches"], item => { if (inJob(item)) subBranches.push(item); });
  return { ...row, value: { ...value, ocdIds, bodyIds, placeResults, placeResultsPartial: false,
    reach: { places: [...new Set([...reachPlaces, ...ocdIds, ...bodyIds.map(body => `body:${body}`)])], states: value.reach?.states ?? value.states,
      platforms: value.reach?.platforms ?? value.platforms, everywhere: value.reach?.everywhere ?? Boolean(value.portable), ...(value.reach?.method ? { method: true } : {}) },
    payload: value.payload && typeof value.payload === "object" ? { ...value.payload, outcomes, subBranches } : value.payload,
    scopeEvidence: { here, places: [...new Set(places)], states: [...states].sort() } } };
}

/** SQL evaluates the original country arrays, returning only this job's evidence and finite summary metadata. */
export function manualSliceProjectionSql(alias = "m"): string {
  const v = `${alias}.value`, safe = (path: string) => `CASE WHEN jsonb_typeof(${path})='array' THEN ${path} ELSE '[]'::jsonb END`;
  const explicit = safe(`${v}->'placeResults'`);
  const implicit = `SELECT jsonb_build_object('place',place,'outcome',${v}->>'outcome','observedAt',${v}->'observedAt') AS observation FROM (
    SELECT jsonb_array_elements_text(${safe(`${v}->'ocdIds'`)}) AS place
    UNION ALL SELECT 'body:'||jsonb_array_elements_text(${safe(`${v}->'bodyIds'`)})
    UNION ALL SELECT 'state:'||jsonb_array_elements_text(${safe(`${v}->'states'`)}) WHERE jsonb_array_length(${safe(`${v}->'ocdIds'`)})=0 AND jsonb_array_length(${safe(`${v}->'bodyIds'`)})=0
  ) implicit WHERE jsonb_typeof(${v}->'placeResults') IS DISTINCT FROM 'array' OR ${v}->>'placeResultsPartial'='true'`;
  const history = `(WITH observations AS (SELECT observation FROM jsonb_array_elements(${explicit}) observation UNION ALL ${implicit}), latest AS (
    SELECT DISTINCT ON(observation->>'place') observation FROM observations ORDER BY observation->>'place',observation->>'observedAt' DESC NULLS LAST,
      CASE observation->>'outcome' WHEN 'FAILED' THEN 4 WHEN 'BLOCKED' THEN 3 WHEN 'ZERO' THEN 2 WHEN 'REFERENCE' THEN 1 ELSE 0 END DESC
  ) SELECT jsonb_build_object(
    'here',CASE WHEN EXISTS(SELECT 1 FROM latest WHERE observation->>'place'=ANY($6::text[]) AND observation->>'outcome' IN('FAILED','BLOCKED')) THEN 'FAILS'
      WHEN EXISTS(SELECT 1 FROM latest WHERE observation->>'place'=ANY($6::text[]) AND observation->>'outcome'='YIELDED') THEN 'WORKS' ELSE NULL END,
    'places',COALESCE((SELECT jsonb_agg(place ORDER BY place) FROM (SELECT observation->>'place' AS place FROM latest WHERE observation->>'outcome'='YIELDED' AND observation->>'place'<>'any' AND observation->>'place' NOT LIKE 'state:%' ORDER BY place LIMIT 3) places),'[]'::jsonb),
    'states',COALESCE((SELECT jsonb_agg(state ORDER BY state) FROM (SELECT DISTINCT CASE WHEN observation->>'place' LIKE 'state:%' THEN substring(observation->>'place' from 7) ELSE lower(substring(observation->>'place' from '(?:^|/)state:([a-zA-Z]{2})(?:/|$|#)')) END AS state FROM latest WHERE observation->>'outcome'='YIELDED') states WHERE state IS NOT NULL),'[]'::jsonb),
    'rows',COALESCE((SELECT jsonb_agg(observation) FROM latest WHERE observation->>'place'=ANY($6::text[]) OR observation->>'place'='state:'||$8::text),'[]'::jsonb)) )`;
  const selected = (field: string, prefix = "") => `(SELECT COALESCE(jsonb_agg(place),'[]'::jsonb) FROM jsonb_array_elements_text(${safe(`${v}->'${field}'`)}) place WHERE '${prefix}'||place=ANY($6::text[]))`;
  const fields = MANUAL_PROCEDURE_FIELDS.map(key => `'${key}'`).join(",");
  const jobHistory = (field: string) => `COALESCE((SELECT jsonb_agg(observation) FROM jsonb_array_elements(${safe(`${v}->'payload'->'${field}'`)}) observation
    WHERE lower(split_part(observation->>'jurisdiction','#',1))=ANY($6::text[]) OR (cardinality($6::text[])=0 AND $8::text IS NOT NULL AND (
      lower(observation->>'jurisdiction') LIKE $8::text||':%' OR lower(observation->>'jurisdiction') LIKE 'ocd-division/country:us/state:'||$8::text||'/%'
      OR lower(observation->>'jurisdiction')='ocd-division/country:us/state:'||$8::text))),'[]'::jsonb)`;
  return `SELECT ${alias}.id,${alias}.revision,${alias}.updated_at,(${v}-ARRAY['ocdIds','bodyIds','placeResults','placeResultsPartial','reach','payload'])||jsonb_build_object(
    'ocdIds',${selected("ocdIds")},'bodyIds',${selected("bodyIds", "body:")},'placeResults',h.scope->'rows','scopeEvidence',h.scope-'rows',
    'reach',jsonb_build_object('places',COALESCE((SELECT jsonb_agg(place) FROM jsonb_array_elements_text(${safe(`${v}->'reach'->'places'`)}) place WHERE place=ANY($6::text[])),'[]'::jsonb),
      'states',COALESCE(${v}->'reach'->'states',${v}->'states','[]'::jsonb),'platforms',COALESCE(${v}->'reach'->'platforms',${v}->'platforms','[]'::jsonb),
      'everywhere',COALESCE(${v}->'reach'->'everywhere',${v}->'portable','false'::jsonb),'method',COALESCE(${v}->'reach'->'method','false'::jsonb)),
    'payload',CASE WHEN jsonb_typeof(${v}->'payload')='object' THEN COALESCE((SELECT jsonb_object_agg(key,value) FROM jsonb_each(${v}->'payload') WHERE key=ANY(ARRAY[${fields}]::text[])),'{}'::jsonb)||jsonb_build_object('outcomes',${jobHistory("outcomes")},'subBranches',${jobHistory("subBranches")}) ELSE ${v}->'payload' END) AS value
    FROM cp_field_manual_entries ${alias} CROSS JOIN LATERAL (SELECT ${history} AS scope) h`;
}
