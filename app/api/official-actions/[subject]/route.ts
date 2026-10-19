import { directOfficialActionTargetPlan, settleOfficialActionHoldingAnswer, type OfficialActionHoldingReaders, type OfficialActionTargetPlan } from "@/lib/officials/action-holding";
import { readerRoute } from "@/lib/api/reader-route";
import { holdReaderAuthorityEdge, ensureReaderAuthorityEdge } from "@/lib/meetings/edge-serving";
import { enterReaderAuthorityEdge } from "@/lib/registry/runtime-edge";
import { officialActionsForTarget } from "@/lib/officials/reader-actions";
import { refreshExecutiveActionsFromPromoted } from "@/lib/officials/executive-actions";
import { ballotStatesForDivisions, readerBallotSourcesForDivisions } from "@/lib/ballot/reader-sources";
import { ballotPlaceFromRequest } from "@/lib/ballot/reader-place";
import { resolvedCandidacyForOfficial, currentOfficialIdentity } from "@/lib/funding/campaign-money";
import { refreshFederalDirectoryFromPromoted } from "@/lib/officials/federal-directory-read-model";
import {
  refreshRegistryRuntimeFromPromoted,
} from "@/lib/registry/runtime-read-model";

export const runtime = "nodejs";

async function currentOfficialActionTargetPlan(subject: string, divisions: readonly string[]): Promise<OfficialActionTargetPlan> {
  await refreshRegistryRuntimeFromPromoted(ballotStatesForDivisions(divisions));
  const direct = directOfficialActionTargetPlan(subject);
  if (subject.startsWith("congress:") && divisions.length) await refreshFederalDirectoryFromPromoted(ballotStatesForDivisions(divisions));
  const candidacy = resolvedCandidacyForOfficial(subject);
  const holder = currentOfficialIdentity(subject);
  const applies = direct.applies || Boolean(candidacy?.candidacyId.startsWith("ballot-az-"))
    || Boolean(holder?.divisions.some(division => division.includes("/state:az")));
  return { applies, ballotIdentity: direct.ballotIdentity };
}

function defaultReadersFor(divisions: readonly string[]): OfficialActionHoldingReaders {
  return {
  identityPlan: subject => currentOfficialActionTargetPlan(subject, divisions),
  actions: async () => { await refreshExecutiveActionsFromPromoted(); },
  ballotIdentity: async () => {
    if (!divisions.length) throw new Error("Ballot place is required");
    for (const { source } of await readerBallotSourcesForDivisions(divisions)) source.normalize(await source.fetch());
  },
  answer: subject => officialActionsForTarget(subject),
}; }

export const GET = readerRoute("/api/official-actions/[subject]", async function GET(request: Request, context: { params: Promise<{ subject: string }> }) {
  const { subject } = await context.params;
  if (!subject || subject.length > 512) return Response.json({ error: "subject required" }, { status: 400 });
  {
    const edge = await ensureReaderAuthorityEdge(null, undefined, ["federal-directory", "ballot-contests", "executive-actions"]).catch(error => holdReaderAuthorityEdge(error, ["federal-directory", "ballot-contests", "executive-actions"]));
    if (edge) enterReaderAuthorityEdge(edge);
  }
  const divisions = await ballotPlaceFromRequest(request);
  const settled = await settleOfficialActionHoldingAnswer(subject, defaultReadersFor(divisions));
  if (settled.kind === "HOLDING_UNAVAILABLE") {
    return Response.json({
      error: "Official-action records are temporarily unavailable",
      holdingStatus: "HOLDING_UNAVAILABLE",
      unavailableAuthorities: settled.unavailableAuthorities,
    }, { status: 503 });
  }
  return Response.json(settled.answer);
});
