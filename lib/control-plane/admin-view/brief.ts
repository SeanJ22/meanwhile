/** BR-27/28/29: a bounded live brief, and one durable daily snapshot from the existing timer. */
import { ADMIN_CONFIG_ID, defaultAdminConfig, isAdminConfig, type AdminConfig } from "../gateway/admin-config.ts";
import { BRIEF_TIME_SETTING, ALERTS_ON_SETTING, readSetting } from "../settings.ts";
import { decisionOrders, type DecisionOrderCard } from "../decision-cards.ts";
import { updateRecords } from "../updates.ts";
import { updatesView, type UpdateLine } from "./updates-read.ts";
import { readV6History } from "./admin-v6-history.ts";
import { population } from "./v6-stuck-route.ts";
import { stuckViews } from "./v6-stuck-read.ts";
import { readReports, type ReportsReading } from "../reports/read-reports.ts";
import { fixItems } from "../fix-list.ts";
import { v6FixesView } from "./v6-fixes-read.ts";
import { collapseDecisionLog } from "../decision-log.ts";
import { fixQueueView } from "../fix-queue.ts";
import { buildQueue, type QueueRow } from "../../../app/(admin)/_mw/admin-v6/queue.ts";
import type { UiReceipt, StuckItem } from "../../../app/(admin)/_mw/admin-v6/model.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";
import { listDoors } from "../../doors/registry.ts";
import { projectDoors } from "./v6-doors-read.ts";
import { scheduledView } from "./v6-scheduled-read.ts";
import { plainWords } from "./plain-words.ts";

export interface BriefSnapshot {
  readonly day: string; readonly createdAt: string;
  readonly updates: readonly UpdateLine[];
  readonly problems: readonly {key:string;what:string;owner:string;next:string}[];
  readonly decisions: readonly DecisionOrderCard[];
  readonly alerts: readonly {key:string;what:string;next:string}[];
  readonly unread: readonly string[];
}
export interface BriefReading { readonly fresh:BriefSnapshot; readonly latest:BriefSnapshot|null; readonly alertsOn:boolean }
/** Reader reports stay with the auditors, including when alerts are off. Test submissions never become problems. */
export function readerProblemRows(reports:ReportsReading):readonly QueueRow[] {
  return reports.sites.flatMap(site=>site.kind==="READ"?site.rows.filter(r=>r.origin==="reader"&&!r.suspectReason).map(r=>({
    key:`reader-report:${site.site}:${r.id}`,kind:"reader-report" as const,what:plainWords(r.message),chip:"Needs review",tone:"warn" as const,filter:"waiting" as const,
    owner:"Auditors",due:null,next:"The auditors need to review this reader's problem.",progress:null,actions:[],open:null,at:r.receivedAt,
  })):[]);
}
export function easternBriefClock(at:string):{day:string;time:string} {
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date(at));
  const p=(key:string)=>parts.find(x=>x.type===key)!.value;
  return {day:`${p("year")}-${p("month")}-${p("day")}`,time:`${p("hour")}:${p("minute")}`};
}
export function projectBrief(config:AdminConfig,rows:readonly QueueRow[],at:string,unread:readonly string[]=[]):BriefSnapshot {
  const cards=decisionOrders(config).filter(c=>!c.resolution);
  const needed=new Map(rows.filter(r=>r.filter==="needs-me").map(r=>[r.key,{key:r.key,what:r.what,next:r.next}]));
  for(const card of cards)if(!needed.has(`decision:${card.id}`))needed.set(`decision:${card.id}`,{key:`decision:${card.id}`,what:plainWords(card.recommends),next:"Your decision is needed."});
  const alerts=[...needed.values()];
  return {day:easternBriefClock(at).day,createdAt:at,updates:updatesView(updateRecords(config),at).updates.slice(0,50).map(u=>({...u,what:plainWords(u.what),before:u.before===null?null:plainWords(u.before),after:u.after===null?null:plainWords(u.after)})),
    problems:rows.filter(r=>r.tone==="warn").map(r=>({key:r.key,what:r.what,owner:r.owner,next:r.next})),decisions:cards,alerts,unread};
}
/** Same inputs as Queue; failures name the unread part instead of claiming there are no problems. */
export async function readBrief(repos:ControlPlaneRepositories,at:string):Promise<BriefReading> {
  const held=await repos.adminConfig.read(ADMIN_CONFIG_ID);
  if(held&&!isAdminConfig(held.value))throw new Error("The settings could not be read.");
  const config=held?.value??defaultAdminConfig(at);const unread:string[]=[];
  const [history,stuck,reports,doors]=await Promise.all([
    readV6History(repos,{scope:"us",asOf:at,limit:50}).catch(()=>{unread.push("orders");return null;}),
    population().catch(()=>null).then(p=>{if(!p){unread.push("stuck cases");return null;}return stuckViews(p.rows,"us",at).items;}),
    readReports(at).catch(()=>{unread.push("reader problems");return null;}),
    listDoors(repos.doors).then(d=>{if(d.unreadable)unread.push("some doors");const view=projectDoors({...d,saves:[],observedAt:at});if(view.counts.shut>view.rows.filter(r=>r.status==="Shut").length)unread.push("shut doors outside the current page");return view.rows.filter(r=>r.status==="Shut");}).catch(()=>{unread.push("doors");return null;}),
  ]);
  if(history?.page.nextCursor)unread.push("older orders outside the current page");
  if(reports?.sites.some(s=>s.kind==="UNREADABLE"))unread.push("reader problems from an unread site");
  const fixes=v6FixesView(fixQueueView(collapseDecisionLog([])),fixItems(config));
  const rows=buildQueue({receipts:history?.data as readonly UiReceipt[]|null ?? null,stuck:stuck as readonly StuckItem[]|null,fixes,sends:null,hunts:null,doors,scheduled:scheduledView(config,at).rows,decisions:decisionOrders(config)});
  if(reports?.sites.some(s=>s.kind==="READ"&&s.total>s.rows.length))unread.push("older reader problems outside the current page");
  const fresh=projectBrief(config,[...rows,...(reports?readerProblemRows(reports):[])],at,unread);
  return {fresh,latest:config.latestBrief??null,alertsOn:readSetting(config,ALERTS_ON_SETTING,false)};
}
/** Runs in BR-37's existing parent timer, even with the owner's PC off. Restart and competing ticks cannot save twice. */
export async function writeDailyBrief(repos:ControlPlaneRepositories,at:string,read:(repos:ControlPlaneRepositories,at:string)=>Promise<BriefReading>=readBrief):Promise<boolean> {
  const clock=easternBriefClock(at);const held=await repos.adminConfig.read(ADMIN_CONFIG_ID);
  if(!held||!isAdminConfig(held.value))return false;
  const time=readSetting<string>(held.value,BRIEF_TIME_SETTING,"");
  if(!time||clock.time<time||(held.value.latestBrief?.day??"")>=clock.day)return false;
  const snapshot=(await read(repos,at)).fresh;
  for(let n=0;n<4;n++){
    const latest=await repos.adminConfig.read(ADMIN_CONFIG_ID);if(!latest||!isAdminConfig(latest.value)||(latest.value.latestBrief?.day??"")>=clock.day)return false;
    const currentTime=readSetting<string>(latest.value,BRIEF_TIME_SETTING,"");if(!currentTime||clock.time<currentTime)return false;
    try{await repos.adminConfig.compareAndSet(ADMIN_CONFIG_ID,latest.revision,{...latest.value,latestBrief:snapshot},at);return true;}catch(e){if(n===3)throw e;}
  }
  return false;
}
