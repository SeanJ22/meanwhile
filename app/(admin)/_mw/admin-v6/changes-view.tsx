"use client";

/**
 * **CHANGES — one plain line for each change any session has made, and where it
 * has got to.** (S11; rulings §0 test 5: Sean can see what is happening.)
 *
 * Building, on test, deploying, live. Each line links to the pull request. The
 * list is read from GitHub on the server (`lib/control-plane/changes/source.ts`),
 * cached for a minute, and fetched when this view opens. When GitHub cannot be
 * read the view says so and says what fixes it; it never shows an empty list as
 * "nothing changed".
 */
import { CHANGE_STATUSES, CHANGE_STATUS_MEANING, CHANGE_STATUS_WORDS, groupChanges, type ChangeRow } from "@/lib/control-plane/changes/model.ts";
import type { ChangesReading } from "@/lib/control-plane/changes/source.ts";

import { mst } from "./model.ts";
import { Card, cx, Empty, Failed, Loading } from "./ui.tsx";
import { useReading } from "./use-reading.ts";
import s from "./v6.module.css";

/** The live list is the newest of a long history; the rest is on GitHub. */
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
        <p className={cx(s.p, s.small, s.dim)}>One line for each change from any session, newest first, with where it has got to.</p>
      </header>
      {reading.kind === "loading" && <Loading what="the changes" />}
      {reading.kind === "failed" && <Failed what="The changes" retry={reload} />}
      {reading.kind === "ready" && reading.data.kind === "UNAVAILABLE" && (
        <Card title="The changes could not be read">
          <p className={s.p}>{reading.data.reason}</p>
          {reading.data.fix && <p className={cx(s.p, s.small, s.dim)}>{reading.data.fix}</p>}
          <p className={cx(s.p, s.meta)}>Nothing here means nothing changed. It means this view could not look. Checked {mst(reading.data.observedAt)}.</p>
        </Card>
      )}
      {reading.kind === "ready" && reading.data.kind === "OBSERVED" && (() => {
        const groups = groupChanges(reading.data.rows);
        return (
          <>
            <p className={cx(s.p, s.meta)}>
              Read from GitHub {mst(reading.data.observedAt)}
              {reading.data.liveSha ? `; the live site is running build ${reading.data.liveSha.slice(0, 7)}` : "; what the live site is running could not be read"}.
              {reading.stale ? " The latest attempt to refresh failed, so this is the last good reading." : ""}
            </p>
            {CHANGE_STATUSES.map((status) => (
              <Card key={status} id={`changes-${status}`} title={<>{CHANGE_STATUS_WORDS[status]} <span className={s.meta}>({groups[status].length})</span></>}>
                <p className={cx(s.p, s.small, s.dim)}>{CHANGE_STATUS_MEANING[status]}</p>
                {groups[status].length === 0 ? (
                  <Empty>None right now.</Empty>
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
