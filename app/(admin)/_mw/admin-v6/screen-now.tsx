"use client";

import { Fragment, useMemo, useState } from "react";

import { periodLabel } from "@/lib/control-plane/admin-view/periods.ts";

import { useV6 } from "./context.tsx";
import { count, mst, usd, type Hunt, type Lane, type ReaderResult, type StateRow, type StuckItem } from "./model.ts";
import { TILE_LAYOUT } from "./national-layout.ts";
import { COUNTRY_KEY, huntAt, huntsByState, huntsWithin, isWithin, nationalDepth, relation, type StateHunts } from "./places.ts";
import { huntStatus, type QueueRow } from "./queue.ts";
import { useQueueRows } from "./use-queue.ts";
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
  return (
    <>
      <header>
        <p className={cx(s.eyebrow, s.nowEyebrow)}>{v.place.name} · {periodLabel(v.period, new Date())}</p>
        <h1 className={cx(s.h1, s.nowH1)}>Now</h1>
      </header>
      {nationalDepth(v.scopeKey) !== null && <National />}
      <DirectWork />
      <IsItWorking />
      <OrdersInMotion />
      <NeedsMe />
    </>
  );
}

const MOTION_KINDS = new Set(["order", "scheduled", "send", "hunt"]);

interface MotionRow { readonly key: string; readonly what: string; readonly chip: string; readonly tone: QueueRow["tone"]; readonly lines: readonly string[] }

export function motionRows(rows: readonly QueueRow[]): MotionRow[] {
  const moving = rows.filter((r) => MOTION_KINDS.has(r.kind) && (r.filter === "in-progress" || r.filter === "scheduled" || r.filter === "waiting"));
  const out: MotionRow[] = [];
  const hunts = new Map<string, QueueRow[]>();
  for (const r of moving) {
    if (r.kind !== "hunt") { out.push({ key: r.key, what: r.what, chip: r.chip, tone: r.tone, lines: [r.progress ? r.progress.words : r.next, ...(r.progress && r.next ? [r.next] : [])] }); continue; }
    const key = `${r.chip}\u0000${r.next}`;
    hunts.set(key, [...(hunts.get(key) ?? []), r]);
  }
  for (const [key, group] of hunts) {
    const first = group[0];
    out.push(group.length === 1
      ? { key: first.key, what: first.what, chip: first.chip, tone: first.tone, lines: [first.progress ? first.progress.words : first.next, ...(first.progress ? [first.next] : [])] }
      : { key: `hunts:${key}`, what: `${count(group.length)} hunts`, chip: first.chip, tone: first.tone, lines: [first.next] });
  }
  return out;
}

function OrdersInMotion() {
  const v = useV6();
  const { rows, unread } = useQueueRows();
  const motion = motionRows(rows).slice(0, 5);
  return (
    <Card title="Orders in motion" aside={<button type="button" className={s.btnLink} onClick={() => v.go("queue")}>Open the queue →</button>}>
      {motion.length === 0 && <Empty>{unread.length > 0 ? "—" : "Nothing in motion."}</Empty>}
      <div className={s.stack}>
        {motion.map((r) => (
          <div key={r.key} className={s.row}>
            <span className={s.spread}><strong style={{ fontSize: 13 }}>{r.what}</strong><Pill tone={r.tone}>{r.chip}</Pill></span>
            {r.lines.map((line) => <span key={line} className={s.meta}>{line}</span>)}
          </div>
        ))}
      </div>
    </Card>
  );
}

