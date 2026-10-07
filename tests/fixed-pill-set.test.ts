
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
  const inner = DIRECTORY.slice(DIRECTORY.indexOf("function MemberDirectoryInner"));
  const body = inner.slice(0, inner.indexOf("\n}\n"));
  assert.ok(
    !/if\s*\(!holder\.id\.startsWith\("congress:"\)\)\s*return null/.test(body),
    "MemberDirectoryInner returns null for a non-federal officeholder again — the pill row " +
      "disappears for every local official, which is BAL-34 exactly",
  );
  assert.match(
    body,
    /const inScope = memberDirectoryReaches\(holder\.id\)/,
    "the scope fact is still known — it moved INSIDE the sections rather than being dropped, " +
      "and it is asked through the shared predicate rather than a fourth copy of the string",
  );
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
  assert.match(DIRECTORY, /from "@\/lib\/ballot\/battlecard-sections"/);
  assert.match(BALLOT_CARD, /from "@\/lib\/ballot\/battlecard-sections"/);
  assert.match(DIRECTORY, /battlecardSectionTitle/);
});

test("BAL-34: the two shared sections still exist in the fixed set, by id", () => {
  for (const id of ["committees", "offices"] as const) {
    const spec = BATTLECARD_SECTIONS.find((s) => s.id === id);
    assert.ok(spec, `BC-1 no longer carries a "${id}" section`);
    assert.ok(battlecardSectionTitle(id).length > 0, `"${id}" has no reader-facing title`);
    assert.ok(spec.emptyLine.length > 0, `"${id}" has no empty line for the map card to render`);
  }
  assert.equal(battlecardSectionTitle("offices"), "Offices near you");
});

/** Every surface that renders these sections asks the one shared predicate. */
test("BAL-34: every surface deciding these sections asks the ONE scope predicate", () => {
  const BALLOT_PAGE = readFileSync("app/ballot/page.tsx", "utf8");
  const PREDICATE = readFileSync("lib/officials/member-directory-scope.ts", "utf8");

  assert.match(
    PREDICATE,
    /export function memberDirectoryReaches\(holderId: string, section: "committees" \| "offices" = "committees"\): boolean/,
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
      slot === "MemberOfficesContent" ? /memberDirectoryReaches\(recordHolder\.id, "offices"\)/ : /memberDirectoryReaches\(recordHolder\.id\)/,
      `${slot}'s slot must be null where the source does not reach the person, or the ` +
        "battlecard's `content ?? emptyLine` fallback tests a slot that renders nothing and " +
        "the reader gets an empty box instead of the named gap",
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

test("BAL-34: the ballot card still renders the whole fixed set, unconditionally", () => {
  assert.match(BALLOT_CARD, /<PersonCard/);
  assert.match(readFileSync("components/ui/person-card.tsx", "utf8"), /PERSON_CARD_SECTIONS\.filter[\s\S]*?\.map/);
});
