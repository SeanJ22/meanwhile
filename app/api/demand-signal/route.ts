import { withReaderFeatures } from "@/lib/civic-data/reader-feature-context.ts";
import { writeDemandSignal } from "@/lib/db/demand-signal";
import { raiseWriteAlarm } from "@/lib/db/write-alarm";
import { markerFromRequest } from "@/lib/db/run-marker";
import { coverageAt } from "@/lib/registry/server";
import { ripcordPulled } from "@/lib/ripcords";
import { isSameOriginSubmission } from "@/lib/signal/intake-limits";
import { intakeWindows } from "@/lib/db/intake-windows";
import {
  DEMAND_SIGNALS,
  DEMAND_SUBJECT_TYPES,
  type DemandSignal,
  type DemandSubjectType,
} from "@/lib/db/demand-signal";
import { getCandidateTargetIds } from "@/lib/ballot/candidate-targets";
import { knownBodySubjectIds } from "@/lib/registry/server";

/**
 * ```
 *   subjectType   BODY | CANDIDATE
 *   subjectId     must exist in its canonical production authority
 *   signal        WANT_THIS_SOONER
 *   lat / lng     optional, approximate location only
 * ```
 *
 * Anything else is a 400. There is no text field, no continuity key and no GET: results are never shown
 * to readers. Defended by same-origin and the per-IP window only.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Small by construction: four short fields and no prose. */
const MAX_BODY_BYTES = 2_000;

function isSubjectType(value: unknown): value is DemandSubjectType {
  return (
    typeof value === "string" && (DEMAND_SUBJECT_TYPES as readonly string[]).includes(value)
  );
}

function isSignal(value: unknown): value is DemandSignal {
  return typeof value === "string" && (DEMAND_SIGNALS as readonly string[]).includes(value);
}

/** The same shape rule the reaction route applies to a target id. */
function isPlausibleSubjectId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 200;
}

async function postWithSettings(request: Request) {
  /*
   * The demand pill rides the reaction intake ripcord. It is a reader write on
   * a reader surface, and a ripcord that closed reaction capture while leaving
   * another write path open would not be a ripcord.
   */
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
    subjectType?: unknown;
    subjectId?: unknown;
    signal?: unknown;
    lat?: unknown;
    lng?: unknown;
  };

  if (!isSubjectType(submission.subjectType)) {
    return Response.json({ error: "unknown subjectType" }, { status: 400 });
  }
  if (!isSignal(submission.signal)) {
    return Response.json({ error: "unknown signal" }, { status: 400 });
  }
  if (!isPlausibleSubjectId(submission.subjectId)) {
    return Response.json({ error: "malformed subjectId" }, { status: 400 });
  }

  /*
   * The subject must exist in its canonical production authority. A missing store
   * fails CLOSED — better to refuse a signal than to store one against a
   * subject nothing can render, which is a row no operational reader can act
   * on and therefore a row that is worse than absent.
   */
  let known: Set<string>;
  try {
    known =
      submission.subjectType === "CANDIDATE"
        ? await getCandidateTargetIds(submission.subjectId)
        : await knownBodySubjectIds(submission.subjectId);
  } catch {
    return Response.json({ error: "subject data unavailable" }, { status: 503 });
  }
  if (!known.has(submission.subjectId)) {
    return Response.json({ error: "unknown subjectId" }, { status: 400 });
  }

  if (!ripcordPulled("ripcord.rateLimits")) {
    if (!isSameOriginSubmission(request)) {
      return Response.json(
        { error: "cross-origin submissions are not accepted" },
        { status: 403 },
      );
    }
    // The IP is used here and discarded — never stored, never logged.
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const { perIp } = intakeWindows("demand-signal");
    if (!perIp.allow(`ip:${ip}`)) {
      return new Response(null, { status: 429, headers: { "Retry-After": "60" } });
    }
  }

  /*
   * Where the reader was looking, resolved server-side from the map view, never an address. A `null` on the
   * wire is absent, not the equator: `Number(null)` is 0.
   */
  const lat = typeof submission.lat === "number" ? submission.lat : Number.NaN;
  const lng = typeof submission.lng === "number" ? submission.lng : Number.NaN;
  let ocdIds: string[] = [];
  if (
    Number.isFinite(lat) &&
    lat >= -90 &&
    lat <= 90 &&
    Number.isFinite(lng) &&
    lng >= -180 &&
    lng <= 180
  ) {
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
    const stored = await writeDemandSignal({
      subjectType: submission.subjectType,
      subjectId: submission.subjectId,
      signal: submission.signal,
      ocdIds,
      marker: markerFromRequest(request),
    });
    if (stored) return new Response(null, { status: 204 });
    await raiseWriteAlarm("demand_signals", new Error("Demand signal store is unavailable"));
    return Response.json({ error: "could not store the signal" }, { status: 503 });
  } catch (error) {
    await raiseWriteAlarm("demand_signals", error);
    return Response.json({ error: "could not store the signal" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  return withReaderFeatures(() => postWithSettings(request));
}
