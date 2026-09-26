import type { AskClassifyReply } from "@/lib/ask/answer";
import { classifyQuestion } from "@/lib/routing/classifier";
import { ripcordPulled } from "@/lib/ripcords";
import { intakeLimits, isSameOriginSubmission } from "@/lib/signal/intake-limits";
import { SlidingWindowLimiter } from "@/lib/signal/rate-limit";

/**
 * POST /api/ask/classify — the Level 1 rung of the ask box (6d).
 *
 * The client calls this ONLY when the on-device keyword matcher refused. It
 * answers with one curated topic id, or nothing. It never answers the
 * reader's question: the sentences the reader sees are assembled on the
 * client from the same curated route the keyword path produces, from the
 * same registry and the same sourced people.
 *
 * What this route does not do, deliberately:
 *
 * - **It stores nothing.** No row, no log line, no device key, no IP kept.
 *   The ask box's own logging is unchanged and still runs on the client:
 *   a routed ask logs its topic id, a refusal logs the capped question. A
 *   question classified here logs its topic id like any other routed ask —
 *   the classifier changes which topic is found, never what is recorded.
 * - **It is not an intake path.** The n-stores rule is not in play because
 *   there is no store; there is nothing here to join to anything.
 *
 * Same posture as the other POST routes: same-origin, a per-IP window whose
 * IP lives only in this instance's memory for the window, a body cap, and
 * `ripcord.askClassifier` above all of it.
 */

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
