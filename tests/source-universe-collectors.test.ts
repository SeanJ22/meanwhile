import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { ROOT } from "./read-code.ts";
import { newZipReadiness, projectionLine, remainderOf } from "../lib/hunt/source-universe.ts";
import type { AcquisitionUniverse, ReaderProjection } from "../lib/hunt/source-universe.ts";
import {
  acquireStatewideIndex,
  countyFromBallot,
  loadCorpus,
  projectionFrom,
  type FilerPage,
  type FilerRow,
} from "../scripts/state-money-nh.mts";

/**
 * **ACQUIRE TO THE AUTHORITATIVE SOURCE UNIVERSE; PROJECT TO THE READER.**
 * (Session C3, lane C, 2026-09-01. RULING 229, item 5c.)
 *
 * ## The measured defect these guards keep closed
 *
 * `scripts/state-money-nh.mts` asked the statewide Campaign Finance System one
 * SURNAME at a time, and the surnames were the ones on the 03255 ballot.
 * `scripts/state-money-nj.mts` asked ELEC for the location codes one county's
 * ballot needed — 37 of the **1,215** the Commission's own dropdown states.
 *
 * Neither was a small corpus. Both meant that **activating a second ZIP started
 * a fresh external hunt** for records the state authority had already published
 * and already owed us.
 *
 * ## What is asserted here, and what is asserted elsewhere
 *
 * These are the ACQUISITION-side guards: the split exists, the projection holds
 * no client, and a corpus that cannot prove its denominator is refused. The
 * READER-side invariant — that a new Arizona ZIP costs zero outbound
 * acquisition — is `tests/new-zip-readiness.test.ts`.
 *
 * Arizona's collector is lane A's file this session and is deliberately not
 * asserted on here; its statewide denominator is that lane's to state.
 */

const NH_CORPUS = join(ROOT, "data", "campaign-finance", "nh-cfs-filer-index-2026.json");
const NJ_UNIVERSE = join(ROOT, "data", "campaign-finance", "nj-elec-location-universe.json");
const NJ_SCRIPT = join(ROOT, "scripts", "state-money-nj.mts");

/* ------------------------------------------------- the vocabulary itself */

test("a projection cannot be stated without the universe it was cut from", () => {
  const universe: AcquisitionUniverse = {
    authority: "A State Regulator",
    unit: "filers",
    statedBy: 5738,
    held: 5738,
    countedBy: "one read of the whole index",
    citation: "a committed corpus",
  };
  const p: ReaderProjection = {
    scope: "one ballot",
    applicable: 28,
    projectionNarrowedFrom: universe,
    answeredFromCorpus: 28,
    requiredFreshAcquisition: [],
  };
  const line = projectionLine(p);
  assert.match(line, /28 filers applicable to one ballot/);
  assert.match(line, /5738 of 5738 stated/, "the line printed a reader count with no denominator");
  assert.equal(newZipReadiness(p).ready, true);
});

test("a projection that went outbound for an already-owed record is NOT READY, and names the rows", () => {
  const universe: AcquisitionUniverse = {
    authority: "A State Regulator",
    unit: "filing locations",
    statedBy: 1215,
    held: 0,
    countedBy: "the dropdown",
    citation: "a committed universe",
  };
  const verdict = newZipReadiness({
    scope: "the 07866 ballot",
    applicable: 37,
    projectionNarrowedFrom: universe,
    answeredFromCorpus: 0,
    requiredFreshAcquisition: ["DOVER TOWN", "BOONTON TOWN"],
  });
  assert.equal(verdict.ready, false);
  assert.match(verdict.why, /DOVER TOWN/, "the verdict summarised the rows instead of naming them");
});

test("a projection that DROPPED applicable rows is NOT READY, and says so differently", () => {
  /*
   * The two failure modes are not the same and must not read the same. Going
   * outbound is work we did; dropping a row is a record a reader silently never
   * saw — and that one reads to them as an absence.
   */
  const verdict = newZipReadiness({
    scope: "a ballot",
    applicable: 10,
    projectionNarrowedFrom: {
      authority: "A State Regulator",
      unit: "filers",
      statedBy: null,
      held: 100,
      countedBy: "a corpus",
      citation: "a corpus",
    },
    answeredFromCorpus: 7,
    requiredFreshAcquisition: [],
  });
  assert.equal(verdict.ready, false);
  assert.match(verdict.why, /neither answered from the corpus nor acquired/);
});

