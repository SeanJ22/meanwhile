"use client";

/**
 * **NOW.** What readers can see, what is stuck and why, what is happening, what
 * it cost, and what Sean can do — for the selected place. The national map and
 * state table lead at country scope.
 */
import { useMemo, useState } from "react";

import { periodLabel } from "@/lib/control-plane/admin-view/periods.ts";

import { useV6 } from "./context.tsx";
import { INSTRUCTION_EXAMPLES, parseInstruction, type Parsed } from "./instruction.ts";
import { count, mst, usd, type Lane, type ReaderResult, type StateRow, type StuckItem } from "./model.ts";
import { TILE_LAYOUT } from "./national-layout.ts";
import { COUNTRY_KEY, huntAt, huntsWithin, isWithin, nationalDepth, relation } from "./places.ts";
import { useQueueRows } from "./use-queue.ts";
import { ActionButton, Actions, Card, cx, Empty, Loading, Pill, StageDots } from "./ui.tsx";
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
  return (
    <>
      <header>
        <p className={s.eyebrow}>{v.place.name} · {periodLabel(v.period, new Date())}</p>
        <h1 className={s.h1}>Now</h1>
      </header>
      <Matters />
      {/* The control Sean uses most (daily budget, paid search, start a hunt): one click to open. */}
      <DirectWork />
      {nationalDepth(v.scopeKey) !== null && <National />}
      <Instruction />
    </>
  );
}

/* ----------------------------------------------------- what matters now */

const MOTION_KINDS = new Set(["order", "scheduled", "send", "hunt"]);

/** The four things that matter, each with one sentence saying what it means. */
function Matters() {
  const v = useV6();
  const { rows, unread } = useQueueRows();
  const needs = rows.filter((r) => r.filter === "needs-me");
  const motion = rows.filter((r) => MOTION_KINDS.has(r.kind) && (r.filter === "in-progress" || r.filter === "scheduled" || r.filter === "waiting")).slice(0, 5);
  const completeness = v.data.checklist.data?.score?.measures?.completeness ?? null;
  return (
    <section aria-label="What matters now" className={s.stack}>
      <div className={s.grid2}>
        <Card title="Needs me" aside={<button type="button" className={s.btnLink} onClick={() => v.go("queue")}>Open the queue →</button>}>
          <div><span className={cx(s.big, needs.length > 0 && s.textWarn)}>{unread.includes("stuck cases") && unread.includes("orders") ? "—" : needs.length}</span></div>
          <p className={s.small}>{unread.length > 0 ? `Counted without ${unread.join(", ")}, which could not be read.` : needs.length === 0 ? "Good: nothing is waiting on you." : `Not good until they are cleared: ${needs.length === 1 ? "one thing is" : `${needs.length} things are`} waiting on you.`}</p>
        </Card>
        <Card title="Mission progress" aside={<button type="button" className={s.btnLink} onClick={() => v.go("checklist")}>Open the checklist →</button>}>
          <div><span className={s.big}>{completeness && completeness.percent !== null ? `${Math.floor(completeness.percent)}%` : "—"}</span></div>
          <p className={s.small}>{completeness ? `${count(completeness.n)} of ${count(completeness.of)} things owed for ${v.place.name} are held. More is better; the rest is still being found.` : `What ${v.place.name} is owed has not been counted yet.`}</p>
        </Card>
      </div>
      <LastHours />
      <Card title="Orders in motion" aside={<button type="button" className={s.btnLink} onClick={() => v.go("queue")}>Open the queue →</button>}>
        {motion.length === 0 && <Empty>{unread.length > 0 ? "—" : "Nothing in motion."}</Empty>}
        <div className={s.stack}>
          {motion.map((r) => (
            <div key={r.key} className={s.row}>
              <span className={s.spread}><strong style={{ fontSize: 13 }}>{r.what}</strong><Pill tone={r.tone}>{r.chip}</Pill></span>
              <span className={s.meta}>{r.progress ? r.progress.words : r.next}</span>
            </div>
          ))}
        </div>
      </Card>
    </section>
  );
}

/* ------------------------------------------------------ the last full hours */

const gb = (n: number | null): string => (n === null ? "—" : `${n.toFixed(2)} GB`);
const orDash = (n: number | null, f: (n: number) => string): string => (n === null ? "—" : f(n));

/** The last two full hours from the runner's hourly row. A number nobody recorded shows "—", never zero. */
function LastHours() {
  const v = useV6();
  const hours = v.data.scoreboard.data?.vital ?? null;
  const last = hours?.[0] ?? null, before = hours?.[1] ?? null;
  const rows: readonly { readonly name: string; readonly says: string; readonly of: (h: NonNullable<typeof last>) => { readonly text: string; readonly bad?: boolean } }[] = [
    { name: "Facts live", says: "New or changed reader records that went live. Higher is better.", of: (h) => ({ text: orDash(h.factsLive, count) }) },
    { name: "Cost per fact", says: "Money spent divided by facts live. Lower is better.", of: (h) => ({ text: orDash(h.costPerFactUsd, (n) => (n >= 1 ? usd(n) : `$${n.toFixed(4)}`)) }) },
    { name: "Data read from the database", says: "Target: under 0.7 GB an hour.", of: (h) => ({ text: gb(h.neonGb), bad: h.overNeonTarget === true }) },
    { name: "Research rounds", says: "Finished, against killed by the watchdog.", of: (h) => ({ text: h.roundsFinished === null || h.roundsKilled === null ? "—" : `${count(h.roundsFinished)} finished · ${count(h.roundsKilled)} killed` }) },
    { name: "Paid jobs that ended with nothing", says: "Must be none.", of: (h) => ({ text: orDash(h.paidJobsEndedEmpty, (n) => (h.paidJobsEnded === null ? count(n) : `${count(n)} of ${count(h.paidJobsEnded)}`)), bad: (h.paidJobsEndedEmpty ?? 0) > 0 }) },
  ];
  return (
    <Card title="The last full hour" aside={<button type="button" className={s.btnLink} onClick={() => v.go("scoreboard")}>Open the scoreboard →</button>}>
      {last === null && <Empty>{hours === null ? "—" : "The hour has not been recorded yet."}</Empty>}
      {last !== null && (
        <div className={s.stack}>
          <p className={s.small}>{mst(last.hour)}{before !== null ? ` · the hour before: ${mst(before.hour)}` : ""}</p>
          {rows.map((r) => {
            const now = r.of(last), earlier = before === null ? null : r.of(before);
            return (
              <div key={r.name} className={s.row}>
                <span className={s.spread}><strong style={{ fontSize: 13 }}>{r.name}</strong><span className={cx(now.bad && s.textWarn)}>{now.text}{earlier !== null ? ` (before: ${earlier.text})` : ""}</span></span>
                <span className={s.meta}>{r.says}</span>
              </div>
            );
          })}
        </div>
      )}
    </Card>
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
          {parsed.unsupported && <p className={s.why}>No matching action.</p>}
          {parsed.clarify && (
            <div className={s.row}>
              <strong className={s.small}>{parsed.clarify.question}</strong>
              {parsed.clarify.options.length ? (
                <select className={s.select} value={chosenBody ?? ""} onChange={(e) => { setChosenBody(e.target.value || null); readBack(text, e.target.value || null); }}>
                  <option value="">Choose one</option>
                  {parsed.clarify.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : <span className={s.meta}>No matching item in {v.place.name}.</span>}
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

export function Readers() {
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
          <Actions actions={[{ kind: "scope-first", target: v.scopeKey }, { kind: "scope-recheck", target: v.scopeKey }, { kind: "scope-stop", target: v.scopeKey }]} />
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
