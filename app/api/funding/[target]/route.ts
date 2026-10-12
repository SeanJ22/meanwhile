import { directFundingTargetPlan } from "@/lib/funding/target-authorities";
import { ensureReaderAuthorityEdge, READER_FUNDING_AUTHORITY_FAMILIES, readReaderManifest } from "@/lib/meetings/edge-serving";
import type { AuthorityFamily } from "@/lib/meetings/edge-artifacts";
import { enterReaderAuthorityEdge } from "@/lib/registry/runtime-edge";
import { defaultReadersFor, settleFundingHoldingAnswer, startDirectFundingReads, timedRead, type ReadTimings } from "./holdings";

/**
 * GET /api/funding/<app-side id> — the funding answer for one exact target.
 * The target is selected before a store is opened. Federal, state, and
 * identity holdings settle independently; one failed authority cannot erase
 * a source-linked answer from another and no tracked data is a runtime
 * fallback.
 */

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ target: string }> },
) {
  let target: string;
  try { target = decodeURIComponent((await params).target); }
  catch { return Response.json({ error: "invalid target encoding" }, { status: 400 }); }
  if (!target || target.length > 512) {
    return Response.json({ error: "target must contain 1–512 characters" }, { status: 400 });
  }

  const timings: ReadTimings = {};
  const startedAt = Date.now();
  const readers = defaultReadersFor(timings);
  /*
   * The edge is entered here, before any money is read, in this handler's own execution:
   * `AsyncLocalStorage.enterWith` never reaches reads chained on a helper that entered it.
   */
  const direct = directFundingTargetPlan(target);
  const manifest = await timedRead(timings, "edgeManifest", () => readReaderManifest().catch(() => null));
  const onEdge = (family: AuthorityFamily) => Boolean(manifest?.authorityArtifacts?.[family]);
  const fromDatabase = startDirectFundingReads({
    ...direct,
    federal: direct.federal && !onEdge("federal-funding"),
    state: onEdge("state-money") ? null : direct.state,
    azIdentity: direct.azIdentity && !onEdge("ballot-az"),
  }, readers);
  if (manifest?.authorityArtifacts) {
    const edge = await timedRead(timings, "authorityEdge", () => ensureReaderAuthorityEdge(manifest, undefined, READER_FUNDING_AUTHORITY_FAMILIES).catch(() => null));
    if (edge) enterReaderAuthorityEdge(edge);
  }
  const fromEdge = startDirectFundingReads({
    ...direct,
    federal: direct.federal && fromDatabase.federal === undefined,
    state: fromDatabase.state === undefined ? direct.state : null,
    azIdentity: direct.azIdentity && fromDatabase.azIdentity === undefined,
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
}
