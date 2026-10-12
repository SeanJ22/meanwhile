/** Every word the Speak surface says, in one file. */

/** The pill. The author's label, verbatim. Playful register — it is an ask. */
export const SPEAK_LABEL = "Speak Your Mind";

/**
 * What KIND of thing is being spoken to. A person can stand in front of you;
 * a school district cannot.
 */
export type SpeakSubjectKind = "person" | "body";

/**
 * The framing above the box. It branches on what the subject is, because a
 * body cannot stand in front of anyone: a body is offered "if you had the
 * floor". The kind is required so a new body surface cannot default to the
 * person version.
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
