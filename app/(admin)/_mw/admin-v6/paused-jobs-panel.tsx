"use client";

import type { PausedJobView, PausedJobsView } from "@/lib/control-plane/admin-view/paused-jobs.ts";

import { mst } from "./model.ts";
import { ActionButton, Card, Empty, Loading, Pill, Technical } from "./ui.tsx";
import { useReading } from "./use-reading.ts";
import s from "./v6.module.css";

/** Each paused job: its name, when it paused, what it read in that hour, and the Release control. */
export function PausedJobsList(props: { readonly jobs: readonly PausedJobView[] }) {
  if (!props.jobs.length) return <Empty>No job is paused.</Empty>;
  return (
    <ul className={s.stack} style={{ listStyle: "none", padding: 0, margin: 0, gap: 8 }} aria-label="Paused jobs">
      {props.jobs.map((job) => (
        <li key={job.job} className={s.row}>
          <span className={s.spread}><strong style={{ fontSize: 13 }}>{job.label}</strong><Pill tone="warn">Paused</Pill></span>
          <span className={s.small}>Paused {mst(job.pausedAt)} after reading {job.gb.toFixed(2)} GB in one hour{job.topTableWords ? `, most of it from ${job.topTableWords}` : ""}.</span>
          <span className={s.meta}>It waits until you release it.</span>
          <ActionButton action={{ kind: "job-release", target: job.job, label: "Release", payload: { name: job.label } }} />
          <Technical lines={[`Job: ${job.job}`, `Most read: ${job.topTable ?? "—"}`, `Paused at ${mst(job.pausedAt)}`]} />
        </li>
      ))}
    </ul>
  );
}

export function PausedJobsPanel() {
  const { reading, reload, status } = useReading<PausedJobsView>("/api/admin/v6/paused-jobs");
  return (
    <Card title="Paused jobs" id="paused-jobs">
      {status}
      {reading.kind === "loading" && <Loading what="the paused jobs" />}
      {reading.kind === "failed" && <p className={s.p}>— <button type="button" className={s.btn} onClick={reload}>Try again</button></p>}
      {reading.kind === "ready" && <PausedJobsList jobs={reading.data.jobs} />}
    </Card>
  );
}
