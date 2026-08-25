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

/**
 * **RULE 2 — THE HONEST DISCLOSURE, AT THE BOX.**
 *
 * The author's instruction: *one line, plain language: what's written may be
 * shared — without a name, because we don't hold one — with campaigns,
 * organizations, and researchers working to understand what people want. The
 * honest version is the credible version.*
 *
 * Three things this says, and every one of them is load-bearing:
 *
 *  1. **MAY be shared.** Not will. The store exists and nothing is sold from
 *     it yet, and a stated commitment that is not honoured on every instance is
 *     worse than a reserved right — the same reasoning `CLAUDE.md` gives for
 *     the free-text threat notice saying "may" rather than "will".
 *  2. **Without a name, because we don't hold one.** The reason is inside the
 *     sentence. "Anonymously" is a promise a reader has to take on trust; "we
 *     don't hold one" is a fact about the schema they can check on the
 *     transparency page, and it is the one this store is built to be able to
 *     say (see `speak_your_mind` in `lib/db/schema.ts`).
 *  3. **Who it may go to, named.** Campaigns, organizations and researchers.
 *     Not "our partners", not "third parties" — the buyer classes, said out
 *     loud, at the moment of typing. This is the disclosure-at-the-point-of-
 *     capture rule applied to a new instrument.
 *
 * Level register: this is a CLAIM surface. It is plain, neutral, and it is not
 * cute about what happens to what somebody writes.
 *
 * **Marked for the author's review as COPY** — a P3 tracker row — and shipping
 * as drafted meanwhile, exactly as the brief directs.
 */
export const SPEAK_DISCLOSURE =
  "What you write may be shared — without a name, because we don't hold one — with campaigns, organizations, and researchers working to understand what people want.";

/**
 * **THE FINE PRINT (BC-19, 2026-08-25).**
 *
 * The author moved `SPEAK_DISCLOSURE` out of the panel and said the no-name
 * commitment is "stated in fine print and the transparency page". This is the
 * fine print, and it is deliberately the shortest true sentence that carries
 * the two facts a reader needs before typing: that this MAY be shared, and
 * that it goes without a name because there is nowhere to keep one.
 *
 * `SPEAK_DISCLOSURE` is kept in this file rather than deleted. It is the full
 * sentence, it is what /transparency says at length, and a later ruling can
 * put it back at the box without anyone having to rewrite it from memory.
 */
export const SPEAK_FINE_PRINT =
  "May be shared without a name — this store has no column for one.";

/**
 * The threat notice `CLAUDE.md` requires beside any free-text input about
 * named real people. Wording is "may", never "will", for the reason the rule
 * itself gives.
 */
export const SPEAK_THREAT_NOTICE =
  "Threats of violence are removed and may be reported to law enforcement.";

/** After a submission. Acknowledgment only — it never renders anything back. */
export const SPEAK_CONFIRMATION = "Got it — that's recorded.";
