"use client";

/**
 * **NOW.** What readers can see, what is stuck and why, what is happening, what
 * it cost, and what Sean can do — for the selected place. The national map and
 * state table lead at country scope.
 */
import { useMemo, useState } from "react";

import { periodLabel } from "@/lib/control-plane/admin-view/periods.ts";

import { StatusBar, StatusLegend, StatusTable } from "./charts.tsx";
import { useV6 } from "./context.tsx";
import { count, huntLeftUsd, mst, ITEM_STATUS_ORDER, pctDown, usd, type Hunt, type Lane, type ReaderResult, type StateRow, type StuckItem } from "./model.ts";
import { TILE_LAYOUT } from "./national-layout.ts";
import { COUNTRY_KEY, huntAt, huntsWithin, isWithin, nationalDepth, relation } from "./places.ts";
import { ReceiptCard } from "./receipt-view.tsx";
import { ageWords, roundReading, runningCount, systemRunningCount, usePageClock } from "./screen-workers.tsx";
import { Actions, Card, cx, Empty, Loading, Pill, StageDots } from "./ui.tsx";
import s from "./v6.module.css";

export const LANE_WORDS: Readonly<Record<Lane, string>> = {
  decision: "Needs your decision",
  auto: "Being fixed automatically",
  publisher: "Waiting for the publisher",
  software: "Needs a software fix",
};
export const LANE_TONE: Readonly<Record<Lane, "warn" | "good" | "slate" | "info">> = { decision: "warn", auto: "good", publisher: "slate", software: "info" };
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
        <p className={s.eyebrow}>{v.place.name} · {periodLabel(v.period, new Date())}</p>
        <h1 className={s.h1}>Now</h1>
      </header>
      {/* The control Sean uses most (daily budget, paid search, start a hunt): first under the header, one click to open. */}
      <DirectWork />
      {nationalDepth(v.scopeKey) !== null && <National />}
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

type NatKey = "name" | "hunts" | "zips" | "score" | "stuck";
interface NatSort { readonly key: NatKey; readonly down: boolean }

const NAT_COLUMNS: readonly { readonly key: NatKey; readonly label: string; readonly num: boolean }[] = [
  { key: "name", label: "Place", num: false },
  { key: "hunts", label: "Hunts", num: true },
  { key: "zips", label: "ZIPs worked / total", num: true },
  { key: "score", label: "Completeness", num: true },
  { key: "stuck", label: "Stuck", num: true },
];
/** Rows shown before "Show all": a state list opens on the tracked states and hunts, a district or ZIP list on its first rows. */
const NAT_TOP = 12;

function natNumber(r: StateRow, key: Exclude<NatKey, "name">): number | null {
  return (key === "hunts" ? r.hunts : key === "zips" ? r.zipsWorked : key === "score" ? r.score : r.stuck) ?? null;
}

/** A row with no figure for the sorted column goes last, whichever way it sorts. */
function compareRows(sort: NatSort, a: StateRow, b: StateRow): number {
  const byName = a.name.localeCompare(b.name, "en", { numeric: true });
  if (sort.key === "name") return sort.down ? -byName : byName;
  const x = natNumber(a, sort.key), y = natNumber(b, sort.key);
  if (x === null || y === null) return x === y ? byName : x === null ? 1 : -1;
  return (sort.down ? y - x : x - y) || byName;
}

const dash = (n: number | null | undefined, format: (v: number) => string = count) => (n === null || n === undefined ? "—" : format(n));

