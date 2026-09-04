import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  identityKey,
  isoDateOf,
  resolveVoteIdentity,
  statesOf,
  voteEvidenceFor,
} from "../lib/ask/votes.ts";

/**
 * **ASK-06 — CANDIDATE VOTES REACH ASK.** (2026-08-28.)
 *
 * The store existed and the door did not. `data/votes/votes-snapshot.json` and
 * `data/votes/state-votes-snapshot.json` have held 12,234 recorded positions
 * across 1,157 rostered officeholders for weeks, and grepping the sixteen
 * files of `lib/ask/` for `VOTE`, `ROLL_CALL`, `rollCall` or `votes` returned
 * nothing at all: `EvidenceRecord.kind` had sixteen members and none of them
 * was a vote. A reader asking what their representative had actually DONE got
 * the honest-gap sentence over a store holding twenty of his roll calls.
 *
 * ## What these tests are really about
 *
 * Not "can we find the votes" — that part is a filter over an array. The whole
 * risk in this feature is IDENTITY, and it is asymmetric in a way that decides
 * the design:
 *
 * * A missed join costs real votes and reads as an HONEST GAP.
 * * A wrong join reads as a confident, sourced, completely FALSE statement
 *   about how a named person voted.
 *
 * So the join is exact and it fails closed, and most of what is asserted below
 * is the refusals. Every one of them is measured against the real committed
 * rosters rather than a fixture, because a fixture would prove the matcher
 * matches itself.
 */

const AZ = "ocd-division/country:us/state:az";
const PIMA = "ocd-division/country:us/state:az/county:pima";
const CD6 = "ocd-division/country:us/state:az/cd:6";
const READER = [AZ, PIMA, CD6];

/* ══════════════════════════════════════════════════════════════════════
   (a) AN INCUMBENT WITH VOTES
   ══════════════════════════════════════════════════════════════════════ */

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
  /*
   * **ANDY BIGGS IS THE CASE THAT DECIDES THE OFFICE RULE.** He is on the
   * Arizona ballot for GOVERNOR and he is a sitting U.S. Representative with
   * twenty recorded federal votes. Both facts are true and only one of them is
   * where the votes came from.
   *
   * Suppressing them because the offices differ would delete a real public
   * record from the one surface a voter reads before voting. Printing them
   * under "candidate for Governor" would say he cast them as a gubernatorial
   * candidate. The record names the seat, so it can do neither.
   */
  const ev = voteEvidenceFor("Andy Biggs", { withinStates: ["AZ"] });
  assert.equal(ev.identity.kind, "JOINED");
  assert.equal(ev.denominators.rollCallVotesRecorded, 20);
  for (const record of ev.records) {
    assert.match(record.text, /^Andy Biggs, U\.S\. Representative: /);
    assert.doesNotMatch(record.text, /Governor/i);
  }
});

