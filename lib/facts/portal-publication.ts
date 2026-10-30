import type { DoorRecord } from "../doors/registry.ts";
import { meetingPartitionOfId } from "../civic-data/meeting-partitions.ts";
import { enqueueReaderPlaces, invalidateReaderCache, readerCacheScopeForEntity, type ReaderCachePurger, type ReaderCacheScope } from "../reader/cache.ts";
import {openBlank,type FactDb,type Query} from "./publish.ts";
import {resolveId} from "../core/resolve.ts";
import { ensureEntity } from "./entities.ts";
import { planPlacements, readPlacementRows, type PlacementDecision, type PlacementQuestion } from "../identity/placement.ts";
import { sendToDetective } from "./identity-blank.ts";
import { foldPlacePages } from "../reader/place-builder.ts";
import { createHash } from "node:crypto";

async function portalScope(query:Query,door:DoorRecord,bodies:readonly string[]):Promise<ReaderCacheScope> {
  const scopes=await Promise.all(bodies.map(id=>readerCacheScopeForEntity(query,id)));
  return {entities:bodies,states:[...new Set(scopes.flatMap(scope=>scope.states ?? []))],
    places:[...new Set([door.ocdId,...(Array.isArray(door.config.alsoServesOcdIds)?door.config.alsoServesOcdIds:[])]
      .filter((id):id is string=>typeof id==='string' && id.startsWith('ocd-division/')))]};
}

/** Pause an unconfirmed source for a later check; its verified reader data stays held. */
export async function withdrawPlatformPublication(db: FactDb, door: DoorRecord, portal: string, purge?: ReaderCachePurger): Promise<void> {
  const changed = await db.transaction(async query => {
    const scopes=new Set<string>();
    const created:string[]=[];
    for(const body of door.bodyIds) {
      const canonical=await resolveId(body,query);
      if(canonical) scopes.add(canonical);
      else {
        const id=await ensureEntity(query,{id:body,kind:'body',name:typeof door.config.bodyName==='string'?door.config.bodyName:body,
          state:/\/(?:state|district|territory):([a-z]{2})/.exec(door.ocdId ?? '')?.[1]?.toUpperCase() ?? null,
          parentId:door.ocdId,government:typeof door.config.governmentId==='string'?door.config.governmentId:null});
        created.push(id);
        scopes.add(id);
      }
    }
    const bodies=[...scopes];
    const partition = meetingPartitionOfId(door.doorId);
    if (partition) for (const body of bodies) for (const scope of [partition.scope,`${partition.scope}:history`])
      await openBlank(query,{entityId:body,field:`calendar:${scope}`,stage:'CHECK',reason:'PORTAL_AUTHORITY_UNCONFIRMED',detail:portal,retryMinutes:10,countAttempt:true});
    if(!created.length)return null;
    const scope=await portalScope(query,door,created);
    await enqueueReaderPlaces({entities:scope.entities},query);
    return scope;
  });
  if(changed)await invalidateReaderCache(changed,purge,null);
}

const PROVENANCE_RANK = `CASE f.provenance_kind WHEN 'OWNER' THEN 0 WHEN 'OFFICIAL' THEN 1 WHEN 'FILING' THEN 1 WHEN 'REFERENCE' THEN 2 WHEN 'NEWS' THEN 3 WHEN 'CAMPAIGN' THEN 4 ELSE 5 END`;
/** Of the live facts keyed to one group the Slide's rule keeps one: the more official source, then the newer copy, then the one already on the survivor. */
const KEEP_ONE_LIVE = (keyed: string) => `WITH keyed AS (${keyed}), live AS (
  SELECT f.id, row_number() OVER (PARTITION BY k.grp ORDER BY ${PROVENANCE_RANK}, coalesce(s.fetched_at,f.checked_at) DESC, k.own DESC, f.id DESC) AS place
  FROM fact f JOIN keyed k ON k.id=f.id LEFT JOIN source_copy s ON s.id=f.source_copy_id WHERE f.status='live'
) UPDATE fact SET status='superseded' WHERE id IN (SELECT id FROM live WHERE place>1)`;
const PAIRS = "unnest($1::text[],$2::text[]) AS m(loser,survivor)";
const SEAT_FIELDS = "(VALUES ('office'),('term_start'),('term_end')) AS k(prefix)";

