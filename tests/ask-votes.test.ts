import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  federalVoteDenominatorsWithHistory,
  identityKey,
  isoDateOf,
  resolveVoteIdentity,
  statesOf,
  voteEvidenceFor,
} from "../lib/ask/votes.ts";
import { initializeFederalVoteFirstSeed } from "./helpers/federal-vote-first-seed.ts";

await initializeFederalVoteFirstSeed();

const AZ = "ocd-division/country:us/state:az";
const PIMA = "ocd-division/country:us/state:az/county:pima";
const CD6 = "ocd-division/country:us/state:az/cd:6";
const READER = [AZ, PIMA, CD6];

test("historical Ask totals retain the recent chamber denominator under an explicit name", () => {
  const totals = federalVoteDenominatorsWithHistory({ officeholderSeatsMatched: 1,
    rollCallsHeldForTheirChamber: 20, rollCallVotesRecorded: 20, rollCallVotesShown: 20 }, 19);
  assert.deepEqual(totals, { officeholderSeatsMatched: 1,
    recentRollCallsHeldForTheirChamber: 20, recentRollCallVotesRecorded: 20,
    rollCallVotesRecorded: 39, rollCallVotesShown: 39, earlierRollCallVotesShown: 19 });
  assert.equal("rollCallsHeldForTheirChamber" in totals, false);
});

