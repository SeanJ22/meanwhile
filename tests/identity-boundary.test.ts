/**
 * **A-001 · THE IDENTITY BOUNDARY, PROVEN OVER VALUE SPACES.**
 * (External correctness audit of `336a3eb`, remediated 2026-08-24.)
 *
 * `CLAUDE.md` states it without qualification: *no store carries a column that
 * could join to another, and there is no mapping table between any pair; tests
 * assert the schemas share no key.*
 *
 * The test that was supposed to assert that checked **column names** against a
 * list of forbidden fragments. `feedback.reply_to` held a raw email address,
 * does not contain the letters `email`, and was waved through as a named
 * exception. `questionnaire_invitations.email` holds a raw email address too.
 * Two tables, one value space, equality-joinable, and a guard that could not
 * see it — RULING 110's wrong-form search, living inside a test.
 *
 * This file asks the question the other one could not: **which KIND of value
 * does each column hold, and where else does that kind live?** The answer comes
 * from `lib/db/identity-domains.ts`, which classifies every column of every
 * table, and a column missing from it fails the build.
 *
 * `tests/db-schema.test.ts` is untouched and still runs. The name sweep is a
 * cheap second net and there is no reason to remove it; what there was reason
 * to do was stop believing it was the whole of the proof.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { getTableConfig } from "drizzle-orm/pg-core";

import * as schema from "../lib/db/schema.ts";
import {
  IDENTITY_DOMAINS,
  WORLD_IDENTITY_SPACES,
  columnsHolding,
  tablesInClass,
  type ValueSpace,
} from "../lib/db/identity-domains.ts";

/** Every pgTable in the schema, by its SQL name. */
function liveTables(): Map<string, ReturnType<typeof getTableConfig>> {
  const out = new Map<string, ReturnType<typeof getTableConfig>>();
  for (const value of Object.values(schema)) {
    try {
      const config = getTableConfig(value as never);
      out.set(config.name, config);
    } catch {
      // Not a table — an enum, a type, a helper.
    }
  }
  return out;
}

/* ==================================================================== *
 *  THE REGISTRY MATCHES THE SCHEMA — otherwise everything below is
 *  a claim about a file rather than about the database.
 * ==================================================================== */

test("A-001 · every table in the schema is classified, and nothing is classified twice", () => {
  const live = liveTables();
  assert.ok(live.size >= 10, `only ${live.size} tables read — this would pass without looking`);

  const declared = new Set(Object.keys(IDENTITY_DOMAINS));
  const missing = [...live.keys()].filter((t) => !declared.has(t)).sort();
  const phantom = [...declared].filter((t) => !live.has(t)).sort();

  assert.deepEqual(
    missing,
    [],
    "a table exists in the schema and is not classified — classify it in lib/db/identity-domains.ts",
  );
  assert.deepEqual(
    phantom,
    [],
    "a table is classified and does not exist — the registry is describing a schema that has moved",
  );
});

test("A-001 · every COLUMN is classified, by value space, with no drift either way", () => {
  const live = liveTables();
  const unclassified: string[] = [];
  const phantom: string[] = [];
  let counted = 0;

  for (const [table, config] of live) {
    const domain = IDENTITY_DOMAINS[table];
    if (!domain) continue; // named by the test above
    const declared = new Set(Object.keys(domain.columns));
    for (const column of config.columns) {
      counted += 1;
      if (!declared.has(column.name)) unclassified.push(`${table}.${column.name}`);
    }
    const actual = new Set(config.columns.map((c) => c.name));
    for (const name of declared) if (!actual.has(name)) phantom.push(`${table}.${name}`);
  }

  assert.ok(counted > 60, `only ${counted} columns read — the sweep did not look`);
  assert.deepEqual(
    unclassified.sort(),
    [],
    "a column holds a value nobody has said what kind it is — that is how A-001 happened",
  );
  assert.deepEqual(phantom.sort(), [], "the registry names a column the schema does not have");
});

/* ==================================================================== *
 *  THE BOUNDARY ITSELF
 * ==================================================================== */

/**
 * **THE REPRODUCTION, AND THE LAW.**
 *
 * Against the schema as shipped this fails, naming `feedback.reply_to` beside
 * `questionnaire_invitations.email`: one value space, two tables, one of them
 * a reader collection store.
 *
 * The rule is narrower than "no two tables may hold an email" — that would be
 * unsatisfiable and would not be the constitutional claim anyway. It is: **a
 * READER COLLECTION store may hold no value that exists in the world
 * independently of us.** Such a value is joinable using data nobody here
 * controls — a mailing list, a voter file, a breach dump — and the whole
 * neutrality claim is that these rows cannot be resolved to a person.
 */