/**
 * Bodies that are one body become the survivor, and every id they were known by stays an alias. Facts and history, the people who
 * sat on them (their seat, term and roster keys are named for the body), places, sites, keys, meetings and open blanks all move.
 */
async function mergeBodies(query: Query, moves: readonly { readonly loser: string; readonly survivor: string; readonly basis: string; readonly retire: boolean; readonly name?: string }[]): Promise<void> {
  if (!moves.length) return;
  const pair = [moves.map(move => move.loser), moves.map(move => move.survivor)];
  const people = await query(`SELECT DISTINCT substr(f.field,8) AS person, m.loser, m.survivor FROM ${PAIRS} JOIN fact f ON f.entity_id=m.loser AND f.field LIKE 'member:%'
    UNION SELECT x.entity_id, m.loser, m.survivor FROM ${PAIRS} JOIN entity_external_id x ON x.scheme='roster-name:'||m.loser`, pair);
  // A calendar label is never the name of the body it was a sitting of; two records of one board keep the better name.
  const labels = moves.filter(move => move.basis !== "TWIN");
  await query(`UPDATE fact SET status='superseded' FROM unnest($1::text[]) AS m(loser) WHERE fact.entity_id=m.loser AND fact.field='name' AND fact.status='live'`, [labels.map(move => move.loser)]);
  await query(KEEP_ONE_LIVE(`SELECT f.id, concat_ws(chr(1),m.survivor,f.field) AS grp, f.entity_id=m.survivor AS own FROM ${PAIRS} JOIN fact f ON f.entity_id IN (m.loser,m.survivor)`), pair);
  await query(`UPDATE fact SET entity_id=m.survivor FROM ${PAIRS} WHERE fact.entity_id=m.loser`, pair);
  if (people.length) {
    const seats = [people.map(row => String(row.person)), people.map(row => String(row.loser)), people.map(row => String(row.survivor))];
    const seat = "unnest($1::text[],$2::text[],$3::text[]) AS t(person,loser,survivor)";
    await query(KEEP_ONE_LIVE(`SELECT f.id, concat_ws(chr(1),t.person,k.prefix||':'||t.survivor) AS grp, false AS own FROM ${seat} CROSS JOIN ${SEAT_FIELDS}
      JOIN fact f ON f.entity_id=t.person AND f.field IN (k.prefix||':'||t.loser,k.prefix||':'||t.survivor)`), seats);
    await query(`UPDATE fact SET field=k.prefix||':'||t.survivor FROM ${seat}, ${SEAT_FIELDS} WHERE fact.entity_id=t.person AND fact.field=k.prefix||':'||t.loser`, seats);
  }
  await query(`DELETE FROM entity_external_id x USING ${PAIRS} WHERE x.scheme='roster-name:'||m.loser
    AND EXISTS (SELECT 1 FROM entity_external_id y WHERE y.scheme='roster-name:'||m.survivor AND y.value=x.value)`, pair);
  await query(`UPDATE entity_external_id x SET scheme='roster-name:'||m.survivor FROM ${PAIRS} WHERE x.scheme='roster-name:'||m.loser`, pair);
  await query(`INSERT INTO entity_host(entity_id,host,proved_by) SELECT m.survivor,h.host,h.proved_by FROM entity_host h JOIN ${PAIRS} ON m.loser=h.entity_id ON CONFLICT DO NOTHING`, pair);
  await query(`UPDATE entity_external_id SET entity_id=m.survivor FROM ${PAIRS} WHERE entity_id=m.loser`, pair);
  await query(`UPDATE entity SET parent_id=m.survivor FROM ${PAIRS} WHERE parent_id=m.loser`, pair);
  await query(`UPDATE blank SET entity_id=pick.survivor FROM (
    SELECT DISTINCT ON (m.survivor,b.field) m.loser,m.survivor,b.field FROM ${PAIRS} JOIN blank b ON b.entity_id=m.loser
    WHERE NOT EXISTS (SELECT 1 FROM blank held WHERE held.entity_id=m.survivor AND held.field=b.field) ORDER BY m.survivor,b.field,b.opened_at
  ) pick WHERE blank.entity_id=pick.loser AND blank.field=pick.field`, pair);
  await query("DELETE FROM blank WHERE entity_id=ANY($1::text[])", [pair[0]]);
  await query(`INSERT INTO entity_external_id(entity_id,scheme,value) SELECT m.survivor,'body-alias',m.loser FROM ${PAIRS}
    ON CONFLICT(scheme,value) DO UPDATE SET entity_id=EXCLUDED.entity_id`, pair);
  await query(`INSERT INTO entity_place(entity_id,place_id,boundary_year,placement_basis)
    SELECT m.survivor,p.place_id,p.boundary_year,p.placement_basis FROM entity_place p JOIN ${PAIRS} ON m.loser=p.entity_id ON CONFLICT DO NOTHING`, pair);
  await query("UPDATE entity SET parent_id=NULL WHERE id=ANY($1::text[])", [moves.filter(move => !move.retire).map(move => move.loser)]);
  const named = moves.filter(move => move.name);
  await query("UPDATE entity e SET name=m.name FROM unnest($1::text[],$2::text[]) AS m(id,name) WHERE e.id=m.id", [named.map(move => move.survivor), named.map(move => move.name)]);
  const retired = moves.filter(move => move.retire);
  if (!retired.length) return;
  const dead = retired.map(move => move.loser);
  await foldPlacePages(query, dead, retired.map(move => move.survivor));
  await query("DELETE FROM entity_place WHERE entity_id=ANY($1::text[])", [dead]);
  await query("DELETE FROM entity_host WHERE entity_id=ANY($1::text[])", [dead]);
  await query("DELETE FROM entity WHERE id=ANY($1::text[])", [dead]);
}

