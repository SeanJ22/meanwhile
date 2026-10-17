import type { ReaderOfficialActions } from "./reader-actions.ts";

export interface OfficialActionTargetPlan {
  readonly applies: boolean;
  readonly ballotIdentity: boolean;
}

export interface OfficialActionHoldingReaders {
  readonly identityPlan: (subject: string) => Promise<OfficialActionTargetPlan>;
  readonly actions: () => Promise<void>;
  readonly ballotIdentity: () => Promise<void>;
  readonly answer: (subject: string) => ReaderOfficialActions;
}

type OfficialActionHoldingSettlement =
  | { readonly kind: "ANSWER"; readonly answer: ReaderOfficialActions }
  | { readonly kind: "HOLDING_UNAVAILABLE"; readonly unavailableAuthorities: string[] };

/** Scope known from the target itself, safe when the identity store is down. */
export function directOfficialActionTargetPlan(subject: string): OfficialActionTargetPlan {
  const applies = subject.startsWith("statewide:az/") || subject.startsWith("ballot-az-");
  return { applies, ballotIdentity: subject.startsWith("ballot-az-") && subject.includes("|") };
}

const emptyAnswer = (subjectId: string): ReaderOfficialActions => ({
  subjectId,
  officialIds: [],
  resolvedTargetId: subjectId,
  status: "NO_APPLICABLE_OFFICIAL",
  withheldRecords: [],
  count: 0,
  records: [],
});

/** A non-AZ request never opens the AZ action store; required reads fail closed. */
export async function settleOfficialActionHoldingAnswer(
  subject: string,
  readers: OfficialActionHoldingReaders,
): Promise<OfficialActionHoldingSettlement> {
  const direct = directOfficialActionTargetPlan(subject);
  const [identityResult] = await Promise.allSettled([
    Promise.resolve().then(() => readers.identityPlan(subject)),
  ]);
  const plan = identityResult.status === "fulfilled" ? identityResult.value : direct;

  if (!plan.applies) {
    // A non-AZ ballot identity proves the AZ source is inapplicable without
    // consulting it. Other official ids remain unknown if identity failed.
    if (identityResult.status === "rejected" && !subject.startsWith("ballot-")) {
      return { kind: "HOLDING_UNAVAILABLE", unavailableAuthorities: ["PERSON_IDENTITY"] };
    }
    return { kind: "ANSWER", answer: emptyAnswer(subject) };
  }
  if (identityResult.status === "rejected") {
    return { kind: "HOLDING_UNAVAILABLE", unavailableAuthorities: ["PERSON_IDENTITY"] };
  }

  const [actionResult, ballotIdentityResult] = await Promise.allSettled([
    Promise.resolve().then(() => readers.actions()),
    plan.ballotIdentity
      ? Promise.resolve().then(() => readers.ballotIdentity())
      : Promise.resolve(null),
  ]);
  const unavailableAuthorities: string[] = [];
  if (actionResult.status === "rejected") unavailableAuthorities.push("AZ_OFFICIAL_ACTION");
  if (plan.ballotIdentity && ballotIdentityResult.status === "rejected") unavailableAuthorities.push("BALLOT_CANDIDACY_IDENTITY");
  if (unavailableAuthorities.length) return { kind: "HOLDING_UNAVAILABLE", unavailableAuthorities };
  try {
    return { kind: "ANSWER", answer: readers.answer(subject) };
  } catch {
    return { kind: "HOLDING_UNAVAILABLE", unavailableAuthorities: ["ANSWER_ASSEMBLY"] };
  }
}
