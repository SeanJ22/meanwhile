import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { IDENTITY_DOMAINS } from "../lib/db/identity-domains.ts";
import { hashSpeakKey } from "../lib/db/speak.ts";
import {
  SPEAK_LABEL,
  SPEAK_PLACEHOLDER,
} from "../lib/speak/copy.ts";
import {
  exportsVerbatim,
  redactSelfDisclosure,
} from "../lib/speak/self-disclosure.ts";
import { KNOWN_GOOD, triage, triageRules } from "../lib/speak/triage.ts";

const ROOT = process.cwd();

/** Speak your mind, and its four rules: one section per rule. */

/* ====================================================================== *
 *  RULE 1 — DISTRICT-STAMPED, JOINED TO NOTHING
 * ====================================================================== */

test("BC-11 RULE 1: the store holds a district and no way to reach a person", () => {
  const domain = IDENTITY_DOMAINS.speak_your_mind;
  assert.ok(domain, "the store is not registered in the identity domains");
  assert.equal(domain.storeClass, "READER_COLLECTION");

  // No world identity value. Not an email, not a phone, not an address — the
  // surface never asks for one, and the schema could not hold one if it did.
  for (const [column, spec] of Object.entries(domain.columns)) {
    assert.ok(
      !["EMAIL_ADDRESS", "PHONE_NUMBER", "POSTAL_ADDRESS", "IP_ADDRESS"].includes(
        spec.space,
      ),
      `speak_your_mind.${column} holds a world identity value (${spec.space})`,
    );
  }

  // The district IS there — a store with no district would be sentiment about
  // nowhere, which is the one thing it must not be.
  assert.equal(domain.columns.ocd_ids.space, "CIVIC_IDENTIFIER");
  assert.equal(domain.columns.division_vintage.space, "NON_IDENTIFYING");
});

test("BC-11 RULE 1: the continuity key is in its OWN digest space", () => {
  /*
   * The load-bearing assertion, and it is over the VALUES rather than over the
   * column names. Three stores hash the same kind of
   * browser-minted key. If two of them digested the same input they would be
   * equality-joinable, and the n-stores rule would be broken by arithmetic
   * rather than by a foreign key anybody could see.
   */
  const key = "0123456789abcdef0123456789abcdef";
  const bare = createSha256(key);
  const limiter = createSha256(`intake-limiter:${key}`);
  const speak = hashSpeakKey(key);

  assert.notEqual(speak, bare, "the speak key digests the bare key, like reactions");
  assert.notEqual(speak, limiter, "the speak key shares the limiter's digest space");
  assert.equal(
    speak,
    createSha256(`speak-your-mind:${key}`),
    "the speak key is not digested under its declared prefix",
  );

  // And the registry SAYS so, so the boundary test can compute over it.
  assert.equal(
    IDENTITY_DOMAINS.speak_your_mind.columns.speak_key_hash.digestSpace,
    "speak-your-mind:",
  );
});

function createSha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

test("BC-11 RULE 1: no account, no email, no address reaches the write path", () => {
  const raw = readFileSync(join(ROOT, "lib", "db", "speak.ts"), "utf8");
  /*
   * Comments stripped first. That file's own header explains that the store
   * holds no email and no address, so a sweep over the raw text would flag the
   * record of the guarantee as a breach of it — an instrument that cannot tell
   * shipped code from a comment about shipped code.
   */
  const write = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  // Enforced by ABSENCE: there is no field for these, so no caller can supply
  // one by accident.
  for (const forbidden of ["email", "address", "accountId", "userId", "replyTo"]) {
    assert.ok(
      !new RegExp(`\\b${forbidden}\\b`, "i").test(write),
      `the write path mentions ${forbidden}`,
    );
  }
});

/* ====================================================================== *
 *  RULE 2 — HONEST DISCLOSURE AT THE BOX
 * ====================================================================== */

test("BC-11: the pill, the placeholder and the framing are the author's words", () => {
  assert.equal(SPEAK_LABEL, "Speak Your Mind");
  assert.equal(SPEAK_PLACEHOLDER, "What would you want to say?");
});

/* ====================================================================== *
 *  RULE 3 — PII SELF-DISCLOSURE: REDACTED, FLAGGED, NEVER EXPORTED VERBATIM
 * ====================================================================== */

test("BC-11 RULE 3: an email, a phone and a street address are removed AND flagged", () => {
  const result = redactSelfDisclosure(
    "Call me on 973-627-2000 or alma@example.com, I live at 123 Main Street.",
  );
  assert.ok(!result.text.includes("973"), `phone survived: ${result.text}`);
  assert.ok(!result.text.includes("@example.com"), `email survived: ${result.text}`);
  assert.ok(!/123 Main Street/.test(result.text), `address survived: ${result.text}`);

  // The FLAG is what a scrub alone cannot provide: a scrubbed string and a
  // clean string are indistinguishable afterwards.
  assert.deepEqual(result.flags.sort(), [
    "EMAIL",
    "PHONE_OR_NUMBER",
    "STREET_ADDRESS",
  ]);
  assert.equal(exportsVerbatim({ selfDisclosure: result.flags }), false);
});

test("BC-11 RULE 3: a reader who introduces themselves is caught by the SHAPE", () => {
  for (const said of [
    "My name is Alma Hernandez and I want an answer.",
    "I'm Alma Hernandez, a parent in this district.",
    "This is Alma Hernandez.",
    "Fix the potholes. Signed, Alma Hernandez",
  ]) {
    const result = redactSelfDisclosure(said);
    assert.ok(
      result.flags.includes("SELF_NAMED"),
      `a self-introduction was not caught: ${said}`,
    );
    assert.ok(
      !result.text.includes("Alma Hernandez"),
      `the name survived the redaction: ${result.text}`,
    );
  }
});

