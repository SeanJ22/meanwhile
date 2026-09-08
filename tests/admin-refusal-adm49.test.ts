/**
 * **A REFUSAL THE OWNER CAN ACT ON, AND THE CLASS GUARD THAT KEEPS IT THAT WAY.**
 * (ADM-49, the 9.7.26 admin feedback. Critical. RULING 262, RULING 103.)
 *
 * The owner typed *"I did rule on this — that picture is approved"* on NH166,
 * clicked **Record my answer**, and read *"The server answered 401."* He took
 * the red dot for **"Not approved"**. Three sessions of "nothing happens"
 * (ADM-4, ADM-16, ADM-32) were that sentence.
 *
 * The console was not confused. `verifySession` had named the reason, both 401
 * sites carried it, and the client read a field neither of them sends.
 *
 * ## What is actually being guarded here
 *
 * The unit assertions below are cheap and would pass again if someone rewrote
 * the fallback string slightly better. The test that matters is the LAST one:
 * a sweep of every admin surface that reads a `Response`, asserting that none
 * of them renders `res.status` as the owner's explanation. That is the class
 * (RULING 262) — four producers and four consumers agreeing on nothing — and a
 * fifth surface added next month is exactly how it would come back.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  SESSION_REJECTION_WORDS,
  rejectionWords,
  type SessionRejection,
} from "@/lib/control-plane/admin-auth.ts";
import { adminRefusalBody, readRefusal } from "@/lib/control-plane/admin-refusal.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const ALL: readonly SessionRejection[] = [
  "NO_COOKIE",
  "MALFORMED",
  "BAD_SIGNATURE",
  "EXPIRED",
  "NOT_CONFIGURED",
];

/* ------------------------------------------------------- the vocabulary */

test("every refusal class has an owner sentence and a next step, and neither is machine speech", () => {
  for (const rejection of ALL) {
    const words = rejectionWords(rejection);
    assert.ok(words.says.length > 20, `${rejection} says too little: ${words.says}`);
    assert.ok(words.whatToDo.length > 20, `${rejection} offers no next step`);
    for (const sentence of [words.says, words.whatToDo]) {
      assert.ok(!sentence.includes("_"), `${rejection} leaks a constant: ${sentence}`);
      assert.doesNotMatch(sentence, /\b401\b/, `${rejection} prints a status code at the owner`);
      assert.match(sentence, /[.!]$/, `${rejection} is not a sentence: ${sentence}`);
    }
  }
  assert.equal(Object.keys(SESSION_REJECTION_WORDS).length, ALL.length);
});

/**
 * The single most important assertion in this file.
 *
 * Four of the five classes are fixed by signing in again. `NOT_CONFIGURED` is
 * not — it means this deployment has no signing key, so it cannot check anyone.
 * Telling the owner to sign in again there sends him round a loop that cannot
 * end, and it is the exact shape of the failure ADM-49 is about: advice that
 * sounds actionable and cannot work.
 */
test("NOT_CONFIGURED never tells the owner to sign in again; the other four do", () => {
  assert.equal(rejectionWords("NOT_CONFIGURED").fixedBySigningIn, false);
  assert.match(rejectionWords("NOT_CONFIGURED").whatToDo, /will not fix this/i);
  for (const rejection of ALL.filter((r) => r !== "NOT_CONFIGURED")) {
    assert.equal(rejectionWords(rejection).fixedBySigningIn, true, rejection);
    assert.match(rejectionWords(rejection).whatToDo, /sign in again/i, rejection);
  }
});

/* ------------------------------------------------------------- the shape */

test("the refusal body carries the sentence under both names shipped consumers read", () => {
  const body = adminRefusalBody({
    says: "You are not signed in.",
    whatToDo: "Sign in again.",
    rejection: "NO_COOKIE",
    fixedBySigningIn: true,
  });
  assert.equal(body.ok, false);
  assert.equal(body.says, body.error, "says and error must be the same sentence");
  assert.equal(body.rejection, "NO_COOKIE");
});

