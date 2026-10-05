/**
 * **`admin-v6/scoreboard@1` — THE SCOREBOARD'S READING (BR-23).** Replaces "Is it learning".
 *
 * One row per number in the design's Scoreboard list. A row carries its value, the counts behind it, one sentence, and, when
 * there is no value, why it is not measured; "—" is shown for it, never a zero or a guess. Rows are never blended into one
 * number: completeness, freshness, delivery and readiness stay separate. PURE: readings in, view out; a reading the caller
 * could not take arrives as null and its row says so.
 *
 * The weekly Scout series that made up "Is it learning" live on in `learning`.
 */
import type {
  LearningView, NotMeasured, Reading, ScoreboardGateRow, ScoreboardReadinessRow, ScoreboardRow, ScoreboardView, Trend, TrendWeek,
} from "../../../app/(admin)/_mw/admin-v6/model.ts";
import type { ReadinessCount } from "../../coverage/readiness-counts.ts";
import type { GateHealthRow } from "./gate-health.ts";
import { summarizeGateHealth } from "./gate-health.ts";
import type { LearningSeries, LearningTrends } from "./learning-trends.ts";
import type { V6HistoryReceipt } from "./admin-v6-history.ts";
import type { PipelineRead } from "./v6-results-read.ts";
import type { AuditAccuracyReading } from "./v6-audit-read.ts";
import { formatEastern } from "../eastern-time.ts";
import type { SpeedPass } from "../../health/worst-case-speed.ts";
import type { ProvenFixesReading } from "../fix-standing.ts";
import type { ReportAccuracyReading } from "../workers/claim-audit.ts";

export interface DoorFacts {
  readonly walks: number;
  readonly given: number;
  readonly used: number;
  readonly since: string | null;
}

const pct = (v: number): number => Math.round(v * 100);

function weeksOf(trends: LearningTrends, series: readonly LearningSeries[], scale: (v: number) => number): readonly TrendWeek[] {
  return trends.weeks.map((week, i) => {
    const points = series.map((s) => s.points[i]);
    // A week is a gap only when none of its series recorded anything; a series with no record beside one that did draws no bar height.
    if (points.every((p) => p === undefined || p.value === null)) return { week, values: null };
    return { week, values: points.map((p) => (p === undefined || p.value === null ? 0 : scale(p.value))) };
  });
}

function trend(trends: LearningTrends, input: {
  readonly question: string;
  readonly series: readonly { readonly s: LearningSeries; readonly color: Trend["series"][number]["color"] }[];
  readonly format: Trend["format"];
  readonly limits: string;
  readonly method: Trend["method"];
}): Trend {
  const list = input.series.map((x) => x.s);
  const scale = input.format === "pct" ? pct : (v: number) => Math.round(v * 100) / 100;
  const weeks = weeksOf(trends, list, scale);
  const latest = [...trends.weeks.keys()].reverse().find((i) => list[0].points[i]?.value !== null && list[0].points[i]?.value !== undefined);
  const lead = latest === undefined ? null : list[0].points[latest];
  const big = lead === null || lead === undefined || lead.value === null ? "—" : input.format === "pct" ? `${pct(lead.value)}%` : `${lead.floor ? "at least " : ""}$${lead.value.toFixed(2)}`;
  const bigNote = lead === null || lead === undefined || lead.value === null
    ? ""
    : `${list[0].label}, week of ${trends.weeks[latest!]}${lead.of !== null ? `, out of ${lead.of.toLocaleString("en-US")}` : ""}`;
  const peak = Math.max(...weeks.flatMap((w) => w.values ?? []), 0);
  return {
    question: input.question,
    big,
    bigNote,
    series: input.series.map((x) => ({ name: x.s.label, color: x.color })),
    weeks,
    format: input.format,
    max: input.format === "pct" ? 100 : peak > 0 ? peak : 1,
    limits: input.limits,
    method: input.method,
  };
}