test("the remainder is NAMED, never summarised", () => {
  const universe: AcquisitionUniverse = {
    authority: "A State Regulator",
    unit: "filing locations",
    statedBy: 4,
    held: 2,
    countedBy: "the dropdown",
    citation: "a committed universe",
  };
  const r = remainderOf(universe, ["A", "B"], ["A", "B", "C", "D"]);
  assert.equal(r.outstanding, 2);
  assert.deepEqual(r.names, ["C", "D"]);
  assert.equal(r.of.statedBy, 4, "the remainder lost the denominator it is a remainder OF");
});

/* --------------------------------------------------- New Hampshire, live */

test("NH: the county is derived from the ballot, not written into the module", () => {
  assert.equal(
    countyFromBallot({
      contests: [
        { ocdId: "ocd-division/country:us/state:nh" },
        { ocdId: "ocd-division/country:us/state:nh/county:merrimack" },
      ],
    }),
    "Merrimack",
  );
  assert.equal(
    countyFromBallot({ contests: [{ ocdId: "ocd-division/country:us/state:nh/cd:2" }] }),
    null,
    "a ballot that names no county must return null rather than a guess — the caller supplies the " +
      "fallback, and a derivation that invented a county would filter a ballot that never asked",
  );
});

test("NH: the acquisition asks for the WHOLE index, not for one ballot's surnames", async () => {
  const asked: string[] = [];
  const page: FilerPage = { status: 200, totalItems: 2, items: [] as FilerRow[] };
  const rows: FilerRow[] = [
    {
      filerName: "Friends of Somebody",
      firstnameLastname: "Some Body",
      officeSoughtName: "Governor",
      districtName: null,
      town: "Cheshire",
      electionYear: 2024,
      totalRaised: 1,
      totalSpent: 0,
      filerEntityId: 1,
      electionCycle: "2024",
      filerTypeDesc: "Candidate",
    },
    {
      filerName: "Committee To Elect",
      firstnameLastname: "Other Person",
      officeSoughtName: "Sheriff",
      districtName: null,
      town: "Merrimack",
      electionYear: 2026,
      totalRaised: 2,
      totalSpent: 0,
      filerEntityId: 2,
      electionCycle: "2026",
      filerTypeDesc: "Candidate",
    },
  ];

  const read = await acquireStatewideIndex(
    async ({ surname }) => {
      asked.push(surname);
      return { ...page, items: rows };
    },
    { pageSize: 500 },
  );

  assert.deepEqual(
    asked,
    [""],
    "the acquisition asked for a name. RULING 229: the denominator is the authority's whole universe, " +
      "and asking per surname makes the ballot the denominator again.",
  );
  assert.ok(read.ok);
  assert.equal(
    read.rows.length,
    2,
    "the acquisition dropped a row from another cycle. A corpus filtered to one cycle at read time " +
      "cannot answer about another without going back to the publisher, which is the same defect wearing " +
      "a date instead of a ZIP.",
  );
});

test("NH: the projection holds no client, and a trapped fetch proves it", async () => {
  const corpus = loadCorpus(NH_CORPUS);
  assert.ok(!("error" in corpus), `the held NH corpus is unusable: ${(corpus as { error?: string }).error}`);

  const attempted: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = ((input: unknown) => {
    attempted.push(String(input));
    throw new Error("RULING 229 VIOLATION: the NH projection went to the network");
  }) as typeof globalThis.fetch;
  try {
    const { filersFor, outboundRequests } = projectionFrom(corpus.rows);
    const read = await filersFor("AYOTTE");
    assert.ok(read.ok);
    assert.ok(read.rows.length > 0, "the projection found nothing for a surname the corpus holds");
    assert.equal(outboundRequests(), 0);
  } finally {
    globalThis.fetch = real;
  }
  assert.deepEqual(attempted, [], "the NH projection attempted an outbound request");
});

