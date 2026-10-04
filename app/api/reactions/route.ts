import { measureRecordsForBallot } from "@/lib/ballot/measure-records";
import { ballotSourceForTargetId } from "@/lib/ballot/registry";
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
  type ReactionTargetType,
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
import type { StateCampaignFinanceJurisdiction } from "@/lib/funding/data-plane";
import { settleStateMoneyRead, stateMoneyForTarget } from "@/lib/funding/state-snapshot";
import { FEDERAL_CONTEST, directFundingTargetPlan } from "@/lib/funding/target-authorities";

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

const MAX_BODY_BYTES = 4096;

interface ReactionAuthorityReaders {
  readonly candidateTargets: (targetId: string) => Promise<Set<string>>;
  readonly provisionTargets: (targetId: string) => Set<string> | Promise<Set<string>>;
  readonly refreshFunding: () => Promise<unknown>;
  readonly fundingTargets: () => Set<string>;
  readonly refreshStateMoney: (state: StateCampaignFinanceJurisdiction) => Promise<unknown>;
  readonly stateMoneyTargets: (targetId: string) => Set<string>;
  readonly contributorTargets: () => Set<string>;
  readonly refreshVotes: () => Promise<unknown>;
  readonly voteTargets: () => Set<string>;
}

const reactionAuthorityReaders: ReactionAuthorityReaders = {
  candidateTargets: getCandidateTargetIds,
  provisionTargets: async (targetId) => {
    const authority = ballotSourceForTargetId(targetId);
    if (!authority) return new Set();
    const ballot = authority.source.normalize(await authority.source.fetch());
    return getProvisionTargetIds(measureRecordsForBallot(ballot));
  },
  refreshFunding: refreshFundingFromPromoted,
  fundingTargets: getFundingTargetIds,
  refreshStateMoney: (state) => settleStateMoneyRead(state),
  stateMoneyTargets: (targetId) =>
    stateMoneyForTarget(targetId).some(
      (r) => r.filingState === "FILED" || r.filingState === "REGISTERED_NO_ACTIVITY_REPORTED",
    )
      ? new Set([targetId])
      : new Set(),
  contributorTargets: getContributorReactionTargetIds,
  refreshVotes: refreshFederalVotesFromPromoted,
  voteTargets: getVoteIds,
};

/**
 * Open only the authority named by the validated target class. Intake for a
 * candidate must not depend on FEC or roll-call availability, and the two
 * latter authorities must not become one all-or-nothing preload domain.
 */
export async function validReactionTargetsFor(
  targetType: ReactionTargetType,
  targetId: string,
  readers: ReactionAuthorityReaders = reactionAuthorityReaders,
): Promise<Set<string>> {
  switch (targetType) {
    case "CANDIDATE":
      return readers.candidateTargets(targetId);
    case "MEASURE_PROVISION":
      return readers.provisionTargets(targetId);
    case "FUNDING_TOTAL_REACTION": {
      // A state or local candidacy key (`ballot-xx-...`) is valid when that
      // state's promoted money holds a committee for it; anything else is an
      // FEC candidate id, as before.
      const state = directFundingTargetPlan(targetId).state;
      if (state !== null && !FEDERAL_CONTEST.test(targetId)) {
        await readers.refreshStateMoney(state);
        return readers.stateMoneyTargets(targetId);
      }
      await readers.refreshFunding();
      return readers.fundingTargets();
    }
    case "CONTRIBUTOR_REACTION":
      await readers.refreshFunding();
      return readers.contributorTargets();
    case "FEDERAL_VOTE":
      await readers.refreshVotes();
      return readers.voteTargets();
  }
}

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
    /** The optional verbatim (P03). Absent is the ordinary case. */
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
  // The verbatim's SHAPE is checked here and always — validation is never
  // behind any flag (CLAUDE.md, the collection-stores rule). Whether the
  // text is CAPTURED is the ripcord's business, further down.
  if (!isValidFreeText(submission.text)) {
    return Response.json({ error: "malformed text" }, { status: 400 });
  }

  // The target must exist in the canonical data for its type — votes in
  // the promoted vote projection, candidates in the ballot projection (3d), funding
  // reactions in the FEC projection (D34). An unavailable authority fails closed —
  // better to refuse a reaction than to store one against a target nothing
  // can render. The CONTRIBUTOR_REACTION set is empty while
  // ripcord.fecContributorDisplay is pulled, so the control's write path
  // dies with its display — a ripcord that only hid pixels would not be
  // a ripcord.
  let validTargets: Set<string>;
  try {
    validTargets = await validReactionTargetsFor(
      submission.targetType,
      submission.targetId,
    );
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
  // The scale gate (2026-08-15), and it runs in BOTH directions: a
  // five-point funding answer is refused on a vote, AND yes/no/unsure is
  // refused on a funding target. The second direction is what keeps the
  // scale break clean — a stale client writing v1 answers into a v2 column
  // would blend two instruments, which is the whole thing scale versioning
  // exists to stop. The server decides what question was asked; the row's
  // scaleVersion is derived from the target type, never sent.
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
      uncontested = await getSingleCandidateTargetIds(submission.targetId);
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
  /*
   * ITEM 1b (2026-08-17), hardened rather than fixed — this route was audited
   * and found NOT to manufacture a claim, but it carries the same shape and
   * the shape is the defect.
   *
   * `Number(null)` is 0, so a body sending `{lat: null, lng: null}` passed
   * every finite-and-in-range guard below and resolved coverage at 0°N 0°E.
   * It happened to be harmless — the Gulf of Guinea has no divisions, so
   * `ocdIds` came back empty, which is the same answer as "no resolvable
   * view". Harmless by luck is not the standard: the guard now requires an
   * actual number on the wire, so a null is absent rather than the equator.
   */
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

  // Everything a reader types is captured (Sean, October 1, 2026); the verbatim
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
      // Item 0D: the declaration is required by `writeReaction`, and this is
      // the one place a reaction row learns whose traffic it is. An absent
      // header resolves to ORGANIC here — a real browser is still a reader,
      // decided in a function that can be read rather than by a default
      // sitting in a column definition where nobody looks.
      marker: markerFromRequest(request),
    });
    return new Response(null, { status: stored ? 204 : 202 });
  } catch (error) {
    /*
     * **RULING 25 — UNCHANGED FOR THE READER** (Prompt D item 6, D73). The
     * 500 and its body are exactly what shipped before; a visitor sees no
     * difference. `raiseWriteAlarm` is the second path, and it never throws,
     * so it cannot turn a stored-reaction failure into a worse one.
     */
    console.error("reaction write failed", error);
    await raiseWriteAlarm("reactions", error);
    return Response.json({ error: "could not store the reaction" }, { status: 500 });
  }
}
