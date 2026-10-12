import { settlePositionHoldingAnswer } from "./holdings";

/**
 * GET /api/positions/<subject>/<topic>
 *
 * Subject and topic are path segments because both vary the body and every cache keys on the path; the
 * response is also `no-store`. Returns the corpus's own words with URL and read date, or a named gap. No model.
 */

export const runtime = "nodejs";

/** A topic longer than this is not a topic. The cap is stated, not implied. */
const MAX_TOPIC_CHARS = 120;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ subject: string; topic: string }> },
) {
  const { subject: rawSubject, topic: rawTopic } = await params;
  const subject = decodeURIComponent(rawSubject);
  const topic = decodeURIComponent(rawTopic).slice(0, MAX_TOPIC_CHARS);

  if (!subject || !topic.trim()) {
    return Response.json({ error: "subject and topic are required" }, { status: 400 });
  }

  const settled = await settlePositionHoldingAnswer(subject, topic);
  if (settled.kind === "IDENTITY_UNRESOLVED") {
    return Response.json({ error: settled.error.message, holdingStatus: "IDENTITY_UNRESOLVED" }, { status: 409 });
  }
  if (settled.kind === "HOLDING_UNAVAILABLE") {
    return Response.json({ error: "the statement corpus could not be read", holdingStatus: "HOLDING_UNAVAILABLE", unavailableAuthorities: settled.unavailableAuthorities }, { status: 503 });
  }
  const { answer } = settled;

  return Response.json(
    {
      ...answer,
      holdingStatus: settled.holdingStatus,
      unavailableAuthorities: settled.unavailableAuthorities,
      // Stated N equals rendered rows, and the denominator rides with it.
      totalMatches: answer.passages.length,
    },
    {
      status: 200,
      headers: {
        // Varies by two path inputs and is cheap to recompute; nothing here
        // is worth a shared cache getting subtly wrong.
        "Cache-Control": "private, no-store",
      },
    },
  );
}
