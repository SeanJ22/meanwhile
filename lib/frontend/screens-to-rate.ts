/**
 * **FE-24 — Sean rates a sample of real screens.**
 *
 * The look passes keep production screenshots. A regular random sample of them
 * is offered to Sean as "Screens to rate", each with like or dislike and an
 * optional note. A verdict is written in the feedback sweep record shape
 * (`lib/feedback/sweep.ts`) and added to the look standard's examples, so the
 * look reviewer reads a dislike as a bad example on its next run.
 *
 * Nothing here stores anything: the caller passes in what it read and writes
 * back what these functions return. Sean's ratings are his choice and block
 * nothing.
 */
import type { SweepRecord, SweptItem } from "../feedback/sweep.ts";

export interface RatableScreen {
  /** The screenshot's key in the image store. */
  key: string;
  /** A label a person would use, such as "ballot card, 390 wide". */
  label: string;
  surface: string;
  zip: string | null;
  device: "phone" | "desktop";
  /** When the look pass took it (ISO). */
  takenAt: string;
}

export interface ScreenRating {
  screenKey: string;
  verdict: "like" | "dislike";
  note: string | null;
  /** ISO time Sean tapped. */
  ratedAt: string;
}

/** Heading in `docs/look-standard.md` that holds Sean's rated screens. */
export const RATED_HEADING = "## Screens Sean rated";

/** A random sample of screens he has not rated yet. `random` is injectable for tests. */
export function sampleScreensToRate(
  screens: readonly RatableScreen[],
  ratings: readonly Pick<ScreenRating, "screenKey">[],
  count: number,
  random: () => number = Math.random,
): RatableScreen[] {
  const done = new Set(ratings.map((r) => r.screenKey));
  const pool = screens.filter((s) => !done.has(s.key));
  const n = Math.min(Math.max(0, Math.floor(count)), pool.length);
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(random() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n);
}

/** `M.D.YY`, the owner-folder name the sweep record uses. */
export function sweepFolder(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${m}.${d}.${String(y % 100).padStart(2, "0")}`;
}

/**
 * One rating as a sweep item. A dislike is open work, so it needs the fix-list
 * item the caller opened for it; a like is kept so a later change cannot break it.
 */
export function ratingToSweptItem(screen: RatableScreen, rating: ScreenRating, workItemId: string | null): SweptItem {
  const dislike = rating.verdict === "dislike";
  if (dislike && !workItemId) throw new Error("a disliked screen needs the fix-list item opened for it");
  const note = rating.note?.trim() || null;
  return {
    id: `screen-${rating.ratedAt.slice(0, 10)}-${screen.key.replace(/[^a-zA-Z0-9]+/g, "-")}`,
    sources: ["SCREENSHOT"],
    screenshots: [screen.key],
    surface: screen.surface,
    zip: screen.zip,
    reported: dislike ? (note ?? `Sean disliked ${screen.label}.`) : (note ?? `Sean liked ${screen.label}.`),
    correctState: null,
    failureClass: "look",
    disposition: dislike ? "OPEN_BLOCKED" : "POSITIVE_KEPT",
    workItemId: dislike ? workItemId : null,
    instancesFound: dislike ? 1 : 0,
    instancesFixed: 0,
    checkId: null,
    checkResult: null,
    blocker: dislike ? "Sean marked this screen as one he dislikes. The look reviewer cites it until the screen is fixed." : null,
    needsOwner: null,
  };
}

/** The sweep record with the item added (an item with the same id is replaced). */
export function addToSweep(sweep: SweepRecord | null, item: SweptItem, now: string, sha: string | null = null): SweepRecord {
  const base: SweepRecord = sweep ?? { folder: sweepFolder(now), filesInventoried: [], sweptAtSha: sha, sweptAt: now, items: [] };
  const files = new Set(base.filesInventoried);
  for (const f of item.screenshots) files.add(f);
  return { ...base, filesInventoried: [...files], sweptAt: now, items: [...base.items.filter((i) => i.id !== item.id), item] };
}

function exampleLine(screen: RatableScreen, rating: ScreenRating): string {
  const kind = rating.verdict === "dislike" ? "Bad live example" : "Good live example";
  const note = rating.note?.trim();
  return `${kind} (Sean, ${rating.ratedAt.slice(0, 10)}): ${screen.label} [${screen.key}]${note ? ` — ${note}` : ""}`;
}

/** The look standard with this rating added under its rated-screens heading. Once per screen. */
export function addExampleToStandard(standard: string, screen: RatableScreen, rating: ScreenRating): string {
  const without = standard.split("\n").filter((l) => !(l.includes(`[${screen.key}]`) && /^(Bad|Good) live example \(Sean,/.test(l))).join("\n");
  const line = exampleLine(screen, rating);
  if (!without.includes(RATED_HEADING)) return `${without.replace(/\n*$/, "\n")}\n${RATED_HEADING}\n\n${line}\n`;
  const at = without.indexOf(RATED_HEADING);
  const next = without.indexOf("\n## ", at + RATED_HEADING.length);
  const end = next === -1 ? without.length : next;
  return `${without.slice(0, end).replace(/\n*$/, "\n")}${line}\n${next === -1 ? "" : without.slice(end)}`;
}

/** The bad examples Sean has recorded, as the reviewer is told to cite them. */
export function badExamples(standard: string): string[] {
  return standard.split("\n").filter((l) => l.startsWith("Bad live example (Sean,"));
}