export function v6LearningView(trends: LearningTrends, doors: DoorFacts | null, bankWriteErrors?: number | null): LearningView {
  const s = trends.series;
  const trendList: Trend[] = [];
  if (s.handed.measuredWeeks > 0) {
    trendList.push(trend(trends, {
      question: "Are ways in learned once, then used free forever?",
      series: [{ s: s.handed, color: "teal" }, { s: s.used, color: "blue" }],
      format: "pct",
      limits: "A weekly series is a measurement over time, not proof of improvement: each week's walks hunted different records. Whether a learned way in is then walked by plain code, for free, is not recorded, so the saving cannot be shown.",
      method: [
        { k: "Counts", v: "Paid Scout walks by the UTC week they started." },
        { k: "Handed", v: "Of walks that record the field-manual pair, the share handed at least one way in." },
        { k: "Used", v: "Of walks handed ways in that record which they used, the share that used at least one." },
        { k: "A week with no record", v: "Shown as a gap, never zero." },
      ],
    }));
  }
  if (s.resumedFound.measuredWeeks > 0) {
    trendList.push(trend(trends, {
      question: "Does it get better after it fails?",
      series: [{ s: s.resumedFound, color: "teal" }, { s: s.freshFound, color: "gray" }],
      format: "pct",
      limits: "Refused attempts are left out of both. The two groups hunted different records, so this is an observation, not proof that the lesson stuck.",
      method: [
        { k: "Resumed", v: "Unrefused walks that started from the ways an earlier walk had ruled out, and the share that found something." },
        { k: "Fresh", v: "Unrefused walks that started from nothing, and the share that found something." },
      ],
    }));
  }
  if (s.perFind.measuredWeeks > 0) {
    trendList.push(trend(trends, {
      question: "Is a record getting cheaper over time?",
      series: [{ s: s.perFind, color: "amber" }],
      format: "usd",
      limits: "A find is an attempt that found a way in or the record; this series does not join those finds to verified public delivery. A week with a charge that reported no dollars is a floor.",
      method: [
        { k: "Dollars per find", v: "What paid Scout work cost in the week, over the attempts that found something, where every charge reported its dollars." },
      ],
    }));
  }

  const readings: Reading[] = [];
  for (const series of [s.scoutReused, s.detectiveReused]) {
    const latest = [...series.points].reverse().find(point => point.value !== null);
    if (latest) readings.push({ question: series.label, big: latest.value!.toLocaleString("en-US"),
      bigNote: `routes reused in the week of ${latest.week}`, body: "Successful walks through inherited doors, grouped by who first found them.",
      method: [{ k: "Counted", v: "Only doors with a recorded finder. Older doors with no finder remain unassigned." }] });
  }
  if (bankWriteErrors !== undefined) readings.push({ question: "Are lessons reaching the Bank?", big: bankWriteErrors === null ? "—" : bankWriteErrors.toLocaleString("en-US"),
    bigNote: "Bank write errors", body: "Failed writes after their retry attempts.",
    method: [{ k: "Counted", v: "Bank writes that could not be saved after retries. A count unavailable from the store shows —." }] });
  if (doors !== null && doors.walks > 0) {
    readings.push({
      question: "Do walks use the ways in they are handed?",
      big: `${doors.used.toLocaleString("en-US")} of ${doors.given.toLocaleString("en-US")}`,
      bigNote: `ways in used, of those handed to ${doors.walks.toLocaleString("en-US")} walks since ${doors.since ?? "the record began"}`,
      body: "Handed ways in come from the field manual. A way in a walk did not use may still help the next walk; this counts use, not value.",
      method: [{ k: "Counted", v: "Ways in handed to walks that record which they used, out of every way in handed to those walks." }],
    });
  }
  if (trends.escalations.ladderWalks > 0) {
    readings.push({
      question: "Is it reaching for expensive AI less often?",
      big: `${trends.escalations.recorded.toLocaleString("en-US")} of ${trends.escalations.ladderWalks.toLocaleString("en-US")}`,
      bigNote: "walks that recorded their model ladder and escalated to a more capable model",
      body: trends.escalations.says,
      method: [{ k: "Counted", v: "Walks that recorded their ladder (from September 25, 2026); older walks are named, never counted as zero." }],
    });
  }

  const notMeasured: NotMeasured[] = [
    ...(s.handed.measuredWeeks === 0 ? [{ question: "Are ways in learned once, then used free forever?", why: "No paid walk has recorded the field-manual pair yet.", needs: "A paid Scout walk that records the pair" }] : []),
    ...(s.resumedFound.measuredWeeks === 0 ? [{ question: "Does it get better after it fails?", why: "No unrefused walk has recorded whether it resumed.", needs: "Walks that record resumption" }] : []),
    ...(s.perFind.measuredWeeks === 0 ? [{ question: "Is a record getting cheaper over time?", why: "Needs a cost per result first, which needs every charge to say what the work was for.", needs: "Every charge reporting its dollars and what it was for" }] : []),
    { question: "Do blockages clear themselves, or wait for you?", why: "How often a blockage needs you, over time and across all work, is not counted.", needs: "A count of blockages by how they cleared" },
    { question: "Do difficult bodies become routine?", why: "Each body's recent reads are visible, but nothing aggregates them into a trend of hard bodies becoming easy ones.", needs: "A weekly count of bodies by how hard they were to read" },
  ];
  return { trends: trendList, readings, notMeasured };
}

