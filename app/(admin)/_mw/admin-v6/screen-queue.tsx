"use client";

/**
 * **QUEUE (BR-14).** Everything in motion in one list: orders, scheduled orders, instructions sent to the fleet, hunts, stuck cases,
 * doors shut now and fix-list items. Each row says what it is, where it stands, who has it, when it is due, what happens next and
 * how far along it is, and has its own stop or pause. A list that could not be read says so; it is never shown as empty.
 */
import { useState } from "react";

import type { DoorsView } from "@/lib/control-plane/admin-view/v6-doors-read.ts";
import type { ScheduledView } from "@/lib/control-plane/admin-view/v6-scheduled-read.ts";

import { useV6 } from "./context.tsx";
import { mst } from "./model.ts";
import { buildQueue, QUEUE_FILTERS, QUEUE_FILTER_WORDS, queueCounts, type QueueFilter, type QueueRow } from "./queue.ts";
import { Actions, Empty, Pill, Tabs, Technical, usePager } from "./ui.tsx";
import { useReading } from "./use-reading.ts";
import s from "./v6.module.css";

export function QueueScreen() {
  const v = useV6();
  const doors = useReading<DoorsView>("/api/admin/v6/doors", 60_000).reading;
  const scheduled = useReading<ScheduledView>("/api/admin/v6/scheduled", 60_000).reading;
  const [filter, setFilter] = useState<QueueFilter>("needs-me");

  const rows = buildQueue({
    receipts: v.data.history.data,
    sends: v.data.sends.data,
    hunts: v.data.hunts.data,
    stuck: v.data.stuck.data,
    fixes: v.data.fixes.data,
    doors: doors.kind === "ready" ? doors.data.rows.filter((d) => d.status === "Shut") : null,
    scheduled: scheduled.kind === "ready" ? scheduled.data.rows : null,
    format: (iso) => mst(iso),
  });
  const counts = queueCounts(rows);
  const shown = rows.filter((r) => r.filter === filter);
  const { page, pager } = usePager(shown, 10);
  const unread = [
    ["orders", v.data.history.data === null], ["instructions sent to the fleet", v.data.sends.data === null], ["hunts", v.data.hunts.data === null],
    ["stuck cases", v.data.stuck.data === null], ["fixes", v.data.fixes.data === null], ["shut doors", doors.kind !== "ready"], ["scheduled orders", scheduled.kind !== "ready"],
  ].filter(([, missing]) => missing).map(([name]) => name as string);

  return (
    <>
      <header>
        <p className={s.eyebrow}>Whole system</p>
        <h1 className={s.h1}>Queue</h1>
      </header>
      <div className={s.card}>
        <div className={s.spread}>
          <span className={s.small}>Pause or restart all scheduled work</span>
          <Actions actions={[{ kind: "global-runner-pause", target: "us" }, { kind: "global-runner-resume", target: "us" }]} />
        </div>
      </div>
      {unread.length > 0 && <p className={s.why}>Not read yet, so not shown here: {unread.join(", ")}.</p>}
      <Tabs label="Queue" value={filter} onChange={setFilter} tabs={QUEUE_FILTERS.map((f) => ({ id: f, label: QUEUE_FILTER_WORDS[f], count: counts[f] }))} />
      <div className={s.stack} role="tabpanel">
        {!shown.length && <Empty>Nothing in this list.</Empty>}
        {page.map((r) => <QueueCard key={r.key} row={r} />)}
        {pager}
      </div>
    </>
  );
}

function QueueCard(props: { readonly row: QueueRow }) {
  const v = useV6();
  const r = props.row;
  return (
    <article className={s.card} aria-label={r.what}>
      <div className={s.spread}>
        {r.open ? <button type="button" className={s.btnLink} onClick={() => v.open(r.open!)}><strong style={{ fontSize: 15, color: "var(--text)" }}>{r.what}</strong></button> : <strong style={{ fontSize: 15 }}>{r.what}</strong>}
        <Pill tone={r.tone}>{r.chip}</Pill>
      </div>
      <p className={s.meta}>{r.owner}{r.due ? ` · due ${r.due}` : ""}</p>
      <p className={s.small}>{r.next}</p>
      {r.progress && (
        <div role="progressbar" aria-label="Progress" aria-valuemin={0} aria-valuemax={r.progress.of} aria-valuenow={r.progress.done}>
          <div style={{ height: 6, borderRadius: 3, background: "var(--surface)" }}>
            <div style={{ height: 6, borderRadius: 3, width: `${Math.min(100, Math.round((r.progress.done / r.progress.of) * 100))}%`, background: "var(--teal, #0a7)" }} />
          </div>
          <span className={s.meta}>{r.progress.words}</span>
        </div>
      )}
      <Actions actions={r.actions} />
      <Technical lines={[r.key]} />
    </article>
  );
}
