import { settleCampaignMoneyForState } from "@/lib/funding/holding-answer";
import { validReactionTargetsFor, type ReactionAuthorityReaders } from "@/lib/reactions/authority-targets";
import { ballotPlaceFromRequest } from "@/lib/ballot/reader-place";
import { readerRoute } from "@/lib/api/reader-route";
import { withReaderFeatures } from "@/lib/civic-data/reader-feature-context.ts";
import { measureRecordsForBallot } from "@/lib/ballot/measure-records";
import { readerBallotSourceForTargetId } from "@/lib/ballot/reader-sources";
import { writeReaction } from "@/lib/db/reactions";
import { raiseWriteAlarm } from "@/lib/db/write-alarm";
import { noteSubmission } from "@/lib/db/intake-limiter";
import { markerFromRequest } from "@/lib/db/run-marker";
import { coverageAt } from "@/lib/registry/server";
import { ripcordPulled } from "@/lib/ripcords";
import {
  classifySubmission,
  isSameOriginSubmission,
} from "@/lib/signal/intake-limits";
import { intakeWindows } from "@/lib/db/intake-windows";
import {
  CONTEXT_RESTRICTED_VALUES,
  isPlausibleTargetId,
  isValidFreeText,
  isValidReactionKey,
  isValidReactionValue,
  isValidTargetType,
  isValueOnScaleFor,
  normalizeFreeText,
} from "@/lib/signal/reactions";
import { getCandidateTargetIds } from "@/lib/ballot/candidate-targets";
import { getProvisionTargetIds } from "@/lib/ballot/measure-provisions";
import { getSingleCandidateTargetIds } from "@/lib/ballot/uncontested";
import {
  getContributorReactionTargetIds,
  getFundingTargetIds,
  refreshFundingFromPromoted,
} from "@/lib/funding/snapshot";
import { getVoteIds, refreshFederalVotesFromPromoted } from "@/lib/votes/snapshot";
import { stateMoneyForTarget } from "@/lib/funding/state-snapshot";



export const runtime = "nodejs";



const MAX_BODY_BYTES = 4096;

const reactionAuthorityReaders = (divisions: readonly string[]): ReactionAuthorityReaders => ({
  candidateTargets: targetId => getCandidateTargetIds(divisions, targetId),
  provisionTargets: async (targetId) => {
    const authority = await readerBallotSourceForTargetId(targetId, divisions);
    if (!authority) return new Set();
    const ballot = authority.source.normalize(await authority.source.fetch());
    return getProvisionTargetIds(measureRecordsForBallot(ballot));
  },
  refreshFunding: refreshFundingFromPromoted,
  fundingTargets: getFundingTargetIds,
  refreshStateMoney: (state) => settleCampaignMoneyForState(state),
  stateMoneyTargets: (targetId) =>
    stateMoneyForTarget(targetId).some(
      (r) => r.filingState === "FILED" || r.filingState === "REGISTERED_NO_ACTIVITY_REPORTED",
    )
      ? new Set([targetId])
      : new Set(),
  contributorTargets: getContributorReactionTargetIds,
  refreshVotes: refreshFederalVotesFromPromoted,
  voteTargets: getVoteIds,
});


