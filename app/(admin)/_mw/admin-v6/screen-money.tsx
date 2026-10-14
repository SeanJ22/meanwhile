"use client";

import { useMemo, useState } from "react";

import { periodDays } from "@/lib/control-plane/admin-view/periods.ts";
import { dailyRows, moneySummary } from "@/lib/control-plane/admin-view/spend-period.ts";
import type { ModelSpendView } from "@/lib/control-plane/admin-view/model-spend.ts";

import { useV6 } from "./context.tsx";
import { mst, usd, type Hunt } from "./model.ts";
import { huntAt, huntsWithin } from "./places.ts";
import { Card, cx, Technical } from "./ui.tsx";
import s from "./v6.module.css";

const DASH = "—";
const money = (n: number | null) => (n === null ? DASH : usd(n));
const STATUS: Readonly<Record<Hunt["status"], string>> = { running: "Running", paused: "Paused", stopped: "Stopped", unreported: DASH };
const zipOf = (placeKey: string) => /\.zcta\.(\d{5})$/.exec(placeKey)?.[1] ?? DASH;
const TOP = 10;
const gigabytes = (bytes: number | null) => (bytes === null ? DASH : `${(bytes / 1e9).toFixed(2)} GB`);
const dayWords = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
const percent = (n: number | null) => n === null ? DASH : `${(n * 100).toFixed(1)}%`;
const roleWords = (role: string) => ({ ADVERSARIAL_AUDITOR: "Auditor", PARSER: "Page reader", MEASURE_WRITER: "Translator", MEASURE_CHECKER: "Translation checker", ASK: "Ask" }[role]
  ?? role.toLowerCase().replaceAll("_", " ").replace(/^./, char => char.toUpperCase()));

