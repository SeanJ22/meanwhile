"use client";

import type { ChartColor, ItemStatus, Trend } from "./model.ts";
import { count, ITEM_STATUS_ORDER } from "./model.ts";
import { cx } from "./ui.tsx";
import s from "./v6.module.css";

export const STATUS_LABEL: Readonly<Record<ItemStatus, string>> = {
  checked: "Checked on the public page",
  published: "Published, not checked on the page",
  collected: "Collected, not published yet",
  "can-do": "We can do it, not done yet",
  "needs-fix": "Needs a software fix",
  unsure: "Not sure it applies here",
  absent: "Source doesn’t publish it (proven)",
};
export const STATUS_COLOR: Readonly<Record<ItemStatus, string>> = {
  checked: "c-teal",
  published: "c-blue",
  collected: "c-amber",
  "can-do": "c-gray",
  "needs-fix": "c-coral",
  unsure: "c-hatch",
  absent: "c-violet",
};

export function Swatch(props: { readonly cls: string }) {
  return <span className={cx(s.swatch, s[props.cls])} aria-hidden="true" />;
}

export function StatusLegend() {
  return (
    <div className={s.legend} aria-label="What the colors mean">
      {ITEM_STATUS_ORDER.map((k) => (
        <span key={k} className={s.legendItem}><Swatch cls={STATUS_COLOR[k]} />{STATUS_LABEL[k]}</span>
      ))}
    </div>
  );
}

/** One stacked bar over the seven statuses. Counts are in ITEM_STATUS_ORDER. */
export function StatusBar(props: { readonly counts: readonly number[]; readonly label: string; readonly tall?: boolean }) {
  const total = props.counts.reduce((a, b) => a + b, 0);
  const words = ITEM_STATUS_ORDER.map((k, i) => `${STATUS_LABEL[k]}: ${count(props.counts[i] ?? 0)}`).join("; ");
  return (
    <div className={cx(s.bar, props.tall && s.barTall)} role="img" aria-label={`${props.label}. ${words}`}>
      {ITEM_STATUS_ORDER.map((k, i) => {
        const n = props.counts[i] ?? 0;
        if (!n || !total) return null;
        return <span key={k} className={cx(s.seg, s[STATUS_COLOR[k]])} style={{ width: `${(n / total) * 100}%` }} title={`${STATUS_LABEL[k]}: ${count(n)}`} />;
      })}
    </div>
  );
}

export function StatusTable(props: { readonly rows: readonly { readonly name: string; readonly counts: readonly number[] }[] }) {
  return (
    <details className={s.details}>
      <summary>Show as a table</summary>
      <div className={s.tableWrap}>
        <table className={s.table}>
          <thead>
            <tr><th scope="col">Group</th>{ITEM_STATUS_ORDER.map((k) => <th key={k} scope="col" className={s.num}>{STATUS_LABEL[k]}</th>)}<th scope="col" className={s.num}>Total</th></tr>
          </thead>
          <tbody>
            {props.rows.map((r) => (
              <tr key={r.name}><th scope="row" style={{ textTransform: "none", fontSize: 13, color: "var(--text)" }}>{r.name}</th>{r.counts.map((n, i) => <td key={i} className={s.num}>{count(n)}</td>)}<td className={s.num}>{count(r.counts.reduce((a, b) => a + b, 0))}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

const COLOR_CLASS: Readonly<Record<ChartColor, string>> = { teal: "c-teal", blue: "c-blue", amber: "c-amber", gray: "c-gray", coral: "c-coral", violet: "c-violet", dark: "c-dark" };

function fmt(v: number, f: Trend["format"]): string {
  return f === "usd" ? `$${v.toFixed(2)}` : `${v}%`;
}

/** Weekly columns. A week with no record is an outlined box with "—", never a zero bar. */
export function WeeklyColumns(props: { readonly trend: Trend }) {
  const t = props.trend;
  return (
    <div className={s.stack} style={{ gap: 8 }}>
      <div className={s.cols} role="img" aria-label={`${t.question}. ${t.weeks.map((w) => `Week of ${w.week}: ${w.values ? w.values.map((v, j) => `${t.series[j].name} ${fmt(v, t.format)}`).join(", ") : "no record"}`).join("; ")}`}>
        {t.weeks.map((w) => (
          <div key={w.week} className={s.colGroup}>
            <div className={s.colBars} style={{ paddingTop: 16 }}>
              {w.values === null ? (
                <span className={s.colGap} title={`No record for the week of ${w.week}`}>—</span>
              ) : w.values.map((v, j) => (
                <span key={j} className={cx(s.colBar, s[COLOR_CLASS[t.series[j].color]])} style={{ height: `${Math.max(4, (v / t.max) * 100)}%` }} title={`${t.series[j].name}, week of ${w.week}: ${fmt(v, t.format)}`}>
                  <span className={s.colValue}>{fmt(v, t.format)}</span>
                </span>
              ))}
            </div>
            <span className={s.colLabel}>{w.week}</span>
          </div>
        ))}
      </div>
      <div className={s.legend}>
        {t.series.map((x) => <span key={x.name} className={s.legendItem}><Swatch cls={COLOR_CLASS[x.color]} />{x.name}</span>)}
        <span className={s.legendItem}><span className={cx(s.swatch, s.gap)} aria-hidden="true" />No record that week</span>
      </div>
      <details className={s.details}>
        <summary>Show as a table</summary>
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead><tr><th scope="col">Week</th>{t.series.map((x) => <th key={x.name} scope="col" className={s.num}>{x.name}</th>)}</tr></thead>
            <tbody>{t.weeks.map((w) => <tr key={w.week}><td>{w.week}</td>{t.series.map((x, j) => <td key={x.name} className={s.num}>{w.values ? fmt(w.values[j], t.format) : "no record"}</td>)}</tr>)}</tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

