import { readerRoute } from "@/lib/api/reader-route";
import { directFundingTargetPlan } from "@/lib/funding/target-authorities";
import { ballotPlaceFromRequest } from "@/lib/ballot/reader-place";
import { settleFundingHoldingAnswer, startDirectFundingReads, fundingHoldingReaders } from "@/lib/funding/holding-answer";

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
  const readers = fundingHoldingReaders(divisions, timings);
  const pending = startDirectFundingReads(direct, readers);
  const settled = await settleFundingHoldingAnswer(target, readers, pending);
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
