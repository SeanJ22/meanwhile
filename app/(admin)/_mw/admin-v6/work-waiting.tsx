"use client";

import type { Waiting } from "@/lib/core/work-counts.ts";
import { WORK_KINDS, WORK_TIERS, type WorkKind, type WorkTier } from "@/lib/core/work-kinds.ts";

import { count, mst } from "./model.ts";
import { Card, Empty, Loading } from "./ui.tsx";
import { useReading } from "./use-reading.ts";
import s from "./v6.module.css";

interface Reading { readonly at: string; readonly changedAt: string | null; readonly rows: readonly Waiting[] }

const KIND_WORDS: Readonly<Record<WorkKind, string>> = {
  fact: "Facts to publish", lead: "Links to read", hunt: "Blanks to hunt", recheck: "Sources to re-check", ask: "Reader questions",
  slice: "Place slices to rebuild", detect: "Detective work", fix: "Fixes", load: "Source loads", check: "Claims to check", order: "Orders in progress",
};
const TIER_WORDS: Readonly<Record<WorkTier, string>> = {
  clock: "On the clock", order: "Sean's orders", reader: "Readers asked", coverage: "Least-complete places",
};

export function WorkWaiting() {
  const { reading, reload, status } = useReading<Reading>("/api/admin/v6/work-waiting");
  const rows = reading.kind === "ready" ? reading.data.rows : [];
  const waiting = (kind: WorkKind, tier: WorkTier) => rows.find(row => row.kind === kind && row.tier === tier)?.waiting ?? 0;
  const kinds = WORK_KINDS.filter(kind => rows.some(row => row.kind === kind));
  return <Card title="Waiting now">
    {status}
    <p className={s.meta}>Work is served in this order, left to right: the clock, then Sean&apos;s orders, then what readers asked for, then the least-complete places.</p>
    {reading.kind === "loading" && <Loading what="what is waiting" />}
    {reading.kind === "failed" && <p className={s.p}>— <button type="button" className={s.btn} onClick={reload}>Try again</button></p>}
    {reading.kind === "ready" && <>
      {reading.stale && <p className={s.meta}>The latest reading failed. Showing the last saved reading.</p>}
      {!kinds.length && <Empty>Nothing is waiting.</Empty>}
      {!!kinds.length && <div className={s.tableWrap}><table className={s.table}>
        <thead><tr><th scope="col">What</th>{WORK_TIERS.map(tier => <th key={tier} scope="col" className={s.num}>{TIER_WORDS[tier]}</th>)}</tr></thead>
        <tbody>{kinds.map(kind => <tr key={kind}>
          <th scope="row">{KIND_WORDS[kind]}</th>
          {WORK_TIERS.map(tier => <td key={tier} className={s.num}>{count(waiting(kind, tier))}</td>)}
        </tr>)}</tbody>
      </table></div>}
      <p className={s.meta}>Read {mst(reading.data.at)}{reading.data.changedAt ? ` · last changed ${mst(reading.data.changedAt)}` : ""}</p>
    </>}
  </Card>;
}
