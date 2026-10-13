"use client";

import type { CaptureHealthView } from "@/lib/control-plane/admin-view/v6-capture-health.ts";

import { mst } from "./model.ts";
import { Card, cx, Empty, Loading, Pill } from "./ui.tsx";
import { useReading } from "./use-reading.ts";
import s from "./v6.module.css";

const n = (v: number) => v.toLocaleString("en-US");
const percentWords = (p: number | null) => (p === null ? "—" : `${p}%`);
const dayShort = (d: string) => d.slice(5);
const TYPE_WORDS: Readonly<Record<string, string>> = { ASK: "Questions asked", ZIP_VIEW: "ZIP views", CARD_OPEN: "Cards opened", CARD_VISIBLE: "Time cards were visible", ACTIVE_SCROLL: "Active scrolling", AGENDA_VIEW: "Agenda views", REACTION: "Reactions", BALLOT_PICK: "Ballot picks" };
const ROW_HEAD = { textTransform: "none", fontSize: 13, color: "var(--text)" } as const;

function Unread() {
  return <Empty>—</Empty>;
}

export function CaptureHealthPanel() {
  const { reading, reload } = useReading<CaptureHealthView | { readonly says: string }>("/api/admin/v6/data/capture", 60_000);
  const v = reading.kind === "ready" && "headline" in reading.data ? reading.data : null;
  const tone = v === null ? "neutral" : v.headline.state === "recording" ? "good" : v.headline.state === "unknown" ? "neutral" : "warn";
  return (
    <Card title="Is capture working?" id="capture-health">
      {reading.kind === "loading" && <Loading what="capture health" />}
      {reading.kind === "failed" && <p className={s.p}>— <button type="button" className={s.btn} onClick={reload}>Try again</button></p>}
      {v && (
        <div className={s.stack}>
          <p className={s.p}><Pill tone={tone}>{v.headline.state === "recording" ? "Recording" : v.headline.state === "quiet" ? "Quiet" : v.headline.state === "none" ? "Nothing yet" : "Unknown"}</Pill> {v.headline.says}</p>

          <h3 className={s.h3}>Events per day, by type</h3>
          {v.byType.kind !== "READ" ? <Unread /> : !v.byType.rows.length ? <Empty>{`No events were recorded in these ${v.days.length} days.`}</Empty> : (
            <div className={s.tableWrap}>
              <table className={s.table}>
                <thead><tr><th scope="col">Type</th>{v.days.map((d) => <th key={d} scope="col" className={s.num}>{dayShort(d)}</th>)}<th scope="col" className={s.num}>Total</th></tr></thead>
                <tbody>{v.byType.rows.map((r) => (
                  <tr key={r.type}><th scope="row" style={ROW_HEAD}>{TYPE_WORDS[r.type] ?? r.type}</th>{r.perDay.map((c, i) => <td key={v.days[i]} className={s.num}>{n(c)}</td>)}<td className={s.num}>{n(r.total)}</td></tr>
                ))}</tbody>
              </table>
            </div>
          )}

          <h3 className={s.h3}>Questions sorted into a topic, and free-form</h3>
          {v.topics.kind !== "READ" ? <Unread /> : (
            <div className={s.tableWrap}>
              <table className={s.table}>
                <thead><tr><th scope="col">Day</th><th scope="col" className={s.num}>In a topic</th><th scope="col" className={s.num}>Free-form</th><th scope="col" className={s.num}>Share in a topic</th></tr></thead>
                <tbody>{[...v.topics.rows].reverse().map((r) => <tr key={r.day}><th scope="row" style={ROW_HEAD}>{r.day}</th><td className={s.num}>{n(r.inTopic)}</td><td className={s.num}>{n(r.freeForm)}</td><td className={s.num}>{percentWords(r.percentInTopic)}</td></tr>)}</tbody>
              </table>
            </div>
          )}

          <h3 className={s.h3}>New and returning readers</h3>
          {v.readers.kind !== "READ" ? <Unread /> : (
            <div className={s.tableWrap}>
              <table className={s.table}>
                <thead><tr><th scope="col">Day</th><th scope="col" className={s.num}>Readers</th><th scope="col" className={s.num}>New</th><th scope="col" className={s.num}>Returning</th></tr></thead>
                <tbody>{[...v.readers.rows].reverse().map((r) => <tr key={r.day}><th scope="row" style={ROW_HEAD}>{r.day}</th><td className={s.num}>{n(r.readers)}</td><td className={s.num}>{n(r.newReaders)}</td><td className={s.num}>{n(r.returning)}</td></tr>)}</tbody>
              </table>
            </div>
          )}

          <h3 className={s.h3}>{v.districts.kind === "READ" ? `Usage by district, week of ${v.districts.rows.week}` : "Usage by district"}</h3>
          {v.districts.kind !== "READ" ? <Unread /> : !v.districts.rows.rows.length ? <Empty>No district was recorded this week.</Empty> : (
            <div className={s.tableWrap}>
              <table className={s.table}>
                <thead><tr><th scope="col">District</th><th scope="col">State</th><th scope="col" className={s.num}>Events</th><th scope="col" className={s.num}>Readers</th><th scope="col" className={s.num}>Share of events</th><th scope="col" className={s.num}>Population estimate</th></tr></thead>
                <tbody>{v.districts.rows.rows.map((r) => <tr key={`${r.state}|${r.label}`}><th scope="row" style={ROW_HEAD}>{r.label}</th><td>{r.state}</td><td className={s.num}>{n(r.events)}</td><td className={s.num}>{r.readers === null ? "—" : n(r.readers)}</td><td className={s.num}>{percentWords(r.percent)}</td><td className={s.num}>{r.population ? `${n(r.population.population)}${r.population.marginOfError === null ? "" : ` ± ${n(r.population.marginOfError)}`}` : "—"}</td></tr>)}</tbody>
              </table>
            </div>
          )}

          <h3 className={s.h3}>Did anything fail to record?</h3>
          {v.failures.kind === "UNAVAILABLE" ? <Empty>—</Empty> : (
            <div className={s.stack} style={{ gap: 6 }}>
              {v.failures.lines.map((l) => <p key={l.says} className={s.p}><Pill tone={l.ok ? "good" : "warn"}>{l.ok ? "Fine" : "Check"}</Pill> {l.says}</p>)}
            </div>
          )}
          <p className={cx(s.p, s.meta)}>Read {mst(v.observedAt)}, UTC days {v.from} to {v.to}</p>
          <div><p className={s.meta}>Population data from</p><ul>{v.districts.kind === "READ" && [...new Map(v.districts.rows.rows.flatMap(row => row.population ? [[row.population.attribution.citationUrl ?? row.population.attribution.sourceUrl, { ...row.population.attribution, label: row.population.name }] as const] : [])).values()].map(source => <li key={source.citationUrl ?? source.sourceUrl}><a href={source.citationUrl ?? source.sourceUrl}>{source.sourceOrg} · {source.label}</a> · Official · ACS {source.period} · Publication date {source.publishedAt?.slice(0, 10) ?? "—"} · Checked {source.retrievedAt.slice(0, 10)}</li>)}</ul></div>
        </div>
      )}
      {reading.kind === "ready" && !v && <Empty>—</Empty>}
    </Card>
  );
}