/* ------------------------------------------------------------ scoreboard */

export interface PublicationCounts {
  /** Approved records on the public page: seen fresh, last seen too long ago, and not found there. */
  readonly seen: number;
  readonly stale: number;
  readonly notFound: number;
  readonly unread: number;
  /** Routine contracts published and read back, out of all registered; null when that read failed. */
  readonly contractsReadBack: number | null;
  readonly contracts: number | null;
}

export interface ScoreboardReadings {
  /** The newest orders, newest first; `window` is how many were looked at. */
  readonly orders: readonly V6HistoryReceipt[] | null;
  readonly publication: PublicationCounts | null;
  readonly shutDoors: { readonly shut: number; readonly open: number; readonly setAside: number; readonly unreadable: number } | null;
  /** Reader-days over the capture window. */
  readonly returning: { readonly days: number; readonly readerDays: number; readonly returningDays: number } | null;
  readonly learning: LearningView;
  readonly doors: DoorFacts | null;
  readonly gates: readonly GateHealthRow[] | null;
  readonly readiness: readonly ReadinessCount[];
  /** The week's live audits of published facts (DP-18); null when the audit log could not be read. Absent means not read. */
  readonly audit?: AuditAccuracyReading | null;
  /** The latest worst-case speed pass on the live site (FE-02); null when unreadable or none ran. Absent means not read. */
  readonly speed?: SpeedPass | null;
  /** Where reusable fixes stand (DP-26); null when unreadable. Absent means not read. */
  readonly provenFixes?: ProvenFixesReading | null;
  /** The latest weekly check of the team's claimed wins (DP-33); null when none in two weeks or unreadable. Absent means not read. */
  readonly reportAccuracy?: ReportAccuracyReading | null;
}

/** Approved records by what the public page showed, from the published pipeline read; every state is counted, none is dropped. */
export function publicationCountsOf(read: PipelineRead, contracts: { readonly readBack: number; readonly total: number } | null): PublicationCounts {
  const t = { seen: 0, stale: 0, notFound: 0, unread: 0 };
  for (const a of read.approved) {
    if (a.witness === "CONFIRMED_FRESH") t.seen += a.n;
    else if (a.witness === "CONFIRMED_STALE") t.stale += a.n;
    else if (a.witness === "NOT_OBSERVED") t.notFound += a.n;
    else t.unread += a.n;
  }
  return { ...t, contractsReadBack: contracts?.readBack ?? null, contracts: contracts?.total ?? null };
}

const n = (k: number): string => k.toLocaleString("en-US");
/** Rounded down, so a share never claims more than was counted. */
const share = (k: number, of: number): string | null => (of > 0 ? `${Math.floor((k * 100) / of)}%` : null);

function row(id: string, name: string, over: Partial<ScoreboardRow> & { says: string }): ScoreboardRow {
  return { id, name, value: null, counts: null, notMeasured: null, ...over };
}
function unmeasured(id: string, name: string, why: string): ScoreboardRow {
  return row(id, name, { says: "Not measured yet.", notMeasured: why });
}

