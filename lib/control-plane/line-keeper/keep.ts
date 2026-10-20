import { feedDoorDrafts } from "../../doors/seed-feeds.ts";
import type { Sql } from "../repository/pg-store.ts";
import { fixItems, withFixAdded, withFixCompleted } from "../fix-list.ts";
import { ADMIN_CONFIG_ID, defaultAdminConfig, type AdminConfig } from "../gateway/admin-config.ts";
import { projectBrief, easternBriefClock } from "../admin-view/brief.ts";
import { withQueryCaller,processNeonBytes } from "../../db/transfer-by-caller.ts";
import { foldClocks, query, readHour, sourceReading, SOURCE_SEED_SQL, SITTINGS_SEED_SQL } from "./read.ts";
import { closedHour, emptyState, READER_FAMILIES, LINE_KEEPER_BY, LINE_KEEPER_ID, type LineHour, type LineState, type Problem } from "./model.ts";
import { readGateHealth } from "../admin-view/gate-health.ts";
import { routineReaderReadbackEvidenceIssue, type RunnerHeartbeat, livenessOf, type RoutineCivicDataSupervisorOutcome } from "../owner-surface.ts";
import type { ReadinessWitness } from "../../coverage/readiness-counts.ts";
import { readinessCounts } from "../../coverage/readiness-counts.ts";
import { CHECKLIST_PROFILE } from "../readiness/checklist-score.ts";
import { fixSubjectId } from "../fix-queue.ts";
import { foldWaiting, waitingAt, WAITING_SEED_SQL,completeLinks,handoffProblems } from "./links.ts";
import { foldPosting, readPostingWindow } from "./posting.ts";
import { checkMeetingPages, pageLinks, readMeetingTargets, type PageProof } from "./public.ts";
import { publishCountryScores } from "./country.ts";
import { readInventory, foldInventory, inventoryProblems } from "./inventory.ts";
import { readDestinationDelta } from "./destinations.ts";
import { readRecordTargets } from './records.ts';
import { keeperState } from './state.ts';
import { readTransferCounters,transferSince } from './transfer.ts';

