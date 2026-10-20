const array=(value:string,path:string)=>`CASE WHEN jsonb_typeof(${value}#>'{${path}}')='array' THEN ${value}#>'{${path}}' ELSE '[]'::jsonb END`;
function unionText(values:readonly string[],lower=false):string{
  return `(SELECT COALESCE(jsonb_agg(word ORDER BY word COLLATE "C"),'[]'::jsonb) FROM
    (SELECT DISTINCT ${lower?"lower(btrim(value))":"value"} AS word FROM jsonb_array_elements_text(${values.join("||")}) words(value)
      ${lower?"WHERE btrim(value)<>''":""}) unique_words)`;
}
function unionJson(values:readonly string[]):string{
  return `(SELECT COALESCE(jsonb_agg(value ORDER BY (CASE WHEN jsonb_typeof(value)='object' THEN '[object Object]'
      WHEN value='null'::jsonb THEN 'null' ELSE value#>>'{}' END) COLLATE "C",position),'[]'::jsonb)
    FROM (SELECT value,position FROM jsonb_array_elements(${values.join("||")}) WITH ORDINALITY members(value,position)
      WHERE jsonb_typeof(value) IN('object','array')
      UNION ALL SELECT value,MIN(position) FROM jsonb_array_elements(${values.join("||")}) WITH ORDINALITY members(value,position)
      WHERE jsonb_typeof(value) NOT IN('object','array') GROUP BY value) unique_values)`;
}
function spreadJson(value:string):string{
  return `CASE jsonb_typeof(${value}) WHEN 'object' THEN ${value}
    WHEN 'array' THEN COALESCE((SELECT jsonb_object_agg((position-1)::text,member) FROM jsonb_array_elements(${value}) WITH ORDINALITY members(member,position)),'{}'::jsonb)
    WHEN 'string' THEN COALESCE((SELECT jsonb_object_agg((position-1)::text,to_jsonb(substring(${value}#>>'{}' from position for 1))) FROM generate_series(1,length(${value}#>>'{}')) positions(position)),'{}'::jsonb)
    ELSE '{}'::jsonb END`;
}
const specific=(value:string)=>`${array(value,"ocdIds")}||(SELECT COALESCE(jsonb_agg('body:'||body),'[]'::jsonb) FROM jsonb_array_elements_text(${array(value,"bodyIds")}) bodies(body))`;
const implicitPlaces=(value:string)=>`CASE WHEN jsonb_array_length(${specific(value)})>0 THEN ${unionText([specific(value)])}
  WHEN jsonb_array_length(${array(value,"states")})>0 THEN (SELECT jsonb_agg('state:'||state ORDER BY state COLLATE "C") FROM jsonb_array_elements_text(${array(value,"states")}) states(state))
  ELSE '["any"]'::jsonb END`;
const rank=(value:string)=>`CASE ${value}->>'outcome' WHEN 'YIELDED' THEN 0 WHEN 'REFERENCE' THEN 1 WHEN 'ZERO' THEN 2 WHEN 'BLOCKED' THEN 3 ELSE 4 END`;
function result(old:string,next:string):string{
  const before=`COALESCE(${old}->>'observedAt','')`,after=`COALESCE(${next}->>'observedAt','')`;
  return `CASE WHEN ${old} IS NULL THEN ${next}
    WHEN ${after} COLLATE "C">${before} COLLATE "C" THEN ${next}||jsonb_build_object('supersedes',${old}->'observedAt')
    WHEN ${after}=${before} AND ${next}->>'outcome'<>${old}->>'outcome'
      THEN (CASE WHEN (${rank(next)})>(${rank(old)}) THEN ${next} ELSE ${old} END)||jsonb_build_object('supersedes',COALESCE(${old}->'supersedes','null'::jsonb))
    ELSE ${old} END`;
}
const oldSpecific=specific("old"),oldPlatforms=array("old","platforms");
const oldReachStates=`CASE WHEN jsonb_array_length(${oldSpecific})>0 OR jsonb_array_length(${oldPlatforms})>0 THEN '[]'::jsonb ELSE ${array("old","states")} END`;
const oldReachPlatforms=`CASE WHEN jsonb_array_length(${oldSpecific})=0 OR old->'url'='null'::jsonb THEN ${oldPlatforms} ELSE '[]'::jsonb END`;
const reach=`jsonb_build_object(
  'places',${unionText([array("old","reach,places"),oldSpecific,array("entry","reach,places")])},
  'states',${unionText([array("old","reach,states"),oldReachStates,array("entry","reach,states")],true)},
  'platforms',${unionText([array("old","reach,platforms"),oldReachPlatforms,array("entry","reach,platforms")],true)},
  'everywhere',COALESCE(old#>'{reach,everywhere}'='true'::jsonb,false) OR COALESCE(old->'portable'='true'::jsonb,false) OR COALESCE(entry#>'{reach,everywhere}'='true'::jsonb,false))
  ||CASE WHEN old#>'{reach,method}'='true'::jsonb OR entry#>'{reach,method}'='true'::jsonb THEN '{"method":true}'::jsonb ELSE '{}'::jsonb END`;
