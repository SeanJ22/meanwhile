import { withPublishedAskSettings } from "@/lib/ask/runtime-settings.ts";
import type { AskClassifyReply } from "@/lib/ask/answer";
import { classifyQuestion } from "@/lib/routing/classifier";
import { ripcordPulled } from "@/lib/ripcords";
import { intakeLimits, isSameOriginSubmission } from "@/lib/signal/intake-limits";
import { SlidingWindowLimiter } from "@/lib/signal/rate-limit";

/** Called only when the on-device keyword matcher refused. Answers with one curated topic id or nothing, never the reader's question. Stores nothing. */

export const runtime = "nodejs";

const MAX_BODY_BYTES = 2048;
const MAX_QUESTION_CHARS = 200;

let ipLimiter: SlidingWindowLimiter | null = null;
function getIpLimiter() {
  ipLimiter ??= new SlidingWindowLimiter(
    intakeLimits().logEventsPerIpPerMinute,
    60_000,
  );
  return ipLimiter;
}

export async function POST(request: Request) {
  return withPublishedAskSettings(() => answerWithSettings(request));
}

async function answerWithSettings(request: Request) {
  // The rung's own switch. Pulled, the ask box is keyword-only — which is
  // the whole product it shipped as.
  if (ripcordPulled("ripcord.askClassifier")) {
    const off: AskClassifyReply = { topic: null, why: "off" };
    return Response.json(off, { status: 200 });
  }

  if (!ripcordPulled("ripcord.rateLimits")) {
    if (!isSameOriginSubmission(request)) {
      return Response.json(
        { error: "cross-origin submissions are not accepted" },
        { status: 403 },
      );
    }
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    if (!getIpLimiter().allow(`classify:${ip}`)) {
      return new Response(null, { status: 429, headers: { "Retry-After": "60" } });
    }
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return Response.json({ error: "body too large" }, { status: 413 });
  }

  let body: { question?: unknown };
  try {
    body = JSON.parse(raw) as { question?: unknown };
  } catch {
    return Response.json({ error: "malformed body" }, { status: 400 });
  }
  if (typeof body.question !== "string" || body.question.trim().length === 0) {
    return Response.json({ error: "question is required" }, { status: 400 });
  }

  const outcome = await classifyQuestion(
    body.question.slice(0, MAX_QUESTION_CHARS),
  );

  // Every not-a-topic answer is the same to the reader: the honest keyword
  // refusal the box would have shown anyway. `why` is for the operator.
  const reply: AskClassifyReply =
    outcome.kind === "TOPIC"
      ? { topic: outcome.topicId }
      : { topic: null, why: outcome.kind === "UNAVAILABLE" ? outcome.why : "none" };
  /* Operators only: which model labelled it, and which model the API says served it. */
  if (outcome.kind !== "UNAVAILABLE" && outcome.model) {
    reply.model = outcome.model;
    reply.servedModel = outcome.servedModel ?? null;
  }
  return Response.json(reply, { status: 200 });
}
