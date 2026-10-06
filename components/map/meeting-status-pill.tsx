import {
  STATUS_MARK,
  STATUS_QUALIFIER,
  STATUS_WORD,
  type MeetingPillStatus,
} from "@/lib/meetings/status-marks";

/**
 * **ONE PILL, EVERYWHERE A SITTING'S STATE IS MARKED.** (MTG-14, 2026-08-28.)
 *
 * The vocabulary — which mark, which word, which spoken qualifier, and the
 * reasoning behind all three — lives in `lib/meetings/status-marks.ts`. This is
 * only the markup, and it is small on purpose: three call sites rendered the
 * same `<span className="meeting-status-pill">` by hand, which is how one of
 * them came to carry a comment describing a treatment the stylesheet does not
 * apply.
 *
 * ## The accessibility shape is the one this repo already uses
 *
 * `components/map/meeting-panel.tsx` renders its status dot as
 * `<span aria-hidden="true">` and prints "Concluded" in the `<dd>` beneath;
 * `lib/map/marker-pool.ts` insists a pin is "a real `<button>` with an
 * `aria-label`, never a div". **Icon decorative, word carrying the meaning** —
 * and the spoken qualifier after it, because "Online only" beside a time is
 * ambiguous out loud and this is the one surface that says there is nowhere to
 * go.
 *
 * Geometry stays entirely in `.meeting-status-pill` so `BAL-12`'s census keeps
 * measuring the thing that ships; the mark's spacing is a utility class and
 * touches no rule that census reads.
 */
export function MeetingStatusPill({ status }: { status: MeetingPillStatus }) {
  return (
    <span className="meeting-status-pill" data-status={status}>
      <span aria-hidden="true" className="mr-1 inline-block">
        {STATUS_MARK[status]}
      </span>
      {STATUS_WORD[status]}
      <span className="sr-only">{STATUS_QUALIFIER[status]}</span>
    </span>
  );
}