/** A body hangs on the government that runs it and sits wherever that government does. */
async function hangBodies(query: Query, moves: readonly { readonly body: string; readonly government: string }[]): Promise<void> {
  if (!moves.length) return;
  const pair = [moves.map(move => move.body), moves.map(move => move.government)];
  await query("UPDATE entity b SET parent_id=m.government FROM unnest($1::text[],$2::text[]) AS m(body,government) WHERE b.id=m.body", pair);
  await query(`INSERT INTO entity_place(entity_id,place_id,boundary_year,placement_basis)
    SELECT m.body,p.place_id,p.boundary_year,p.placement_basis FROM unnest($1::text[],$2::text[]) AS m(body,government)
    JOIN entity_place p ON p.entity_id=m.government ON CONFLICT DO NOTHING`, pair);
}

/** A person placed on a government's id is placed on the place the government governs, which is where readers look. */
async function placeOnPlaces(query: Query, state: string): Promise<readonly string[]> {
  const added = await query(`INSERT INTO entity_place(entity_id,place_id,boundary_year,placement_basis)
    SELECT p.entity_id,g.parent_id,p.boundary_year,p.placement_basis FROM entity g JOIN entity_place p ON p.place_id=g.id
    JOIN entity place ON place.id=g.parent_id AND place.kind='place' WHERE g.kind='government' AND g.state=$1 ON CONFLICT DO NOTHING RETURNING entity_id`, [state]);
  await query(`DELETE FROM entity_place p USING entity g WHERE g.id=p.place_id AND g.kind='government' AND g.state=$1 AND EXISTS (
    SELECT 1 FROM entity_place q WHERE q.entity_id=p.entity_id AND q.place_id=g.parent_id AND q.boundary_year=p.boundary_year)`, [state]);
  return added.map(row => String(row.entity_id));
}

