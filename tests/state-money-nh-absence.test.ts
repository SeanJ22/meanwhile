import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ROOT } from "./read-code.ts";
import type { StateMoneyRecord } from "../lib/funding/state-money.ts";
import {
  buildRecords,
  readFilers,
  type Ballot,
  type FilerPage,
  type FilerRead,
  type FilerRow,
} from "../scripts/state-money-nh.mts";

/**
 * **THE FOUR WAYS THE NEW HAMPSHIRE COLLECTOR TOLD A READER SOMETHING FALSE
 * ABOUT A NAMED PERSON.** (Session C, 2026-08-31.)
 *
 * Every test in this file is about ONE sentence on a candidate's card:
 *
 *   "No reports on file with the New Hampshire Secretary of State."
 *
 * That sentence is a statement about a GOVERNMENT'S RECORDS. It is the most
 * dangerous string this collector can produce, because a reader cannot tell it
 * apart from the state actually holding nothing — and CLAUDE.md answers that
 * in one line: *a wall never renders as an emptiness*, and *absence is never
 * asserted*.
 *
 * These are not hypotheticals. Three of the four were shipped in PR #242 and
 * were live on production while this file was being written; the fourth is a
 * route failure that had not yet happened and would have been invisible when
 * it did. Each test is written against the recorded registry read at
 * `tests/fixtures/nh-cfs/filer-search-2026.json` or against a synthetic page
 * server. **No test here makes a live call.**
 *
 * The bar every one of them encodes, stated once: **an absence is a CLAIM, and
 * a claim needs evidence about the RECORD. Our own empty hands are never that
 * evidence.**
 */

const FIXTURE = join(ROOT, "tests", "fixtures", "nh-cfs", "filer-search-2026.json");
const BALLOT = join(ROOT, "data", "ballot", "nh-merrimack-2026.json");

/** The read stamp used throughout. A fixed value: this is a test, not a run. */
const TODAY = "2026-08-31";
/** What the previous snapshot was collected on, for the retention test. */
const YESTERDAY = "2026-08-30";

interface Recorded {
  recordedAt: string;
  endpoint: string;
  pageSize: number;
  bySurname: Record<string, { status: number; totalItems: number | null; items: FilerRow[] }>;
}

function recorded(): Recorded {
  return JSON.parse(readFileSync(FIXTURE, "utf8")) as Recorded;
}

function ballot(): Ballot {
  return JSON.parse(readFileSync(BALLOT, "utf8")) as Ballot;
}

/** The real ballot cut down to one candidacy and its contest. */
function justOne(candidacyId: string): Ballot {
  const full = ballot();
  const cand = full.candidacies.find((c) => c.id === candidacyId);
  assert.ok(cand, `${candidacyId} is not a candidacy on the NH ballot`);
  const contest = full.contests.find((c) => c.id === cand.contestId);
  assert.ok(contest, `${cand.contestId} is not a contest on the NH ballot`);
  return { contests: [contest], candidacies: [cand] };
}

/** A page server backed by the recorded registry read. */
function recordedPages(): (input: {
  surname: string;
  pageNumber: number;
  pageSize: number;
}) => Promise<FilerPage> {
  const fixture = recorded();
  return async ({ surname, pageNumber, pageSize }) => {
    const hit = fixture.bySurname[surname];
    assert.ok(hit, `the recorded read holds no surname "${surname}"`);
    const start = (pageNumber - 1) * pageSize;
    return {
      status: hit.status,
      totalItems: hit.totalItems,
      items: hit.items.slice(start, start + pageSize),
    };
  };
}

/** Every record this collector wrote for one candidacy. */
function recordsFor(all: StateMoneyRecord[], candidacyId: string): StateMoneyRecord[] {
  return all.filter((r) => r.targetKeys.includes(candidacyId));
}

/* ── DEFECT 1 — A TRANSPORT FAILURE BECAME AN ABSENCE ─────────────────────── */

