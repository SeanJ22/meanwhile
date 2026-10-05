/**
 * **DP-32 · PATTERNS IN WHEN DOORS BREAK ARE LEARNED.**
 *
 * A simple pass over the fix list's history (DP-30): when the same door or
 * method breaks in the same month in two or more years, or within a few days
 * after the same known event more than once, it writes one lesson to the
 * field manual naming the pattern and the fix that worked last time, so the
 * next fix is ready before the break comes. It only pays off once history
 * builds up; with too little history it writes nothing.
 *
 * Plain code, no model. Nothing here names a place; the place is the data.
 */
import { fixEpisodes, type FixEpisode, type FixItemWithHistory } from "../control-plane/fix-history.ts";
import { fixItems } from "../control-plane/fix-list.ts";
import { newFieldManualEntry, writeFieldManual, type FieldManualEntry, type FieldManualRepos } from "../control-plane/field-manual.ts";
import { ADMIN_CONFIG_ID, isAdminConfig } from "../control-plane/gateway/admin-config.ts";
import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";

export const BREAK_PATTERN_SOURCE = "break-patterns";
export const BREAK_PATTERN_KIND = "BREAK_PATTERN";
/** A break this many days or fewer after an event counts as "right after" it. */
export const DAYS_AFTER_EVENT = 7;

/** A dated event a break may follow, e.g. a fiscal-year start or an election. Data, never code. */
export interface KnownEvent {
  readonly name: string;
  readonly at: string;
}

export interface BreakPattern {
  readonly where: string;
  readonly kind: "SAME_MONTH" | "AFTER_EVENT";
  /** The month name, or the event's name. */
  readonly when: string;
  /** When each break in the pattern happened. */
  readonly breaks: readonly string[];
  /** What fixed it most recently, when a fix is recorded. */
  readonly lastFix: string | null;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthOf = (iso: string): number => Number(new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", month: "numeric" })) - 1;
const yearOf = (iso: string): number => Number(new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", year: "numeric" }));

function lastFixOf(episodes: readonly FixEpisode[]): string | null {
  return [...episodes].reverse().find((e) => e.fixedAt !== null && e.whatChanged)?.whatChanged ?? null;
}

/** The patterns in one door's or method's breaks. */
export function patternsOf(where: string, episodes: readonly FixEpisode[], events: readonly KnownEvent[] = []): BreakPattern[] {
  const breaks = episodes.map((e) => e.brokeAt).filter((at) => Number.isFinite(Date.parse(at)));
  const lastFix = lastFixOf(episodes);
  const out: BreakPattern[] = [];
  const byMonth = new Map<number, string[]>();
  for (const at of breaks) byMonth.set(monthOf(at), [...(byMonth.get(monthOf(at)) ?? []), at]);
  for (const [month, ats] of [...byMonth].sort((a, b) => a[0] - b[0])) {
    if (new Set(ats.map(yearOf)).size >= 2) out.push({ where, kind: "SAME_MONTH", when: MONTHS[month], breaks: [...ats].sort(), lastFix });
  }
  const byEvent = new Map<string, string[]>();
  for (const event of events) {
    const start = Date.parse(event.at);
    if (!Number.isFinite(start)) continue;
    const after = breaks.filter((at) => Date.parse(at) >= start && Date.parse(at) - start <= DAYS_AFTER_EVENT * 86_400_000);
    if (after.length > 0) byEvent.set(event.name, [...(byEvent.get(event.name) ?? []), ...after]);
  }
  for (const [name, ats] of byEvent) {
    const distinct = [...new Set(ats)].sort();
    if (distinct.length >= 2) out.push({ where, kind: "AFTER_EVENT", when: name, breaks: distinct, lastFix });
  }
  return out;
}

/** Every pattern across the fix list. Items are grouped by where they are (a door or a method in a place). */
export function breakPatterns(items: readonly FixItemWithHistory[], now: string, events: readonly KnownEvent[] = []): BreakPattern[] {
  const byWhere = new Map<string, FixEpisode[]>();
  for (const item of items) byWhere.set(item.where, [...(byWhere.get(item.where) ?? []), ...fixEpisodes(item, now)]);
  return [...byWhere].flatMap(([where, episodes]) => patternsOf(where, [...episodes].sort((a, b) => a.brokeAt.localeCompare(b.brokeAt)), events));
}

/** The lesson a pattern writes: one plain line a detective reads first. */
export function patternLesson(p: BreakPattern, now: string): FieldManualEntry {
  const years = [...new Set(p.breaks.map(yearOf))].join(" and ");
  const summary = p.kind === "SAME_MONTH"
    ? `${p.where} has broken in ${p.when} in ${years}. Have the last fix ready before ${p.when}${p.lastFix ? `: ${p.lastFix.replace(/\.$/, "")}` : ""}.`
    : `${p.where} has broken within ${DAYS_AFTER_EVENT} days after ${p.when} ${p.breaks.length} times. Have the last fix ready${p.lastFix ? `: ${p.lastFix.replace(/\.$/, "")}` : ""}.`;
  return newFieldManualEntry(BREAK_PATTERN_SOURCE, `${p.where}|${p.kind}|${p.when}`, {
    role: "DETECTIVE",
    kind: BREAK_PATTERN_KIND,
    title: `When ${p.where} breaks`,
    summary: summary.replace(/\s+/g, " "),
    outcome: "REFERENCE",
    observedAt: now,
    payload: p,
  });
}

/**
 * The pass: read the fix list, find the patterns, write one lesson each. A
 * lesson rewrites itself (same id) as more breaks are seen. A write failure is
 * returned, never thrown.
 */
export async function runBreakPatternPass(repos: Pick<ControlPlaneRepositories, "adminConfig"> & FieldManualRepos, now: string,
  events: readonly KnownEvent[] = []): Promise<{ readonly patterns: number; readonly written: number; readonly error?: string }> {
  const held = await repos.adminConfig.read(ADMIN_CONFIG_ID);
  const items = held && isAdminConfig(held.value) ? fixItems(held.value) : [];
  const patterns = breakPatterns(items, now, events);
  if (patterns.length === 0) return { patterns: 0, written: 0 };
  const wrote = await writeFieldManual(repos, patterns.map((p) => patternLesson(p, now)), now);
  return { patterns: patterns.length, ...wrote };
}