test("(a) Juan Ciscomani's twenty federal roll calls reach Ask, each with its own source", () => {
  const ev = voteEvidenceFor("Juan Ciscomani", { withinStates: statesOf(READER) });

  assert.equal(ev.identity.kind, "JOINED");
  assert.equal(
    ev.identity.kind === "JOINED" ? ev.identity.seat.officeholderId : null,
    "congress:C001133",
    "the join is on the bioguide id the chamber publishes, never on a name",
  );
  assert.equal(
    ev.identity.kind === "JOINED" ? ev.identity.seat.officeTitle : null,
    "U.S. Representative",
    "the office is READ off the roster — the seat he holds, not one he seeks",
  );

  assert.equal(ev.denominators.rollCallVotesRecorded, 20);
  assert.equal(
    ev.denominators.rollCallsHeldForTheirChamber,
    20,
    "the denominator is HIS chamber's roll calls; the Senate's are not votes he could cast",
  );
  assert.ok(ev.records.length > 0);
  assert.equal(ev.denominators.rollCallVotesShown, ev.records.length);

  for (const record of ev.records) {
    assert.equal(record.kind, "ROLL_CALL_VOTE");
    /* **EVERY VOTE CARRIES ITS OWN ROLL CALL.** The constitution's rule is
       verbatim: a vote rendered to a reader points at a specific roll call. A
       record with no source is a record the answer may not assert. */
    assert.match(record.sourceUrl ?? "", /^https:\/\/clerk\.house\.gov\/Votes\//);
    assert.ok(record.retrievedAt, "and when we read it");
    /* Person AND office, never either alone. */
    assert.match(record.text, /^Juan Ciscomani, U\.S\. Representative: voted (YES|NO|PRESENT|NOT_VOTING) on /);
    /* The date is spelled out — a reader surface speaks plain language, and
       neither `21-Jul-2026` nor `2026-07-21` is plain language. */
    assert.doesNotMatch(record.text, /\d{4}-\d{2}-\d{2}/);
    assert.doesNotMatch(record.text, /\d{1,2}-[A-Z][a-z]{2}-\d{4}/);
  }

  assert.equal(ev.records.length, ev.denominators.rollCallVotesRecorded);
  assert.doesNotMatch(
    ev.gaps.map((g) => g.statement).join(" "),
    /most recent are shown/,
  );
});

test("(a) a candidate for one office shows the votes of the office he HOLDS, named as such", () => {
  const ev = voteEvidenceFor("Andy Biggs", { withinStates: ["AZ"] });
  assert.equal(ev.identity.kind, "JOINED");
  assert.equal(ev.denominators.rollCallVotesRecorded, 20);
  for (const record of ev.records) {
    assert.match(record.text, /^Andy Biggs, U\.S\. Representative: /);
    assert.doesNotMatch(record.text, /Governor/i);
  }
});

test("(a) a state legislator's votes carry the LegiScan attribution the licence requires", () => {
  const ev = voteEvidenceFor("Gail Griffin", { withinStates: ["AZ"] });
  assert.equal(ev.identity.kind, "JOINED");
  assert.equal(ev.denominators.rollCallVotesRecorded, 12);
  assert.ok(ev.records.length > 0);
  for (const record of ev.records) {
    assert.equal(record.sourceOrg, "LegiScan (CC BY 4.0)");
    assert.match(record.sourceUrl ?? "", /^https:\/\/legiscan\.com\/AZ\/rollcall\//);
  }
});

test("(b) Warren Petersen resolves, his office resolves, and the empty store is a NAMED gap", () => {
  const ev = voteEvidenceFor("Warren Petersen", { withinStates: ["AZ"] });

  assert.equal(ev.identity.kind, "JOINED", "the person resolves");
  assert.equal(
    ev.identity.kind === "JOINED" ? ev.identity.seat.officeTitle : null,
    "State Senator",
    "the office resolves",
  );
  assert.equal(ev.records.length, 0, "and the store holds nothing");
  assert.equal(ev.denominators.rollCallVotesRecorded, 0);

  assert.equal(ev.gaps.length, 1);
  assert.equal(ev.gaps[0].whose, "OURS");
  assert.match(
    ev.gaps[0].statement,
    /We hold Warren Petersen as State Senator\. None of the \d+ roll calls we have recorded for that legislature carries a vote by them, so we have no voting record to show yet\./,
  );
  assert.ok((ev.denominators.rollCallsHeldForTheirLegislature ?? 0) > 0);

  /* And it never says he did not vote. */
  assert.doesNotMatch(ev.gaps[0].statement, /did not vote|has not voted|no votes cast/i);
});

test("(b) Eva Diaz is the same shape, and is never merged with another Diaz", () => {
  const eva = voteEvidenceFor("Eva Diaz", { withinStates: ["AZ"] });
  assert.equal(eva.identity.kind, "JOINED");
  assert.equal(eva.records.length, 0);
  assert.match(eva.gaps[0].statement, /We hold Eva Diaz as State Senator\./);

  const lupe = voteEvidenceFor("Lupe Diaz", { withinStates: ["AZ"] });
  assert.equal(lupe.denominators.rollCallVotesRecorded, 12);
  for (const record of eva.records) {
    assert.doesNotMatch(record.text, /Lupe/);
  }
});

test("(c) THE ADVERSARIAL CASE: Sally Ann Gonzales fails CLOSED to an honest gap", () => {
  const ev = voteEvidenceFor("Sally Ann Gonzales", { withinStates: ["AZ"] });

  assert.equal(ev.identity.kind, "NAME_FORM_UNCONFIRMED");
  assert.equal(ev.records.length, 0, "NOT ONE vote may be attached");
  assert.equal(ev.gaps.length, 1);
  assert.equal(ev.gaps[0].whose, "OURS");

  assert.match(
    ev.gaps[0].statement,
    /We have not recorded a voting record for Sally Ann Gonzales\. Our roster holds a similarly-named officeholder and we could not confirm from the records we hold that it is the same person/,
  );
  assert.doesNotMatch(ev.gaps[0].statement, /12|twelve|Senator|Sally Gonzales/);

  /* And the record it refused to attach is genuinely there, so this test is
     measuring a refusal rather than an absence. */
  const senator = voteEvidenceFor("Sally Gonzales", { withinStates: ["AZ"] });
  assert.equal(senator.identity.kind, "JOINED");
  assert.equal(senator.denominators.rollCallVotesRecorded, 12);
  assert.equal(
    senator.identity.kind === "JOINED" ? senator.identity.seat.officeTitle : null,
    "State Senator",
    "the roster really does say a different chamber — that is the whole hazard",
  );
});

test("(c) three more name forms fail closed, and the cost of each is recorded", () => {
  const UNLOCKED_BY_A_PUBLISHED_ALIAS: [string, string, number][] = [
    ['Rachel "Jones" Keshel', "Rachel Keshel", 12],
  ];
  for (const [asFiled, asRostered, cost] of UNLOCKED_BY_A_PUBLISHED_ALIAS) {
    const filed = voteEvidenceFor(asFiled, { withinStates: ["AZ"] });
    assert.equal(filed.identity.kind, "JOINED", asFiled);
    assert.equal(filed.denominators.rollCallVotesRecorded, cost, asFiled);
    // It reaches the SAME seat as the rostered form — not merely some seat.
    const rostered = voteEvidenceFor(asRostered, { withinStates: ["AZ"] });
    assert.equal(rostered.identity.kind, "JOINED", asRostered);
    assert.deepEqual(
      filed.identity.kind === "JOINED" && rostered.identity.kind === "JOINED"
        ? filed.identity.seat.officeholderId === rostered.identity.seat.officeholderId
        : false,
      true,
      `${asFiled} and ${asRostered} must resolve to one officeholder, not two`,
    );
  }

  const BLOCKED: [string, string, number][] = [
    ["Adelita Grijalva", "Adelita S. Grijalva", 20],
    ["Alexander Kolodin", "Alex Kolodin", 0],
  ];

  for (const [asFiled, asRostered, cost] of BLOCKED) {
    const filed = voteEvidenceFor(asFiled, { withinStates: ["AZ"] });
    assert.equal(filed.identity.kind, "NAME_FORM_UNCONFIRMED", asFiled);
    assert.equal(filed.records.length, 0, asFiled);
    assert.equal(filed.gaps[0].whose, "OURS", asFiled);

    const rostered = voteEvidenceFor(asRostered, { withinStates: ["AZ"] });
    assert.equal(rostered.identity.kind, "JOINED", asRostered);
    assert.equal(
      rostered.denominators.rollCallVotesRecorded,
      cost,
      `${asRostered} no longer holds ${cost} recorded votes — re-measure the cost of this refusal`,
    );
  }
});

test("(c) the distinct people a loose match would merge stay distinct", () => {
  const NAMES = [
    "Lupe Diaz",
    "Eva Diaz",
    "Alma Hernandez",
    "Consuelo Hernandez",
    "Lydia Hernandez",
  ];
  const seats = new Map<string, string>();
  for (const name of NAMES) {
    const identity = resolveVoteIdentity(name, { withinStates: ["AZ"] });
    assert.equal(identity.kind, "JOINED", `${name} must resolve to a roster row`);
    if (identity.kind !== "JOINED") continue;
    const already = seats.get(identity.seat.officeholderId);
    assert.equal(
      already,
      undefined,
      `${name} and ${already} resolved to the SAME seat — a loose match has crept in`,
    );
    seats.set(identity.seat.officeholderId, name);
  }
  assert.equal(seats.size, NAMES.length);
});

test("(c) a name nobody on the roster carries is its own state, not a near miss", () => {
  const ev = voteEvidenceFor("Katie Hobbs", { withinStates: ["AZ"] });
  assert.equal(ev.identity.kind, "NO_ROSTER_ROW");
  assert.equal(ev.records.length, 0);
  assert.equal(ev.gaps[0].whose, "OURS");
  /* It states OUR scope rather than asserting anything about her. A governor
     casts no roll calls; saying "she has no voting record" would be a claim. */
  assert.match(ev.gaps[0].statement, /A voting record exists only for a seat we hold/);
});

test("nothing here scores, ranks, rates or recommends", () => {
  const source = readFileSync(join(process.cwd(), "lib", "ask", "votes.ts"), "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
  for (const banned of [
    /\bscore\b/i,
    /\brating\b/i,
    /\brank(ed|ing)?\b/i,
    /\balignment\b/i,
    /\brecommend/i,
    /\bagreement\b/i,
    /\bpercent/i,
  ]) {
    assert.doesNotMatch(code, banned, `${banned} has no business in a vote surface`);
  }

  /* And no arithmetic over positions: a count of YES votes is a tally we made,
     and a tally we made is a characterisation of a member's record. */
  assert.doesNotMatch(code, /position === "YES"/);
  assert.doesNotMatch(code, /filter\([^)]*YES/);
});

test("both published date shapes parse, and anything else is null rather than plausible", () => {
  /* The House clerk publishes `21-Jul-2026`; LegiScan publishes `2026-06-13`.
     Both are unambiguous. A misdated roll call is a wrong fact about when a
     government acted, so a third shape returns null and the chamber's own
     string travels instead. */
  assert.equal(isoDateOf("21-Jul-2026"), "2026-07-21");
  assert.equal(isoDateOf("2026-06-13"), "2026-06-13");
  assert.equal(isoDateOf("7/21/26"), null);
  assert.equal(isoDateOf("21-Jly-2026"), null);
  assert.equal(isoDateOf(""), null);
});

test("the identity key drops only what is never identity", () => {
  /* Case, accents and generational suffixes come off — none of them separates
     two records of one human. Nothing else does: a middle name, a middle
     initial, a quoted alias and a given-name variant are each a JUDGEMENT
     about whether two records name one person, and this refuses to make one
     silently. */
  assert.equal(identityKey("Juan Ciscomani"), identityKey("juan  ciscomani"));
  assert.equal(identityKey("José Márquez"), identityKey("Jose Marquez"));
  assert.equal(identityKey("Daniel Butierez Sr."), identityKey("Daniel Butierez"));

  assert.notEqual(identityKey("Sally Ann Gonzales"), identityKey("Sally Gonzales"));
  assert.notEqual(identityKey("Adelita Grijalva"), identityKey("Adelita S. Grijalva"));
  assert.notEqual(identityKey("Alexander Kolodin"), identityKey("Alex Kolodin"));

  assert.equal(identityKey('Rachel "Jones" Keshel'), identityKey("Rachel Keshel"));
  assert.notEqual(identityKey('Rachel "Jones" Keshel'), identityKey("Rachel Jones"));
});

test("the roster scope is read from the reader's own divisions, never from a state list", () => {
  assert.deepEqual(statesOf([AZ, PIMA, CD6]), ["AZ"]);
  assert.deepEqual(statesOf([]), []);
  assert.deepEqual(
    statesOf(["ocd-division/country:us/state:nh/county:merrimack", AZ]).sort(),
    ["AZ", "NH"],
  );
});