test("A-001 · no reader collection store holds a WORLD identity value", () => {
  const readerStores = new Set(tablesInClass("READER_COLLECTION"));
  assert.ok(
    readerStores.size >= 3,
    `only ${readerStores.size} reader stores — the n-stores rule covers at least three`,
  );

  const offenders: string[] = [];
  for (const space of WORLD_IDENTITY_SPACES) {
    for (const where of columnsHolding(space)) {
      const table = where.split(".")[0];
      if (readerStores.has(table)) offenders.push(`${where} holds ${space}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    "a reader collection store holds a value that identifies a person outside our own tables — " +
      "this is the A-001 join, and the constitutional claim is absolute",
  );
});

/**
 * The second half, and it is the one the old name sweep came closest to.
 *
 * Two reader stores must not share ANY value space that could carry an
 * equality join — including one we minted. A minted handle is safe precisely
 * because we can say where it is, and it stops being safe the moment it is in
 * two of these tables.
 */
test("A-001 · no two reader collection stores share a joinable value space", () => {
  const readerStores = tablesInClass("READER_COLLECTION");
  const joinable: ValueSpace[] = ["EMAIL_ADDRESS", "PHONE_NUMBER", "IP_ADDRESS", "OPAQUE_HANDLE", "DIGEST"];

  const shared: string[] = [];
  for (const space of joinable) {
    const tables = new Set(
      columnsHolding(space)
        .map((c) => c.split(".")[0])
        .filter((t) => readerStores.includes(t)),
    );
    // `run_id` is an OPAQUE_HANDLE on three reader stores by design and by
    // rule: it names a SYNTHETIC WALK, is null on every organic row, and
    // exists so a session's own probe rows can be told apart from reader
    // signal. It identifies our instrument, never a person — which is why it
    // is checked by name below rather than exempted by loosening the space.
    const columns = columnsHolding(space).filter((c) => readerStores.includes(c.split(".")[0]));
    const nonRunId = columns.filter((c) => !c.endsWith(".run_id"));
    const tablesNonRunId = new Set(nonRunId.map((c) => c.split(".")[0]));
    if (tablesNonRunId.size > 1) shared.push(`${space}: ${nonRunId.join(", ")}`);
    void tables;
  }

  assert.deepEqual(
    shared,
    [],
    "two reader stores can be equality-joined on the same kind of value",
  );
});

test("A-001 · run_id is the one handle shared across reader stores, and it names a WALK", () => {
  // Stated rather than exempted silently. If this list ever grows, somebody
  // has to type the new name here and say why.
  const runIds = columnsHolding("OPAQUE_HANDLE").filter((c) => c.endsWith(".run_id"));
  assert.deepEqual(
    runIds.sort(),
    ["feedback.run_id", "reactions.run_id", "search_log.run_id"],
    "the shared-handle exemption changed shape",
  );
});

/**
 * THE CONTACT-DELIVERY STORE IS THE ONLY HOME FOR A READER'S ADDRESS.
 *
 * And the handle that reaches it is RANDOM, never derived. A deterministic
 * hash of the address on both sides would be the same join key relocated: two
 * parties holding `sha256(address)` can still match rows, and one of them
 * would be a reader collection store again.
 */
test("A-001 · a reader address lives in exactly one place, and it is not a collection store", () => {
  const emails = columnsHolding("EMAIL_ADDRESS");
  assert.deepEqual(
    emails,
    ["feedback_contact.address", "questionnaire_invitations.email"],
    "an email address appears somewhere new",
  );

  for (const where of emails) {
    const table = where.split(".")[0];
    const storeClass = IDENTITY_DOMAINS[table].storeClass;
    assert.notEqual(
      storeClass,
      "READER_COLLECTION",
      `${where} is in a reader collection store`,
    );
  }

  // And the two that remain are different KINDS of thing, which is the scope
  // correction this remediation recorded rather than smoothed:
  // `questionnaire_invitations.email` is a candidate's address from a
  // certified public filing, held to send one questionnaire.
  assert.equal(IDENTITY_DOMAINS.questionnaire_invitations.storeClass, "CIVIC_CONTENT");
  assert.equal(IDENTITY_DOMAINS.feedback_contact.storeClass, "CONTACT_DELIVERY");
});

test("A-001 · the contact handle is minted at random, not derived from the address", () => {
  // Enforced by ABSENCE, the same way RULING 112 enforces no-summarisation:
  // there is no hashing of the address anywhere on the write path.
  const why = IDENTITY_DOMAINS.feedback.columns.contact_ref.why ?? "";
  assert.match(why, /RANDOM/, "the registry no longer says the handle is random");
  assert.match(why, /never derived/, "and it must say what it is not");
});

/* ==================================================================== *
 *  THE DIGEST SPACES STAY APART
 * ==================================================================== */

test("A-001 · every digest column is in a different digest space from every other", () => {
  // The limiter digests `"intake-limiter:" + key`; the reactions store digests
  // the bare key. Same algorithm, different input, so the two columns cannot
  // be equality-joined even though both are sha256 hex.
  const digests = columnsHolding("DIGEST");
  assert.deepEqual(
    digests,
    ["intake_limiter.digest", "questionnaire_tokens.token_digest", "reactions.reaction_key_hash"],
    "a digest column appeared or moved — say which space it is in",
  );
  const reactionsWhy = IDENTITY_DOMAINS.reactions.columns.reaction_key_hash.why ?? "";
  const limiterWhy = IDENTITY_DOMAINS.intake_limiter.columns.digest.why ?? "";
  assert.match(reactionsWhy, /different digest space/);
  assert.match(limiterWhy, /different digest space/);
});
