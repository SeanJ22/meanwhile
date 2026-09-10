import { INSTRUMENT_VERSION, type OfficeClass } from "./instrument.ts";
import {
  buildContestInvitations,
  symmetryBreaches,
  type Invitation,
  type SymmetryBreach,
  type UninvitableCandidate,
} from "./invitations.ts";
import { officeClassFor } from "./office-class.ts";

export interface InvitationPlanBallot {
  readonly contests: readonly { readonly id: string; readonly ocdId: string; readonly title: string }[];
  readonly candidacies: readonly { readonly id: string; readonly contestId: string }[];
}

export interface InvitationPlanContacts {
  readonly contacts: readonly {
    readonly candidacyId: string;
    readonly email?: string | null;
    readonly sourceUrl: string;
    readonly sourceOrg: string;
    readonly collectedAt: string;
  }[];
}

export interface QuestionnaireInvitationPlan {
  readonly statedContests: number;
  readonly statedCandidacies: number;
  readonly statedContacts: number;
  readonly invitations: readonly Invitation[];
  readonly uninvitable: readonly UninvitableCandidate[];
  readonly symmetryBreaches: readonly SymmetryBreach[];
  readonly basisCounts: Readonly<Record<string, number>>;
  readonly classCounts: Readonly<Partial<Record<OfficeClass, number>>>;
}

/**
 * Derive the unsent operational plan directly from one canonical filing
 * projection. It writes nothing: sending code may persist the actual act, but
 * a changing clerk filing never creates a repository artifact or commit.
 */
export function buildQuestionnaireInvitationPlan(input: {
  readonly ballot: InvitationPlanBallot;
  readonly contacts: InvitationPlanContacts;
  readonly plannedInvitedOn: string;
  readonly plannedRemindersOn: readonly string[];
  readonly deadline: string;
}): QuestionnaireInvitationPlan {
  const contactBy = new Map(input.contacts.contacts.map((contact) => [contact.candidacyId, contact]));
  const invitations: Invitation[] = [];
  const uninvitable: UninvitableCandidate[] = [];
  const basisCounts: Record<string, number> = {};
  const classCounts: Partial<Record<OfficeClass, number>> = {};

  for (const contest of input.ballot.contests) {
    const verdict = officeClassFor({ ocdId: contest.ocdId, title: contest.title });
    basisCounts[verdict.basis] = (basisCounts[verdict.basis] ?? 0) + 1;
    const candidates = input.ballot.candidacies
      .filter((candidate) => candidate.contestId === contest.id)
      .map((candidate) => {
        const contact = contactBy.get(candidate.id);
        return {
          candidacyId: candidate.id,
          contestId: candidate.contestId,
          email: contact?.email ?? null,
          contactSource: contact
            ? { sourceUrl: contact.sourceUrl, sourceOrg: contact.sourceOrg, collectedAt: contact.collectedAt }
            : null,
        };
      });
    const result = buildContestInvitations({
      contestId: contest.id,
      officeClass: verdict.officeClass,
      instrumentVersion: INSTRUMENT_VERSION,
      plannedInvitedOn: input.plannedInvitedOn,
      plannedRemindersOn: input.plannedRemindersOn,
      deadline: input.deadline,
      candidates,
    });
    invitations.push(...result.invitations);
    uninvitable.push(...result.uninvitable);
    classCounts[verdict.officeClass] = (classCounts[verdict.officeClass] ?? 0) + candidates.length;
  }

  return {
    statedContests: input.ballot.contests.length,
    statedCandidacies: input.ballot.candidacies.length,
    statedContacts: input.contacts.contacts.length,
    invitations,
    uninvitable,
    symmetryBreaches: symmetryBreaches(invitations),
    basisCounts,
    classCounts,
  };
}
