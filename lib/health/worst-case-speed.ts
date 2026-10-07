/**
 * Worst-case speed on production, phone (390 by 844) and desktop: the worst
 * run, never the median, against a three-second budget; a run that never
 * finished fails. Every resident-task surface and Ask question is measured at
 * ZIPs sampled from the published places. Pure: targets, ZIP sample and
 * verdict; `scripts/worst-case-speed-pass.mts` takes the runs.
 */

export const SPEED_BUDGET_MS = 3000;

export const SPEED_PROFILES = {
  phone: { width: 390, height: 844 },
  desktop: { width: 1280, height: 800 },
} as const;
export type SpeedProfile = keyof typeof SPEED_PROFILES;

/** A surface from the resident-task set; "ask" is measured once per Ask question. */
export type SpeedSurface = string;

export interface SpeedTarget {
  readonly surface: SpeedSurface;
  readonly zip: string;
  readonly profile: SpeedProfile;
  /** For Ask: the question typed. */
  readonly question?: string;
}

export interface SpeedRun extends SpeedTarget {
  /** Milliseconds until the surface was usable; null when it never was. */
  readonly ms: number | null;
  /** Why a run did not finish, in plain words. */
  readonly note?: string;
}

export interface SpeedRow extends SpeedTarget {
  readonly runs: number;
  readonly unfinished: number;
  /** The slowest finished run; null when none finished. */
  readonly worstMs: number | null;
  readonly verdict: "PASS" | "FAIL";
  readonly says: string;
}

export interface SpeedPass {
  readonly at: string;
  readonly budgetMs: number;
  readonly zips: readonly string[];
  readonly rows: readonly SpeedRow[];
  readonly passed: number;
  readonly failed: number;
}

export interface ResidentTaskSet {
  readonly surfaces: readonly string[];
  readonly tasks: readonly { readonly start: string; readonly question?: string }[];
}

/** Every surface and every Ask question, at every ZIP, on both profiles. */
export function speedTargets(tasks: ResidentTaskSet, zips: readonly string[]): SpeedTarget[] {
  const questions = [...new Set(tasks.tasks.flatMap((t) => (t.start === "ask" && t.question ? [t.question] : [])))];
  const per: { surface: string; question?: string }[] = [
    ...tasks.surfaces.filter((s) => s !== "ask").map((surface) => ({ surface })),
    ...questions.map((question) => ({ surface: "ask", question })),
  ];
  return zips.flatMap((zip) => (Object.keys(SPEED_PROFILES) as SpeedProfile[]).flatMap((profile) =>
    per.map((p) => ({ ...p, zip, profile }))));
}

/** A small, rotating sample of the published ZIPs: a different slice each day, so every place is reached over time. */
export function sampleZips(zips: readonly string[], count: number, now: string): string[] {
  const all = [...new Set(zips)].sort();
  if (all.length <= count) return all;
  const day = Math.floor(Date.parse(now) / 86_400_000);
  const stride = Math.max(1, Math.floor(all.length / count));
  const start = (day * 7919) % all.length;
  const out: string[] = [];
  for (let i = 0; out.length < count && i < all.length * 2; i += 1) {
    const zip = all[(start + i * stride) % all.length];
    if (!out.includes(zip)) out.push(zip);
  }
  return out;
}

const key = (t: SpeedTarget) => `${t.surface}\u0000${t.question ?? ""}\u0000${t.zip}\u0000${t.profile}`;
const secs = (ms: number) => `${(ms / 1000).toFixed(1)} seconds`;

export function surfaceWords(t: Pick<SpeedTarget, "surface" | "question">): string {
  return t.surface === "ask" && t.question ? `Ask "${t.question}"` : t.surface === "home" ? "The home page" : `The ${t.surface} page`;
}

/** The verdict: the worst run against the budget; any unfinished run fails the row. */
export function judgeSpeed(runs: readonly SpeedRun[], at: string, budgetMs: number = SPEED_BUDGET_MS): SpeedPass {
  const groups = new Map<string, SpeedRun[]>();
  for (const run of runs) groups.set(key(run), [...(groups.get(key(run)) ?? []), run]);
  const rows: SpeedRow[] = [...groups.values()].map((group) => {
    const first = group[0];
    const finished = group.flatMap((r) => (r.ms === null ? [] : [r.ms]));
    const unfinished = group.length - finished.length;
    const worstMs = finished.length > 0 ? Math.max(...finished) : null;
    const verdict = unfinished === 0 && worstMs !== null && worstMs <= budgetMs ? "PASS" : "FAIL";
    const where = `${surfaceWords(first)} at ${first.zip} on a ${first.profile}`;
    const says = unfinished > 0
      ? `${where}: ${unfinished} of ${group.length} visit${group.length === 1 ? "" : "s"} never finished${group.find((r) => r.note)?.note ? ` (${group.find((r) => r.note)!.note})` : ""}.`
      : `${where}: slowest of ${group.length} visit${group.length === 1 ? "" : "s"} took ${secs(worstMs!)}${verdict === "PASS" ? "" : `, over the ${secs(budgetMs)} limit`}.`;
    return { surface: first.surface, zip: first.zip, profile: first.profile, ...(first.question ? { question: first.question } : {}),
      runs: group.length, unfinished, worstMs, verdict, says };
  });
  return {
    at, budgetMs, zips: [...new Set(rows.map((r) => r.zip))].sort(), rows,
    passed: rows.filter((r) => r.verdict === "PASS").length, failed: rows.filter((r) => r.verdict === "FAIL").length,
  };
}
