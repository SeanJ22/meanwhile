"use client";

/**
 * **IS IT LEARNING.** Weekly trends in an even grid, single readings in a row,
 * and the questions with no figure yet shown as "—".
 */
import { WeeklyColumns } from "./charts.tsx";
import { useV6 } from "./context.tsx";
import { Card, cx } from "./ui.tsx";
import s from "./v6.module.css";

export function LearningScreen() {
  const v = useV6();
  const l = v.data.learning.data;
  return (
    <>
      <header>
        <p className={s.eyebrow}>All tracked states</p>
        <h1 className={s.h1}>Is it learning</h1>
      </header>
      {!l && <Card title="Weekly trends"><span className={s.big}>—</span></Card>}
      {l && (
        <>
          <section aria-label="Weekly trends" className={s.grid3}>
            {l.trends.map((t) => (
              <Card key={t.question} title={t.question} aside={<span className={cx(s.pill, s["tone-good"])}>Measured weekly</span>}>
                <div><span className={s.big}>{t.big}</span> <span className={s.meta}>{t.bigNote}</span></div>
                <WeeklyColumns trend={t} />
              </Card>
            ))}
          </section>
          <section aria-label="Single readings" className={s.grid3}>
            {l.readings.map((r) => (
              <Card key={r.question} title={r.question} aside={<span className={s.pill}>One reading</span>}>
                <div><span className={s.big}>{r.big}</span> <span className={s.meta}>{r.bigNote}</span></div>
              </Card>
            ))}
          </section>
          <Card title="Not measured yet">
            <div className={s.tableWrap}>
              <table className={s.table}>
                <thead><tr><th scope="col">Question</th><th scope="col">Figure</th></tr></thead>
                <tbody>{l.notMeasured.map((n) => <tr key={n.question}><td>{n.question}</td><td className={s.mono}>—</td></tr>)}</tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </>
  );
}
