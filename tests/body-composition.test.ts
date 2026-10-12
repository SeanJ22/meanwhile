import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  BODY_COMPOSITIONS,
  compositionFor,
  membersOfBody,
} from "../lib/registry/body-membership.ts";
import { governingRosterHoldersForDivision, rosterHoldersForBody } from "../lib/registry/body-rosters.ts";
import { filesThatWouldBeCommitted } from "../lib/ops/repo-files.ts";
import type { Registry } from "../lib/registry/types.ts";
import { installRegistryAuthority } from "./helpers/promoted-fixtures.ts";

await installRegistryAuthority();

/** A body does not inherit members from its geography: an inherited roster requires a recorded, cited authority, and an unsourced body renders nobody. These guards live outside the resolver so a defect in it cannot disable them. */

const ROOT = process.cwd();
const PIMA_SUPERVISORS = "ocd-division/country:us/state:az/county:pima#governing";
const TUCSON_COUNCIL = "ocd-division/country:us/state:az/place:tucson#governing";
const CAWCD = "ocd-division/country:us/state:az/county:pima#central-arizona-water-conservation-district";
const TUCSON_PHA = "ocd-division/country:us/state:az/place:tucson#public-housing-authority";
const TUCSON_PLANNING = "ocd-division/country:us/state:az/place:tucson#planning-commission";
const FLOOD_CONTROL = "ocd-division/country:us/state:az/county:pima#regional-flood-control-district";

function registry(): Registry {
  return JSON.parse(readFileSync(join(ROOT, "lib/registry/registry.json"), "utf8")) as Registry;
}

test("RED CONTROL: CAWCD cannot inherit the Pima County supervisors", () => {
  /* A named control: county supervisors standing in for an elected water board. */
  const supervisors = rosterHoldersForBody(PIMA_SUPERVISORS);
  assert.ok(
    supervisors.length > 0,
    "the Pima County board roster is the thing CAWCD used to inherit — if it is empty this control proves nothing",
  );

  const resolved = membersOfBody(CAWCD);
  /* The invariant: the county supervisors never stand in for the water board, whoever its own roster names. */
  assert.equal(
    resolved.kind,
    "DIRECT_BODY_ROSTER",
    "CAWCD's members are sourced from the board's own pages and must resolve through its own roster",
  );
  const names = new Set(resolved.members.map((m) => m.name));
  assert.equal(
    resolved.members.length,
    15,
    `CAWCD rendered ${resolved.members.length} members — the board has fifteen directly elected directors`,
  );

  for (const s of supervisors) {
    assert.ok(
      !names.has(s.name),
      `${s.name} is a Pima County Supervisor and must not appear on the CAWCD board. The board's ` +
        `own page (https://www.cap-az.com/board/board-members/, read 2026-08-27) names 15 popularly ` +
        `elected members; the four from Pima County are Karen Cesare, Pat Jacobs, Justin Manuel and ` +
        `Mark Taylor.`,
    );
  }
});

test("RED CONTROL: a Tucson advisory board cannot inherit the Mayor and Council", () => {
  const council = rosterHoldersForBody(TUCSON_COUNCIL);
  assert.ok(council.length > 0, "the Tucson council roster must exist for this control to mean anything");

  const resolved = membersOfBody(TUCSON_PLANNING);
  assert.equal(resolved.kind, "UNKNOWN_COMPOSITION");
  assert.deepEqual(
    resolved.members,
    [],
    "the Planning Commission is an appointed citizen body. It rendered the Mayor and the six Council " +
      "Members, and so did 57 other Tucson boards.",
  );
});

test("RED CONTROL: the Tucson PHA reuses Mayor and Council ONLY through its sourced alias, and keeps the resident seat", () => {
  /* The council really is this board, and the city's own agenda is the authority that says so. */
  const resolved = membersOfBody(TUCSON_PHA);
  assert.equal(resolved.kind, "ALIAS_PLUS_ADDITIONAL_SEATS");
  assert.ok(resolved.authority, "an alias without a recorded authority is the fallback wearing a new name");
  assert.match(
    resolved.authority.quote,
    /Mayor and Council and a Resident Appointee/,
    "the authority must be the source's own words",
  );

  const council = rosterHoldersForBody(TUCSON_COUNCIL);
  assert.equal(
    resolved.members.length,
    council.length + 1,
    `the board is the Mayor and Council PLUS a Resident Appointee. Rendering only the ${council.length} ` +
      "council seats is what the division fallback did, and it is an incomplete board presented as a complete one.",
  );
  assert.ok(
    resolved.members.some((m) => m.officeTitle === "Resident Appointee"),
    "the Resident Appointee seat must be present",
  );
});

test("RED CONTROL: a statutory alias carries the statute that makes it lawful", () => {
  const resolved = membersOfBody(FLOOD_CONTROL);
  assert.equal(resolved.kind, "EXPLICIT_LEGAL_ALIAS");
  assert.equal(
    resolved.members.length,
    rosterHoldersForBody(PIMA_SUPERVISORS).length,
    "A.R.S. 48-3602(B) makes the supervisors this district's board of directors, so the roster IS theirs",
  );
  assert.match(resolved.authority?.sourceUrl ?? "", /azleg\.gov/);
  assert.match(resolved.authority?.quote ?? "", /board of supervisors shall be the board of directors/i);

  /* Two districts hang off the same county division: one is the supervisors and one is not, so no geography-keyed fallback can tell them apart. */
  assert.notEqual(
    membersOfBody(CAWCD).members.length,
    resolved.members.length,
    "two bodies on one division, two different answers — that is the whole reason for this module",
  );
});

