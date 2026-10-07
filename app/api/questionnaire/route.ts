import { digestToken, verifyToken, tokenRefusalLine } from "@/lib/questionnaire/auth";
import {
  INSTRUMENT_VERSION,
  WORD_LIMIT,
  checkWordLimit,
  questionsFor,
  type OfficeClass,
} from "@/lib/questionnaire/instrument";
import { OFFICE_CLASSES } from "@/lib/questionnaire/instrument";
import { findInvitation, findToken, storeResponse } from "@/lib/db/questionnaire";

/**
 * POST /api/questionnaire: a candidate submits their own words. Nothing here sends email.
 *
 * 1. Nothing is ever truncated: an over-limit answer is refused with its word count and the limit.
 * 2. Answers publish verbatim: nothing here summarises, paraphrases or rates.
 * 3. The instrument version comes from the invitation, never from the current constant.
 *
 * Only `sha256(token)` is kept. A bad, expired or used link, an over-limit answer and an unreachable store
 * each get their own answer.
 */
export const runtime = "nodejs";

interface SubmissionBody {
  token?: unknown;
  answers?: unknown;
}

/** The largest submission worth reading at all. Generous: 21 questions × 150 words. */
const MAX_BODY_BYTES = 200_000;

function isAnswerArray(v: unknown): v is { questionId: string; text: string }[] {
  return (
    Array.isArray(v) &&
    v.every(
      (a) =>
        typeof a === "object" &&
        a !== null &&
        typeof (a as { questionId?: unknown }).questionId === "string" &&
        typeof (a as { text?: unknown }).text === "string",
    )
  );
}

export async function POST(request: Request): Promise<Response> {
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return Response.json(
      { ok: false, reason: "TOO_LARGE", message: "That submission is larger than this form accepts." },
      { status: 413 },
    );
  }

  let body: SubmissionBody;
  try {
    body = JSON.parse(raw) as SubmissionBody;
  } catch {
    return Response.json(
      {
        ok: false,
        reason: "MALFORMED",
        message: "We could not read that submission. Nothing has been saved.",
      },
      { status: 400 },
    );
  }

  const token = typeof body.token === "string" ? body.token : "";
  if (token.length === 0 || !isAnswerArray(body.answers)) {
    return Response.json(
      {
        ok: false,
        reason: "MALFORMED",
        message: "That submission was missing its link or its answers. Nothing has been saved.",
      },
      { status: 400 },
    );
  }
  const answers = body.answers;

  const lookup = await findToken(digestToken(token));
  if (lookup.kind === "STORE_UNAVAILABLE") {
    // Never "your link is invalid" — that is a claim about the candidate's
    // link, and what actually happened is a fact about us.
    return Response.json(
      {
        ok: false,
        reason: "STORE_UNAVAILABLE",
        message:
          "We could not reach our own records just now, so nothing was saved. " +
          "Your answers are still in the form — please try again in a minute.",
      },
      { status: 503 },
    );
  }

  const verdict = verifyToken({
    token,
    record: lookup.kind === "FOUND" ? lookup.record : null,
    now: new Date(),
  });
  if (!verdict.ok) {
    return Response.json(
      { ok: false, reason: verdict.reason, message: tokenRefusalLine(verdict.reason) },
      { status: 403 },
    );
  }

  const invitation = await findInvitation(verdict.candidacyId);
  if (invitation.kind === "STORE_UNAVAILABLE") {
    return Response.json(
      { ok: false, reason: "STORE_UNAVAILABLE", message: "We could not reach our own records just now." },
      { status: 503 },
    );
  }
  if (invitation.kind === "NOT_FOUND") {
    return Response.json(
      {
        ok: false,
        reason: "NO_INVITATION",
        message:
          "This link works, but we have no questionnaire on file for it. " +
          "Reply to the email we sent and we will sort it out.",
      },
      { status: 409 },
    );
  }

  const officeClass = (OFFICE_CLASSES as readonly string[]).includes(invitation.officeClass)
    ? (invitation.officeClass as OfficeClass)
    : null;
  if (!officeClass) {
    return Response.json(
      {
        ok: false,
        reason: "NO_INVITATION",
        message:
          "This link works, but we have not settled which questions belong to this office yet. " +
          "Reply to the email we sent and we will sort it out.",
      },
      { status: 409 },
    );
  }

  const asked = questionsFor(officeClass);
  const askedIds = new Set(asked.map((q) => q.id));

  /* Every over-limit answer is collected and all of them are returned together. */
  const overLimit: { questionId: string; words: number; limit: number }[] = [];
  const unknown: string[] = [];
  for (const a of answers) {
    if (!askedIds.has(a.questionId)) {
      unknown.push(a.questionId);
      continue;
    }
    const v = checkWordLimit(a.text);
    if (!v.withinLimit) {
      overLimit.push({ questionId: a.questionId, words: v.words, limit: WORD_LIMIT });
    }
  }

  if (unknown.length > 0) {
    return Response.json(
      {
        ok: false,
        reason: "UNKNOWN_QUESTION",
        questionIds: unknown,
        message:
          "That submission carried an answer to a question we did not ask. Nothing has been saved.",
      },
      { status: 400 },
    );
  }

  if (overLimit.length > 0) {
    return Response.json(
      {
        ok: false,
        reason: "OVER_LIMIT",
        overLimit,
        message:
          overLimit.length === 1
            ? `One answer is over the ${WORD_LIMIT}-word limit. Nothing has been saved and nothing has been cut — ` +
              "please shorten it and send again."
            : `${overLimit.length} answers are over the ${WORD_LIMIT}-word limit. Nothing has been saved and ` +
              "nothing has been cut — please shorten them and send again.",
      },
      { status: 422 },
    );
  }

  const stored = await storeResponse({
    candidacyId: verdict.candidacyId,
    tokenDigest: digestToken(token),
    officeClass,
    // From the INVITATION, never from the current constant. See the header.
    instrumentVersion: invitation.instrumentVersion || INSTRUMENT_VERSION,
    answers: answers.map((a) => ({ questionId: a.questionId, text: a.text })),
    submittedAt: new Date(),
  });

  if (stored.kind !== "STORED") {
    return Response.json(
      {
        ok: false,
        reason: stored.kind,
        message:
          "We could not save your answers just now, so nothing was recorded. " +
          "Your answers are still in the form — please try again in a minute.",
      },
      { status: 503 },
    );
  }

  return Response.json({
    ok: true,
    version: stored.version,
    message:
      "Your answers are in. They will publish exactly as you wrote them, word for word, " +
      "with nothing summarised, shortened or edited.",
  });
}
