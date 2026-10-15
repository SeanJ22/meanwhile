"use client";

import { useState } from "react";
import type { SourceChecksView } from "@/lib/control-plane/admin-view/v6-source-checks-read.ts";
import { US_STATES } from "@/lib/control-plane/readiness/catalog.ts";
import { count, mst } from "./model.ts";
import { Card, Empty, Loading } from "./ui.tsx";
import { useReading } from "./use-reading.ts";
import s from "./v6.module.css";

export function SourceChecksPanel() {
  const [state, setState] = useState("US");
  const [pages, setPages] = useState([""]);
  const [view, setView] = useState("registered");
  const after = pages.at(-1)!;
  const { reading, reload } = useReading<SourceChecksView>(`/api/admin/v6/source-checks?state=${state}&view=${view}&after=${after}`, 60_000);
  const data = reading.kind === "ready" ? reading.data : null;
  return <Card title="Source checks" id="source-checks">
    <label className={s.inline}>Place <select className={s.select} value={state} onChange={event => { setState(event.target.value); setPages([""]); }}>
      <option value="US">National sources</option>
      {US_STATES.map(place => <option key={place.code} value={`US-${place.code.toUpperCase()}`}>{place.name}</option>)}
    </select></label>
    <label className={s.inline}>Show <select className={s.select} value={view} onChange={event => { setView(event.target.value); setPages([""]); }}>
      <option value="registered">Registered sources</option><option value="responses">Captured pages and feeds</option>
    </select></label>
    {reading.kind === "loading" && <Loading what="source checks" />}
    {reading.kind === "failed" && <p role="status">Source checks could not be read. <button className={s.btn} onClick={reload}>Try again</button></p>}
    {data && <div className={s.stack}>
      {reading.kind === "ready" && reading.stale && <p role="status">These checks could not be refreshed. <button className={s.btn} onClick={reload}>Try again</button></p>}
      {data.days.length > 0 && <div className={s.tableWrap}><table className={s.table} aria-label="Daily source checks">
        <thead><tr><th scope="col">Day (Eastern)</th><th scope="col">Checks</th><th scope="col">Unchanged without a download</th></tr></thead>
        <tbody>{data.days.map(day => <tr key={day.day}><td>{day.day}</td><td>{count(day.checks)}</td>
          <td>{day.unchangedShare === null ? "—" : `${(day.unchangedShare * 100).toFixed(1)}%`} ({count(day.unchanged)})</td></tr>)}</tbody>
      </table></div>}
      {data.rows.length === 0 ? <Empty>No sources recorded for this view</Empty> : <div className={s.tableWrap}>
        <table className={s.table} aria-label="Source check results"><thead><tr><th scope="col">Source</th><th scope="col">Last check</th><th scope="col">Result</th><th scope="col">Next due</th></tr></thead>
          <tbody>{data.rows.map(row => <tr key={row.key}><td>{row.url ? <a href={row.url} target="_blank" rel="noreferrer">{row.name}</a> : row.name}</td>
            <td>{row.checkedAt ? mst(row.checkedAt) : "Not checked yet"}</td><td>{row.result}</td><td>{mst(row.nextDueAt)}</td></tr>)}</tbody></table>
      </div>}
      <div className={s.inline}>
        {pages.length > 1 && <button className={s.btn} onClick={() => setPages(pages.slice(0, -1))}>Previous sources</button>}
        {data.next && <button className={s.btn} onClick={() => setPages([...pages, data.next!])}>Next sources</button>}
      </div>
      <p className={s.meta}>Read {mst(data.observedAt)}</p>
    </div>}
  </Card>;
}
