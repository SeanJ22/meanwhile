"use client";

import { CHANGE_STATUSES, CHANGE_STATUS_WORDS, groupChanges, type ChangeRow } from "@/lib/control-plane/changes/model.ts";
import type { ChangesReading } from "@/lib/control-plane/changes/source.ts";

import { mst } from "./model.ts";
import { Card, cx, Empty, Failed, Loading } from "./ui.tsx";
import { useReading } from "./use-reading.ts";
import s from "./v6.module.css";

const LIVE_SHOWN = 20;

function Line({ row }: { readonly row: ChangeRow }) {
  return (
    <li>
      <a href={row.url} rel="noreferrer" target="_blank">{row.line}</a>
      <span className={cx(s.meta)}> · {row.session ? `${row.session} · ` : ""}{row.why} · {mst(row.at)}</span>
    </li>
  );
}

export function ChangesView() {
  const { reading, reload } = useReading<ChangesReading>("/api/admin/changes");
  return (
    <>
      <header>
        <p className={s.eyebrow}>Every session</p>
        <h1 className={s.h1}>Changes</h1>
      </header>
      {reading.kind === "loading" && <Loading what="the changes" />}
      {reading.kind === "failed" && <Failed what="The changes" retry={reload} />}
      {reading.kind === "ready" && reading.data.kind === "UNAVAILABLE" && (
        <Card title="Changes">
          <p className={s.p}>—</p>
          <p className={cx(s.p, s.meta)}>Checked {mst(reading.data.observedAt)}</p>
        </Card>
      )}
      {reading.kind === "ready" && reading.data.kind === "OBSERVED" && (() => {
        const groups = groupChanges(reading.data.rows);
        return (
          <>
            <p className={cx(s.p, s.meta)}>
              Read {mst(reading.data.observedAt)} · Live build {reading.data.liveSha ? reading.data.liveSha.slice(0, 7) : "—"}
            </p>
            {CHANGE_STATUSES.map((status) => (
              <Card key={status} id={`changes-${status}`} title={<>{CHANGE_STATUS_WORDS[status]} <span className={s.meta}>({groups[status].length})</span></>}>
                {groups[status].length === 0 ? (
                  <Empty>None</Empty>
                ) : (
                  <ul>{(status === "live" ? groups[status].slice(0, LIVE_SHOWN) : groups[status]).map((row) => <Line key={row.number} row={row} />)}</ul>
                )}
              </Card>
            ))}
          </>
        );
      })()}
    </>
  );
}
