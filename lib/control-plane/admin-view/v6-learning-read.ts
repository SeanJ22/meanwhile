/**
 * **`admin-v6/learning@1` — THE "IS IT LEARNING" VIEW'S READING.** (S11; replaces
 * the old Learning page, rulings §0.)
 *
 * Weekly series come from the Scout results the control plane already holds
 * (`learning-trends.ts`): walks handed ways in from the field manual and how many
 * used them, resumed against fresh walks, and dollars per find. A week with no
 * record is a gap (`values: null`), never a zero. Single readings and the
 * questions nothing measures yet are stated as exactly that. PURE: trends in,
 * view out.
 */
import type { LearningView, NotMeasured, Reading, Trend, TrendWeek } from "../../../app/(admin)/_mw/admin-v6/model.ts";
import type { LearningSeries, LearningTrends } from "./learning-trends.ts";

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

export function v6LearningView(trends: LearningTrends, doors: DoorFacts | null, bankWriteErrors: number | null = null): LearningView {
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
  readings.push({ question: "Are lessons reaching the Bank?", big: bankWriteErrors === null ? "—" : bankWriteErrors.toLocaleString("en-US"),
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
