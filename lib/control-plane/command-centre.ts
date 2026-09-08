/**
 * **THE EIGHT QUESTIONS `/admin` HAS TO ANSWER WITHOUT LEAVING THE PAGE.**
 * (ADM-C1 acceptance, Admin Pass C.)
 *
 * The brief's acceptance clause is a list of questions, not a list of panels:
 *
 * ```
 *   What code is live?                      What is blocked?
 *   What code is staging?                   What should I act on next?
 *   What is waiting for my review?          What did the system most recently do?
 *   Is the Fleet alive?   Is promotion on?
 * ```
 *
 * So this module is the projection that answers them, and the strip at the top
 * of the console renders it. Everything it reports is either a fact some other
 * surface already owns — the release review's SHA identity, the Steward's queue,
 * the runner's heartbeat, the receipt log — or a NAMED GAP saying which surface
 * would carry it and has not been read.
 *
 * ## Why a gap and not a blank
 *
 * §15: a green status must have a provenance, unknown stays unknown, and no
 * data is never rendered as zero success. A command centre that showed "0
 * blockers" because it could not read the blocker list would be the most
 * dangerous line on the whole console.
 *
 * PURE. Already-read values in, answers out. No store, no clock, no environment.
 */
import type { HealthLevel } from "./owner-surface.ts";

/** One answer: what it is, what it says, whether it needs the owner, where to look. */
export interface Answer {
  /** The question, in the owner's words. */
  readonly question: string;
  /** The answer, in one short phrase. Null when it could not be read. */
  readonly says: string | null;
  /** What the console could not read, when it could not. Never rendered as a zero. */
  readonly gap: string | null;
  readonly level: HealthLevel;
  /** True when this answer is the reason the owner should do something. */
  readonly needsYou: boolean;
  /** The action, when it needs him. */
  readonly action: string | null;
  /** The console path that carries the whole story. */
  readonly where: string | null;
  /** The exact identity behind the phrase, for the hover: a SHA, a receipt id. */
  readonly exact: string | null;
}

export interface CommandCentreInput {
  /** The runner's own reading, from `runnerStanding`. */
  readonly runner: { readonly state: string; readonly level: HealthLevel; readonly needsYou: boolean; readonly action: string | null };
  /** Raw main, the executable head and the runner's tested SHA, from the heartbeat's code identity. */
  readonly code: { readonly rawMain: string | null; readonly executable: string | null; readonly verdict: string | null } | null;
  /** The SHA production is actually serving, when a surface knows it. */
  readonly production: { readonly sha: string | null; readonly at: string | null } | null;
  /** The accepted staging SHA and its review state, from the release-review surface. */
  readonly staging: { readonly sha: string | null; readonly reviewState: string | null; readonly decision: string | null } | null;
  /** The Steward's queue depth and current item. */
  readonly steward: { readonly depth: number; readonly current: string | null; readonly paused: boolean } | null;
  /**
   * Promotion to readers — TRUE, FALSE, or **NULL for "this page has not read
   * it"**. (ADM-64 / ADM-70, the 9.7.26 feedback.)
   *
   * This was a `boolean` documented as "a law, not a reading: it is OFF unless
   * a governed activation turned it on", and the home page hard-coded `false`
   * on the strength of that law. The law was real and it governed the LEGACY
   * nightly-window pipeline through `ACTIVATION_GATE.promotionEnabled`.
   *
   * The routine civic data plane that landed in PR #301 does not import that
   * gate. It promotes through the production data plane from the standing
   * runner, and reader surfaces consume the promoted projection. So the console
   * was answering "Is anything being published to readers?" with a confident
   * **"No"**, in GREEN, about a pipeline that is no longer the only one — and a
   * false statement about the product is the one failure this whole surface
   * exists to prevent.
   *
   * A boolean cannot express "nobody asked", which is why it has to become
   * three-state rather than flip. Asserting YES without reading the plane would
   * be the same error pointing the other way.
   */
  readonly promotionOn: boolean | null;
  readonly openRecordClasses: number | null;
  /** How many decisions are waiting on the owner. */
  readonly decisionsWaiting: number;
  /** Incidents that have been stuck long enough to need a human. */
  readonly stuckIncidents: number;
  /** The newest durable receipt the console wrote, if the log could be read. */
  readonly latestReceipt: { readonly says: string; readonly at: string; readonly id: string } | null;
  readonly receiptGap: string | null;
}

const NO = (question: string, gap: string, where: string | null): Answer => ({
  question,
  says: null,
  gap,
  level: "UNKNOWN",
  needsYou: false,
  action: null,
  where,
  exact: null,
});

/** A short SHA for the face, with the whole thing on the hover. */
export function shortSha(sha: string | null | undefined): string | null {
  const raw = (sha ?? "").trim();
  return raw === "" ? null : raw.slice(0, 8);
}

