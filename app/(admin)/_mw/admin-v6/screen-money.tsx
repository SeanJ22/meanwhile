"use client";

/**
 * **MONEY.** One summary row, then one table. Every summary figure is `moneySummary` over the one cost-ledger read for the period in the
 * picker: Spent (settled paid-AI charges, the tiers add up to it), Search, Set aside (open reservations now), Today (settled today plus
 * set aside) against the daily limit, Left today (the limit minus Today), and the tiers. A hunt's own limit appears only in the table.
 */
import { useMemo, useState } from "react";

import { plainWords } from "@/lib/control-plane/admin-view/plain-words.ts";
import { dailyRows, moneySummary } from "@/lib/control-plane/admin-view/spend-period.ts";

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
  const worstCase = spendData?.worstCaseCharges ?? 0;

  const days = v.data.spend.data ? dailyRows(v.data.spend.data, v.period, new Date()) : [];
  const shownDays = all ? days : days.slice(0, TOP);
  /** Hosting is billed by the month: the provider's own reading for the month in the picker, or a dash. */
  const hosting = /^20\d\d-\d\d$/.test(v.period) ? v.data.money.data?.account.find((a) => a.provider === "Netlify")?.amountUsd ?? null : null;
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

      <Card title="Spend by vendor" aside={<span className={s.meta}>{spendData?.vendors ? `Today (${spendData.vendors.day}) · month (${spendData.vendors.month}) · read ${mst(spendData.vendors.readAt)}` : DASH}</span>}>
        <div className={s.tableWrap}><table className={s.table}>
          <thead><tr><th>Vendor</th><th>Today</th><th>Daily limit</th><th>Month to date</th><th>Monthly limit</th></tr></thead>
          <tbody>{(spendData?.vendors?.vendors ?? ["Anthropic","Neon","DigitalOcean","Netlify","GitHub"].map(vendor=>({vendor,todayUsd:null,monthUsd:null,dailyLimitUsd:null,monthlyLimitUsd:null,todayBytes:null,monthBytes:null,todayPeriodStart:undefined as string|undefined,todayPeriodEnd:undefined as string|undefined,detail:"The vendor reading is not available yet."}))).map(r=><tr key={r.vendor}>
            <th scope="row">{r.vendor}<Technical lines={[r.detail]}/></th><td>{money(r.todayUsd)}{r.todayPeriodStart&&r.todayPeriodEnd&&<div className={s.small}>Provider day: {mst(r.todayPeriodStart)} to {mst(r.todayPeriodEnd)}</div>}{r.todayBytes!==null&&<div className={s.small}>{gigabytes(r.todayBytes)} transferred</div>}</td><td>{money(r.dailyLimitUsd)}</td><td>{money(r.monthUsd)}{r.monthBytes!==null&&<div className={s.small}>{gigabytes(r.monthBytes)} transferred</div>}</td><td>{money(r.monthlyLimitUsd)}</td>
          </tr>)}</tbody>
        </table></div>
      </Card>

      <Card title="Database transfer by project and day">
        {spendData?.neonProjects ? <div className={s.tableWrap}><table className={s.table}><thead><tr><th>Project</th><th>Day (Eastern)</th><th>Sent and received</th><th>Why it rose</th></tr></thead><tbody>
          {spendData.neonProjects.map(r=><tr key={`${r.project}:${r.day}`}><th scope="row">{r.project==="control-plane"?"Control plane":"Civic database"}</th><td>{dayWords(r.day)}</td><td>{gigabytes(r.requestBytes+r.responseBytes)}</td><td>{r.cause===null?DASH:plainWords(r.cause)}{r.cause!==null&&<Technical lines={[r.cause]}/>}</td></tr>)}
        </tbody></table></div> : <><p className={s.p}>{DASH}</p><Technical lines={["The runner has not published measured daily transfer and cause attribution by database project."]}/></>}
      </Card>

      <Card title="Summary" aside={<span className={s.meta}>{v.data.spend.data?.readAt ? `Read ${mst(v.data.spend.data.readAt)}` : DASH}</span>}>
        <div className={s.gridTiles}>
          <div className={s.row}><span className={s.eyebrow}>Spent</span><span className={s.big}>{money(sum.spentUsd)}</span></div>
          <div className={s.row}><span className={s.eyebrow}>Last 24 hours</span><span className={s.big}>{money(v.data.spend.data?.last24h?.modelUsd ?? null)}</span></div>
          <div className={s.row}><span className={s.eyebrow}>Search</span><span className={s.big}>{money(sum.searchUsd)}</span></div>
          <div className={s.row}><span className={s.eyebrow}>Database sent</span><span className={s.big}>{gigabytes(sum.neonBytes)}</span></div>
          <div className={s.row}><span className={s.eyebrow}>Hosting</span><span className={s.big}>{money(hosting)}</span></div>
          <div className={s.row}><span className={s.eyebrow}>Set aside for running jobs</span><span className={s.big}>{money(sum.setAsideUsd)}</span>{sum.setAsideUsd===null&&<Technical lines={["Running-job reservations have not been read. Historical or crashed reservations are not counted as running jobs."]}/>}</div>
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
        {worstCase > 0 && (
          <p className={cx(s.p, s.small, s.textWarn)} role="status">
            {worstCase} charge{worstCase === 1 ? " was" : "s were"} counted at the most it could have cost because no price was recorded. Spend is still counted and the daily limit still holds.
          </p>
        )}
      </Card>

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