function National() {
  const v = useV6();
  const depth = nationalDepth(v.scopeKey) ?? "states";
  const [sort, setSort] = useState<NatSort>(depth === "states" ? { key: "stuck", down: true } : { key: "name", down: false });
  const [all, setAll] = useState(false);
  // Only the rows that belong to this scope: the pre-load state list is never shown under a state or a district.
  const rows = (v.data.national.data ?? []).filter((r) => (r.parentKey ?? COUNTRY_KEY) === v.scopeKey);
  const byCode = new Map(rows.map((r) => [r.code, r]));
  const sorted = [...rows].sort((a, b) => compareRows(sort, a, b));
  const shown = all ? sorted : depth === "states" ? sorted.filter((r) => r.tracked || (r.hunts ?? 0) > 0) : sorted.slice(0, NAT_TOP);
  const tracked = rows.filter((r) => r.tracked).length;
  const huntCount = v.data.hunts.state === "not-connected" ? null : v.hunts.filter((h) => h.status !== "stopped").length;
  const noun = depth === "states" ? "states and territories" : depth === "districts" ? "districts" : "ZIPs";
  const collapsible = depth === "states" || rows.length > NAT_TOP;
  const table = (
    <div className={s.stack}>
      <div className={s.tableWrap} style={{ maxHeight: 360, overflowY: "auto" }}>
        <table className={s.table}>
          <caption className={s.srOnly}>{depth === "states" ? "States and territories" : depth === "districts" ? `Congressional districts of ${v.place.name}` : `ZIPs in ${v.place.name}`}</caption>
          <thead>
            <tr>
              {NAT_COLUMNS.map((c) => (
                <th key={c.key} scope="col" className={c.num ? s.num : undefined} aria-sort={sort.key === c.key ? (sort.down ? "descending" : "ascending") : "none"}>
                  <button type="button" className={s.btnLink} onClick={() => setSort((p) => ({ key: c.key, down: p.key === c.key ? !p.down : c.num }))}>
                    {c.label}{sort.key === c.key ? (sort.down ? " ↓" : " ↑") : ""}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.placeKey}>
                <td><button type="button" className={s.btnLink} onClick={() => v.setScope(r.placeKey)}>{r.name}</button></td>
                <td className={s.num}>{dash(r.hunts)}</td>
                <td className={s.num}>{r.zipsWorked == null && r.zipsTotal == null ? "—" : `${dash(r.zipsWorked)} / ${dash(r.zipsTotal)}`}</td>
                <td className={cx(s.num, r.score == null && s.dim)}>{dash(r.score, (n) => `${n.toFixed(1)}%`)}</td>
                <td className={cx(s.num, (r.stuck ?? 0) > 0 && s.textWarn)}>{dash(r.stuck)}</td>
              </tr>
            ))}
            {!shown.length && <tr><td colSpan={NAT_COLUMNS.length} className={s.dim}>—</td></tr>}
          </tbody>
        </table>
      </div>
      {collapsible && rows.length > 0 && (
        <div className={s.inline}>
          <button type="button" className={s.btn} aria-pressed={all} onClick={() => setAll(!all)}>
            {all ? (depth === "states" ? "Show only tracked states and hunts" : `Show the top ${NAT_TOP}`) : `Show all ${rows.length}`}
          </button>
        </div>
      )}
    </div>
  );
  return (
    <Card id="v6-national" title="The country" aside={<span className={s.meta}>{rows.length} {noun}{depth === "states" && huntCount !== null ? ` · ${huntCount} hunts running` : ""}{depth === "states" ? ` · ${tracked} tracked` : ""}</span>}>
      {rows.length === 0 && v.data.national.load === "loading" ? <Loading what={noun} /> : depth !== "states" ? table : (
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
                const words = `${name}${hasHunt ? ", has a hunt" : row?.tracked ? ", tracked, no hunt" : ", no hunt yet"}${row?.stuck == null ? "" : stuck ? `, ${row?.stuck} stuck` : ""}`;
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
              <span className={s.legendItem}><span className={s.swatch} style={{ border: "1px dashed var(--panel-border)" }} />No hunt</span>
              <span className={s.legendItem}><span className={s.swatch} style={{ background: "var(--pill-amber-text)", borderRadius: "50%", width: 8, height: 8 }} />Has stuck items</span>
            </div>
          </div>
          {table}
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
  return (
    <Card id="v6-steps" title="Suggested next steps">
      {v.data.stuck.state === "not-connected" ? <Empty>—</Empty> : !ranked.length && <Empty>Nothing here needs you right now.</Empty>}
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
  const score = v.data.checklist.data?.score ?? null;
  const completeness = score?.measures?.completeness ?? null;
  const harm = stuck.filter((x) => x.item.readersAffected).length;
  const dec = stuck.filter((x) => x.item.lane === "decision").length;
  const hunt = huntAt(v.index, v.hunts, v.scopeKey);
  const inside = huntsWithin(v.index, v.hunts, v.scopeKey);
  const multi = !hunt && inside.length > 1;
  const hf: Hunt | null = hunt ?? (inside.length === 1 ? inside[0] : null);
  const left = (h: Hunt) => { const n = huntLeftUsd(h); return n === null ? "—" : usd(n); };
  /** Research workers on a hunt, or null when its run state isn't reported. */
  const workers = (h: Hunt) => (h.status === "running" ? h.researchWorkers : h.status === "unreported" ? null : 0);
  const insideWorkers = inside.map(workers);
  const resultsKnown = v.data.results.state !== "not-connected" && v.data.results.data !== null;
  const stuckKnown = v.data.stuck.state !== "not-connected";
  const huntsKnown = v.data.hunts.state !== "not-connected";
  const answers: { q: string; big: string; small: string; href: string; warn?: boolean }[] = [
    { q: "Readers received", big: resultsKnown ? `${ver} checked on the page` : "—", small: resultsKnown ? `${pub} published, not checked on the page · ${shared.length} shared results` : "", href: "#v6-readers" },
    { q: "Completeness", big: completeness && completeness.percent !== null ? `${completeness.percent.toFixed(1)}%` : "—", small: completeness ? `${count(completeness.n)} of ${count(completeness.of)} owed now, held · ${count(score!.measures!.freshness.n)} of ${count(score!.measures!.freshness.of)} fresh · ${count(score!.measures!.delivery.n)} of ${count(score!.measures!.delivery.of)} seen on the page` : "", href: "#v6-missing" },
    { q: "Happening now", big: multi ? (insideWorkers.includes(null) ? "—" : String(insideWorkers.reduce<number>((a, n) => a + (n ?? 0), 0))) : hf ? (workers(hf) === null ? "—" : String(workers(hf))) : "—", small: multi ? `research workers across ${inside.length} hunts` : hf ? (hf.status === "running" && hf.researchWorkers !== null ? `research workers on the ${hf.name}` : hf.status === "unreported" ? hf.name : `${hf.name} is ${hf.status}`) : huntsKnown ? "No hunt here" : "", href: "#v6-happening" },
    { q: "Stuck", big: stuckKnown ? String(stuck.length) : "—", small: stuckKnown ? `${harm} affecting readers · ${stuck.filter((x) => x.rel === "shared").length} through shared work` : "", href: "#v6-stuck", warn: harm > 0 },
    { q: "Your decisions", big: stuckKnown ? String(dec) : "—", small: dec ? "See Suggested next steps" : stuckKnown ? "Nothing needs you here" : "", href: "#v6-steps", warn: dec > 0 },
    { q: "Hunt money", big: multi ? `${inside.length} hunts` : hf ? left(hf) : "—", small: multi ? `${inside.map((h) => `${h.name}: ${left(h)} left of ${usd(h.limitUsd)}`).join(" · ")}` : hf ? `${hf.name}${hf.placeKey !== v.scopeKey ? " (inside)" : ""} · left of ${usd(hf.limitUsd)} · ${usd(hf.spentUsd)} spent · ${usd(hf.heldUsd)} set aside` : huntsKnown ? "No hunt here" : "", href: "#v6-cost" },
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
      <span className={s.spread}><strong style={{ fontSize: 13 }}>{r.title}</strong>{r.kind !== null && <Pill tone={tone}>{r.kind}</Pill>}</span>
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
      {v.data.results.state === "not-connected" || v.data.results.data === null ? <Empty>—</Empty> : !local.length && <Empty>No results for {v.place.name}.</Empty>}
      <div className={s.stack}>{local.map((x) => <ResultRow key={x.r.id} r={x.r} />)}</div>
      {!!shared.length && (
        <div className={s.stack}>
          <h3 className={s.h3}>Shared work that also covers {v.place.name}</h3>
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
      {v.data.stuck.load === "failed" && !v.data.stuck.data && <Empty>—</Empty>}
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
      {v.data.stuck.state !== "not-connected" && !shown.length && <Empty>{`Nothing ${lane === "all" ? "is stuck" : "in this group"} in ${v.place.name}.`}</Empty>}
      <div className={s.stack}>{shown.slice(0, STUCK_SHOWN_ON_NOW).map((x) => <StuckRow key={x.item.id} item={x.item} shared={x.rel === "shared"} withActions />)}</div>
      {shown.length > STUCK_SHOWN_ON_NOW && <p className={cx(s.p, s.meta)}>Showing {STUCK_SHOWN_ON_NOW} of {count(shown.length)}. <button type="button" className={s.btnLink} onClick={() => v.go("work")}>See them grouped by cause →</button></p>}
    </Card>
  );
}

/* --------------------------------------------------------------- missing */

function Missing() {
  const v = useV6();
  const groups = v.data.checklist.data?.placeGroups ?? null;
  const totals = checklistTotals(groups?.map((g) => g.counts) ?? null);
  const N = totals ? totals.reduce((a, b) => a + b, 0) : 0;
  const score = v.data.checklist.data?.score ?? null;
  return (
    <Card id="v6-missing" title="What’s still missing" aside={<button type="button" className={s.btnLink} onClick={() => v.go("checklist")}>Open the checklist →</button>}>
      {totals && N > 0 ? (
        <>
          {score?.measures && <p className={cx(s.p, s.small)}>Completeness {score.measures.completeness.percent === null ? "—" : `${score.measures.completeness.percent.toFixed(1)}%`} · {count(score.measures.completeness.n)} of {count(score.measures.completeness.of)} · Freshness {count(score.measures.freshness.n)} of {count(score.measures.freshness.of)} · Delivery {count(score.measures.delivery.n)} of {count(score.measures.delivery.of)}</p>}
          <p className={cx(s.p, s.small)}>
            {count(N)} checklist items · Checked on a public page: {count(totals[0])} ({pctDown(totals[0], N)}) · Published, not checked on the page: {count(totals[1])} · Collected, not published: {count(totals[2])} · Applies: {count(N - totals[5])} · Not sure: {count(totals[5])}
          </p>
          <StatusBar counts={totals} label={`All checklist items in ${v.place.name}`} tall />
          <StatusLegend />
          <StatusTable rows={[{ name: `All groups in ${v.place.name}`, counts: totals }]} />
        </>
      ) : groups ? <Empty>No checklist items for {v.place.name}.</Empty> : <Empty>—</Empty>}
    </Card>
  );
}

/* ------------------------------------------------------------- happening */

function Happening() {
  const v = useV6();
  const now = usePageClock();
  const w = v.data.workers.data;
  const isCountry = v.place.kind === "Country";
  const jobs = w?.jobs ? w.jobs.filter((j) => relation(v.index, [j.placeKey], v.scopeKey) !== null) : null;
  const waiting = w?.waiting ? w.waiting.filter((x) => relation(v.index, x.applies, v.scopeKey) !== null) : null;
  const lanes = w?.status.lanes;
  const round = roundReading(w?.status, now);
  const progress = w?.status.lastUsefulProgress ?? null;
  const running = w?.running ?? null;
  return (
    <Card id="v6-happening" title="What’s happening now" aside={<button type="button" className={s.btnLink} onClick={() => v.go("workers")}>Open Workers →</button>}>
      <div className={s.gridTiles}>
        <div className={s.row}>
          <span className={s.big}>{runningCount(running, jobs)}</span>
          <span className={s.meta}>{jobs ? `jobs working now in ${v.place.name}` : `jobs working now${isCountry ? "" : ` in ${v.place.name}`}`}{jobs && running && !isCountry ? ` · ${systemRunningCount(running)} in the whole system` : ""}</span>
        </div>
        <div className={s.row}>
          <span className={s.big}>{waiting ? waiting.length : "—"}</span>
          <span className={s.meta}>{waiting ? `waiting${isCountry ? "" : ` in ${v.place.name}`}${waiting.length ? `: ${waiting.slice(0, 2).map((x) => x.title).join(" · ")}${waiting.length > 2 ? ` · and ${waiting.length - 2} more` : ""}` : ""}` : `waiting${isCountry ? "" : ` in ${v.place.name}`}`}</span>
        </div>
        <div className={s.row}>
          <span className={s.big}>{progress ? mst(progress.at, false) : "—"}</span>
          <span className={s.meta}>{progress ? `last useful progress (${ageWords(progress.at, now) ?? ""}): ${progress.what}` : "last useful progress"}</span>
        </div>
        <div className={cx(s.row, round.overdue && s.cardWarn)}>
          <span className={cx(s.big, round.overdue && s.textWarn)}>{round.overdue ? "Late" : round.headline}</span>
          <span className={s.meta}>{round.overdue ? round.headline : "Round of work"}</span>
        </div>
      </div>
      {jobs && jobs.length > 0 && (
        <ul className={s.stack} style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {jobs.slice(0, 5).map((j) => <li key={j.id} className={s.small}>{j.title} · {j.hunt} · {j.elapsed}</li>)}
          {jobs.length > 5 && <li className={s.meta}>and {count(jobs.length - 5)} more</li>}
        </ul>
      )}
      {!jobs && lanes && (
        <div className={s.gridTiles}>
          {lanes.map((l) => (
            <div key={l.name} className={s.row}>
              <span className={s.big}>{l.active ?? "—"}<span className={s.meta}> running · {count(l.waiting)} waiting</span></span>
              <span className={s.meta}>{l.name}{l.blockedBy ? ` · ${l.blockedBy}` : ""}</span>
            </div>
          ))}
        </div>
      )}
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
      {v.data.hunts.state === "not-connected" ? <Empty>—</Empty> : !list.length && <Empty>No hunt here</Empty>}
      <div className={s.grid2}>
        {list.map((h) => <HuntMeter key={h.id} hunt={h} inside={h.placeKey !== v.scopeKey} />)}
      </div>
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
      <span className={s.small}>{usd(h.spentUsd)} spent · {usd(h.heldUsd)} set aside for work in progress · {left === null ? <span className={s.textWarn}>—</span> : <span className={s.textGood}>{usd(left)}</span>} left of {usd(h.limitUsd)}</span>
      {h.unpricedEntries > 0 && <span className={cx(s.small, s.textWarn)}>{count(h.unpricedEntries)} charges without a price</span>}
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
          <div className={s.spread}><strong>{h.name}</strong><span className={cx(s.small, h.status === "running" ? s.textGood : s.textWarn)}>{({ running: "Running", paused: "Paid work paused", stopped: "Stopped", unreported: "—" })[h.status]}{h.status === "running" ? ` · ${h.researchWorkers ?? "—"} research workers` : ""}</span></div>
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
          <Actions actions={[{ kind: "hunt-start", target: v.scopeKey }]} primaryFirst />
        </div>
        <div className={s.row}>
          <strong className={s.small}>In {v.place.name}</strong>
        </div>
        <div className={cx(s.row, s.cardGlobal)}>
          <strong className={s.small}>Whole system</strong>
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
      {!list.length && <Empty>No instructions {all || v.scopeKey === COUNTRY_KEY ? "yet" : `for ${v.place.name} yet`}.</Empty>}
      <div className={s.stack}>{list.map((r) => <ReceiptCard key={r.key} receipt={r} compact />)}</div>
    </Card>
  );
}
