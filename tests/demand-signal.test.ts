/**
 * The demand signal's bounds:
 *
 * ```
 *   fixed enum        one value, and no free text on any path
 *   no identity       no account, no address, and no continuity hash either
 *   no read path      the module exports no reader, so none can be called
 *   aggregate-only    nothing is ever rendered back, including in aggregate
 *   symmetric         every body and candidate card, or none
 *   never shown       the confirmation reports the ASK, never a total
 * ```
 *
 * The last two are guarded over the source, because they are claims about what a surface does.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  DEMAND_SIGNALS,
  DEMAND_SUBJECT_TYPES,
  hashRunId,
  writeDemandSignal,
} from "../lib/db/demand-signal.ts";
import { hashRunId as hashReactionRunId } from "../lib/db/reactions.ts";

const MODULE = readFileSync("lib/db/demand-signal.ts", "utf8");
const ROUTE = readFileSync("app/api/demand-signal/route.ts", "utf8");
const PILL = readFileSync("components/demand/demand-pill.tsx", "utf8");
const SCHEMA = readFileSync("lib/db/schema.ts", "utf8");

test("the signal enum has exactly one member, and the subject types exactly two", () => {
  assert.deepEqual([...DEMAND_SIGNALS], ["WANT_THIS_SOONER"]);
  assert.deepEqual([...DEMAND_SUBJECT_TYPES], ["BODY", "CANDIDATE"]);
});

test("NO FREE TEXT anywhere on the path", () => {
  /* Asserted at the three places text could enter: the table, the route's accepted body, and the control. */
  const table = SCHEMA.slice(SCHEMA.indexOf('pgTable(\n  "demand_signals"'));
  const definition = table.slice(0, table.indexOf("\n);"));
  assert.ok(!/free_text|freeText|comment|note:/i.test(definition), "the table has no text column");
  assert.ok(!/\btext\?:|\bcomment\?:|freeText/.test(ROUTE), "the route accepts no text field");
  assert.ok(
    !/<textarea|<input/i.test(PILL),
    "the pill offers the reader no input — it is one button",
  );
});

test("NO IDENTITY COLUMN, and deliberately no continuity hash either", () => {
  /*
   * Asserted over the generated SQL, not the source text: the table's doc block must be able to say "never an
   * address" without the guard reading its own explanation as the defect.
   */
  const sql = readFileSync("lib/db/migrations/0023_tricky_sister_grimm.sql", "utf8");
  const columns = [...sql.matchAll(/^\t"([a-z_]+)"/gm)].map((m) => m[1]);
  assert.deepEqual(columns, [
    "id",
    "occurred_at",
    "subject_type",
    "subject_id",
    "signal",
    "ocd_ids",
    "division_vintage",
    "run_class",
    "run_id",
  ]);
  for (const forbidden of [
    "reaction_key_hash",
    "ask_key_hash",
    "demand_key_hash",
    "email",
    "address",
    "ip_address",
    "user_id",
    "session_id",
  ]) {
    assert.ok(
      !columns.includes(forbidden),
      `demand_signals must not carry ${forbidden} — the owner's instruction was no identity`,
    );
  }
  /* And the route accepts no key on the wire either. */
  const accepted = ROUTE.slice(
    ROUTE.indexOf("const submission = body as {"),
    ROUTE.indexOf("if (!isSubjectType"),
  );
  assert.ok(!/key/i.test(accepted), "the route's accepted body carries no key of any kind");
});

test("THE N-STORES RULE holds by VALUE SPACE: the run digest is its own", () => {
  /*
   * Proven over value spaces, never column names: `reactions` and this table both have a `run_id` column, so the same
   * input must produce different values.
   */
  assert.notEqual(
    hashRunId("walk-all-local-1"),
    hashReactionRunId("walk-all-local-1"),
    "one run id must not produce the same digest in two stores",
  );
  assert.match(MODULE, /demand-run:/, "the namespace is explicit");
});

test("NO READ PATH: the module exports a write and nothing that reads", () => {
  /* A missing function is stronger than a filter. */
  const exported = [...MODULE.matchAll(/export (?:async )?(?:function|const) (\w+)/g)].map(
    (m) => m[1],
  );
  assert.deepEqual(exported.sort(), ["DEMAND_SIGNALS", "DEMAND_SUBJECT_TYPES", "hashRunId", "writeDemandSignal"].sort());
  assert.ok(
    !/\bselect\b|\bcount\(|getDb\(\)\.select/i.test(MODULE),
    "nothing in this module reads the table",
  );
});

test("NO GET on the route, so a reader cannot fetch results either", () => {
  assert.ok(!/export async function GET/.test(ROUTE), "the route serves no read");
  assert.match(ROUTE, /export async function POST/);
});

test("the confirmation reports the ASK and never a total", () => {
  assert.match(PILL, /we&apos;ve noted it|we've noted it/);
  assert.ok(
    !/\{count\}|\{total\}|others|so far|\bN\b people/.test(PILL),
    "the pill renders no count, rank or aggregate of anyone's taps",
  );
});

test("SYMMETRY: the pill is on the candidate card and the body card, same component", () => {
  /* A pill that appeared only where coverage is good would itself be a coverage claim. */
  const candidate = readFileSync("components/ballot/candidate-battlecard.tsx", "utf8");
  const body = readFileSync("components/map/popup/entity-modal.tsx", "utf8");
  assert.match(candidate, /<DemandPill\s+subjectType="CANDIDATE"/);
  assert.match(body, /<DemandPill\s+subjectType="BODY"/);
  for (const source of [candidate, body]) {
    assert.match(
      source,
      /from "@\/components\/demand\/demand-pill"/,
      "both surfaces import the SAME component, so they cannot drift",
    );
  }
});

test("the write REFUSES an undeclared row before it looks for a database", async () => {
  /*
   * The declaration must fail identically whether or not a database happens to
   * be reachable — a refusal that only fires in production is a refusal the
   * suite cannot see.
   */
  const held = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    await assert.rejects(
      () =>
        writeDemandSignal({
          subjectType: "BODY",
          subjectId: "x",
          signal: "WANT_THIS_SOONER",
          ocdIds: [],
          // @ts-expect-error — the seeded failure: no marker at all.
          marker: undefined,
        }),
      /no run marker/,
    );
  } finally {
    if (held !== undefined) process.env.DATABASE_URL = held;
  }
});

test("the route validates the subject against committed data and fails CLOSED", () => {
  assert.match(ROUTE, /knownBodySubjectIds|getCandidateTargetIds/);
  assert.match(ROUTE, /subject data unavailable/, "a missing store is a 503, never a stored row");
  assert.match(ROUTE, /unknown subjectId/);
});

test("the migration is declared EXPAND, and it is purely additive", () => {
  const phases = readFileSync("lib/db/migration-phases.ts", "utf8");
  assert.match(phases, /"0023_tricky_sister_grimm": \{\s*phase: "expand"/);
  const sql = readFileSync("lib/db/migrations/0023_tricky_sister_grimm.sql", "utf8");
  assert.ok(!/ALTER TABLE|DROP |RENAME /i.test(sql), "it touches no existing table");
  assert.match(sql, /CREATE TABLE "demand_signals"/);
});
