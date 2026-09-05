import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  duplicates,
  groupId,
  implementationsIn,
  MIN_BODY,
  normalise,
  shapeOf,
  stripComments,
} from "../lib/ops/duplicate-implementations.ts";
import { census, sourceFiles } from "../scripts/duplicate-implementations.mts";
import { decideNamedBody } from "../lib/ask/body-confirmation.ts";
import { personInitials } from "../lib/officials/person-name.ts";

/* ========================================================================== */
/* RULING 103 — a class sweep covers duplicated implementations               */
/* ========================================================================== */

/**
 * `CLAUDE.md` already says a named instance is an example of a class-wide
 * defect, and tells you to fix at the SHARED code path. That instruction has a
 * blind spot in its own wording: it assumes there IS one.
 *
 * Three separate copies of an initials function rendered *Thomas J. Haynes
 * III* as **"TI"** — each taking the first letter of the first token and the
 * first letter of the last, where the last token was the generational suffix.
 * Fixing the copy a reader complained about left two standing. Grepping the
 * symptom cannot find them: they are not the same text and they do not use the
 * same variable names.
 */

const ROOT = process.cwd();
const BASELINE = JSON.parse(
  readFileSync(join(ROOT, "tests", "duplicate-implementations.json"), "utf8"),
) as {
  groups: Array<{ id: string; disposition: "OWED" | "ALLOWED"; reason: string }>;
};

test("the sweep actually scans the tree — a collapsed scan reports nothing found", () => {
  /*
   * The denominator, asserted. The FIRST version of the extractor found 241
   * declarations across 806 files because its parameter-list regex lost every
   * signature with a destructured argument or a multi-line shape. It reported
   * one duplicate group and looked healthy. That is a sweep reporting nothing
   * found without having looked, which is the failure this repo names most
   * often — so the population is pinned.
   */
  const files = sourceFiles();
  const all = census();
  assert.ok(files.length > 600, `only ${files.length} source file(s) scanned`);
  assert.ok(
    all.length > 1500,
    `only ${all.length} declaration(s) extracted — the extractor has stopped seeing shapes it used to`,
  );
  assert.ok(
    all.filter((i) => i.size >= MIN_BODY).length > 1000,
    "the population over the size threshold collapsed",
  );
});

test("no duplicate implementation exists that the baseline does not record", () => {
  const groups = duplicates(census());
  const known = new Set(BASELINE.groups.map((g) => g.id));
  const fresh = groups.map(groupId).filter((id) => !known.has(id));
  assert.deepEqual(
    fresh,
    [],
    "these implementations now appear in more than one file and are not in " +
      "tests/duplicate-implementations.json. RULING 103: fix at the shared code path, or " +
      "record the group with a REASON it must stay separate. Run `pnpm dupes` to see them.",
  );
});

test("every recorded group carries a disposition and a reason", () => {
  /*
   * An entry that says nothing has quietly become permission — the same
   * discipline that makes an impure generator state its impurity and a
   * lint allowance name what it allows.
   */
  for (const g of BASELINE.groups) {
    assert.ok(
      g.disposition === "OWED" || g.disposition === "ALLOWED",
      `${g.id} carries no disposition`,
    );
    assert.ok(
      (g.reason ?? "").length > 40,
      `${g.id} is recorded with no reason. Why it is duplicated is the finding, not a shrug.`,
    );
  }
});

test("a recorded group that has been consolidated leaves the baseline", () => {
  /*
   * The baseline only shrinks. A group listed here that no longer exists in
   * the tree is a fixed defect whose record is now telling a new reader that
   * duplication is expected there — so it has to go, in the same commit.
   */
  const live = new Set(duplicates(census()).map(groupId));
  const gone = BASELINE.groups.map((g) => g.id).filter((id) => !live.has(id));
  assert.deepEqual(
    gone,
    [],
    "these groups are recorded and no longer exist — consolidated, or renamed. " +
      "Remove them from tests/duplicate-implementations.json in the same commit.",
  );
});

