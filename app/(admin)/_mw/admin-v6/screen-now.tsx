"use client";

/**
 * **NOW.** What readers can see, what is stuck and why, what is happening, what
 * it cost, and what Sean can do — for the selected place. The national map and
 * state table lead at country scope.
 */
import { useMemo, useState } from "react";

import { StatusBar, StatusLegend, StatusTable } from "./charts.tsx";
import { useV6 } from "./context.tsx";
import { SECTION_DEP } from "./dependencies.ts";
import { INSTRUCTION_EXAMPLES, parseInstruction, type Parsed } from "./instruction.ts";
import { count, huntLeftUsd, mst, ITEM_STATUS_ORDER, pctDown, usd, type Hunt, type Lane, type ReaderResult, type StateRow, type StuckItem } from "./model.ts";
import { TILE_LAYOUT } from "./national-layout.ts";
import { COUNTRY_KEY, huntAt, huntsWithin, isWithin, relation } from "./places.ts";
import { ReceiptCard } from "./receipt-view.tsx";
import { ageWords, missingByCard, roundReading, usePageClock, workersSectionArrived } from "./screen-workers.tsx";
import { ActionButton, Actions, Card, cx, Empty, Failed, Loading, Pill, SourceNote, StageDots } from "./ui.tsx";
import s from "./v6.module.css";

export const LANE_WORDS: Readonly<Record<Lane, string>> = {
  decision: "Needs your decision",
  auto: "Being fixed automatically",
  publisher: "Waiting for the publisher",
  software: "Needs a software fix",
};
export const LANE_TONE: Readonly<Record<Lane, "warn" | "good" | "slate" | "info">> = { decision: "warn", auto: "good", publisher: "slate", software: "info" };
export const LANE_MEANS: Readonly<Record<Lane, string>> = {
  decision: "Only you can move these. There’s no routine approval step.",
  auto: "The system is repairing these with a plan and a next try time.",
  publisher: "The source itself hasn’t posted or fixed this yet.",
  software: "Our code has to change first. Raising priority doesn’t deploy anything.",
};

export function useScoped() {
  const v = useV6();
  return useMemo(() => {
    const stuck = (v.data.stuck.data ?? []).map((i) => ({ item: i, rel: relation(v.index, i.applies, v.scopeKey) })).filter((x) => x.rel !== null) as { item: StuckItem; rel: "local" | "shared" }[];
    const results = (v.data.results.data ?? []).map((r) => ({ r, rel: relation(v.index, r.applies, v.scopeKey) })).filter((x) => x.rel !== null) as { r: ReaderResult; rel: "local" | "shared" }[];
    return { stuck, results };
  }, [v.data.stuck.data, v.data.results.data, v.index, v.scopeKey]);
}

export function NowScreen() {
  const v = useV6();
  const loading = v.data.stuck.load === "loading" && v.data.results.load === "loading";
  return (
    <>
      <header>
        <p className={s.eyebrow}>{v.place.name} · Account period: {v.period === "day" ? "Last 24 hours" : v.period === "hunt" ? "Whole hunt" : "September 2026"}</p>
        <h1 className={s.h1}>Now</h1>
      </header>
      {/* The control Sean uses most (daily budget, paid search, start a hunt): first under the header, one click to open. */}
      <DirectWork />
      {v.scopeKey === COUNTRY_KEY && <National />}
      <Instruction />
      <NextSteps />
      {loading ? <Loading what="this place" /> : <SixAnswers />}
      <Readers />
      <Stuck />
      <Missing />
      <Happening />
      <Cost />
      <Recent />
    </>
  );
}

/* ---------------------------------------------------------------- national */

type NatSort = "stuck" | "hunts" | "items" | "name";

function compareRows(sort: NatSort, a: StateRow, b: StateRow): number {
  const by = sort === "stuck" ? (b.stuck ?? -1) - (a.stuck ?? -1) : sort === "hunts" ? (b.hunts ?? -1) - (a.hunts ?? -1) : sort === "items" ? (b.checklistItems ?? -1) - (a.checklistItems ?? -1) : 0;
  return by || a.name.localeCompare(b.name);
}

