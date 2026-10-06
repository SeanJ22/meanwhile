"use client";
import type { HourlyVitalSigns, VitalSignsReading } from "@/lib/control-plane/admin-view/hourly-vital-signs.ts";
import { formatEasternSpan, formatEastern } from "@/lib/control-plane/eastern-time.ts";
import { plainWords } from "@/lib/control-plane/admin-view/plain-words.ts";
import { Card } from "./ui.tsx";
import { useReading } from "./use-reading.ts";
import s from "./v6.module.css";
const number = (v: number | null | undefined) => v == null ? "—" : v.toLocaleString("en-US", { maximumFractionDigits: 3 });
const money = (v: number | null | undefined) => v == null ? "—" : `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
/** Identical measured row on Now and in the saved daily brief. */
export function VitalSignsRow({ row, stale = false }: { readonly row: HourlyVitalSigns | null; readonly stale?: boolean }) {
  return <Card title="Hourly vital signs" aside="Whole factory">
    <p className={s.meta}>{row ? `${formatEasternSpan(row.from, row.through)} · Read ${formatEastern(row.readAt)}` : "—"}</p>
    {stale && <p role="status">The latest read failed; this is the last saved hour.</p>}
    <div className={s.grid2}>
      <div><h3 className={s.h3}>Facts live per hour</h3><span className={s.big}>{number(row?.factsLivePerHour)}</span><p className={s.small}>New or updated verified reader records</p></div>
      <div><h3 className={s.h3}>Cost per fact</h3><span className={s.big}>{money(row?.costPerFactUsd)}</span></div>
      <div><h3 className={s.h3}>Spend</h3><span className={s.big}>{money(row?.settledSpendUsd)}</span></div>
      <div><h3 className={s.h3}>Neon GB per hour</h3><span className={s.big}>{number(row?.neon?.gbPerHour)}</span>
        {row?.neon?.causes.length ? <ul>{row.neon.causes.map((c, i) => <li key={i}>{plainWords(c.cause)} · {number(c.gbPerHour)} GB per hour</li>)}</ul> : <p className={s.small}>Causes: —</p>}
      </div>
      <div><h3 className={s.h3}>Rounds finished</h3><span className={s.big}>{number(row?.rounds?.finished)}</span></div>
      <div><h3 className={s.h3}>Rounds killed</h3><span className={s.big}>{number(row?.rounds?.killed)}</span></div>
    </div>
  </Card>;
}
export function NowVitalSigns() {
  const { reading } = useReading<VitalSignsReading>("/api/admin/v6/vital-signs");
  return <VitalSignsRow row={reading.kind === "ready" ? reading.data.row : null} stale={reading.kind === "ready" && reading.stale} />;
}
