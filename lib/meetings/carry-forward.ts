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
 * - **The window still applies.** A sitting that has aged out is not
 *   resurrected because its source went dark; that would be a refresh
 *   inventing history.
 * - **Nothing is carried for a source that succeeded and reported no
 *   refusal.** A body that genuinely stopped publishing must be allowed to
 *   go quiet — the honest empty calendar is a real answer, and pinning stale
 *   sittings over it would be the mirror-image lie.
 */
export interface CarryForwardChild {
  source: string;
  ok: boolean;
  /** Divisions this source could not reach while otherwise succeeding. */
  unreachableOcdIds?: string[];
}

export interface CarryForwardResult {
  meetings: Meeting[];
  /** Per source, how many rows came from the previous snapshot. */
  carried: Map<string, number>;
}

export function carryForward(
  children: CarryForwardChild[],
  fresh: Meeting[],
  previous: MeetingsSnapshot | null,
  now: Date,
): CarryForwardResult {
  const carried = new Map<string, number>();
  if (!previous) return { meetings: fresh, carried };

  const windowStart = now.getTime() - CONCLUDED_LOOKBACK_DAYS * 86_400_000;
  const windowEnd = now.getTime() + UPCOMING_HORIZON_DAYS * 86_400_000;

  const haveId = new Set(fresh.map((m) => m.id));
  const out = [...fresh];

  for (const child of children) {
    // A source that failed outright loses everything it serves; a source that
    // succeeded loses only the divisions it says it could not reach.
    const wholeSource = !child.ok;
    const divisions = new Set(child.unreachableOcdIds ?? []);
    if (!wholeSource && divisions.size === 0) continue;

    let count = 0;
    for (const meeting of previous.meetings) {
      if (meeting.id.split(":")[0] !== child.source) continue;
      if (!wholeSource && !(meeting.ocdId && divisions.has(meeting.ocdId))) continue;
      if (haveId.has(meeting.id)) continue;
      const at = Date.parse(meeting.startsAt);
      if (!Number.isFinite(at) || at < windowStart || at > windowEnd) continue;
      out.push(meeting);
      haveId.add(meeting.id);
      count += 1;
    }
    if (count > 0) carried.set(child.source, count);
  }

  return { meetings: out, carried };
}