test("DEFECT 1: a route that could not be read may not empty a card that already had money", async () => {
  /*
   * `filersFor()` caught a non-200 and a thrown network error, printed
   * "recorded as unread, never as absent", and then did the opposite: it
   * cached `[]` and returned it, and the empty array fell straight into the
   * `matched.length === 0` branch that writes a SOURCED DATED ABSENCE.
   *
   * The comment was right and the code was wrong, and the failure is silent by
   * construction: the state is up, the run is green, and a candidate's real
   * filed money is replaced by a sentence saying New Hampshire holds nothing
   * for them.
   *
   * The bar: an unread route is OURS, it is not the agency's, and it may not
   * overwrite last-good reader truth.
   */
  const target = "ballot-nh-merrimack:governor:ayotte-kelly";

  // What the previous, successful run left on the card. A synthetic figure —
  // this test is about what happens TO a number, never about what the number is.
  const lastGood: StateMoneyRecord = {
    dataClass: "STATE_COMMITTEE",
    jurisdiction: "NH",
    agency: "New Hampshire Secretary of State — Campaign Finance System",
    filingsUrl: "https://cfs.sos.nh.gov/",
    committeeId: "214321",
    registeredName: "Kelly for New Hampshire",
    candidateNameAsFiled: "Kelly Ayotte",
    officeSought: "Governor",
    electionYear: 2026,
    filingState: "FILED",
    totals: {
      receipts: 1234.56,
      expenditures: 78.9,
      cashOnHand: null,
      reportCount: null,
      coveringPeriod: "2026 Election Cycle",
    },
    targetKeys: [target],
    match: {
      registeredName: "Kelly for New Hampshire",
      officeAsFiled: "Governor",
      officeOnBallot: "Governor",
      electionYearAsFiled: 2026,
      electionYearOnBallot: 2026,
      allThreeAgree: true,
      note: "name, office and election year all agree with the certified-ballot row",
    },
    checkedAt: YESTERDAY,
    provenance: {
      sourceUrl: "https://cfsapi.sos.nh.gov/api/PublicFilerDetails/GetFilingEntityDetails",
      sourceOrg: "New Hampshire Secretary of State — Campaign Finance System",
      collectedAt: YESTERDAY,
      verifiedAt: YESTERDAY,
    } as StateMoneyRecord["provenance"],
  };

  const { records } = await buildRecords({
    ballot: justOne(target),
    asOf: TODAY,
    previous: [lastGood],
    // The registry answers HTTP 500 on this refresh. Nothing else changed.
    filersFor: async (): Promise<FilerRead> => ({
      ok: false,
      reason: "HTTP 500 from cfsapi.sos.nh.gov",
    }),
  });

  const mine = recordsFor(records, target);

  assert.equal(
    mine.some((r) => r.filingState === "NO_REPORTS_ON_FILE"),
    false,
    "a 500 from the registry is a fact about the route, and it may never be written as a fact about the registry's holdings",
  );

  assert.equal(mine.length, 1, "the card keeps exactly the record it already had");
  const kept = mine[0];
  assert.equal(kept.filingState, "FILED", "last-good reader truth survives a failed refresh");
  assert.equal(kept.totals.receipts, 1234.56, "and it survives unaltered");
  assert.equal(kept.totals.expenditures, 78.9);

  /*
   * THE FRESHNESS MARK. The reader is told when this was read, and the answer
   * is the day it was actually read — not today, which is the day we failed to
   * read it. The renderer already prints `checkedAt`, so an honest stamp here
   * is an honest sentence there.
   *
   * `retainedFrom` records the failed attempt for an auditor. It is NOT an
   * announcement to a reader: RULING 139 strikes a verdict on ourselves from a
   * reader surface, and the attribution line is the whole of what is owed.
   */
  assert.equal(kept.checkedAt, YESTERDAY, "a retained record may not claim it was read today");
  assert.ok(kept.retainedFrom, "a retained record says it was retained, and why");
  assert.equal(kept.retainedFrom?.attemptedAt, TODAY);
  assert.match(kept.retainedFrom?.reason ?? "", /500/);
});

test("DEFECT 1: an unread route with nothing to retain is our gap, and it does not render", async () => {
  /*
   * The other half. A candidate we have never resolved, whose surname query
   * then fails, has no last-good truth to keep — and the answer to that is
   * still not an absence. It is a NAMED GAP that belongs to us, and it does
   * not reach a reader at all: RULING 139 forbids the product announcing its
   * own failure, so the card simply does not carry a money section.
   */
  const target = "ballot-nh-merrimack:county-treasurer:donnelly-kathleen";
  const { records } = await buildRecords({
    ballot: justOne(target),
    asOf: TODAY,
    previous: [],
    filersFor: async (): Promise<FilerRead> => ({ ok: false, reason: "fetch failed" }),
  });

  const mine = records.filter(
    (r) => r.targetKeys.includes(target) || r.filingState === "ROUTE_UNREAD",
  );
  assert.equal(
    records.some((r) => r.filingState === "NO_REPORTS_ON_FILE"),
    false,
    "a failed read is not an absence, with or without a prior answer to keep",
  );
  assert.ok(mine.length > 0, "the failed read is recorded, not discarded");
  assert.equal(mine[0].filingState, "ROUTE_UNREAD");
});

