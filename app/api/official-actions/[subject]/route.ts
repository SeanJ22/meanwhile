import { readerRoute } from "@/lib/api/reader-route";
import { readRegistryPlace } from "@/lib/registry/reader-place";
import { withRegistryPlaceRead, type RegistryPlaceRead } from "@/lib/registry/runtime-read-model";
import type { ReaderAuthorityManifest } from "@/lib/meetings/edge-artifacts";
import { ensureReaderAuthorityEdge, readReaderAuthorityManifest } from "@/lib/meetings/edge-serving";
import { enterReaderAuthorityEdge } from "@/lib/registry/runtime-edge";
import { officialActionsForTarget, type ReaderOfficialActions } from "@/lib/officials/reader-actions";
import { refreshExecutiveActionsFromPromoted } from "@/lib/officials/executive-actions";
import { readerBallotSourcesForDivisions } from "@/lib/ballot/reader-sources";
import { ballotPlaceFromRequest } from "@/lib/ballot/reader-place";
import { resolvedCandidacyForOfficial, currentOfficialIdentity } from "@/lib/funding/campaign-money";
import { refreshFederalDirectoryFromPromoted } from "@/lib/officials/federal-directory-read-model";
import {
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
  if (subject.startsWith("congress:")) await refreshFederalDirectoryFromPromoted();
  const candidacy = resolvedCandidacyForOfficial(subject);
  const holder = currentOfficialIdentity(subject);
  const applies = direct.applies || Boolean(candidacy?.candidacyId.startsWith("ballot-az-"))
    || Boolean(holder?.divisions.some(division => division.includes("/state:az")));
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

function defaultReadersFor(divisions: readonly string[], manifest?: ReaderAuthorityManifest | null): OfficialActionHoldingReaders {
  let registry: RegistryPlaceRead | Error = new Error("Registry place has not been read");
  return {
  identityPlan: async subject => {
    try { registry = await readRegistryPlace(divisions, [subject], manifest); }
    catch (error) { registry = error instanceof Error ? error : new Error(String(error)); }
    return withRegistryPlaceRead(registry, () => currentOfficialActionTargetPlan(subject));
  },
  actions: async () => { await refreshExecutiveActionsFromPromoted(); },
  ballotIdentity: async () => {
    if (!divisions.length) throw new Error("Ballot place is required");
    for (const { source } of await readerBallotSourcesForDivisions(divisions)) source.normalize(await source.fetch());
  },
  answer: subject => withRegistryPlaceRead(registry, () => officialActionsForTarget(subject)),
}; }

/** A non-AZ request never opens the AZ action store; required reads fail closed. */
export async function settleOfficialActionHoldingAnswer(
  subject: string,
  readers?: OfficialActionHoldingReaders,
  divisions: readonly string[] = [],
): Promise<OfficialActionHoldingSettlement> {
  readers ??= defaultReadersFor(divisions);
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

export const GET = readerRoute("/api/official-actions/[subject]", async function GET(request: Request, context: { params: Promise<{ subject: string }> }) {
  const { subject } = await context.params;
  if (!subject || subject.length > 512) return Response.json({ error: "subject required" }, { status: 400 });
  const manifest = await readReaderAuthorityManifest().catch(() => null);
  if (manifest) {
    const edge = await ensureReaderAuthorityEdge(manifest, undefined, ["federal-directory", "ballot-contests", "executive-actions"]).catch(() => null);
    if (edge) enterReaderAuthorityEdge(edge);
  }
  const divisions = await ballotPlaceFromRequest(request);
  const settled = await settleOfficialActionHoldingAnswer(subject, defaultReadersFor(divisions, manifest), divisions);
  if (settled.kind === "HOLDING_UNAVAILABLE") {
    return Response.json({
      error: "Official-action records are temporarily unavailable",
      holdingStatus: "HOLDING_UNAVAILABLE",
      unavailableAuthorities: settled.unavailableAuthorities,
    }, { status: 503 });
  }
  return Response.json(settled.answer);
});
