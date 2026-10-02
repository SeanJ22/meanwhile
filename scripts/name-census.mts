/**
 * **The single-token name census** — F01-continued item 10a, 2026-08-19.
 *
 * `pnpm names:census` walks every person this product holds — federal and
 * state officeholders, curated body rosters, statewide executives, ballot
 * candidacies and general-election nominees — and reports how many carry a
 * name that cannot stand as a person's name.
 *
 * COUNT ONLY. It fetches nothing and changes nothing. It exists so that
 * "Carruth" is caught by a script rather than by the author reading a card,
 * and so that the answer is a NUMBER WITH A DENOMINATOR rather than a
 * reassurance — an operation that can return nothing must be asked what it
 * returned.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { isIncompletePersonName, nameTokens } from "../lib/officials/person-name.ts";
import { BALLOT_FILES, HELD_ROSTER_STATES, rosterFile } from "../lib/coverage/artifacts.ts";
import { ballotPath, rosterPath } from "../lib/holdings/files.ts";
import { BODY_ROSTERS } from "../lib/registry/body-rosters.ts";
import { STATEWIDE_EXECUTIVES } from "../lib/officials/statewide-executives.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));

interface Person {
  /** Where this person is held — the body TYPE, in reader language. */
  kind: string;
  state: string;
  id: string;
  name: string;
  where: string;
}

const people: Person[] = [];

// ── federal and state officeholders ────────────────────────────────────────
/*
 * DERIVED FROM THE MANIFEST, never hand-listed. `tests/coverage-manifest.test.ts`
 * refuses any file outside `lib/coverage/` that enumerates every covered state,
 * and it caught the first version of this script doing exactly that — which is
 * the guard working: onboarding a state must reach this census without anyone
 * remembering it exists.
 */
const OFFICEHOLDER_FILES: { file: string; kind: string; state: string }[] = [
  { file: "lib/registry/officeholders-us.json", kind: "federal officeholder", state: "US" },
  ...HELD_ROSTER_STATES.map((state) => ({
    file: rosterPath(rosterFile(state)),
    kind: "state officeholder",
    state: state.usps,
  })),
];

for (const source of OFFICEHOLDER_FILES) {
  if (!existsSync(join(ROOT, source.file))) continue;
  const parsed = read(source.file) as {
    officeholders?: { id: string; name: string; officeTitle?: string }[];
  };
  for (const holder of parsed.officeholders ?? []) {
    people.push({
      kind: source.kind,
      state: source.state,
      id: holder.id,
      name: holder.name,
      where: source.file,
    });
  }
}

// ── curated body rosters ───────────────────────────────────────────────────
const stateOf = (ocdId: string) => /state:(\w\w)/.exec(ocdId)?.[1]?.toUpperCase() ?? "??";
for (const roster of BODY_ROSTERS) {
  for (const member of roster.members) {
    people.push({
      kind: `curated roster · ${/school_district/.test(roster.bodyId) ? "school district" : /county:/.test(roster.bodyId) && !/place:/.test(roster.bodyId) ? "county" : "municipal"}`,
      state: stateOf(roster.bodyId),
      id: member.id,
      name: member.name,
      where: roster.bodyName,
    });
  }
}

// ── statewide executives ───────────────────────────────────────────────────
for (const executive of STATEWIDE_EXECUTIVES) {
  // The name is on the HOLDER, not on the executive row — the first version of
  // this walked the outer object, read `undefined`, and reported three
  // governors as nameless. A census that cannot read a field must not report
  // what it could not read as a finding about the data.
  people.push({
    kind: "statewide executive",
    state: stateOf(executive.stateOcdId),
    id: executive.holder.id,
    name: executive.holder.name,
    where: executive.holder.officeTitle ?? "statewide",
  });
}

// ── ballot candidacies and nominees ────────────────────────────────────────
const BALLOT_SOURCES = BALLOT_FILES.map((entry) => ({
  file: ballotPath(entry.file),
  state: entry.state.toUpperCase(),
}));

for (const source of BALLOT_SOURCES) {
  if (!existsSync(join(ROOT, source.file))) continue;
  const parsed = read(source.file) as {
    candidacies?: { id: string; givenName?: string; familyName?: string; contestId?: string }[];
  };
  for (const candidacy of parsed.candidacies ?? []) {
    people.push({
      kind: "ballot candidate",
      state: source.state,
      id: candidacy.id,
      name: `${candidacy.givenName ?? ""} ${candidacy.familyName ?? ""}`.trim(),
      where: candidacy.contestId ?? source.file,
    });
  }
}

if (existsSync(join(ROOT, "data/states/az/ballot/az-general-lineup-2026.json"))) {
  const lineup = read("data/states/az/ballot/az-general-lineup-2026.json") as {
    contests?: { contestId: string; nominees?: { name: string }[] }[];
  };
  for (const contest of lineup.contests ?? []) {
    for (const nominee of contest.nominees ?? []) {
      people.push({
        kind: "general-election nominee",
        state: "AZ",
        id: `${contest.contestId}|${nominee.name}`,
        name: nominee.name,
        where: contest.contestId,
      });
    }
  }
}

// ── the census ─────────────────────────────────────────────────────────────
const flagged = people.filter((p) => isIncompletePersonName(p.name));

const tally = (rows: Person[], key: (p: Person) => string) => {
  const m = new Map<string, number>();
  for (const row of rows) m.set(key(row), (m.get(key(row)) ?? 0) + 1);
  return [...m].sort((a, b) => (a[0] < b[0] ? -1 : 1));
};

console.log("=== single-token person-name census ===");
console.log(`people held: ${people.length}`);
console.log(`incomplete names: ${flagged.length}`);
console.log("");
console.log("held, by kind:");
for (const [k, n] of tally(people, (p) => p.kind)) console.log(`  ${k.padEnd(34)} ${n}`);
console.log("");
console.log("held, by state:");
for (const [k, n] of tally(people, (p) => p.state)) console.log(`  ${k.padEnd(6)} ${n}`);

if (flagged.length === 0) {
  console.log("\nNo person is held under a name that cannot stand as one.");
} else {
  console.log("\nflagged, by kind:");
  for (const [k, n] of tally(flagged, (p) => p.kind)) console.log(`  ${k.padEnd(34)} ${n}`);
  console.log("\nflagged, by state:");
  for (const [k, n] of tally(flagged, (p) => p.state)) console.log(`  ${k.padEnd(6)} ${n}`);
  console.log("\nevery flagged row, so the resolution is per person:");
  for (const row of flagged) {
    console.log(
      `  ${row.state} · ${row.kind} · ${JSON.stringify(row.name)} ` +
        `(${nameTokens(row.name).length} token(s)) — ${row.id} @ ${row.where}`,
    );
  }
}

// A census that could not read its own inputs must say so rather than print a
// comfortable zero.
const missing = [...OFFICEHOLDER_FILES.map((f) => f.file), ...BALLOT_SOURCES.map((f) => f.file)]
  .filter((f) => !existsSync(join(ROOT, f)));
if (missing.length > 0) {
  console.log(`\nCOULD NOT READ ${missing.length} source(s): ${missing.join(", ")}`);
  console.log("The counts above are over what was readable, not over the universe.");
}