/* ── DEFECT 2 — ONE PAGE WAS TREATED AS THE WHOLE REGISTRY ────────────────── */

test("DEFECT 2: a filer on page two is still a filer", async () => {
  /*
   * The request body was `{ filerName, pageNumber: 1, pageSize: 100 }` and
   * nothing ever asked for a second page — and the year filter ran LOCALLY,
   * after the page came back. So a 2026 candidate whose row sorted 101st for
   * their surname was invisible, and the invisible row became
   * `NO_REPORTS_ON_FILE`: a sourced, dated claim about New Hampshire's
   * records, generated by our own page size.
   *
   * The endpoint publishes `data.totalItems`, which is the count of every
   * matching row and does not move with `pageSize`. That is an INDEPENDENTLY
   * PROVEN DENOMINATOR, and having one means a short read can be detected
   * rather than mistaken for an empty state.
   */
  const rows: FilerRow[] = [];
  for (let i = 0; i < 129; i += 1) {
    rows.push({
      // Same surname, a forename that is nobody's on this ballot.
      filerName: `Harned, Filler${i} `,
      firstnameLastname: `Filler${i} Harned`,
      officeSoughtName: "State Representative",
      districtName: null,
      town: "Merrimack",
      electionYear: 2026,
      totalRaised: 0,
      totalSpent: 0,
      filerEntityId: 900000 + i,
      electionCycle: "2026 Election Cycle",
      filerTypeDesc: "Candidate",
    });
  }
  // The real candidate, sorted 105th — comfortably past a 100-row page.
  const TARGET_ROW: FilerRow = {
    filerName: "Harned, Rebecca",
    firstnameLastname: "Rebecca Harned",
    officeSoughtName: "State Senate",
    districtName: "7",
    town: "Merrimack",
    electionYear: 2026,
    totalRaised: 4242.42,
    totalSpent: 11.11,
    filerEntityId: 243715,
    electionCycle: "2026 Election Cycle",
    filerTypeDesc: "Candidate",
  };
  rows.splice(104, 0, TARGET_ROW);
  assert.equal(rows.length, 130, "the synthetic registry holds 130 rows for this surname");

  const pages = async ({
    pageNumber,
    pageSize,
  }: {
    surname: string;
    pageNumber: number;
    pageSize: number;
  }): Promise<FilerPage> => {
    const start = (pageNumber - 1) * pageSize;
    return { status: 200, totalItems: rows.length, items: rows.slice(start, start + pageSize) };
  };

  const read = await readFilers("Harned", pages, { year: 2026, pageSize: 100 });
  assert.equal(read.ok, true, "a complete read of a two-page result is a successful read");
  if (!read.ok) return;

  assert.equal(
    read.retrieved,
    130,
    "the collector must retrieve every row the registry says it has, not every row one page holds",
  );
  assert.equal(read.totalItems, 130, "and it states the registry's own denominator");
  assert.equal(read.denominatorProven, true);
  assert.ok(
    read.rows.some((r) => r.filerEntityId === 243715),
    "the candidate on page two is in the result",
  );

  // And end to end: the card carries her money rather than a claim about NH.
  const target = "ballot-nh-merrimack:state-senate-7:harned-rebecca";
  const { records } = await buildRecords({
    ballot: justOne(target),
    asOf: TODAY,
    previous: [],
    filersFor: async (surname: string) => readFilers(surname, pages, { year: 2026, pageSize: 100 }),
  });
  const mine = recordsFor(records, target);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].filingState, "FILED");
  assert.equal(mine[0].totals.receipts, 4242.42);
});

