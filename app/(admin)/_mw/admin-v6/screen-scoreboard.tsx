"use client";

import { WeeklyColumns } from "./charts.tsx";
import { useKeeperScoreboard } from "./use-keeper-scoreboard.ts";
import type { ScoreboardGateRow } from "./model.ts";
import { mst } from "./model.ts";
import { Card, cx, Empty, Technical } from "./ui.tsx";
import s from "./v6.module.css";

const GATE_WORDS: Readonly<Record<ScoreboardGateRow["state"], { readonly words: string; readonly tone: string }>> = {
  pass: { words: "Fine", tone: "tone-good" },
  attention: { words: "Needs a look", tone: "tone-warn" },
  not_measured: { words: "Not measured", tone: "tone-neutral" },
};

export function ScoreboardScreen() {
  const b = useKeeperScoreboard();
  return (
    <>
      <header>
        <p className={s.eyebrow}>All tracked states</p>
        <h1 className={s.h1}>Scoreboard</h1>
      </header>
      {!b && <Card title="Numbers"><span className={s.big}>—</span></Card>}
      {b && (
        <>
          <section aria-label="Numbers" className={s.grid3}>
            {b.rows.map((r) => (
              <Card key={r.id} title={r.name}>
                <div><span className={s.big}>{r.value ?? "—"}</span></div>
                {r.counts && <p className={s.meta}>{r.counts}</p>}
                <p className={s.meta}>{r.notMeasured ?? r.says}</p>
                {r.trend && r.trend.some((t) => t.value !== null) && (
                  <p className={s.meta}>Last seven days: {r.trend.map((t) => `${t.label} ${t.value === null ? "—" : Math.round(t.value * 100) / 100}`).join(" · ")}</p>
                )}
                {r.items && r.items.length > 0 && <ul className={s.meta}>{r.items.map((item, i) => <li key={i}>{item}</li>)}</ul>}
                {r.images && r.images.length > 0 && (
                  <div className={s.meta}>{r.images.map((im, i) => (
                    <a key={i} href={im.src} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={im.src} alt={`Screenshot: ${im.label}`} width={96} loading="lazy" />
                    </a>
                  ))}</div>
                )}
                <Technical lines={[r.id, ...(r.notMeasured ? [r.says] : []), ...(r.technical ?? [])]} />
              </Card>
            ))}
          </section>
          {b.byPlace.length > 0 && (
            <Card title="Completeness, by sent place">
              <div className={s.tableWrap}>
                <table className={s.table}>
                  <thead><tr><th scope="col">Place</th><th scope="col">Held of owed</th><th scope="col">Current of held</th><th scope="col">Published and seen</th><th scope="col">Against an earlier day</th></tr></thead>
                  <tbody>{b.byPlace.map((p) => (
                    <tr key={p.label}><td>{p.label}</td><td>{p.completeness.n} of {p.completeness.of}</td><td>{p.freshness.n} of {p.freshness.of}</td><td>{p.delivery.n} of {p.delivery.of}</td><td>{p.trend}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            </Card>
          )}
          {b.byFamily.length > 0 && (
            <Card title="Completeness, by kind of information">
              <div className={s.tableWrap}>
                <table className={s.table}>
                  <thead><tr><th scope="col">Kind</th><th scope="col">Held of owed, across the sent places</th></tr></thead>
                  <tbody>{b.byFamily.map((f) => <tr key={f.name}><td>{f.name}</td><td>{f.completeness.n} of {f.completeness.of}</td></tr>)}</tbody>
                </table>
              </div>
            </Card>
          )}
          <Card title="Time to core information live, by mission">
            {b.missions.length === 0 && <Empty>—</Empty>}
            {b.missions.length > 0 && (
              <div className={s.tableWrap}>
                <table className={s.table}>
                  <thead><tr><th scope="col">Mission</th><th scope="col">Started</th><th scope="col">Core information live</th><th scope="col">Within an hour</th></tr></thead>
                  <tbody>{b.missions.map((m) => <tr key={m.label}><td>{m.label}</td><td>{mst(m.startedAt)}</td><td>{m.coreLive}</td><td>{m.withinHour === null ? "—" : m.withinHour ? "Yes" : "No"}</td></tr>)}</tbody>
                </table>
              </div>
            )}
          </Card>
          {b.flow && (
            <Card title="Where the flow stopped">
              <p className={s.meta}>Each day, how many findings came in, were built, passed the check and went live. A drop at one stage shows where something is slow. A dash is a day nothing was recorded.</p>
              <div className={s.tableWrap}>
                <table className={s.table}>
                  <thead><tr><th scope="col">Day</th><th scope="col">Findings in</th><th scope="col">Built</th><th scope="col">Passed the check</th><th scope="col">Live</th></tr></thead>
                  <tbody>{b.flow.map((d) => <tr key={d.label}><td>{d.label}</td><td>{d.findings ?? "—"}</td><td>{d.built ?? "—"}</td><td>{d.checked ?? "—"}</td><td>{d.live ?? "—"}</td></tr>)}</tbody>
                </table>
              </div>
            </Card>
          )}
          <Card title="Launch checks" aside={b.gates ? <span className={s.pill}>{`${b.gates.pass} fine · ${b.gates.attention} need a look · ${b.gates.notMeasured} not measured`}</span> : undefined}>
            {!b.gates && <span className={s.big}>—</span>}
            {b.gates && (
              <div className={s.tableWrap}>
                <table className={s.table}>
                  <thead><tr><th scope="col">Check</th><th scope="col">State</th><th scope="col">What was read</th></tr></thead>
                  <tbody>{b.gates.rows.map((g) => (
                    <tr key={g.name}><td>{g.name}</td><td><span className={cx(s.pill, s[GATE_WORDS[g.state].tone])}>{GATE_WORDS[g.state].words}</span></td><td>{g.sentence}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </Card>
          {b.readiness.length > 0 && (
            <Card title="Readiness, counted apart from what places are owed">
              <div className={s.tableWrap}>
                <table className={s.table}>
                  <thead><tr><th scope="col">Group</th><th scope="col">Working</th><th scope="col">Failing</th><th scope="col">Not measured</th></tr></thead>
                  <tbody>{b.readiness.map((g) => (
                    <tr key={g.name}><td>{g.name}</td><td>{g.witnessed} of {g.of}</td><td>{g.failing} of {g.of}</td><td>{g.notMeasured} of {g.of}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            </Card>
          )}
          <section aria-label="Weekly trends" className={s.grid3}>
            {b.learning.trends.map((t) => (
              <Card key={t.question} title={t.question} aside={<span className={cx(s.pill, s["tone-good"])}>Measured weekly</span>}>
                <div><span className={s.big}>{t.big}</span> <span className={s.meta}>{t.bigNote}</span></div>
                <WeeklyColumns trend={t} />
              </Card>
            ))}
          </section>
          <section aria-label="Single readings" className={s.grid3}>
            {b.learning.readings.map((r) => (
              <Card key={r.question} title={r.question} aside={<span className={s.pill}>One reading</span>}>
                <div><span className={s.big}>{r.big}</span> <span className={s.meta}>{r.bigNote}</span></div>
              </Card>
            ))}
          </section>
        </>
      )}
    </>
  );
}
