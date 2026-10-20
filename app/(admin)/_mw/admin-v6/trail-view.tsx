"use client";

import { useCallback, useState } from "react";

import { EvidenceCopyControl } from "../evidence-copy-control.tsx";
import { mst, type ReachedView, type TrailView } from "./model.ts";
import { cx, Empty, Pill, Technical } from "./ui.tsx";
import s from "./v6.module.css";

type Load<T> = { readonly state: "idle" } | { readonly state: "loading" } | { readonly state: "held"; readonly data: T } | { readonly state: "unread" };

/** One click, one read. A refusal shows "—"; nothing is retried on a timer. */
function useOnDemand<T>(href: string): readonly [Load<T>, () => void] {
  const [load, setLoad] = useState<Load<T>>({ state: "idle" });
  const run = useCallback(() => {
    setLoad({ state: "loading" });
    fetch(href, { credentials: "same-origin", cache: "no-store", headers: { accept: "application/json" } })
      .then(async (response) => {
        const body = await response.json().catch(() => null) as { data?: T } | null;
        if (response.ok && body?.data !== undefined) setLoad({ state: "held", data: body.data });
        else setLoad({ state: "unread" });
      })
      .catch(() => setLoad({ state: "unread" }));
  }, [href]);
  return [load, run];
}

const STAGE_WORDS: Readonly<Record<TrailView["events"][number]["stage"], string>> = {
  SOURCE: "Source", ATTEMPT: "Attempt", SAVED: "Saved", EXTRACTED: "Extracted", CHECKED: "Checked", PUBLISHED: "Published", READER: "On the page",
};

interface FreshnessIncidentPage {
  readonly cycleId: string;
  readonly page: number;
  readonly rows: readonly { readonly cause: string; readonly target: string; readonly obligationsAffected: number; readonly nextRetryAt?: string }[];
  readonly total: number;
  readonly nextPage: number | null;
}

type FreshnessHistorySection = "runtimeConditions" | "lines" | "assignments";
interface FreshnessHistoryPage {
  readonly cycleId: string;
  readonly page: number;
  readonly rows: readonly (string | { readonly key: string; readonly label?: string | null;
    readonly members: { readonly created: number; readonly reordered: number } })[];
  readonly total: number;
  readonly nextPage: number | null;
  readonly unavailable?: string | null;
}
const HISTORY_LABELS = {
  runtimeConditions: { button: "Show all runtime conditions", noun: "runtime conditions" },
  lines: { button: "Show the full cycle log", noun: "cycle log lines" },
  assignments: { button: "Show all Sends", noun: "Sends" },
} as const;

