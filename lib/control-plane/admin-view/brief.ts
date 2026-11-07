import { ADMIN_CONFIG_ID, defaultAdminConfig, isAdminConfig, type AdminConfig } from "../gateway/admin-config.ts";
import { BRIEF_TIME_SETTING, ALERTS_ON_SETTING, readSetting } from "../settings.ts";
import { updateRecords } from "../updates.ts";
import { updatesView, type UpdateLine } from "./updates-read.ts";
import { readV6History } from "./admin-v6-history.ts";
import { population, populationRows } from "./v6-stuck-population.ts";
import { stuckViews } from "./v6-stuck-read.ts";
import { readReports, type ReportsReading } from "../reports/read-reports.ts";
import { fixItems } from "../fix-list.ts";
import { v6FixesView } from "./v6-fixes-read.ts";
import { collapseDecisionLog } from "../decision-log.ts";
import { fixQueueView } from "../fix-queue.ts";
import { buildQueue, type QueueRow } from "../../../app/(admin)/_mw/admin-v6/queue.ts";
import type { UiReceipt, StuckItem } from "../../../app/(admin)/_mw/admin-v6/model.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";
import { readAdminQueueDoors, readDoorCounts } from "./door-queries.ts";
import { QUEUE_FIX_FIELDS } from "../repository/admin-config.ts";
import { recordUndescribedCauses } from "./undescribed-causes.ts";
import { scheduledView } from "./v6-scheduled-read.ts";
import { plainWords } from "./plain-words.ts";
import { TERMINAL_WORK_ITEM_STATES, type WorkItem } from "../work-item.ts";
import { compactKeeperProblems, type BriefProblem } from "../../counts/problem-groups.ts";
import { placeReadConnection, pgActiveReaderQuestions, type Sql } from "../repository/pg-store.ts";
import { keysStore } from "../../core/keys-store.ts";
import { boundedQuery } from "../repository/request-bounds.ts";
import { keyProblems } from "../../core/keys-runner.ts";

const questionRow = (key: string, place: string | null | undefined, text: string, at: string): QueueRow => ({ key: `ask-question:${key}`, kind: "hunt" as const,
  what: `${place ? `ZIP ${place}: ` : ""}${text}`, chip: "Answer owed", tone: "warn" as const,
  filter: "waiting" as const, owner: "Hunters", due: null, next: "Find and publish a sourced answer.",
  progress: null, actions: [], open: null, at, receipt: null, sendId: null });

/** Questions still in the work list, before the hunters take them up. */
export async function unhandedQuestionRows(sql: Sql): Promise<readonly QueueRow[]> {
  const waiting = await boundedQuery(sql, { operation: "work.unhandedQuestions", callClass: "PAGE" },
    `SELECT id,value->>'question' AS question,value->>'place' AS place,received_at FROM work
    WHERE kind='ask' AND status='waiting' ORDER BY received_at LIMIT 100`, []) as Record<string, unknown>[];
  return waiting.map(ask => questionRow(String(ask.id), ask.place as string | null, String(ask.question), new Date(ask.received_at as string | Date).toISOString()));
}

/** Unanswered organic Ask questions stay visible while their sourced answer is owed, in the work list and then in the hunters' queue. */
export async function readerQuestionRows(repos: ControlPlaneRepositories): Promise<readonly QueueRow[]> {
  const fields = { id: true, state: true, createdAt: true, autonomousPlan: ["readerQuestion"] } as const;
  const sql = placeReadConnection(repos);
  const rows = sql ? await pgActiveReaderQuestions(sql)
    : await repos.workItems.listWhereNarrowed(["autonomousPlan", "readerQuestion", "origin"], "ASK", fields);
  return [...sql ? await unhandedQuestionRows(sql) : [], ...rows.flatMap(held => {
    const item = held.value as Pick<WorkItem, "id" | "state" | "createdAt" | "autonomousPlan">;
    const question = item.autonomousPlan?.readerQuestion;
    if (!question || TERMINAL_WORK_ITEM_STATES.includes(item.state)) return [];
    return [questionRow(item.id, question.place, question.text, item.createdAt)];
  })];
}

