"use client";

/**
 * **WHAT RESIDENTS ASK ABOUT — a panel on Now.** Each topic as a share of the users in the same week and ZIP or district, with
 * the count beside it. Aggregate only: there is no person, address, session or device in these rows. Small groups are shown the
 * same way as large ones, never hidden. Free-form questions are their own topic. Until the counts exist it says so, and a
 * missing count is never shown as zero.
 */
import { useState } from "react";

import type { TopicCountsView } from "@/lib/control-plane/admin-view/topic-counts.ts";

import { mst } from "./model.ts";
import { Card, cx, Empty, Failed, Loading, usePager } from "./ui.tsx";
import { useReading } from "./use-reading.ts";
import s from "./v6.module.css";

const percentWords = (p: number | null) => (p === null ? "—" : `${p}%`);

export function TopicCountsPanel() {
  const { reading, reload } = useReading<TopicCountsView>("/api/admin/v6/topic-counts", 5 * 60_000);
  const [week, setWeek] = useState("all");
  const [topic, setTopic] = useState("all");
  const data = reading.kind === "ready" && reading.data.kind === "READ" ? reading.data : null;
  const rows = (data?.rows ?? []).filter((r) => (week === "all" || r.week === week) && (topic === "all" || r.topic === topic));
  const { page, pager } = usePager(rows, 15);
  return (
    <Card title="What residents ask about" id="topic-counts">
      {reading.kind === "loading" && <Loading what="the topic counts" />}
      {reading.kind === "failed" && <Failed what="The topic counts" retry={reload} />}
      {reading.kind === "ready" && reading.data.kind === "NOT_INSTALLED" && <Empty>{reading.data.says}</Empty>}
      {data && (
        <div className={s.stack}>
          <p className={cx(s.p, s.small, s.dim)}>Each row is a share of the users in that week and ZIP or district, with the count beside it. Counts of groups of users, never a person. Small groups are shown the same way as large ones.</p>
          <div className={s.inline}>
            <select className={s.select} aria-label="Week" value={week} onChange={(e) => setWeek(e.target.value)}>
              <option value="all">Every week</option>
              {data.weeks.map((w) => <option key={w} value={w}>Week of {w}</option>)}
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
                <thead><tr><th scope="col">Week of</th><th scope="col">Where</th><th scope="col">Topic</th><th scope="col" className={s.num}>Share of users</th><th scope="col" className={s.num}>Users</th></tr></thead>
                <tbody>
                  {page.map((r) => (
                    <tr key={`${r.week}|${r.place}|${r.topic}`}>
                      <th scope="row" style={{ textTransform: "none", fontSize: 13, color: "var(--text)" }}>{r.week}</th>
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
          {data.hidden > 0 && <p className={cx(s.p, s.meta)}>{data.hidden.toLocaleString("en-US")} rows were not shown because they were malformed or past the first 500. They are counted here, not dropped quietly.</p>}
          <p className={cx(s.p, s.meta)}>Read {mst(data.observedAt)}.{reading.kind === "ready" && reading.stale ? " The latest refresh failed, so this is the last good reading." : ""}</p>
        </div>
      )}
    </Card>
  );
}
