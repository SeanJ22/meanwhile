import { loadWebsiteSavedKeys } from "../../../lib/core/keys-entry.ts";
import { readerRoute } from "@/lib/api/reader-route";
import { ballotPlaceFromRequest } from "@/lib/ballot/reader-place";
import { withReaderFeatures } from "@/lib/civic-data/reader-feature-context.ts";
import { writeDemandSignal } from "@/lib/db/demand-signal";
import { requestWorkSooner } from "@/lib/db/demand-work";
import { afterResponse } from "@/lib/log/after-response";
import { errorCodeOf, raiseWriteAlarm } from "@/lib/db/write-alarm";
import { markerFromRequest } from "@/lib/db/run-marker";
import { currentReaderSelection } from "@/lib/db/reader-route";
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


  let known: Set<string>;
  try {
    known =
      submission.subjectType === "CANDIDATE"
        ? await getCandidateTargetIds(await ballotPlaceFromRequest(request), submission.subjectId)
        : await knownBodySubjectIds(submission.subjectId);
  } catch (error) {
    console.error("Demand subject lookup failed", { requestId: request.headers.get("x-nf-request-id"),
      subjectType: submission.subjectType, code: errorCodeOf(error), name: error instanceof Error ? error.name : "Error" });
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
    // readerRoute already resolved this exact point. Recording the tap does
    // not need to load its officials, calendars and ballots a second time.
    ocdIds = [...currentReaderSelection()?.divisions ?? []];
  }

  try {
    const marker = markerFromRequest(request);
    const stored = await writeDemandSignal({
      subjectType: submission.subjectType,
      subjectId: submission.subjectId,
      signal: submission.signal,
      ocdIds,
      marker,
    });
    // The reader is not kept waiting for the work list. The tap is already counted, and a failure to list it is logged.
    if (stored) {
      const subjectType = submission.subjectType, subjectId = submission.subjectId;
      await afterResponse(() => requestWorkSooner({ subjectType, subjectId, ocdIds, marker }).catch(error => {
        console.error("demand request was not put in the work list", { code: errorCodeOf(error), name: error instanceof Error ? error.name : "Error" });
      }));
    }

    return new Response(null, { status: stored ? 204 : 202 });
  } catch (error) {
    console.error("demand signal write failed", error);
    await raiseWriteAlarm("demand_signals", error);
    return Response.json({ error: "could not store the signal" }, { status: 500 });
  }
}

export const POST = readerRoute("/api/demand-signal", async function POST(request: Request) {
  await loadWebsiteSavedKeys();
  return withReaderFeatures(() => postWithSettings(request));
});