export interface BriefSnapshot {
  readonly day: string; readonly createdAt: string;
  /** Hourly findings may arrive before the scheduled daily snapshot. */
  readonly lineKeeperOnly?:boolean;
  readonly updates: readonly UpdateLine[];
  readonly problems: readonly BriefProblem[];
  readonly decisions: readonly {key:string;what:string;next:string}[];
  readonly alerts: readonly {key:string;what:string;next:string}[];
  readonly unread: readonly string[];
}
export interface BriefReading { readonly fresh:BriefSnapshot; readonly latest:BriefSnapshot|null; readonly alertsOn:boolean }
/** Reader reports stay with the auditors, including when alerts are off. Test submissions never become problems. */
export function readerProblemRows(reports:ReportsReading):readonly QueueRow[] {
  return reports.sites.flatMap(site=>site.kind==="READ"?site.rows.filter(r=>r.origin==="reader"&&!r.suspectReason).map(r=>({
    key:`reader-report:${site.site}:${r.id}`,kind:"reader-report" as const,what:plainWords(r.message),chip:"Needs review",tone:"warn" as const,filter:"waiting" as const,
    owner:"Auditors",due:null,next:"The auditors need to review this reader's problem.",progress:null,actions:[],open:null,at:r.receivedAt,receipt:null,sendId:null,
  })):[]);
}
export function easternBriefClock(at:string):{day:string;time:string} {
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date(at));
  const p=(key:string)=>parts.find(x=>x.type===key)!.value;
  return {day:`${p("year")}-${p("month")}-${p("day")}`,time:`${p("hour")}:${p("minute")}`};
}
export function projectBrief(config:AdminConfig,rows:readonly QueueRow[],at:string,unread:readonly string[]=[]):BriefSnapshot {
  const needed=new Map(rows.filter(r=>r.filter==="needs-me").map(r=>[r.key,{key:r.key,what:r.what,next:r.next}]));
  const alerts=[...needed.values()];
  return {day:easternBriefClock(at).day,createdAt:at,updates:updatesView(updateRecords(config),at).updates.slice(0,50).map(u=>({...u,what:plainWords(u.what),before:u.before===null?null:plainWords(u.before),after:u.after===null?null:plainWords(u.after)})),
    problems:rows.filter(r=>r.tone==="warn").map(r=>({key:r.key,what:r.what,owner:r.owner,next:r.next})),decisions:alerts,alerts,unread};
}

