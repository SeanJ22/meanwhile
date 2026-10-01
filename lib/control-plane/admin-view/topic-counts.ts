/**
 * **WHAT RESIDENTS ASK ABOUT, AS A SHARE OF USERS — aggregate only.**
 *
 * The shape S6's read returns (asked for on #490): one row per week, ZIP or district, and topic, with the number of distinct
 * users who asked about that topic and the number of distinct users in that same group. This module turns those rows into what
 * Admin shows: each as a percentage of users with the count beside it. Small groups are shown the same way and are never hidden
 * or suppressed. Free-form questions stay as their own topic. Nothing here carries a name, an address, or a user, session or
 * device id: a row with only the aggregate fields below is all this module will pass on, whatever else it was handed.
 *
 * Until S6's read exists, `readTopicCounts()` answers NOT_INSTALLED, and the view says "no topic counts yet". An empty list is
 * never shown as "nobody asked".
 */
export const FREE_FORM_TOPIC = "free-form";
export const TOPIC_ROW_LIMIT = 500;

/** One aggregate row. Exactly these fields; nothing about any one person. */
export interface TopicCountRow {
  /** The Monday of the week, `YYYY-MM-DD` (UTC). */
  readonly week: string;
  /** Five digits, or null when the group is not by ZIP. */
  readonly zip: string | null;
  /** The district's own stable label, or null. */
  readonly district: string | null;
  /** An id from the internal taxonomy, or "free-form". */
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
  | { readonly kind: "READ"; readonly observedAt: string; readonly rows: readonly TopicShown[]; readonly hidden: number; readonly weeks: readonly string[]; readonly topics: readonly string[] };

export interface TopicShown {
  readonly week: string;
  readonly place: string;
  readonly kind: "zip" | "district" | "all";
  readonly topic: string;
  readonly topicLabel: string;
  readonly users: number;
  readonly totalUsers: number;
  /** Rounded to a tenth; null when the group has no users to take a share of. */
  readonly percent: number | null;
}

export const NO_TOPIC_COUNTS_YET = "No topic counts yet. They appear here as soon as the counts exist; nothing here is a count of zero.";

/** "tax-and-fees" → "Tax and fees". A taxonomy id becomes words; free-form keeps its own name. */
export function topicLabel(topic: string): string {
  if (topic === FREE_FORM_TOPIC) return "Free-form question";
  const words = topic.replace(/[_.-]+/g, " ").trim();
  return words === "" ? "Unnamed topic" : words.charAt(0).toUpperCase() + words.slice(1);
}

const isCount = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0;
const isWeek = (w: unknown): w is string => typeof w === "string" && /^\d{4}-\d{2}-\d{2}$/.test(w);

/**
 * The rows to show: only well-formed aggregate rows, only their aggregate fields, never a group dropped for being small.
 * A row that is malformed (a count that is not a whole number, more askers than users) is counted in `hidden` and named, never
 * silently dropped, and never shown as a number it does not have.
 */
export function topicCountsView(read: TopicCountsRead): TopicCountsView {
  if (read.kind === "NOT_INSTALLED") return { kind: "NOT_INSTALLED", says: read.detail || NO_TOPIC_COUNTS_YET };
  const shown: TopicShown[] = [];
  let hidden = 0;
  for (const raw of read.rows as unknown as readonly Record<string, unknown>[]) {
    const { week, zip, district, topic, users, totalUsers } = raw;
    const zipOk = zip === null || zip === undefined || (typeof zip === "string" && /^\d{5}$/.test(zip));
    if (!isWeek(week) || typeof topic !== "string" || topic === "" || !isCount(users) || !isCount(totalUsers) || users > totalUsers || !zipOk) { hidden += 1; continue; }
    const place = typeof zip === "string" ? `ZIP ${zip}` : typeof district === "string" && district !== "" ? district : "Everyone";
    shown.push({ week, place, kind: typeof zip === "string" ? "zip" : typeof district === "string" && district !== "" ? "district" : "all", topic,
      topicLabel: topicLabel(topic), users, totalUsers, percent: totalUsers === 0 ? null : Math.round((users / totalUsers) * 1000) / 10 });
  }
  shown.sort((a, b) => b.week.localeCompare(a.week) || (b.percent ?? -1) - (a.percent ?? -1) || a.place.localeCompare(b.place) || a.topic.localeCompare(b.topic));
  return {
    kind: "READ", observedAt: read.observedAt, rows: shown.slice(0, TOPIC_ROW_LIMIT), hidden: hidden + Math.max(0, shown.length - TOPIC_ROW_LIMIT),
    weeks: [...new Set(shown.map((r) => r.week))].sort().reverse(), topics: [...new Set(shown.map((r) => r.topic))].sort(),
  };
}

/** The seam S6's read plugs into. Until it exists this is NOT_INSTALLED, never an empty list. */
export async function readTopicCounts(): Promise<TopicCountsRead> {
  return { kind: "NOT_INSTALLED", detail: NO_TOPIC_COUNTS_YET };
}
