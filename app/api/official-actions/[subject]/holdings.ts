import { officialActionsForTarget, type ReaderOfficialActions } from "@/lib/officials/reader-actions";
import { refreshExecutiveActionsFromPromoted } from "@/lib/officials/executive-actions";
import { refreshAzBallotFromPromoted } from "@/lib/civic-data/manual-read-models";
import { refreshFederalDirectoryFromPromoted } from "@/lib/officials/federal-directory-read-model";
import {
  getRegistryRuntimeReadModel,
  refreshRegistryRuntimeFromPromoted,
} from "@/lib/registry/runtime-read-model";

export interface OfficialActionTargetPlan {
  readonly applies: boolean;
  readonly azIdentity: boolean;
}

export interface OfficialActionHoldingReaders {
  readonly identityPlan: (subject: string) => Promise<OfficialActionTargetPlan>;
  readonly actions: () => Promise<void>;
  readonly azIdentity: () => Promise<void>;
  readonly answer: (subject: string) => ReaderOfficialActions;
}

export type OfficialActionHoldingSettlement =
  | { readonly kind: "ANSWER"; readonly answer: ReaderOfficialActions }
  | { readonly kind: "HOLDING_UNAVAILABLE"; readonly unavailableAuthorities: string[] };

/** Scope known from the target itself, safe when the identity store is down. */
export function directOfficialActionTargetPlan(subject: string): OfficialActionTargetPlan {
  const applies = subject.startsWith("statewide:az/") || subject.startsWith("ballot-az-");
  return { applies, azIdentity: subject.startsWith("ballot-az-") && subject.includes("|") };
}

async function currentOfficialActionTargetPlan(subject: string): Promise<OfficialActionTargetPlan> {
  await refreshRegistryRuntimeFromPromoted();
  const direct = directOfficialActionTargetPlan(subject);
  const related = getRegistryRuntimeReadModel().officialCandidacies.rows.filter((row) =>
    row.holder.id === subject || row.candidacy?.candidacyId === subject,
  );
  const applies = direct.applies
    || related.some((row) => row.candidacy?.candidacyId.startsWith("ballot-az-"))
    || related.some((row) => row.holder.divisions.some((division) => division.includes("/state:az")));
  // A federal directory is supporting identity only when this exact subject's
  // AZ action/candidacy relationship names a federal holder.
  if (applies && related.some((row) => row.holder.authority === "FEDERAL_DIRECTORY")) {
    await refreshFederalDirectoryFromPromoted();
  }
  return { applies, azIdentity: direct.azIdentity };
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

const defaultReaders: OfficialActionHoldingReaders = {
  identityPlan: currentOfficialActionTargetPlan,
  actions: async () => { await refreshExecutiveActionsFromPromoted(); },
  azIdentity: async () => { await refreshAzBallotFromPromoted(); },
  answer: officialActionsForTarget,
};

/** A non-AZ request never opens the AZ action store; required reads fail closed. */
export async function settleOfficialActionHoldingAnswer(
  subject: string,
  readers: OfficialActionHoldingReaders = defaultReaders,
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

  const [actionResult, azIdentityResult] = await Promise.allSettled([
    Promise.resolve().then(() => readers.actions()),
    plan.azIdentity
      ? Promise.resolve().then(() => readers.azIdentity())
      : Promise.resolve(null),
  ]);
  const unavailableAuthorities: string[] = [];
  if (actionResult.status === "rejected") unavailableAuthorities.push("AZ_OFFICIAL_ACTION");
  if (plan.azIdentity && azIdentityResult.status === "rejected") unavailableAuthorities.push("AZ_CANDIDACY_IDENTITY");
  if (unavailableAuthorities.length) return { kind: "HOLDING_UNAVAILABLE", unavailableAuthorities };
  try {
    return { kind: "ANSWER", answer: readers.answer(subject) };
  } catch {
    return { kind: "HOLDING_UNAVAILABLE", unavailableAuthorities: ["ANSWER_ASSEMBLY"] };
  }
}
