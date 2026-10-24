

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  candidateUniverse,
  contestLabelEligibility,
  officeholderUniverse,
  reconcileCandidateIdentities,
  statesFromResolution,
  type CandidateIncumbencyState,
} from "../lib/ballot/contest-universe.ts";
import { contestIncumbency } from "../lib/ballot/incumbency-resolve.ts";
import { incumbencyLabel, type Incumbency, type IncumbencyDecision } from "../lib/ballot/incumbency.ts";
import { refreshNhSeatHolders } from "../lib/ballot/seat-holders.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { claimsInText } from "../lib/text/absence-claims.ts";
import type { SeatHolder } from "../lib/officials/lookup.ts";
import { installRegistryAuthority } from "./helpers/promoted-fixtures.ts";

await installRegistryAuthority();

const ROOT = join(import.meta.dirname, "..");

const nhSeatHolderAuthority = await refreshNhSeatHolders({ store: new MemoryRoutineDataStore() });
assert.equal(
  nhSeatHolderAuthority.kind,
  "BOOTSTRAP",
  "the deterministic test reads NH membership through the permanent promoted-or-first-seed authority",
);

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

const SITTING_MAYOR: SeatHolder = {
  id: "roster:fixture-dana-okonkwo",
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

const CERTIFIED = () => ({
  source: "the Testville certified nominee list",
  names: ["Dana Okonkwo", "Ruth Vasquez", "Peter Lindqvist"],
});

const readerLabels = (decisions: ReadonlyMap<string, IncumbencyDecision>): string[] =>
  [...decisions.values()].map((d) => incumbencyLabel(d.standing, d.gap) ?? "");

test("a KNOWN incumbent renders the POSITIVE label; nobody is called a challenger", async () => {

  const result = await contestIncumbency(CONTEST, async () => null, async () => [SITTING_MAYOR], {
    certifiedNominees: CERTIFIED,
    enumeratedHolders: () => [],
  });
  assert.equal(result.resolved.get("a")?.standing, "INCUMBENT", "the matcher names the sitting Mayor");

  assert.equal(result.states.get("a"), "INCUMBENT");
  assert.equal(result.states.get("b"), "UNRESOLVED", "absent from an incomplete store is UNRESOLVED");
  assert.equal(result.states.get("c"), "UNRESOLVED");
  assert.equal(result.eligibility.eligible, false);
  assert.equal(result.eligibility.notIncumbent, 0, "NOT_INCUMBENT was never produced here");
  assert.equal(result.decisions.get("a")?.standing, "INCUMBENT");
  for (const key of ["b", "c"]) {
    assert.equal(result.decisions.get(key)?.standing, "UNKNOWN", `${key} carries no label`);
  }
  const labels = readerLabels(result.decisions);
  assert.equal(
    new Set(labels.filter((l) => l !== "Incumbent")).size,
    1,
    "every card that is not the sourced incumbent reads the SAME sentence as the others, so " +
      "none of them wears a mark naming it as the thin one",
  );
  assert.ok(
    !labels.includes("Challenger"),
    "and NO reader sees `Challenger` — that is the asserted absence, and it still needs the " +
      "officeholder universe this store cannot supply",
  );
});

test("the sentence the quiet contest renders is about US, and it is true", async () => {
  const result = await contestIncumbency(CONTEST, async () => null, async () => [SITTING_MAYOR], {
    certifiedNominees: CERTIFIED,
    enumeratedHolders: () => [],
  });

  const line = incumbencyLabel("UNKNOWN", result.decisions.get("b")?.gap) ?? "";
  assert.equal(result.decisions.get("b")?.gap, "CONTEST_NOT_ESTABLISHED");
  assert.ok(!line.startsWith("We haven't sourced"), `"${line}" would be untrue about us here`);
  assert.match(line, /^We haven't/, "it still names whose gap it is");
  assert.deepEqual(claimsInText(line), [], `"${line}" asserts something about a candidate`);
  for (const banned of ["UNRESOLVED", "NOT_INCUMBENT", "INCUMBENCY_LABEL_ELIGIBLE", "UNKNOWN"]) {
    assert.ok(!line.includes(banned), `no internal vocabulary reaches a reader (${banned})`);
  }
});

test("the SAME contest labels everybody once the officeholder universe enumerates the seat", async () => {

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
    candidateUniverse: { complete: true, contradicted: false, source: "s", reason: "r" },
    officeholderUniverse: { complete: true, contradicted: false, source: "s", reason: "r" },
    candidateKeys: ["a", "b", "c"],
    states,
  });
  assert.equal(eligibility.eligible, false);
  assert.equal(eligibility.evaluated, 2);
  assert.match(eligibility.reason, /never evaluated/);
});

