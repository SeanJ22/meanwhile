"use client";

import type { DoorRowView, DoorsView } from "@/lib/control-plane/admin-view/v6-doors-read.ts";

import { count, mst } from "./model.ts";
import { Card, cx, Empty, Loading, Pill } from "./ui.tsx";
import { useReading } from "./use-reading.ts";
import s from "./v6.module.css";

export interface ShutDoorGroup {
  readonly kind: string;
  readonly why: string | null;
  readonly doors: number;
  readonly since: string | null;
}

/** Shut doors of one kind that are shut for the same reason are one line, largest first; the earliest shut date leads. */
export function shutDoorGroups(rows: readonly DoorRowView[]): ShutDoorGroup[] {
  const groups = new Map<string, { kind: string; why: string | null; doors: number; since: string | null }>();
  for (const row of rows) {
    if (row.status !== "Shut") continue;
    const key = `${row.kind}\u0000${row.why ?? ""}`;
    const group = groups.get(key) ?? { kind: row.kind, why: row.why, doors: 0, since: null };
    group.doors += 1;
    if (row.since && (!group.since || row.since < group.since)) group.since = row.since;
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => b.doors - a.doors || a.kind.localeCompare(b.kind));
}

/** The doors in one sentence: how many are open and shut, and how many could not be read. */
export function doorsInWords(counts: DoorsView["counts"]): string {
  const parts = [`${count(counts.open)} ${counts.open === 1 ? "door is" : "doors are"} open`, `${count(counts.shut)} ${counts.shut === 1 ? "is" : "are"} shut`];
  if (counts.setAside) parts.push(`${count(counts.setAside)} ${counts.setAside === 1 ? "is" : "are"} set aside`);
  const last = parts.pop()!;
  return `${parts.join(", ")} and ${last}.${counts.unreadable ? ` ${count(counts.unreadable)} could not be read.` : ""}`;
}

export function DoorsPanel() {
  const { reading, reload } = useReading<DoorsView>("/api/admin/v6/doors", 60_000);
  const data = reading.kind === "ready" ? reading.data : null;
  const shut = data ? shutDoorGroups(data.rows) : [];
  return (
    <Card title="Doors" id="doors">
      {reading.kind === "loading" && <Loading what="the doors" />}
      {reading.kind === "failed" && <p className={s.p}>— <button type="button" className={s.btn} onClick={reload}>Try again</button></p>}
      {data && (
        <div className={s.stack}>
          <p className={s.p}>{doorsInWords(data.counts)}</p>
          {!data.rows.length && <Empty>No doors yet</Empty>}
          {!!shut.length && (
            <ul className={s.stack} style={{ listStyle: "none", padding: 0, margin: 0, gap: 6 }} aria-label="Shut doors, by reason">
              {shut.map((g) => (
                <li key={`${g.kind}:${g.why ?? ""}`} className={s.row}>
                  <span className={s.spread}>
                    <strong style={{ fontSize: 13 }}>{count(g.doors)} {g.kind} {g.doors === 1 ? "door is" : "doors are"} shut</strong>
                    <Pill tone="warn">Shut</Pill>
                  </span>
                  <span className={s.small}>{g.why ?? "No reason is recorded."}</span>
                  {g.since && <span className={s.meta}>{g.doors === 1 ? "Shut" : "The first shut"} {mst(g.since)}</span>}
                </li>
              ))}
            </ul>
          )}
          {!!data.rows.length && (
            <details className={s.details}>
              <summary>Technical details</summary>
              <div className={s.stack} style={{ marginTop: 8 }}>
                <div className={s.inline}>
                  <Pill tone="good">{count(data.counts.open)} open</Pill>
                  <Pill tone={data.counts.shut ? "warn" : "neutral"}>{count(data.counts.shut)} shut</Pill>
                  <Pill tone="neutral">{count(data.counts.setAside)} set aside</Pill>
                  {data.counts.unreadable > 0 && <Pill tone="warn">{count(data.counts.unreadable)} unreadable</Pill>}
                </div>
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
                {data.total > data.rows.length && <p className={cx(s.p, s.small)}>Showing {count(data.rows.length)} of {count(data.total)} doors</p>}
                {!!data.changes.length && (
                  <div className={s.stack} style={{ gap: 4 }}>
                    <strong className={s.small}>Latest door changes</strong>
                    {data.changes.map((c, n) => <p key={`${c.at}-${n}`} className={cx(s.p, s.small)}>{mst(c.at)} · {c.says}</p>)}
                  </div>
                )}
              </div>
            </details>
          )}
          <p className={cx(s.p, s.meta)}>Read {mst(data.observedAt)}</p>
        </div>
      )}
    </Card>
  );
}
