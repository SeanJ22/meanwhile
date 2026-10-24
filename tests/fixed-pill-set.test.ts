
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  BATTLECARD_SECTIONS,
  battlecardSectionTitle,
} from "../lib/ballot/battlecard-sections.ts";
import { memberDirectoryReaches } from "../lib/officials/member-directory-scope.ts";

const DIRECTORY = readFileSync("components/officials/member-directory.tsx", "utf8");
const BALLOT_CARD = readFileSync("components/ballot/candidate-battlecard.tsx", "utf8");
const OFFICIAL_MODAL = readFileSync("components/map/popup/official-modal.tsx", "utf8");

test("directory sections use held records and contribute missing records to the card gap", () => {
  const records = DIRECTORY.slice(DIRECTORY.indexOf("function DirectoryRecordsContent"));
  assert.match(records, /memberDirectoryReaches\(holderId, only, ?state\)/);
  assert.match(records, /<CardGapContribution/);
  assert.doesNotMatch(records, /WorkingOnIt/);
});

test("map and ballot cards share their reader section titles", () => {
  // Both render the one PersonCard, whose section titles come from its shared reading order.
  assert.match(OFFICIAL_MODAL, /<PersonCard/);
  assert.match(BALLOT_CARD, /<PersonCard/);
});

test("BAL-34: the two shared sections still exist in the fixed set, by id", () => {
  for (const id of ["committees", "offices"] as const) {
    const spec = BATTLECARD_SECTIONS.find((s) => s.id === id);
    assert.ok(spec, `BC-1 no longer carries a "${id}" section`);
    assert.ok(battlecardSectionTitle(id).length > 0, `"${id}" has no reader-facing title`);
  }
  assert.equal(battlecardSectionTitle("offices"), "Offices near you");
});

/** Every surface that renders these sections asks the one shared predicate. */
test("BAL-34: every surface deciding these sections asks the ONE scope predicate", () => {
  const BALLOT_PAGE = readFileSync("app/ballot/page.tsx", "utf8");
  const PREDICATE = readFileSync("lib/officials/member-directory-scope.ts", "utf8");

  assert.match(
    PREDICATE,
    /export function memberDirectoryReaches\(holderId: string, section: "committees" \| "offices" = "committees", state\?: string\): boolean/,
    "the shared predicate must exist as one exported function",
  );
    // A client boundary is a directive only in the leading position of a module; elsewhere it is prose.
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

  // `recordHolder ? <Content/> : null` is a truthy slot that renders nothing.
  for (const slot of ["MemberCommitteesContent", "MemberOfficesContent"] as const) {
    const at = BALLOT_PAGE.indexOf(`<${slot}`);
    assert.ok(at > 0, `app/ballot/page.tsx no longer renders ${slot}`);
    const before = BALLOT_PAGE.slice(Math.max(0, at - 400), at);
    assert.match(
      before,
      slot === "MemberOfficesContent" ? /memberDirectoryReaches\(recordHolder\.id, "offices",\s*recordHolder\.state\)/ : /memberDirectoryReaches\(recordHolder\.id\)/,
      `${slot}'s slot must be null where the source does not reach the person, or the ` +
        "reader sees an empty box instead of a held section or the card gap",
    );
  }

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

test("state people offices use the exact native person scope while committees keep their own source scope", () => {
  const nativePerson = "ocd-person/01234567-89ab-cdef-0123-456789abcdef";
  assert.equal(memberDirectoryReaches(nativePerson, "offices", "OH"), true);
  assert.equal(memberDirectoryReaches(nativePerson, "committees", "OH"), false);
  assert.equal(memberDirectoryReaches(nativePerson, "offices"), false, "a global native ID alone cannot establish the state");
  assert.equal(memberDirectoryReaches("congress:B001302", "committees"), true);
  assert.equal(memberDirectoryReaches("roster:unverified-person", "offices", "OH"), false);
});

test("the ballot card uses the shared person frame and its section order", () => {
  assert.match(BALLOT_CARD, /<PersonCard/);
  assert.match(readFileSync("components/ui/person-card.tsx", "utf8"), /PERSON_CARD_READING_ORDER\.filter[\s\S]*?\.map/);
});
