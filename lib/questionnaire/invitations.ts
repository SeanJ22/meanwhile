/**
 * **THE INVITATION RECORD — the thing that PROVES equal effort, so it renders.**
 * (Built 2026-08-23, the questionnaire-and-corpora brief, item 1.)
 *
 * ## The contest is the unit, and it is all-or-none
 *
 * **Every candidate in a contest is invited, or none of them is.** A contest
 * where the well-covered candidates were asked and the thin ones were not is
 * the equal-effort failure in its purest form: the instrument built to remove
 * the asymmetry would have created one. So `buildContestInvitations` refuses to
 * produce a partial contest — it returns the whole contest or it returns the
 * contest as UNINVITABLE with the candidates it could not reach named.
 *
 * ## Non-response is a neutral factual state and it is the same for everyone
 *
 * *Invited on this date, reminded on these dates, no response yet.* **Never
 * anything that reads as evasion, avoidance, refusal or declining to answer.**
 * A candidate has no obligation to answer us, and a product that made silence
 * look like a choice would be scoring them for it — which is the recommendation
 * this product does not make, delivered by implication.
 *
 * The invitation record is what proves equal effort actually happened, so it
 * **renders visibly and identically for every candidate in the contest**,
 * including the ones who answered. A reader can see that the person who
 * answered and the person who did not were asked the same thing on the same day.
 */

import type { OfficeClass } from "./instrument.ts";

export interface Invitation {
  candidacyId: string;
  contestId: string;
  /** Held for sending. **Never rendered** — a filed email is contact data. */
  email: string;
  /** Which instrument they are to be sent. */
  instrumentVersion: string;
  officeClass: OfficeClass;
  /**
   * **THE PLAN AND THE ACT ARE DIFFERENT FIELDS, and that is RULING 107 applied
   * to an outbound record rather than to a source read.**
   *
   * A generated invitation has not been sent. Stamping `invitedOn` at generation
   * time would put a date on an act nobody performed — the fabrication rule,
   * pointed outward — and the Positions empty state reads `invitedOn` to decide
   * whether to tell a reader we asked. So the schedule lives in the `planned…`
   * fields, and `invitedOn` and `remindedOn` stay empty until the code path that
   * actually sends stamps them.
   */
  plannedInvitedOn: string;
  plannedRemindersOn: readonly string[];
  /** Stamped by the send path only. `null` means not sent. */
  invitedOn: string | null;
  /** Stamped by the send path only. Empty means no reminder has gone out. */
  remindedOn: readonly string[];
  /** The stated deadline. Identical for every candidate in the contest. */
  deadline: string;
  /** Where the email came from, so the record can be checked. */
  contactSource: { sourceUrl: string; sourceOrg: string; collectedAt: string };
}

export interface UninvitableCandidate {
  candidacyId: string;
  contestId: string;
  /** Why we could not send. Today only one reason exists and it is stated. */
  reason: "NO_FILED_CONTACT";
}

export interface ContestInvitationResult {
  contestId: string;
  officeClass: OfficeClass;
  /** Non-empty only when EVERY candidate in the contest could be reached. */
  invitations: readonly Invitation[];
  /** Non-empty only when at least one could not — and then `invitations` is empty. */
  uninvitable: readonly UninvitableCandidate[];
}

export interface CandidateForInvitation {
  candidacyId: string;
  contestId: string;
  email: string | null;
  contactSource: Invitation["contactSource"] | null;
}

/**
 * Build one contest's invitations, all or none.
 *
 * The all-or-none rule is enforced HERE rather than by the caller remembering
 * it, because a caller that forgets produces exactly the asymmetric contest
 * this instrument exists to prevent, and nothing downstream would notice.
 */
export function buildContestInvitations(input: {
  contestId: string;
  officeClass: OfficeClass;
  instrumentVersion: string;
  plannedInvitedOn: string;
  plannedRemindersOn: readonly string[];
  deadline: string;
  candidates: readonly CandidateForInvitation[];
}): ContestInvitationResult {
  const unreachable = input.candidates.filter((c) => !c.email || !c.contactSource);

  if (unreachable.length > 0) {
    return {
      contestId: input.contestId,
      officeClass: input.officeClass,
      invitations: [],
      uninvitable: input.candidates.map((c) => ({
        candidacyId: c.candidacyId,
        contestId: c.contestId,
        reason: "NO_FILED_CONTACT" as const,
      })),
    };
  }

  return {
    contestId: input.contestId,
    officeClass: input.officeClass,
    invitations: input.candidates.map((c) => ({
      candidacyId: c.candidacyId,
      contestId: c.contestId,
      email: c.email as string,
      instrumentVersion: input.instrumentVersion,
      officeClass: input.officeClass,
      plannedInvitedOn: input.plannedInvitedOn,
      plannedRemindersOn: input.plannedRemindersOn,
      invitedOn: null,
      remindedOn: [],
      deadline: input.deadline,
      contactSource: c.contactSource as Invitation["contactSource"],
    })),
    uninvitable: [],
  };
}

/**
 * **THE SYMMETRY CHECK, run over a built list rather than trusted.**
 *
 * Every candidate in a contest must carry the identical instrument version,
 * office class, invited date, reminder dates and deadline. This is the
 * assertion RULING 112 turns into a build failure: an instrument that is
 * asymmetric is not shipped, and "we intended it to be symmetric" is not the
 * same claim as "it is".
 */
export interface SymmetryBreach {
  contestId: string;
  field:
    | "instrumentVersion"
    | "officeClass"
    | "plannedInvitedOn"
    | "plannedRemindersOn"
    | "invitedOn"
    | "remindedOn"
    | "deadline";
  values: readonly string[];
}

export function symmetryBreaches(
  invitations: readonly Invitation[],
): readonly SymmetryBreach[] {
  const byContest = new Map<string, Invitation[]>();
  for (const invitation of invitations) {
    const bucket = byContest.get(invitation.contestId);
    if (bucket) bucket.push(invitation);
    else byContest.set(invitation.contestId, [invitation]);
  }

  const breaches: SymmetryBreach[] = [];
  for (const [contestId, group] of byContest) {
    const fields: ReadonlyArray<[SymmetryBreach["field"], (i: Invitation) => string]> = [
      ["instrumentVersion", (i) => i.instrumentVersion],
      ["officeClass", (i) => i.officeClass],
      ["plannedInvitedOn", (i) => i.plannedInvitedOn],
      ["plannedRemindersOn", (i) => i.plannedRemindersOn.join("|")],
      ["invitedOn", (i) => i.invitedOn ?? ""],
      ["remindedOn", (i) => i.remindedOn.join("|")],
      ["deadline", (i) => i.deadline],
    ];
    for (const [field, read] of fields) {
      const values = [...new Set(group.map(read))];
      if (values.length > 1) breaches.push({ contestId, field, values });
    }
  }
  return breaches;
}
