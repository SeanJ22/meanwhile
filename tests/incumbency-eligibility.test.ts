/**
 * INCUMBENCY IS A CONTEST-LEVEL ELIGIBILITY DECISION. (2026-08-28.)
 *
 * **The defect these tests exist to hold shut.** Officeholder acquisition finds
 * INCUMBENTS first — an officeholder has a government page, a challenger has a
 * filed form — so every acquisition session moves candidates into `Incumbent`
 * and moves nobody into *provably not the incumbent*. On 2026-08-28 the
 * contests with at least one sourced holder went 17 → 23 of 126 in one session,
 * and the product rendered `Incumbent` on the person we had matched and
 * `Challenger` on everyone else in the same contest.
 *
 * `Challenger` is a sentence about a named person. The evidence behind it was
 * that they were not in a store whose own doc block calls itself *what we have
 * acquired so far*. **That is an acquisition asymmetry reaching a reader as a
 * claim about people, and it is what the gate refuses.**
 *
 * The load-bearing test in this file is
 * *"a KNOWN INCUMBENT renders no label while the contest is unresolved"*. It is
 * built on a FIXTURE rather than the live corpus precisely so it cannot rot as
 * officeholders are acquired: it will fail the day somebody re-adds the
 * easy-positive behaviour, and it will still fail in a year.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  candidateUniverse,
  contestLabelEligibility,
  officeholderUniverse,
  statesFromResolution,
  type CandidateIncumbencyState,
} from "../lib/ballot/contest-universe.ts";
import { contestIncumbency, shapeOfRegistryHolders } from "../lib/ballot/incumbency-resolve.ts";
import { incumbencyLabel, type Incumbency, type IncumbencyDecision } from "../lib/ballot/incumbency.ts";
import { incumbentHolderFor } from "../lib/ballot/incumbent-record.ts";
import { lineupForContest } from "../lib/ballot/general-lineup.ts";
import { claimsInText } from "../lib/text/absence-claims.ts";
import type { SeatHolder } from "../lib/officials/lookup.ts";

const ROOT = join(import.meta.dirname, "..");

/* -------------------------------------------------------------------------- */
/* THE FIXTURE — three candidates, one of them the sitting Mayor               */
/* -------------------------------------------------------------------------- */

/**
 * One contest, held fixed, so the only thing that ever varies between the two
 * halves of the control is WHAT THE OFFICEHOLDER SOURCE CAN ANSWER.
 */
const CANDIDATES = [
  { key: "a", display: "Dana Okonkwo", targetKey: "a" },
  { key: "b", display: "Ruth Vasquez", targetKey: "b" },
  { key: "c", display: "Peter Lindqvist", targetKey: "c" },
];

const CONTEST = {
  id: "fixture:mayor",
  title: "Mayor",
  ocdId: "ocd-division/country:us/state:zz/place:testville",
  federal: false,
  voteFor: 1,
  candidates: CANDIDATES,
};

/** The sitting Mayor, and she is one of the three people on the ballot. */
const SITTING_MAYOR: SeatHolder = {
  id: "plural:fixture-dana-okonkwo",
  name: "Dana Okonkwo",
  officeTitle: "Mayor",
  partyLabel: null,
  websiteUrl: null,
  contactFormUrl: null,
  phone: null,
  email: null,
  campaignUrl: null,
  photoUrl: null,
  termEnd: null,
  birthDate: null,
  provenance: {
    sourceUrl: "https://testville.example.gov/mayor",
    sourceOrg: "Testville",
    collectedAt: "2026-08-28",
    verifiedAt: null,
  },
} as unknown as SeatHolder;

/** A certified nominee list naming all three — so the CANDIDATE side is complete. */
const CERTIFIED = () => ({ source: "the Testville certified nominee list", count: 3 });

const readerLabels = (decisions: ReadonlyMap<string, IncumbencyDecision>): string[] =>
  [...decisions.values()].map((d) => incumbencyLabel(d.standing, d.gap) ?? "");

/* ========================================================================== */
/* CONTROL 3 — THE LOAD-BEARING ONE                                           */
/* ========================================================================== */