test("a filing list is never a complete candidate universe", () => {
  const finding = candidateUniverse({
    certified: null,
    rendered: ["A One", "B Two", "C Three", "D Four", "E Five"],
    renderedSource: "the filing list",
  });
  assert.equal(finding.complete, false);
  assert.match(finding.reason, /filing list is not a nominee list/i);
});

test("a certified list that is not the list on the page is not a complete universe either", () => {
  const finding = candidateUniverse({
    certified: {
      source: "the canvass",
      names: ["Katie Hobbs", "Andy Biggs", "Risa Lombardo", "Teri Ann Hourihan"],
    },
    rendered: [
      "Katie Hobbs",
      "Teri Ann Hourihan",
      "Risa Lombardo",
      "Hugh Lytle",
      "Andy Biggs",
      "Ken Miceli",
      "Scott Neely",
      "David Schweikert",
    ],
    renderedSource: "the filing list",
  });
  assert.equal(finding.complete, false);
  assert.match(finding.reason, /renders 8/);
  for (const extra of ["Hugh Lytle", "Ken Miceli", "Scott Neely", "David Schweikert"]) {
    assert.ok(finding.reason.includes(extra), `the reason names ${extra}`);
  }
});

test("certified [A,B] against rendered [A,C] is REFUSED even though the counts match", () => {
  const finding = candidateUniverse({
    certified: { source: "the canvass", names: ["Ada Nakamura", "Bruno Salcedo"] },
    rendered: ["Ada Nakamura", "Clara Devereaux"],
    renderedSource: "the filed-candidate record",
  });

  assert.equal(finding.complete, false, "two lists of length 2 are not the same two people");
  assert.ok(
    finding.reason.includes("Bruno Salcedo"),
    "it names the certified nominee the reader never sees",
  );
  assert.ok(
    finding.reason.includes("Clara Devereaux"),
    "and it names the person on the page the canvass does not certify",
  );
  assert.match(finding.reason, /count that matches would still not make two lists the same people/);
});

test("the same people in a different order reconcile — this is set membership, not a zip", () => {
  const finding = candidateUniverse({
    certified: {
      source: "the canvass",
      names: ["Ada Nakamura", "Bruno Salcedo", "Clara Devereaux"],
    },
    rendered: ["Clara Devereaux", "Ada Nakamura", "Bruno Salcedo"],
    renderedSource: "the filed-candidate record",
  });
  assert.equal(finding.complete, true, finding.reason);
});

test("the alias the record itself prints resolves, and does not read as a mismatch", () => {

  const finding = candidateUniverse({
    certified: {
      source: "the Arizona SoS 2026 primary canvass",
      names: ['Walter "Les" Presmyk', "Daniel Francis Butierez Sr."],
    },
    rendered: ["Les Presmyk", "Daniel F. Butierez"],
    renderedSource: "a municipal roster",
  });
  assert.equal(finding.complete, true, finding.reason);

  const pairs = reconcileCandidateIdentities(
    ['Walter "Les" Presmyk', "Daniel Francis Butierez Sr."],
    ["Les Presmyk", "Daniel F. Butierez"],
  );
  assert.deepEqual(
    pairs.pairs.map((p) => [p.certified, p.rendered]),
    [
      ['Walter "Les" Presmyk', "Les Presmyk"],
      ["Daniel Francis Butierez Sr.", "Daniel F. Butierez"],
    ],
    "and it paired the right two people with each other",
  );
});

