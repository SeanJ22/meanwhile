"use client";
import type { HourlyVitalSigns, VitalSignsReading, CallerBytes } from "@/lib/control-plane/admin-view/hourly-vital-signs.ts";
import { formatEasternSpan, formatEastern } from "@/lib/control-plane/eastern-time.ts";
import { Card, Technical } from "./ui.tsx";
import { useReading } from "./use-reading.ts";
import s from "./v6.module.css";
const number = (v: number | null | undefined) => v == null ? "—" : v.toLocaleString("en-US", { maximumFractionDigits: 3 });
const money = (v: number | null | undefined) => v == null ? "—" : `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
const gb = (bytes: number | null | undefined) => bytes == null ? "—" : number(bytes / 1_000_000_000);
const through = (hour: string) => new Date(Date.parse(hour) + 3_600_000).toISOString();
function callerWords(caller: string): string {
  if (/ledger|spend_hold/.test(caller)) return "Spending and reservations";
  if (/attempt/.test(caller)) return "Saved attempts";
  if (/artifact|capture/.test(caller)) return "Saved source pages";
  if (/work_item|workItem/.test(caller)) return "Work items";
  if (/field_manual|bank/i.test(caller)) return "Shared methods";
  if (/publication|promotion|pipeline/.test(caller)) return "Publication";
  return "Other database reads";
}
function Causes({ rows }: { readonly rows: readonly CallerBytes[] | null | undefined }) {
  return rows?.length ? <ul>{rows.map((c,i)=><li key={i}>{callerWords(c.caller)} · {gb(c.bytes)} GB <Technical lines={[c.caller]}/></li>)}</ul> : <p className={s.small}>Causes: —</p>;
}
export function VitalSignsRow({ row, hour }: { readonly row: HourlyVitalSigns | null; readonly hour?: string }) {
  const start = row?.hour ?? hour;
  return <Card title="Hourly vital signs" aside="Whole factory">
    <p className={s.meta}>{start ? formatEasternSpan(start, through(start)) : "—"}{row ? ` · Read ${formatEastern(row.writtenAt)}` : ""}</p>
    <div className={s.grid2}>
      <div><h3 className={s.h3}>Facts live per hour</h3><span className={s.big}>{number(row?.factsLive)}</span><p className={s.small}>New or changed reader records</p></div>
      <div><h3 className={s.h3}>Cost per fact</h3><span className={s.big}>{money(row?.costPerFactUsd)}</span></div>
      <div><h3 className={s.h3}>Spend</h3><span className={s.big}>{money(row?.settledSpendUsd)}</span></div>
      <div><h3 className={s.h3}>Neon GB per hour</h3><span className={`${s.big} ${(row?.neonBytesRead ?? 0) > 700_000_000 ? s.textWarn : ""}`}>{gb(row?.neonBytesRead)}</span><p className={s.small}>Target: under 0.7 GB</p><Causes rows={row?.neonBytesByCaller}/></div>
      <div><h3 className={s.h3}>Rounds finished</h3><span className={s.big}>{number(row?.roundsFinished)}</span></div>
      <div><h3 className={s.h3}>Rounds killed</h3><span className={s.big}>{number(row?.roundsKilled)}</span></div>
      <div><h3 className={s.h3}>Paid jobs ending with nothing</h3><span className={`${s.big} ${(row?.paidJobsEndedEmpty ?? 0) > 0 ? s.legacyTextDanger : ""}`}>{number(row?.paidJobsEndedEmpty)}</span></div>
    </div>
    <p className={s.meta}>Confirmed on the live site: {number(row?.factsConfirmed)} of {number(row?.factsSampled)} sampled · Rounds deferred: {number(row?.roundsDeferred)}</p>
    {row?.releaseSha && <Technical lines={[`Runner release ${row.releaseSha}`]}/>} 
  </Card>;
}
export function VitalSignsHours({ reading }: { readonly reading: VitalSignsReading | null }) {
  return <div className={s.stack}>{reading ? reading.hours.map(h=><VitalSignsRow key={h.hour} hour={h.hour} row={h.row}/>) : <VitalSignsRow row={null}/>}</div>;
}
export function NowVitalSigns() {
  const { reading } = useReading<VitalSignsReading>("/api/admin/v6/vital-signs");
  return <>{reading.kind === "failed" && <p role="status">The hourly records could not be read just now.</p>}{reading.kind === "ready" && reading.stale && <p role="status">The latest read failed; these are the earlier saved hours.</p>}<VitalSignsHours reading={reading.kind === "ready" ? reading.data : null}/></>;
}

/** The brief keeps its 24-hour history compact, with the same row values as Now. */
export function BriefVitalSigns({ reading }: { readonly reading: VitalSignsReading | null }) {
  return <Card title="Hourly vital signs" aside="Last 24 completed hours">
    {reading ? <div className={s.tableWrap}><table className={s.table}>
      <thead><tr>{["Hour","Facts live","Spend","Cost per fact","Neon GB","Finished","Killed","Paid jobs ending empty"].map(label=><th key={label} scope="col">{label}</th>)}</tr></thead>
      <tbody>{reading.hours.map(({hour,row})=><tr key={hour}>
        <th scope="row">{formatEasternSpan(hour,through(hour))}</th>
        <td>{number(row?.factsLive)}</td><td>{money(row?.settledSpendUsd)}</td><td>{money(row?.costPerFactUsd)}</td>
        <td>{gb(row?.neonBytesRead)}<details><summary>Causes</summary><Causes rows={row?.neonBytesByCaller}/></details></td>
        <td>{number(row?.roundsFinished)}</td><td>{number(row?.roundsKilled)}</td>
        <td className={(row?.paidJobsEndedEmpty ?? 0)>0?s.legacyTextDanger:undefined}>{number(row?.paidJobsEndedEmpty)}</td>
      </tr>)}</tbody>
    </table></div> : <p>The hourly records could not be read for this brief. —</p>}
  </Card>;
}
