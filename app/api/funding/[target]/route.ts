import { readerRoute } from "@/lib/api/reader-route";
import { directFundingTargetPlan } from "@/lib/funding/target-authorities";
import { ballotPlaceFromRequest } from "@/lib/ballot/reader-place";
import { holdReaderAuthorityEdge, ensureReaderAuthorityEdge, READER_FUNDING_AUTHORITY_FAMILIES, readReaderManifest } from "@/lib/meetings/edge-serving";
import type { GlobalAuthorityFamily } from "@/lib/meetings/edge-artifacts";
import { enterReaderAuthorityEdge } from "@/lib/registry/runtime-edge";
import { settleFundingHoldingAnswer, startDirectFundingReads, fundingHoldingReaders, timedRead } from "@/lib/funding/holding-answer";

export const runtime = "nodejs";

export const GET = readerRoute("/api/funding/[target]", async function GET(
  request: Request,
  { params }: { params: Promise<{ target: string }> },
) {
  let target: string;
  try { target = decodeURIComponent((await params).target); }
  catch { return Response.json({ error: "invalid target encoding" }, { status: 400 }); }
  if (!target || target.length > 512) {
    return Response.json({ error: "target must contain 1–512 characters" }, { status: 400 });
  }

  const timings: Record<string, number> = {};
  const startedAt = Date.now();
  const divisions = await ballotPlaceFromRequest(request);
  const direct = directFundingTargetPlan(target);
  const manifest = await timedRead(timings, "edgeManifest", () => readReaderManifest().catch(holdReaderAuthorityEdge));
  const readers = fundingHoldingReaders(divisions, timings);
  const onEdge = (family: GlobalAuthorityFamily) => Boolean(manifest?.authorityArtifacts?.[family]);
  const fromDatabase = startDirectFundingReads({
    ...direct,
    federal: direct.federal && !onEdge("federal-funding"),
    state: onEdge("state-money") ? null : direct.state,
    ballotIdentity: direct.ballotIdentity && !manifest?.stateAuthorities?.["ballot-contests"],
  }, readers);
  if (manifest?.authorityArtifacts) {
    const edge = await timedRead(timings, "authorityEdge", () => ensureReaderAuthorityEdge(manifest, undefined, READER_FUNDING_AUTHORITY_FAMILIES.filter(family => family !== "registry-runtime")).catch(error => holdReaderAuthorityEdge(error, manifest, READER_FUNDING_AUTHORITY_FAMILIES.filter(family => family !== "registry-runtime"))));
    if (edge) enterReaderAuthorityEdge(edge);
  }
  const fromEdge = startDirectFundingReads({
    ...direct,
    federal: direct.federal && fromDatabase.federal === undefined,
    state: fromDatabase.state === undefined ? direct.state : null,
    ballotIdentity: direct.ballotIdentity && fromDatabase.ballotIdentity === undefined,
  }, readers);
  const settled = await settleFundingHoldingAnswer(target, readers, { ...fromDatabase, ...fromEdge });
  timings.total = Date.now() - startedAt;
  const serverTiming = Object.entries(timings).map(([name, ms]) => `${name};dur=${ms}`).join(", ");
  if (settled.kind === "HOLDING_UNAVAILABLE") {
    return Response.json(
      { error: "funding data unavailable", holdingStatus: "HOLDING_UNAVAILABLE", unavailableAuthorities: settled.unavailableAuthorities },
      { status: 503, headers: { "server-timing": serverTiming } },
    );
  }
  return Response.json({
    ...settled.answer,
    dataState: settled.dataState,
    dataMetadata: settled.dataMetadata,
    holdingStatus: settled.holdingStatus,
    unavailableAuthorities: settled.unavailableAuthorities,
  }, {
    headers: {
      "server-timing": serverTiming,
      "cache-control": settled.holdingStatus === "HELD"
        && settled.dataState === "PROMOTED"
        && settled.dataMetadata?.stale === "CURRENT"
        ? "public, max-age=3600"
        : "private, no-store",
    },
  });
});
