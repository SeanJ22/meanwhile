/**
 * **THE QUESTIONNAIRE STORE — reads and writes for the page a candidate types
 * into.** (Overnight depth hunt, 2026-08-23, item 7. `NH104`.)
 *
 * ## Which store this is, and why the n-stores rule is untouched
 *
 * `CLAUDE.md`'s collection-stores rule governs the SOLD stores — the search
 * log, the reactions store, and a future subscription store. Those may share no
 * joinable column and no mapping table exists between any pair.
 *
 * **A candidate's questionnaire answer is not reader data.** It is published
 * civic content, submitted by a public person standing for public office, for
 * the express purpose of being published verbatim under their name. RULING 112
 * says so in as many words and puts it in the content store. Nothing here
 * touches `search_log`, `reactions` or `intake_limiter`, and
 * `tests/questionnaire-store.test.ts` asserts that BY NAME rather than leaving
 * it to be noticed.
 *
 * ## What is deliberately absent
 *
 * There is **no summary, excerpt, abstract, preview or truncation** anywhere in
 * this module, and there never may be. RULING 112 enforces that by ABSENCE —
 * the response record has no such column and no summarising call exists under
 * `lib/questionnaire/`. A reader of this file should find nothing here that
 * could shorten a candidate's words.
 *
 * ## Failure is a state, never a silent pass
 *
 * Every function returns a named outcome rather than throwing into a route that
 * would render an empty page. A database that cannot be reached is
 * `STORE_UNAVAILABLE` — reported as itself, never as "this candidate has not
 * responded", because those are different facts about different people and
 * running them together is the render-default rule's exact failure.
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

/**
 * Find one token by its digest.
 *
 * The caller passes the DIGEST, not the token: hashing happens in
 * `lib/questionnaire/auth.ts` and the raw token never reaches this module, so
 * there is no code path here that could log or store one.
 */
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
 * Store one submitted version, and burn the token in the same transaction.
 *
 * **Append-only.** An edit writes a NEW row at the next version rather than
 * overwriting, for the reason the schema already gives: a record that can be
 * silently rewritten cannot prove what it said. The highest version renders.
 *
 * The token is marked used inside the same transaction as the insert. Doing it
 * outside would allow the two states this must never produce — an answer stored
 * against a token still live, and a burnt token with no answer behind it.
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

  // The write guard THROWS on refusal. Catching it here turns it into a named
  // outcome the route can render, rather than a 500 that tells a candidate
  // nothing about why their answers did not save.
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
     * `batch`, not `transaction`, and the difference is the driver rather than
     * a preference.
     *
     * This app connects over `drizzle-orm/neon-http`, which has no interactive
     * transactions at all — `db.transaction()` throws on it. The first version
     * of this function used one, and every submission came back
     * `STORE_UNAVAILABLE` with the answers correctly NOT stored. It was caught
     * by walking the page against a local production build before shipping,
     * which is the whole of what RULING 77 asks for.
     *
     * `batch` sends both statements in ONE request and the server runs them in
     * a single transaction, so the two states this must never produce still
     * cannot happen: an answer stored against a token still live, or a burnt
     * token with no answer behind it.
     *
     * The version is read first, outside the batch. The unique index on
     * `(candidacy_id, version)` is what makes that safe — two submissions
     * racing to the same version collide at the database rather than
     * overwriting each other, and the loser surfaces here as a failed write
     * rather than as a silently lost answer.
     */
    await db.batch([
      db.insert(questionnaireResponses).values({
        candidacyId: input.candidacyId,
        version,
        submittedAt: input.submittedAt.toISOString(),
        instrumentVersion: input.instrumentVersion,
        officeClass: input.officeClass,
        // Verbatim. The route validates the word limit and REFUSES; nothing on
        // this path shortens anything.
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
