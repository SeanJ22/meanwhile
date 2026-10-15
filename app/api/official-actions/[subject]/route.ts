import { officialActionsForTarget, type ReaderOfficialActions } from "@/lib/officials/reader-actions";
import { refreshExecutiveActionsFromPromoted } from "@/lib/officials/executive-actions";
import { readGenericBallotProjection } from "@/lib/ballot/generic-projection";
import { promotedVersionOrThrow } from "@/lib/civic-data/read-model";
import { refreshFederalDirectoryFromPromoted } from "@/lib/officials/federal-directory-read-model";
import {
  getRegistryRuntimeReadModel,
  refreshRegistryRuntimeFromPromoted,
} from "@/lib/registry/runtime-read-model";

export const runtime = "nodejs";

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

export type OfficialActionHoldingSettlement =
  | { readonly kind: "ANSWER"; readonly answer: ReaderOfficialActions }
  | { readonly kind: "HOLDING_UNAVAILABLE"; readonly unavailableAuthorities: string[] };

/** Scope known from the target itself, safe when the identity store is down. */
export function directOfficialActionTargetPlan(subject: string): OfficialActionTargetPlan {
  const applies = subject.startsWith("statewide:az/") || subject.startsWith("ballot-az-");
  return { applies, ballotIdentity: subject.startsWith("ballot-az-") && subject.includes("|") };
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
  return { applies, ballotIdentity: direct.ballotIdentity };
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
  ballotIdentity: async () => { promotedVersionOrThrow(await readGenericBallotProjection()); },
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

export async function GET(_request: Request, context: { params: Promise<{ subject: string }> }) {
  const { subject } = await context.params;
  if (!subject || subject.length > 512) return Response.json({ error: "subject required" }, { status: 400 });
  const settled = await settleOfficialActionHoldingAnswer(subject);
  if (settled.kind === "HOLDING_UNAVAILABLE") {
    return Response.json({
      error: "Official-action records are temporarily unavailable",
      holdingStatus: "HOLDING_UNAVAILABLE",
      unavailableAuthorities: settled.unavailableAuthorities,
    }, { status: 503 });
  }
  return Response.json(settled.answer);
}