export function commandCentre(input: CommandCentreInput): readonly Answer[] {
  const answers: Answer[] = [];

  answers.push(
    input.production && input.production.sha
      ? {
          question: "What code is live?",
          says: `Commit ${shortSha(input.production.sha)}`,
          gap: null,
          level: "GREEN",
          needsYou: false,
          action: null,
          where: "/admin/steward",
          exact: input.production.sha,
        }
      : NO(
          "What code is live?",
          "No surface on this console has read what production is serving, so it is not saying. The shipping page is where that reading would land.",
          "/admin/steward",
        ),
  );

  answers.push(
    input.staging && input.staging.sha
      ? {
          question: "What code is staging?",
          says: `Commit ${shortSha(input.staging.sha)}`,
          gap: null,
          level: "GREEN",
          needsYou: false,
          action: null,
          where: "/admin/release-review",
          exact: input.staging.sha,
        }
      : NO("What code is staging?", "No accepted staging build has been read for this console.", "/admin/release-review"),
  );

  answers.push(
    input.staging && input.staging.reviewState
      ? {
          question: "What is waiting for my review?",
          says: input.staging.decision ? `You already chose: ${input.staging.decision}` : "A staging build is ready for you to look at",
          gap: null,
          level: input.staging.decision ? "GREEN" : "AMBER",
          needsYou: !input.staging.decision,
          action: input.staging.decision ? null : "review the staging build and record your decision",
          where: "/admin/release-review",
          exact: input.staging.sha,
        }
      : NO("What is waiting for my review?", "The release-review surface was not read for this console.", "/admin/release-review"),
  );

  answers.push({
    question: "Is the fleet alive?",
    says: input.runner.state,
    gap: null,
    level: input.runner.level,
    needsYou: input.runner.needsYou,
    action: input.runner.action,
    where: "#runner",
    exact: input.code?.executable ?? null,
  });

  answers.push({
    /*
     * NOT a reading. Promotion is OFF by law until a governed activation
     * session turns it on, and this line states the law and the count of open
     * record classes beside it so the owner can see both.
     */
    question: "Is anything being published to readers?",
    says:
      input.promotionOn === null
        ? null
        : input.promotionOn
          ? "Yes — promotion to readers is ON"
          : `No. Promotion to readers is off${input.openRecordClasses === null ? "" : `, and ${input.openRecordClasses} record class${input.openRecordClasses === 1 ? " is" : "es are"} open`}.`,
    /*
     * The gap names WHICH pipeline the old answer was about, because "off" was
     * not a lie about the legacy one — it was a true statement that stopped
     * being the whole answer when a second promotion path shipped.
     */
    gap:
      input.promotionOn === null
        ? "This page has not read the promotion state. There are two paths — the legacy nightly window, which is off by law until a governed activation turns it on, and the routine civic data plane, which promotes from the standing runner. Answering for one of them would be answering the wrong question."
        : null,
    level: input.promotionOn === null ? "UNKNOWN" : input.promotionOn ? "AMBER" : "GREEN",
    needsYou: false,
    action: null,
    where: "/admin/research",
    exact: null,
  });

  const blocked = input.decisionsWaiting + input.stuckIncidents;
  answers.push({
    question: "What is blocked?",
    says:
      blocked === 0
        ? "Nothing is waiting on you"
        : `${input.decisionsWaiting} decision${input.decisionsWaiting === 1 ? "" : "s"} and ${input.stuckIncidents} stuck source${input.stuckIncidents === 1 ? "" : "s"}`,
    gap: null,
    level: blocked === 0 ? "GREEN" : "AMBER",
    needsYou: blocked > 0,
    action: blocked > 0 ? "open the decision list, and the stuck sources under Why some of it is held up" : null,
    /*
     * `#blocked`, and it is a real element (9.6.26 owner feedback, ACLOSE-6).
     *
     * This said `#decisions` and nothing in the whole application carried that
     * id, so Open and the banner's "Take me there" both did exactly nothing —
     * the browser has no indicated part to scroll to and stays where it is. A
     * control that looks actionable and is not is worse than no control.
     *
     * The destination is ONE region holding BOTH halves of what this card
     * counts, because the card counts both: `page.tsx` wraps "Why some of it is
     * held up" and the decision queue in `<RevealTarget id="blocked">`, which
     * scrolls to itself, takes focus, and opens what is collapsed inside it.
     */
    where: "#blocked",
    exact: null,
  });

  answers.push(
    input.steward
      ? {
          question: "What is shipping?",
          says: input.steward.paused
            ? "The shipping queue is paused"
            : input.steward.depth === 0
              ? "Nothing is in the shipping queue"
              : `${input.steward.depth} in the queue${input.steward.current ? `; working on ${input.steward.current}` : ""}`,
          gap: null,
          level: input.steward.paused ? "AMBER" : "GREEN",
          needsYou: input.steward.paused,
          action: input.steward.paused ? "the shipping queue is paused and will not move until it is resumed" : null,
          where: "/admin/steward",
          exact: null,
        }
      : NO("What is shipping?", "The shipping queue was not read for this console.", "/admin/steward"),
  );

  answers.push(
    input.latestReceipt
      ? {
          question: "What did the system most recently do?",
          says: input.latestReceipt.says,
          gap: null,
          level: "GREEN",
          needsYou: false,
          action: null,
          // `#decided` is the section that actually carries the receipts
          // (`DecidedSection`, id="decided"). `#receipts` was carried here and
          // in the gap branch below, and no element anywhere had that id.
          where: "#decided",
          exact: input.latestReceipt.id,
        }
      : NO(
          "What did the system most recently do?",
          input.receiptGap ?? "No console action has been recorded yet, so there is no receipt to show.",
          "#decided",
        ),
  );

  return answers;
}

/**
 * The single most important thing to do next, or null when nothing needs him.
 *
 * The brief's last acceptance question — *"What should I act on next?"* — is not
 * a ninth card. It is the one line above the strip, and it is chosen rather than
 * listed: a command centre that answers "act on next" with eight things has
 * answered a different question.
 */
export function actNext(answers: readonly Answer[]): Answer | null {
  const needing = answers.filter((a) => a.needsYou);
  if (needing.length === 0) return null;
  const red = needing.find((a) => a.level === "RED");
  return red ?? needing[0];
}
