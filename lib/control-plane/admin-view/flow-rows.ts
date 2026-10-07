/** A day nothing was recorded for is a gap, never a zero; spend with an unpriced charge is unknown, not low. Rechecks earn no credit. */
import type { ScoreboardFlowDay, ScoreboardRow } from "../../../app/(admin)/_mw/admin-v6/model.ts";
import type { FlowDay, FlowRead, FlowWeek } from "./flow-read.ts";

const n = (k: number): string => k.toLocaleString("en-US");
const day = (iso: string): string => new Date(iso).toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" });
const rate = (v: number): string => (v >= 10 ? n(Math.round(v)) : String(Math.round(v * 10) / 10));
const dollars = (v: number): string => (v >= 1 ? `$${v.toFixed(2)}` : `$${v.toFixed(3)}`);
const base = { notMeasured: null, value: null, counts: null } as const;
const unmeasured = (id: string, why: string): ScoreboardRow => ({ id, name: id, ...base, says: "Not measured yet.", notMeasured: why });

const liveOf = (r: FlowRead): number => r.hours.reduce((k, h) => k + h.liveRecords, 0);
const hoursOf = (r: FlowRead): number => r.hours.length;

function trendOf(days: readonly FlowDay[], value: (r: FlowRead) => number | null): NonNullable<ScoreboardRow["trend"]> {
  return days.map((d) => ({ label: day(d.through), value: d.read === null ? null : value(d.read) }));
}

export function flowRows(week: FlowWeek | null | undefined): readonly [string, ScoreboardRow][] {
  const f = "Facts live per hour", c = "Cost per fact";
  if (week === undefined) return [[f, unmeasured(f, "The hourly flow of facts is not read here yet.")], [c, unmeasured(c, "The hourly flow of facts is not read here yet.")]];
  if (week === null || week.hoursRecorded === 0) {
    const why = "Nothing has been recorded about facts going live yet, or the record could not be read just now.";
    return [[f, unmeasured(f, why)], [c, unmeasured(c, why)]];
  }
  const counts = `${n(week.liveRecords)} new or changed reader records live over ${n(week.hoursRecorded)} recorded hours`;
  const perHour: ScoreboardRow = {
    id: f, name: f, notMeasured: null, value: rate(week.factsLivePerHour ?? 0), counts,
    says: "New or changed reader records that went live, per hour, over the last seven days. Rechecks that changed nothing are not counted.",
    trend: trendOf(week.days, (r) => liveOf(r) / hoursOf(r)),
  };
  if (week.settledSpendUsd === null) {
    const why = week.unpricedHours > 0 ? `${n(week.unpricedHours)} recorded hours had a charge with no price, so spend is not known yet and no cost is shown.` : "No spend was recorded for these hours.";
    return [[f, perHour], [c, { ...unmeasured(c, why), counts }]];
  }
  if (week.costPerFactUsd === null) return [[f, perHour], [c, { ...unmeasured(c, "No fact went live in the recorded hours, so there is no cost per fact."), counts: `${dollars(week.settledSpendUsd)} settled spend · 0 facts live` }]];
  return [[f, perHour], [c, {
    id: c, name: c, notMeasured: null, value: dollars(week.costPerFactUsd),
    counts: `${dollars(week.settledSpendUsd)} settled spend ÷ ${n(week.liveRecords)} facts live`,
    says: "Settled spend divided by new or changed reader records that went live, over the same recorded hours in the last seven days.",
    trend: trendOf(week.days, (r) => (r.settledSpendUsd !== null && liveOf(r) > 0 ? r.settledSpendUsd / liveOf(r) : null)),
  }]];
}

export function flowStages(week: FlowWeek | null | undefined): readonly ScoreboardFlowDay[] | null {
  if (week === null || week === undefined || week.hoursRecorded === 0) return null;
  return week.days.map((d): ScoreboardFlowDay => {
    if (d.read === null) return { label: day(d.through), findings: null, built: null, checked: null, live: null };
    const sum = (key: "findings" | "builtFindings" | "checkedRecords" | "liveRecords"): number => d.read!.hours.reduce((k, h) => k + h[key], 0);
    return { label: day(d.through), findings: sum("findings"), built: sum("builtFindings"), checked: sum("checkedRecords"), live: sum("liveRecords") };
  });
}

export function spendAnswer(week: FlowWeek | null | undefined): { readonly says: string; readonly spendUsd: number | null; readonly facts: number } | null {
  const last = week?.days[week.days.length - 1]?.read ?? null;
  if (last === null) return null;
  const facts = liveOf(last);
  if (last.settledSpendUsd === null) return { says: `Spend over the last day is not known yet: some charges have no price. ${n(facts)} new or changed reader records went live.`, spendUsd: null, facts };
  const cost = facts > 0 ? `, ${dollars(last.settledSpendUsd / facts)} per fact` : ", so there is no cost per fact";
  return { says: `We spent ${dollars(last.settledSpendUsd)} over the last day and ${n(facts)} new or changed reader records went live${cost}.`, spendUsd: last.settledSpendUsd, facts };
}