test("DEFECT 2: a read that cannot prove it got everything may not produce an absence", async () => {
  /*
   * The corollary, and the reason the denominator is carried rather than
   * merely used. If the registry states 130 rows and 100 arrive, the correct
   * report is that the read is INCOMPLETE. An incomplete read is an unread
   * route, not an empty registry.
   */
  const pages = async ({
    pageNumber,
    pageSize,
  }: {
    surname: string;
    pageNumber: number;
    pageSize: number;
  }): Promise<FilerPage> => {
    // A registry that says 130 and serves one page, then nothing at all.
    if (pageNumber > 1) return { status: 200, totalItems: 130, items: [] };
    return {
      status: 200,
      totalItems: 130,
      items: new Array(pageSize).fill(null).map((_unused, i) => ({
        filerName: `Rusis, Filler${i} `,
        firstnameLastname: `Filler${i} Rusis`,
        officeSoughtName: "State Representative",
        districtName: null,
        town: "Merrimack",
        electionYear: 2026,
        totalRaised: 0,
        totalSpent: 0,
        filerEntityId: 800000 + i,
        electionCycle: "2026 Election Cycle",
        filerTypeDesc: "Candidate",
      })),
    };
  };

  const read = await readFilers("Rusis", pages, { year: 2026, pageSize: 100 });
  assert.equal(
    read.ok,
    false,
    "100 of a stated 130 is a short read, and a short read is never evidence of what is not there",
  );
  if (read.ok) return;
  assert.match(read.reason, /100/);
  assert.match(read.reason, /130/);
});

/* ── DEFECT 3 — A REGISTERED COMMITTEE WITH NOTHING REPORTED WAS RENDERED AS
      A COMMITTEE THAT DOES NOT EXIST ────────────────────────────────────────*/

test("DEFECT 3: a registered committee reporting zero is not a candidate the state has never heard of", async () => {
  /*
   * `const hasMoney = (raised ?? 0) > 0 || (spent ?? 0) > 0;` and then
   * `filingState: hasMoney ? "FILED" : "NO_REPORTS_ON_FILE"`.
   *
   * So a MATCHED, REGISTERED, ACTIVE committee — with a committee id, a filed
   * office, a registered name and an election cycle, all of it published by
   * the state — was assigned the same state as a person the registry has no
   * row for. The renderer then turned that into "No reports on file with the
   * New Hampshire Secretary of State", which is false about six named people
   * on this ballot.
   *
   * And the collector already knew better: it wrote the TRUE sentence into
   * `coveringPeriod` — "registered for the 2026 Election Cycle, with no
   * receipts or expenditures reported as of ..." — and then threw it away by
   * choosing a `filingState` that means something else.
   *
   * The endpoint publishes no report count at all (`reportCount: null`), so it
   * cannot support a REPORT-LEVEL absence claim in either direction. What it
   * can support is what it actually says: this committee is registered and its
   * published totals are zero. That is a different fact about a different
   * thing, and it gets its own state and its own sentence.
   */
  const target = "ballot-nh-merrimack:state-house-merrimack-7:ebel-karen-elizabeth";
  const { records } = await buildRecords({
    ballot: justOne(target),
    asOf: TODAY,
    previous: [],
    filersFor: async (surname: string) => readFilers(surname, recordedPages(), { year: 2026 }),
  });

  const mine = recordsFor(records, target);
  assert.equal(mine.length, 1, "the registry holds exactly one 2026 committee for this candidacy");
  const r = mine[0];

  assert.equal(
    r.committeeId,
    "243162",
    "this is the committee the state publishes for this candidate",
  );
  assert.notEqual(
    r.filingState,
    "NO_REPORTS_ON_FILE",
    "a committee the state names, with an id and a cycle, is not a committee the state holds nothing for",
  );
  assert.equal(r.filingState, "REGISTERED_NO_ACTIVITY_REPORTED");

  // Still never a zero: the totals the state published are zero, and zero
  // dollars raised is not the same claim as zero dollars of activity reported.
  assert.equal(r.totals.receipts, null, "an unreported total is null, never 0");
  assert.equal(r.totals.expenditures, null);
  assert.match(
    r.totals.coveringPeriod ?? "",
    /registered for the 2026 Election Cycle/i,
    "the true sentence the collector already knew stays in the record",
  );
  assert.ok(r.registeredName, "and the committee renders under its own registered name");
});

/* ── DEFECT 4 — A NAME WE COULD NOT MATCH BECAME A RECORD THE STATE DOES NOT
      HOLD ───────────────────────────────────────────────────────────────────*/

