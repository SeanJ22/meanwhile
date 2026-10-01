"use client";

/**
 * **WHAT READERS ARE ASKING FOR — a panel on Now.** Where people looked, which
 * governments, meetings and officials they opened, what they asked, and what they
 * pressed "get this sooner" on. Counts of events, never a person: there is no
 * reader, session or device in the store, so there is nothing to show per reader.
 * It is the map of what to cover next.
 */
import type { DemandList, ReaderDemandReading } from "@/lib/control-plane/reader-demand.ts";

import { mst } from "./model.ts";
import { Card, cx, Empty, Failed, Loading } from "./ui.tsx";
import { useReading } from "./use-reading.ts";
import s from "./v6.module.css";

function Top({ caption, list, none }: { readonly caption: string; readonly list: DemandList; readonly none: string }) {
  return (
    <div>
      <h3 className={s.h3}>{caption}</h3>
      {list.rows.length === 0 ? (
        <Empty>{none}</Empty>
      ) : (
        <ol>
          {list.rows.map((row) => (
            <li key={row.key}>{row.label} <span className={s.meta}>· {row.count.toLocaleString("en-US")}</span></li>
          ))}
        </ol>
      )}
      {list.distinct > list.rows.length && <p className={cx(s.p, s.meta)}>{list.distinct.toLocaleString("en-US")} different in all.</p>}
      {(list.unnamed ?? 0) > 0 && <p className={cx(s.p, s.meta)}>{list.unnamed} of the most-opened {list.unnamed === 1 ? "has" : "have"} no name on file yet and {list.unnamed === 1 ? "is" : "are"} not listed.</p>}
    </div>
  );
}

export function ReaderDemandPanel() {
  const { reading, reload } = useReading<ReaderDemandReading>("/api/admin/reader-demand", 5 * 60_000);
  return (
    <Card title="What readers are asking for" id="reader-demand">
      {reading.kind === "loading" && <Loading what="what readers looked up" />}
      {reading.kind === "failed" && <Failed what="What readers looked up" retry={reload} />}
      {reading.kind === "ready" && reading.data.kind === "NOT_READ" && (
        <>
          <p className={s.p}>{reading.data.says}</p>
          <p className={cx(s.p, s.meta)}>Nothing here is a count of zero. It means nothing was counted. Checked {mst(reading.data.observedAt)}.</p>
        </>
      )}
      {reading.kind === "ready" && reading.data.kind === "READ" && (
        <>
          <p className={cx(s.p, s.small, s.dim)}>
            {reading.data.organicEvents.toLocaleString("en-US")} things readers did in the last {reading.data.days} days (visits by us and our tests, {reading.data.otherEvents.toLocaleString("en-US")}, are left out).
            Counts of events, never of people.
          </p>
          <div className={s.grid3}>
            <Top caption="Most-entered ZIPs" list={reading.data.zips} none="No ZIP was entered in this window." />
            <Top caption="Most-touched districts" list={reading.data.districts} none="No district was touched in this window." />
            <Top caption="Most-opened meetings" list={reading.data.meetings} none="No meeting was opened in this window." />
            <Top caption="Most-opened officials" list={reading.data.officials} none="No official was opened in this window." />
            <Top caption="What people asked about" list={reading.data.askTopics} none="No question was recorded in this window." />
            <Top caption={`Wanted sooner (${reading.data.wantedSoonerTotal.toLocaleString("en-US")} presses)`} list={reading.data.wantedSooner} none="No one pressed “get this sooner”." />
          </div>
          <p className={cx(s.p, s.meta)}>Read {mst(reading.data.observedAt)}.{reading.stale ? " The latest refresh failed, so this is the last good reading." : ""}</p>
        </>
      )}
    </Card>
  );
}