function ModelSpendPanel({ view, days }: { view: ModelSpendView | null; days: readonly string[] }) {
  const [comparison, setComparison] = useState(false);
  const [all, setAll] = useState(false);
  const rows = view === null ? [] : comparison
    ? [...view.before.map(row => ({ ...row, label: "Before" })), ...view.after.map(row => ({ ...row, label: "After" }))]
    : view.days.filter(row => days.includes(row.day)).map(row => ({ ...row, label: dayWords(row.day) }));
  const shown = all ? rows : rows.slice(0, TOP);
  return <Card title="Model spend" aside={<button type="button" className={s.btn} aria-pressed={comparison}
    onClick={() => { setComparison(!comparison); setAll(false); }}>{comparison ? "By day" : "Before and after"}</button>}>
    <p className={cx(s.p, s.small)}>{comparison
      ? view?.changedAt ? `24 hours before and after ${mst(view.changedAt)} · ${view.comparison === "complete" ? "Both windows complete" : `Collecting through ${mst(view.afterThrough!)}`}` : "Waiting for the first production charge with the new savings settings."
      : "Daily totals in Eastern time. Cost per live fact uses new or updated reader records that day."}</p>
    {view === null || rows.length === 0 ? <p className={cx(s.p, s.small)}>{DASH}</p> : <>
      <div className={s.tableWrap}><table className={s.table}>
        <thead><tr>{[comparison ? "Window" : "Day", "Role", "Dollars", "Calls", "Cache hits", "Cache writes", "1-hour cache tokens", "Cache writes / job", "Batch / eligible", "Saved vs list price", "Cost / live fact"].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
        <tbody>{shown.map((row, i) => <tr key={`${row.label}:${row.role}:${i}`}>
          <th scope="row">{row.label}</th><td>{roleWords(row.role)}</td><td className={s.num}>{money(row.dollars)}</td>
          <td className={s.num}>{row.calls?.toLocaleString() ?? DASH}</td><td className={s.num}>{percent(row.cacheHitShare)}</td>
          <td className={s.num}>{percent(row.cacheWriteShare)}</td><td className={s.num}>{row.hourCacheTokens?.toLocaleString() ?? DASH}</td>
          <td className={s.num}>{row.cacheWritesPerJob === null ? DASH : Math.round(row.cacheWritesPerJob).toLocaleString()}</td>
          <td className={s.num} title={row.eligibleCalls === null || row.batchedCalls === null ? undefined : `${row.batchedCalls} of ${row.eligibleCalls} eligible calls`}>{percent(row.batchShare)}</td>
          <td className={s.num}>{money(row.savedDollars)}</td><td className={s.num}>{row.costPerLiveFact === null ? DASH : `$${row.costPerLiveFact.toFixed(4)}`}</td>
        </tr>)}</tbody>
      </table></div>
      {rows.length > TOP && <button type="button" className={s.btn} aria-expanded={all} onClick={() => setAll(!all)}>{all ? `Show the latest ${TOP}` : `Show all ${rows.length}`}</button>}
    </>}
  </Card>;
}

type SortKey = "zip" | "place" | "spent" | "held" | "limit" | "status";
const COLUMNS: readonly { readonly key: SortKey; readonly label: string; readonly num: boolean }[] = [
  { key: "zip", label: "ZIP", num: false }, { key: "place", label: "Place", num: false }, { key: "spent", label: "Spent", num: true },
  { key: "held", label: "Set aside", num: true }, { key: "limit", label: "Limit", num: true }, { key: "status", label: "Status", num: false },
];

export function MoneyScreen() {
  const v = useV6();
  const hunt = huntAt(v.index, v.hunts, v.scopeKey);
  const list = useMemo(() => (hunt ? [hunt] : huntsWithin(v.index, v.hunts, v.scopeKey)), [hunt, v.index, v.hunts, v.scopeKey]);
  const [sort, setSort] = useState<{ readonly key: SortKey; readonly down: boolean }>({ key: "spent", down: true });
  const [all, setAll] = useState(false);
  const [by, setBy] = useState<"hunt" | "day">("hunt");

  const rows = useMemo(() => {
    const placeOf = (h: Hunt) => v.index.get(h.placeKey)?.name ?? h.name;
    const value = (h: Hunt): number | string => {
      switch (sort.key) {
        case "zip": return zipOf(h.placeKey);
        case "place": return placeOf(h);
        case "spent": return h.spentUsd;
        case "held": return h.heldUsd;
        case "limit": return h.limitUsd;
        case "status": return STATUS[h.status];
      }
    };
    return list.map((h) => ({ h, place: placeOf(h), zip: zipOf(h.placeKey) })).sort((a, b) => {
      const x = value(a.h), y = value(b.h);
      const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "en", { numeric: true });
      return (sort.down ? -c : c) || a.place.localeCompare(b.place);
    });
  }, [list, sort, v.index]);
  const shown = all ? rows : rows.slice(0, TOP);

  const sum = moneySummary({
    spend: v.data.spend.data, setAsideUsd: v.data.spend.data?.setAsideUsd ?? null,
    dailyLimitUsd: v.data.spend.data?.dailyLimitUsd ?? null, period: v.period, now: new Date(),
  });

  const spendData = v.data.spend.data;
  const hunters = spendData?.huntersNow ?? null;
  const dialWords = hunters === null || sum.dailyLimitUsd === null ? DASH : `${usd(sum.dailyLimitUsd)} a day → about ${hunters} hunter${hunters === 1 ? "" : "s"} at once now`;
  const worstCase = spendData?.worstCaseCharges ?? 0;

  const days = v.data.spend.data ? dailyRows(v.data.spend.data, v.period, new Date()) : [];
  const shownDays = all ? days : days.slice(0, TOP);
  /** Hosting is billed by the month: the provider's own reading for the month in the picker, or a dash. */
  const hosting = /^20\d\d-\d\d$/.test(v.period) ? v.data.money.data?.account.find((a) => a.provider === "Netlify")?.amountUsd ?? null : null;
  const bills = v.data.money.data?.byDay ?? null;
  const billSpan = periodDays(v.period, new Date());
  const billDays = bills === null ? [] : bills.days.filter((d) => billSpan === null || (d.day >= billSpan.from && d.day <= billSpan.to));
  const switcher = (
    <span className={s.inline}>
      {(["hunt", "day"] as const).map((k) => (
        <button key={k} type="button" className={cx(s.btn, by === k && s.btnPrimary)} aria-pressed={by === k} onClick={() => { setBy(k); setAll(false); }}>{k === "hunt" ? "By hunt" : "By day"}</button>
      ))}
    </span>
  );

  return (
    <>
      <header>
        <p className={s.eyebrow}>{v.place.name}</p>
        <h1 className={s.h1}>Money</h1>
      </header>

      <Card title="Summary" aside={<span className={s.meta}>{v.data.spend.data?.readAt ? `Read ${mst(v.data.spend.data.readAt)}` : DASH}</span>}>
        <div className={s.gridTiles}>
          <div className={s.row}><span className={s.eyebrow}>Spent</span><span className={s.big}>{money(sum.spentUsd)}</span></div>
          <div className={s.row}><span className={s.eyebrow}>Last 24 hours</span><span className={s.big}>{money(v.data.spend.data?.last24h?.modelUsd ?? null)}</span></div>
          <div className={s.row}><span className={s.eyebrow}>Search</span><span className={s.big}>{money(sum.searchUsd)}</span></div>
          <div className={s.row}><span className={s.eyebrow}>Database sent</span><span className={s.big}>{gigabytes(sum.neonBytes)}</span></div>
          <div className={s.row}><span className={s.eyebrow}>Hosting</span><span className={s.big}>{money(hosting)}</span></div>
          <div className={s.row}><span className={s.eyebrow}>Set aside</span><span className={s.big}>{money(sum.setAsideUsd)}</span></div>
          <div className={s.row}>
            <span className={s.eyebrow}>Today against the daily limit · Anthropic tokens only</span>
            <span className={s.big}>{money(sum.todayUsd)} <span className={s.dim}>of {money(sum.dailyLimitUsd)}</span></span>
          </div>
          <div className={s.row}><span className={s.eyebrow}>Left today</span><span className={s.big}>{money(sum.leftUsd)}</span></div>
          <div className={s.row}><span className={s.eyebrow}>What the daily limit buys</span><span className={s.big}>{dialWords}</span></div>
          <div className={s.row}>
            <span className={s.eyebrow}>By model tier</span>
            {sum.tiers === null ? <span className={s.big}>{DASH}</span> : sum.tiers.map((t) => <span key={t.name} className={s.small}>{t.name} <span className={s.mono}>{usd(t.usd)}</span></span>)}
          </div>
        </div>
        {worstCase > 0 && (
          <p className={cx(s.p, s.small, s.textWarn)} role="status">
            {worstCase} charge{worstCase === 1 ? " was" : "s were"} counted at the most it could have cost because no price was recorded. Spend is still counted and the daily limit still holds.
          </p>
        )}
      </Card>

      <Card title="Provider bills by day">
        {bills === null ? <p className={cx(s.p, s.small)}>{DASH}</p> : (
          <>
            {billDays.length === 0 ? <p className={cx(s.p, s.small)}>{DASH}</p> : (
              <div className={s.tableWrap}>
                <table className={s.table}>
                  <thead><tr><th scope="col">Day</th>{bills.providers.map((p) => <th key={p.provider} scope="col" className={s.num}>{p.provider}</th>)}</tr></thead>
                  <tbody>
                    {billDays.map((d) => (
                      <tr key={d.day}>
                        <th scope="row" style={{ textTransform: "none", fontSize: 13, color: "var(--text)" }}>{dayWords(d.day)}</th>
                        {d.cells.map((c, i) => <td key={bills.providers[i].provider} className={s.num}>{c === null ? DASH : c.usd !== null ? usd(c.usd) : c.usage ?? DASH}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {bills.providers.some((p) => p.note !== null) && (
              <ul className={cx(s.p, s.small)}>{bills.providers.flatMap((p) => (p.note === null ? [] : [<li key={p.provider}>{p.note}</li>]))}</ul>
            )}
            <Technical lines={bills.technical} />
          </>
        )}
      </Card>

      <ModelSpendPanel view={spendData?.modelSpend ?? null} days={days.map(day => day.day)} />

      <Card title={by === "hunt" ? "Hunts" : "Days"} aside={switcher}>
        {by === "day" ? (days.length === 0 ? <p className={cx(s.p, s.small)}>{DASH}</p> : (
          <>
            <div className={s.tableWrap}>
              <table className={s.table}>
                <thead><tr><th scope="col">Day</th><th scope="col" className={s.num}>Spent</th><th scope="col" className={s.num}>Search</th><th scope="col" className={s.num}>Database sent</th></tr></thead>
                <tbody>
                  {shownDays.map((d) => (
                    <tr key={d.day}>
                      <th scope="row" style={{ textTransform: "none", fontSize: 13, color: "var(--text)" }}>{dayWords(d.day)}</th>
                      <td className={s.num}>{money(d.spentUsd)}</td><td className={s.num}>{money(d.searchUsd)}</td><td className={s.num}>{gigabytes(d.neonBytes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {days.length > TOP && (
              <button type="button" className={s.btn} aria-expanded={all} onClick={() => setAll(!all)}>{all ? `Show the latest ${TOP}` : `Show all ${days.length}`}</button>
            )}
          </>
        )) : rows.length === 0 ? <p className={cx(s.p, s.small)}>{DASH}</p> : (
          <>
            <div className={s.tableWrap}>
              <table className={s.table}>
                <thead>
                  <tr>
                    {COLUMNS.map((c) => (
                      <th key={c.key} scope="col" className={c.num ? s.num : undefined} aria-sort={sort.key === c.key ? (sort.down ? "descending" : "ascending") : "none"}>
                        <button type="button" className={s.btnLink} onClick={() => setSort((p) => ({ key: c.key, down: p.key === c.key ? !p.down : c.num }))}>
                          {c.label}{sort.key === c.key ? (sort.down ? " ↓" : " ↑") : ""}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shown.map(({ h, place, zip }) => (
                    <tr key={h.id}>
                      <th scope="row" style={{ textTransform: "none", fontSize: 13, color: "var(--text)" }}>{zip}</th>
                      <td>{place}</td>
                      <td className={s.num}>{usd(h.spentUsd)}</td>
                      <td className={s.num}>{usd(h.heldUsd)}</td>
                      <td className={s.num}>{usd(h.limitUsd)}</td>
                      <td>{STATUS[h.status]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rows.length > TOP && (
              <button type="button" className={s.btn} aria-expanded={all} onClick={() => setAll(!all)}>{all ? `Show the top ${TOP}` : `Show all ${rows.length}`}</button>
            )}
          </>
        )}
      </Card>
    </>
  );
}