test("no registry body acquires members from a division it merely shares", () => {
  const reg = registry();
  const offenders: string[] = [];
  for (const b of reg.bodies) {
    const resolved = membersOfBody(b.id);
    if (resolved.members.length === 0) continue;
    if (resolved.kind === "DIRECT_BODY_ROSTER") continue;
    /* Anything else showing people must be a recorded alias. */
    const composition = compositionFor(b.id);
    if (!composition?.authority) {
      offenders.push(`${b.id} shows ${resolved.members.length} member(s) with no recorded authority`);
    }
  }
  assert.deepEqual(offenders, [], offenders.join("\n  "));
});

test("every recorded composition names a body the registry actually holds", () => {
  const ids = new Set(registry().bodies.map((b) => b.id));
  const problems: string[] = [];
  for (const c of BODY_COMPOSITIONS) {
    if (!ids.has(c.bodyId)) problems.push(`${c.bodyId} is not a registry body`);
    if (c.kind === "EXPLICIT_LEGAL_ALIAS" || c.kind === "ALIAS_PLUS_ADDITIONAL_SEATS") {
      if (!c.aliasOfBodyId) problems.push(`${c.bodyId} is an alias with no aliasOfBodyId`);
      else if (!ids.has(c.aliasOfBodyId)) problems.push(`${c.bodyId} aliases unknown body ${c.aliasOfBodyId}`);
      if (!c.authority?.quote?.trim()) problems.push(`${c.bodyId} is an alias with no quoted authority`);
      if (!c.authority?.sourceUrl?.trim()) problems.push(`${c.bodyId}'s authority cites no source URL`);
    } else if (c.aliasOfBodyId) {
      problems.push(`${c.bodyId} is not an alias but names aliasOfBodyId`);
    }
    for (const s of c.additionalSeats ?? []) {
      if (!s.sourceUrl?.trim()) problems.push(`${c.bodyId}'s "${s.officeTitle}" seat cites no source`);
    }
  }
  assert.deepEqual(problems, [], problems.join("\n  "));
});

test("no reader surface reaches a body's members through a division roster", () => {
  /* The roster helper is banned from any module that renders a body; only the division-representation path may call it. */
  const ALLOWED = new Set([
    /* Where it is defined. */
    "lib/registry/body-rosters.ts",
    /* The DIVISION question — "who represents this district" — and its route. */
    "lib/registry/representation.ts",
    /* Server-side division acquisition and composition; no body-membership reader lives here. */
    "lib/registry/representation-server.ts",
    "app/api/representation/[...division]/route.ts",
    /* Tests of those two, and of this rule. */
    "tests/body-composition.test.ts",
    "tests/body-rosters.test.ts",
    "tests/card-sources.test.ts",
    "tests/division-representation.test.ts",
    "tests/representation.test.ts",
    /* Exact division/officeholder projection regression; it renders no body. */
    "tests/reader-representation-delivery.test.ts",
  ]);

  const offenders: string[] = [];
  for (const file of filesThatWouldBeCommitted({ cwd: ROOT })) {
    if (ALLOWED.has(file)) continue;
    if (!/\.(ts|tsx|mts)$/.test(file)) continue;
    let text: string;
    try {
      text = readFileSync(join(ROOT, file), "utf8");
    } catch {
      continue;
    }
    /* Comments stripped: modules that document the removal quote the call they deleted. */
    const code = text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
    if (code.includes("governingRosterHoldersForDivision")) offenders.push(file);
  }

  assert.deepEqual(
    offenders,
    [],
    `${offenders.length} module(s) outside the allowed set reach a division roster:\n  ` +
      offenders.join("\n  ") +
      "\n\nA body's members come from lib/registry/body-membership.ts. A division's " +
      "representatives are a different question and have a different resolver.",
  );
});

test("CONTROL: the removed fallback really would have inherited, on the bodies it was removed from", () => {
  /* Replays the deleted behaviour and requires it to still produce the wrong answer, so the assertions above test something live. */
  const wouldHaveInherited = governingRosterHoldersForDivision(
    "ocd-division/country:us/state:az/county:pima",
  );
  assert.ok(
    wouldHaveInherited.length > 0,
    "the old fallback must still return the supervisors — otherwise this control is vacuous",
  );

  /* Disjointness: none of the resolver's members may be a person the deleted fallback would have handed over. */
  const inherited = new Set(wouldHaveInherited.map((h) => h.name));
  const resolved = membersOfBody(CAWCD).members.map((m) => m.name);
  assert.ok(resolved.length > 0, "CAWCD must name its own board for this comparison to mean anything");
  const leaked = resolved.filter((name) => inherited.has(name));
  assert.deepEqual(
    leaked,
    [],
    `the new resolver handed back ${leaked.join(", ")} — people the deleted division fallback would have inherited`,
  );
});
