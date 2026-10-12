import type { Contest } from "./types.ts";

export interface CertifiedContestScope {
  count: number;
  sourceUrl: string;
  sourceOrg: string;
  readAt: string;
}

export function readerContestScope(
  contest: Pick<Contest, "type" | "scopeNote" | "provenance">,
  options: { certified?: CertifiedContestScope | null; questionTextHeld?: boolean } = {},
) {
  const sourceScope = contest.scopeNote ? {
    text: contest.scopeNote,
    sourceUrl: contest.provenance.sourceUrl,
    sourceOrg: contest.provenance.sourceOrg,
    readAt: contest.provenance.collectedAt,
  } : null;
  if (contest.type === "CANDIDACY" && options.certified && options.certified.count > 0) {
    return { mode: "CERTIFIED_NOMINEES" as const, currentNote: null, sourceScope,
      qualification: { ...options.certified, text: "The current general-election nominees are recorded from the certified primary canvass." } };
  }
  if (contest.type === "MEASURE" && !options.questionTextHeld) {
    return { mode: "HELD_WORDING_GAP" as const,
      currentNote: "We have not recorded the final ballot wording for this measure. The title and any official analysis shown here are the records we hold.",
      sourceScope, qualification: null };
  }
  return { mode: "SOURCE_SCOPE" as const, currentNote: contest.scopeNote, sourceScope, qualification: null };
}