test("a KNOWN incumbent renders NO label while the contest is unresolved", async () => {
  /*
   * The officeholder store holds the sitting Mayor and nothing else. It was
   * assembled person by person, so the other two candidates' absence from it is
   * OUR gap. The easy-positive behaviour would render `Incumbent` on Dana
   * Okonkwo and `Challenger` on the other two — which is the false claim.
   */
  const result = await contestIncumbency(CONTEST, async () => null, async () => [SITTING_MAYOR], {
    certifiedNominees: CERTIFIED,
    enumeratedHolders: () => [],
  });

  // The matching layer DID find her. Nothing about this gate is a failure to
  // resolve — that would be a much weaker test.
  assert.equal(result.resolved.get("a")?.standing, "INCUMBENT", "the matcher names the sitting Mayor");

  assert.equal(result.states.get("a"), "INCUMBENT");
  assert.equal(result.states.get("b"), "UNRESOLVED", "absent from an incomplete store is UNRESOLVED");
  assert.equal(result.states.get("c"), "UNRESOLVED");
  assert.equal(result.eligibility.eligible, false);
  assert.equal(result.eligibility.notIncumbent, 0, "NOT_INCUMBENT was never produced here");

  // AND THE WHOLE CONTEST IS QUIET — the matched incumbent included.
  for (const key of ["a", "b", "c"]) {
    assert.equal(result.decisions.get(key)?.standing, "UNKNOWN", `${key} carries no label`);
  }
  const labels = readerLabels(result.decisions);
  assert.equal(new Set(labels).size, 1, "every card in the contest reads the SAME sentence (RULING 42)");
  assert.ok(!labels.includes("Incumbent"), "no reader sees `Incumbent` in this contest");
  assert.ok(!labels.includes("Challenger"), "and no reader sees `Challenger` either");
});