function NeedsMe() {
  const v = useV6();
  const { rows, unread } = useQueueRows();
  const needs = rows.filter((r) => r.filter === "needs-me");
  return (
    <Card title="Needs me" aside={<button type="button" className={s.btnLink} onClick={() => v.go("queue")}>Open the queue →</button>}>
      <div><span className={cx(s.big, needs.length > 0 && s.textWarn)}>{unread.includes("stuck cases") && unread.includes("orders") ? "—" : needs.length}</span></div>
      <p className={s.small}>{unread.length > 0 ? `Counted without ${unread.join(", ")}, which could not be read.` : needs.length === 0 ? "Good: nothing is waiting on you." : `Not good until they are cleared: ${needs.length === 1 ? "one thing is" : `${needs.length} things are`} waiting on you.`}</p>
      <div className={s.stack}>
        {needs.slice(0, 5).map((r) => (
          <div key={r.key} className={s.row}>
            <span className={s.spread}><strong style={{ fontSize: 13 }}>{r.what}</strong><Pill tone={r.tone}>{r.chip}</Pill></span>
            <span className={s.meta}>{r.next}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

const gb = (n: number | null): string => (n === null ? "—" : `${n.toFixed(2)} GB`);
const orDash = (n: number | null, f: (n: number) => string): string => (n === null ? "—" : f(n));

function IsItWorking() {
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
    <Card title="Is it working" aside={<button type="button" className={s.btnLink} onClick={() => v.go("scoreboard")}>Open the scoreboard →</button>}>
      <div className={s.stack}>
        <p className={s.small}>{last !== null ? `${mst(last.hour)}${before !== null ? ` · the hour before: ${mst(before.hour)}` : ""}` : hours === null ? "Not measured yet." : "The hour has not been recorded yet."}</p>
        {rows.map((r) => {
          const now = last === null ? { text: "—" } : r.of(last), earlier = before === null ? null : r.of(before);
          return (
            <div key={r.name} className={s.row}>
              <span className={s.spread}><strong style={{ fontSize: 13 }}>{r.name}</strong><span className={cx(now.bad && s.textWarn)}>{now.text}{earlier !== null ? ` (before: ${earlier.text})` : ""}</span></span>
              <span className={s.meta}>{r.says}</span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

type NatKey = "population" | "name" | "hunts" | "zips" | "score" | "stuck";
interface NatSort { readonly key: NatKey; readonly down: boolean }

const NAT_COLUMNS: readonly { readonly key: NatKey; readonly label: string; readonly num: boolean }[] = [
  { key: "name", label: "Place", num: false },
  { key: "population", label: "Population estimate", num: true },
  { key: "score", label: "Readers have", num: true },
  { key: "zips", label: "ZIPs worked", num: true },
  { key: "hunts", label: "Hunts", num: true },
  { key: "stuck", label: "Stuck", num: true },
];

export function holdingBand(score: number | null | undefined): "none" | "some" | "half" | "most" | "unknown" {
  if (score === null || score === undefined) return "unknown";
  return score >= 75 ? "most" : score >= 40 ? "half" : score > 0 ? "some" : "none";
}
const BAND_WORDS = { most: "75% or more", half: "40–74%", some: "under 40%", none: "nothing yet", unknown: "not counted yet" } as const;
const NAT_TOP = 12;

function natNumber(r: StateRow, key: Exclude<NatKey, "name">): number | null {
  return (key === "population" ? r.population?.population : key === "hunts" ? r.hunts : key === "zips" ? r.zipsWorked : key === "score" ? r.score : r.stuck) ?? null;
}

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
  const [sort, setSort] = useState<NatSort>(depth === "states" ? { key: "name", down: false } : { key: "name", down: false });
  const [all, setAll] = useState(false);
  const [compact, setCompact] = useState(false);
  // The state or row under the pointer or focus: its tile and its row light up together.
  const [linked, setLinked] = useState<string | null>(null);
  // Only the rows that belong to this scope: the pre-load state list is never shown under a state or a district.
  const rows = (v.data.national.data ?? []).filter((r) => (r.parentKey ?? COUNTRY_KEY) === v.scopeKey);
  const byCode = new Map(rows.map((r) => [r.code, r]));
  const sorted = [...rows].sort((a, b) => compareRows(sort, a, b));

  const shown = all || depth === "states" ? sorted : sorted.slice(0, NAT_TOP);
  const tracked = rows.filter((r) => r.tracked).length;
  const live = v.data.hunts.state === "not-connected" ? null : v.hunts.filter((h) => h.status !== "stopped");
  const pausedHunts = live === null ? 0 : live.filter((h) => h.status === "paused").length;
  const noun = depth === "states" ? "states and territories" : depth === "districts" ? "districts" : "ZIPs";
  const collapsible = depth !== "states" && rows.length > NAT_TOP;
  const completeness = v.data.checklist.data?.score?.measures?.completeness ?? null;
  const progress = completeness && completeness.percent !== null
    ? `Readers in ${v.place.name} have ${Math.floor(completeness.percent)}% of what they are owed: ${count(completeness.n)} of ${count(completeness.of)} things.`
    : `What ${v.place.name} is owed has not been counted yet.`;
  const stats: readonly { readonly n: string; readonly label: string }[] = [
    { n: String(rows.length), label: noun },
    ...(depth !== "states" ? [] : [
      ...(live === null ? [] : [{ n: count(live.length), label: `${live.length === 1 ? "hunt" : "hunts"}${pausedHunts > 0 ? `, ${count(pausedHunts)} paused` : ""}` }]),
      { n: String(tracked), label: "tracked" },
    ]),
  ];
  const table = (
    <div className={s.stack}>
      <div className={s.tableWrap}>
        <table className={cx(s.table, s.countryTable)}>
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
              <tr key={r.placeKey} className={cx(linked === r.code && s.rowLinked)} onMouseEnter={() => setLinked(r.code)} onMouseLeave={() => setLinked(null)} onFocus={() => setLinked(r.code)} onBlur={() => setLinked(null)}>
                <td><button type="button" className={s.btnLink} onClick={() => v.setScope(r.placeKey)}>{r.name}</button></td>
                <td className={cx(s.num, s.popCell)} title={r.population ? `ACS ${r.population.attribution.period}, 90% margin of error` : undefined}>{r.population ? <>{count(r.population.population)}{r.population.marginOfError === null ? "" : <> <span className={s.moe}>± {count(r.population.marginOfError)}</span></>}</> : "—"}</td>
                <td className={cx(s.num, r.score == null && s.dim)}>{dash(r.score, (n) => `${n.toFixed(1)}%`)}</td>
                <td className={s.num}>{r.zipsWorked == null && r.zipsTotal == null ? "—" : `${dash(r.zipsWorked)} / ${dash(r.zipsTotal)}`}</td>
                <td className={s.num}>{dash(r.hunts)}</td>
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
            {all ? `Show the top ${NAT_TOP}` : `Show all ${rows.length}`}
          </button>
        </div>
      )}
      <div><p className={s.meta}>Population data from</p><ul>{[...new Map(rows.flatMap(row => row.population ? [[row.population.attribution.citationUrl ?? row.population.attribution.sourceUrl, { ...row.population.attribution, label: row.population.name }] as const] : [])).values()].map(source => <li key={source.citationUrl ?? source.sourceUrl}><a href={source.citationUrl ?? source.sourceUrl}>{source.sourceOrg} · {source.label}</a> · Official · ACS {source.period} · Publication date {source.publishedAt?.slice(0, 10) ?? "—"} · Checked {source.retrievedAt.slice(0, 10)}</li>)}</ul></div>
    </div>
  );
  return (
    <section id="v6-national" aria-labelledby="v6-national-h" className={cx(s.card, s.country)} data-density={compact ? "compact" : "roomy"}>
      <div className={s.countryHead}>
        <div className={s.countryIntro}>
          <h2 id="v6-national-h" className={cx(s.h2, s.countryTitle)}>The country</h2>
          <p className={cx(s.p, s.countryLine)}>{progress} <button type="button" className={s.btnLink} onClick={() => v.go("checklist")}>Open the checklist →</button></p>
        </div>
        <div className={s.countryAside}>
          <div className={s.countryStats}>
            {stats.map((x, i) => (
              <Fragment key={x.label}>
                {i > 0 && <span className={s.statSep} aria-hidden="true">·</span>}
                <span className={s.stat}><span className={s.statNum}>{x.n}</span><span className={s.statLabel}>{x.label}</span></span>
              </Fragment>
            ))}
          </div>
          <button type="button" className={s.btn} aria-pressed={compact} onClick={() => setCompact(!compact)}>Compact</button>
        </div>
      </div>
      {rows.length === 0 && v.data.national.load === "loading" ? <Loading what={noun} /> : depth !== "states" ? table : (
        <div className={s.nation}>
          <div className={s.mapColumn}>
            <div className={s.map} role="group" aria-label="Map of states and territories. Choose one to open it.">
              {TILE_LAYOUT.map(([code, r, c]) => {
                const row = byCode.get(code);
                const key = `st:${code.toLowerCase()}`;
                const hasHunt = (row?.hunts ?? 0) > 0 || huntsWithin(v.index, v.hunts, key).length > 0;
                const selected = isWithin(v.index, v.scopeKey, key);
                const name = row?.name ?? code;
                const stuck = (row?.stuck ?? 0) > 0;
                const band = holdingBand(row?.score);
                const words = `${name}: readers have ${row?.score == null ? "an amount not counted yet" : `${row.score.toFixed(1)}%`}${hasHunt ? ", has a hunt" : ""}${row?.stuck == null ? "" : stuck ? `, ${row?.stuck} stuck` : ""}`;
                return (
                  <button key={code} type="button" className={cx(s.tile, hasHunt && s.tileHunt, selected && s.tileSelected, linked === code && s.tileLinked)} data-band={band} style={{ gridRow: r + 1, gridColumn: c + 1 }}
                    aria-label={words} title={words} onClick={() => v.setScope(key)}
                    onMouseEnter={() => setLinked(code)} onMouseLeave={() => setLinked(null)} onFocus={() => setLinked(code)} onBlur={() => setLinked(null)}>
                    {code}{stuck && <span className={s.stuckDot} aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
            <div className={s.mapLegend}>
              <span className={s.legendItem}>Readers have:</span>
              {(["most", "half", "some", "none", "unknown"] as const).map((b) => <span key={b} className={s.legendItem}><span className={s.swatch} data-band={b} />{BAND_WORDS[b]}</span>)}
              <span className={s.legendItem}><span className={s.swatch} style={{ boxShadow: "inset 0 0 0 2px var(--text)" }} />Has a hunt</span>
              <span className={s.legendItem}><span className={s.swatch} style={{ background: "var(--pill-amber-text)", borderRadius: "50%" }} />Has stuck items</span>
            </div>
          </div>
          {table}
        </div>
      )}
    </section>
  );
}

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

function HuntCard(props: { readonly h: Hunt }) {
  const { h } = props;
  const status = huntStatus(h);
  return (
    <div className={s.row}>
      <div className={s.spread}><strong>{h.name}</strong><span className={cx(s.small, h.status === "running" ? s.textGood : s.textWarn)}>{status.chip}{h.status === "running" ? ` · ${h.researchWorkers ?? "—"} research workers` : ""}</span></div>
      {h.status !== "running" && <span className={s.small}>{status.next}</span>}
      <span className={s.meta}>Started {h.startedAt.includes("T") ? mst(h.startedAt) : h.startedAt} · {usd(h.limitUsd)} lifetime · {usd(h.spentUsd + h.heldUsd)} spent or set aside</span>
      <Actions actions={[{ kind: h.status === "paused" ? "hunt-resume" : "hunt-pause", target: h.placeKey }, { kind: "hunt-limit", target: h.placeKey }, { kind: "hunt-stop", target: h.placeKey }]} />
    </div>
  );
}

function StateHuntRow(props: { readonly group: StateHunts }) {
  const { group } = props;
  const running = group.hunts.filter((h) => h.status === "running").length;
  const spent = group.hunts.reduce((n, h) => n + h.spentUsd + h.heldUsd, 0);
  const limit = group.hunts.reduce((n, h) => n + h.limitUsd, 0);
  const paused = group.hunts.filter((h) => h.status === "paused").length;
  const active = group.hunts.length - running - paused;
  return (
    <details className={s.row}>
      <summary className={s.spread} style={{ cursor: "pointer" }}>
        <strong><span className={s.caret} aria-hidden="true">▸</span> {group.name}</strong>
        <span className={s.small}>{count(group.hunts.length)} {group.hunts.length === 1 ? "hunt" : "hunts"}{[running && `${count(running)} hunting`, active && `${count(active)} active`, paused && `${count(paused)} paused`].filter(Boolean).map((w) => ` · ${w}`).join("")} · {usd(spent)} of {usd(limit)} spent or set aside</span>
      </summary>
      <div className={s.stack} style={{ marginTop: 8 }}>
        {group.hunts.map((h) => <HuntCard key={h.id} h={h} />)}
      </div>
    </details>
  );
}

function DirectWork() {
  const v = useV6();
  const hunt = huntAt(v.index, v.hunts, v.scopeKey);
  const groups = hunt ? [] : huntsByState(v.index, huntsWithin(v.index, v.hunts, v.scopeKey));
  const [open, setOpen] = useState(true);
  const total = groups.reduce((n, g) => n + g.hunts.length, 0);

  const held = v.hunts.find((h) => h.status === "paused" && (h.pause?.kind === "paid-work" || h.pause?.kind === "runner"));
  const ownerPause = held ? huntStatus(held).next : null;
  return (
    <details className={s.card} open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className={s.h2} style={{ cursor: "pointer" }}>Direct work</summary>
      <div className={s.stack} style={{ marginTop: 12 }}>
        {ownerPause && <p className={cx(s.p, s.small, s.textWarn)}>Paused. {ownerPause}</p>}
        {!!hunt && <HuntCard h={hunt} />}
        {v.scopeKey.startsWith("st:") && <Actions actions={[{kind:"hunt-stop-state",target:v.scopeKey,label:`Stop every hunt in ${v.place.name}`}]} />}
        <div className={s.row}>
          <strong className={s.small}>Start a hunt</strong>
          <Actions actions={[{ kind: "hunt-start", target: v.scopeKey }]} primaryFirst />
        </div>
        <div className={cx(s.row, s.cardGlobal)}>
          <strong className={s.small}>Whole system</strong>
          <Actions actions={[{ kind: "hunt-stop-all", target: "us" }, { kind: "global-paid", target: "system" }, { kind: "global-paid-resume", target: "system" }, { kind: "global-ceiling", target: "system" }, { kind: "global-search-on", target: "system" }, { kind: "global-search-off", target: "system" }, { kind: "global-runner-pause", target: "runner" }, { kind: "global-runner-resume", target: "runner" }]} />
        </div>
        {!!groups.length && (
          <div className={s.stack}>
            <h3 className={s.h3}>{count(total)} {total === 1 ? "hunt" : "hunts"} in {count(groups.length)} {groups.length === 1 ? "place" : "places"}</h3>
            {groups.map((g) => <StateHuntRow key={g.stateKey} group={g} />)}
          </div>
        )}
      </div>
    </details>
  );
}