const questionField = (question: PlacementQuestion): string => `placement:${question.kind.toLowerCase()}`;

/**
 * Put every body under the government that runs it, from what is held. A body stays put when the evidence does not prove its home:
 * it becomes a question for the placement agent. Returns what changed.
 */
export async function placeBodies(db: FactDb, state: string, purge?: ReaderCachePurger): Promise<{ readonly merged: number; readonly hung: number; readonly asked: number }> {
  if (!/^[A-Z]{2}$/.test(state)) throw new Error("Invalid body state");
  const done = await db.transaction(async query => {
    const { bodies, governments } = await readPlacementRows(query, state);
    const plan = planPlacements(bodies, governments);
    const gone = new Set(plan.merges.map(move => move.loser)), hung = plan.parents.filter(move => !gone.has(move.body));
    const folded = plan.merges.filter(move => move.retire || move.basis === "SITTING");
    await mergeBodies(query, plan.merges);
    await hangBodies(query, hung);
    const placed = await placeOnPlaces(query, state);
    const decided = await query(`SELECT entity_id FROM entity_external_id WHERE scheme='placement-source' AND entity_id=ANY($1::text[])
      UNION SELECT entity_id FROM blank WHERE field='identity:placement' AND entity_id=ANY($1::text[])`, [plan.questions.map(question => question.subject)]);
    const held = new Set(decided.map(row => String(row.entity_id)));
    const questions = plan.questions.filter(question => !gone.has(question.subject) && !held.has(question.subject));
    for (const question of questions) await openBlank(query, { entityId: question.subject, field: questionField(question), stage: "DECIDE", reason: "PLACEMENT_QUESTION",
      detail: JSON.stringify({ candidates: question.candidates }), retryMinutes: 10 });
    const entities = [...new Set([...folded.map(move => move.survivor), ...hung.flatMap(move => [move.body, move.government]), ...placed])];
    if (!entities.length) return { merged: 0, hung: 0, asked: questions.length, scope: null };
    for (let at = 0; at < entities.length; at += 200) await enqueueReaderPlaces({ entities: entities.slice(at, at + 200), inOrder: true }, query);
    const pages = await query(`SELECT page_id AS id FROM place_page_dependency WHERE entity_id=ANY($1::text[]) UNION SELECT place_id FROM place_page WHERE place_id=ANY($1::text[])`,
      [[...entities, ...gone]]);
    return { merged: folded.length, hung: hung.length, asked: questions.length, scope: { states: [state], entities: [...entities, ...gone], places: pages.map(row => String(row.id)) } };
  });
  // A state's repair can touch thousands of pages; their cached answers are purged a few hundred tags at a time.
  if (done.scope) for (let at = 0; at === 0 || at < done.scope.places.length; at += 400) await invalidateReaderCache({ ...done.scope, places: done.scope.places.slice(at, at + 400) }, purge, null);
  return { merged: done.merged, hung: done.hung, asked: done.asked };
}

/** The questions that are due, each held for the agent for half an hour. */
export async function claimPlacementQuestions(db: FactDb, n: number): Promise<readonly PlacementQuestion[]> {
  const held = await db.transaction(query => query(`UPDATE blank SET next_try_at=now()+interval '30 minutes',attempts=attempts+1 WHERE (entity_id,field) IN (
      SELECT entity_id,field FROM blank WHERE reason='PLACEMENT_QUESTION' AND next_try_at<=now() ORDER BY next_try_at LIMIT $1 FOR UPDATE SKIP LOCKED)
    RETURNING entity_id,field,detail`, [n]));
  return held.map(row => ({ kind: String(row.field) === "placement:owner" ? "OWNER" as const : "BODY" as const, subject: String(row.entity_id),
    candidates: (JSON.parse(String(row.detail)) as { candidates: string[] }).candidates }));
}

/**
 * The agent's answer is applied and its quoted page is kept with the body, so a placement can be traced to the page that showed it.
 * A tie goes to a detective. A merged body keeps its page until the body that took it over is rebuilt.
 */
