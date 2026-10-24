"use client";

import { useState } from "react";
import { REGISTRY_STATES } from "@/lib/civic-data/state-scopes.ts";
import { useV6 } from "./context.tsx";
import { count, mst } from "./model.ts";
import { Card, Empty, Loading, usePager } from "./ui.tsx";
import { useReading } from "./use-reading.ts";
import s from "./v6.module.css";

interface Counts {
  readonly at: string;
  readonly rows: readonly { readonly state: string; readonly hour: string; readonly incoming: number; readonly done: number; readonly refused: number }[];
}

export function WorkCounts() {
  const v = useV6();
  const scope = /^st:([a-z]{2})$/.exec(v.scopeKey)?.[1] ?? /^geo:([a-z]{2})\./.exec(v.scopeKey)?.[1];
  const [chosen, choose] = useState<string | null>(null);
  const state = chosen ?? scope ?? "";
  const { reading, reload } = useReading<Counts>(`/api/admin/v6/work-counts${state ? `?state=${state}` : ""}`);
  const rows = reading.kind === "ready" ? reading.data.rows : [];
  const { page, pager } = usePager(rows, 12);
  return <Card title="Work by hour">
    <select className={s.select} value={state} aria-label="State for hourly work counts" onChange={event => choose(event.target.value)}>
      <option value="">Every state</option>
      {REGISTRY_STATES.map(code => <option key={code} value={code.toLowerCase()}>{v.index.get(`st:${code.toLowerCase()}`)?.name ?? code}</option>)}
      <option value="us">National and system work</option>
    </select>
    {reading.kind === "loading" && <Loading what="the hourly work counts" />}
    {reading.kind === "failed" && <p className={s.p}>— <button type="button" className={s.btn} onClick={reload}>Try again</button></p>}
    {reading.kind === "ready" && <>
      {reading.stale && <p className={s.meta}>The latest reading failed. Showing the last saved reading.</p>}
      {!rows.length && <Empty>No work counts for this state.</Empty>}
      {!!rows.length && <div className={s.tableWrap}><table className={s.table}>
        <thead><tr><th scope="col">Hour (Eastern)</th><th scope="col">State</th><th scope="col" className={s.num}>Rows in</th><th scope="col" className={s.num}>Done</th><th scope="col" className={s.num}>Refused</th></tr></thead>
        <tbody>{page.map(row => <tr key={`${row.state}:${row.hour}`}>
          <th scope="row">{mst(row.hour)}</th><td>{row.state === "us" ? "National and system" : v.index.get(`st:${row.state}`)?.name ?? row.state.toUpperCase()}</td>
          <td className={s.num}>{count(row.incoming)}</td><td className={s.num}>{count(row.done)}</td><td className={s.num}>{count(row.refused)}</td>
        </tr>)}</tbody>
      </table></div>}
      {pager}
      <p className={s.meta}>Read {mst(reading.data.at)}</p>
    </>}
  </Card>;
}