function National() {
  const v = useV6();
  const [sort, setSort] = useState<NatSort>("stuck");
  const [all, setAll] = useState(false);
  const rows = v.data.national.data ?? [];
  const known = v.data.national.state === "live" || v.data.national.state === "sample";
  const byCode = new Map(rows.map((r) => [r.code, r]));
  const sorted = [...rows].sort((a, b) => compareRows(sort, a, b));
  const shown = all ? sorted : sorted.filter((r) => r.tracked || (r.hunts ?? 0) > 0);
  const hunts = rows.reduce((a, r) => a + (r.hunts ?? 0), 0);
  const tracked = rows.filter((r) => r.tracked).length;
  const huntCount = v.data.hunts.state === "not-connected" ? null : v.hunts.filter((h) => h.status !== "stopped").length;
  return (
    <Card id="v6-national" title="The country" aside={<span className={s.meta}>{rows.length} states and territories{huntCount !== null ? ` · ${huntCount} hunts running at the same time, each with its own limit` : ""} · {tracked} tracked</span>}>
      <SourceNote source={v.data.national} what="State figures" />
      <div className={s.nation}>
        <div className={s.stack}>
          <div className={s.map} role="group" aria-label="Map of states and territories. Choose one to open it.">
            {TILE_LAYOUT.map(([code, r, c]) => {
              const row = byCode.get(code);
              const key = `st:${code.toLowerCase()}`;
              const hasHunt = (row?.hunts ?? 0) > 0 || huntsWithin(v.index, v.hunts, key).length > 0;
              const selected = isWithin(v.index, v.scopeKey, key);
              const name = row?.name ?? code;
              const stuck = (row?.stuck ?? 0) > 0;
              const words = `${name}${hasHunt ? ", has a hunt" : row?.tracked ? ", tracked, no hunt" : ", no hunt yet"}${row?.stuck === null ? "" : stuck ? `, ${row?.stuck} stuck` : ""}`;
              return (
                <button key={code} type="button" className={cx(s.tile, hasHunt ? s.tileHunt : row?.tracked && s.tileTracked, selected && s.tileSelected)} style={{ gridRow: r + 1, gridColumn: c + 1 }}
                  aria-label={words} title={words} onClick={() => v.setScope(key)}>
                  {code}{stuck && <span className={s.stuckDot} aria-hidden="true" />}
                </button>
              );
            })}
          </div>
          <div className={s.legend}>
            <span className={s.legendItem}><span className={cx(s.swatch)} style={{ background: "var(--pill-cyan-bg)", boxShadow: "inset 0 0 0 1px var(--pill-cyan-text)" }} />Has a hunt</span>
            <span className={s.legendItem}><span className={s.swatch} style={{ background: "var(--surface)", boxShadow: "inset 0 0 0 1px var(--lumen-rim-strong)" }} />Tracked, no hunt</span>
            <span className={s.legendItem}><span className={s.swatch} style={{ border: "1px dashed var(--panel-border)" }} />No hunt; coverage unknown</span>
            <span className={s.legendItem}><span className={s.swatch} style={{ background: "var(--pill-amber-text)", borderRadius: "50%", width: 8, height: 8 }} />Has stuck items</span>
          </div>
        </div>
        <div className={s.stack}>
          <div className={s.inline}>
            <span className={s.meta}>Sort by</span>
            {(["stuck", "hunts", "items", "name"] as const).map((k) => (
              <button key={k} type="button" className={s.tab} aria-pressed={sort === k} onClick={() => setSort(k)}>{({ stuck: "Most stuck", hunts: "Hunts", items: "Checklist items", name: "Name" })[k]}</button>
            ))}
          </div>
          <div className={s.tableWrap} style={{ maxHeight: 360, overflowY: "auto" }}>
            <table className={s.table}>
              <caption className={s.srOnly}>States and territories, sorted by {sort}</caption>
              <thead><tr><th scope="col">Place</th><th scope="col" className={s.num}>Hunts</th><th scope="col" className={s.num}>Stuck</th><th scope="col">Checklist items</th></tr></thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.code}>
                    <td><button type="button" className={s.btnLink} onClick={() => v.setScope(r.placeKey)}>{r.name}</button></td>
                    <td className={s.num}>{r.hunts ?? "—"}</td>
                    <td className={cx(s.num, (r.stuck ?? 0) > 0 && s.textWarn)}>{r.stuck ?? "—"}</td>
                    <td className={r.checklistItems === null ? s.dim : undefined}>{r.checklistItems === null ? (known && r.hunts === 0 ? "No hunt · coverage unknown" : "Not reported yet") : `${count(r.checklistItems)} checklist items`}</td>
                  </tr>
                ))}
                {!shown.length && <tr><td colSpan={4} className={s.dim}>No tracked states or hunts yet. Show all 56 to browse every state and territory.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className={s.inline}>
            <button type="button" className={s.btn} aria-pressed={all} onClick={() => setAll(!all)}>{all ? "Show only tracked states and hunts" : `Show all ${rows.length}, including those with unknown coverage`}</button>
          </div>
          <p className={cx(s.p, s.meta)}>Unknown coverage isn’t zero, and having no hunt isn’t the same as never being searched. {hunts ? "Each hunt keeps its own limit; they are never added into one national budget." : ""}</p>
        </div>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------ instruction */

function Instruction() {
  const v = useV6();
  const { text, chosenBody } = v.instructionDraft;
  const setText = (next: string) => v.setInstructionDraft({ text: next, chosenBody: null });
  const setChosenBody = (next: string | null) => v.setInstructionDraft({ text, chosenBody: next });
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const readBack = (t = text, body = chosenBody) => {
    if (!t.trim()) return;
    setParsed(parseInstruction({ text: t, scope: v.scopeKey, places: v.places, index: v.index, stuck: v.data.stuck.data ?? [], chosenBody: body }));
  };
  const acts = (parsed?.actions ?? []).map((a) => ({ a, def: v.defOf({ kind: a.kind, target: a.target }), why: v.whyNot({ kind: a.kind, target: a.target, payload: a.payload }) }));
  return (
    <Card id="v6-instruct" title="Tell it what to do">
      <p className={cx(s.p, s.small, s.dim)}>Say what you want in plain words. It reads your words back as specific actions for {v.place.name} before anything is sent. Nothing is sent until you confirm, and each action still opens its own preview.</p>
      <label className={s.srOnly} htmlFor="v6-instruct-input">Your instruction</label>
      <textarea id="v6-instruct-input" className={s.textarea} value={text} placeholder="For example: Reprocess the files we already saved" onChange={(e) => { setText(e.target.value); setParsed(null); }} />
      <div className={s.inline}>
        <button type="button" className={cx(s.btn, s.btnPrimary)} aria-disabled={!text.trim() ? "true" : undefined} onClick={() => readBack()}>Read it back</button>
        <span className={s.meta}>Examples:</span>
        {INSTRUCTION_EXAMPLES.slice(0, 4).map((ex) => <button key={ex} type="button" className={cx(s.btn, s.btnGhost)} style={{ whiteSpace: "normal", textAlign: "left", overflowWrap: "anywhere" }} onClick={() => { setText(ex); setParsed(null); }}>{ex}</button>)}
      </div>
      {parsed && (
        <div className={s.stack} role="region" aria-label="Read-back" aria-live="polite">
          <p className={cx(s.p, s.small)}>Read back from: “{parsed.text}”</p>
          {parsed.unsupported && <p className={s.why}>None of this matches an action the system can take, so nothing will be sent. Try one of the examples, or use the buttons on the item itself.</p>}
          {parsed.clarify && (
            <div className={s.row}>
              <strong className={s.small}>{parsed.clarify.question}</strong>
              {parsed.clarify.options.length ? (
                <select className={s.select} value={chosenBody ?? ""} onChange={(e) => { setChosenBody(e.target.value || null); readBack(text, e.target.value || null); }}>
                  <option value="">Choose one</option>
                  {parsed.clarify.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : <span className={s.meta}>No matching item in {v.place.name}. Change the place first.</span>}
            </div>
          )}
          {acts.map(({ a, def, why }) => {
            const pv = def.preview({ target: a.target, targetName: v.nameOf(a.target), scopeName: v.index.get(a.target)?.name ?? v.place.name, scopeIsCountry: a.target === COUNTRY_KEY, url: a.payload?.url, outreachAuthorized: v.access.outreachAuthorized });
            return (
              <div key={`${a.kind}|${a.target}`} className={s.row}>
                <div className={s.spread}><strong className={s.small}>{def.label}</strong><Pill tone={pv.level === "global" ? "warn" : "neutral"}>{pv.level === "global" ? "Whole system" : "Local"}</Pill></div>
                {pv.rows.slice(0, 3).map(([k, val]) => <span key={k} className={s.small}><span className={s.dim}>{k}:</span> {val}</span>)}
                {why ? <p className={s.why}>Won’t be sent: {why}</p> : <div><ActionButton action={{ kind: a.kind, target: a.target, payload: a.payload }} label="Preview and send" primary /></div>}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------ next steps */

function NextSteps() {
  const v = useV6();
  const { stuck } = useScoped();
  const ranked = stuck
    .filter(({ item }) => item.lane === "decision" || item.readersAffected || (item.unlocks ?? 0) > 1)
    .map(({ item }) => ({ item, score: (item.readersAffected ? 4 : 0) + (item.lane === "decision" ? 3 : 0) + (item.unlocks ?? 0) + item.ageRank }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);
  const decided = v.data.decided.data ?? [];
  return (
    <Card id="v6-steps" title="Suggested next steps" aside={<span className={s.meta}>Ranked by readers affected, needs you, work it unlocks, and how long it’s waited</span>}>
      <SourceNote source={v.data.stuck} what="Next steps" />
      {v.data.stuck.state !== "not-connected" && !ranked.length && <Empty>Nothing here needs you right now.</Empty>}
      <ol className={s.stack} style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {ranked.map(({ item }, n) => {
          const last = v.receipts.find((r) => [item.id, item.resultId, item.fixId, item.decision?.id].includes(r.target));
          return (
            <li key={item.id} className={s.row}>
              <div className={s.spread}>
                <span className={s.inline}><strong className={s.mono}>{n + 1}</strong><Pill tone={LANE_TONE[item.lane]}>{LANE_WORDS[item.lane]}</Pill><span className={s.meta}>{v.index.get(item.applies[0])?.name}</span></span>
                <span className={cx(s.meta, s.mono)}>{item.readersAffected ? "READERS AFFECTED · " : ""}{item.lane === "decision" ? "NEEDS YOU · " : ""}UNLOCKS {item.unlocks ?? 0} · WAITING {item.age.toUpperCase()}</span>
              </div>
              <button type="button" className={s.btnLink} onClick={() => v.open({ type: "stuck", id: item.id })}><strong>{item.title}</strong></button>
              <p className={cx(s.p, s.small, s.dim)}>{item.next}</p>
              <Actions actions={item.actions.slice(0, 2)} primaryFirst />
              {last && <span className={s.small}>Latest: {last.label} · <span className={last.status === "unknown" || last.status === "refused" || last.status === "failed" ? s.textWarn : s.textGood}>{last.statusWords}</span></span>}
            </li>
          );
        })}
      </ol>
      {(decided.length > 0 || v.data.decided.state !== "not-connected") && (
        <div className={s.stack}>
          <h3 className={s.h3}>Already decided, waiting on implementation</h3>
          <SourceNote source={v.data.decided} />
          {decided.map((d) => <div key={d.title} className={s.row}><strong className={s.small}>{d.title}</strong><span className={s.meta}>{d.state}</span></div>)}
        </div>
      )}
    </Card>
  );
}

/* ----------------------------------------------------------- six answers */

export function checklistTotals(counts: readonly (readonly number[])[] | null): number[] | null {
  if (!counts) return null;
  const t = ITEM_STATUS_ORDER.map(() => 0);
  for (const c of counts) c.forEach((n, i) => (t[i] += n));
  return t;
}

function SixAnswers() {
  const v = useV6();
  const { stuck, results } = useScoped();
  const local = results.filter((x) => x.rel === "local");
  const shared = results.filter((x) => x.rel === "shared");
  const ver = local.filter((x) => x.r.stages[5] === "done").length;
  const pub = local.filter((x) => x.r.stages[4] === "done" && x.r.stages[5] !== "done").length;
  const totals = checklistTotals(v.data.checklist.data?.placeGroups?.map((g) => g.counts) ?? null);
  const N = totals ? totals.reduce((a, b) => a + b, 0) : null;
  const harm = stuck.filter((x) => x.item.readersAffected).length;
  const dec = stuck.filter((x) => x.item.lane === "decision").length;
  const hunt = huntAt(v.index, v.hunts, v.scopeKey);
  const inside = huntsWithin(v.index, v.hunts, v.scopeKey);
  const multi = !hunt && inside.length > 1;
  const hf: Hunt | null = hunt ?? (inside.length === 1 ? inside[0] : null);
  const left = (h: Hunt) => { const n = huntLeftUsd(h); return n === null ? "Unknown" : usd(n); };
  /** Research workers on a hunt, or null when its run state isn't reported. */
  const workers = (h: Hunt) => (h.status === "running" ? h.researchWorkers : h.status === "unreported" ? null : 0);
  const insideWorkers = inside.map(workers);
  const resultsKnown = v.data.results.state !== "not-connected";
  const stuckKnown = v.data.stuck.state !== "not-connected";
  const huntsKnown = v.data.hunts.state !== "not-connected";
  const answers: { q: string; big: string; small: string; href: string; warn?: boolean }[] = [
    { q: "Readers received", big: resultsKnown ? `${ver} checked on the page` : "Not reported", small: resultsKnown ? `${pub} published, not checked on the page · ${shared.length} shared results also cover it` : "Needs reader proof from the backend", href: "#v6-readers" },
    { q: "Still missing", big: N !== null && totals ? count(N - totals[0]) : "—", small: N !== null ? `of ${count(N)} checklist items not yet checked on the public page` : "No checklist items reported for this place yet", href: "#v6-missing" },
    { q: "Happening now", big: multi ? (insideWorkers.includes(null) ? "—" : String(insideWorkers.reduce<number>((a, n) => a + (n ?? 0), 0))) : hf ? (workers(hf) === null ? "—" : String(workers(hf))) : "—", small: multi ? (insideWorkers.includes(null) ? `${inside.length} hunts · whether paid work is running isn’t reported yet` : `research workers across ${inside.length} hunts, at the same time`) : hf ? (hf.status === "unreported" ? `${hf.name} · whether paid work is running isn’t reported yet` : hf.status === "running" ? (hf.researchWorkers === null ? `${hf.name} is running · worker count not reported` : `research workers on the ${hf.name}`) : `${hf.name} is ${hf.status}`) : huntsKnown ? "No hunt here · shared work isn’t split by place" : "Hunts not reported yet", href: "#v6-happening" },
    { q: "Stuck", big: stuckKnown ? String(stuck.length) : "Not reported", small: stuckKnown ? `${harm} affecting readers · ${stuck.filter((x) => x.rel === "shared").length} through shared work` : "Needs stuck items from the backend", href: "#v6-stuck", warn: harm > 0 },
    { q: "Your decisions", big: stuckKnown ? String(dec) : "—", small: dec ? "See Suggested next steps" : stuckKnown ? "Nothing needs you here" : "Not reported yet", href: "#v6-steps", warn: dec > 0 },
    { q: "Hunt money", big: multi ? `${inside.length} hunts` : hf ? left(hf) : "—", small: multi ? `Each has its own limit. There’s no national budget. ${inside.map((h) => `${h.name}: ${left(h)} left of ${usd(h.limitUsd)}`).join(" · ")}` : hf ? `${hf.name}${hf.placeKey !== v.scopeKey ? " (inside)" : ""} · left of ${usd(hf.limitUsd)} · ${usd(hf.spentUsd)} spent · ${usd(hf.heldUsd)} set aside` : huntsKnown ? "No hunt here · account totals under Money" : "Hunts not reported yet", href: "#v6-cost" },
  ];
  return (
    <section aria-label="Six answers" className={s.answers}>
      {answers.map((a) => (
        <a key={a.q} href={a.href} className={cx(s.answer, a.warn && s.answerWarn)}>
          <span className={s.eyebrow}>{a.q}</span>
          <span className={cx(s.big, a.warn && s.textWarn)}>{a.big}</span>
          <span className={s.meta}>{a.small}</span>
        </a>
      ))}
    </section>
  );
}

/* -------------------------------------------------------------- readers */

export function ResultRow(props: { readonly r: ReaderResult; readonly shared?: boolean }) {
  const v = useV6();
  const r = props.r;
  const tone = r.kind === "New" ? "good" : r.kind === "Updated" ? "info" : r.kind === "Retained" ? "gold" : "neutral";
  return (
    <button type="button" className={cx(s.row, s.rowButton, props.shared && s.rowShared)} onClick={() => v.open({ type: "result", id: r.id })}>
      <span className={s.spread}><strong style={{ fontSize: 13 }}>{r.title}</strong><Pill tone={tone}>{r.kind}</Pill></span>
      <span className={s.inline}><StageDots stages={r.stages} /><span className={s.meta}>{v.index.get(r.applies[0])?.name}{props.shared ? " · shared work" : ""}</span></span>
      <span className={cx(s.small, r.problem ? s.textWarn : s.dim)}>{r.readerSees}</span>
    </button>
  );
}

function Readers() {
  const v = useV6();
  const { results } = useScoped();
  const local = results.filter((x) => x.rel === "local");
  const shared = results.filter((x) => x.rel === "shared");
  return (
    <Card id="v6-readers" title="What readers can see" aside={<span className={s.meta}>Found · Saved · Facts pulled out · Facts checked against sources · Published · Checked on the public page</span>}>
      <SourceNote source={v.data.results} what="Reader results" />
      {v.data.results.load === "failed" && !v.data.results.data && <Failed what="Reader results" />}
      {v.data.results.state !== "not-connected" && !local.length && <Empty>No results for {v.place.name} itself yet.</Empty>}
      <div className={s.stack}>{local.map((x) => <ResultRow key={x.r.id} r={x.r} />)}</div>
      {!!shared.length && (
        <div className={s.stack}>
          <h3 className={s.h3}>Shared work that also covers {v.place.name} · counted where it belongs, not here</h3>
          {shared.map((x) => <ResultRow key={x.r.id} r={x.r} shared />)}
        </div>
      )}
    </Card>
  );
}

/* ---------------------------------------------------------------- stuck */

export function StuckRow(props: { readonly item: StuckItem; readonly shared?: boolean; readonly withActions?: boolean }) {
  const v = useV6();
  const i = props.item;
  return (
    <div className={cx(s.row, props.shared && s.rowShared)}>
      <div className={s.spread}>
        <button type="button" className={s.btnLink} onClick={() => v.open({ type: "stuck", id: i.id })}><strong style={{ fontSize: 13, color: "var(--text)" }}>{i.title}</strong></button>
        <Pill tone={LANE_TONE[i.lane]}>{LANE_WORDS[i.lane]}</Pill>
      </div>
      <span className={s.meta}>{v.index.get(i.applies[0])?.name}{props.shared ? " · shared work" : ""} · stuck {i.age} · {i.owner}</span>
      <span className={s.small}>{i.cause}</span>
      {i.readersAffected && <span className={cx(s.small, s.textWarn)}>Readers are affected.</span>}
      {i.latest && <span className={cx(s.small, s.textGood)}>{i.latest}</span>}
      {props.withActions && <Actions actions={i.actions} primaryFirst />}
    </div>
  );
}

const STUCK_SHOWN_ON_NOW = 6;

function Stuck() {
  const v = useV6();
  const { stuck } = useScoped();
  const [lane, setLane] = useState<Lane | "all">("all");
  const shown = lane === "all" ? stuck : stuck.filter((x) => x.item.lane === lane);
  const lanes: (Lane | "all")[] = ["all", "decision", "auto", "publisher", "software"];
  return (
    <Card id="v6-stuck" title="What’s stuck" aside={<button type="button" className={s.btnLink} onClick={() => v.go("work")}>See all work →</button>}>
      <SourceNote source={v.data.stuck} what="Stuck items" />
      {v.data.stuck.load === "failed" && !v.data.stuck.data && <Failed what="Stuck items" />}
      {v.data.stuck.load === "loading" && <Loading what="stuck items" />}
      {v.data.stuck.state !== "not-connected" && (
        <div className={s.tabs} role="group" aria-label="Filter by who moves it">
          {lanes.map((k) => (
            <button key={k} type="button" className={s.tab} aria-pressed={lane === k} onClick={() => setLane(k)}>
              {k === "all" ? "Everything" : LANE_WORDS[k]}<span className={s.tabCount}>{k === "all" ? stuck.length : stuck.filter((x) => x.item.lane === k).length}</span>
            </button>
          ))}
        </div>
      )}
      {v.data.stuck.state !== "not-connected" && !shown.length && <Empty>{lane === "auto" ? "No automatic repair is recorded here. That doesn’t mean nothing is failing." : `Nothing ${lane === "all" ? "is stuck" : "in this group"} in ${v.place.name}.`}</Empty>}
      <div className={s.stack}>{shown.slice(0, STUCK_SHOWN_ON_NOW).map((x) => <StuckRow key={x.item.id} item={x.item} shared={x.rel === "shared"} withActions />)}</div>
      {shown.length > STUCK_SHOWN_ON_NOW && <p className={cx(s.p, s.meta)}>The {STUCK_SHOWN_ON_NOW} most urgent of {count(shown.length)} listed here. <button type="button" className={s.btnLink} onClick={() => v.go("work")}>See them grouped by cause →</button></p>}
    </Card>
  );
}

/* --------------------------------------------------------------- missing */

function Missing() {
  const v = useV6();
  const groups = v.data.checklist.data?.placeGroups ?? null;
  const totals = checklistTotals(groups?.map((g) => g.counts) ?? null);
  const N = totals ? totals.reduce((a, b) => a + b, 0) : 0;
  const defs = v.data.checklist.data?.definitionCount ?? 0;
  return (
    <Card id="v6-missing" title="What’s still missing" aside={<button type="button" className={s.btnLink} onClick={() => v.go("checklist")}>Open the checklist →</button>}>
      <SourceNote source={{ ...v.data.checklist, state: groups ? v.data.checklist.state : v.data.checklist.state === "sample" ? "sample" : "not-connected" }} what="Checklist counts" />
      {totals && N > 0 ? (
        <>
          <p className={cx(s.p, s.small)}>
            {count(N)} checklist items apply to {v.place.name} from the {defs} definitions. Checked on a public page: {count(totals[0])} ({pctDown(totals[0], N)}). Published but not checked on the page: {count(totals[1])}. Collected but not published yet: {count(totals[2])}. We know it applies for {count(N - totals[5])}; not sure for {count(totals[5])}. A checklist item isn’t one record: one item can cover many meetings or filings.
          </p>
          <StatusBar counts={totals} label={`All checklist items in ${v.place.name}`} tall />
          <StatusLegend />
          <StatusTable rows={[{ name: `All groups in ${v.place.name}`, counts: totals }]} />
        </>
      ) : groups ? <Empty>No checklist items are set up for {v.place.name} yet. They’re created when work is assigned here. Shared national records still cover its residents and are counted under the United States.</Empty> : null}
    </Card>
  );
}

/* ------------------------------------------------------------- happening */

function Happening() {
  const v = useV6();
  const now = usePageClock();
  const src = v.data.workers;
  const w = src.data;
  const arrived = workersSectionArrived(src);
  const miss = missingByCard(arrived ? src.missingParts?.map((m) => v.scopeKey.includes(":") ? m.replaceAll(v.scopeKey, v.place.name) : m) : undefined);
  const isCountry = v.place.kind === "Country";
  const jobs = w?.jobs ? w.jobs.filter((j) => relation(v.index, [j.placeKey], v.scopeKey) !== null) : null;
  const waiting = w?.waiting ? w.waiting.filter((x) => relation(v.index, x.applies, v.scopeKey) !== null) : null;
  const lanes = w?.status.lanes;
  const round = roundReading(w?.status, now);
  const progress = w?.status.lastUsefulProgress ?? null;
  return (
    <Card id="v6-happening" title="What’s happening now" aside={<button type="button" className={s.btnLink} onClick={() => v.go("workers")}>Open Workers →</button>}>
      <div className={s.gridTiles}>
        <div className={s.row}>
          <span className={s.big}>{jobs ? jobs.length : "Unknown"}</span>
          <span className={s.meta}>{jobs ? `jobs working now in ${v.place.name}` : `jobs working now${isCountry ? "" : ` in ${v.place.name}`}. The full list of running jobs isn’t available yet, so this isn’t zero`}</span>
        </div>
        <div className={s.row}>
          <span className={s.big}>{waiting ? waiting.length : "Unknown"}</span>
          <span className={s.meta}>{waiting ? `waiting${isCountry ? "" : ` in ${v.place.name}`}, each with a reason${waiting.length ? `: ${waiting.slice(0, 2).map((x) => x.title).join(" · ")}${waiting.length > 2 ? ` · and ${waiting.length - 2} more` : ""}` : ""}` : arrived ? `A complete waiting list for ${v.place.name} isn’t available` : "Waiting reasons haven’t arrived yet"}</span>
        </div>
        <div className={s.row}>
          <span className={s.big}>{progress ? mst(progress.at, false) : "Unknown"}</span>
          <span className={s.meta}>{progress ? `last useful progress (${ageWords(progress.at, now) ?? ""}): ${progress.what}` : `last useful progress. ${miss.progress.length ? miss.progress.join(" ") : "A check-in isn’t progress, so nothing is inferred from it."}`}</span>
        </div>
        <div className={cx(s.row, round.overdue && s.cardWarn)}>
          <span className={cx(s.big, round.overdue && s.textWarn)}>{round.overdue ? "Late" : round.headline}</span>
          <span className={s.meta}>{round.overdue ? `${round.headline}. ${round.detail}` : round.detail}</span>
        </div>
      </div>
      {!jobs && lanes && (
        <div className={s.stack}>
          <p className={cx(s.p, s.meta)}>{isCountry ? "Whole system:" : `Whole system, every place, not just ${v.place.name}:`}</p>
          <div className={s.gridTiles}>
            {lanes.map((l) => (
              <div key={l.name} className={s.row}>
                <span className={s.big}>{l.active ?? "Unknown"}<span className={s.meta}> running · {count(l.waiting)} waiting</span></span>
                <span className={s.meta}>{l.name}, whole system{l.blockedBy ? ` · ${l.blockedBy}` : ""}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {!arrived && <SourceNote source={{ state: "not-connected", load: "ready", data: null, asOf: null, dependency: SECTION_DEP.workers }} />}
    </Card>
  );
}

/* ----------------------------------------------------------------- cost */

function Cost() {
  const v = useV6();
  const hunt = huntAt(v.index, v.hunts, v.scopeKey);
  const inside = huntsWithin(v.index, v.hunts, v.scopeKey);
  const list = hunt ? [hunt] : inside;
  return (
    <Card id="v6-cost" title="What it has cost" aside={<button type="button" className={s.btnLink} onClick={() => v.go("money")}>Open Money →</button>}>
      <SourceNote source={v.data.hunts} what="Hunt money" />
      {v.data.hunts.state !== "not-connected" && !list.length && <Empty>No hunt here, so there’s no hunt limit. Costs for shared work that covers {v.place.name} aren’t split by place yet.</Empty>}
      <div className={s.grid2}>
        {list.map((h) => <HuntMeter key={h.id} hunt={h} inside={h.placeKey !== v.scopeKey} />)}
      </div>
      {list.length > 1 && <p className={cx(s.p, s.meta)}>{list.length} hunts run inside {v.place.name}, each with its own lifetime limit. They are never added into one budget.</p>}
    </Card>
  );
}

export function HuntMeter(props: { readonly hunt: Hunt; readonly inside?: boolean }) {
  const h = props.hunt;
  const left = huntLeftUsd(h);
  return (
    <div className={s.row}>
      <strong className={s.small}>{h.name} · Anthropic · lifetime{props.inside ? " (inside this place)" : ""}</strong>
      <div className={s.meter} role="img" aria-label={`${usd(h.spentUsd)} spent and ${usd(h.heldUsd)} set aside of ${usd(h.limitUsd)}`}>
        <span className={s.meterFill} style={{ width: `${Math.min(100, (h.spentUsd / h.limitUsd) * 100)}%`, background: "var(--pill-cyan-text)" }} />
        <span className={s.meterHeld} style={{ width: `${Math.min(100, (h.heldUsd / h.limitUsd) * 100)}%` }} />
      </div>
      <span className={s.small}>{usd(h.spentUsd)} spent · {usd(h.heldUsd)} set aside for work in progress · {left === null ? <span className={s.textWarn}>amount left unknown</span> : <span className={s.textGood}>{usd(left)} left</span>} of {usd(h.limitUsd)}</span>
      {h.unpricedEntries > 0 && <span className={cx(s.small, s.textWarn)}>{count(h.unpricedEntries)} charges were saved without a price. The real cost may be higher than shown.</span>}
    </div>
  );
}

/* ----------------------------------------------------------- direct work */

function DirectWork() {
  const v = useV6();
  const hunt = huntAt(v.index, v.hunts, v.scopeKey);
  const inside = huntsWithin(v.index, v.hunts, v.scopeKey);
  const cards = hunt ? [hunt] : inside;
  const [open, setOpen] = useState(!!hunt);
  // Start a hunt and the whole-system controls are what gets used most, so a place with many hunts inside it shows them first;
  // a place that has its own hunt shows that hunt first.
  const huntCards = (
    <>
      {cards.map((h) => (
        <div key={h.id} className={s.row}>
          <div className={s.spread}><strong>{h.name}</strong><span className={cx(s.small, h.status === "running" ? s.textGood : s.textWarn)}>{({ running: "Running", paused: "Paid work paused", stopped: "Stopped", unreported: "Run state not reported" })[h.status]}{h.status === "running" ? (h.researchWorkers === null ? " · worker count not reported" : ` · ${h.researchWorkers} research workers`) : ""}</span></div>
          <span className={s.meta}>Started {h.startedAt.includes("T") ? mst(h.startedAt) : h.startedAt} · {usd(h.limitUsd)} lifetime · {usd(h.spentUsd + h.heldUsd)} spent or set aside</span>
          <Actions actions={[{ kind: h.status === "paused" ? "hunt-resume" : "hunt-pause", target: h.placeKey }, { kind: "hunt-limit", target: h.placeKey }, { kind: "hunt-stop", target: h.placeKey }]} />
        </div>
      ))}
    </>
  );
  return (
    <details className={s.card} open={open || !!hunt} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className={s.h2} style={{ cursor: "pointer" }}>Direct work</summary>
      <div className={s.stack} style={{ marginTop: 12 }}>
        {!!hunt && huntCards}
        <div className={s.row}>
          <strong className={s.small}>Start a hunt</strong>
          <span className={s.meta}>{v.place.kind === "Country" ? "Choose a state, county, ZIP or body first." : inside.length && !cards.some((h) => h.placeKey === v.scopeKey) ? `A hunt already runs inside ${v.place.name}. A new one here reuses its work and keeps its own limit.` : "Creates checklist work from the registry. Money is set aside before each call."}</span>
          <Actions actions={[{ kind: "hunt-start", target: v.scopeKey }]} primaryFirst />
        </div>
        <div className={s.row}>
          <strong className={s.small}>In {v.place.name}</strong>
          <Actions actions={[{ kind: "scope-first", target: v.scopeKey }, { kind: "scope-recheck", target: v.scopeKey }, { kind: "scope-stop", target: v.scopeKey }]} />
        </div>
        <div className={cx(s.row, s.cardGlobal)}>
          <strong className={s.small}>Whole system · affects every state</strong>
          <Actions actions={[{ kind: "global-paid", target: "system" }, { kind: "global-paid-resume", target: "system" }, { kind: "global-ceiling", target: "system" }, { kind: "global-search-on", target: "system" }, { kind: "global-search-off", target: "system" }, { kind: "global-runner-pause", target: "runner" }, { kind: "global-runner-resume", target: "runner" }]} />
        </div>
        {!hunt && huntCards}
      </div>
    </details>
  );
}

/* ---------------------------------------------------------------- recent */

function Recent() {
  const v = useV6();
  const [all, setAll] = useState(false);
  const list = v.receipts.filter((r) => all || v.scopeKey === COUNTRY_KEY || relation(v.index, [r.scopeKey], v.scopeKey) !== null).slice(0, 5);
  return (
    <Card title={`Your recent instructions · ${all || v.scopeKey === COUNTRY_KEY ? "all places" : `${v.place.name} and shared`}`}
      aside={<span className={s.inline}>{v.scopeKey !== COUNTRY_KEY && <button type="button" className={s.btn} aria-pressed={all} onClick={() => setAll(!all)}>{all ? `Only ${v.place.name}` : "Show all places"}</button>}<button type="button" className={s.btnLink} onClick={() => v.go("work")}>Full history →</button></span>}>
      {v.data.history.state !== "live" && <SourceNote source={v.data.history} what="Saved instructions" />}
      {!list.length && <Empty>No instructions {all || v.scopeKey === COUNTRY_KEY ? "yet" : `for ${v.place.name} yet`}.</Empty>}
      <div className={s.stack}>{list.map((r) => <ReceiptCard key={r.key} receipt={r} compact />)}</div>
    </Card>
  );
}
