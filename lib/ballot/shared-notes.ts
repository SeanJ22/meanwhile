/**
 * **A NOTE THAT IS THE SAME ON EVERY CONTEST IS A PAGE NOTE** — F01 11.1,
 * 2026-08-19.
 *
 * The author, on the Arizona statewide measures: *"there is a statement under
 * every single proposition that says 'The Secretary of State has not yet
 * published the final ballot wording...' It is under every single one of these
 * propositions. That is absolutely something that can and should be annotated.
 * It does not belong under every single proposition — that can be asterisked or
 * any other symbol and then put at the very bottom of the page."*
 *
 * Eleven measures, one identical paragraph, repeated eleven times. Repetition
 * that carries no new information is reader friction, and friction is a defect
 * with the standing of a wrong number (`CLAUDE.md`).
 *
 * ## Nothing is de-noted
 *
 * The note still renders, in full, verbatim, on the same page — once, at the
 * foot, with a marker on each contest it applies to. This is the same trade
 * the contest Sources section (formerly `components/ballot/filing-note.tsx`) makes for candidate-filing provenance
 * and `lib/meetings/list-attribution.ts` makes for meeting attribution. What
 * may collapse is the REPETITION, never the record.
 *
 * ## Only what actually repeats
 *
 * A note that appears on ONE contest stays where it is. Sending a
 * single-occurrence note to the bottom of the page would spend a marker and a
 * scroll to say the same thing in a worse place — it would be tidying for its
 * own sake rather than removing repetition. The threshold is literal: two or
 * more contests carrying byte-identical text.
 */

export interface SharedNote {
  /** The footnote symbol printed on every contest that shares this note. */
  marker: string;
  /** The note, verbatim. Never shortened, never paraphrased. */
  text: string;
  /** How many contests carry it — stated so a reader can see it is shared. */
  count: number;
}

/**
 * The SAME sequence the ballot page already uses for shared SOURCE lines
 * (item 5, the design pass), and for the same reason: two marker sequences on
 * one page would put a `*` beside a source note and a `*` beside a scope note
 * meaning two different things, which is worse than either note repeating.
 * Callers pass `startIndex` so the scope notes continue where the source notes
 * stopped rather than colliding with them.
 */
export const FOOTNOTE_MARKERS = ["*", "†", "‡", "§", "‖", "¶"] as const;

function markerFor(index: number): string {
  return FOOTNOTE_MARKERS[index] ?? `${index + 1}`;
}

export interface NotedContest {
  id: string;
  scopeNote: string | null;
}

/**
 * Split a page's scope notes into the ones that repeat and the ones that do not.
 *
 * `markerFor(contestId)` returns the footnote symbol for a contest whose note
 * moved to the page foot, and `""` for one whose note stays inline — so a
 * caller renders `note ?? marker` and cannot show both or neither.
 *
 * Order is FIRST APPEARANCE down the contest list, so a reader scrolling the
 * page meets `*` before `†`.
 */
export function sharedNotesFor(
  contests: readonly NotedContest[],
  startIndex = 0,
): {
  notes: SharedNote[];
  markerFor: (contestId: string) => string;
  /** True when this contest's note moved to the foot and must not render inline. */
  isShared: (contestId: string) => boolean;
} {
  const counts = new Map<string, number>();
  for (const contest of contests) {
    if (!contest.scopeNote) continue;
    counts.set(contest.scopeNote, (counts.get(contest.scopeNote) ?? 0) + 1);
  }

  const notes: SharedNote[] = [];
  const byText = new Map<string, SharedNote>();
  for (const contest of contests) {
    const text = contest.scopeNote;
    if (!text) continue;
    const count = counts.get(text)!;
    if (count < 2 || byText.has(text)) continue;
    const note: SharedNote = {
      marker: markerFor(startIndex + byText.size),
      text,
      count,
    };
    byText.set(text, note);
    notes.push(note);
  }

  const byContest = new Map<string, string>();
  for (const contest of contests) {
    if (!contest.scopeNote) continue;
    const note = byText.get(contest.scopeNote);
    if (note) byContest.set(contest.id, note.marker);
  }

  return {
    notes,
    markerFor: (contestId) => byContest.get(contestId) ?? "",
    isShared: (contestId) => byContest.has(contestId),
  };
}