/** Only order failures and the displayed decision work can ask the owner to act. */
export async function readFreshAlerts(repos:ControlPlaneRepositories,at:string,
  readStuck=()=>populationRows("us",at)):Promise<BriefSnapshot["alerts"]> {
  const [history,stuck]=await Promise.all([
    readV6History(repos,{scope:"us",asOf:at,limit:50}).catch(()=>null),
    readStuck().catch(()=>null).then(rows=>rows?stuckViews(rows,"us",at).items:null),
  ]);
  const rows=buildQueue({receipts:history?.data as readonly UiReceipt[]|null ?? null,stuck:stuck as readonly StuckItem[]|null,
    fixes:null,sends:null,hunts:null,doors:null,scheduled:null});
  return [...new Map(rows.filter(row=>row.filter==="needs-me").map(row=>[row.key,{key:row.key,what:row.what,next:row.next}])).values()];
}
/** Same inputs as Queue; failures name the unread part instead of claiming there are no problems. */
export async function readBrief(repos:ControlPlaneRepositories,at:string):Promise<BriefReading> {
  const unread:string[]=[];
  const [held,history,stuck,reports,doors,questions,keys]=await Promise.all([
    repos.adminConfig.read(ADMIN_CONFIG_ID, { updates: { limit: 50 },
      fixList: { activeAndRecent: 500, fieldsProjection: QUEUE_FIX_FIELDS, queueFixSummary: true } }),
    readV6History(repos,{scope:"us",asOf:at,limit:50}).catch(()=>{unread.push("orders");return null;}),
    population().catch(()=>null).then(p=>{if(!p){unread.push("stuck cases");return null;}return stuckViews(p.rows,"us",at,[],p.summary).items;}),
    readReports(at).catch(()=>{unread.push("reader problems");return null;}),
    Promise.all([readAdminQueueDoors(repos,at),readDoorCounts(repos)]).then(([view,counts])=>{
      if(counts.unreadable)unread.push("some doors");if(counts.shut>view.rows.length)unread.push("shut doors outside the current page");return view.rows;
    }).catch(()=>{unread.push("doors");return null;}),
    readerQuestionRows(repos).catch(()=>{unread.push("unanswered reader questions");return [];}),
    Promise.resolve().then(()=>{
      const sql=placeReadConnection(repos);
      return sql?keysStore(async(text,params)=>await sql.query(text,params) as Record<string,unknown>[],undefined).list():[];
    }).catch(()=>{unread.push("saved keys");return null;}),
  ]);
  if(held&&!isAdminConfig(held.value))throw new Error("The settings could not be read.");
  const config=held?.value??defaultAdminConfig(at);
  if(history?.page.nextCursor)unread.push("older orders outside the current page");
  if(reports?.sites.some(s=>s.kind==="UNREADABLE"))unread.push("reader problems from an unread site");
  const fixes=v6FixesView(fixQueueView(collapseDecisionLog([])),fixItems(config));
  const rows=buildQueue({receipts:history?.data as readonly UiReceipt[]|null ?? null,stuck:stuck as readonly StuckItem[]|null,fixes,sends:null,hunts:null,doors,scheduled:scheduledView(config,at).rows});
  if(reports?.sites.some(s=>s.kind==="READ"&&s.total>s.rows.length))unread.push("older reader problems outside the current page");
  const projected=projectBrief(config,[...rows,...(reports?readerProblemRows(reports):[]),...questions],at,unread);
  const keeperFixKeys=new Set(fixItems(config).filter(f=>f.addedBy==='The line keeper').map(f=>`fix:${f.id}`));
  const keeperProblems=compactKeeperProblems(config.latestBrief?.problems.filter(p=>p.key.startsWith('line-keeper:'))??[]);
  const fresh={...projected,problems:[...projected.problems.filter(p=>!keeperFixKeys.has(p.key)),...keeperProblems,...(keys?keyProblems(keys,at):[])]};

  return {fresh,latest:config.latestBrief?compactBrief(config.latestBrief):null,alertsOn:readSetting(config,ALERTS_ON_SETTING,false)};
}
export const compactBrief=(brief:BriefSnapshot):BriefSnapshot=>({...brief,problems:compactKeeperProblems(brief.problems)});
function dailySnapshotSaved(config:AdminConfig,day:string):boolean{
 const saved=config.latestBrief;return !!saved&&(saved.day>day||saved.day===day&&saved.lineKeeperOnly!==true);
}
/** Runs in BR-37's existing parent timer, even with the owner's PC off. Restart and competing ticks cannot save twice. */
export async function writeDailyBrief(repos:ControlPlaneRepositories,at:string,read:(repos:ControlPlaneRepositories,at:string)=>Promise<BriefReading>=readBrief):Promise<boolean> {
  const clock=easternBriefClock(at);const held=await repos.adminConfig.read(ADMIN_CONFIG_ID);
  if(!held||!isAdminConfig(held.value))return false;
  const time=readSetting<string>(held.value,BRIEF_TIME_SETTING,"");
  if(!time||clock.time<time||dailySnapshotSaved(held.value,clock.day))return false;
  const snapshot=(await read(repos,at)).fresh;
 if(read===readBrief){const held=await population().catch(()=>null);if(held)await recordUndescribedCauses(repos,
   held.summary?held.summary.groups.map(group=>group.sample):held.rows,at).catch(()=>undefined);}
  for(let n=0;n<4;n++){
    const latest=await repos.adminConfig.read(ADMIN_CONFIG_ID);if(!latest||!isAdminConfig(latest.value)||dailySnapshotSaved(latest.value,clock.day))return false;
    const currentTime=readSetting<string>(latest.value,BRIEF_TIME_SETTING,"");if(!currentTime||clock.time<currentTime)return false;
    try{await repos.adminConfig.save(latest,{...latest.value,latestBrief:snapshot},at);return true;}catch(e){if(n===3)throw e;}
  }
  return false;
}
