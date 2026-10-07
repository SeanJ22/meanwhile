"use client";

import type { DoorsView } from "@/lib/control-plane/admin-view/v6-doors-read.ts";

import { count, mst } from "./model.ts";
import { Card, cx, Empty, Loading, Pill } from "./ui.tsx";
import { useReading } from "./use-reading.ts";
import s from "./v6.module.css";

export function DoorsPanel() {
  const { reading, reload } = useReading<DoorsView>("/api/admin/v6/doors", 60_000);
  const data = reading.kind === "ready" ? reading.data : null;
  return (
    <Card title="Doors" id="doors">
      {reading.kind === "loading" && <Loading what="the doors" />}
      {reading.kind === "failed" && <p className={s.p}>— <button type="button" className={s.btn} onClick={reload}>Try again</button></p>}
      {data && (
        <div className={s.stack}>
          <div className={s.inline}>
            <Pill tone="good">{count(data.counts.open)} open</Pill>
            <Pill tone={data.counts.shut ? "warn" : "neutral"}>{count(data.counts.shut)} shut</Pill>
            <Pill tone="neutral">{count(data.counts.setAside)} set aside</Pill>
            {data.counts.unreadable > 0 && <Pill tone="warn">{count(data.counts.unreadable)} unreadable</Pill>}
          </div>
          {!data.rows.length && <Empty>No doors yet</Empty>}
          {!!data.rows.length && (
            <div className={s.tableWrap}>
              <table className={s.table}>
                <thead><tr><th scope="col">Door</th><th scope="col">Kind</th><th scope="col">Body</th><th scope="col">State</th><th scope="col">Why</th><th scope="col">Since</th><th scope="col">Last worked</th><th scope="col">Last failed</th></tr></thead>
                <tbody>
                  {data.rows.map((row, n) => (
                    <tr key={`${row.name}-${n}`}>
                      <td>{row.name}</td>
                      <td>{row.kind}</td>
                      <td>{row.body}</td>
                      <td>{row.status}</td>
                      <td>{row.why ?? "—"}</td>
                      <td>{row.since ? mst(row.since) : "—"}</td>
                      <td>{row.lastWorked ? mst(row.lastWorked) : "—"}</td>
                      <td>{row.lastFailed ? mst(row.lastFailed) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {data.total > data.rows.length && <p className={cx(s.p, s.small)}>Showing {count(data.rows.length)} of {count(data.total)} doors</p>}
          {!!data.changes.length && (
            <div className={s.stack} style={{ gap: 4 }}>
              <strong className={s.small}>Latest door changes</strong>
              {data.changes.map((c, n) => <p key={`${c.at}-${n}`} className={cx(s.p, s.small)}>{mst(c.at)} · {c.says}</p>)}
            </div>
          )}
          <p className={cx(s.p, s.meta)}>Read {mst(data.observedAt)}</p>
        </div>
      )}
    </Card>
  );
}
