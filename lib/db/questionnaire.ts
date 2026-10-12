/**
 * Questionnaire store: reads and writes for the page a candidate types into.
 * A candidate's answer is published civic content, not reader data; nothing
 * here touches `search_log`, `reactions` or `intake_limiter`. Nothing here may
 * summarise, excerpt or truncate an answer. Every function returns a named
 * outcome; an unreachable database is `STORE_UNAVAILABLE`, never "has not
 * responded".
 */
import { and, desc, eq } from "drizzle-orm";

import { getDb } from "./index.ts";
import { questionnaireInvitations, questionnaireResponses, questionnaireTokens } from "./schema.ts";
import { assertWriteAllowed } from "./write-guard.ts";
import type { TokenRecord } from "../questionnaire/auth.ts";
import type { Answer } from "../questionnaire/responses.ts";

/** Looking a token up can fail in a way that is not "no such token". */
export type TokenLookup =
  | { kind: "FOUND"; record: TokenRecord }
  | { kind: "NOT_FOUND" }
  | { kind: "STORE_UNAVAILABLE"; reason: string };

/** Find one token by its digest; the raw token never reaches this module. */
export async function findToken(tokenDigest: string): Promise<TokenLookup> {
  const db = getDb();
  if (!db) return { kind: "STORE_UNAVAILABLE", reason: "no database handle is configured" };
  try {
    const rows = await db
      .select()
      .from(questionnaireTokens)
      .where(eq(questionnaireTokens.tokenDigest, tokenDigest))
      .limit(1);
    const row = rows[0];
    if (!row) return { kind: "NOT_FOUND" };
    return {
      kind: "FOUND",
      record: {
        tokenDigest: row.tokenDigest,
        candidacyId: row.candidacyId,
        issuedAt: row.issuedAt,
        expiresAt: row.expiresAt,
        usedAt: row.usedAt,
      },
    };
  } catch (e) {
    return { kind: "STORE_UNAVAILABLE", reason: (e as Error).message };
  }
}

/** What an invitation says about which questions this candidate is asked. */
export type InvitationLookup =
  | { kind: "FOUND"; officeClass: string; instrumentVersion: string; contestId: string; deadline: string }
  | { kind: "NOT_FOUND" }
  | { kind: "STORE_UNAVAILABLE"; reason: string };

export async function findInvitation(candidacyId: string): Promise<InvitationLookup> {
  const db = getDb();
  if (!db) return { kind: "STORE_UNAVAILABLE", reason: "no database handle is configured" };
  try {
    const rows = await db
      .select()
      .from(questionnaireInvitations)
      .where(eq(questionnaireInvitations.candidacyId, candidacyId))
      .limit(1);
    const row = rows[0];
    if (!row) return { kind: "NOT_FOUND" };
    return {
      kind: "FOUND",
      officeClass: row.officeClass,
      instrumentVersion: row.instrumentVersion,
      contestId: row.contestId,
      deadline: row.deadline,
    };
  } catch (e) {
    return { kind: "STORE_UNAVAILABLE", reason: (e as Error).message };
  }
}

export type SubmitResult =
  | { kind: "STORED"; version: number }
  | { kind: "STORE_UNAVAILABLE"; reason: string }
  | { kind: "REFUSED"; reason: string };

/**
 * Store one submitted version and burn the token in the same batch.
 * Append-only: an edit writes a new row at the next version; the highest
 * version renders.
 */
export async function storeResponse(input: {
  candidacyId: string;
  tokenDigest: string;
  officeClass: string;
  instrumentVersion: string;
  answers: Answer[];
  submittedAt: Date;
}): Promise<SubmitResult> {
  const db = getDb();
  if (!db) return { kind: "STORE_UNAVAILABLE", reason: "no database handle is configured" };

  // The write guard throws; return a named outcome the route can render.
  try {
    assertWriteAllowed("questionnaire_responses");
  } catch (e) {
    return { kind: "REFUSED", reason: (e as Error).message };
  }

  try {
    const prior = await db
      .select({ version: questionnaireResponses.version })
      .from(questionnaireResponses)
      .where(eq(questionnaireResponses.candidacyId, input.candidacyId))
      .orderBy(desc(questionnaireResponses.version))
      .limit(1);
    const version = (prior[0]?.version ?? 0) + 1;

    /*
     * `batch`, not `transaction`: neon-http has no interactive transactions.
     * The server runs the batch as one transaction, so an answer is never
     * stored against a live token and a token is never burnt without an
     * answer. The unique index on `(candidacy_id, version)` makes reading the
     * version outside the batch safe: racing submissions collide and fail.
     */
    await db.batch([
      db.insert(questionnaireResponses).values({
        candidacyId: input.candidacyId,
        version,
        submittedAt: input.submittedAt.toISOString(),
        instrumentVersion: input.instrumentVersion,
        officeClass: input.officeClass,
        // Verbatim. The route enforces the word limit; nothing here shortens.
        answers: input.answers.map((a) => ({ questionId: a.questionId, text: a.text })),
        withdrawnAt: null,
      }),
      db
        .update(questionnaireTokens)
        .set({ usedAt: input.submittedAt.toISOString() })
        .where(
          and(
            eq(questionnaireTokens.tokenDigest, input.tokenDigest),
            eq(questionnaireTokens.candidacyId, input.candidacyId),
          ),
        ),
    ]);

    return { kind: "STORED", version };
  } catch (e) {
    return { kind: "STORE_UNAVAILABLE", reason: (e as Error).message };
  }
}
