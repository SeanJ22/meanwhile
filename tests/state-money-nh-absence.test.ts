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

const FIXTURE = join(ROOT, "tests", "fixtures", "nh-cfs", "filer-search-2026.json");

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

/** Ballot rows for the candidacies these tests examine, as the NH ballot source publishes them. */
const BALLOT_ROWS: readonly { contest: Ballot["contests"][number]; candidacy: Ballot["candidacies"][number] }[] = [
  { contest: { id: "ballot-nh-merrimack:governor", title: "Governor", ocdId: "ocd-division/country:us/state:nh" }, candidacy: { id: "ballot-nh-merrimack:governor:ayotte-kelly", contestId: "ballot-nh-merrimack:governor", familyName: "Ayotte", givenName: "Kelly" } },
  { contest: { id: "ballot-nh-merrimack:state-senate-7", title: "State Senator, District 7", ocdId: "ocd-division/country:us/state:nh/sldu:7" }, candidacy: { id: "ballot-nh-merrimack:state-senate-7:harned-rebecca", contestId: "ballot-nh-merrimack:state-senate-7", familyName: "Harned", givenName: "Rebecca" } },
  { contest: { id: "ballot-nh-merrimack:state-house-merrimack-7", title: "State Representative, Merrimack County District 7", ocdId: "ocd-division/country:us/state:nh/sldl:607" }, candidacy: { id: "ballot-nh-merrimack:state-house-merrimack-7:ebel-karen-elizabeth", contestId: "ballot-nh-merrimack:state-house-merrimack-7", familyName: "Ebel", givenName: "Karen Elizabeth" } },
  { contest: { id: "ballot-nh-merrimack:county-attorney", title: "Merrimack County Attorney", ocdId: "ocd-division/country:us/state:nh/county:merrimack" }, candidacy: { id: "ballot-nh-merrimack:county-attorney:raiche-jon", contestId: "ballot-nh-merrimack:county-attorney", familyName: "Raiche", givenName: "Jon" } },
  { contest: { id: "ballot-nh-merrimack:county-treasurer", title: "Merrimack County Treasurer", ocdId: "ocd-division/country:us/state:nh/county:merrimack" }, candidacy: { id: "ballot-nh-merrimack:county-treasurer:donnelly-kathleen", contestId: "ballot-nh-merrimack:county-treasurer", familyName: "Donnelly", givenName: "Kathleen" } },
];

/** One candidacy and its contest. */
function justOne(candidacyId: string): Ballot {
  const row = BALLOT_ROWS.find((r) => r.candidacy.id === candidacyId);
  assert.ok(row, `${candidacyId} is not a candidacy in this test's ballot`);
  return { contests: [row.contest], candidacies: [row.candidacy] };
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

test("DEFECT 1: a route that could not be read may not empty a card that already had money", async () => {
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

  assert.equal(kept.checkedAt, YESTERDAY, "a retained record may not claim it was read today");
  assert.ok(kept.retainedFrom, "a retained record says it was retained, and why");
  assert.equal(kept.retainedFrom?.attemptedAt, TODAY);
  assert.match(kept.retainedFrom?.reason ?? "", /500/);
});

test("DEFECT 1: an unread route with nothing to retain is our gap, and it does not render", async () => {
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

test("DEFECT 2: a filer on page two is still a filer", async () => {
  const rows: FilerRow[] = [];
  for (let i = 0; i < 129; i += 1) {
    rows.push({
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

test("DEFECT 3: a registered committee reporting zero is not a candidate the state has never heard of", async () => {
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

test("DEFECT 4: a same-year filer who may be this person forbids an absence claim", async () => {
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

  const leads = records.filter((r) => r.filingState === "LEAD" && r.committeeId === "243729");
  assert.equal(leads.length, 1, "the row the state actually returned is recorded as a LEAD");
  assert.deepEqual(leads[0].targetKeys, [], "a LEAD may not claim a candidate");
});
