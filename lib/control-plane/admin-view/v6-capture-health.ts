/**
 * @freshness-reads-here: `observedAt` is the instant this module's own reads of the store returned.
 *
 * Each block goes through `readRecipe`, so a recipe switched off for Admin shows as off, not empty. No block carries an
 * anonymous ID, an exact time or one person's trail.
 */
import { switchOn } from "../data-business/switches.ts";
import { readRecipe, type ReadDeps, type ReadResult } from "../data-business/read.ts";
import { daysBefore, periodOf, stateOfDivision, todayUtc } from "../data-business/slice.ts";
import type { AdminConfig } from "../gateway/admin-config.ts";
import type { CaptureFailures } from "../data-business/live.ts";
import type { TotalsEntry } from "../data-business/types.ts";

export const CAPTURE_DAYS = 14;

export const captureWindow = (now: Date = new Date()): { readonly from: string; readonly to: string } => ({ from: daysBefore(todayUtc(now), CAPTURE_DAYS - 1), to: todayUtc(now) });

export interface CaptureHeadline {
  readonly state: "recording" | "quiet" | "none" | "unknown";
  readonly says: string;
  readonly latestDay: string | null;
}
export interface TypeRow { readonly type: string; readonly perDay: readonly number[]; readonly total: number }
export interface TopicDay { readonly day: string; readonly inTopic: number; readonly freeForm: number; readonly percentInTopic: number | null }
export interface ReaderDay { readonly day: string; readonly readers: number; readonly newReaders: number; readonly returning: number }
export interface DistrictRow { readonly label: string; readonly state: string; readonly events: number; readonly readers: number | null; readonly percent: number | null; readonly population?: import("../../reference/population-facts.ts").PopulationFact | null }

/** One block of the view: its rows, or why it has none. Never an empty list standing in for "unknown". */
export type Block<T> =
  | { readonly kind: "READ"; readonly rows: T }
  | { readonly kind: "OFF" | "UNAVAILABLE"; readonly says: string };

export interface CaptureHealthView {
  readonly observedAt: string;
  readonly from: string;
  readonly to: string;
  readonly days: readonly string[];
  readonly headline: CaptureHeadline;
  readonly byType: Block<readonly TypeRow[]>;
  readonly topics: Block<readonly TopicDay[]>;
  readonly readers: Block<readonly ReaderDay[]>;
  readonly districts: Block<{ readonly week: string; readonly rows: readonly DistrictRow[] }>;
  readonly failures: FailuresView;
}

export type FailuresView =
  | { readonly kind: "MEASURED"; readonly lines: readonly { readonly ok: boolean; readonly says: string }[] }
  | { readonly kind: "UNAVAILABLE"; readonly says: string };

const unavailable = (r: ReadResult): { readonly kind: "OFF" | "UNAVAILABLE"; readonly says: string } =>
  r.kind === "REFUSED" ? { kind: r.why === "SWITCH_OFF" ? "OFF" : "UNAVAILABLE", says: r.says }
    : r.kind === "NOT_INSTALLED" ? { kind: "UNAVAILABLE", says: r.says }
      : { kind: "UNAVAILABLE", says: "—" };
const totalsOf = (r: ReadResult): readonly TotalsEntry[] | null => (r.kind === "READ" && r.body.shape === "totals" ? r.body.rows : null);

export function failuresView(f: CaptureFailures, from: string, to: string): FailuresView {
  if (f.kind === "NOT_INSTALLED") return { kind: "UNAVAILABLE", says: f.detail };
  const lines: { ok: boolean; says: string }[] = [];
  lines.push(f.eventsRecorded === f.eventsCounted
    ? { ok: true, says: `Every recorded event is in the counts: ${f.eventsRecorded.toLocaleString("en-US")} events in ${f.batchesRecorded.toLocaleString("en-US")} batches.` }
    : { ok: false, says: `The batches carry ${f.eventsRecorded.toLocaleString("en-US")} events but the counts hold ${f.eventsCounted.toLocaleString("en-US")}: ${Math.abs(f.eventsRecorded - f.eventsCounted).toLocaleString("en-US")} ${f.eventsRecorded > f.eventsCounted ? "were recorded and not counted" : "are counted that no batch carries"}.` });
  if (f.archivedNotCounted === null) lines.push({ ok: false, says: "Archived batches not in the counts: —" });
  else lines.push(f.archivedNotCounted === 0
    ? { ok: true, says: `No batch in the history store (${from} to ${to}) is missing from the counts.` }
    : { ok: false, says: `${f.archivedNotCounted.toLocaleString("en-US")} batch${f.archivedNotCounted === 1 ? "" : "es"} in the history store (${from} to ${to}) never reached the counts.` });
  return { kind: "MEASURED", lines };
}