test("the named instance is fixed: ONE initials implementation, and it keeps the surname", () => {
  const all = census();
  // Body-acronym resolution accepts a canonical entity and produces complete
  // organization acronyms (VUSD). It never renders a person's avatar initials.
  // Keep the narrow distinction executable; the separate shape-duplicate
  // census above still scans this function and every other implementation.
  const bodyAcronym = (i: { file: string; name: string }) => i.file === "lib/ask/body-confirmation.ts" && i.name === "initials";
  const body = { id: "school:canonical", name: "Vail Unified District Governing Board", nameClass: "body" as const, level: "BODY" as const, divisionType: "school_district" };
  const acronym = decideNamedBody("What's on the VUSD agenda?", [body]);
  assert.equal(acronym.kind, "CONFIRM");
  if (acronym.kind === "CONFIRM") assert.equal(acronym.candidate.id, body.id);
  assert.notEqual(decideNamedBody("What's on the VUSD agenda?", [{ ...body, level: undefined, nameClass: "person" }]).kind, "CONFIRM", "body-acronym routing cannot become a person-initials renderer");
  assert.equal(personInitials("Thomas J. Haynes III"), "TH");
  const initials = all.filter(
    (i) => /initials/i.test(i.name) && i.file !== "lib/officials/person-name.ts" && !bodyAcronym(i),
  );
  assert.deepEqual(
    initials.map((i) => `${i.file}#${i.name}`),
    [],
    "an initials implementation exists outside lib/officials/person-name.ts. There is one, " +
      "and every surface imports it — three copies is what rendered Thomas J. Haynes III as TI.",
  );
  // And the one that survives still drops the generational suffix.
  assert.equal(
    all.filter((i) => i.file === "lib/officials/person-name.ts" && /initials/i.test(i.name)).length,
    1,
    "lib/officials/person-name.ts must carry exactly one initials implementation",
  );
});

/* -------------------------------------------------------------------------- */
/* The instrument itself                                                       */
/* -------------------------------------------------------------------------- */

test("stripComments preserves length and newlines, so line numbers stay true", () => {
  const src = 'const a = 1; // note\n/* block\n   comment */\nconst b = "// not a comment";\n';
  const out = stripComments(src);
  assert.equal(out.length, src.length, "length must be preserved");
  assert.equal(out.split("\n").length, src.split("\n").length, "newlines must be preserved");
  assert.match(out, /const b = "\/\/ not a comment";/, "a comment marker inside a string survives");
  assert.doesNotMatch(out, /note/);
  assert.doesNotMatch(out, /block/);
});

test("the shape hash collides on a rename and not on different logic", () => {
  const a = normalise("const first = name.split(' ')[0]; return first.toUpperCase();");
  const b = normalise("const head = person.split(' ')[0]; return head.toUpperCase();");
  const c = normalise("const first = name.split(' ')[1]; return first.toLowerCase();");
  assert.notEqual(a, b, "the exact hashes differ — this is the rename the exact hash misses");
  assert.equal(shapeOf(a), shapeOf(b), "the shape hash must see through a rename");
  assert.notEqual(shapeOf(a), shapeOf(c), "different logic must not collide");
});

test("the extractor reads the signatures a regex over \\([^)]*\\) loses", () => {
  const src = `
export function destructured({ a, b }: { a: string; b: number }): string {
  const x = a + String(b); const y = x + x; const z = y + y; return z + z + z + z;
}
export const multiline = (
  first: string,
  second: string,
): string => {
  const x = first + second; const y = x + x; const z = y + y; return z + z + z + z;
};
export function generic<T extends object>(value: T): T {
  const x = { ...value }; const y = { ...x }; const z = { ...y }; return z as T;
}
const withDefault = (a = ")", b = "(") => {
  const x = a + b; const y = x + x; const z = y + y; return z + z + z + z + z + z;
};
`;
  const found = implementationsIn("x.ts", src).map((i) => i.name);
  for (const name of ["destructured", "multiline", "generic", "withDefault"]) {
    assert.ok(found.includes(name), `${name} was not extracted — found: ${found.join(", ")}`);
  }
});

test("two copies in the SAME file are not a cross-file duplicate", () => {
  // Two copies in one file are a refactor waiting to happen. Two copies in two
  // files are the shape that let the initials defect survive its own fix,
  // because a sweep of one file cannot see the other.
  // Comfortably over MIN_BODY: a body under the threshold is structure rather
  // than an implementation, and would not be reported either way.
  const body =
    "{ const x = 1; const y = x + x; const z = y + y; const w = z + z; " +
    "const v = w + w; const u = v + v; const t = u + u; return t + t + t + t; }";
  const one = implementationsIn("a.ts", `function p() ${body}\nfunction q() ${body}`);
  assert.equal(duplicates(one).length, 0);
  const two = [...implementationsIn("a.ts", `function p() ${body}`), ...implementationsIn("b.ts", `function q() ${body}`)];
  assert.ok(duplicates(two).length >= 1, "across files, it is a finding");
});