async function postWithSettings(request: Request) {
  if (ripcordPulled("ripcord.reactionIntake")) {
    return Response.json({ error: "intake is closed" }, { status: 503 });
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return Response.json({ error: "payload too large" }, { status: 413 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "body must be JSON" }, { status: 400 });
  }

  const submission = body as {
    targetType?: unknown;
    targetId?: unknown;
    reaction?: unknown;
    reactionKey?: unknown;
    /** The optional verbatim. Absent is the ordinary case. */
    text?: unknown;
    zip?: unknown;
    lat?: unknown;
    lng?: unknown;
  };

  if (!isValidTargetType(submission.targetType)) {
    return Response.json({ error: "unknown targetType" }, { status: 400 });
  }
  if (!isValidReactionValue(submission.reaction)) {
    return Response.json({ error: "unknown reaction" }, { status: 400 });
  }
  if (!isValidReactionKey(submission.reactionKey)) {
    return Response.json({ error: "malformed reactionKey" }, { status: 400 });
  }
  if (!isPlausibleTargetId(submission.targetId)) {
    return Response.json({ error: "malformed targetId" }, { status: 400 });
  }
  if (!isValidFreeText(submission.text)) {
    return Response.json({ error: "malformed text" }, { status: 400 });
  }

  const divisions = await ballotPlaceFromRequest(request);
  let validTargets: Set<string>;
  try {
    validTargets = await validReactionTargetsFor(
      submission.targetType,
      submission.targetId,
      reactionAuthorityReaders(divisions),
    );
  } catch {
    return Response.json({ error: "target data unavailable" }, { status: 503 });
  }
  if (!validTargets.has(submission.targetId)) {
    return Response.json({ error: "unknown targetId" }, { status: 400 });
  }

  if (!isValueOnScaleFor(submission.targetType, submission.reaction)) {
    return Response.json(
      { error: "that answer is not on this question's scale" },
      { status: 400 },
    );
  }

  if (CONTEXT_RESTRICTED_VALUES[submission.reaction] === "SINGLE_CANDIDATE_CONTEST") {
    if (submission.targetType !== "CANDIDATE") {
      return Response.json(
        { error: "that answer does not apply to this target" },
        { status: 400 },
      );
    }
    let uncontested: Set<string>;
    try {
      uncontested = await getSingleCandidateTargetIds(divisions, submission.targetId);
    } catch {
      return Response.json({ error: "target data unavailable" }, { status: 503 });
    }
    if (!uncontested.has(submission.targetId)) {
      return Response.json(
        { error: "that answer is only offered in uncontested races" },
        { status: 400 },
      );
    }
  }

  let suspectReason: "VELOCITY" | "LIMITER_UNAVAILABLE" | null = null;
  if (!ripcordPulled("ripcord.rateLimits")) {
    if (!isSameOriginSubmission(request)) {
      return Response.json(
        { error: "cross-origin submissions are not accepted" },
        { status: 403 },
      );
    }

    // In-memory windows: instance-local, free. The IP is used here and
    // discarded, never stored, never logged.
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const { perKey, perIp } = intakeWindows("reactions");
    if (
      !perKey.allow(`k:${submission.reactionKey}`) ||
      !perIp.allow(`ip:${ip}`)
    ) {
      return new Response(null, { status: 429, headers: { "Retry-After": "60" } });
    }

    // The authoritative cross-instance counters. null means the limit
    // COULD NOT be checked — quarantine, never trust through.
    const counters = await noteSubmission(submission.reactionKey);
    if (counters === null) {
      suspectReason = "LIMITER_UNAVAILABLE";
    } else {
      const disposition = classifySubmission(counters);
      if (disposition.kind === "REFUSE_DAILY") {
        // The quiet refusal past the daily ceiling: no real
        // reader reaches it; the client renders the honest line.
        return new Response(null, {
          status: 429,
          headers: { "Retry-After": "86400" },
        });
      }
      if (disposition.kind === "REFUSE_RATE") {
        return new Response(null, { status: 429, headers: { "Retry-After": "60" } });
      }
      if (disposition.kind === "QUARANTINE") {
        suspectReason = disposition.reason;
      }
    }
  }

  /* The guard requires an actual number on the wire: `Number(null)` is 0, so a null is absent, not the equator. */
  const lat = typeof submission.lat === "number" ? submission.lat : Number.NaN;
  const lng = typeof submission.lng === "number" ? submission.lng : Number.NaN;
  let ocdIds: string[] = [];
  if (Number.isFinite(lat) && lat >= -90 && lat <= 90 && Number.isFinite(lng) && lng >= -180 && lng <= 180) {
    try {
      const coverage = await coverageAt(lat, lng, 0);
      ocdIds = [
        ...coverage.bodies.flatMap((b) => (b.ocdId ? [b.ocdId] : [])),
        ...coverage.seats.map((s) => s.ocdId),
      ];
    } catch {
      // A failed resolution is an empty list, never a fabricated one.
    }
  }

  // Everything a reader types is captured; the verbatim
  // is still validated and scrubbed by `normalizeFreeText`.
  const freeText = normalizeFreeText(submission.text);

  try {
    const stored = await writeReaction({
      targetType: submission.targetType,
      targetId: submission.targetId,
      reaction: submission.reaction,
      reactionKey: submission.reactionKey,
      ocdIds,
      suspectReason,
      freeText,
      marker: markerFromRequest(request),
    });
    return new Response(null, { status: stored ? 204 : 202 });
  } catch (error) {
    /* `raiseWriteAlarm` never throws, so it cannot turn a stored-reaction failure into a worse one. */
    console.error("reaction write failed", error);
    await raiseWriteAlarm("reactions", error);
    return Response.json({ error: "could not store the reaction" }, { status: 500 });
  }
}

export const POST = readerRoute("/api/reactions", async function POST(request: Request) {
  return withReaderFeatures(() => postWithSettings(request));
});
