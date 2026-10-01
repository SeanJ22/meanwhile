"use client";

/**
 * **MONEY.** One card per hunt (never added into a national budget), account
 * readings by provider with monthly plans apart, the limits in force, month-by-month
 * spend, our recorded costs reconciled against each provider's own report, and AI
 * costs one piece of work at a time. Unknown is never $0; unpriced charges are
 * counted, not priced; money set aside is kept apart from money spent.
 */
import { Donut } from "./charts.tsx";
import { useV6 } from "./context.tsx";
import { count, huntLeftUsd, mst, usd } from "./model.ts";
import { huntAt, huntsWithin, relation } from "./places.ts";
import { HuntMeter } from "./screen-now.tsx";
import { Card, cx, Empty, SourceNote } from "./ui.tsx";
import s from "./v6.module.css";

const CLS = ["c-blue", "c-teal", "c-amber", "c-violet", "c-coral", "c-gray"];

const TIER_CLS: Readonly<Record<string, string>> = { haiku: "c-teal", sonnet: "c-blue", opus: "c-amber", older: "c-violet", unrecorded: "c-gray" };
const gigabytes = (bytes: number) => `${(bytes / 1e9).toFixed(bytes < 1e8 ? 3 : 2)} GB`;
const dayWords = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric" });

/**
 * **SPEND IN ONE PLACE.** Anthropic by model tier, search, the database's daily transfer and hosting, by day.
 * It reads the cost ledger (whole-system: the ledger is not split by place), so every place shows the same figures and
 * says so. A price the ledger never had is counted beside the dollars and never shown as $0; a database counter that
 * is not installed says "not recorded yet", never zero.
 */
