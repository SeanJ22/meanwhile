import { ASSIGNMENT_ATTEMPT_PROJECTION, ASSIGNMENT_OBLIGATION_PROJECTION, ASSIGNMENT_LOG_FIELDS, clauseObligation } from "../assignment-read.ts";
import { assignmentHeadBatchFromSources, type AssignmentHead } from "../assignment-view.ts";
import type { WorkItem } from "../work-item.ts";
import type { ControlPlaneRepositories } from "./types.ts";
import type { Sql } from "./pg-store.ts";
import { boundedQuery } from "./request-bounds.ts";

export interface AssignmentHeadSeeds {
  readonly groups: readonly string[];
  readonly workItems: readonly string[];
}
export interface AssignmentHeadBatch {
  readonly heads: readonly AssignmentHead[];
  readonly members: ReadonlyMap<string, readonly string[]>;
  readonly workItems: readonly WorkItem[];
}
export interface OwnerAssignmentHeads {
  read(seeds: AssignmentHeadSeeds, now: string): Promise<AssignmentHeadBatch>;
}

/** Local fixture stores share the production reducer; only the native adapter can reach Postgres. */
export function storedOwnerAssignmentHeads(get: () => ControlPlaneRepositories): OwnerAssignmentHeads {
  return { async read(seeds, nowIso) {
    const repos = get(), old = await repos.ownerAssignmentRows.read(seeds.groups);
    const unique = (ids: readonly (string | null | undefined)[]) => [...new Set(ids.filter((id): id is string => Boolean(id)))];
    const many = async <T>(repo: import("./types.ts").AggregateRepository<T>, ids: readonly string[], fields?: import("./types.ts").RecordProjection) =>
      fields ? (await repo.readManyNarrowed!(unique(ids), fields)).map(row => row.value as T) : (await repo.readMany!(unique(ids))).map(row => row.value);
    const where = async <T>(repo: import("./types.ts").AggregateRepository<T>, key: string, ids: readonly string[]) =>
      (await Promise.all(unique(ids).map(id=>repo.listWhere([key],id)))).flatMap(rows=>rows.map(row=>row.value));
    const workIds = unique([...seeds.workItems, ...old.flatMap(row => row.group.members)]);
    const occurrenceRows = [...await where(repos.occurrences,"obligationId",seeds.groups),
      ...await where(repos.occurrences,"workItemId",workIds)];
    const occurrences = [...new Map(occurrenceRows.map(row => [row.id,row])).values()].sort((a,b)=>a.id.localeCompare(b.id));
    const owned = unique([...workIds,...occurrences.map(row=>row.workItemId)]), items = new Map<string,WorkItem>();
    for (let wanted=owned; wanted.length;) {
      for (const row of await many(repos.workItems,wanted)) items.set(row.id,row);
      const asked=new Set(wanted);
      wanted=unique([...items.values()].flatMap(row=>[row.directoryParent?.workItemId,(row as WorkItem & {planRepair?:{parentWorkItemId:string}}).planRepair?.parentWorkItemId])).filter(id=>!items.has(id)&&!asked.has(id));
    }
    const obligations = await many(repos.obligations,unique([...seeds.groups,...occurrences.map(row=>row.obligationId),...[...items.values()].map(row=>clauseObligation(row.obligation))]),ASSIGNMENT_OBLIGATION_PROJECTION);
    const taskRows = await where(repos.routeTasks,"workItemId",owned);
    const routeTasks=[...new Map([...taskRows,...await many(repos.routeTasks,occurrences.map(row=>row.routeTaskId))].map(row=>[row.id,row])).values()].sort((a,b)=>a.id.localeCompare(b.id));
    const attemptRows=await where(repos.attempts,"workItemId",owned);
    const attempts=[...new Map([...attemptRows,...await many(repos.attempts,routeTasks.flatMap(row=>[...row.attemptIds,...(row.disposition?[row.disposition.attemptId]:[])]),ASSIGNMENT_ATTEMPT_PROJECTION)].map(row=>[row.id,row])).values()].sort((a,b)=>a.id.localeCompare(b.id));
    const ownedSet=new Set(owned),attemptSet=new Set(attempts.map(row=>row.id));
    const scoutKeys=unique((await Promise.all([...owned.map(id=>repos.scoutResults.keysWhere(["workItemId"],id)),...attempts.map(row=>repos.scoutResults.keysWhere(["attemptId"],row.id))])).flat());
    const logs = async <T>(repo: import("./types.ts").AppendOnlyRepository<T>, keys: readonly string[], fields: import("./types.ts").RecordProjection) =>
      [...await repo.readKeys!(unique(keys),fields)].sort(([a],[b])=>a.localeCompare(b)).flatMap(([,rows])=>rows);
    const [debts,leases,artifacts,workerResults,scoutResults]=await Promise.all([
      many(repos.debts,obligations.map(row=>row.id)),many(repos.leases,attempts.filter(row=>row.outcome===null).map(row=>row.routeTaskId)),
      logs(repos.artifacts,owned,{workItemId:true,recordedAt:true}),logs(repos.workerResults,owned,ASSIGNMENT_LOG_FIELDS.workerResults),
      logs(repos.scoutResults,scoutKeys,ASSIGNMENT_LOG_FIELDS.scoutResults),
    ]);
    const workItems=[...items.values()].sort((a,b)=>a.id.localeCompare(b.id));
    const batch=assignmentHeadBatchFromSources({nowIso,obligations,occurrences,workItems,routeTasks,attempts,debts,leases,artifacts,costs:[],
      workerResults:workerResults.filter(row=>ownedSet.has(row.workItemId)),scoutResults:scoutResults.filter(row=>ownedSet.has(row.workItemId)||attemptSet.has(row.attemptId)),
      dispositions:null,pipeline:null,activation:null,servedReader:null,pilotZips:[],askGapObservations:null});
    return {...batch,workItems};
  } };
}

