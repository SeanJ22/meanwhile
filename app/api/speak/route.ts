import { readerRoute } from "@/lib/api/reader-route";
import { withReaderFeatures } from "@/lib/civic-data/reader-feature-context.ts";
import { writeSpeakYourMind, SPEAK_MAX_CHARS } from "@/lib/db/speak";
import { raiseWriteAlarm } from "@/lib/db/write-alarm";
import { noteSubmission } from "@/lib/db/intake-limiter";
import { markerFromRequest } from "@/lib/db/run-marker";
import { DIVISION_VINTAGE } from "@/lib/db/search-log";
import { coverageAt } from "@/lib/registry/server";
import { ripcordPulled } from "@/lib/ripcords";
import {
  classifySubmission,
  isSameOriginSubmission,
} from "@/lib/signal/intake-limits";
import { intakeWindows } from "@/lib/db/intake-windows";
import { isPlausibleTargetId, isValidReactionKey } from "@/lib/signal/reactions";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 8192;
const SUBJECT_TYPES = new Set(["OFFICIAL", "BODY", "MEETING", "CANDIDATE"]);

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
    text?: unknown;
    speakKey?: unknown;
    lat?: unknown;
    lng?: unknown;
  };

  if (typeof submission.subjectType !== "string" || !SUBJECT_TYPES.has(submission.subjectType)) {
    return Response.json({ error: "unknown subjectType" }, { status: 400 });
  }
  if (!isPlausibleTargetId(submission.subjectId)) {
    return Response.json({ error: "malformed subjectId" }, { status: 400 });
  }
  // The continuity key's shape is the reactions store's, deliberately — one
  // definition of "a browser-minted key" rather than two that drift.
  if (!isValidReactionKey(submission.speakKey)) {
    return Response.json({ error: "malformed speakKey" }, { status: 400 });
  }
  const text = typeof submission.text === "string" ? submission.text.trim() : "";
  if (!text) {
    return Response.json({ error: "nothing to record" }, { status: 400 });
  }
  if (text.length > SPEAK_MAX_CHARS) {
    return Response.json({ error: "text too long" }, { status: 400 });
  }

  let suspectReason: "VELOCITY" | "LIMITER_UNAVAILABLE" | null = null;
  if (!ripcordPulled("ripcord.rateLimits")) {
    if (!isSameOriginSubmission(request)) {
      return Response.json(
        { error: "cross-origin submissions are not accepted" },
        { status: 403 },
      );
    }
    // The IP is used here and discarded — never stored, never logged.
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const { perKey, perIp } = intakeWindows("speak");
    if (!perKey.allow(`k:${submission.speakKey}`) || !perIp.allow(`ip:${ip}`)) {
      return new Response(null, { status: 429, headers: { "Retry-After": "60" } });
    }
    const counters = await noteSubmission(submission.speakKey);
    if (counters === null) {
      suspectReason = "LIMITER_UNAVAILABLE";
    } else {
      const disposition = classifySubmission(counters);
      if (disposition.kind === "REFUSE_DAILY") {
        return new Response(null, { status: 429, headers: { "Retry-After": "86400" } });
      }
      if (disposition.kind === "REFUSE_RATE") {
        return new Response(null, { status: 429, headers: { "Retry-After": "60" } });
      }
      if (disposition.kind === "QUARANTINE") {
        suspectReason = disposition.reason;
      }
    }
  }

  /* Resolved server-side from the map view; no resolvable view stores no divisions. `Number(null)` is 0, so the guard requires an actual number. */
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
    const stored = await writeSpeakYourMind({
      subjectType: submission.subjectType as "OFFICIAL" | "BODY" | "MEETING" | "CANDIDATE",
      subjectId: submission.subjectId,
      ocdIds,
      divisionVintage: DIVISION_VINTAGE,
      text,
      continuityKey: submission.speakKey,
      suspectReason,
      marker: markerFromRequest(request),
    });
    if (stored.kind === "FAILED") {
      await raiseWriteAlarm("speak_your_mind", new Error(stored.reason));
      return Response.json({ error: "could not record that" }, { status: 500 });
    }
    if (stored.kind === "NO_STORE") {
      await raiseWriteAlarm("speak_your_mind", new Error("Speak your mind store is unavailable"));
      return new Response(null, { status: 202 });
    }
    /* A held row is still a 204 and the reader is not told it was held: telling them would show a prober where the line sits. */
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("speak-your-mind write failed", error);
    await raiseWriteAlarm("speak_your_mind", error);
    return Response.json({ error: "could not record that" }, { status: 500 });
  }
}

export const POST = readerRoute("/api/speak", async function POST(request: Request) {
  return withReaderFeatures(() => postWithSettings(request));
});
