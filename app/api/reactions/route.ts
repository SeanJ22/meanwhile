import { writeReaction } from "@/lib/db/reactions";
import { noteSubmission } from "@/lib/db/intake-limiter";
import { coverageAt } from "@/lib/registry/server";
import { ripcordPulled } from "@/lib/ripcords";
import {
  classifySubmission,
  intakeLimits,
  isSameOriginSubmission,
} from "@/lib/signal/intake-limits";
import { SlidingWindowLimiter } from "@/lib/signal/rate-limit";
import {
  CONTEXT_RESTRICTED_VALUES,
  isPlausibleTargetId,
  isValidReactionKey,
  isValidReactionValue,
  isValidTargetType,
} from "@/lib/signal/reactions";
import { getCandidateTargetIds } from "@/lib/ballot/candidate-targets";
import { getSingleCandidateTargetIds } from "@/lib/ballot/uncontested";
import {
  getContributorReactionTargetIds,
  getFundingTargetIds,
} from "@/lib/funding/snapshot";
import { getVoteIds } from "@/lib/votes/snapshot";

/**
 * POST /api/reactions — the reaction write path (P03), hardened (T08).
 *
 * Validation fails closed and is never behind any flag: an unknown enum
 * value, an invented target id, an oversized payload, a malformed key —
 * all 400, nothing stored, nothing coerced. A tap from the real app always
 * passes because the app only offers real targets.
 *
 * The protections (T08), cheapest first, all inside `ripcord.rateLimits`:
 *
 * 1. Same-origin — the write must come from a page this site served.
 * 2. In-memory sliding windows per device key and per IP — instance-local,
 *    free, catch a single-instance burst immediately. The IP is read for
 *    limiting only and appears in no log line, no row, no error message.
 * 3. The authoritative counters (lib/db/intake-limiter.ts) — one atomic
 *    upsert per submission, counted across every instance: past the hard
 *    per-minute limit or the daily ceiling, refused; past the soft
 *    velocity threshold, stored but QUARANTINED (suspect_reason, excluded
 *    from every aggregate); counters unavailable, stored quarantined as
 *    LIMITER_UNAVAILABLE — never trusted through.
 *
 * The limiter state lives in its own table with a digest that cannot join
 * the reaction store (n-stores-never-join under load — CLAUDE.md). The
 * master ripcord `ripcord.reactionIntake` closes this route entirely with
 * a 503; the client's honesty rendering (P11) turns any non-204 into the
 * not-counted line, so a closed intake is honest with zero client change.
 *
 * A missing database remains a 202 (accepted, not stored) so a demo
 * without DATABASE_URL still behaves honestly.
 */

export const runtime = "nodejs";

/**
 * The instance-local first line. Limits are read from env once per
 * instance — the authoritative cross-instance numbers live in the DB
 * counters, so a stale window limit here only affects the cheap pre-check.
 */
let limiters: { perKey: SlidingWindowLimiter; perIp: SlidingWindowLimiter } | null =
  null;
function getLimiters() {
  if (!limiters) {
    const limits = intakeLimits();
    limiters = {
      perKey: new SlidingWindowLimiter(limits.reactionsPerMinuteHard, 60_000),
      perIp: new SlidingWindowLimiter(limits.reactionsPerIpPerMinute, 60_000),
    };
  }
  return limiters;
}

const MAX_BODY_BYTES = 4096;

export async function POST(request: Request) {
  // The master ripcord (T08): intake closed means every write refused
  // before anything is read or counted. The reader's tap renders the
  // honest not-counted line; nothing silently records.
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

  // The target must exist in the committed data for its type — votes in
  // the votes snapshot, candidates in the ballot files (3d), funding
  // reactions in the FEC snapshot (D34). A missing file fails closed —
  // better to refuse a reaction than to store one against a target nothing
  // can render. The CONTRIBUTOR_REACTION set is empty while
  // ripcord.fecContributorDisplay is pulled, so the control's write path
  // dies with its display — a ripcord that only hid pixels would not be
  // a ripcord.
  let validTargets: Set<string>;
  try {
    validTargets =
      submission.targetType === "CANDIDATE"
        ? getCandidateTargetIds()
        : submission.targetType === "FUNDING_TOTAL_REACTION"
          ? getFundingTargetIds()
          : submission.targetType === "CONTRIBUTOR_REACTION"
            ? getContributorReactionTargetIds()
            : getVoteIds();
  } catch {
    return Response.json({ error: "target data unavailable" }, { status: 503 });
  }
  if (!validTargets.has(submission.targetId)) {
    return Response.json({ error: "unknown targetId" }, { status: 400 });
  }

  // The context table (M63): a value whose meaning depends on the contest's
  // shape is refused wherever that shape does not hold. SOMEONE_ELSE only
  // means what it says in a race with one candidate; accepted on a contested
  // race it would pour a different question's answers into the same bucket.
  // Enforced here rather than trusted to the UI — the UI decides what to
  // offer, the server decides what is true.
  if (CONTEXT_RESTRICTED_VALUES[submission.reaction] === "SINGLE_CANDIDATE_CONTEST") {
    if (submission.targetType !== "CANDIDATE") {
      return Response.json(
        { error: "that answer does not apply to this target" },
        { status: 400 },
      );
    }
    let uncontested: Set<string>;
    try {
      uncontested = getSingleCandidateTargetIds();
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

  // ── The T08 protections, cheapest first — the ripcord.rateLimits family ──
  let suspectReason: "VELOCITY" | "LIMITER_UNAVAILABLE" | null = null;
  if (!ripcordPulled("ripcord.rateLimits")) {
    // Same-origin: taps come from pages this site served. A browser
    // attaches Origin to every POSTed fetch; a script pumping writes from
    // outside either omits it or names a foreign origin.
    if (!isSameOriginSubmission(request)) {
      return Response.json(
        { error: "cross-origin submissions are not accepted" },
        { status: 403 },
      );
    }

    // In-memory windows: instance-local, free. The IP is used here and
    // discarded — never stored, never logged (CLAUDE.md: IP for rate
    // limiting only).
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const { perKey, perIp } = getLimiters();
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
        // The quiet refusal past the daily ceiling (T08 1b): no real
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

  // Where the reader was looking — resolved server-side from the map view,
  // the same approximate-location basis as the search log. Optional: a
  // reaction with no resolvable view stores with no divisions rather than
  // guessed ones.
  const lat = Number(submission.lat);
  const lng = Number(submission.lng);
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

  try {
    const stored = await writeReaction({
      targetType: submission.targetType,
      targetId: submission.targetId,
      reaction: submission.reaction,
      reactionKey: submission.reactionKey,
      ocdIds,
      suspectReason,
    });
    return new Response(null, { status: stored ? 204 : 202 });
  } catch (error) {
    console.error("reaction write failed", error);
    return Response.json({ error: "could not store the reaction" }, { status: 500 });
  }
}