function ordersRow(orders: ScoreboardReadings["orders"]): ScoreboardRow {
  const id = "Orders", name = "Orders";
  if (orders === null) return unmeasured(id, name, "The order history could not be read just now.");
  if (orders.length === 0) return row(id, name, { value: "0", counts: "0 orders in the history", says: "No order has been given yet." });
  const c = (...statuses: string[]) => orders.filter((o) => statuses.includes(o.status)).length;
  const waiting = c("queued", "read"), running = c("running"), done = c("done"), partial = c("partial"), failed = c("refused", "failed"), unknown = c("unknown");
  const reasons = orders.filter((o) => o.status === "refused" || o.status === "failed").slice(0, 3).map((o) => o.says).filter((s) => s !== "");
  const parts = [`${n(done)} done`, ...(partial > 0 ? [`${n(partial)} partly done`] : []), ...(running > 0 ? [`${n(running)} in progress`] : []), ...(waiting > 0 ? [`${n(waiting)} waiting`] : []),
    ...(failed > 0 ? [`${n(failed)} could not be done`] : []), ...(unknown > 0 ? [`${n(unknown)} not confirmed`] : [])];
  return row(id, name, {
    value: n(orders.length),
    counts: parts.join(" · "),
    says: `The newest ${n(orders.length)} orders${reasons.length > 0 ? `. Could not be done: ${reasons.join(" ")}` : "."}`,
  });
}

function deliveryRow(p: PublicationCounts | null): ScoreboardRow {
  const id = "Public delivery", name = "Public delivery";
  if (p === null) return unmeasured(id, name, "The published records and their public page checks could not be read just now.");
  const total = p.seen + p.stale + p.notFound + p.unread;
  const contracts = p.contracts !== null && p.contractsReadBack !== null ? ` ${n(p.contractsReadBack)} of ${n(p.contracts)} kinds of record are published and read back.` : "";
  if (total === 0) return row(id, name, { says: `No accepted record is waiting to show.${contracts}`, notMeasured: "No accepted record has been counted yet." });
  return row(id, name, {
    value: share(p.seen, total),
    counts: `${n(p.seen)} of ${n(total)} accepted records seen on the public page${p.notFound > 0 ? ` · ${n(p.notFound)} not found there` : ""}${p.unread > 0 ? ` · ${n(p.unread)} not checked` : ""}`,
    says: `Counts accepted records the page was checked for.${contracts}`,
  });
}

function freshnessRow(p: PublicationCounts | null): ScoreboardRow {
  const id = "Freshness", name = "Freshness";
  if (p === null) return unmeasured(id, name, "The published records and their public page checks could not be read just now.");
  const checked = p.seen + p.stale;
  if (checked === 0) return unmeasured(id, name, "No accepted record has been seen on the page yet, so nothing can be called on schedule or overdue.");
  return row(id, name, {
    value: share(p.seen, checked),
    counts: `${n(p.seen)} of ${n(checked)} seen on the page recently · ${n(p.stale)} overdue`,
    says: "Counts records last seen on the public page within the allowed time; records never seen there are counted under Public delivery.",
  });
}

function shutDoorsRow(d: ScoreboardReadings["shutDoors"]): ScoreboardRow {
  const id = "Shut doors", name = "Shut doors";
  if (d === null) return unmeasured(id, name, "The door registry could not be read just now, so no door is called shut.");
  return row(id, name, {
    value: n(d.shut),
    counts: `${n(d.shut)} shut · ${n(d.open)} open · ${n(d.setAside)} set aside${d.unreadable > 0 ? ` · ${n(d.unreadable)} unreadable` : ""}`,
    says: "How many ways in are shut right now. How long each took to reopen is not recorded yet.",
  });
}

function returnsRow(r: ScoreboardReadings["returning"]): ScoreboardRow {
  const id = "Return visits", name = "Return visits";
  if (r === null) return unmeasured(id, name, "Reader counts could not be read just now.");
  if (r.readerDays === 0) return unmeasured(id, name, `No readers were recorded in the last ${n(r.days)} days.`);
  return row(id, name, {
    value: share(r.returningDays, r.readerDays),
    counts: `${n(r.returningDays)} of ${n(r.readerDays)} reader-days were returning readers`,
    says: `A reader counts once for each day they came, over the last ${n(r.days)} days.`,
  });
}

function headStartRow(d: DoorFacts | null): ScoreboardRow {
  const id = "Head-start hit rate", name = "Head-start hit rate";
  if (d === null || d.walks === 0) return unmeasured(id, name, "No walk has recorded which handed ways in it used yet.");
  return row(id, name, {
    value: share(d.used, d.given),
    counts: `${n(d.used)} of ${n(d.given)} handed ways in used, across ${n(d.walks)} walks since ${d.since ?? "the record began"}`,
    says: "Counts use of the ways in the Bank handed over. Whether the Bank alone was enough is not recorded.",
  });
}

const easternDay = (iso: string): string => new Date(iso).toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" });

