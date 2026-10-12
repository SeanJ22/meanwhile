/**
 * The one sentence a stored ballot says about its own age, in a reader's words:
 * when the election authorities' filings were last read and whether a fresh
 * read is due, never how the copy is stored. Shared by every ballot source so
 * the wording cannot drift between them.
 */
export type BallotReadStateLike =
  | { readonly kind: "BOOTSTRAP" }
  | {
      readonly kind: "PROMOTED";
      readonly metadata: { readonly stale: string; readonly sourceThrough: string | null };
    }
  | { readonly kind: string };

/** " on August 14, 2026" for a usable timestamp, otherwise nothing. */
function readOn(sourceThrough: string | null): string {
  const at = sourceThrough ? new Date(sourceThrough) : null;
  if (!at || Number.isNaN(at.getTime())) return "";
  return ` on ${at.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })}`;
}

/** `subject` reads after "for": "this ballot", "the county ballot". */
export function ballotFreshnessNote(state: BallotReadStateLike, subject: string): string | null {
  if (state.kind === "BOOTSTRAP") {
    return `This is our first saved copy of ${subject} from the election authorities; a fresh read of their filings has not run yet.`;
  }
  if (state.kind !== "PROMOTED" || !("metadata" in state)) return null;
  if (state.metadata.stale === "STALE") {
    return `We last read the election authorities' filings for ${subject}${readOn(state.metadata.sourceThrough)}; a fresh read is due.`;
  }
  if (state.metadata.stale === "UNKNOWN") {
    return `We can't tell when the election authorities' filings for ${subject} were last read.`;
  }
  return null;
}
