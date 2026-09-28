"use client";

/**
 * **MONEY.** One card per hunt (never added into a national budget), account
 * readings by provider with monthly plans apart, the limits in force, and AI
 * costs one piece of work at a time. Unknown is never $0; unpriced charges are
 * counted, not priced; money set aside is kept apart from money spent.
 */
import { Donut } from "./charts.tsx";
import { useV6 } from "./context.tsx";
import { count, huntLeftUsd, usd } from "./model.ts";
import { huntAt, huntsWithin, relation } from "./places.ts";
import { HuntMeter } from "./screen-now.tsx";
import { Card, cx, Empty, SourceNote } from "./ui.tsx";
import s from "./v6.module.css";

const CLS = ["c-blue", "c-teal", "c-amber", "c-violet", "c-coral", "c-gray"];

export function MoneyScreen() {
  const v = useV6();
  const m = v.data.money.data;
  const hunt = huntAt(v.index, v.hunts, v.scopeKey);
  const inside = huntsWithin(v.index, v.hunts, v.scopeKey);
  const list = hunt ? [hunt] : inside;
  const drill = (m?.drill ?? []).filter((d) => relation(v.index, d.applies, v.scopeKey) !== null);
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

      <Card title="AI costs, one piece of work at a time" aside={<span className={s.meta}>Models: Cheapest AI (Haiku 4.5) → Mid-level AI (Sonnet 5.5) → Strongest AI (Opus 5.5). Older records keep the model actually used.</span>}>
        <SourceNote source={v.data.money} what="Per-work costs" />
        {m && m.drill === null && <Empty>Per-work AI costs aren’t connected yet. This doesn’t mean there were none.</Empty>}
        {m && m.drill !== null && !drill.length && <Empty>No per-work AI costs recorded for {v.place.name}.</Empty>}
        {!!drill.length && (
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead><tr><th scope="col">Work</th><th scope="col">AI used</th><th scope="col" className={s.num}>Tries</th><th scope="col" className={s.num}>Cost</th><th scope="col">Why it moved up</th><th scope="col">What it got</th></tr></thead>
              <tbody>
                {drill.map((d) => (
                  <tr key={d.work}>
                    <td>{d.link ? <button type="button" className={s.btnLink} onClick={() => v.open(d.link!.type === "stuck" ? { type: "stuck", id: d.link!.id } : { type: "result", id: d.link!.id })}>{d.work}</button> : d.work}</td>
                    <td className={s.small}>{d.models}</td>
                    <td className={s.num}>{d.tries}</td>
                    <td className={s.num}>{d.costUsd === null ? "Unknown" : usd(d.costUsd)}</td>
                    <td className={cx(s.small, d.movedUpWhy.startsWith("Not recorded") && s.textWarn)}>{d.movedUpWhy}</td>
                    <td className={cx(s.small, d.benefit.startsWith("Checked") ? s.textGood : s.dim)}>{d.benefit}</td>
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