/** DP-18: "Of N facts audited this week, X% are still accurate. Here are the K we fixed." "—" when nothing was judged. */
export function auditRow(a: AuditAccuracyReading | null | undefined): ScoreboardRow {
  const id = "Audit accuracy", name = "Audit accuracy";
  if (a === undefined) return unmeasured(id, name, "The auditors' green and red flags are not recorded here yet.");
  if (a === null) return unmeasured(id, name, "The auditors' record could not be read just now.");
  const counts = [
    `${n(a.stillRight)} still right`, `${n(a.wrong)} wrong`,
    ...(a.couldNotJudge > 0 ? [`${n(a.couldNotJudge)} could not be checked`] : []),
    `${n(a.fixed)} fixed`, `${n(a.pulled)} taken off the page`,
  ].join(" · ");
  const items = a.fixedFacts.map((f) => `${f.action === "PULLED" ? "Taken off the page" : "Fixed"} ${easternDay(f.at)}: ${f.summary}`);
  const technical = a.fixedFacts.map((f) => `${f.factId} · ${f.family} · ${f.area} · ${f.action} · ${f.at}`);
  const second = a.coverageLine === null ? "" : ` ${a.coverageLine}`;
  if (a.accuratePercent === null) {
    return row(id, name, { counts: a.couldNotJudge > 0 || a.fixedFacts.length > 0 ? counts : null, says: `No published fact was judged this week.${second}`,
      notMeasured: a.notMeasured ?? "No published fact has been audited this week.", items, technical });
  }
  return row(id, name, { value: `${a.accuratePercent}%`, counts, says: `${a.sentence}${second}`, items, technical });
}

/** FE-02: each surface and sampled ZIP, phone and desktop, judged by its slowest visit against three seconds. */
export function speedRow(p: SpeedPass | null | undefined): ScoreboardRow {
  const id = "Site speed and reliability", name = "Site speed and reliability";
  if (p === undefined) return unmeasured(id, name, "Page load times and errors are not recorded here yet.");
  if (p === null) return unmeasured(id, name, "No speed check of the live site has been recorded in the last two days.");
  const total = p.passed + p.failed;
  if (total === 0) return unmeasured(id, name, "The last speed check measured nothing.");
  const failing = p.rows.filter((r) => r.verdict === "FAIL");
  return row(id, name, {
    value: `${n(p.passed)} of ${n(total)}`,
    counts: `${n(p.passed)} within ${p.budgetMs / 1000} seconds · ${n(p.failed)} too slow or never finished · ${n(p.zips.length)} ZIP codes`,
    says: `Every page and Ask question, judged by its slowest visit on a phone and a desktop. Checked ${formatEastern(p.at)}.`,
    items: [...failing, ...p.rows.filter((r) => r.verdict === "PASS")].map((r) => `${r.verdict === "PASS" ? "Within the limit" : "Too slow"}: ${r.says}`),
  });
}

/** DP-26: how many fixes proved out across places, and any proven fix that broke. */
export function provenFixesRow(p: ProvenFixesReading | null | undefined): ScoreboardRow {
  const id = "Proven fixes", name = "Proven fixes";
  if (p === undefined) return unmeasured(id, name, "Fixes proved across places are not recorded here yet.");
  if (p === null) return unmeasured(id, name, "Where each fix stands could not be read just now.");
  if (p.proven + p.testing === 0) return unmeasured(id, name, "No reusable fix has been tried in a place yet.");
  const broke = p.broke.length;
  return row(id, name, {
    value: n(p.proven),
    counts: `${n(p.proven)} proven · ${n(p.testing)} testing${broke > 0 ? ` · ${n(broke)} broke in the last 30 days` : ""}`,
    says: broke > 0 ? `${n(broke)} proven fix${broke === 1 ? "" : "es"} broke in the last 30 days.` : "A proven fix worked in enough places across more than one district or state. None broke in the last 30 days.",
    items: p.broke.map((b) => `Broke ${easternDay(b.at)}: ${b.title}${b.stillProven ? " (still proven)" : " (back in testing)"}`),
  });
}

