/**
 * **BC-11 — every word this surface says, in one file.**
 *
 * The same reason `lib/routing/ask-beat-pool.ts` and `lib/ballot/could-govern.ts`
 * hold theirs: copy assembled at the component is copy that gets assembled
 * differently at the second component, and this surface is going on every
 * battlecard and every large meeting card in the product.
 */

/** The pill. The author's label, verbatim. Playful register — it is an ask. */
export const SPEAK_LABEL = "Speak Your Mind";

/**
 * What KIND of thing is being spoken to. A person can stand in front of you;
 * a school district cannot.
 */
export type SpeakSubjectKind = "person" | "body";

/**
 * The framing, above the box. The author's own words for what the box is:
 * *what you'd say if this person were standing in front of you.*
 *
 * **BC-18 (2026-08-25) — THE STRING BRANCHES ON WHAT THE SUBJECT IS.**
 *
 * Substituting the subject into one sentence was already better than saying
 * "this person" about a board, and it was not enough: the author read
 * *"What would you say if Tucson Unified District were standing in front of
 * you?"* off `09-04-04` and his note is the whole argument — **a district
 * can't stand anywhere.**
 *
 * The PERSON version is correct as written and is untouched. The body version
 * keeps what makes the framing work — say it to them, directly, in their own
 * room — in a form that is true of a body: **having the floor** is the civic
 * equivalent of standing in front of somebody, and it is true of every body
 * this product carries, because every one of them meets in public.
 *
 * The kind is a REQUIRED argument rather than an optional one with a default.
 * A default would be the person version, so every new body surface would ship
 * the defect silently and correctly-typed — which is how this one shipped.
 */
export function speakFraming(subject: string, kind: SpeakSubjectKind): string {
  return kind === "person"
    ? `What would you say if ${subject} were standing in front of you?`
    : `What would you say to ${subject} if you had the floor?`;
}

/** The input's placeholder. Clears on type — it is a prompt, not a value. */
export const SPEAK_PLACEHOLDER = "What would you want to say?";

/** After a submission. Acknowledgment only — it never renders anything back. */
export const SPEAK_CONFIRMATION = "Got it — that's recorded.";