const payload=`CASE WHEN old->>'kind'='METHOD' AND entry->>'kind'='METHOD' THEN
    (${spreadJson("winner->'payload'")})||jsonb_build_object(
      'places',${unionJson([array("old","payload,places"),array("entry","payload,places")])},
      'doorEntryIds',${unionJson([array("old","payload,doorEntryIds"),array("entry","payload,doorEntryIds")])})
  WHEN old->>'kind'='PARSE_FIELDS' AND entry->>'kind'='PARSE_FIELDS' THEN
    (${spreadJson("winner->'payload'")})||jsonb_build_object(
      'fieldNames',${unionJson([array("old","payload,fieldNames"),array("entry","payload,fieldNames")])})
  ELSE winner->'payload' END`;

/** The mergeEntry observation rules execute under the existing row's lock; only revision metadata returns. */
export const FIELD_MANUAL_MERGE_SQL=`WITH RECURSIVE incoming AS (SELECT $3::jsonb AS entry), prior AS MATERIALIZED (
  SELECT id,revision,value FROM cp_field_manual_entries WHERE id=$1 AND revision=$2::bigint FOR UPDATE
), bases AS MATERIALIZED (
  SELECT incoming.entry,prior.value AS old,prior.id IS NOT NULL AS existed,
    CASE WHEN COALESCE(incoming.entry->>'observedAt','') COLLATE "C">=COALESCE(prior.value->>'observedAt','') COLLATE "C" THEN incoming.entry ELSE prior.value END AS winner
  FROM incoming LEFT JOIN prior ON true
), sources(side,value) AS (SELECT 0,old FROM bases UNION ALL SELECT 1,entry FROM bases),
implicit_results(side,sequence,body) AS (
  SELECT side,member.position,jsonb_build_object('place',member.place,'outcome',value->'outcome','observedAt',value->'observedAt')
  FROM sources CROSS JOIN LATERAL jsonb_array_elements_text(${implicitPlaces("value")}) WITH ORDINALITY member(place,position)
), partial_events AS (
  SELECT side,body->>'place' AS place,row_number() OVER(PARTITION BY side,body->>'place' ORDER BY phase,sequence) AS n,body FROM (
    SELECT r.*,0 AS phase FROM implicit_results r JOIN sources USING(side) WHERE value->'placeResultsPartial'='true'::jsonb
    UNION ALL SELECT side,member.position,member.body,1 FROM sources CROSS JOIN LATERAL jsonb_array_elements(${array("value","placeResults")})
      WITH ORDINALITY member(body,position) WHERE value->'placeResultsPartial'='true'::jsonb
  ) events
), partial_fold(side,place,n,body) AS (
  SELECT side,place,n,body FROM partial_events WHERE n=1
  UNION ALL SELECT p.side,p.place,e.n,${result("p.body","e.body")} FROM partial_fold p JOIN partial_events e ON e.side=p.side AND e.place=p.place AND e.n=p.n+1
), effective(side,sequence,body) AS (
  SELECT r.side,r.sequence,r.body FROM implicit_results r JOIN sources USING(side)
    WHERE NOT COALESCE(value->'placeResultsPartial'='true'::jsonb,false) AND NOT value?'placeResults'
  UNION ALL SELECT side,member.position,member.body FROM sources CROSS JOIN LATERAL jsonb_array_elements(${array("value","placeResults")})
    WITH ORDINALITY member(body,position) WHERE NOT COALESCE(value->'placeResultsPartial'='true'::jsonb,false) AND value?'placeResults'
  UNION ALL SELECT side,row_number() OVER(PARTITION BY side ORDER BY place COLLATE "C"),body FROM partial_fold p
    WHERE NOT EXISTS(SELECT 1 FROM partial_events e WHERE e.side=p.side AND e.place=p.place AND e.n=p.n+1)
), prior_results AS (
  SELECT DISTINCT ON(body->>'place') body->>'place' AS place,body FROM effective WHERE side=0 ORDER BY body->>'place',sequence DESC
), next_results AS (
  SELECT body->>'place' AS place,row_number() OVER(PARTITION BY body->>'place' ORDER BY sequence) AS n,body FROM effective WHERE side=1
), places AS (SELECT place FROM prior_results UNION SELECT place FROM next_results), folded(place,n,body) AS (
  SELECT places.place,0::bigint,p.body FROM places LEFT JOIN prior_results p USING(place)
  UNION ALL SELECT p.place,e.n,${result("p.body","e.body")} FROM folded p JOIN next_results e ON e.place=p.place AND e.n=p.n+1
), result_values AS (
  SELECT COALESCE(jsonb_agg(body ORDER BY place COLLATE "C"),'[]'::jsonb) AS rows FROM folded p
    WHERE NOT EXISTS(SELECT 1 FROM next_results e WHERE e.place=p.place AND e.n=p.n+1)
), merged AS MATERIALIZED (
  SELECT CASE WHEN NOT existed THEN entry ELSE (winner-'foundBy')||jsonb_build_object(
    'states',${unionText([array("old","states"),array("entry","states")],true)},
    'recordClasses',CASE WHEN jsonb_array_length(${array("old","recordClasses")})=0 OR jsonb_array_length(${array("entry","recordClasses")})=0 THEN '[]'::jsonb
      ELSE ${unionText([array("old","recordClasses"),array("entry","recordClasses")],true)} END,
    'platforms',${unionText([oldPlatforms,array("entry","platforms")],true)},
    'reach',${reach},'observedAt',winner->'observedAt','placeResults',(SELECT rows FROM result_values),'payload',${payload})
    ||CASE WHEN jsonb_array_length(${unionText([array("old","ocdIds"),array("entry","ocdIds")],true)})>0 THEN jsonb_build_object('ocdIds',${unionText([array("old","ocdIds"),array("entry","ocdIds")],true)}) ELSE '{}'::jsonb END
    ||CASE WHEN jsonb_array_length(${unionText([array("old","bodyIds"),array("entry","bodyIds")])})>0 THEN jsonb_build_object('bodyIds',${unionText([array("old","bodyIds"),array("entry","bodyIds")])}) ELSE '{}'::jsonb END
    ||CASE WHEN old->'portable'='true'::jsonb OR entry->'portable'='true'::jsonb THEN '{"portable":true}'::jsonb ELSE '{}'::jsonb END
    ||CASE WHEN COALESCE(NULLIF(old->'foundBy','null'::jsonb),entry->'foundBy') IS NOT NULL THEN jsonb_build_object('foundBy',COALESCE(NULLIF(old->'foundBy','null'::jsonb),entry->'foundBy')) ELSE '{}'::jsonb END
  END AS value FROM bases
), inserted AS (
  INSERT INTO cp_field_manual_entries(id,revision,updated_at,value) SELECT $1,1,$4::timestamptz,value FROM merged WHERE $2::bigint IS NULL
  ON CONFLICT(id) DO NOTHING RETURNING revision,true AS changed
), updated AS (
  UPDATE cp_field_manual_entries target SET value=merged.value,revision=target.revision+1,updated_at=$4::timestamptz,changed_at=now()
    FROM merged WHERE target.id=$1 AND target.revision=$2::bigint AND target.value IS DISTINCT FROM merged.value RETURNING target.revision,true AS changed
) SELECT * FROM inserted UNION ALL SELECT * FROM updated UNION ALL
  SELECT prior.revision,false FROM prior,merged WHERE prior.value=merged.value`;
