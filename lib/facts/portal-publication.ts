import type { DoorRecord } from "../doors/registry.ts";
import { meetingPartitionOfId } from "../civic-data/meeting-partitions.ts";
import { enqueueReaderPlaces, invalidateReaderCache, readerCacheScopeForEntity, type ReaderCachePurger, type ReaderCacheScope } from "../reader/cache.ts";
import {openBlank,type FactDb,type Query} from "./publish.ts";
import {resolveId} from "../core/resolve.ts";
import { ensureEntity } from "./entities.ts";
import { planPlacements, readPlacementRows, type PlacementDecision, type PlacementQuestion } from "../identity/placement.ts";
import { sendToDetective } from "./identity-blank.ts";
import { claimPlacementBlanks, closePlacementQuestion, hangBodies, mergeBodies, placeOnPlaces } from "../core/door.ts";
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
  const held = await db.transaction(query => claimPlacementBlanks(query, n));
  return held.map(row => ({ kind: String(row.field) === "placement:owner" ? "OWNER" as const : "BODY" as const, subject: String(row.entity_id),
    candidates: (JSON.parse(String(row.detail)) as { candidates: string[] }).candidates }));
}

/**
 * The agent's answer is applied and its quoted page is kept with the body, so a placement can be traced to the page that showed it.
 * A tie goes to a detective. A merged body keeps its page until the body that took it over is rebuilt.
 */
export async function settlePlacement(db: FactDb, decision: PlacementDecision, question: PlacementQuestion, purge?: ReaderCachePurger): Promise<void> {
  const scope = await db.transaction(async query => {
    if (decision.action === "TIE") {
      await closePlacementQuestion(query, question.subject, questionField(question), null);
      await sendToDetective(query, { entityId: question.subject, field: "identity:placement", reason: "IDENTITY_TIE", candidates: question.candidates, about: { why: decision.why } });
      return null;
    }
    if (decision.action === "MOVE") await hangBodies(query, [{ body: decision.subject, government: decision.target! }]);
    if (decision.action === "MERGE") await mergeBodies(query, [{ loser: decision.subject, survivor: decision.target!, basis: "AGENT", retire: false }]);
    await closePlacementQuestion(query, question.subject, questionField(question), { holder: decision.action === "MERGE" ? decision.target! : decision.subject,
      cite: JSON.stringify({ subject: decision.subject, action: decision.action, target: decision.target ?? null, url: decision.url, quote: decision.quote }) });
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
