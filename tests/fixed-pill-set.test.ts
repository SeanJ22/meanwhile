/**
 * **BAL-34 — THE FIXED PILL SET IS FIXED ON BOTH BATTLECARDS.**
 * (The 8.30.26 sweep, worked 2026-08-31.)
 *
 * The owner reported the map battlecard missing its *Offices near you* pill.
 * The row's blocker named the cause exactly: *the map battlecard builds its
 * pill set conditionally per section rather than from the fixed BC-1 set.*
 *
 * The condition was one line — `if (!holder.id.startsWith("congress:")) return
 * null` at the top of `MemberDirectoryInner`, which deleted both HEADERS along
 * with their content for every state legislator, mayor and school-board member
 * in the product. The ballot card has never done that: BC-1 gives it seven
 * drop-downs on every card, always, with the section's own empty line in an
 * absent slot.
 *
 * **A pill present for federal members and absent for local ones is a
 * completeness claim about the PERSON, made by a missing header.** That is the
 * equal-effort rule, and the ballot card's own comment states it: *a card class
 * that answers the question differently is fine; a card class that cannot
 * answer it at all was the defect.*
 *
 * The guards below are structural rather than textual, because the previous
 * repair of this class was satisfied by a string.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  BATTLECARD_SECTIONS,
  battlecardSectionTitle,
} from "../lib/ballot/battlecard-sections.ts";

const DIRECTORY = readFileSync("components/officials/member-directory.tsx", "utf8");
const BALLOT_CARD = readFileSync("components/ballot/candidate-battlecard.tsx", "utf8");

test("BAL-34: the map battlecard's sections do not depend on the person's office class", () => {
  /*
   * The seeded failure, by shape. The early return took the whole component —
   * headers included — out of the tree. Its removal is what the check is on.
   */
  const inner = DIRECTORY.slice(DIRECTORY.indexOf("function MemberDirectoryInner"));
  const body = inner.slice(0, inner.indexOf("\n}\n"));
  assert.ok(
    !/if\s*\(!holder\.id\.startsWith\("congress:"\)\)\s*return null/.test(body),
    "MemberDirectoryInner returns null for a non-federal officeholder again — the pill row " +
      "disappears for every local official, which is BAL-34 exactly",
  );
  assert.match(
    body,
    /const inScope = holder\.id\.startsWith\("congress:"\)/,
    "the scope fact is still known — it moved INSIDE the sections rather than being dropped",
  );
  // Both sections are constructed unconditionally.
  assert.equal(
    (body.match(/<CardSection/g) ?? []).length,
    2,
    "both sections are rendered, always",
  );
});

test("BAL-34: the scope fact renders as a sentence, not as a missing header", () => {
  const inner = DIRECTORY.slice(DIRECTORY.indexOf("function MemberDirectoryInner"));
  const body = inner.slice(0, inner.indexOf("\n}\n"));
  assert.match(body, /sectionEmptyLine\("committees"\)/);
  assert.match(body, /sectionEmptyLine\("offices"\)/);
});

test("BAL-34: both surfaces word the same absence from the SAME table", () => {
  /*
   * Two surfaces answering one question from different strings will eventually
   * disagree, and the one nobody screenshots is the one that stays wrong. Both
   * read `BATTLECARD_SECTIONS`.
   */
  assert.match(DIRECTORY, /from "@\/lib\/ballot\/battlecard-sections"/);
  assert.match(BALLOT_CARD, /from "@\/lib\/ballot\/battlecard-sections"/);
  assert.match(DIRECTORY, /battlecardSectionTitle/);
});

test("BAL-34: the two shared sections still exist in the fixed set, by id", () => {
  /* If a section is renamed or dropped from BC-1, the map card's titles go
     empty rather than wrong — this is what catches that. */
  for (const id of ["committees", "offices"] as const) {
    const spec = BATTLECARD_SECTIONS.find((s) => s.id === id);
    assert.ok(spec, `BC-1 no longer carries a "${id}" section`);
    assert.ok(battlecardSectionTitle(id).length > 0, `"${id}" has no reader-facing title`);
    assert.ok(spec.emptyLine.length > 0, `"${id}" has no empty line for the map card to render`);
  }
  assert.equal(battlecardSectionTitle("offices"), "Offices near you");
});

test("BAL-34: the ballot card still renders the whole fixed set, unconditionally", () => {
  /* The surface the map card is being brought into line WITH. If this ever
     becomes conditional, the guard above is measuring against a moved target. */
  assert.match(BALLOT_CARD, /\{BATTLECARD_SECTIONS\.map\(\(spec\) => \{/);
});