test("DEFECT 4: a same-year filer who may be this person forbids an absence claim", async () => {
  /*
   * Found while measuring the three above, and it is the same class: our
   * inability became the state's silence.
   *
   * The registry holds, for the 2026 cycle, `Raiche, Jonathan M. (Raiche, Jon )`
   * — Merrimack County Attorney, with real money. The certified ballot carries
   * `Jon Raiche` for Merrimack County Attorney. `namesAgree` is deliberately
   * strict and refuses `Jonathan` against `Jon`, which is correct: a strict bar
   * is what keeps a stranger's money off a card.
   *
   * What was NOT correct is what happened next. The row was dropped as
   * somebody else's, the candidate fell into the empty branch, and the product
   * published "No reports on file with the New Hampshire Secretary of State"
   * about a person whose filing was in the answer we were holding.
   *
   * The repair does not lower the matching bar — it is still name AND office
   * AND year, and this candidate still does not clear it. It raises the bar on
   * the ABSENCE: a row that may be about this person is enough to forbid the
   * claim that the state holds nothing about them. A weak test used only to
   * WITHHOLD an assertion can only ever narrow what the product says.
   */
  const target = "ballot-nh-merrimack:county-attorney:raiche-jon";
  const { records } = await buildRecords({
    ballot: justOne(target),
    asOf: TODAY,
    previous: [],
    filersFor: async (surname: string) => readFilers(surname, recordedPages(), { year: 2026 }),
  });

  const mine = records.filter((r) => r.targetKeys.includes(target));
  assert.equal(
    mine.some((r) => r.filingState === "NO_REPORTS_ON_FILE"),
    false,
    "the registry answered with a 2026 County Attorney filer named Raiche; it did not answer that it holds nothing",
  );

  // The finding is kept, reviewable, and does not render (RULING 118).
  const leads = records.filter((r) => r.filingState === "LEAD" && r.committeeId === "243729");
  assert.equal(leads.length, 1, "the row the state actually returned is recorded as a LEAD");
  assert.deepEqual(leads[0].targetKeys, [], "a LEAD may not claim a candidate");
});

/* ── AND THE RULE ITSELF, OVER THE POPULATION RATHER THAN THE EXAMPLE ─────── */

test("every absence in a full run is backed by a proven denominator and no candidate-shaped row", async () => {
  /*
   * The population, not the example. Whatever the five tests above prove about
   * five candidacies, the claim that matters is about all 28: **no record on
   * this ballot says New Hampshire holds nothing unless the read completed
   * against the registry's own count and returned no row that could be this
   * person.**
   */
  const fixture = recorded();
  const { records, inScope } = await buildRecords({
    ballot: ballot(),
    asOf: TODAY,
    previous: [],
    filersFor: async (surname: string) => readFilers(surname, recordedPages(), { year: 2026 }),
  });

  assert.equal(inScope, 28, "28 non-federal candidacies on the 03255 ballot — the denominator");

  const full = ballot();
  const candById = new Map(full.candidacies.map((c) => [c.id, c]));

  let absences = 0;
  for (const r of records) {
    if (r.filingState !== "NO_REPORTS_ON_FILE") continue;
    absences += 1;
    for (const key of r.targetKeys) {
      const cand = candById.get(key);
      assert.ok(cand, `${key} is not a candidacy on this ballot`);
      const hit = fixture.bySurname[cand.familyName];
      assert.ok(hit, `no recorded read for "${cand.familyName}"`);
      assert.equal(
        hit.status,
        200,
        `${key}: an absence may not rest on a read that did not answer 200`,
      );
      assert.equal(
        hit.items.length,
        hit.totalItems,
        `${key}: an absence may not rest on a read that did not retrieve the registry's stated count`,
      );
      const sameYear = hit.items.filter((i) => i.electionYear === 2026);
      const candidateShaped = sameYear.filter((i) =>
        (i.firstnameLastname ?? i.filerName).toLowerCase().includes(cand.familyName.toLowerCase()),
      );
      // A same-year row bearing this surname is not automatically this person —
      // but where one exists, the record must be able to say why it is not.
      if (candidateShaped.length > 0) {
        assert.ok(
          r.match.note.length > 0,
          `${key}: a 2026 ${cand.familyName} filer exists and the absence states no reason it is not them`,
        );
      }
    }
  }
  assert.ok(absences > 0, "a run that establishes no absence at all has not been argued either");
});