test("the sentence the quiet contest renders is about US, and it is true", async () => {
  const result = await contestIncumbency(CONTEST, async () => null, async () => [SITTING_MAYOR], {
    certifiedNominees: CERTIFIED,
    enumeratedHolders: () => [],
  });
  const line = incumbencyLabel("UNKNOWN", result.decisions.get("a")?.gap) ?? "";

  // We DO hold this seat's holder, so the original sentence would be false
  // about our own sourcing. It says the other thing instead.
  assert.equal(result.decisions.get("a")?.gap, "CONTEST_NOT_ESTABLISHED");
  assert.ok(!line.startsWith("We haven't sourced"), `"${line}" would be untrue about us here`);
  assert.match(line, /^We haven't/, "it still names whose gap it is");
  assert.deepEqual(claimsInText(line), [], `"${line}" asserts something about a candidate`);
  for (const banned of ["UNRESOLVED", "NOT_INCUMBENT", "INCUMBENCY_LABEL_ELIGIBLE", "UNKNOWN"]) {
    assert.ok(!line.includes(banned), `no internal vocabulary reaches a reader (${banned})`);
  }
});

/* ========================================================================== */
/* CONTROL 4 — NOT_INCUMBENT IS ONLY EVER PRODUCED AGAINST A COMPLETE UNIVERSE */
/* ========================================================================== */

test("the SAME contest labels everybody once the officeholder universe enumerates the seat", async () => {
  /*
   * One input changed, and only one: the holders now come from a source that
   * publishes the seat's whole membership, so absence from it is the body's
   * statement rather than ours. Nothing about the candidates moved.
   */
  const result = await contestIncumbency(CONTEST, async () => null, async () => [], {
    certifiedNominees: CERTIFIED,
    enumeratedHolders: () => [
      {
        givenName: "Dana",
        familyName: "Okonkwo",
        personKey: null,
        source: "the Testville charter officers roster",
      },
    ],
  });

  assert.equal(result.eligibility.eligible, true, result.eligibility.reason);
  assert.equal(result.states.get("a"), "INCUMBENT");
  assert.equal(result.states.get("b"), "NOT_INCUMBENT");
  assert.equal(result.states.get("c"), "NOT_INCUMBENT");
  assert.equal(result.eligibility.unresolved, 0);
  assert.deepEqual(readerLabels(result.decisions).sort(), ["Challenger", "Challenger", "Incumbent"]);
});

test("NOT_INCUMBENT is unreachable when the officeholder universe is incomplete", () => {
  // Exhaustive over every answer the matching layer can give.
  const standings: Incumbency[] = ["INCUMBENT", "CHALLENGER", "UNKNOWN"];
  for (const standing of standings) {
    const decisions = new Map<string, IncumbencyDecision>([
      ["x", { standing, basis: "fixture", source: "fixture" }],
    ]);
    const incomplete = statesFromResolution(decisions, ["x"], false);
    assert.notEqual(
      incomplete.get("x"),
      "NOT_INCUMBENT",
      `a ${standing} became a negative claim about a person against an incomplete universe`,
    );
    const complete = statesFromResolution(decisions, ["x"], true);
    const expected: CandidateIncumbencyState =
      standing === "INCUMBENT" ? "INCUMBENT" : standing === "CHALLENGER" ? "NOT_INCUMBENT" : "UNRESOLVED";
    assert.equal(complete.get("x"), expected);
  }
});

test("a candidate the resolution never saw is UNRESOLVED, and the contest is refused", () => {
  const states = statesFromResolution(new Map(), ["a", "b"], true);
  assert.equal(states.get("a"), "UNRESOLVED");
  const eligibility = contestLabelEligibility({
    candidateUniverse: { complete: true, source: "s", reason: "r" },
    officeholderUniverse: { complete: true, source: "s", reason: "r" },
    candidateKeys: ["a", "b", "c"],
    states,
  });
  assert.equal(eligibility.eligible, false);
  assert.equal(eligibility.evaluated, 2);
  assert.match(eligibility.reason, /never evaluated/);
});

/* ========================================================================== */
/* THE TWO UNIVERSES, EVALUATED RATHER THAN ASSUMED                           */
/* ========================================================================== */

test("a filing list is never a complete candidate universe", () => {
  const finding = candidateUniverse({ certified: null, rendered: 5, renderedSource: "the filing list" });
  assert.equal(finding.complete, false);
  assert.match(finding.reason, /filing list is not a nominee list/i);
});

test("a certified list that is not the list on the page is not a complete universe either", () => {
  // The Arizona shape: eight people filed, four were nominated. A reader
  // looking at the eight is not looking at the certified universe.
  const finding = candidateUniverse({
    certified: { source: "the canvass", count: 4 },
    rendered: 8,
    renderedSource: "the filing list",
  });
  assert.equal(finding.complete, false);
  assert.match(finding.reason, /renders 8/);
});

test("a store assembled person by person is never a complete officeholder universe", () => {
  const finding = officeholderUniverse({
    shape: "COLLECTED_PERSON_BY_PERSON",
    source: "the officeholder registry",
    holders: 1,
    seatsThisContestFills: 1,
  });
  assert.equal(finding.complete, false);
  assert.match(finding.reason, /our gap and not a fact about them/);
});

test("the count coincidence cannot buy completeness on its own", () => {
  /*
   * Arizona's Corporation Commission: five members on staggered terms, two
   * seats up in 2026, and this repository holds exactly two holders. The count
   * reconciles and the universe is three people short — which is why the source
   * shape has to be the first gate rather than the count.
   */
  const finding = officeholderUniverse({
    shape: "COLLECTED_PERSON_BY_PERSON",
    source: "the officeholder registry",
    holders: 2,
    seatsThisContestFills: 2,
  });
  assert.equal(finding.complete, false);
});

test("an enumerating source that comes back short is unreconciled, not complete", () => {
  const finding = officeholderUniverse({
    shape: "ENUMERATES_THE_SEAT",
    source: "the body's own roster",
    holders: 1,
    seatsThisContestFills: 2,
  });
  assert.equal(finding.complete, false);
  assert.match(finding.reason, /vacancy/);
});

test("a per-candidate probe can never enumerate anybody it was not handed", () => {
  const finding = officeholderUniverse({
    shape: "PROBED_PER_CANDIDATE",
    source: "the FEC join",
    holders: 2,
    seatsThisContestFills: 2,
  });
  assert.equal(finding.complete, false);
});

test("the holder source shape is read off the holder's own id namespace", () => {
  const id = (v: string) => ({ ...SITTING_MAYOR, id: v }) as SeatHolder;
  assert.equal(shapeOfRegistryHolders([]), "NOTHING_READ");
  assert.equal(shapeOfRegistryHolders([id("congress:C000127")]), "ENUMERATES_THE_SEAT");
  assert.equal(shapeOfRegistryHolders([id("plural:abc")]), "COLLECTED_PERSON_BY_PERSON");
  assert.equal(shapeOfRegistryHolders([id("statewide:az/governor")]), "COLLECTED_PERSON_BY_PERSON");
  assert.equal(
    shapeOfRegistryHolders([id("congress:C000127"), id("plural:abc")]),
    "COLLECTED_PERSON_BY_PERSON",
    "one row from a collection means the seat might hold somebody we have never seen",
  );
});

/* ========================================================================== */
/* CONTROL 1 — A NAMED CONTEST FROM THE LIVE CORPUS THAT IS ELIGIBLE          */
/* ========================================================================== */

interface BallotFile {
  contests: { id: string; title: string; ocdId: string; type: string; voteFor: number }[];
  candidacies: { id: string; contestId: string; familyName: string; givenName: string }[];
}

const AZ = JSON.parse(readFileSync(join(ROOT, "data/ballot/az-pima-2026.json"), "utf8")) as BallotFile;

/** The list the PAGE hands over: certified nominees where a canvass names them. */
async function liveContest(contestId: string) {
  const contest = AZ.contests.find((c) => c.id === contestId);
  assert.ok(contest, `${contestId} is in the committed Arizona ballot`);
  const lineup = lineupForContest(contestId);
  const candidates = lineup
    ? lineup.nominees.map((n) => ({
        key: `${contest.id}|${n.name}`,
        display: n.name,
        targetKey: `${contest.id}|${n.name}`,
      }))
    : AZ.candidacies
        .filter((c) => c.contestId === contestId)
        .map((c) => ({ key: c.id, display: `${c.givenName} ${c.familyName}`, targetKey: c.id }));
  return contestIncumbency(
    {
      id: contest.id,
      title: contest.title,
      ocdId: contest.ocdId,
      federal: false,
      voteFor: contest.voteFor,
      candidates,
    },
    incumbentHolderFor,
  );
}

test("Arizona's U.S. Representative, District 6 is label-eligible, and every candidate is established", async () => {
  /*
   * The one shape in the live corpus where BOTH universes close.
   *
   * - CANDIDATES: the Secretary of State's certified 2026 primary canvass names
   *   the four general-election nominees, and those four are what renders.
   * - OFFICEHOLDERS: a congressional district seats exactly one representative,
   *   and `legislators-current.json` is every sitting member of Congress — 100
   *   senators and 437 representatives, with six unattached rows and all six of
   *   them territory delegates. One seat, one holder, reconciled.
   */
  const result = await liveContest("ballot-az-pima:us-house-6");
  assert.equal(result.eligibility.eligible, true, result.eligibility.reason);
  assert.equal(result.eligibility.total, 4);
  assert.equal(result.eligibility.incumbent, 1);
  assert.equal(result.eligibility.notIncumbent, 3);
  assert.equal(result.eligibility.unresolved, 0);
  assert.equal(
    result.decisions.get("ballot-az-pima:us-house-6|Juan Ciscomani")?.standing,
    "INCUMBENT",
    "the sitting member keeps the label he earned",
  );
});

/* ========================================================================== */
/* CONTROL 2 — A SECOND CONTEST, CHOSEN, EXERCISING THE SAME PATH             */
/* ========================================================================== */

const NH = JSON.parse(readFileSync(join(ROOT, "data/ballot/nh-merrimack-2026.json"), "utf8")) as BallotFile;

test("Merrimack House District 7 has a COMPLETE officeholder universe and is still refused", async () => {
  /*
   * **Chosen for three reasons.** It is the contest the original defect was
   * reported in — Karen Ebel, the sitting Deputy Speaker, rendering as
   * `Challenger`. It reaches completeness by the OTHER route, the New Hampshire
   * General Court publishing its own membership rather than a congressional
   * roster. And it is the case that proves the two conditions are INDEPENDENT:
   * the officeholder universe closes, every candidate is evaluated, nobody is
   * unresolved — and the contest is still silent, because the candidates are
   * the people who FILED for a September primary rather than a certified
   * nominee list.
   *
   * Which is the honest answer. Until that primary is canvassed we do not know
   * that these three are who a reader will choose between.
   */
  const contest = NH.contests.find((c) => c.id === "ballot-nh-merrimack:state-house-merrimack-7");
  assert.ok(contest);
  const candidates = NH.candidacies
    .filter((c) => c.contestId === contest.id)
    .map((c) => ({ key: c.id, display: `${c.givenName} ${c.familyName}`, targetKey: c.id }));

  const result = await contestIncumbency(
    {
      id: contest.id,
      title: contest.title,
      ocdId: contest.ocdId,
      federal: false,
      voteFor: contest.voteFor,
      candidates,
    },
    incumbentHolderFor,
  );

  assert.equal(result.eligibility.officeholderUniverse.complete, true);
  assert.match(result.eligibility.officeholderUniverse.source ?? "", /New Hampshire General Court/);
  assert.equal(result.eligibility.unresolved, 0, "every candidate here IS evaluated");
  assert.equal(result.eligibility.candidateUniverse.complete, false);
  assert.equal(result.eligibility.eligible, false);

  // Ebel is the sitting member and she carries no label either.
  const ebel = [...result.resolved].find(([, d]) => d.standing === "INCUMBENT")?.[0];
  assert.ok(ebel, "the matcher still names the sitting members");
  assert.equal(result.decisions.get(ebel)?.standing, "UNKNOWN");
  assert.ok(!readerLabels(result.decisions).includes("Challenger"));
});

/* ========================================================================== */
/* THE CALL SITE                                                              */
/* ========================================================================== */

test("the ballot page renders the GATED map, never the raw resolution", () => {
  const src = readFileSync(join(ROOT, "app", "ballot", "page.tsx"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");
  assert.ok(src.includes("incumbency.decisions.get(targetKey)"), "the chip reads the gated decisions");
  assert.ok(!src.includes("incumbency.resolved"), "and never reaches around the gate for the raw answer");
  assert.ok(src.includes("voteFor: contestVoteFor"), "the seat count reaches the reconciliation");
});