const pick = (value: string, fields: string): string => `jsonb_strip_nulls(jsonb_build_object(${fields.split(" ").flatMap(field => [`'${field}'`, `${value}->'${field}'`]).join(",")}))`;
const timestamp = (value: string): string => `CASE WHEN pg_input_is_valid(${value},'timestamptz') THEN (${value})::timestamptz END`;
const attempt = (v: string): string => `${pick(v,"id routeTaskId leaseId startedAt endedAt outcome abortReason")}||jsonb_build_object('role',${v}#>'{worker,role}')`;
const lease = (v: string): string => pick(v,"id released expiresAt");
const item = (v: string): string => `${pick(v,"id project subject obligation state createdAt")}||jsonb_build_object('lastTransitionAt',${v}#>'{transitions,-1,at}','manualSourceGap',${pick(`${v}->'manualSourceGap'`,"assignmentKey instructionReceipt")})`;
const publication = (v: string): string => pick(`${v}->'publicationOutcome'`,"status at code recovery");
const routing = (v: string): string => `${pick(v,"id project subject obligation directoryParent planRepair")}||jsonb_strip_nulls(jsonb_build_object(
  'dependencies',CASE WHEN jsonb_array_length(coalesce(${v}->'dependencies','[]'::jsonb))>0 THEN ${v}->'dependencies' END,
  'autonomousPlan',CASE WHEN ${v}#>'{autonomousPlan,publication}' IS NOT NULL OR ${v}#>'{autonomousPlan,contract,recordClass}' IS NOT NULL THEN
    jsonb_build_object('publication',${pick(`${v}#>'{autonomousPlan,publication}'`,"contractId bodyId")},'contract',jsonb_build_object('recordClass',${v}#>'{autonomousPlan,contract,recordClass}')) END,
  'publicationOutcome',CASE WHEN ${v}->'publicationOutcome' IS NOT NULL AND ${v}->'publicationOutcome'<>'null'::jsonb THEN ${pick(`${v}->'publicationOutcome'`,"status versionId workerResultId acceptedRecordIds")} END))`;

/** All reduction happens beside the rows. No artifact, occurrence, work-item, or result history leaves Postgres. */
export const OWNER_ASSIGNMENT_HEADS_SQL = `WITH RECURSIVE
requested AS MATERIALIZED (SELECT DISTINCT unnest($1::text[]) AS id),
seed_obligations AS MATERIALIZED (SELECT o.id FROM cp_obligations o JOIN requested r USING(id)),
seed_members AS MATERIALIZED (
  SELECT unnest($2::text[]) AS id
  UNION SELECT jsonb_array_elements_text(r.members) FROM cp_owner_assignment_rows r WHERE r.id=ANY($1::text[])
  UNION SELECT o.value#>>'{workItemId}' FROM cp_occurrences_history o JOIN seed_obligations s ON s.id=o.value#>>'{obligationId}'
  UNION SELECT r.id FROM requested r WHERE NOT EXISTS(SELECT 1 FROM seed_obligations o WHERE o.id=r.id)
),
ancestry(id) AS (
  SELECT id FROM seed_members WHERE id IS NOT NULL
  UNION
  SELECT parent.id FROM ancestry a
  JOIN LATERAL (SELECT value FROM cp_work_items_history WHERE id=a.id ORDER BY revision DESC LIMIT 1) w ON true
  CROSS JOIN LATERAL (VALUES(w.value#>>'{directoryParent,workItemId}'),(w.value#>>'{planRepair,parentWorkItemId}')) parent(id)
  WHERE parent.id IS NOT NULL
),
work AS MATERIALIZED (SELECT wanted.id,w.value FROM (SELECT DISTINCT id FROM ancestry) wanted
  CROSS JOIN LATERAL (SELECT value FROM cp_work_items_history WHERE id=wanted.id ORDER BY revision DESC LIMIT 1) w),
origin AS MATERIALIZED (
  SELECT a.id,w.value,
    own.value#>>'{obligationId}' AS occurrence,
    CASE WHEN parent.id IS NOT NULL AND parent.value->>'project'=w.value->>'project' AND parent.value->>'subject'=w.value->>'subject'
      AND parent.value#>'{publicationOutcome,bodyIds}' ? (w.value#>>'{directoryParent,bodyId}')
      AND w.value#>>'{autonomousPlan,publication,bodyId}'=w.value#>>'{directoryParent,bodyId}' THEN parent.id END AS directory,
    clause.id AS clause,
    CASE WHEN repair.id IS NOT NULL AND w.value#>>'{planRepair,authority}'='WORK_INSTRUCTIONS_ONLY'
      AND repair.value->>'subject'=w.value->>'subject' THEN repair.id END AS repair
  FROM ancestry a LEFT JOIN work w ON w.id=a.id
  LEFT JOIN LATERAL (SELECT value FROM cp_occurrences_history WHERE value#>>'{workItemId}'=a.id ORDER BY id DESC LIMIT 1) own ON true
  LEFT JOIN work parent ON parent.id=w.value#>>'{directoryParent,workItemId}'
  LEFT JOIN cp_obligations clause ON clause.id=substring(w.value->>'obligation' FROM '^(.*)#[0-9]+$')
  LEFT JOIN work repair ON repair.id=w.value#>>'{planRepair,parentWorkItemId}'
),
resolve(start,id,path,obligation) AS (
  SELECT s.id,s.id,ARRAY[s.id],NULL::text FROM seed_members s
  UNION ALL
  SELECT r.start,CASE WHEN o.occurrence IS NOT NULL THEN NULL WHEN o.directory IS NOT NULL THEN o.directory
      WHEN o.clause IS NOT NULL THEN NULL ELSE o.repair END,
    r.path||coalesce(o.directory,o.repair),
    CASE WHEN o.occurrence IS NOT NULL THEN o.occurrence WHEN o.directory IS NULL THEN o.clause END
  FROM resolve r JOIN origin o ON o.id=r.id
  WHERE r.obligation IS NULL AND r.id IS NOT NULL AND
    (o.occurrence IS NOT NULL OR (o.directory IS NULL AND o.clause IS NOT NULL) OR
      (coalesce(o.directory,o.repair) IS NOT NULL AND NOT coalesce(o.directory,o.repair)=ANY(r.path)))
),
resolved AS MATERIALIZED (SELECT s.id AS member,coalesce((SELECT obligation FROM resolve r WHERE r.start=s.id AND obligation IS NOT NULL LIMIT 1),s.id) AS id
  FROM seed_members s WHERE s.id IS NOT NULL AND (EXISTS(SELECT 1 FROM work w WHERE w.id=s.id)
    OR EXISTS(SELECT 1 FROM cp_occurrences_history o WHERE o.value#>>'{workItemId}'=s.id)
    OR EXISTS(SELECT 1 FROM cp_route_tasks_history t WHERE t.value#>>'{workItemId}'=s.id)
    OR EXISTS(SELECT 1 FROM cp_attempts a WHERE a.value#>>'{workItemId}'=s.id)
    OR EXISTS(SELECT 1 FROM cp_log_worker_results r WHERE r.log_key=s.id AND r.record#>>'{workItemId}'=s.id))),
groups AS MATERIALIZED (SELECT id FROM seed_obligations UNION SELECT id FROM resolved),
occurrences AS MATERIALIZED (SELECT DISTINCT ON(o.id) o.id,o.value FROM cp_occurrences_history o JOIN groups g ON g.id=o.value#>>'{obligationId}' ORDER BY o.id,o.revision DESC),
member_keys AS MATERIALIZED (SELECT id,member FROM resolved UNION SELECT value#>>'{obligationId}',value#>>'{workItemId}' FROM occurrences),
members AS MATERIALIZED (SELECT m.id,m.member,row_number() OVER(PARTITION BY m.id ORDER BY
    (SELECT min((o.value->>'sequence')::int) FROM occurrences o WHERE o.value#>>'{obligationId}'=m.id AND o.value#>>'{workItemId}'=m.member) NULLS LAST,m.member) AS ordinal
  FROM member_keys m),
items AS MATERIALIZED (SELECT m.id,m.member,m.ordinal,w.value FROM members m LEFT JOIN LATERAL
  (SELECT value FROM cp_work_items_history WHERE id=m.member ORDER BY revision DESC LIMIT 1) w ON true),
tasks AS MATERIALIZED (SELECT DISTINCT ON(m.id,t.id) m.id,t.id AS task,t.value,m.ordinal FROM members m
  CROSS JOIN LATERAL (SELECT id,value,revision FROM cp_route_tasks_history WHERE value#>>'{workItemId}'=m.member OFFSET 0) t ORDER BY m.id,t.id,t.revision DESC),
orphan_tasks AS MATERIALIZED (SELECT DISTINCT ON(m.id,a.value#>>'{routeTaskId}') m.id,m.ordinal,a.value,a.id AS attempt
  FROM members m CROSS JOIN LATERAL (SELECT id,value FROM cp_attempts WHERE value#>>'{workItemId}'=m.member OFFSET 0) a
  WHERE NOT EXISTS(SELECT 1 FROM tasks t WHERE t.id=m.id AND t.task=a.value#>>'{routeTaskId}')
    AND NOT EXISTS(SELECT 1 FROM occurrences o WHERE o.value#>>'{obligationId}'=m.id AND o.value#>>'{routeTaskId}'=a.value#>>'{routeTaskId}')
  ORDER BY m.id,a.value#>>'{routeTaskId}',m.ordinal,${timestamp("a.value->>'startedAt'")},coalesce(${timestamp("a.value->>'endedAt'")},${timestamp("a.value->>'startedAt'")}),a.id),
round_keys AS MATERIALIZED (
  SELECT o.value#>>'{obligationId}' AS id,o.value#>>'{routeTaskId}' AS task,ARRAY[0::bigint,(o.value->>'sequence')::bigint] AS ordering FROM occurrences o
  UNION ALL SELECT t.id,t.task,ARRAY[1::bigint,t.ordinal,row_number() OVER(PARTITION BY t.id,t.ordinal ORDER BY ${timestamp("t.value->>'createdAt'")},t.task)] FROM tasks t
    WHERE NOT EXISTS(SELECT 1 FROM occurrences o WHERE o.value#>>'{obligationId}'=t.id AND o.value#>>'{routeTaskId}'=t.task)
  UNION ALL SELECT a.id,a.value#>>'{routeTaskId}',ARRAY[1::bigint,a.ordinal,9223372036854775807::bigint,row_number() OVER(PARTITION BY a.id,a.ordinal
    ORDER BY ${timestamp("a.value->>'startedAt'")},coalesce(${timestamp("a.value->>'endedAt'")},${timestamp("a.value->>'startedAt'")}),a.attempt)] FROM orphan_tasks a
),
rounds AS MATERIALIZED (SELECT r.id,r.task,r.ordering,t.value FROM round_keys r LEFT JOIN LATERAL
  (SELECT value FROM cp_route_tasks_history WHERE id=r.task ORDER BY revision DESC LIMIT 1) t ON true),
attempts AS MATERIALIZED (SELECT r.id,r.task,r.ordering,a.id AS attempt,a.value,CASE WHEN pg_input_is_valid(a.value->>'endedAt','timestamptz') THEN a.value->>'endedAt' ELSE a.value->>'startedAt' END AS activity,${timestamp("a.value->>'startedAt'")} AS started_at,
    coalesce(${timestamp("a.value->>'endedAt'")},${timestamp("a.value->>'startedAt'")}) AS activity_at
  FROM rounds r CROSS JOIN LATERAL (SELECT id,value FROM cp_attempts WHERE value#>>'{routeTaskId}'=r.task OFFSET 0) a),
latest AS MATERIALIZED (SELECT DISTINCT ON(a.id) a.* FROM attempts a
  ORDER BY a.id,a.activity_at DESC NULLS LAST,a.ordering DESC,a.started_at DESC NULLS LAST,a.attempt DESC),
scouts AS MATERIALIZED (SELECT DISTINCT ON(s.record->>'attemptId') s.record->>'attemptId' AS attempt,s.record
  FROM cp_log_scout_results s WHERE s.record->>'attemptId' IN (SELECT attempt FROM latest UNION SELECT r.value#>>'{disposition,attemptId}' FROM rounds r JOIN latest l ON l.id=r.id AND l.task=r.task)
  ORDER BY s.record->>'attemptId',s.record->>'recordedAt' DESC,s.log_key DESC,s.position DESC),
workers AS MATERIALIZED (SELECT DISTINCT ON(s.record->>'attemptId') s.record->>'attemptId' AS attempt,s.record
  FROM cp_log_worker_results s WHERE s.log_key IN(SELECT member FROM members) AND s.record->>'attemptId' IN(SELECT attempt FROM latest)
  ORDER BY s.record->>'attemptId',s.log_key DESC,s.position DESC),
activity AS MATERIALIZED (
  SELECT a.id,coalesce(a.value->>'endedAt',a.value->>'startedAt') AS at,0 AS priority FROM attempts a
  UNION ALL SELECT o.value#>>'{obligationId}',coalesce(o.value->>'closedAt',o.value->>'openedAt'),4 FROM occurrences o
  UNION ALL SELECT m.id,s.record->>'recordedAt',2 FROM members m CROSS JOIN LATERAL (SELECT record FROM cp_log_artifacts WHERE log_key=m.member AND record#>>'{workItemId}'=m.member OFFSET 0) s
  UNION ALL SELECT m.id,s.record->>'endedAt',3 FROM members m CROSS JOIN LATERAL (SELECT record FROM cp_log_worker_results WHERE log_key=m.member AND record#>>'{workItemId}'=m.member OFFSET 0) s
  UNION ALL SELECT m.id,s.record->>'recordedAt',1 FROM members m JOIN cp_log_scout_results s ON s.record#>>'{workItemId}'=m.member
  UNION ALL SELECT a.id,s.record->>'recordedAt',1 FROM attempts a JOIN cp_log_scout_results s ON s.record->>'attemptId'=a.attempt
)
SELECT g.id,
  coalesce((SELECT jsonb_agg(m.member ORDER BY m.ordinal) FROM members m WHERE m.id=g.id),'[]'::jsonb) AS members,
  coalesce((SELECT jsonb_agg(${routing("i.value")} ORDER BY i.ordinal) FROM items i WHERE i.id=g.id AND i.value IS NOT NULL),'[]'::jsonb) AS items,
  jsonb_strip_nulls(jsonb_build_object(
    'obligation',CASE WHEN o.id IS NOT NULL THEN ${pick("o.value","recordClass subjectId routeId active readerImpactAt nextDueAt absentUntil absenceUnlock assignments retiredAt retirementReason")} END,
    'debt',CASE WHEN d.id IS NOT NULL THEN ${pick("d.value","cause consecutiveFailures firstFailedAt retryAt")} END,
    'item',CASE WHEN o.id IS NULL AND NOT EXISTS(SELECT 1 FROM occurrences c WHERE c.value#>>'{obligationId}'=g.id) THEN (SELECT ${item("i.value")} FROM items i WHERE i.id=g.id AND i.value IS NOT NULL ORDER BY i.ordinal LIMIT 1) END,
    'proof',CASE WHEN EXISTS(SELECT 1 FROM items i WHERE i.id=g.id AND (i.value->>'project' ~ '^conformance(-|$)' OR i.value->>'project' IN('control-plane-proof','autonomous-fleet-proof'))) THEN true END,
    'live',coalesce((SELECT jsonb_agg(jsonb_build_object('attempt',${attempt("a.value")},'lease',${lease("le.value")}) ORDER BY a.ordering,a.started_at,a.activity_at,a.attempt)
      FROM attempts a JOIN cp_leases le ON le.id=a.task WHERE a.id=g.id AND a.value->'outcome'='null'::jsonb
        AND le.value->>'id'=a.value->>'leaseId' AND NOT(le.value->>'released')::boolean AND ${timestamp("le.value->>'expiresAt'")}>$3::timestamptz),'[]'::jsonb),
    'latest',CASE WHEN l.attempt IS NOT NULL THEN jsonb_strip_nulls(jsonb_build_object('attempt',${attempt("l.value")},'leaseRead',true,
      'lease',CASE WHEN le.id IS NOT NULL THEN ${lease("le.value")} END,
      'disposition',CASE WHEN r.value->'disposition' IS NOT NULL AND r.value->'disposition'<>'null'::jsonb THEN
        ${pick("r.value->'disposition'","disposition at note")}||jsonb_build_object('artifactCount',jsonb_array_length(r.value#>'{disposition,artifactIds}')) END,
      'policyDenial',CASE WHEN r.value->>'state'='POLICY_DENIED' THEN r.value->'policyDenial' END,
      'scout',CASE WHEN s.attempt IS NOT NULL THEN ${pick("s.record","outcome recordedAt distinctEvidenceRungs refusal")}||jsonb_build_object(
        'candidateCount',jsonb_array_length(coalesce(s.record->'candidates','[]'::jsonb)),'findingCount',jsonb_array_length(coalesce(s.record->'findings','[]'::jsonb)),
        'rungs',jsonb_array_length(coalesce(s.record->'rungs','[]'::jsonb)),'nextRungs',jsonb_array_length(coalesce(s.record->'nextRungs','[]'::jsonb))) END,
      'worker',CASE WHEN w.attempt IS NOT NULL THEN jsonb_build_object('endedAt',w.record->'endedAt','result',
        ${pick("w.record->'result'","role verdict actualRowCount validatedRecordCount survivingRecordCount conclusion nextAction")}||jsonb_build_object(
          'blockers',CASE WHEN w.record#>'{result,blockers,0}' IS NOT NULL THEN jsonb_build_array(jsonb_build_object('description',w.record#>'{result,blockers,0,description}')) ELSE '[]'::jsonb END,
          'findings',CASE WHEN w.record#>'{result,findings,0}' IS NOT NULL THEN jsonb_build_array(jsonb_build_object('detail',w.record#>'{result,findings,0,detail}')) ELSE '[]'::jsonb END)) END)) END,
    'laneRole',(SELECT a.value#>'{worker,role}' FROM attempts a WHERE a.id=g.id ORDER BY a.started_at DESC NULLS LAST,a.activity_at DESC NULLS LAST,a.attempt DESC LIMIT 1),
    'pendingTaskId',(SELECT r.task FROM rounds r WHERE r.id=g.id AND r.value->>'state' IN('PENDING','RECLAIMABLE') AND NOT EXISTS(SELECT 1 FROM attempts a WHERE a.id=r.id AND a.task=r.task) ORDER BY r.ordering LIMIT 1),
    'publication',(SELECT ${publication("i.value")} FROM items i WHERE i.id=g.id AND i.value->'publicationOutcome' IS NOT NULL AND i.value->'publicationOutcome'<>'null'::jsonb ORDER BY i.value#>>'{publicationOutcome,at}' DESC,i.ordinal LIMIT 1),
    'occurrenceCount',(SELECT nullif(count(*),0) FROM occurrences c WHERE c.value#>>'{obligationId}'=g.id),
    'openRound',(SELECT jsonb_build_object('id',c.id,'sequence',c.value->'sequence','openedAt',c.value->'openedAt','dueAt',c.value->'dueAt',
      'reached',EXISTS(SELECT 1 FROM attempts a WHERE a.id=g.id AND a.task=c.value#>>'{routeTaskId}')) FROM occurrences c WHERE c.id=o.value->>'openOccurrenceId' AND c.value->'closedAt'='null'::jsonb LIMIT 1),
    'lastActivityAt',(SELECT at FROM activity WHERE id=g.id AND pg_input_is_valid(at,'timestamptz') ORDER BY at::timestamptz DESC,priority LIMIT 1)
  )) AS head
FROM groups g LEFT JOIN cp_obligations o ON o.id=g.id LEFT JOIN cp_debts d ON d.id=g.id
LEFT JOIN latest l ON l.id=g.id LEFT JOIN rounds r ON r.id=l.id AND r.task=l.task AND r.ordering=l.ordering
LEFT JOIN cp_leases le ON le.id=l.task LEFT JOIN scouts s ON s.attempt=coalesce(r.value#>>'{disposition,attemptId}',l.attempt)
LEFT JOIN workers w ON w.attempt=l.attempt ORDER BY g.id`;

export function pgOwnerAssignmentHeads(sql: Sql): OwnerAssignmentHeads {
  return { async read(seeds, now) {
    if (!(seeds.groups.length + seeds.workItems.length)) return { heads: [], members: new Map(), workItems: [] };
    const rows = await boundedQuery(sql,{operation:"cp_owner_assignment_rows.heads",callClass:"PAGE"},OWNER_ASSIGNMENT_HEADS_SQL, [seeds.groups,seeds.workItems,now]) as {
      id: string; members: string[]; items: WorkItem[]; head: Partial<AssignmentHead>;
    }[];
    const hydrateAttempt = (value: AssignmentHead["live"][number]["attempt"]) => Object.assign({endedAt:null,outcome:null,abortReason:null},value);
    const heads = rows.map(({id,head}) => {
      const latest = head.latest ? Object.assign({lease:null,disposition:null,policyDenial:null,scout:null,worker:null},head.latest,{
        attempt:hydrateAttempt(head.latest.attempt),scout:head.latest.scout?Object.assign({refusal:null},head.latest.scout):null}) : null;
      return Object.assign({id,kind:head.obligation||head.occurrenceCount?"STANDING_OBLIGATION":"WORK_ITEM",obligation:null,debt:null,item:null,proof:false,laneRole:null,pendingTaskId:null,publication:null,
        occurrenceCount:0,openRound:null,lastActivityAt:null},head,{latest,
        obligation:head.obligation?Object.assign({id,routeId:null,readerImpactAt:null,nextDueAt:null,absentUntil:null,absenceUnlock:null,assignments:[],retiredAt:null,retirementReason:null},head.obligation):null,
        debt:head.debt?Object.assign({detail:""},head.debt):null,
        live:(head.live??[]).map(row=>({...row,attempt:hydrateAttempt(row.attempt)}))}) as AssignmentHead;
    });
    return { heads,
      members: new Map(rows.map(row => [row.id,row.members])), workItems: [...new Map(rows.flatMap(row => row.items).map(item => [item.id,item])).values()] };
  } };
}