/** Exact history is requested only when opened, with one pinned page in memory. */
export function FreshnessHistoryDetails({ cycleId, section }: { readonly cycleId: string; readonly section: FreshnessHistorySection }) {
  const [load, setLoad] = useState<Load<FreshnessHistoryPage>>({ state: "idle" });
  const read = useCallback(async (page: number) => {
    setLoad({ state: "loading" });
    try {
      const response = await fetch(`/api/admin/v6/freshness-report?cycleId=${encodeURIComponent(cycleId)}&section=${section}&page=${page}`,
        { credentials: "same-origin", cache: "no-store", headers: { accept: "application/json" } });
      if (!response.ok) throw new Error("Report unavailable");
      const data = await response.json() as FreshnessHistoryPage;
      if (data.cycleId !== cycleId || data.page !== page || !Array.isArray(data.rows) || data.rows.length > 32) throw new Error("Report page differs");
      setLoad({ state: "held", data });
    } catch { setLoad({ state: "unread" }); }
  }, [cycleId, section]);
  return <div className={s.stack}>
    {(load.state === "idle" || load.state === "unread") && <button type="button" className={s.btnLink} onClick={() => void read(0)}>{HISTORY_LABELS[section].button}</button>}
    {load.state === "loading" && <span role="status">Reading…</span>}
    {load.state === "unread" && <span>—</span>}
    {load.state === "held" && <>
      <p>{load.data.total.toLocaleString("en-US")} {HISTORY_LABELS[section].noun} · page {load.data.page + 1}</p>
      {load.data.unavailable && <p>{load.data.unavailable}</p>}
      <ul>{load.data.rows.map((row, i) => <li key={i}>
        {typeof row === "string" ? <code style={{ overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>{row || "\u00a0"}</code> :
          <><code style={{ overflowWrap: "anywhere" }}>{row.label ?? row.key}</code> · {row.members.created} created · {row.members.reordered} moved up</>}
      </li>)}</ul>
      <div className={s.inline}>
        {load.data.page > 0 && <button type="button" className={s.btnLink} onClick={() => void read(load.data.page - 1)}>Previous</button>}
        {load.data.nextPage !== null && <button type="button" className={s.btnLink} onClick={() => void read(load.data.nextPage!)}>Next</button>}
      </div>
    </>}
  </div>;
}

/** A click reads one page; moving through a report replaces the previous page. */
export function FreshnessIncidentDetails({ cycleId }: { readonly cycleId: string }) {
  const [load, setLoad] = useState<Load<FreshnessIncidentPage>>({ state: "idle" });
  const read = useCallback(async (page: number) => {
    setLoad({ state: "loading" });
    try {
      const response = await fetch(`/api/admin/v6/freshness-report?cycleId=${encodeURIComponent(cycleId)}&page=${page}`,
        { credentials: "same-origin", cache: "no-store", headers: { accept: "application/json" } });
      if (!response.ok) throw new Error("Report unavailable");
      setLoad({ state: "held", data: await response.json() as FreshnessIncidentPage });
    } catch { setLoad({ state: "unread" }); }
  }, [cycleId]);
  return <div className={s.stack}>
    {(load.state === "idle" || load.state === "unread") && <button type="button" className={s.btnLink} onClick={() => void read(0)}>Show exact incident targets</button>}
    {load.state === "loading" && <span role="status">Reading…</span>}
    {load.state === "unread" && <span>—</span>}
    {load.state === "held" && <>
      <p>{load.data.total.toLocaleString("en-US")} incidents · page {load.data.page + 1}</p>
      <ul>{load.data.rows.map((row, i) => <li key={i}>
        <code style={{ overflowWrap: "anywhere" }}>{row.cause} · {row.target}</code> · {row.obligationsAffected} affected
        {row.nextRetryAt && <> · next retry {mst(row.nextRetryAt)}</>}
      </li>)}</ul>
      <div className={s.inline}>
        {load.data.page > 0 && <button type="button" className={s.btnLink} onClick={() => void read(load.data.page - 1)}>Previous</button>}
        {load.data.nextPage !== null && <button type="button" className={s.btnLink} onClick={() => void read(load.data.nextPage!)}>Next</button>}
      </div>
    </>}
    <FreshnessHistoryDetails cycleId={cycleId} section="runtimeConditions" />
    <FreshnessHistoryDetails cycleId={cycleId} section="lines" />
    <FreshnessHistoryDetails cycleId={cycleId} section="assignments" />
  </div>;
}

export function EvidenceTrail(props: { readonly id: string; readonly label?: string }) {
  const [load, run] = useOnDemand<TrailView>(`/api/admin/v6/trail?scope=us&item=${encodeURIComponent(props.id)}`);
  return (
    <div className={s.stack}>
      {load.state === "idle" && <div className={s.inline}><button type="button" className={s.btnLink} onClick={run}>{props.label ? props.label : "Show the evidence trail"}</button></div>}
      {load.state === "loading" && <span className={s.meta} role="status">Reading…</span>}
      {load.state === "unread" && <span className={s.small}>—</span>}
      {load.state === "held" && (
        <>
          <p className={cx(s.p, s.meta)}>{load.data.events.length + load.data.eventsHidden} steps</p>
          {!load.data.events.length && <Empty>No steps</Empty>}
          {load.data.events.map((e) => (
            <div key={e.id} className={s.row}>
              <div className={s.spread}><strong style={{ fontSize: 13 }}>{e.title}</strong><Pill tone={e.stage === "READER" || e.stage === "PUBLISHED" ? "good" : "slate"}>{STAGE_WORDS[e.stage]}</Pill></div>
              <span className={s.meta}>{e.at ? mst(e.at) : "time not recorded"}</span>
              <span className={s.small}>{e.says}</span>
              {e.nextAction && <span className={s.small}><span className={s.dim}>Next:</span> {e.nextAction}</span>}
              {e.sourceUrl && <a className={s.small} href={e.sourceUrl} target="_blank" rel="noreferrer noopener">Official source ↗</a>}
              {e.publicUrl && <a className={s.small} href={e.publicUrl} target="_blank" rel="noreferrer noopener">The public page ↗</a>}
              {e.privateCopy && <EvidenceCopyControl path={e.privateCopy.path} byteLength={e.privateCopy.byteLength} />}
              <Technical lines={e.references.map(([k, v]) => `${k}: ${v}`)} />
            </div>
          ))}
          {load.data.eventsHidden > 0 && <span className={s.meta}>{load.data.eventsHidden} older steps</span>}
        </>
      )}
    </div>
  );
}

const RELATION_WORDS = { created: "Created by this send", reordered: "Already on a clock; moved up", other: "Marked by this send" } as const;

export function WorkReached(props: { readonly sendId: string }) {
  const [load, run] = useOnDemand<ReachedView>(`/api/admin/v6/trail?scope=us&send=${encodeURIComponent(props.sendId)}`);
  return (
    <div className={s.stack}>
      {load.state === "idle" && <div className={s.inline}><button type="button" className={s.btnLink} onClick={run}>Show the work it reached</button></div>}
      {load.state === "loading" && <span className={s.meta} role="status">Reading…</span>}
      {load.state === "unread" && <span className={s.small}>—</span>}
      {load.state === "held" && (
        <>
          <p className={cx(s.p, s.meta)}>{load.data.total === 0 ? "No items" : `${load.data.total.toLocaleString("en-US")} items`}</p>
          {load.data.rows.map((r) => (
            <details key={r.id} className={s.row}>
              <summary className={s.small}><strong>{r.label}</strong> · {RELATION_WORDS[r.relation]}{r.at ? ` · ${mst(r.at)}` : ""}</summary>
              <EvidenceTrail id={r.id} />
            </details>
          ))}
        </>
      )}
    </div>
  );
}