/** DP-33: "X of K claimed wins confirmed", recomputed from source records by the claim auditors. */
export function reportAccuracyRow(a: ReportAccuracyReading | null | undefined): ScoreboardRow {
  const id = "Report accuracy", name = "Report accuracy";
  if (a === undefined) return unmeasured(id, name, "Auditor confirmation of the team's claimed wins is not recorded here yet.");
  if (a === null) return unmeasured(id, name, "No weekly check of the team's claimed wins in the last two weeks.");
  const judged = a.confirmed + a.wrong;
  if (judged === 0) return unmeasured(id, name, a.couldNotCheck > 0 ? `${n(a.couldNotCheck)} claimed wins were sampled, but none could be checked against its records.` : "No claimed win was sampled in the last check.");
  return row(id, name, {
    value: `${n(a.confirmed)} of ${n(judged)}`,
    counts: `${n(a.confirmed)} confirmed · ${n(a.wrong)} wrong${a.couldNotCheck > 0 ? ` · ${n(a.couldNotCheck)} could not be checked` : ""}`,
    says: `Report accuracy: ${n(a.confirmed)} of ${n(judged)} claimed wins confirmed from their source records. Checked ${formatEastern(a.at)}.`,
    items: a.wrongClaims.map((w) => `Wrong: ${w.claimed} ${w.cause}`.trim()),
  });
}

const GATE_ROWS: readonly { id: string; name: string; why: string }[] = [
  { id: "Mission progress", name: "Mission progress", why: "The mission map is built in a later step." },
  { id: "Checklist completeness", name: "Checklist completeness", why: "Counted place by place; the Scoreboard reads those counts in a later step." },
  { id: "Coverage", name: "Coverage", why: "Counted against what a place is expected to have, in a later step." },
  { id: "People coverage", name: "People coverage", why: "The full-profile count is built in a later step." },
  { id: "Facts live per hour", name: "Facts live per hour", why: "Counted in a later step, once each fact carries when it went live." },
  { id: "Cost per fact", name: "Cost per fact", why: "Counted in a later step, from the same record as facts live per hour." },
  { id: "Posted to live", name: "Posted to live", why: "The time from a body posting to our page showing it is not recorded yet." },
  { id: "Look and feel", name: "Look and feel", why: "The front-end flags are not recorded here yet." },
  { id: "Time to repair", name: "Time to repair", why: "The time from breaking to working again is not recorded yet." },
  { id: "Repairs without code", name: "Repairs without code", why: "Which repairs needed no code change is not recorded yet." },
];

/** The Scoreboard in the design's order. Every number in the list has a row; one with no reading says "—" and why. */
export function buildScoreboard(r: ScoreboardReadings): ScoreboardView {
  const byId = new Map<string, ScoreboardRow>([
    ["Orders", ordersRow(r.orders)],
    ["Public delivery", deliveryRow(r.publication)],
    ["Freshness", freshnessRow(r.publication)],
    ["Shut doors", shutDoorsRow(r.shutDoors)],
    ["Return visits", returnsRow(r.returning)],
    ["Head-start hit rate", headStartRow(r.doors)],
    ["Audit accuracy", auditRow(r.audit)],
    ["Site speed and reliability", speedRow(r.speed)],
    ["Proven fixes", provenFixesRow(r.provenFixes)],
    ["Report accuracy", reportAccuracyRow(r.reportAccuracy)],
    ...GATE_ROWS.map((g): [string, ScoreboardRow] => [g.id, unmeasured(g.id, g.name, g.why)]),
  ]);
  const ORDER = ["Orders", "Mission progress", "Checklist completeness", "Coverage", "Public delivery", "People coverage", "Facts live per hour", "Cost per fact", "Audit accuracy",
    "Freshness", "Shut doors", "Posted to live", "Look and feel", "Site speed and reliability", "Return visits", "Time to repair", "Repairs without code", "Proven fixes", "Report accuracy", "Head-start hit rate"];
  const rows = ORDER.map((id) => byId.get(id)!);
  const gateRows: ScoreboardGateRow[] | null = r.gates === null ? null : r.gates.map((g) => ({ name: g.name, state: g.state, sentence: g.sentence }));
  const gateSummary = r.gates === null ? null : summarizeGateHealth(r.gates);
  const readiness: ScoreboardReadinessRow[] = r.readiness.map((c) => ({ name: c.name, witnessed: c.witnessed, failing: c.failing, notMeasured: c.notMeasured, of: c.of }));
  return {
    rows,
    gates: gateRows === null || gateSummary === null ? null : { rows: gateRows, pass: gateSummary.pass, attention: gateSummary.attention, notMeasured: gateSummary.notMeasured },
    readiness,
    learning: r.learning,
  };
}

