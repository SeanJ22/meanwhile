/**
 * **AN ASK GAP'S OBLIGATION IDENTITY, AND WHAT ITS ROUNDS SAY.** (2026-09-25.)
 *
 * The `ask-gaps` provider (`scheduler/providers/ask-gaps.ts`) emits one
 * standing obligation per body and gap code, and Admin reads them back. Both
 * use this leaf, so the id, the route and the note grammar are written once:
 *
 * ```
 *   id        freshness:ask-gap:<body id>#<code>     (a body id may itself carry '#')
 *   route     <code>
 *   note      ROUTINE_READ rounds:  [CADENCE_BROKEN: <failure> ]<label>: CARRIED BY … NEXT READ: <when, by what>
 *             adapter-owed rounds:  <label>: NO CLIENT IN THIS PROCESS … NEXT MOVE: <the adapter owed>
 * ```
 *
 * PURE, and it imports only the code vocabulary, so Admin carries nothing of
 * the runner's.
 */
import { ASK_GAP_CODE_WORDS, isAskGapCode, type AskGapCode } from "../ask/gap-codes.ts";

export const ASK_GAPS_PROVIDER_ID = "ask-gaps";

/** Every id the provider owns starts with this. */
export const ASK_GAP_NAMESPACE = "freshness:ask-gap:";

/** The obligation record class; Admin titles it "Ask gap". */
export const ASK_GAP_OBLIGATION_CLASS = "ask-gap";

/** The durable obligation id for one body and code. The provider's `scheduledId`, as a function. */
export function askGapObligationId(bodyId: string, code: AskGapCode): string {
  return `${ASK_GAP_NAMESPACE}${bodyId}#${code}`;
}

/** The body and code an id names, or null for any other id. The code is after the LAST '#'. */
export function parseAskGapObligationId(id: string): { readonly bodyId: string; readonly code: AskGapCode } | null {
  if (!id.startsWith(ASK_GAP_NAMESPACE)) return null;
  const rest = id.slice(ASK_GAP_NAMESPACE.length);
  const hash = rest.lastIndexOf("#");
  if (hash <= 0) return null;
  const code = rest.slice(hash + 1);
  return isAskGapCode(code) ? { bodyId: rest.slice(0, hash), code } : null;
}

/** The note's markers, written by the route executor and the provider's route descriptors. */
export const CADENCE_BROKEN_MARK = "CADENCE_BROKEN: ";
export const NEXT_READ_MARK = "NEXT READ: ";
export const NEXT_MOVE_MARK = "NEXT MOVE: ";

/** What a round's note says about the gap's next step, by its markers. Null parts are absent from the note. */
export function askGapNoteParts(note: string): {
  readonly cadenceFailure: string | null;
  readonly nextRead: string | null;
  readonly nextMove: string | null;
} {
  const after = (mark: string): string | null => {
    const at = note.lastIndexOf(mark);
    return at < 0 ? null : note.slice(at + mark.length).trim() || null;
  };
  const broken = note.startsWith(CADENCE_BROKEN_MARK) ? note.slice(CADENCE_BROKEN_MARK.length) : null;
  // The failure is one sentence, and it ends before the route's label begins its own.
  const failure = broken === null ? null : (/^(.*?[.])(?:\s|$)/.exec(broken)?.[1] ?? broken).trim();
  return { cadenceFailure: failure, nextRead: after(NEXT_READ_MARK), nextMove: after(NEXT_MOVE_MARK) };
}

/** "Ask gap: Outcome not read" — the title's head. */
export function askGapTitle(code: AskGapCode): string {
  return `Ask gap: ${ASK_GAP_CODE_WORDS[code].toLowerCase()}`;
}