export async function settlePlacement(db: FactDb, decision: PlacementDecision, question: PlacementQuestion, purge?: ReaderCachePurger): Promise<void> {
  const scope = await db.transaction(async query => {
    await query("DELETE FROM blank WHERE entity_id=$1 AND field=$2 AND reason='PLACEMENT_QUESTION'", [question.subject, questionField(question)]);
    if (decision.action === "TIE") {
      await sendToDetective(query, { entityId: question.subject, field: "identity:placement", reason: "IDENTITY_TIE", candidates: question.candidates, about: { why: decision.why } });
      return null;
    }
    if (decision.action === "MOVE") await hangBodies(query, [{ body: decision.subject, government: decision.target! }]);
    if (decision.action === "MERGE") await mergeBodies(query, [{ loser: decision.subject, survivor: decision.target!, basis: "AGENT", retire: false }]);
    await query("INSERT INTO entity_external_id(entity_id,scheme,value) VALUES($1,'placement-source',$2) ON CONFLICT DO NOTHING",
      [decision.action === "MERGE" ? decision.target : decision.subject, JSON.stringify({ subject: decision.subject, action: decision.action, target: decision.target ?? null, url: decision.url, quote: decision.quote })]);
    const entities = [decision.subject, ...decision.target ? [decision.target] : []];
    await enqueueReaderPlaces({ entities, inOrder: true }, query);
    return { entities };
  });
  if (scope) await invalidateReaderCache(scope, purge, null);
}

/** The standing placement pass applies a rule change once, and again when a state's bodies or governments were added or removed, or a folded body can go because the body that took it over was rebuilt; an unchanged turn reads one row and one count. */
export async function ensurePlacement(db: FactDb & { readonly query: Query }, state: string, purge?: ReaderCachePurger): Promise<boolean> {
  const source = `placement:${state}`;
  const fingerprint = async () => {
    const [count] = await db.query(`SELECT (SELECT count(*) FROM entity WHERE state=$1 AND kind IN ('body','government'))::text AS held,
      (SELECT count(*) FROM entity b JOIN entity_external_id a ON a.scheme='body-alias' AND a.value=b.id AND a.entity_id<>b.id WHERE b.state=$1 AND b.kind='body'
        AND NOT EXISTS (SELECT 1 FROM rebuild_queue q WHERE q.place_id=a.entity_id AND (q.built_generation IS NULL OR q.generation>q.built_generation)))::text AS retirable`, [state]);
    return createHash("sha256").update(planPlacements.toString()).update(placeBodies.toString()).update(mergeBodies.toString()).update(`${count?.held}:${count?.retirable}`).digest("hex");
  };
  const [held] = await db.query("SELECT sha256 FROM fact_store_load WHERE source=$1", [source]);
  if (held?.sha256 === await fingerprint()) return false;
  const report = await placeBodies(db, state, purge);
  await db.query(`INSERT INTO fact_store_load(source,sha256) VALUES($1,$2) ON CONFLICT(source) DO UPDATE SET sha256=EXCLUDED.sha256,loaded_at=now()`, [source, await fingerprint()]);
  return report.merged + report.hung + report.asked > 0;
}

/** A newly observed government link closes the retry; the next Door read confirms or replaces facts. */
export async function confirmPlatformPublication(db:FactDb,door:DoorRecord,_purge?:ReaderCachePurger):Promise<void> {
  const partition=meetingPartitionOfId(door.doorId);
  if(!partition) return;
  await db.transaction(async query=>{
    const bodies=await Promise.all(door.bodyIds.map(async id=>await resolveId(id,query) ?? id));
    await query("DELETE FROM blank WHERE entity_id=ANY($1::text[]) AND field=ANY($2::text[]) AND reason='PORTAL_AUTHORITY_UNCONFIRMED'",
      [bodies,[`calendar:${partition.scope}`,`calendar:${partition.scope}:history`]]);
  });
}
