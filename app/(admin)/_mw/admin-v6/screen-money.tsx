"use client";

/**
 * **MONEY.** One summary row, then one table. Every summary figure is `moneySummary` over the one cost-ledger read for the period in the
 * picker: Spent (settled paid-AI charges, the tiers add up to it), Search, Set aside (open reservations now), Today (settled today plus
 * set aside) against the daily limit, Left today (the limit minus Today), and the tiers. A hunt's own limit appears only in the table.
 */
import { useMemo, useState } from "react";

import { moneySummary } from "@/lib/control-plane/admin-view/spend-period.ts";

import { useV6 } from "./context.tsx";
import { usd, type Hunt } from "./model.ts";
import { huntAt, huntsWithin } from "./places.ts";
import { Card, cx } from "./ui.tsx";
import s from "./v6.module.css";

const DASH = "—";
const money = (n: number | null) => (n === null ? DASH : usd(n));
const STATUS: Readonly<Record<Hunt["status"], string>> = { running: "Running", paused: "Paused", stopped: "Stopped", unreported: DASH };
const zipOf = (placeKey: string) => /\.zcta\.(\d{5})$/.exec(placeKey)?.[1] ?? DASH;
const TOP = 10;

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

  return (
    <>
      <header>
        <p className={s.eyebrow}>{v.place.name}</p>
        <h1 className={s.h1}>Money</h1>
      </header>

      <Card title="Summary">
        <div className={s.gridTiles}>
          <div className={s.row}><span className={s.eyebrow}>Spent</span><span className={s.big}>{money(sum.spentUsd)}</span></div>
          <div className={s.row}><span className={s.eyebrow}>Search</span><span className={s.big}>{money(sum.searchUsd)}</span></div>
          <div className={s.row}><span className={s.eyebrow}>Set aside</span><span className={s.big}>{money(sum.setAsideUsd)}</span></div>
          <div className={s.row}>
            <span className={s.eyebrow}>Today against the daily limit</span>
            <span className={s.big}>{money(sum.todayUsd)} <span className={s.dim}>of {money(sum.dailyLimitUsd)}</span></span>
          </div>
          <div className={s.row}><span className={s.eyebrow}>Left today</span><span className={s.big}>{money(sum.leftUsd)}</span></div>
          <div className={s.row}>
            <span className={s.eyebrow}>By model tier</span>
            {sum.tiers === null ? <span className={s.big}>{DASH}</span> : sum.tiers.map((t) => <span key={t.name} className={s.small}>{t.name} <span className={s.mono}>{usd(t.usd)}</span></span>)}
          </div>
        </div>
      </Card>

      <Card title="Hunts">
        {rows.length === 0 ? <p className={cx(s.p, s.small)}>{DASH}</p> : (
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
