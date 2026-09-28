"use client";

/**
 * **IS IT LEARNING.** Three weekly trends in an even grid, three single
 * readings in a row, a compact "not measured yet" table, and how each is
 * measured (with the numbers as a table) behind a disclosure.
 */
import { WeeklyColumns } from "./charts.tsx";
import { useV6 } from "./context.tsx";
import { Card, cx, Facts, SourceNote } from "./ui.tsx";
import s from "./v6.module.css";

export function LearningScreen() {
  const v = useV6();
  const l = v.data.learning.data;
  return (
    <>
      <header>
        <p className={s.eyebrow}>All tracked states</p>
        <h1 className={s.h1}>Is it learning</h1>
        <p className={cx(s.p, s.small, s.dim)}>Does the system get cheaper, faster and more reliable as it works? Each figure says what it counts, where, when, and out of how many.</p>
      </header>
      <SourceNote source={v.data.learning} what="Learning figures" />
      {l && (
        <>
          <section aria-label="Weekly trends" className={s.grid3}>
            {l.trends.map((t) => (
              <Card key={t.question} title={t.question} aside={<span className={cx(s.pill, s["tone-good"])}>Measured weekly</span>}>
                <div><span className={s.big}>{t.big}</span> <span className={s.meta}>{t.bigNote}</span></div>
                <WeeklyColumns trend={t} />
                <p className={cx(s.p, s.meta)}>{t.limits}</p>
                <details className={s.details}><summary>How this is measured</summary><Facts rows={t.method.map((m) => [m.k, m.v] as const)} /></details>
              </Card>
            ))}
          </section>
          <section aria-label="Single readings" className={s.grid3}>
            {l.readings.map((r) => (
              <Card key={r.question} title={r.question} aside={<span className={s.pill}>One reading</span>}>
                <div><span className={s.big}>{r.big}</span> <span className={s.meta}>{r.bigNote}</span></div>
                <p className={cx(s.p, s.small)}>{r.body}</p>
                <details className={s.details}><summary>How this is measured</summary><Facts rows={r.method.map((m) => [m.k, m.v] as const)} /></details>
              </Card>
            ))}
          </section>
          <Card title="Not measured yet">
            <div className={s.tableWrap}>
              <table className={s.table}>
                <thead><tr><th scope="col">Question</th><th scope="col">Why there’s no figure</th><th scope="col">Needs</th></tr></thead>
                <tbody>{l.notMeasured.map((n) => <tr key={n.question}><td>{n.question}</td><td className={s.small}>{n.why}</td><td className={s.small}>{n.needs}</td></tr>)}</tbody>
              </table>
            </div>
            <p className={cx(s.p, s.meta)}>No figure is shown where nothing is measured. A saving is never claimed from reuse alone.</p>
          </Card>
        </>
      )}
    </>
  );
}