function SpendCard() {
  const v = useV6();
  const src = v.data.spend;
  const sp = src.data;
  const account = v.data.money.data?.account ?? [];
  const hosting = account.filter((a) => /netlify|github/i.test(a.provider));
  const neonToday = sp?.neon.kind === "recorded" ? sp.neon.days[0] ?? null : null;
  const top = Math.max(0.0001, ...(sp?.byTier.map((x) => x.usd) ?? [0]));
  const neonByDay = new Map((sp?.neon.days ?? []).map((d) => [d.day, d]));
  return (
    <Card title="Spend in one place" aside={<span className={s.meta}>{sp ? `Last ${sp.windowDays} days · whole system, not split by place` : "Reading…"}</span>}>
      <SourceNote source={src} what="Spend" />
      {sp && (
        <>
          <div className={s.gridTiles}>
            <div className={s.row}><span className={s.eyebrow}>Anthropic (AI models)</span><span className={s.big}>{usd(sp.anthropicUsd)}</span><span className={s.meta}>Priced charges by tier, below</span></div>
            <div className={s.row}><span className={s.eyebrow}>Search</span><span className={s.big}>{usd(sp.searchUsd)}</span><span className={s.meta}>Brave and Exa requests recorded in the ledger</span></div>
            <div className={s.row}>
              <span className={s.eyebrow}>Neon (database sent)</span>
              {neonToday ? <><span className={s.big}>{gigabytes(neonToday.responseBytes)}</span><span className={s.meta}>Sent {dayWords(neonToday.day)}, from the byte counter</span></>
                : <><span className={cx(s.big, s.textWarn)}>Not recorded yet</span><span className={s.meta}>{sp.neon.detail ?? "The counter has no rows yet."}</span></>}
            </div>
            <div className={s.row}>
              <span className={s.eyebrow}>Hosting</span>
              {hosting.length ? hosting.map((h) => <span key={h.provider} className={s.small}>{h.provider}: <span className={cx(s.mono, h.amountUsd === null && s.textWarn)}>{h.amountUsd === null ? "no dollar reading" : usd(h.amountUsd)}</span></span>)
                : <span className={cx(s.big, s.textWarn)}>No reading</span>}
              <span className={s.meta}>Provider readings for the whole account</span>
            </div>
          </div>
          <h3 className={s.h3}>By model tier</h3>
          <div className={s.stack}>
            {sp.byTier.map((x) => (
              <div key={x.key} className={s.row}>
                <span className={s.spread}><strong style={{ fontSize: 13 }}>{x.name}</strong><span className={cx(s.meta, s.mono)}>{usd(x.usd)} · {count(x.requests)} charges</span></span>
                <div className={s.meter}><span className={s.meterFill} style={{ width: `${Math.max(1, (x.usd / top) * 100)}%`, background: `var(--v6-${(TIER_CLS[x.tier] ?? "c-gray").slice(2)}, var(--pill-cyan-text))` }} /></div>
              </div>
            ))}
            {sp.unpricedRows > 0 && <p className={cx(s.p, s.meta)}>{count(sp.unpricedRows)} ledger rows have no price recorded. They are counted here, not priced, and never shown as $0.</p>}
          </div>
          <h3 className={s.h3}>By day</h3>
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead><tr><th scope="col">Day (Eastern)</th><th scope="col" className={s.num}>Anthropic</th><th scope="col">By model</th><th scope="col" className={s.num}>Search</th><th scope="col" className={s.num}>Database sent</th></tr></thead>
              <tbody>
                {sp.byDay.map((d) => (
                  <tr key={d.day}>
                    <th scope="row" style={{ textTransform: "none", fontSize: 13, color: "var(--text)" }}>{dayWords(d.day)}</th>
                    <td className={s.num}>{usd(d.anthropicUsd)}</td>
                    <td className={s.small}>{d.byModel.map((m) => `${m.name} ${usd(m.usd)}`).join(" · ")}</td>
                    <td className={s.num}>{usd(d.searchUsd)}</td>
                    <td className={s.num}>{sp.neon.kind === "recorded" ? (neonByDay.has(d.day) ? gigabytes(neonByDay.get(d.day)!.responseBytes) : "—") : "Not recorded yet"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={cx(s.p, s.meta)}>Per hunt, see the hunt cards above: each shows its own spent, set aside and left. A dash means the counter recorded nothing that day.</p>
        </>
      )}
    </Card>
  );
}

const monthWords = (month: string) => new Date(`${month}-01T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "America/New_York", month: "long", year: "numeric" });
/** Providers bill by UTC calendar day, so a billing period is shown as UTC dates. */
const billingDay = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/**
 * **MONTH BY MONTH.** What the cost ledger holds for each Eastern month, the month in progress first. Whole system, like
 * the ledger. A month with no priced rows is absent, not zero.
 */
function MonthsCard() {
  const v = useV6();
  const sp = v.data.spend.data;
  const months = sp?.byMonth ?? [];
  return (
    <Card title="Month by month" aside={<span className={s.meta}>Eastern months · whole system</span>}>
      <SourceNote source={v.data.spend} what="Monthly spend" />
      {sp && !months.length && <Empty>The cost ledger holds no priced charges in the last twelve months.</Empty>}
      {!!months.length && (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead><tr><th scope="col">Month</th><th scope="col" className={s.num}>Anthropic</th><th scope="col">By tier</th><th scope="col" className={s.num}>Search</th><th scope="col" className={s.num}>Charges</th></tr></thead>
            <tbody>
              {months.map((m, i) => (
                <tr key={m.month}>
                  <th scope="row" style={{ textTransform: "none", fontSize: 13, color: "var(--text)" }}>{monthWords(m.month)}{i === 0 ? " (so far)" : ""}</th>
                  <td className={s.num}>{usd(m.anthropicUsd)}</td>
                  <td className={s.small}>{m.byTier.map((t) => `${t.name} ${usd(t.usd)}`).join(" · ") || "—"}</td>
                  <td className={s.num}>{usd(m.searchUsd)}</td>
                  <td className={s.num}>{count(m.rows)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/**
 * **OUR COSTS AGAINST THE PROVIDER'S BILL.** Each provider's own report for its period, next to what our ledger recorded
 * for the same period, and the difference. Hunt costs are a subset of account costs and are never added again. The
 * difference can include other account users, platform activity we do not record, discounts and the provider's lag; it is
 * never assigned to a hunt. Reports are usage the provider reports, not invoices.
 */
function ReconciliationCard() {
  const v = useV6();
  const m = v.data.money.data;
  const rec = m?.reconciliation ?? null;
  const dollars = (n: number | null, known?: number) => (n === null ? `${usd(known ?? 0)} known, some unpriced` : usd(n));
  return (
    <Card title="Our costs against the provider’s bill" aside={<span className={s.meta}>Matched to each report’s own period</span>}>
      <SourceNote source={v.data.money} what="Provider reports" />
      {m && rec === null && <Empty>The published snapshot has no cost attribution yet, so nothing can be matched to the provider reports. This doesn’t mean the costs match.</Empty>}
      {!!rec?.length && (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead><tr><th scope="col">Service</th><th scope="col">Period</th><th scope="col" className={s.num}>Hunt requests</th><th scope="col" className={s.num}>Other recorded requests</th><th scope="col" className={s.num}>Provider report</th><th scope="col" className={s.num}>Difference</th><th scope="col" className={s.num}>Unpriced</th></tr></thead>
            <tbody>
              {rec.map((r) => (
                <tr key={r.provider}>
                  <th scope="row" style={{ textTransform: "none", fontSize: 13, color: "var(--text)" }}>{r.provider}</th>
                  <td className={s.small}>{billingDay(r.periodStart)} to {billingDay(r.periodEnd)}</td>
                  <td className={s.num}>{dollars(r.huntUsd, r.huntKnownUsd)}</td>
                  <td className={s.num}>{dollars(r.otherUsd, r.otherKnownUsd)}</td>
                  <td className={cx(s.num, r.providerUsd === null && s.textWarn)}>{r.providerUsd === null ? "No report" : usd(r.providerUsd)}</td>
                  <td className={s.num}>{r.differenceUsd === null ? "Can’t be worked out" : usd(r.differenceUsd)}</td>
                  <td className={s.num}>{count(r.unpriced)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rec !== null && !rec.length && <Empty>No provider report matches this period.</Empty>}
      <p className={cx(s.p, s.meta)}>Request costs are estimates from recorded usage and rates. The difference can include other account users, platform activity we don’t record, discounts and the provider’s lag. It isn’t assigned to a hunt. Hosting, Neon and GitHub are shared platform costs.</p>
      {(m?.readings ?? []).map((r) => (
        <details key={r.provider} className={s.row}>
          <summary className={s.small}><strong>{r.provider}</strong> · {r.status.replaceAll("_", " ").toLowerCase()}{r.stale ? " · stale" : ""} · last sync {r.syncedAt ? mst(r.syncedAt) : "never"}</summary>
          <div className={s.stack}>
            <p className={cx(s.p, s.small)}>Provider-reported: {r.reportedUsd === null ? "no amount" : usd(r.reportedUsd)}. Estimate: {r.estimatedUsd === null ? "none" : usd(r.estimatedUsd)}. Period {billingDay(r.periodStart)} to {billingDay(r.periodEnd)}. Last attempt {mst(r.attemptedAt)}.</p>
            {r.error && <p className={cx(s.p, s.small, s.textWarn)}>Error: {r.error}</p>}
            <p className={cx(s.p, s.small, s.dim)}>{r.detail}</p>
            {r.credits && <p className={cx(s.p, s.small)}>{r.credits}</p>}
            {!!r.accounts.length && <p className={cx(s.p, s.small)}>Reporting accounts, projects or keys: {r.accounts.join(", ")}</p>}
            {r.limits.map((l, i) => <p key={i} className={cx(s.p, s.small)}>Existing limit: {l}</p>)}
            {!!r.units.length && <ul className={s.stack} style={{ listStyle: "none", padding: 0, margin: 0 }}>{r.units.map((u, i) => <li key={i} className={s.small}>{u.label}: <span className={s.mono}>{u.value.toLocaleString("en-US")} {u.unit}</span></li>)}</ul>}
          </div>
        </details>
      ))}
    </Card>
  );
}

export function MoneyScreen() {
  const v = useV6();
  const m = v.data.money.data;
  const hunt = huntAt(v.index, v.hunts, v.scopeKey);
  const inside = huntsWithin(v.index, v.hunts, v.scopeKey);
  const list = hunt ? [hunt] : inside;
  const work = (v.data.spend.data?.work ?? []).filter((d) => !d.applies.length || relation(v.index, d.applies, v.scopeKey) !== null);
  const known = (m?.account ?? []).filter((a) => a.amountUsd !== null).reduce((x, a) => x + (a.amountUsd ?? 0), 0);
  const missing = (m?.account ?? []).filter((a) => a.amountUsd === null);
  return (
    <>
      <header>
        <p className={s.eyebrow}>{v.place.name}</p>
        <h1 className={s.h1}>Money</h1>
      </header>

      <Card title="Hunts" aside={<span className={s.meta}>Each hunt has its own lifetime limit. There is no national budget.</span>}>
        <SourceNote source={v.data.hunts} what="Hunt money" />
        {v.data.hunts.state !== "not-connected" && !list.length && <Empty>No hunt in {v.place.name}, so there’s no hunt limit. Costs for shared work that covers it aren’t split by place yet.</Empty>}
        <div className={s.grid2}>
          {list.map((h) => (
            <div key={h.id} className={s.stack}>
              <HuntMeter hunt={h} inside={h.placeKey !== v.scopeKey} />
              <div className={s.gridTiles}>
                <div className={s.row}><span className={s.eyebrow}>Spent so far</span><span className={s.big}>{usd(h.spentUsd)}</span><span className={s.meta}>AI charges we know the price of</span></div>
                <div className={s.row}><span className={s.eyebrow}>Set aside for work in progress</span><span className={s.big}>{usd(h.heldUsd)}</span><span className={s.meta}>Not spent yet. It can stay set aside after a worker stops, until the final charge is known.</span></div>
                <div className={s.row}><span className={s.eyebrow}>Left to spend</span>{huntLeftUsd(h) === null ? <><span className={cx(s.big, s.textWarn)}>Unknown</span><span className={s.meta}>Some charges have no price yet, so what’s left can’t be worked out</span></> : <><span className={cx(s.big, s.textGood)}>{usd(huntLeftUsd(h)!)}</span><span className={s.meta}>The limit, minus what’s spent and set aside</span></>}</div>
                <div className={s.row}><span className={s.eyebrow}>Charges with no price</span><span className={cx(s.big, h.unpricedEntries ? s.textWarn : undefined)}>{count(h.unpricedEntries)}</span><span className={s.meta}>Unknown, not $0. Some may be free steps or refused calls, so they aren’t all paid calls.</span></div>
              </div>
              <dl className={s.facts}>
                <dt>Limit in force</dt><dd>{usd(h.limitUsd)} lifetime, set by {h.limitSource}</dd>
                <dt>How it’s enforced</dt><dd>Before each AI request starts, money is set aside for it. It only starts if the total stays within the limit. The check happens in one step, so requests running at the same time can’t overspend.</dd>
                <dt>Includes</dt><dd>Every AI model, retry and set-aside amount (Haiku 4.5, Sonnet 5.5 and Opus 5.5 alike).</dd>
                {m && <><dt>Other services</dt><dd>{m.otherServices}</dd></>}
              </dl>
            </div>
          ))}
        </div>
      </Card>

      <SpendCard />

      <MonthsCard />

      <div className={s.grid2}>
        <Card title={`The account · ${m?.accountMonth ?? ""}`}>
          <SourceNote source={v.data.money} what="Account readings" />
          {m && (
            <>
              <div className={s.donutWrap}>
                <Donut parts={m.account.map((a, i) => ({ name: a.provider, amount: a.amountUsd, cls: CLS[i % CLS.length] }))} center={`${usd(known)} known${missing.length ? ` + ${missing.length} with no reading` : ""}`} />
                <ul className={s.stack} style={{ listStyle: "none", padding: 0, margin: 0, flex: "1 1 220px" }}>
                  {m.account.map((a, i) => (
                    <li key={a.provider} className={s.small}>
                      <span className={s.legendItem}><span className={cx(s.swatch, a.amountUsd === null ? s.gap : s[CLS[i % CLS.length]])} aria-hidden="true" /><strong>{a.provider}</strong></span>{" "}
                      <span className={cx(s.mono, a.amountUsd === null && s.textWarn)}>{a.amountUsd === null ? "No reading" : usd(a.amountUsd)}</span>
                      <span className={s.meta}> · {a.how}{a.old ? " · old reading" : ""}</span>
                    </li>
                  ))}
                </ul>
              </div>
              {!!m.monthlyPlans.length && <div className={s.stack}><h3 className={s.h3}>Monthly plans, shown apart</h3>{m.monthlyPlans.map((p) => <span key={p.name} className={s.small}>{p.name} · <span className={s.dim}>{p.note}</span></span>)}</div>}
            </>
          )}
        </Card>
        <Card title="Spending limits in force">
          <SourceNote source={v.data.money} what="Limits" />
          <div className={s.stack}>
            {list.map((h) => (
              <div key={h.id} className={s.row}>
                <span className={s.spread}><strong className={s.small}>{h.name} · lifetime</strong><span className={s.mono}>{usd(h.spentUsd + h.heldUsd)} / {usd(h.limitUsd)}</span></span>
                <div className={s.meter}><span className={s.meterFill} style={{ width: `${Math.min(100, ((h.spentUsd + h.heldUsd) / h.limitUsd) * 100)}%`, background: "var(--pill-cyan-text)" }} /></div>
                <span className={s.meta}>This hunt’s own limit: spent plus set aside. Checked before each AI request.</span>
              </div>
            ))}
            {m?.limits.map((l) => (
              <div key={l.name} className={s.row}>
                <span className={s.spread}><strong className={s.small}>{l.name}</strong><span className={s.mono}>{l.figure}</span></span>
                {l.fraction !== null && <div className={s.meter}><span className={s.meterFill} style={{ width: `${Math.min(100, l.fraction * 100)}%`, background: l.tone === "warn" ? "var(--pill-amber-text)" : "var(--pill-cyan-text)" }} /></div>}
                <span className={s.meta}>{l.note}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <ReconciliationCard />

      <Card title="AI costs, one piece of work at a time" aside={<span className={s.meta}>The costliest work of the last days. Models: Haiku 4.5 → Sonnet 5.5 → Opus 5.5. Older records keep the model actually used.</span>}>
        <SourceNote source={v.data.spend} what="Per-work costs" />
        {v.data.spend.data && !work.length && <Empty>No per-work AI costs recorded for {v.place.name} in the last {v.data.spend.data.windowDays} days.</Empty>}
        {!!work.length && (
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead><tr><th scope="col">Work</th><th scope="col">AI used</th><th scope="col" className={s.num}>Tries</th><th scope="col" className={s.num}>Cost</th><th scope="col">Why it moved up</th><th scope="col">What it got</th></tr></thead>
              <tbody>
                {work.map((d) => (
                  <tr key={d.work}>
                    <td>{d.work}</td>
                    <td className={s.small}>{d.models}</td>
                    <td className={s.num}>{d.tries}</td>
                    <td className={s.num}>{d.costUsd === null ? "Unknown" : usd(d.costUsd)}</td>
                    <td className={cx(s.small, d.movedUpWhy.includes("isn’t saved") && s.textWarn)}>{d.movedUpWhy}</td>
                    <td className={cx(s.small, d.benefit.startsWith("Found") ? s.textGood : s.dim)}>{d.benefit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className={cx(s.p, s.meta)}>A model’s level doesn’t prove it suits a job. When the reason for moving up isn’t saved, it says so.</p>
      </Card>
    </>
  );
}