test("NH: the held corpus proves its denominator against the publisher's own count", () => {
  const corpus = loadCorpus(NH_CORPUS);
  assert.ok(!("error" in corpus));
  const held = corpus as Exclude<typeof corpus, { error: string }>;
  assert.equal(
    held.rows.length,
    held.statedTotalItems,
    "the corpus row count disagrees with the publisher's stated total. An incomplete corpus can never " +
      "be evidence of an absence, and `loadCorpus` refuses one rather than letting a projection assert " +
      "over it.",
  );
  assert.ok(held.statedTotalItems > 5000, `only ${held.statedTotalItems} filers stated — a short read`);
});

test("NH: a corpus shorter than the stated total is REFUSED, not used", () => {
  const held = loadCorpus(NH_CORPUS) as { rows: FilerRow[]; statedTotalItems: number };
  /* The refusal is what keeps a partial from becoming a smaller universe.
     Written against a temporary file so the real corpus is never touched. */
  const tmp = join(ROOT, "data", "campaign-finance", "nh-cfs-filer-index-2026.json");
  const parsed = JSON.parse(readFileSync(tmp, "utf8")) as Record<string, unknown>;
  const short = { ...parsed, rows: held.rows.slice(0, 10) };
  const path = join(ROOT, "tests", "fixtures", "__nh-short-corpus.json");
  writeFileSync(path, JSON.stringify(short), "utf8");
  try {
    const result = loadCorpus(path);
    assert.ok("error" in result, "a corpus 10 rows long against a stated 5,738 was ACCEPTED");
    assert.match((result as { error: string }).error, /never be evidence of an absence/);
  } finally {
    rmSync(path, { force: true });
  }
});

/* ------------------------------------------------------- New Jersey, live */

test("NJ: the acquisition denominator is ELEC's whole location dropdown", () => {
  const doc = JSON.parse(readFileSync(NJ_UNIVERSE, "utf8")) as {
    locationCount: number;
    locations: { name: string; code: string }[];
  };
  assert.equal(
    doc.locations.length,
    doc.locationCount,
    "the stated location count and the listed locations disagree — one of them is not a denominator",
  );
  assert.ok(
    doc.locationCount > 1000,
    `${doc.locationCount} ELEC filing locations recorded. The dropdown carried 1,215 on 2026-09-01, and ` +
      "a much smaller number is a parse failure rather than a smaller New Jersey.",
  );
});

test("NJ: an unacquired ballot location is ROUTE_UNREAD, and never a sourced absence", () => {
  /*
   * Checked in the SOURCE, because the branch only fires for a location the
   * corpus has not reached and the corpus is meant to grow until none are left.
   * A guard that only ran when the backlog was non-empty would stop guarding
   * exactly when the backlog was finally cleared and someone deleted the branch.
   */
  const src = readFileSync(NJ_SCRIPT, "utf8");
  assert.match(
    src,
    /A LOCATION WE HAVE NOT ACQUIRED IS UNREAD, NEVER EMPTY/,
    "the NJ collector no longer distinguishes a location it did not ask from one that holds nothing",
  );
  assert.match(
    src,
    /filingState: "ROUTE_UNREAD"/,
    "the NJ collector has no ROUTE_UNREAD branch. Without one, a location the statewide acquisition " +
      "has not reached falls into the sourced-absence branch and writes a false claim about the " +
      "Commission's holdings.",
  );
});

test("NJ: the walk is bounded by a BATCH over the state, not by one ballot's jurisdictions", () => {
  const src = readFileSync(NJ_SCRIPT, "utf8");
  assert.match(src, /const worklist = \[\.\.\.ballotFirst, \.\.\.everyoneElse\]/);
  assert.match(
    src,
    /ORDER, NOT DENOMINATOR/,
    "the ballot's locations must be a PRIORITY over the statewide worklist, never the worklist itself",
  );
  assert.doesNotMatch(
    src,
    /resolvable\.slice\(0, LIMIT\)/,
    "the walk is still cut down to the ballot's own resolvable locations",
  );
});