test("a name that could be two people on the other list is AMBIGUOUS, never chosen between", () => {
  const check = reconcileCandidateIdentities(
    ["Robert Ellery Vance", "Rob Vance"],
    ["Robert Vance", "Robert E. Vance"],
  );
  assert.equal(check.reconciled, false);
  assert.ok(check.ambiguous.length > 0, "the failure is ambiguity, not absence");
  assert.deepEqual(check.missingFromRendered, [], "nobody here is simply missing");
});

test("a blank certified name fails closed rather than matching anything", () => {
  const check = reconcileCandidateIdentities(["", "Bruno Salcedo"], ["Ada Nakamura", "Bruno Salcedo"]);
  assert.equal(check.reconciled, false);
  assert.deepEqual(check.missingFromRendered, [""], "an unusable identity is never invented past");
  assert.deepEqual(check.absentFromCertified, ["Ada Nakamura"]);
});

test("an UNRESOLVED identity silences EVERY candidate-level label in the contest", async () => {

  const result = await contestIncumbency(
    {
      ...CONTEST,
      candidates: [
        { key: "a", display: "Dana Okonkwo", targetKey: "a" },
        { key: "b", display: "Ruth Vasquez-Oyelaran", targetKey: "b" },
        { key: "c", display: "Peter Lindqvist", targetKey: "c" },
      ],
    },
    async () => null,
    async () => [],
    {
      certifiedNominees: CERTIFIED,
      enumeratedHolders: () => [
        {
          givenName: "Dana",
          familyName: "Okonkwo",
          personKey: null,
          source: "the Testville charter officers roster",
        },
      ],
    },
  );

  assert.equal(
    result.eligibility.officeholderUniverse.complete,
    true,
    "the officeholder side is deliberately complete — the candidate side is the only failure",
  );
  assert.equal(result.eligibility.candidateUniverse.complete, false);
  assert.equal(result.eligibility.eligible, false);
  assert.equal(result.resolved.get("a")?.standing, "INCUMBENT", "the matcher still names the Mayor");
  for (const key of ["a", "b", "c"]) {
    assert.equal(result.decisions.get(key)?.standing, "UNKNOWN", `${key} carries no label`);
  }
  const labels = readerLabels(result.decisions);
  assert.equal(new Set(labels).size, 1, "one sentence across the contest");
  assert.ok(!labels.includes("Challenger"), "no NOT_INCUMBENT reached a reader");
  assert.ok(!labels.includes("Incumbent"));
});

test("the mismatch sentence is plain language and names whose gap it is", () => {
  const finding = candidateUniverse({
    certified: { source: "the canvass", names: ["Ada Nakamura", "Bruno Salcedo"] },
    rendered: ["Ada Nakamura", "Clara Devereaux"],
    renderedSource: "the filed-candidate record",
  });
  assert.match(finding.reason, /we are showing/);
  assert.match(finding.reason, /we are not showing/);
  for (const banned of ["UNRESOLVED", "NOT_INCUMBENT", "NO_SOURCE_FOUND", "UNKNOWN", "ocd-division"]) {
    assert.ok(!finding.reason.includes(banned), `no internal vocabulary reaches a reader (${banned})`);
  }
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


test("the ballot page renders the GATED map, never the raw resolution", () => {
  const src = readFileSync(join(ROOT, "app", "ballot", "page.tsx"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");
  assert.ok(src.includes("resolvedStanding?.decisions.get(targetKey)"), "the chip reads the gated decisions");
  assert.ok(!src.includes("resolvedStanding?.resolved"), "and never reaches around the gate for the raw answer");
});
