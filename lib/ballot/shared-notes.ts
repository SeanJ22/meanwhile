export interface SharedNote {
  marker: string;
  text: string;
  count: number;
}

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
