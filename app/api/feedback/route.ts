import { writeFeedback } from "@/lib/db/feedback";
import {
  FEEDBACK_MAX_CHARS,
  REPLY_TO_MAX_CHARS,
  isFeedbackSurface,
  isReplyToShaped,
} from "@/lib/feedback/shape";
import { noteSubmission } from "@/lib/db/intake-limiter";
import { markerFromRequest } from "@/lib/db/run-marker";
import {
  classifyFeedbackSubmission,
  isSameOriginSubmission,
} from "@/lib/signal/intake-limits";
import { intakeWindows } from "@/lib/db/intake-windows";

/**
 * POST /api/feedback. A submission never silently succeeds:
 *
 * - `204`: stored. The only response the form may thank anyone for.
 * - `503` with `{ stored: false }`: no store configured.
 * - `500` with `{ stored: false }`: the write was attempted and failed.
 * - `400` / `413`: empty, oversized, or not one of our surfaces.
 * - `403` / `429`: refused by the intake protections.
 *
 * The counter key (`wtp.feedback_key`) is minted by the browser and never stored; the row has no key column.
 */

export const runtime = "nodejs";


/** 2000 chars of text, plus the small envelope around it. */
const MAX_BODY_BYTES = 8192;

export async function POST(request: Request) {
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return Response.json(
      { stored: false, error: "That message is longer than we can accept." },
      { status: 413 },
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ stored: false, error: "Malformed request." }, { status: 400 });
  }

  const submission = body as {
    message?: unknown;
    surface?: unknown;
    replyTo?: unknown;
    feedbackKey?: unknown;
    about?: unknown;
    zip?: unknown;
    recordId?: unknown;
  };

  if (typeof submission.message !== "string" || !submission.message.trim()) {
    return Response.json(
      { stored: false, error: "There was nothing in the message." },
      { status: 400 },
    );
  }
  if (submission.message.length > FEEDBACK_MAX_CHARS) {
    return Response.json(
      { stored: false, error: "That message is longer than we can accept." },
      { status: 413 },
    );
  }
  if (!isFeedbackSurface(submission.surface)) {
    return Response.json({ stored: false, error: "Unknown surface." }, { status: 400 });
  }
  for (const [key, cap] of [["about", 80], ["zip", 5], ["recordId", 200]] as const) {
    const value = submission[key];
    if (value != null && (typeof value !== "string" || value.length > cap ||
      (key === "zip" && !/^\d{5}$/.test(value)))) {
      return Response.json({ stored: false, error: "Invalid report context." }, { status: 400 });
    }
  }
  /*
   * The optional reply address: absent, null and empty are all ordinary. A present value must be shaped like
   * an address and within the cap, or it is a 400.
   */
  if (
    submission.replyTo !== undefined &&
    submission.replyTo !== null &&
    typeof submission.replyTo !== "string"
  ) {
    return Response.json({ stored: false, error: "Malformed request." }, { status: 400 });
  }
  const replyTo = typeof submission.replyTo === "string" ? submission.replyTo.trim() : "";
  if (replyTo.length > REPLY_TO_MAX_CHARS) {
    return Response.json(
      { stored: false, error: "That reply address is longer than we can accept." },
      { status: 400 },
    );
  }
  if (!isReplyToShaped(replyTo)) {
    return Response.json(
      {
        stored: false,
        error:
          "That does not look like an email address. Leave it blank if you would rather not hear back.",
      },
      { status: 400 },
    );
  }
  // Validity, never behind a flag: the key is opaque and its only job is to be
  // stable per browser, so the only thing to check is its shape.
  if (
    typeof submission.feedbackKey !== "string" ||
    !/^[A-Za-z0-9_-]{16,64}$/.test(submission.feedbackKey)
  ) {
    return Response.json({ stored: false, error: "Malformed request." }, { status: 400 });
  }

  let suspectReason: "VELOCITY" | "LIMITER_UNAVAILABLE" | null = null;

  if (!isSameOriginSubmission(request)) {
    return Response.json(
      { stored: false, error: "Cross-origin submissions are not accepted." },
      { status: 403 },
    );
  }

  // The IP is read for limiting and discarded — never stored, never logged,
  // never in an error message.
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const { perKey, perIp } = intakeWindows("feedback");
  if (!perKey.allow(`k:${submission.feedbackKey}`) || !perIp.allow(`ip:${ip}`)) {
    return Response.json(
      { stored: false, error: "That is a lot of messages at once. Try again in a minute." },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  // The authoritative cross-instance counter, in the feedback digest space.
  // null means the limit COULD NOT be checked — quarantine, never trust
  // through, and never refuse a reader because our own counter is down.
  const counters = await noteSubmission(submission.feedbackKey, new Date(), "feedback");
  if (counters === null) {
    suspectReason = "LIMITER_UNAVAILABLE";
  } else {
    const disposition = classifyFeedbackSubmission(counters);
    if (disposition.kind === "REFUSE_DAILY") {
      return Response.json(
        {
          stored: false,
          error: "That is a lot of messages today. Try again tomorrow.",
        },
        { status: 429, headers: { "Retry-After": "86400" } },
      );
    }
    if (disposition.kind === "REFUSE_RATE") {
      return Response.json(
        {
          stored: false,
          error: "That is a lot of messages at once. Try again in a minute.",
        },
        { status: 429, headers: { "Retry-After": "60" } },
      );
    }
    if (disposition.kind === "QUARANTINE") suspectReason = disposition.reason;
  }

  let result;
  try {
    result = await writeFeedback({
      message: submission.message,
      surface: submission.surface,
      about: submission.about as string | null | undefined,
      zip: submission.zip as string | null | undefined,
      recordId: submission.recordId as string | null | undefined,
      replyTo,
      suspectReason,
      // An automated run declares itself, so a walk's test submission is
      // never mistaken for a reader's report.
      marker: markerFromRequest(request),
    });
  } catch (error) {
    // The scrub can empty a message that was entirely contact details. That
    // is a 400 the reader can act on, not a server fault — and telling them
    // WHY is the whole point, because otherwise the form would look broken.
    const message = error instanceof Error ? error.message : "";
    if (message.includes("after the scrub")) {
      return Response.json(
        {
          stored: false,
          error:
            "Everything in that message looked like contact details, which we remove before storing. Try describing what is wrong instead.",
        },
        { status: 400 },
      );
    }
    return Response.json({ stored: false, error: "Malformed request." }, { status: 400 });
  }

  if (result.kind === "STORED") return new Response(null, { status: 204 });
  if (result.kind === "NO_STORE") {
    return Response.json(
      {
        stored: false,
        error: "This copy of the site has no store attached, so nothing was kept.",
      },
      { status: 503 },
    );
  }
  return Response.json(
    { stored: false, error: "We could not save that. Nothing was kept." },
    { status: 500 },
  );
}
