"use client";

import { useState } from "react";

import type { TopicCountsView } from "@/lib/control-plane/admin-view/topic-counts.ts";

import { mst } from "./model.ts";
import { Card, cx, Empty, Loading, usePager } from "./ui.tsx";
import { useReading } from "./use-reading.ts";
import s from "./v6.module.css";

const percentWords = (p: number | null) => (p === null ? "—" : `${p}%`);

export function TopicCountsPanel() {
  const { reading, reload } = useReading<TopicCountsView>("/api/admin/v6/topic-counts", 5 * 60_000);
  const [period, setPeriod] = useState("all");
  const [topic, setTopic] = useState("all");
  const data = reading.kind === "ready" && reading.data.kind === "READ" ? reading.data : null;
  const rows = (data?.rows ?? []).filter((r) => (period === "all" || `${r.grain}:${r.period}` === period) && (topic === "all" || r.topic === topic));
  const { page, pager } = usePager(rows, 15);
  return (
    <Card title="What residents ask about" id="topic-counts">
      {reading.kind === "loading" && <Loading what="the topic counts" />}
      {reading.kind === "failed" && <p className={s.p}>— <button type="button" className={s.btn} onClick={reload}>Try again</button></p>}
      {reading.kind === "ready" && reading.data.kind === "NOT_INSTALLED" && <Empty>—</Empty>}
      {data && (
        <div className={s.stack}>
          <div className={s.inline}>
            <select className={s.select} aria-label="Day or week" value={period} onChange={(e) => setPeriod(e.target.value)}>
              <option value="all">Every day and week</option>
              {data.periods.map((p) => <option key={p} value={p}>{p.startsWith("day:") ? `Day ${p.slice(4)}` : `Week of ${p.slice(5)}`}</option>)}
            </select>
            <select className={s.select} aria-label="Topic" value={topic} onChange={(e) => setTopic(e.target.value)}>
              <option value="all">Every topic</option>
              {data.topics.map((t) => <option key={t} value={t}>{data.rows.find((r) => r.topic === t)?.topicLabel ?? t}</option>)}
            </select>
          </div>
          {!rows.length && <Empty>No topic counts match these filters.</Empty>}
          {!!rows.length && (
            <div className={s.tableWrap}>
              <table className={s.table}>
                <thead><tr><th scope="col">Day or week</th><th scope="col">Where</th><th scope="col">Topic</th><th scope="col" className={s.num}>Share of users</th><th scope="col" className={s.num}>Users</th></tr></thead>
                <tbody>
                  {page.map((r) => (
                    <tr key={`${r.grain}|${r.period}|${r.place}|${r.topic}`}>
                      <th scope="row" style={{ textTransform: "none", fontSize: 13, color: "var(--text)" }}>{r.grain === "day" ? r.period : `Week of ${r.period}`}</th>
                      <td>{r.place}</td>
                      <td>{r.topicLabel}</td>
                      <td className={s.num}>{percentWords(r.percent)}</td>
                      <td className={s.num}>{r.users.toLocaleString("en-US")} of {r.totalUsers.toLocaleString("en-US")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {pager}
          {data.hidden > 0 && <p className={cx(s.p, s.meta)}>{data.hidden.toLocaleString("en-US")} rows not shown</p>}
          <p className={cx(s.p, s.meta)}>Read {mst(data.observedAt)}</p>
        </div>
      )}
    </Card>
  );
}
