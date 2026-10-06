import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { posixRelative } from "../scripts/repo-path.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * `F02` — **THE COMMITTEE DENOMINATOR IS PER REPRESENTATIVE** (the author's
 * ruling, recorded in `docs/rulings.md`; Prompt C item 15.1, 2026-08-20).
 *
 * ## What the "seven parents" figure actually was
 *
 * The F01 record carried a figure of seven parent committees missing
 * jurisdiction text. **That was a count of DISTINCT COMMITTEES surfaced by one
 * specific hunt.** It was never a claim about how many parent committees exist,
 * and it may not be treated as one — a seven used as a denominator would make
 * every per-member statement wrong by two orders of magnitude.
 *
 * The real shape, read off the shipped directory rather than remembered:
 *
 *   537 members · 531 hold at least one parent seat
 *   1,339 parent SEATS across those members
 *     1,250 carry jurisdiction text
 *        89 do not
 *   448 of 531 members have every parent seat covered; 83 have a gap
 *
 * The seven survives as a true and much smaller fact: **seven DISTINCT parent
 * committees that somebody actually sits on carry no jurisdiction text** —
 * `HSQJ` and `HSZS`, the two House select committees, and `JCSE` `JSEC` `JSLC`
 * `JSPR` `JSTX`, all five joint bodies. Upstream carries jurisdiction for
 * STANDING committees only, which is a source-shape fact rather than a gap in
 * our retrieval.
 *
 * ## What this guard is for
 *
 * The counts below come from a member's REAL MEMBERSHIPS, computed here from
 * the same file the card renders from. If a constant is ever substituted for
 * that computation, the numbers stop describing anybody and this fails.
 */

interface Directory {
  committees: Record<string, { name: string; jurisdiction?: string | null }>;
  byMember: Record<string, { committees?: { committeeId: string; title?: string | null }[] }>;
}

const dir = JSON.parse(
  readFileSync(join(ROOT, "data", "congress-legislators", "directory.json"), "utf8"),
) as Directory;

/** A parent's id is four characters; a subcommittee's is the parent plus two. */
const isParent = (id: string) => id.length === 4;
const hasJurisdiction = (id: string) =>
  (dir.committees[id]?.jurisdiction ?? "").trim() !== "";

/** The whole per-member census, computed from memberships. Never a constant. */
function census() {
  let membersWithParentSeat = 0;
  let parentSeats = 0;
  let parentSeatsWithJurisdiction = 0;
  let membersFullyCovered = 0;
  const distinctUncovered = new Set<string>();
  const seatedSubcommittees = new Set<string>();

  for (const entry of Object.values(dir.byMember)) {
    const seats = entry.committees ?? [];
    for (const s of seats) if (!isParent(s.committeeId)) seatedSubcommittees.add(s.committeeId);
    const parents = seats.filter((s) => isParent(s.committeeId));
    if (parents.length === 0) continue;
    membersWithParentSeat += 1;
    parentSeats += parents.length;
    const covered = parents.filter((s) => hasJurisdiction(s.committeeId));
    parentSeatsWithJurisdiction += covered.length;
    if (covered.length === parents.length) membersFullyCovered += 1;
    for (const s of parents) if (!hasJurisdiction(s.committeeId)) distinctUncovered.add(s.committeeId);
  }

  return {
    members: Object.keys(dir.byMember).length,
    membersWithParentSeat,
    parentSeats,
    parentSeatsWithJurisdiction,
    parentSeatsWithout: parentSeats - parentSeatsWithJurisdiction,
    membersFullyCovered,
    distinctUncovered,
    seatedSubcommittees,
  };
}

test("F02: the denominator is a member's OWN parent seats, and there are far more than seven", () => {
  const c = census();

  assert.ok(c.members > 500, `the directory holds every sitting member, found ${c.members}`);
  assert.ok(
    c.parentSeats > 1000,
    `parent SEATS across all members is the denominator, and it is ${c.parentSeats} — ` +
      "a figure of 7 used here would be wrong by two orders of magnitude",
  );
  assert.notEqual(c.parentSeats, 7, "the denominator is not the F01 figure");
  assert.equal(
    c.parentSeatsWithJurisdiction + c.parentSeatsWithout,
    c.parentSeats,
    "the two halves sum to the denominator — a pair that does not reconcile is the finding",
  );
  assert.ok(
    c.parentSeatsWithJurisdiction > c.parentSeatsWithout,
    "most parent seats carry their jurisdiction text; the gap is the minority case",
  );
});

