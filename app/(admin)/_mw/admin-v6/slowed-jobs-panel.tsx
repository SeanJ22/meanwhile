"use client";

import type { SlowedJobView, SlowedJobsView } from "@/lib/control-plane/admin-view/slowed-jobs.ts";

import { mst } from "./model.ts";
import { Card, Empty, Loading, Pill, Technical } from "./ui.tsx";
import { useReading } from "./use-reading.ts";
import s from "./v6.module.css";

/** Each job slowed for reading far more than its normal: what it read against its normal, how much slower it runs, and that its fix comes first. */
export function SlowedJobsList(props: { readonly jobs: readonly SlowedJobView[] }) {
  if (!props.jobs.length) return <Empty>No job has read far more than its normal this week.</Empty>;
  return (
    <ul className={s.stack} style={{ listStyle: "none", padding: 0, margin: 0, gap: 8 }} aria-label="Slowed jobs">
      {props.jobs.map((job) => (
        <li key={job.job} className={s.row}>
          <span className={s.spread}><strong style={{ fontSize: 13 }}>{job.label}</strong>
            <Pill tone={job.backAt ? "good" : "warn"}>{job.backAt ? "Back to normal" : `Slowed ${job.times}×`}</Pill></span>
          <span className={s.small}>Read {job.gb.toFixed(2)} GB in the hour from {mst(job.hour)} against its normal {job.normalGb.toFixed(2)} GB{job.topTableWords ? `, most of it from ${job.topTableWords}` : ""}.</span>
          <span className={s.meta}>{job.backAt ? `It read at its normal again and went back to its usual pace ${mst(job.backAt)}.`
            : `It keeps running, with launches ${job.times} times further apart, until it reads at its normal again.`} Its fix is first on the builders’ list.</span>
          <Technical lines={[`Job: ${job.job}`, `Most read: ${job.topTable ?? "—"}`, `Slowed at ${mst(job.slowedAt)}`]} />
        </li>
      ))}
    </ul>
  );
}

export function SlowedJobsPanel() {
  const { reading, reload, status } = useReading<SlowedJobsView>("/api/admin/v6/slowed-jobs");
  return (
    <Card title="Slowed jobs" id="slowed-jobs">
      {status}
      {reading.kind === "loading" && <Loading what="the slowed jobs" />}
      {reading.kind === "failed" && <p className={s.p}>— <button type="button" className={s.btn} onClick={reload}>Try again</button></p>}
      {reading.kind === "ready" && <SlowedJobsList jobs={reading.data.jobs} />}
    </Card>
  );
}