export function headlineOf(days: readonly string[], totalsByDay: ReadonlyMap<string, number> | null, today: string): CaptureHeadline {
  if (totalsByDay === null) return { state: "unknown", says: "—", latestDay: null };
  const latest = [...totalsByDay].filter(([, n]) => n > 0).map(([d]) => d).sort().pop() ?? null;
  if (latest === null) return { state: "none", says: `No events were recorded from ${days[0]} to ${days[days.length - 1]}.`, latestDay: null };
  const n = totalsByDay.get(latest) ?? 0;
  if (latest >= daysBefore(today, 1)) return { state: "recording", says: `Capture is recording: ${n.toLocaleString("en-US")} events on ${latest}${latest === today ? " so far today (UTC)" : ""}.`, latestDay: latest };
  return { state: "quiet", says: `The latest events were on ${latest}, ${Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${latest}T00:00:00Z`)) / 86_400_000)} days ago.`, latestDay: latest };
}

export async function readCaptureHealth(deps: ReadDeps, config: AdminConfig | null, failures: CaptureFailures | null, now: Date = new Date()): Promise<CaptureHealthView> {
  const { from, to } = captureWindow(now);
  const days = Array.from({ length: CAPTURE_DAYS }, (_, i) => daysBefore(from, -i));
  const gate: ReadDeps = { ...deps, switchOn: (recipe, audience) => switchOn(config, recipe, audience) };
  const ask = (recipe: string, grain: "day" | "week") => readRecipe({ recipe, slice: { from, to, grain }, audience: "admin" }, gate);
  const [types, topics, readers, districts] = await Promise.all([ask("events-by-type", "day"), ask("topic-vs-free-form", "day"), ask("new-vs-returning", "day"), ask("usage-by-district", "week")]);

  const typeRows = totalsOf(types);
  const perType = new Map<string, Map<string, number>>();
  const perDay = new Map<string, number>();
  for (const e of typeRows ?? []) {
    if (e.period === null) continue;
    (perType.get(e.label) ?? perType.set(e.label, new Map()).get(e.label)!).set(e.period, e.value);
    perDay.set(e.period, (perDay.get(e.period) ?? 0) + e.value);
  }
  const topicRows = totalsOf(topics);
  const readerRows = totalsOf(readers);
  const districtRows = totalsOf(districts);
  const latestWeek = districtRows === null ? null : [...new Set(districtRows.map((r) => r.period ?? ""))].sort().pop() ?? null;

  return {
    observedAt: now.toISOString(), from, to, days,
    headline: headlineOf(days, typeRows === null ? null : perDay, to),
    byType: typeRows === null ? unavailable(types)
      : { kind: "READ", rows: [...perType].map(([type, byDay]) => ({ type, perDay: days.map((d) => byDay.get(d) ?? 0), total: [...byDay.values()].reduce((a, b) => a + b, 0) })).sort((a, b) => b.total - a.total || a.type.localeCompare(b.type)) },
    topics: topicRows === null ? unavailable(topics)
      : { kind: "READ", rows: days.map((day) => {
        const inTopic = topicRows.find((r) => r.period === day && r.label === "In a topic")?.value ?? 0;
        const freeForm = topicRows.find((r) => r.period === day && r.label === "Free-form")?.value ?? 0;
        return { day, inTopic, freeForm, percentInTopic: inTopic + freeForm === 0 ? null : Math.round((inTopic / (inTopic + freeForm)) * 1000) / 10 };
      }) },
    readers: readerRows === null ? unavailable(readers)
      : { kind: "READ", rows: days.map((day) => {
        const n = readerRows.find((r) => r.period === day && r.label === "New readers")?.value ?? 0;
        const back = readerRows.find((r) => r.period === day && r.label === "Returning readers")?.value ?? 0;
        return { day, readers: n + back, newReaders: n, returning: back };
      }) },
    districts: districtRows === null || latestWeek === null ? (districtRows === null ? unavailable(districts) : { kind: "READ", rows: { week: periodOf(to, "week"), rows: [] } })
      : { kind: "READ", rows: { week: latestWeek, rows: districtRows.filter((r) => r.period === latestWeek).map((r) => ({ label: r.label, state: (stateOfDivision(r.series) ?? "").toUpperCase(), events: r.value, readers: r.readers, percent: r.percent,
        ...(districts.kind === "READ" && districts.population ? { population: districts.population.find(denominator => denominator.place === r.series)?.fact ?? null } : {}) })) } },
    failures: failures === null ? { kind: "UNAVAILABLE", says: "—" } : failuresView(failures, from, to),
  };
}