test("F02: the seven survives as DISTINCT COMMITTEES actually sat on, which is a different fact", () => {
  const c = census();
  /*
   * The figure is true and small: seven distinct parent committees that
   * somebody actually sits on carry no jurisdiction text. Naming them is what
   * stops the number drifting back into being a denominator.
   */
  assert.deepEqual(
    [...c.distinctUncovered].sort(),
    ["HSQJ", "HSZS", "JCSE", "JSEC", "JSLC", "JSPR", "JSTX"],
    "the two House select committees and all five joint bodies — upstream carries " +
      "jurisdiction for STANDING committees only, which is a source-shape fact",
  );
  assert.ok(
    c.distinctUncovered.size < c.parentSeatsWithout,
    `${c.distinctUncovered.size} distinct committees account for ${c.parentSeatsWithout} ` +
      "seats — the same committee sat on by many members, which is exactly why a " +
      "committee count may never stand in for a seat count",
  );
});

test("F02: the 186-subcommittee gap reconciles, from memberships", () => {
  const c = census();
  /*
   * 179 seated subcommittees + 7 seated parents with no jurisdiction = 186.
   * The other two subcommittees in the file are real Senate subcommittees
   * nobody currently sits on, and they render nowhere — so they are not part
   * of a gap a reader can reach.
   */
  assert.equal(c.seatedSubcommittees.size, 179, "seated subcommittees");
  assert.equal(
    c.seatedSubcommittees.size + c.distinctUncovered.size,
    186,
    "the honest named gap, reconciled from memberships rather than asserted",
  );
  const allSubcommittees = Object.keys(dir.committees).filter((id) => !isParent(id));
  assert.equal(allSubcommittees.length, 181);
  assert.equal(
    allSubcommittees.length - c.seatedSubcommittees.size,
    2,
    "two subcommittees nobody sits on — they render nowhere and are not a reader-facing gap",
  );
});

test("F02: every parent seat with jurisdiction can render it, and every one without names the gap", () => {
  const c = census();
  /*
   * The render half, asserted against the DATA rather than against a snapshot
   * of the component: a seat whose committee carries text has text to show,
   * and a seat whose committee does not is a null the card must name.
   */
  let renderable = 0;
  let namedGap = 0;
  for (const entry of Object.values(dir.byMember)) {
    for (const s of entry.committees ?? []) {
      if (!isParent(s.committeeId)) continue;
      if (hasJurisdiction(s.committeeId)) renderable += 1;
      else namedGap += 1;
    }
  }
  assert.equal(renderable, c.parentSeatsWithJurisdiction);
  assert.equal(namedGap, c.parentSeatsWithout);

  // And the component carries a named gap rather than a blank for the null.
  const src = readFileSync(
    join(ROOT, "components", "officials", "member-directory.tsx"),
    "utf8",
  );
  assert.match(
    src,
    /<WorkingOnIt\s*\/>/,
    "a parent seat with no jurisdiction renders OUR gap, in our own register",
  );
  assert.doesNotMatch(src.replace(/\/\*[\s\S]*?\*\//g, ""), /We haven.{1,3}t sourced what this subcommittee handles yet/,
    "FE-30 routes missing jurisdictions through the shared Reader gap copy");
});

test("F02: no source file hardcodes seven as a committee denominator", () => {
  /*
   * THE GUARD THE RULING ASKS FOR. A constant standing in for a computed
   * membership count is how "seven parents" became a denominator in the first
   * place, and the failure is silent: the number looks like a measurement.
   *
   * Matched as a NUMBER NEXT TO THE WORD, in code with comments stripped,
   * because this file and the component both discuss the seven in prose and a
   * sweep that flagged the word would flag its own explanation.
   */
  const offenders: string[] = [];
  const patterns: Array<[RegExp, string]> = [
    [/\b(?:of|\/)\s*7\s*(?:parent|committee)/i, "`of 7 committees` as a denominator"],
    [/\b(?:parent|committee)\w*\s*(?:Count|Total|Denominator)\s*=\s*7\b/i, "a committee count constant of 7"],
    [/\bSEVEN_PARENTS\b/, "a SEVEN_PARENTS constant"],
  ];

  const walk = (dirPath: string) => {
    for (const entry of readdirSync(dirPath)) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      const full = join(dirPath, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx|mts|mjs)$/.test(entry)) continue;
      if (entry === "committee-denominator.test.ts") continue;
      const code = readFileSync(full, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n")
        .filter((l) => !l.trim().startsWith("//"))
        .join("\n");
      for (const [re, label] of patterns) {
        if (re.test(code)) offenders.push(`${posixRelative(ROOT, full)}: ${label}`);
      }
    }
  };
  for (const root of ["app", "components", "hooks", "lib", "scripts"]) walk(join(ROOT, root));

  assert.deepEqual(
    offenders,
    [],
    "a committee denominator comes from a member's real memberships, never from a " +
      "constant. The F01 'seven parents' figure was a count of distinct committees " +
      "surfaced by one hunt, and using it as a denominator would be wrong by two " +
      "orders of magnitude.",
  );
});
