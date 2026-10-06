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
  /*
   * **THE SCOPE FACT IS STILL KNOWN — AND IT IS NOW ONE PREDICATE.**
   * (Amended Part C, 2026-08-31.)
   *
   * This pinned the literal `holder.id.startsWith("congress:")` and therefore
   * pinned the DUPLICATION. There were three copies of that sentence:
   * `DirectoryContent`, `MemberDirectoryInner`, and — MISSING — the ballot
   * page. The missing copy is what a reader met: `app/ballot/page.tsx` gated
   * the two slots on `recordHolder` alone, so the slot was a truthy React
   * element that rendered null, the battlecard's `content ?? emptyLine` tested
   * the slot rather than what it rendered, and *Committees* and *Offices near
   * you* opened to `innerHTML === ""` — a blank box where a named gap belongs.
   *
   * So the assertion moved from the literal to the RULE, and got stricter
   * rather than looser: the scope fact must be asked through the ONE shared
   * predicate, and `filesAskingTheScope` below requires every surface that
   * renders these sections to ask it. Keeping the literal here would have
   * required keeping the duplication that caused the defect.
   */
  assert.match(
    body,
    /const inScope = memberDirectoryReaches\(holder\.id\)/,
    "the scope fact is still known — it moved INSIDE the sections rather than being dropped, " +
      "and it is asked through the shared predicate rather than a fourth copy of the string",
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

/**
 * **AND EVERY SURFACE THAT RENDERS THESE SECTIONS ASKS THE SAME PREDICATE.**
 * (Part C, 2026-08-31 — the guard that would have caught the blank box.)
 *
 * BAL-34 made the map card render both HEADERS for everyone. What nothing
 * asked is whether the surfaces AGREE about when the source reaches a person,
 * and they did not: `app/ballot/page.tsx` decided it from `recordHolder` alone
 * — which answers "does a record exist", a different question — and handed the
 * battlecard a slot that looked filled and rendered nothing.
 *
 * The completion condition is structural, like the rest of this file: the
 * predicate exists in exactly one module, and every caller that decides
 * whether to render these two sections imports it from there.
 */
test("BAL-34: every surface deciding these sections asks the ONE scope predicate", () => {
  const BALLOT_PAGE = readFileSync("app/ballot/page.tsx", "utf8");
  const PREDICATE = readFileSync("lib/officials/member-directory-scope.ts", "utf8");

  assert.match(
    PREDICATE,
    /export function memberDirectoryReaches\(holderId: string, section: "committees" \| "offices" = "committees"\): boolean/,
    "the shared predicate must exist as one exported function",
  );
  /*
   * The DIRECTIVE, not the token. A client boundary is only a directive in the
   * leading position of a module — anywhere else it is prose, and matching it
   * anywhere makes this guard read a comment as the defect, which it did on
   * the first run against a docstring explaining this very rule.
   */
  const leading = PREDICATE.split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("*") && !l.startsWith("/*") && !l.startsWith("//"))[0];
  assert.doesNotMatch(
    String(leading ?? ""),
    /^["']use client["']/,
    "the predicate is imported by a server component and by a client component, so it may " +
      "not open with a client boundary directive — every export of such a module becomes a " +
      "client reference and calling one on the server throws",
  );

  for (const [label, source] of [
    ["components/officials/member-directory.tsx", DIRECTORY],
    ["app/ballot/page.tsx", BALLOT_PAGE],
  ] as const) {
    assert.match(
      source,
      /memberDirectoryReaches/,
      `${label} decides whether to render the committees and offices sections and must ask ` +
        "the shared predicate; deciding it locally is how the two surfaces came to disagree",
    );
  }

  /*
   * The ballot slots specifically. `recordHolder ? <Content/> : null` is the
   * exact shape that produced the blank box: truthy slot, null render, named
   * gap suppressed.
   */
  for (const slot of ["MemberCommitteesContent", "MemberOfficesContent"] as const) {
    const at = BALLOT_PAGE.indexOf(`<${slot}`);
    assert.ok(at > 0, `app/ballot/page.tsx no longer renders ${slot}`);
    const before = BALLOT_PAGE.slice(Math.max(0, at - 400), at);
    assert.match(
      before,
      slot === "MemberOfficesContent" ? /memberDirectoryReaches\(recordHolder\.id, "offices"\)/ : /memberDirectoryReaches\(recordHolder\.id\)/,
      `${slot}'s slot must be null where the source does not reach the person, or the ` +
        "battlecard's `content ?? emptyLine` fallback tests a slot that renders nothing and " +
        "the reader gets an empty box instead of the named gap",
    );
  }

  /*
   * And the literal must not come back anywhere but the predicate. Three
   * copies of one sentence is what left the fourth site unwritten.
   */
  for (const [label, source] of [
    ["components/officials/member-directory.tsx", DIRECTORY],
    ["app/ballot/page.tsx", BALLOT_PAGE],
  ] as const) {
    const inCode = source
      .split("\n")
      .filter((line) => /startsWith\(["']congress:["']\)/.test(line))
      .filter((line) => !line.trimStart().startsWith("*") && !line.trimStart().startsWith("//"));
    assert.deepEqual(
      inCode,
      [],
      `${label} asks the scope question with its own copy of the string. There is one ` +
        "predicate, in lib/officials/member-directory-scope.ts.",
    );
  }
});

test("BAL-34: the ballot card still renders the whole fixed set, unconditionally", () => {
  /* The surface the map card is being brought into line WITH. If this ever
     becomes conditional, the guard above is measuring against a moved target. */
  assert.match(BALLOT_CARD, /<PersonCard/);
  assert.match(readFileSync("components/ui/person-card.tsx", "utf8"), /PERSON_CARD_SECTIONS\.filter[\s\S]*?\.map/);
});