export async function readLineState(sql: Sql): Promise<{ revision: number; value: LineState } | null> {
  const [row] = await query(sql, "checkpoint", "SELECT revision,value FROM cp_owner_snapshots WHERE id=$1", [LINE_KEEPER_ID]);
  if (!row) return null;
  const value = row.value as LineState;
  if (value.version !== 1 || !Array.isArray(value.hours)) throw Error("Line keeper state is unreadable");
  return { revision: Number(row.revision), value };
}
async function saveState(sql: Sql, state: LineState, revision: number | null): Promise<void> {
  const rows = revision === null
    ? await query(sql, "first-checkpoint", `INSERT INTO cp_owner_snapshots(id,revision,updated_at,value) VALUES ($1,1,$2::timestamptz,$3::jsonb)
        ON CONFLICT (id) DO NOTHING RETURNING revision`, [LINE_KEEPER_ID,state.checkedAt,JSON.stringify(state)])
    : await query(sql, "save-checkpoint", `UPDATE cp_owner_snapshots SET revision=revision+1,updated_at=$2::timestamptz,value=$3::jsonb
        WHERE id=$1 AND revision=$4 RETURNING revision`, [LINE_KEEPER_ID,state.checkedAt,JSON.stringify(state),revision]);
  if (rows.length !== 1) throw Error("Another line keeper run saved first");
}
/** Called by the independent production deploy event, never by the hourly run. */
export async function initializeLineKeeper(control: Sql, reader: Sql, at: string, options:{readonly readOnly?:boolean}={}): Promise<LineState> {
  const held = await readLineState(control);
  const [doors, calendars, waiting, posting, targets, inventory,recordTargets,destinations,transferSample] = await Promise.all([
    query(control, "initialize-source-clocks", SOURCE_SEED_SQL), query(reader, "initialize-calendar-clocks", SITTINGS_SEED_SQL),
    query(control,"initialize-waiting-clocks",WAITING_SEED_SQL),
    readPostingWindow(reader,new Date(Date.parse(at)-7*86_400_000).toISOString(),at),
    readMeetingTargets(reader,new Date(Date.parse(at)-7*86_400_000).toISOString(),at),
    readInventory(control,at,at,true),
    readRecordTargets(reader,new Date(Date.parse(at)-7*86_400_000).toISOString(),at,true),
    readDestinationDelta(reader,at,at,true),
    readTransferCounters(reader,at,true),
  ]);
  const state = {...held?.value??emptyState(at),transferSample};
  const retainedPosting=foldPosting(state.posting??[],posting,[],at),pendingVersions=new Set(retainedPosting.map(p=>p.versionId));
  const retainedTargets=[...new Map([...(state.targets??[]).filter(t=>pendingVersions.has(t.version)),...targets].map(t=>[t.recordKey,t])).values()];
  const next = { ...state, ...foldClocks({ ...state, doors: {}, sittings: {} }, doors.map(row=>({...row,value:{...row.value as object,firstSeenAt:state.doors[String(row.id)]?.firstSeenAt??(row.value as {updatedAt:string}).updatedAt}})), calendars),destinations:destinations??{},recordTargets,inventory:foldInventory(undefined,inventory),waitingIndex:foldWaiting({},waiting),posting:retainedPosting,targets:retainedTargets,seededAt: at };
  if(!options.readOnly) await saveState(control,next,held?.revision ?? null);
  return next;
}
export function ownReading(baseline: Readonly<Record<string,number>> = {}) {
  const hours = processNeonBytes(), byCaller: Record<string,number> = {};
  for (const h of hours) for (const [key,bytes] of Object.entries(h.byCaller)) byCaller[key] = (byCaller[key] ?? 0)+bytes;
  for (const key of Object.keys(byCaller)) byCaller[key]=Math.max(0,byCaller[key]-(baseline[key]??0));
  const bytesRead = Object.values(byCaller).reduce((a,b) => a+b,0);
  return { bytesRead, byCaller, aiCostUsd: 0 as const, transferCostUsd: bytesRead/1e9*0.10 };
}
const number = (v: unknown): number | null => v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v);
export function readerFamily(recordClass:string):string {
  if((READER_FAMILIES as readonly string[]).includes(recordClass))return recordClass;
  if(/agenda/i.test(recordClass)) return "Agendas";
  if(/meeting|event|calendar|minute/i.test(recordClass)) return "Meetings";
  if(/campaign|funding|fec/i.test(recordClass)) return "Campaign money";
  if(/roll.?call|votes?/i.test(recordClass)) return "Votes";
  if(/election|ballot|voter|voting|polling|candidate/i.test(recordClass)) return "Elections";
  if(/statement|prl/i.test(recordClass)) return "Statements";
  if(/public.comment|participation/i.test(recordClass)) return "Taking part";
  if(/public.services|service.contact/i.test(recordClass)) return "Services";
  if(/finance|budget/i.test(recordClass)) return "Public finances";
  if(/geography|district/i.test(recordClass)) return "Districts";
  if(/body|government|registration|registry|board.directory/i.test(recordClass)) return "Government bodies";
  if(/official|roster|member|legislator|directory/i.test(recordClass)) return "Officials and members";
  return "Other facts";
}
export function workOwner(family: string): string {
  return /discovery|hunt|scout|acquir/i.test(family)?"hunters":"diggers";
}
function issue(key: string, where: string, says: string, owner: string, next: string, technical?: readonly string[]): Problem {
  return { key, where, says, owner, next, ...(technical ? { technical } : {}) };
}
/** No finding closes fix work. Only a repair proven on the live site may do that. */
export function composeHour(input: Awaited<ReturnType<typeof readHour>>, state: LineState, at: string,proofs:readonly PageProof[]=[]): LineHour {
  proofs=proofs.filter(p=>p.eligible!==false);
  const problems: Problem[] = [];
  const add = (p: Problem) => problems.push(p);
  const links=completeLinks(input.links?.links??[]),waiting=waitingAt(state.waitingIndex??{},at),posting=state.posting??[];
  problems.push(...inventoryProblems(state.inventory,links,at));
  for(const error of input.links?.errors??[]) add(issue('links-unread','Source to reader','Part of the line could not be measured.','River','Restore the hourly link measurement.',[error]));
  for(const l of links) if(l.incoming>0 && l.outgoing===0) add(issue(`link:${l.state}:${l.kind}:${l.link}`,`${l.state} · ${l.kind}`,
    `${l.link} took in ${l.incoming} and passed on nothing (${l.unit}).`,l.link==='Source'?'hunters':l.link==='Box'?'the runner':['Reader API','Live page'].includes(l.link)?'River':'diggers',
    'Repair this link and verify useful output through to the live page on the next check.'));
  for(const h of handoffProblems(links,readerFamily))add(issue(`handoff:${h.state}:${h.kind}:${h.after}:${h.before}`,`${h.state} · ${h.kind}`,
    `${h.after} recorded ${h.count} output, but ${h.before} recorded no intake from this family.`,h.before==='Reader API'||h.before==='Live page'?'River':'the runner',
    'Trace this handoff, restore useful output, and observe the exact facts on the live page.'));
  const waitingGroups=new Map<string,typeof waiting[number][]>();
  for(const w of waiting){const key=`${w.state}:${w.kind}:${w.owner}`;waitingGroups.set(key,[...waitingGroups.get(key)??[],w]);}
  for(const [key,rows] of waitingGroups) add(issue(`waiting:${key}`,`${rows[0].state} work waiting`,`${rows.length} items are blocked, failed, or waiting past dispatch time.`,rows[0].owner,
    'Repair the recorded blocker without changing spending limits; verify useful output and facts on the live page.',rows.slice(0,8).map(w=>`${w.id} · ${w.place}: ${w.reason.slice(0,240)}`)));
  const missing=posting.filter(p=>!p.liveAt&&Date.parse(at)-Date.parse(p.firstSeenAt)>90*60_000);
  for(const p of missing)add(issue(`meeting-stamp:${p.versionId}:${p.recordKey}`,'Meeting delivery checks',
    `${p.recordKey} has no delivery stamp after 90 minutes. Delivery is unverified.`,
    'diggers','Repair the stamp writer and verify this exact change on the live page in the next hourly check.',[JSON.stringify({version:p.versionId,recordKey:p.recordKey})]));
  const raw = input.rawVital;
  const summary = input.heartbeat?.bytes as {hour?:string;readerBytes?:number;controlPlaneBytes?:number;byCaller?:{caller:string;bytes:number}[]} | undefined;
  const projectTransfer=transferSince(state.transferSample,input.transferCounters).reading??state.hours.find(h=>h.from===input.window.from&&h.transfer?.complete)?.transfer??null;
  const transfer = projectTransfer??(summary?.hour === input.window.from && number(summary.controlPlaneBytes) !== null && number(summary.readerBytes) !== null
    ? { control: Number(summary.controlPlaneBytes), reader: Number(summary.readerBytes), byCaller: summary.byCaller ?? [] }
    : raw && number(raw.neon_bytes_read) !== null ? { control: Number(raw.neon_bytes_read), reader: null,
      byCaller: Object.entries(raw.neon_bytes_by_caller as Record<string,number> ?? {}).map(([caller,bytes]) => ({caller,bytes})) } : null);
  const sources = sourceReading(state,at);
  const neverDoors=new Map<string,typeof state.doors[string][]>();
  for(const door of Object.values(state.doors))if(door.status==='OPEN'&&!door.lastSuccessAt&&!door.lastFailureAt&&
    Date.parse(at)-Date.parse(door.firstSeenAt??door.updatedAt)>3_600_000){
    const code=keeperState(door.doorId,door.ocdId??'')?.toUpperCase()??'US',key=`${code}:${door.kind}`;
    neverDoors.set(key,[...neverDoors.get(key)??[],door]);
  }
  for(const [key,doors] of neverDoors)add(issue(`door-never-run:${key}`,`${key.split(':')[0]} sources`,`${doors.length} scheduled ${doors[0].kind} doors have never recorded a read.`,'diggers',
    'Connect these doors to their schedule and verify pages read, facts saved and facts on the live page.',doors.slice(0,8).map(d=>d.doorId)));
  if (!state.seededAt || Date.parse(closedHour(state.seededAt&&state.seededAt>state.checkedAt?state.seededAt:state.checkedAt).through)<Date.parse(input.window.from) || input.doors === null || input.calendars === null) sources.complete = false;
  if(sources.complete){
    const missing=new Map<string,string[]>();
    for(const feed of feedDoorDrafts())if(!state.doors[feed.doorId]){const code=keeperState(String(feed.config?.scope??''),'')?.toUpperCase()??'US',kind=feed.holds?.[0]??feed.kind,key=`${code}:${kind}`;missing.set(key,[...missing.get(key)??[],feed.doorId]);}
    for(const [key,feeds]of missing)add(issue(`built-not-wired:${key}`,key,`${feeds.length} built clocked feeds have no registered source clock.`,'the runner','Connect these built feeds to their normal schedule and verify useful output through to the live page.',feeds.slice(0,8)));
  }
  for (const failure of input.failures) add(issue(`read:${failure.split(":")[0]}`, "Factory measurements", "Part of the hourly measurement could not be read.", "River", "Restore this measurement and check its next hourly report.", [failure]));
  if (!sources.complete) add(issue("source-clock-inventory", "Source checks", "The source-clock inventory is incomplete.", "River", "Refresh the compact source clocks through the deployment initializer."));
  for (const row of sources.byKind??[]) if (row.overdue) add(issue(`overdue:${row.state}:${row.family}`, row.state === "US" ? "National source checks" : `${row.state} · ${row.family} source checks`, `${row.overdue.toLocaleString("en-US")} of ${row.scheduled.toLocaleString("en-US")} sources are past their check.`, "diggers", "Restore each overdue source's scheduled check and verify it ran."));
  if (!(input.heartbeat?.heartbeat as RunnerHeartbeat|undefined)?.pause && livenessOf((input.heartbeat?.heartbeat as RunnerHeartbeat|undefined)??null,at).state!=="ALIVE") add(issue("runner-stopped", "Research runner", "The runner is not reporting on time.", "the runner", "Restore the runner and verify its heartbeat and work."));
  if (number(raw?.rounds_killed)) add(issue("rounds-killed", "Research rounds", `${raw!.rounds_killed} research rounds were killed in the last full hour.`, "the runner", "Fix the cause of the watchdog stops and verify a full round."));
  if (!transfer || transfer.reader === null) add(issue("database-accounting", "Database use", "The full hour's database bytes could not be measured.", "River", "Restore per-caller counts for both databases."));
  if(!projectTransfer)add(issue('project-byte-accounting','Database use','The project-wide hourly counter comparison is not ready; the displayed runner-process bytes are a floor.','River','Verify the next independent counter comparison, including TX-01’s web and runner totals; initialize the baseline if missing.'));
  if(proofs.length)add(issue('public-check-byte-accounting','Line keeper database cost','Direct line-keeper database reads are counted; database reads made inside the public HTTP endpoints are not attributable to this observer.','River','Expose the existing TX-01 response-byte counts on the checked reader responses, so the observer can report their exact cost.'));
  if (transfer && transfer.control+(transfer.reader ?? 0)>=0.7e9) add(issue("database-over-target", "Database use", `${((transfer.control+(transfer.reader ?? 0))/1e9).toFixed(2)} GB read in the last full hour is above the 0.7 GB target.`, "River", "Reduce the largest callers and verify the next hour's bytes.", transfer.byCaller.map(c => `${c.caller}: ${c.bytes} bytes`)));
  const grouped=new Map<string,{state:string;family:string;empty:number;fetchedNothing:number;savedNothing:number;failed:number;unknown:number;routes:string[]}>();
  for (const w of input.work ?? []) {
    const key=`${w.state}:${w.family}`,held=grouped.get(key)??{state:w.state,family:w.family,empty:0,fetchedNothing:0,savedNothing:0,failed:0,unknown:0,routes:[]};
    held.fetchedNothing+=w.fetchedNothing;held.savedNothing+=w.savedNothing;held.empty+=w.empty;held.failed+=w.failed;held.unknown+=w.unknown;held.routes.push(w.route);grouped.set(key,held);
  }
  for (const work of grouped.values()) {
    const where = work.state === "US" ? "National acquisition" : `${work.state} acquisition`;
    if (work.empty) add(issue(`empty:${work.state}:${work.family}`, where, `${work.empty.toLocaleString("en-US")} runs fetched and saved nothing in the last full hour.`, workOwner(work.family), "Fix the route and verify it fetches or saves the missing information.", [work.family,...work.routes.slice(0,32)]));
    if(work.savedNothing>work.empty)add(issue(`saved-nothing:${work.state}:${work.family}`,where,`${work.savedNothing-work.empty} runs read source data but saved nothing.`,workOwner(work.family),'Repair extraction and saving, then verify the resulting facts on the live page.',[work.family,...work.routes.slice(0,8)]));
    if(work.fetchedNothing>work.empty)add(issue(`fetched-nothing:${work.state}:${work.family}`,where,`${work.fetchedNothing-work.empty} runs saved results without recording a source read.`,workOwner(work.family),'Trace the saved input evidence and confirm the source-to-reader connection.',[work.family,...work.routes.slice(0,8)]));
    if (work.failed) add(issue(`failed:${work.state}:${work.family}`,where,`${work.failed} runs failed in the last full hour.`,workOwner(work.family),"Fix the execution failure and verify the next run.",[work.family,...work.routes.slice(0,32)]));
    if (work.unknown) add(issue(`unmeasured:${work.state}:${work.family}`,where,`${work.unknown} runs did not record what they fetched or saved.`,workOwner(work.family),"Record intake and saved results on each run.",[work.family,...work.routes.slice(0,32)]));
  }
  for (const f of input.facts ?? []) if (f.saved>f.live) add(issue(`stored-not-delivered:${f.state}:${f.family}`,`${f.state} · ${f.family}`,`${(f.saved-f.live).toLocaleString("en-US")} stored facts from the last full hour have not been confirmed in the reader’s view.`,workOwner(f.family),"Repair the reader connection and verify the facts on the live page."));
  if (input.costs?.paidJobsEndedEmpty) add(issue("paid-ended-empty","Paid research",`${input.costs.paidJobsEndedEmpty} of ${input.costs.paidJobsEnded} paid jobs ended with nothing.`,"hunters","Repair the empty paid routes and verify useful results."));
  if (input.costs?.unpricedCharges) add(issue("unpriced-costs","Research costs",`${input.costs.unpricedCharges} charges have no recorded price.`,"the runner","Record the settled cost so cost per fact can be measured."));
  const readiness:Record<string,ReadinessWitness> = {};
  let delivery:LineHour['delivery']=null;
  const outcome=input.readback as RoutineCivicDataSupervisorOutcome|null;
  const typedComplete=outcome&&Array.isArray(outcome.failures)&&routineReaderReadbackEvidenceIssue(outcome)===null;
  if(!typedComplete)add(issue('typed-reader-evidence','Reader store checks','The supervisor’s exact reader-check results are missing or incomplete.','the runner','Restore the normal reader-check report; the independent hourly public check continues.'));
  if(proofs.length){
    const byFamily=new Map<string,{family:string;seen:number;total:number}>();
    for(const p of proofs){const family=readerFamily(p.kind),f=byFamily.get(family)??{family,seen:0,total:0};f.total++;if(p.api&&p.live)f.seen++;byFamily.set(family,f);}
    delivery={seen:proofs.filter(p=>p.api&&p.live).length,total:proofs.length,byFamily:[...byFamily.values()]};
    readiness['PUB-04']={state:delivery.seen===delivery.total?'witnessed':'failing',evidence:`${delivery.seen} of ${delivery.total} exact changed records observed in the reader API and visible public DOM.`};
    readiness['PUB-02']={state:proofs.every(p=>p.api)?'witnessed':'failing',evidence:`${proofs.filter(p=>p.api).length} of ${proofs.length} exact accepted records and changed values returned by the production reader API.`};
    readiness['PUB-18']={state:READER_FAMILIES.every(f=>byFamily.has(f))&&delivery.seen===delivery.total?'witnessed':'failing',evidence:READER_FAMILIES.map(f=>{const r=byFamily.get(f);return `${f}: ${r?`${r.seen} of ${r.total} observed`:'no current public check'}`;}).join('; ')};
    const failed=new Map<string,PageProof[]>();for(const p of proofs.filter(p=>!p.api||!p.live)){const key=`${p.state}:${p.kind}`;failed.set(key,[...failed.get(key)??[],p]);}
    for(const [key,rows] of failed)add(issue(`public:${key}`,`${rows[0].state} · ${rows[0].kind}`,`${rows.length} exact accepted records could not be confirmed through the reader API and live page.`,'River','Repair the connection and verify these exact values on the next hourly check.',rows.slice(0,8).map(p=>`${p.recordKey}: ${p.reason.slice(0,240)}`)));
  }else add(issue('reader-evidence','Reader pages','The last hour has no independent live-page observations.',"River","Restore exact reader-page checks for each enabled family."));

  const gates=[...readGateHealth({nowIso:at,heartbeat:(input.heartbeat?.heartbeat as RunnerHeartbeat | undefined)??null,
    databaseReachable:input.rawVital!==null||typedComplete&&outcome?.durable===true ? true : null,
    lastDispatch:outcome && outcome.attemptedTasks>0 ? {finishedAt:outcome.finishedAt,durableResult:outcome.durable===true && outcome.verifiedSourceSuccesses>0}:null,spend:null})];
  const familyPaths=delivery?.byFamily ?? [];
  const readerGate=gates.findIndex(g=>g.id==='GATE-09');
  if(delivery && readerGate>=0) {
    const live=new Set(familyPaths.filter(f=>f.seen>0).map(f=>readerFamily(f.family)));
    const missing=READER_FAMILIES.filter(f=>!live.has(f));
    gates[readerGate]={...gates[readerGate],state:missing.length?'attention':'pass',sentence:missing.length?`Reader paths still need a successful check for ${missing.join(', ')}.`:'Every reader family has a current successful page check.'};
  }
  if(!delivery&&readerGate>=0)gates[readerGate]={...gates[readerGate],state:'attention',sentence:'No independent public-page check completed in this hour.'};
  const dispatchGate=gates.findIndex(g=>g.id==='GATE-04');
  if(waiting.length&&dispatchGate>=0)gates[dispatchGate]={...gates[dispatchGate],state:'attention',sentence:`${waiting.length} items are blocked, failed, or waiting beyond their dispatch clock.`};
  for(const gate of gates) if(gate.state!=='pass') add(issue(`launch:${gate.id}`,gate.name,gate.sentence,
    ['GATE-02','GATE-07','GATE-12'].includes(gate.id)?'the runner':gate.id==='GATE-06'?'the runner':gate.id==='GATE-09'?'River':'River',
    'Repair this check and record its result in a normal production run.'));
  for (const group of readinessCounts(readiness)) {
    if (!group.notMeasured) continue;
    const checks = CHECKLIST_PROFILE.definitions.filter(d => d.group===group.group&&!readiness[d.id]).map(d => `${d.id}: ${d.requirement}`);
    add(issue(`readiness:${group.group}`,group.name,`${group.notMeasured} readiness checks have no recorded evidence.`,group.group==="PUB"?"River":group.group==="ASK"?"River":group.group==="REC"?"diggers":"hunters","Record each check's real result and connect it to the Scoreboard.",checks));
  }
  const work = input.work===null?null:[...new Set(input.work.map(w=>`${w.state}:${w.family}`))].map(key=>{
    const rows=input.work!.filter(w=>`${w.state}:${w.family}`===key),first=rows[0];
    return {...first,route:rows.length===1?first.route:"multiple sources",...Object.fromEntries(['runs','fetchedNothing','savedNothing','empty','failed','unknown'].map(field=>[field,rows.reduce((sum,w)=>sum+Number(w[field as keyof typeof w]),0)]))};
  });
  return { ...input.window, measuredAt: at, links,waiting,posting,delivery, gates, facts: input.facts, recordsLive: input.recordsLive, work, costs: input.costs,
    rounds: {finished:number(raw?.rounds_finished),killed:number(raw?.rounds_killed)}, transfer, sources,
    runnerTransferByCaller:summary?.hour===input.window.from?summary.byCaller:raw?Object.entries(raw.neon_bytes_by_caller as Record<string,number>??{}).map(([caller,bytes])=>({caller,bytes})):undefined,
    problems:[...new Map(problems.map(p=>[p.key,p])).values()], readiness, own: ownReading() };
}
/** Updates the same daily brief as Admin, retaining other teams' current problems and decisions. Alerts stay as set. */
export function withKeeperFixes(config: AdminConfig, hour: LineHour): AdminConfig {
  let next = config;
  const technical=(p:Problem)=>[`line-keeper:${p.key}`,...(p.technical??[]).slice(0,4).map(t=>t.startsWith('{"version":')?t:t.slice(0,220)),`Observed window: ${hour.from} to ${hour.through}`];
  for (const p of hour.problems) next = withFixAdded(next,{where:p.where,says:p.says,addedBy:LINE_KEEPER_BY,at:hour.measuredAt,sourceKey:`line-keeper:${p.key}`,owner:p.owner,technical:technical(p)});
  const active=new Map(hour.problems.map(p=>[fixSubjectId(p.where,`line-keeper:${p.key}`),p]));
  next={...next,fixList:fixItems(next).map(item=>{const p=active.get(item.id);return p?{...item,says:p.says,owner:p.owner,
    technical:technical(p)}:item;})};
  const current=new Set(hour.problems.map(p=>fixSubjectId(p.where,`line-keeper:${p.key}`))),closedKeys=new Set<string>();
  for(const item of fixItems(next)){
    if(item.addedBy!==LINE_KEEPER_BY||item.state==='FIXED'||current.has(item.id))continue;
    const source=item.technical?.find(t=>t.startsWith('line-keeper:'));
    const previousWindow=item.technical?.find(t=>t.startsWith('Observed window: '))?.slice(17,41);
    if(!source||!previousWindow||hour.from<=previousWindow||hour.problems.some(p=>p.key.startsWith('read:')||p.key==='links-unread'))continue;
    const state=/\b([A-Z]{2})(?=:| ·| acquisition| source| work|$)/.exec(`${source} ${item.where}`)?.[1];
    const parts=source.split(':'),family=['link','handoff','empty','saved-nothing','fetched-nothing','failed','unmeasured','stored-not-delivered','records-unconfirmed','public','job-clock','built-not-wired','door-never-run','overdue','waiting'].includes(parts[1])?readerFamily(parts[3]??''):null;
    const proofs=(hour.pageProofs??[]).filter(p=>(!state||p.state===state)&&(!family||readerFamily(p.kind)===family));
    const flow=(hour.links??[]).filter(l=>(!state||l.state===state)&&(!family||readerFamily(l.kind)===family)&&l.incoming>0);
    if(parts[1]==='link'&&!flow.some(l=>l.link===parts[4]&&l.outgoing>0))continue;
    // Missing historical stamps cannot be erased by a different record's successful readback.
    if(parts[1]==='meeting-stamp'){
      const identity=item.technical?.find(t=>t.startsWith('{"version":'));
      if(!identity)continue;
      let target:{version:string;recordKey:string};try{target=JSON.parse(identity);}catch{continue;}
      const stamp=hour.posting?.find(p=>p.versionId===target.version&&p.recordKey===target.recordKey&&p.liveAt);
      const observed=(hour.pageProofs??[]).find(p=>p.version===target.version&&p.recordKey===target.recordKey&&p.api&&p.live&&p.checkedAt>item.addedAt);
      if(!stamp||!observed)continue;
      next=withFixCompleted(next,item.id,{whatChanged:'The stamp writer resumed and a later independent check observed this exact change on the live page.',changedBy:LINE_KEEPER_BY,
        before:item.says,after:`Stamped ${stamp.liveAt}; exact page checked ${observed.checkedAt}.`},hour.measuredAt);
      closedKeys.add(source);continue;
    }
    if(!proofs.length||proofs.some(p=>!p.live||!p.api||p.checkedAt<=item.addedAt)||!flow.some(l=>!['Reader API','Live page'].includes(l.link)&&l.outgoing>0)||flow.some(l=>l.outgoing===0))continue;
    next=withFixCompleted(next,item.id,{whatChanged:'A later independent hourly check found the line carrying work and the exact facts on the live page.',
      changedBy:LINE_KEEPER_BY,before:item.says,after:`Checked ${hour.measuredAt}: ${proofs.length} exact public records observed after useful output resumed.`},hour.measuredAt);
    closedKeys.add(source);
  }
  const day = easternBriefClock(hour.measuredAt).day;
  const latest = next.latestBrief?.day === day ? next.latestBrief : projectBrief(next,[],hour.measuredAt);
  const held = new Map([...(config.latestBrief?.problems??[]),...latest.problems].filter(p=>!closedKeys.has(p.key)).map(p => [p.key,p]));
  for (const p of hour.problems) held.set(`line-keeper:${p.key}`,{key:`line-keeper:${p.key}`,what:p.says,owner:p.owner,next:p.next});
  for(const item of fixItems(next).filter(i=>i.addedBy===LINE_KEEPER_BY&&i.state!=='FIXED')){
    const key=item.technical?.find(t=>t.startsWith('line-keeper:'));
    if(key&&!held.has(key))held.set(key,{key,what:item.says,owner:item.owner??'River',next:'Keep the repair open until the next independent check confirms useful output and the exact facts on the live page.'});
  }
  return { ...next, latestBrief:{...latest,...(next.latestBrief?.day===day?next.latestBrief.lineKeeperOnly?{lineKeeperOnly:true}:{}:{lineKeeperOnly:true}),createdAt:hour.measuredAt,problems:[...held.values()]}, updatedAt:hour.measuredAt };
}
export function configGrowth(before:AdminConfig,after:AdminConfig,rounds:number|null) {
  const bytes=(value:unknown)=>Buffer.byteLength(JSON.stringify(value??null));
  const fixBytes=bytes(after.fixList)-bytes(before.fixList),briefBytes=bytes(after.latestBrief)-bytes(before.latestBrief),totalBytes=bytes(after)-bytes(before);
  return {fixBytes,briefBytes,totalBytes,fourCallersBytesPerHour:rounds===null?null:Math.max(0,totalBytes)*4*rounds};
}
/** Only the existing repair and brief fields cross the wire. Unrelated settings never enter this process. */
export async function readFixConfig(sql:Sql,at:string):Promise<{revision:number;bytes:number;fixBytes?:number;briefBytes?:number;value:AdminConfig}> {
  const [row]=await query(sql,'fix-list',`SELECT revision,value->'fixList' AS fixes,value->'latestBrief' AS brief,
    value->>'updatedAt' AS updated_at,octet_length(value::text) AS bytes,octet_length(coalesce(value->'fixList','null'::jsonb)::text) AS fix_bytes,octet_length(coalesce(value->'latestBrief','null'::jsonb)::text) AS brief_bytes FROM cp_admin_config WHERE id=$1`,[ADMIN_CONFIG_ID]);
  if(!row)throw Error('Admin settings are unreadable; findings have not been queued');
  return {revision:Number(row.revision),bytes:Number(row.bytes),fixBytes:Number(row.fix_bytes),briefBytes:Number(row.brief_bytes),value:{...defaultAdminConfig(at),updatedAt:String(row.updated_at??at),
    fixList:(row.fixes??[]) as AdminConfig['fixList'],latestBrief:row.brief as AdminConfig['latestBrief']??undefined}};
}
export function measuredConfigGrowth(before:Awaited<ReturnType<typeof readFixConfig>>,after:AdminConfig,hour:LineHour) {
  const growth=configGrowth(before.value,after,hour.rounds.finished);
  const callers=(hour.runnerTransferByCaller??hour.transfer?.byCaller??[]).filter(c=>c.caller.includes('cp_admin_config.read ')||c.caller.endsWith('\tcp_admin_config'));
  const observed=callers.length?Math.max(...callers.map(c=>c.bytes)):null;
  return {...growth,fourCallersBytesPerHour:observed!==null&&before.bytes>0?Math.ceil(Math.max(0,growth.totalBytes)/before.bytes*observed*4):growth.fourCallersBytesPerHour};
}
function exactGrowth(before:Awaited<ReturnType<typeof readFixConfig>>,after:AdminConfig,hour:LineHour,measured:Record<string,unknown>){
 const growth=measuredConfigGrowth(before,after,hour),totalBytes=Number(measured.bytes)-before.bytes;
 return {...growth,totalBytes,fixBytes:Number(measured.fix_bytes)-(before.fixBytes??0),briefBytes:Number(measured.brief_bytes)-(before.briefBytes??0),
  fourCallersBytesPerHour:growth.totalBytes>0&&growth.fourCallersBytesPerHour!==null?Math.ceil(growth.fourCallersBytesPerHour/growth.totalBytes*Math.max(0,totalBytes)):growth.fourCallersBytesPerHour};
}
/** Exact JSONB textual growth, evaluated by SELECT against the same revision. */
export async function previewConfigGrowth(sql:Sql,before:Awaited<ReturnType<typeof readFixConfig>>,after:AdminConfig,hour:LineHour){
 const [row]=await query(sql,'preview-config-growth',`SELECT octet_length(proposed::text) bytes,octet_length((proposed->'fixList')::text) fix_bytes,
 octet_length((proposed->'latestBrief')::text) brief_bytes FROM (SELECT value||$1::jsonb AS proposed FROM cp_admin_config WHERE id=$2 AND revision=$3) proposed`,
 [JSON.stringify({fixList:after.fixList,latestBrief:after.latestBrief,updatedAt:hour.measuredAt}),ADMIN_CONFIG_ID,before.revision]);
 if(!row)throw Error('Admin settings moved during the read-only growth preview');return exactGrowth(before,after,hour,row);
}
async function writeFixes(sql: Sql, hour: LineHour): Promise<ReturnType<typeof configGrowth>> {
  for (let attempt=0;attempt<4;attempt++) {
    const held=await readFixConfig(sql,hour.measuredAt);
    const config = withKeeperFixes(held.value,hour);
    const saved = await query(sql,"save-fix-list",`UPDATE cp_admin_config SET value=value || $1::jsonb,revision=revision+1,updated_at=$2::timestamptz
      WHERE id=$3 AND revision=$4 RETURNING revision,octet_length(value::text) bytes,octet_length((value->'fixList')::text) fix_bytes,octet_length((value->'latestBrief')::text) brief_bytes`,[JSON.stringify({fixList:config.fixList,latestBrief:config.latestBrief,updatedAt:hour.measuredAt}),hour.measuredAt,ADMIN_CONFIG_ID,held.revision]);
    if(saved.length) return exactGrowth(held,config,hour,saved[0]);
  }
  throw Error("Admin settings changed during every fix-list save");
}
export async function runLineKeeper(control: Sql, reader: Sql, at: string, options: {readonly readOnly?:boolean; readonly initialState?:LineState;readonly measureCountry?:boolean;readonly checkPages?:boolean;readonly countryCache?:readonly import("./country.ts").CountryCache[]} = {}): Promise<{ state:LineState; hour:LineHour }> {
  if (options.initialState && !options.readOnly) throw Error("An injected checkpoint is only allowed for a read-only preview");
  const baseline=ownReading().byCaller;
  const held = options.initialState ? null : await readLineState(control), previous = options.initialState ?? held?.value ?? emptyState(at);
  const already=previous.hours.find(h=>h.from===closedHour(at).from);
  if(!options.readOnly&&already)return {state:previous,hour:already};
  const previousClock=[previous.seededAt,previous.hours[0]?.measuredAt].filter((value):value is string=>!!value).sort().at(-1);
  const clockFrom=previousClock&&previousClock<=at&&Date.parse(at)-Date.parse(previousClock)<=3_720_000?previousClock:undefined;
  const transferFrom=previous.transferSample&&previous.transferSample.at<=at&&Date.parse(at)-Date.parse(previous.transferSample.at)<=3_720_000?previous.transferSample.at:undefined;
  const input = await readHour(control,reader,at,{clockFrom,transferFrom});
  const clocks = foldClocks(previous,input.doors ?? [],input.calendars ?? []);
  const posting=foldPosting(previous.posting??[],input.posting??[],input.stamps??[],at);
  const recentVersions=new Set(posting.map(p=>p.versionId));
  const targets=[...new Map([...(previous.targets??[]).filter(t=>recentVersions.has(t.version)),...(input.targets??[])].map(t=>[t.recordKey,t])).values()];
  const recordTargets=[...new Map([...(previous.recordTargets??[]),...(input.recordTargets??[])].map(t=>[`${t.state}:${t.kind}:${t.recordKey}`,t])).values()];
  const recordChecks=[...new Map([...(input.recordTargets??[]),...recordTargets].map(t=>[`${t.version}:${t.recordKey}`,t])).values()];
  const destinations=input.destinations??previous.destinations??{};
  const [proofs,country]=await Promise.all([
    options.checkPages===false?Promise.resolve([] as readonly PageProof[]):checkMeetingPages(targets,at,(input.facts??[]).flatMap(f=>f.eligibleFacts??[]),recordChecks,destinations),
    options.measureCountry?withQueryCaller("line-keeper.country",()=>publishCountryScores(control,reader,new Date(Date.parse(at)-3_600_000).toISOString(),at,at,{readOnly:options.readOnly,previewCache:options.countryCache})):Promise.resolve([]),
  ]);
  if(input.recordsLive!==null)input.recordsLive+=new Set(targets.filter(t=>(t.publishedAt??t.collectedAt??'')>=input.window.from&&(t.publishedAt??t.collectedAt??'')<input.window.through&&!input.recordVersions.includes(t.version)&&proofs.some(p=>p.version===t.version&&p.recordKey===t.recordKey&&p.api&&p.live)).map(t=>t.recordKey)).size;
  if(input.recordsLive!==null)input.recordsLive+=new Set(recordChecks.filter(t=>(t.publishedAt??t.collectedAt)>=input.window.from&&(t.publishedAt??t.collectedAt)<input.window.through&&!input.recordVersions.includes(t.version)&&proofs.some(p=>p.version===t.version&&p.recordKey===t.recordKey&&p.api&&p.live)).map(t=>t.recordKey)).size;
  if(input.facts)input.facts=input.facts.map(f=>({...f,live:(f.eligibleFacts??[]).filter(t=>proofs.some(p=>p.recordKey===`fact:${t.id}`&&p.api&&p.live)).length}));
  input.links??={links:[],waiting:[],errors:[]};input.links.links.push(...pageLinks(proofs));
  for(const f of input.facts??[])input.links.links.push({state:f.state,kind:f.family,link:'Fact table',incoming:f.saved,outgoing:f.live,unit:'facts saved / eligible for reader views'});
  const quiet=new Map<string,typeof recordTargets[number]>();for(const t of [...recordChecks].sort((a,b)=>b.collectedAt.localeCompare(a.collectedAt)))if(!quiet.has(`${t.state}:${t.kind}`))quiet.set(`${t.state}:${t.kind}`,t);
  const retainedRecords=[...new Map([...quiet.values(),...recordChecks.filter(t=>(t.publishedAt??t.collectedAt)>=input.window.through||!proofs.some(p=>p.version===t.version&&p.recordKey===t.recordKey&&p.api&&p.live))].map(t=>[`${t.state}:${t.kind}:${t.recordKey}`,t])).values()];
  const base = {...previous,...clocks,...(previousClock&&Date.parse(at)-Date.parse(previousClock)>3_720_000?{seededAt:null}:{}),destinations,targets,recordTargets:retainedRecords,inventory:input.inventory?foldInventory(previous.inventory,input.inventory):previous.inventory,waitingIndex:foldWaiting(previous.waitingIndex??{},input.links?.waiting??[]),
    posting:posting.map(p=>proofs.some(proof=>proof.version===p.versionId&&proof.recordKey===p.recordKey&&proof.api&&proof.live)?{...p,pageSeenAt:at}:p)};
  const grouped=new Map<string,{state:string;family:string;kind:string;saved:number;api:number;live:number}>();
  const recordGroup=(state:string,kind:string)=>{const key=`${state}:${kind}`,row=grouped.get(key)??{state,kind,family:readerFamily(kind),saved:0,api:0,live:0};grouped.set(key,row);return row;};
  for(const link of input.links.links.filter(l=>l.link==='Fact table'&&l.unit==='passed records / promoted records'))recordGroup(link.state,link.kind).saved+=link.outgoing;
  for(const record of input.recordDistribution){const row=recordGroup(keeperState(String(record.scope??''),'')?.toUpperCase()??'US',String(record.record_class??'Unclassified records'));row.api+=record.live;row.live+=record.live;}
  for(const t of [...targets.map(t=>({...t,kind:'MEETING'})),...recordChecks]){
    const published=t.publishedAt??t.collectedAt??'';if(published<input.window.from||published>=input.window.through||input.recordVersions.includes(t.version))continue;
    const row=recordGroup(t.state,t.kind),proof=proofs.find(p=>p.version===t.version&&p.recordKey===t.recordKey);
    if(proof?.eligible===false){row.saved=Math.max(0,row.saved-1);continue;}
    if(proof?.api)row.api++;if(proof?.api&&proof.live)row.live++;
  }
  let hour = {...composeHour(input,base,at,proofs),recordsByKind:[...grouped.values()],pageProofs:proofs,own:ownReading(baseline)};
  for(const row of hour.recordsByKind??[])if(row.saved>row.live)hour={...hour,problems:[...hour.problems,issue(`records-unconfirmed:${row.state}:${row.kind}`,`${row.state} · ${row.kind}`,
    `${row.saved-row.live} promoted records from the last hour have no confirmed public delivery.`, 'River','Trace the unmatched records through their reader API and visible page; keep the repair open until the next check carries them.')]};
  if(country.length)hour={...hour,countryFreshness:{states:country.filter(s=>!s.error).length,n:country.filter(s=>!s.error).reduce((n,s)=>n+(s.freshness?.n??0),0),of:country.filter(s=>!s.error).reduce((n,s)=>n+(s.freshness?.of??0),0)}};
  if(country.some(s=>s.error))hour={...hour,problems:[...hour.problems,issue('country-scores','Readers have',`${country.filter(s=>s.error).length} states have an unavailable or incomplete country-table report.`,'River','Restore the published score inputs and verify the existing country table.',country.filter(s=>s.error).slice(0,8).map(s=>`${s.state}: ${s.error}`))]};
  if(!options.readOnly) hour={...hour,configGrowth:await writeFixes(control,hour)};
  else {const heldConfig=await readFixConfig(control,at).catch(()=>null);if(heldConfig)hour={...hour,configGrowth:await previewConfigGrowth(control,heldConfig,withKeeperFixes(heldConfig.value,hour),hour)};}
  hour={...hour,own:ownReading(baseline)};
  const compactHour={...hour,posting:undefined,waiting:undefined,facts:hour.facts?.map(({eligibleFacts:_eligibleFacts,...f})=>f)??null};
  const state:LineState = {...base,transferSample:transferSince(previous.transferSample,input.transferCounters).sample,seededAt:hour.sources?.complete?base.seededAt:null,checkedAt:options.readOnly?at:new Date().toISOString(),hours:[...previous.hours.filter(h => h.from!==hour.from),compactHour].sort((a,b) => b.from.localeCompare(a.from)).slice(0,2)};
  if(!options.readOnly) await saveState(control,state,held?.revision ?? null);
  return {state,hour};
}
