"use client";

/**
 * **SCOREBOARD.** One card per number with its value and the counts behind it; a number we do not have shows "—" and says why.
 * Rows are never added together. The launch-gate health checks and readiness counts sit in their own groups, then the
 * weekly learning series that used to be "Is it learning".
 */
import { WeeklyColumns } from "./charts.tsx";
import { useV6 } from "./context.tsx";
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
  const v = useV6();
  const b = v.data.scoreboard.data;
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
                {r.items && r.items.length > 0 && <ul className={s.meta}>{r.items.map((item, i) => <li key={i}>{item}</li>)}</ul>}
                <Technical lines={[r.id, ...(r.notMeasured ? [r.says] : []), ...(r.technical ?? [])]} />
              </Card>
            ))}
          </section>
          <Card title="Where the flow stopped">
            {b.flow ? <details><summary className={s.btnLink}>Show measured stages by hour</summary><div className={s.tableWrap}><table className={s.table}>
              <thead><tr><th>Hour (Eastern)</th><th>Findings</th><th>Built</th><th>Checked</th><th>Live</th></tr></thead>
              <tbody>{[...b.flow.hours].reverse().map(h => <tr key={h.hour}><th scope="row">{mst(h.hour)}</th><td>{h.findings}</td><td>{h.builtFindings}</td><td>{h.checkedRecords}</td><td>{h.liveRecords}</td></tr>)}</tbody>
            </table></div></details> : <span className={s.big}>—</span>}
          </Card>
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
