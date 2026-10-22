import type { ScoreboardRow, ScoreboardVitalHour } from "../../../app/(admin)/_mw/admin-v6/model.ts";
import { costPerFact } from "../vital-signs.ts";
import { READER_FAMILIES, keeperStatus, type LineHour, type LineState } from "./model.ts";
import { formatEastern } from "../eastern-time.ts";

const n = (x:number) => x.toLocaleString("en-US");
export const liveFacts = (h:LineHour):number|null => h.facts===null ? null : h.facts.reduce((a,b) => a+b.live,0);
const spend = (h:LineHour) => h.costs===null || h.costs.unpricedCharges>0 ? null : h.costs.spendUsd;
export function keeperVital(state:LineState|null):readonly ScoreboardVitalHour[]|null {
  if(!state) return null;
  return state.hours.slice(0,2).map(h => {
    const bytes = !h.transfer ? null : h.transfer.control+(h.transfer.reader??0);
    return {hour:h.from,factsLive:h.recordsLive,factsLiveConfirmed:true,costPerFactUsd:costPerFact(spend(h),h.recordsLive),neonGb:bytes===null?null:bytes/1e9,neonAtLeast:h.transfer?.complete!==true,
      overNeonTarget:bytes===null?null:bytes>=0.7e9?true:h.transfer?.complete?false:null,roundsFinished:h.rounds.finished,roundsKilled:h.rounds.killed,
      paidJobsEnded:h.costs?.paidJobsEnded??null,paidJobsEndedEmpty:h.costs?.paidJobsEndedEmpty??null};
  });
}
const row = (name:string,value:string|null,counts:string|null,says:string,items:readonly string[]=[],technical:readonly string[]=[]) : ScoreboardRow => ({id:name,name,value,counts,says,notMeasured:value===null?says:null,items,technical});
/** Replaces the existing rows in place. The same hourly report feeds Now and Scoreboard. */
export function keeperRows(state:LineState|null,at:string):readonly [string,ScoreboardRow][] {
  if(!state?.hours.length) return [];
  const h=state.hours[0],facts=liveFacts(h),saved=h.facts?.reduce((a,b) => a+b.saved,0)??null;
  const families=READER_FAMILIES.map(f => `${f}: ${n(h.facts?.filter(r=>r.family===f).reduce((a,b)=>a+b.live,0)??0)}`);
  const places=h.facts?.map(r=>`${r.state} · ${r.family}: ${n(r.live)} live · ${n(r.saved-r.live)} stored without confirmed delivery`)??[];
  const delivery=h.delivery,source=h.sources,wholeBytes=h.transfer ? h.transfer.control+(h.transfer.reader??0) : null;
  const when=`Last full hour, ${formatEastern(h.from)}. ${keeperStatus(state,at)}`;
  const rows=[
    row("Facts live per hour",h.recordsLive===null?null:n(h.recordsLive),h.recordsLive===null?null:`${n(h.recordsLive)} confirmed new or changed reader records; unobserved records earn no credit`,when),
    row("Facts live per hour (fact store)",facts===null?null:n(facts),saved===null?null:`${n(saved)} stored · ${n(facts??0)} reach reader views`,when,[...families,...places]),
    row("Cost per fact",costPerFact(spend(h),h.recordsLive)===null?null:`$${costPerFact(spend(h),h.recordsLive)!.toFixed(6)}`,h.costs?`$${h.costs.spendUsd.toFixed(4)} recorded spend · ${n(h.costs.unpricedCharges)} unpriced charges`:null,
      h.recordsLive===0?"No new reader record was confirmed live in this hour, so there is no cost per fact.":spend(h)===null?"The hour's settled spend is incomplete.":when),
    row("Public delivery",delivery && delivery.total>0?`${Math.floor(delivery.seen/delivery.total*100)}%`:null,
      delivery?`${n(delivery.seen)} of ${n(delivery.total)} public path checks observed in the reader API and live page`:null,
      delivery?when:"No complete set of reader-page checks was recorded in this hour.",delivery?.byFamily.map(f=>`${f.family}: ${n(f.seen)} of ${n(f.total)} checked public paths observed`)??[]),
    row("Freshness",h.countryFreshness&&h.countryFreshness.of>0?`${Math.floor(h.countryFreshness.n/h.countryFreshness.of*100)}%`:null,
      h.countryFreshness?`${n(h.countryFreshness.n)} of ${n(h.countryFreshness.of)} held items are current across ${h.countryFreshness.states} state views`:null,
      h.countryFreshness?`The existing place-freshness measure, at ${formatEastern(h.measuredAt)}. Source clocks appear under Overdue doors.`:'The country’s held-fact freshness report is unavailable.'),
    row("Overdue doors",!source?.complete?null:n(source.overdue),source?`${n(source.overdue)} of ${n(source.scheduled)} sources are past their check`:null,
      source?.complete?`Source clocks as of ${formatEastern(h.measuredAt)}.`:"The source-clock inventory is incomplete.",[],source?.byState.filter(s=>s.overdue).map(s=>`${s.state}: ${n(s.overdue)} of ${n(s.scheduled)} overdue`)??[]),
  ];
  // Existing row details carry database callers, empty work, and the observer's own cost; no added panel.
  const details=[...(wholeBytes===null?["Full database bytes unavailable"]:[h.transfer?.complete?`${(wholeBytes/1e9).toFixed(3)} GB an hour recorded by TX-01 across web and runner clients · target under 0.7 GB an hour · sample ${formatEastern(h.transfer.window!.from)} to ${formatEastern(h.transfer.window!.through)}`:`At least ${(wholeBytes/1e9).toFixed(3)} GB read by TX-01’s measured processes · target under 0.7 GB an hour`]),
    `${n((h.work??[]).reduce((n,w)=>n+w.empty,0))} runs fetched and saved nothing · ${n((h.work??[]).reduce((n,w)=>n+w.fetchedNothing,0))} fetched nothing · ${n((h.work??[]).reduce((n,w)=>n+w.savedNothing,0))} saved nothing`,
    `${n((h.work??[]).reduce((n,w)=>n+w.failed,0))} failed runs · ${n((h.work??[]).reduce((n,w)=>n+w.unknown,0))} missing intake or saved counts`,
    `Line keeper: ${n(h.own.bytesRead)} direct database bytes read · $0 AI · $${h.own.transferCostUsd.toFixed(8)} transfer at $0.10 per GB`];
  const linkDetails=(h.links??[]).map(l=>`${l.state} · ${l.kind} · ${l.link}: ${n(l.incoming)} in → ${n(l.outgoing)} out (${l.unit})`);
  const growth=h.configGrowth;
  if(growth)details.push(`Fix list added ${n(growth.fixBytes)} bytes; daily brief added ${n(growth.briefBytes)} bytes; Admin record grew ${n(growth.totalBytes)} bytes. Four callers: ${growth.fourCallersBytesPerHour===null?'hourly growth not measured':`about ${n(growth.fourCallersBytesPerHour)} extra bytes per hour at the observed whole-record read rate`}.`);
  const records=(h.recordsByKind??[]).map(r=>`${r.state} · ${r.family} · ${r.kind}: ${n(r.saved)} promoted · ${n(r.api)} in the reader response · ${n(r.live)} confirmed live`);
  const liveRow=rows[0];rows[0]={...liveRow,items:details,technical:[...records,...linkDetails,...h.transfer?.byCaller.map(c=>`${c.caller}: ${c.bytes} bytes`)??[],...h.runnerTransferByCaller?.map(c=>`Runner last full hour · ${c.caller}: ${c.bytes} bytes`)??[]]};
  return rows.map(r=>[r.id,r]);
}
