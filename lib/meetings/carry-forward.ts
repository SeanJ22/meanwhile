import { CONCLUDED_LOOKBACK_DAYS, UPCOMING_HORIZON_DAYS } from "./constants.ts";
import type { MeetingsSnapshot } from "./snapshot.ts";
import type { Meeting } from "../sources/types.ts";

/**
 * The refresh corollary: **a failed fetch never silently empties a
 * previously-full calendar.** (g3, 2026-08-16.)
 *
 * ## What happened
 *
 * The truth session verified fifteen Kearsarge Regional School Board sittings
 * live at 03255 — four bodies, twenty-six meetings. The next scheduled
 * refresh got HTTP 403 from `kearsarge.org`, recorded `schedulepage: FAILED`,
 * and committed a snapshot in which every one of that source's meetings was
 * gone. Production dropped to one body and seven meetings, and stayed there.
 * The reader was shown an empty calendar for a school board that sits fifteen
 * times a year, with a footnote underneath it.
 *
 * `CLAUDE.md`'s render-default rule forbids a component turning absence into
 * an assertion. This is that rule one layer down, at the pipeline: a
 * RETRIEVAL failure may not be written into the data as an absence either.
 * By the time a null reaches a component, the lie is already in the file.
 *
 * ## What it does, and what it refuses to do
 *
 * Meetings the previous snapshot held for a source that failed this run — or
 * for a division a partially-refused source could not reach — are carried
 * forward, clipped to the same serving window a fresh normalize applies. They
 * keep their ORIGINAL `provenance.collectedAt`, so no carried row claims to
 * have been checked today; the card's provenance line says when we last
 * actually saw it, and the snapshot's own `carriedForward` count says how
 * many rows are in that state.
 *
 * It carries only what a working run WOULD have produced:
 *
 * - **A fresh row always wins.** A carried row is only ever a row the current
 *   run does not have.
 * - **The window still applies — the SOURCE's window** (g13, 2026-08-18). A
 *   sitting a healthy run would not have produced is not resurrected because
 *   its source went dark; that would be a refresh inventing history. Which
 *   sittings those are is decided by the failed source's own declared
 *   `publishedLookbackDays`, not by one global constant — see `backEdgeFor`
 *   below for the Merrimack County miss that proved the difference.
 * - **Nothing is carried for a source that succeeded and reported no
 *   refusal.** A body that genuinely stopped publishing must be allowed to
 *   go quiet — the honest empty calendar is a real answer, and pinning stale
 *   sittings over it would be the mirror-image lie.
 *
 * ## What hotfix-0817 added, 2026-08-17: the row says so itself
 *
 * The original shipped the COUNT and not the MARK. Carried rows went into the
 * same array as fresh ones with no field distinguishing them, so the per-source
 * `carriedForward` number could not be reconciled against the rows it claimed
 * to count, and every freshness statement a reader sees — all of them derived
 * from the snapshot's `generatedAt` — spoke for rows the run had never
 * reached. Each carried row now carries `carried: { source, lastFreshAt }`,
 * stamped here at write time, and an existing mark is preserved rather than
 * restamped: a row carried through three failed runs still names the run that
 * actually fetched it.
 */
export interface CarryForwardChild {
  source: string;
  ok: boolean;
  /** Divisions this source could not reach while otherwise succeeding. */
  unreachableOcdIds?: string[];
  /**
   * The source's own `MeetingSource.publishedLookbackDays` (g13, 2026-08-18).
   * `null` means the publisher's whole listed archive; omitted means the
   * serving window. See the g13 note below.
   */
  publishedLookbackDays?: number | null;
}

export interface CarryForwardResult {
  meetings: Meeting[];
  /** Per source, how many rows came from the previous snapshot. */
  carried: Map<string, number>;
}

/**
 * Stamp a row as carried, without ever overwriting an older true stamp.
 *
 * `lastFreshAt` is the row's own `provenance.collectedAt` — the instant the
 * adapter actually read the page. A row already carrying a mark keeps it: the
 * second failed run did not make the row any fresher, and restamping it would
 * walk the timestamp forward one refusal at a time until a row nobody has
 * fetched in a week claimed to be hours old.
 */
function mark(meeting: Meeting, source: string, previousGeneratedAt: string): Meeting {
  if (meeting.carried) return meeting;
  const collected = meeting.provenance?.collectedAt;
  const lastFreshAt = Number.isFinite(Date.parse(collected ?? ""))
    ? (collected as string)
    : previousGeneratedAt;
  return { ...meeting, carried: { source, lastFreshAt } };
}

export function carryForward(
  children: CarryForwardChild[],
  fresh: Meeting[],
  previous: MeetingsSnapshot | null,
  now: Date,
): CarryForwardResult {
  const carried = new Map<string, number>();
  if (!previous) return { meetings: fresh, carried };

  const windowEnd = now.getTime() + UPCOMING_HORIZON_DAYS * 86_400_000;

  /**
   * The back edge, per source (g13, 2026-08-18).
   *
   * "The window still applies" is still the rule — a sitting that a healthy
   * run would NOT have produced is not resurrected because its source went
   * dark. What changed is whose window decides. It used to be
   * `CONCLUDED_LOOKBACK_DAYS` for everyone, which silently assumed every
   * adapter clips its retrieval to the serving window. Most do. Revize does
   * not: its M59 archive rung emits every dated document the notices page
   * lists, so on 2026-08-18 a 403 to the CI runner carried 8 of Merrimack
   * County's 14 archive sittings and dropped 6 — this module partially
   * committing the exact emptying it exists to prevent.
   *
   * `null` therefore means no back clip, and it is not a loosening: the
   * reader never sees past `CONCLUDED_LOOKBACK_DAYS` either way, because
   * `lib/meetings/query.ts` clips reads independently. All this decides is
   * whether the snapshot stays as whole as the last healthy run left it.
   */
  const backEdgeFor = (child: CarryForwardChild): number => {
    const declared = child.publishedLookbackDays;
    if (declared === null) return -Infinity;
    const days = declared ?? CONCLUDED_LOOKBACK_DAYS;
    return now.getTime() - days * 86_400_000;
  };

  const haveId = new Set(fresh.map((m) => m.id));
  const out = [...fresh];

  for (const child of children) {
    // A source that failed outright loses everything it serves; a source that
    // succeeded loses only the divisions it says it could not reach.
    const wholeSource = !child.ok;
    const divisions = new Set(child.unreachableOcdIds ?? []);
    if (!wholeSource && divisions.size === 0) continue;

    const windowStart = backEdgeFor(child);
    let count = 0;
    for (const meeting of previous.meetings) {
      if (meeting.id.split(":")[0] !== child.source) continue;
      if (!wholeSource && !(meeting.ocdId && divisions.has(meeting.ocdId))) continue;
      if (haveId.has(meeting.id)) continue;
      const at = Date.parse(meeting.startsAt);
      if (!Number.isFinite(at) || at < windowStart || at > windowEnd) continue;
      out.push(mark(meeting, child.source, previous.generatedAt));
      haveId.add(meeting.id);
      count += 1;
    }
    if (count > 0) carried.set(child.source, count);
  }

  return { meetings: out, carried };
}
