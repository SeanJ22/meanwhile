/**
 * @freshness-reads-here: `observedAt` is the instant this module's own read of the store's totals returned.
 *
 * Aggregate only: small groups are never hidden, and only the aggregate fields below are passed on. An empty list is
 * never shown as "nobody asked".
 */
import { liveTotals } from "../data-business/live.ts";
import { daysBefore, todayUtc } from "../data-business/slice.ts";
import type { Sources } from "../data-business/read.ts";

export const FREE_FORM_TOPIC = "free-form";
export const TOPIC_ROW_LIMIT = 500;

/** One aggregate row. Exactly these fields; nothing about any one person. */
export interface TopicCountRow {
  readonly period: string;
  readonly grain: "day" | "week";
  readonly zip: string | null;
  readonly district: string | null;
  readonly topic: string;
  readonly users: number;
  readonly totalUsers: number;
}

export type TopicCountsRead =
  | { readonly kind: "RECORDED"; readonly observedAt: string; readonly rows: readonly TopicCountRow[] }
  | { readonly kind: "NOT_INSTALLED"; readonly detail: string };

/** Structurally `TopicCountsView` in `topic-counts.tsx`. */
export type TopicCountsView =
  | { readonly kind: "NOT_INSTALLED"; readonly says: string }
  | { readonly kind: "READ"; readonly observedAt: string; readonly rows: readonly TopicShown[]; readonly hidden: number; readonly periods: readonly string[]; readonly topics: readonly string[] };

export interface TopicShown {
  readonly period: string;
  readonly grain: "day" | "week";
  readonly place: string;
  readonly kind: "zip" | "district" | "all";
  readonly topic: string;
  readonly topicLabel: string;
  readonly users: number;
  readonly totalUsers: number;
  /** Rounded to a tenth; null when the group has no users to take a share of. */
  readonly percent: number | null;
}

export const NO_TOPIC_COUNTS_YET = "—";

export function topicLabel(topic: string): string {
  if (topic === FREE_FORM_TOPIC) return "Free-form question";
  const words = topic.replace(/[_.-]+/g, " ").trim();
  return words === "" ? "Unnamed topic" : words.charAt(0).toUpperCase() + words.slice(1);
}

const isCount = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0;
const isWeek = (w: unknown): w is string => typeof w === "string" && /^\d{4}-\d{2}-\d{2}$/.test(w);

/** A malformed row is counted in `hidden` and named, never silently dropped. */
export function topicCountsView(read: TopicCountsRead): TopicCountsView {
  if (read.kind === "NOT_INSTALLED") return { kind: "NOT_INSTALLED", says: read.detail || NO_TOPIC_COUNTS_YET };
  const shown: TopicShown[] = [];
  let hidden = 0;
  for (const raw of read.rows as unknown as readonly Record<string, unknown>[]) {
    const { period, grain, zip, district, topic, users, totalUsers } = raw;
    const zipOk = zip === null || zip === undefined || (typeof zip === "string" && /^\d{5}$/.test(zip));
    if (!isWeek(period) || (grain !== "day" && grain !== "week") || typeof topic !== "string" || topic === "" || !isCount(users) || !isCount(totalUsers) || users > totalUsers || !zipOk) { hidden += 1; continue; }
    const place = typeof zip === "string" ? `ZIP ${zip}` : typeof district === "string" && district !== "" ? district : "Everyone";
    shown.push({ period, grain, place, kind: typeof zip === "string" ? "zip" : typeof district === "string" && district !== "" ? "district" : "all", topic,
      topicLabel: topicLabel(topic), users, totalUsers, percent: totalUsers === 0 ? null : Math.round((users / totalUsers) * 1000) / 10 });
  }
  shown.sort((a, b) => b.period.localeCompare(a.period) || (b.percent ?? -1) - (a.percent ?? -1) || a.place.localeCompare(b.place) || a.topic.localeCompare(b.topic));
  return {
    kind: "READ", observedAt: read.observedAt, rows: shown.slice(0, TOPIC_ROW_LIMIT), hidden: hidden + Math.max(0, shown.length - TOPIC_ROW_LIMIT),
    periods: [...new Set(shown.map((r) => `${r.grain}:${r.period}`))].sort().reverse(), topics: [...new Set(shown.map((r) => r.topic))].sort(),
  };
}

export async function readTopicCounts(totals: Sources["totals"] = liveTotals(), now: Date = new Date()): Promise<TopicCountsRead> {
  const to = todayUtc(now);
  const rows: TopicCountRow[] = [];
  for (const [grain, from] of [["week", daysBefore(to, 12 * 7)], ["day", daysBefore(to, 13)]] as const) {
    const read = await totals({ grain, from, to, family: "all" });
    if (read.kind === "NOT_INSTALLED") return { kind: "NOT_INSTALLED", detail: read.detail };
    const all = new Map(read.rows.filter((r) => r.topic === "*" && r.type === "*").map((r) => [r.period, r.users]));
    for (const r of read.rows) if (r.topic !== "*" && r.type === "*") rows.push({ period: r.period, grain, zip: null, district: null, topic: r.topic, users: r.users, totalUsers: all.get(r.period) ?? 0 });
  }
  return { kind: "RECORDED", observedAt: now.toISOString(), rows };
}