test("BC-11 RULE 3: naming the OFFICIAL is not self-disclosure", () => {
  /*
   * The load-bearing negative. This box exists to collect what a constituent
   * would say to a named official's face, so a pass that flagged the official's
   * name would flag the entire product. It is why the patterns are anchored on
   * the act of introducing rather than on any list of names — a list built from
   * our own officials would have exactly this failure.
   */
  for (const said of [
    "Ravi Shah has ignored three of these meetings.",
    "Gabriel Trujillo should explain the budget.",
    "Alma Hernandez voted the wrong way and I want to know why.",
  ]) {
    const result = redactSelfDisclosure(said);
    assert.deepEqual(
      result.flags,
      [],
      `naming an official was treated as self-disclosure: ${said}`,
    );
  }
});

test("BC-11 RULE 3: a clean message exports verbatim, and that is the ordinary case", () => {
  const result = redactSelfDisclosure("You have ignored this neighbourhood for six years.");
  assert.deepEqual(result.flags, []);
  assert.equal(exportsVerbatim({ selfDisclosure: result.flags }), true);
});

test("BC-11 RULE 3: the flag is carried on the ROW, not recomputed at export", () => {
  const schema = readFileSync(join(ROOT, "lib", "db", "schema.ts"), "utf8");
  assert.match(
    schema,
    /selfDisclosure: jsonb\("self_disclosure"\)/,
    "the flag is not a column — an export path would have to remember to re-classify",
  );
  // And the redaction runs BEFORE the row is built, at the single write path.
  const write = readFileSync(join(ROOT, "lib", "db", "speak.ts"), "utf8");
  const redactAt = write.indexOf("redactSelfDisclosure(");
  const insertAt = write.indexOf("db.insert(speakYourMind)");
  assert.ok(redactAt > 0 && insertAt > redactAt, "the row is built before it is redacted");
});

/* ====================================================================== *
 *  RULE 4 — ABUSE TRIAGE, NOT FORWARDING
 * ====================================================================== */

test("BC-11 RULE 4: a threat is HELD, with the tier recorded and nobody notified", () => {
  const held = triage("I am going to kill him if that passes.");
  assert.equal(held.reviewState, "HELD");
  assert.equal(held.reviewReason, "T3_THREAT");

  const menacing = triage("Someone should make sure he doesn't make it to the next meeting.");
  assert.equal(menacing.reviewState, "HELD");
  assert.equal(menacing.reviewReason, "T2_CONCERNING");
});

test("BC-11 RULE 4: harsh political speech is NEVER held — the product asked for it", () => {
  /*
   * Political speech about people seeking or holding power is harsh by design, and harshness is the signal buyers want.
   * **Over-filtering degrades the product to guard against a rare case**, and a
   * box that promises you can say what you would say to their face and then
   * swallows it would be worse than not asking.
   */
  for (const said of KNOWN_GOOD) {
    const result = triage(said);
    assert.equal(
      result.reviewState,
      "NONE",
      `harsh political speech was held: ${said} (${result.reviewReason})`,
    );
  }
});

test("BC-11 RULE 4: nothing in the triage path can contact anybody", () => {
  // Enforced by ABSENCE. There is no notifier here and no caller that could be
  // one: a classifier hit is never sufficient to contact law enforcement, and
  // every report passes human review first.
  const triageSrc = readFileSync(join(ROOT, "lib", "speak", "triage.ts"), "utf8");
  const writeSrc = readFileSync(join(ROOT, "lib", "db", "speak.ts"), "utf8");
  for (const src of [triageSrc, writeSrc]) {
    for (const forbidden of ["fetch(", "sendMail", "notify(", "webhook", "sms"]) {
      assert.ok(
        !src.includes(forbidden),
        `the triage path can reach out: ${forbidden}`,
      );
    }
  }
});

test("BC-11 RULE 4: every triage rule states in plain words what it looks for", () => {
  const rules = triageRules();
  assert.ok(rules.length > 0, "there are no triage rules — the sweep is vacuous");
  for (const rule of rules) {
    assert.ok(rule.what.length > 20, `${rule.reason} does not say what it looks for`);
  }
});

test("BC-11 RULE 4: the intake limiter's attestation applies to this surface", () => {
  const route = readFileSync(join(ROOT, "app", "api", "speak", "route.ts"), "utf8");
  // The same protections as the reactions route, not weaker ones — a second
  // intake surface with its own guards is the front door left open.
  assert.match(route, /isSameOriginSubmission/);
  assert.match(route, /noteSubmission/);
  assert.match(route, /classifySubmission/);
  assert.match(route, /LIMITER_UNAVAILABLE/);
  // And the master intake ripcord closes it with everything else.
  assert.match(route, /ripcordPulled\("ripcord\.reactionIntake"\)/);
});

/* ====================================================================== *
 *  NOT RENDERED PUBLICLY
 * ====================================================================== */

test("BC-11: nothing a reader writes here is rendered back to any reader", () => {
  /*
   * Reactions are write-only from the
   * reader's perspective, because showing aggregates anchors later respondents
   * and corrupts the data being sold. The same reasoning governs this, and the
   * default is recorded as REVERSIBLE.
   *
   * Enforced by absence of a read: there is no select, and the component holds
   * no list of anybody's submissions.
   */
  const write = readFileSync(join(ROOT, "lib", "db", "speak.ts"), "utf8");
  assert.ok(!/db\.select\(/.test(write), "the store has a read path");

  const surface = readFileSync(
    join(ROOT, "components", "speak", "speak-your-mind.tsx"),
    "utf8",
  );
  assert.ok(
    !/\.map\(/.test(surface),
    "the surface renders a list — nothing here may be shown back to a reader",
  );
});