test("(a) a state legislator's votes carry the LegiScan attribution the licence requires", () => {
  /*
   * CC BY 4.0 requires attribution wherever the data appears, and the source
   * line is where it appears in an Ask answer. Derived from the one constant
   * in `lib/sources/legiscan/types.ts` so a second surface cannot ship a
   * variant of the licence string or forget it.
   */
  const ev = voteEvidenceFor("Gail Griffin", { withinStates: ["AZ"] });
  assert.equal(ev.identity.kind, "JOINED");
  assert.equal(ev.denominators.rollCallVotesRecorded, 12);
  assert.ok(ev.records.length > 0);
  for (const record of ev.records) {
    assert.equal(record.sourceOrg, "LegiScan (CC BY 4.0)");
    assert.match(record.sourceUrl ?? "", /^https:\/\/legiscan\.com\/AZ\/rollcall\//);
  }
});

/* ══════════════════════════════════════════════════════════════════════
   (b) A CANDIDATE WITH NO HELD VOTING RECORD
   ══════════════════════════════════════════════════════════════════════ */

test("(b) Warren Petersen resolves, his office resolves, and the empty store is a NAMED gap", () => {
  /*
   * **THE THREE THINGS THIS MUST NOT BE.**
   *
   * He IS on the roster — `plural:66e496a4-…`, State Senator — and the store
   * holds ZERO positions for him. So:
   *
   * 1. Not SILENCE. Silence under a candidate's name reads as "nothing to
   *    say about how he votes", which is a claim about him.
   * 2. Not "no votes cast". That is a claim about a person built entirely out
   *    of OUR collection state, and it is the absence-as-assertion the
   *    constitution forbids by name.
   * 3. Not THEIRS. The legislature published its roll calls; what is missing
   *    is our recording of his positions in them. The gap is ours.
   */
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
  /*
   * **THE DENOMINATOR IS IN THE SENTENCE**, so a reader can tell "we hold 24
   * roll calls and none records a vote by him" from "we hold no roll calls at
   * all". Those are different facts and they read identically without it.
   */
  assert.ok((ev.denominators.rollCallsHeldForTheirLegislature ?? 0) > 0);

  /* And it never says he did not vote. */
  assert.doesNotMatch(ev.gaps[0].statement, /did not vote|has not voted|no votes cast/i);
});

test("(b) Eva Diaz is the same shape, and is never merged with another Diaz", () => {
  const eva = voteEvidenceFor("Eva Diaz", { withinStates: ["AZ"] });
  assert.equal(eva.identity.kind, "JOINED");
  assert.equal(eva.records.length, 0);
  assert.match(eva.gaps[0].statement, /We hold Eva Diaz as State Senator\./);

  /*
   * **THE CONTROL.** Lupe Diaz holds twelve recorded votes. A surname join, or
   * a surname-plus-initial join, would hand them to Eva — a confident, sourced,
   * false statement about how a named person voted. Her answer holds none.
   */
  const lupe = voteEvidenceFor("Lupe Diaz", { withinStates: ["AZ"] });
  assert.equal(lupe.denominators.rollCallVotesRecorded, 12);
  for (const record of eva.records) {
    assert.doesNotMatch(record.text, /Lupe/);
  }
});

/* ══════════════════════════════════════════════════════════════════════
   (c) THE ADVERSARIAL IDENTITY CASES
   ══════════════════════════════════════════════════════════════════════ */

test("(c) THE ADVERSARIAL CASE: Sally Ann Gonzales fails CLOSED to an honest gap", () => {
  /*
   * **THE WHOLE OF ASK-06 IS DECIDED HERE.**
   *
   * The ballot's District 20 State REPRESENTATIVE line carries *Sally Ann
   * Gonzales*. The roster carries *Sally Gonzales*, a State SENATOR, with
   * twelve recorded roll calls. Almost certainly one person.
   *
   * | Choice | Cost |
   * |---|---|
   * | Join | twelve votes cast in the SENATE attached to a HOUSE candidacy — a false claim about a named person's record |
   * | Refuse | twelve real public votes not shown — an honest gap |
   *
   * There is no version of this where guessing is the careful option. The
   * roster says a different chamber; the names differ; nothing published joins
   * them. `lib/ballot/incumbency.ts` already takes exactly this posture for
   * exactly this reason, and it took it after a fourteen-year incumbent was
   * publicly labelled a challenger.
   */
  const ev = voteEvidenceFor("Sally Ann Gonzales", { withinStates: ["AZ"] });

  assert.equal(ev.identity.kind, "NAME_FORM_UNCONFIRMED");
  assert.equal(ev.records.length, 0, "NOT ONE vote may be attached");
  assert.equal(ev.gaps.length, 1);
  assert.equal(ev.gaps[0].whose, "OURS");

  /*
   * The sentence says we could not confirm, and stops. It does NOT name the
   * near miss, does not count her votes, and does not say the two are or are
   * not the same person — each of those would be the claim we cannot source,
   * and printing "Sally Gonzales, State Senator, 12 votes" under this
   * candidacy would make the join in the reader's head instead of in the code.
   */
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
  /*
   * Every row below is a REAL public voting record this product will not show,
   * and each is the right call for the Sally Gonzales reason. They are pinned
   * with their costs so the day a stable identifier makes them joinable, this
   * test fails and says exactly what was unlocked.
   *
   *   Adelita Grijalva        vs  Adelita S. Grijalva   — 20 federal votes
   *   Rachel "Jones" Keshel   vs  Rachel Keshel         — 12 state votes
   *   Alexander Kolodin       vs  Alex Kolodin          — 0 votes today
   *
   * **The fix is never a looser matcher.** Dropping middle initials, quoted
   * aliases or given-name variants also merges Lupe / Genoveva / Eva Diaz and
   * Alma / Consuelo / Lydia Hernandez — six distinct sitting legislators,
   * three of them holding twelve recorded votes each.
   */
  /*
   * **ONE OF THESE WAS UNLOCKED WHILE THIS TEST WAS BEING WRITTEN, AND THIS IS
   * THE TEST DOING ITS JOB.** (2026-08-28, at integration.)
   *
   * `Rachel "Jones" Keshel` vs `Rachel Keshel` now JOINS, and the twelve votes
   * are shown. The unlock is not a looser matcher and not a stable identifier
   * — it is that a QUOTED ALIAS IS PUBLISHED, IN QUOTATION MARKS, BY THE
   * RECORD ITSELF, so removing it is reading the record rather than making a
   * judgement about it. `nameParts` extracts it as an alternative given name;
   * the given name and the surname still have to match EXACTLY, and
   * `resolveIdentity` still refuses unless exactly one roster row matches.
   *
   * The distinction that keeps this honest is the one immediately below: an
   * UNQUOTED middle name or initial is not an alias, and `Sally Ann Gonzales`,
   * `Adelita S. Grijalva` and `Alex Kolodin` are all still refused. The
   * companion test proves the six Diaz and Hernandez legislators stay distinct.
   */
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
  /*
   * The other side of the same rule, measured. If any two of these ever
   * resolve to one seat, a reader is being shown one person's votes under
   * another person's name.
   */
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

test("(c) two people of one exact name is a REFUSAL, and the state exists before it is needed", () => {
  /*
   * **MEASURED: zero exact full-name collisions across 1,157 officeholders.**
   * So this branch is unreachable against today's committed rosters — which is
   * precisely why it is asserted directly rather than left to be discovered by
   * the first state where two legislators share a name.
   *
   * The refusal is the same shape as every other: nothing attached, a named
   * gap, and no choice made between two named people.
   */
  const rosters = ["04", "33", "34", "us"].map(
    (scope) =>
      JSON.parse(
        readFileSync(
          join(process.cwd(), ...(scope === "us"
            ? ["lib", "registry", `officeholders-${scope}.json`]
            : ["data", "states", ({ "04": "az", "33": "nh", "34": "nj" } as Record<string, string>)[scope], "officials", `officeholders-${scope}.json`])),
          "utf8",
        ),
      ) as { officeholders: { name: string }[] },
  );
  const seen = new Map<string, number>();
  for (const roster of rosters) {
    for (const holder of roster.officeholders) {
      const key = identityKey(holder.name);
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
  }
  const collisions = [...seen.entries()].filter(([, n]) => n > 1);
  assert.deepEqual(
    collisions.map(([k]) => k),
    [],
    "the measurement moved: an exact full-name collision now exists, and the AMBIGUOUS_NAME branch is live. " +
      "Re-read it and confirm it still refuses rather than choosing.",
  );
});

/* ══════════════════════════════════════════════════════════════════════
   THE RULES THE RECORDS THEMSELVES OBEY
   ══════════════════════════════════════════════════════════════════════ */

test("nothing here scores, ranks, rates or recommends", () => {
  /*
   * `lib/votes/types.ts` states it for the store and it binds just as hard on
   * a surface built from the store: no record may carry a score, rating, rank,
   * match, fit, grade, alignment or recommendation, and the product never
   * tells anyone how to vote. A vote surface is where such a thing would
   * arrive disguised as helpfulness.
   */
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

  /*
   * A QUOTED alias is the one thing here that is not a judgement: the record
   * prints it in quotation marks as an annotation on the name, so dropping it
   * reads the record rather than deciding something about it. The given name
   * and the surname still have to match exactly, and one key still has to
   * match exactly one roster row.
   *
   * The line above it is the proof this is not a loose matcher: `Sally Ann
   * Gonzales` carries an UNQUOTED middle name and stays separate.
   */
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

  /*
   * And it BINDS: a name scoped to Arizona must not reach a New Hampshire
   * seat. Without this, a name typed on one ballot could pick up another
   * state's legislator's record — the substitution defect with a roll call
   * attached to it.
   */
  const nh = JSON.parse(
    readFileSync(join(process.cwd(), "data", "states", "nh", "officials", "officeholders-33.json"), "utf8"),
  ) as { officeholders: { name: string }[] };
  const someNewHampshireMember = nh.officeholders[0].name;
  assert.equal(
    resolveVoteIdentity(someNewHampshireMember, { withinStates: ["AZ"] }).kind !== "JOINED",
    true,
    "a New Hampshire member resolved inside an Arizona-scoped question",
  );
  assert.equal(
    resolveVoteIdentity(someNewHampshireMember, { withinStates: ["NH"] }).kind,
    "JOINED",
  );
});