/* ----------------------------------------------------------- the reader */

test("readRefusal recovers the sentence from every shape the server has ever sent", () => {
  // The gateway's shape.
  assert.match(
    readRefusal({ status: 401, body: { ok: false, says: "Signed out." }, contentType: "application/json" }).says,
    /Signed out/,
  );
  // The deploy-preview shape.
  assert.match(
    readRefusal({ status: 401, body: { error: "Signed out." }, contentType: "application/json" }).says,
    /Signed out/,
  );
  // The old middleware shape: no sentence at all, only a class. It must still
  // produce owner-readable words rather than a status code.
  const fromClass = readRefusal({
    status: 401,
    body: { error: "authentication required", rejection: "EXPIRED" },
    contentType: "application/json",
  });
  assert.match(fromClass.says, /run out/i);
  assert.equal(fromClass.rejection, "EXPIRED");
  assert.equal(fromClass.offerSignIn, true);
});

test("a 401 that is not JSON is named as an upstream refusal and offers no sign-in", () => {
  const resolved = readRefusal({ status: 401, body: null, contentType: "text/html" });
  assert.match(resolved.says, /in front of the console/i);
  assert.equal(resolved.offerSignIn, false, "signing in cannot clear an upstream refusal");
  assert.equal(resolved.offerRetry, true);
});

test("a refusal that says nothing at all still names the status once, as the LAST resort", () => {
  const resolved = readRefusal({ status: 418, body: null, contentType: "application/json" });
  assert.match(resolved.says, /418/, "the number is still available to read out");
  assert.match(resolved.says, /did not say why/i);
  assert.equal(resolved.offerSignIn, false);
});

test("a NOT_CONFIGURED refusal does not offer a sign-in door anywhere in the chain", () => {
  const resolved = readRefusal({
    status: 401,
    body: adminRefusalBody({
      says: rejectionWords("NOT_CONFIGURED").says,
      whatToDo: rejectionWords("NOT_CONFIGURED").whatToDo,
      rejection: "NOT_CONFIGURED",
      fixedBySigningIn: false,
    }),
    contentType: "application/json",
  });
  assert.equal(resolved.offerSignIn, false);
});

/* ------------------------------------------------------- THE CLASS GUARD */

/**
 * Every admin surface that reads a `Response`, and what it may not do with it.
 *
 * The pattern is deliberately narrow: it matches an interpolation of a status
 * into a string that reaches the owner. It does NOT match `res.status` used in
 * a branch, a log, or a thrown error that is caught and translated — those are
 * fine and several are load-bearing.
 */
const ADMIN_FETCH_SURFACES = [
  "app/(admin)/admin/decisions.tsx",
  "app/(admin)/admin/deploy-fleet.tsx",
  "app/(admin)/live-refresh.tsx",
];

test("no admin surface renders a bare HTTP status as the owner's explanation (RULING 262)", () => {
  const offenders: string[] = [];
  for (const relative of ADMIN_FETCH_SURFACES) {
    const source = readFileSync(join(ROOT, relative), "utf8");
    source.split("\n").forEach((line, i) => {
      // `answered ${res.status}` / `answered ${status}` — the exact shape the
      // owner photographed, in a template literal that becomes owner-facing text.
      if (/(answered|status of|code)\s*\$\{\s*res?\.?status\s*\}/.test(line)) {
        offenders.push(`${relative}:${i + 1} — ${line.trim()}`);
      }
    });
  }
  assert.deepEqual(
    offenders,
    [],
    `these render an HTTP status where a sentence belongs, which is ADM-49:\n${offenders.join("\n")}`,
  );
});

test("every admin surface that reads a refused Response goes through the one reader", () => {
  const missing = ADMIN_FETCH_SURFACES.filter(
    (relative) => !readFileSync(join(ROOT, relative), "utf8").includes("readRefusal"),
  );
  assert.deepEqual(
    missing,
    [],
    `these read a Response but not through readRefusal, so they will drift (RULING 103): ${missing.join(", ")}`,
  );
});
