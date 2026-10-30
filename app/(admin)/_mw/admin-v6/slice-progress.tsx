"use client";

import { count, mst } from "./model.ts";
import { Card, Loading } from "./ui.tsx";
import { useReading } from "./use-reading.ts";
import s from "./v6.module.css";

interface Reading { readonly at: string; readonly built: number; readonly places: number }

/** Every place gets its own small slice of what belongs on its page; this shows how far that has got. */
export function SliceProgress() {
  const { reading, reload, status } = useReading<Reading>("/api/admin/v6/slice-progress");
  return <Card title="Place slices">
    {status}
    {reading.kind === "loading" && <Loading what="how many places have their slices" />}
    {reading.kind === "failed" && <p className={s.p}>— <button type="button" className={s.btn} onClick={reload}>Try again</button></p>}
    {reading.kind === "ready" && <>
      {reading.stale && <p className={s.meta}>The latest reading failed. Showing the last saved reading.</p>}
      <p className={s.p}>{count(reading.data.built)} of {count(reading.data.places)} places have their slices
        {reading.data.built >= reading.data.places ? ". Every place has them." : ` (${Math.floor(100 * reading.data.built / Math.max(1, reading.data.places))}%).`}</p>
      <div className={s.meter}><div className={`${s.meterFill} ${s["c-teal"]}`} style={{ width: `${Math.min(100, 100 * reading.data.built / Math.max(1, reading.data.places))}%` }} /></div>
      <p className={s.meta}>Read {mst(reading.data.at)}</p>
    </>}
  </Card>;
}
