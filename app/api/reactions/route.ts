import { writeReaction } from "@/lib/db/reactions";
import { coverageAt } from "@/lib/registry/server";
import { SlidingWindowLimiter } from "@/lib/signal/rate-limit";
import {
  isPlausibleTargetId,
  isValidReactionKey,
  isValidReactionValue,
  isValidTargetType,
} from "@/lib/signal/reactions";
import { getVoteIds } from "@/lib/votes/snapshot";

/**
 * POST /api/reactions — the reaction write path (P03).
 *
 * Validation fails closed: an unknown enum value, an invented target id, an
 * oversized payload, a malformed key — all 400, nothing stored, nothing
 * coerced. The target id must name a roll call in the committed votes
 * snapshot; the surface only renders reactions on real votes, so anything
 * else is a client bug or a probe.
 *
 * Rate limiting is demo-grade by decision (state.md §13): per-key and
 * per-IP sliding windows, instance-local. The IP is read for limiting only
 * — it appears in no log line, no row, no error message. The full T03
 * hardening pass is tracked as a launch gate (T08).
 *
 * Like /api/log: no cookie read, no identity accepted, and a missing
 * database is a 202 (accepted, not stored) so the demo without a
 * DATABASE_URL still behaves honestly.
 */

export const runtime = "nodejs";

/** Generous for humans, hostile to loops: a person changes their mind, a script hammers. */
const perKeyLimiter = new SlidingWindowLimiter(15, 60_000);
const perIpLimiter = new SlidingWindowLimiter(60, 60_000);

const MAX_BODY_BYTES = 4096;

export async function POST(request: Request) {
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

  // The target must be a vote that exists in the committed snapshot. A
  // missing snapshot fails closed — better to refuse a reaction than to
  // store one against a target nothing can render.
  let validTargets: Set<string>;
  try {
    validTargets = getVoteIds();
  } catch {
    return Response.json({ error: "votes snapshot unavailable" }, { status: 503 });
  }
  if (!validTargets.has(submission.targetId)) {
    return Response.json({ error: "unknown targetId" }, { status: 400 });
  }

  // Rate limits, cheapest first. The IP is used here and discarded —
  // never stored, never logged (CLAUDE.md: IP for rate limiting only).
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (
    !perKeyLimiter.allow(`k:${submission.reactionKey}`) ||
    !perIpLimiter.allow(`ip:${ip}`)
  ) {
    return new Response(null, { status: 429, headers: { "Retry-After": "60" } });
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
    });
    return new Response(null, { status: stored ? 204 : 202 });
  } catch (error) {
    console.error("reaction write failed", error);
    return Response.json({ error: "could not store the reaction" }, { status: 500 });
  }
}
