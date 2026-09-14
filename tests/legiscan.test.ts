import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { GET as votesGet } from "../app/api/votes/route.ts";
import {
  NH_COUNTY_ORDINAL,
  districtKeyFor,
  surname,
} from "../lib/sources/legiscan/districts.ts";
import {
  clearStateVotesProjectionCacheForTest,
  getStateVotesSnapshot,
  OFFICIAL_STATE_VOTE_SCOPES,
} from "../lib/sources/legiscan/snapshot.ts";
import { LEGISCAN_ATTRIBUTION } from "../lib/sources/legiscan/types.ts";
import { readZip } from "../lib/sources/legiscan/zip.ts";

/**
 * The state-legislature voting record — D49, 2026-08-15.
 *
 * The join is what this file is really about. A district mapping that is
 * wrong does not throw; it produces a LOW MATCH RATE, which looks exactly
 * like a thin roster. It was wrong once during the build (an alphabetical
 * county table indexed from 1 instead of 0) and read as 10 of 426 New
 * Hampshire members matching. So the mapping is asserted against our own
 * committed boundary labels, and the snapshot is asserted for distinctness.
 */

const fixtureSnapshots = OFFICIAL_STATE_VOTE_SCOPES.map((scope) => getStateVotesSnapshot(scope));
const snapshot = {
  generatedAt: fixtureSnapshots.map((value) => value.generatedAt).sort().at(-1)!,
  datasets: fixtureSnapshots.flatMap((value) => value.datasets),
  identifierMatch: {
    peopleSeen: fixtureSnapshots.reduce((total, value) => total + value.identifierMatch.peopleSeen, 0),
    peopleMatched: fixtureSnapshots.reduce((total, value) => total + value.identifierMatch.peopleMatched, 0),
    distinctOfficeholders: new Set(fixtureSnapshots.flatMap((value) => value.positions.map((position) => position.officeholderId))).size,
    byState: Object.assign({}, ...fixtureSnapshots.map((value) => value.identifierMatch.byState)),
  },
  rollCalls: fixtureSnapshots.flatMap((value) => value.rollCalls),
  positions: fixtureSnapshots.flatMap((value) => value.positions),
};

test("production returns explicit unavailable and has no tracked LegiScan fallback without an official projection", { concurrency: false }, async () => {
  clearStateVotesProjectionCacheForTest();
  const testContext = process.env.NODE_TEST_CONTEXT;
  const databaseUrl = process.env.DATABASE_URL;
  const member = "az-legislature:unavailable-control";
  delete process.env.NODE_TEST_CONTEXT;
  delete process.env.DATABASE_URL;
  try {
    assert.throws(
      () => getStateVotesSnapshot("US-AZ"),
      /No proof-validated official state roll-call projection is loaded/,
    );
    const response = await votesGet(new Request(`https://example.test/api/votes?member=${member}`));
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      generatedAt: null,
      member,
      holdingStatus: "HOLDING_UNAVAILABLE",
      votes: [],
    });
  } finally {
    if (testContext === undefined) delete process.env.NODE_TEST_CONTEXT;
    else process.env.NODE_TEST_CONTEXT = testContext;
    if (databaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = databaseUrl;
  }
});

/* ------------------------------------------------------------- the join --- */

test("the NH county table agrees with our own boundary labels", () => {
  // `data/states/nh/geo/sldl-33.geojson` carries `State House District Merrimack 08`
  // beside `sldl:608`. That is the claim the table makes, so it is checked
  // against the file rather than remembered.
  const geo = JSON.parse(
    readFileSync(join(process.cwd(), "data", "states", "nh", "geo", "sldl-33.geojson"), "utf8"),
  ) as { features: Array<{ properties: { ocdId: string; label: string } }> };

  const abbrevOf: Record<string, string> = {
    Belknap: "BEL",
    Carroll: "CAR",
    Cheshire: "CHE",
    Coos: "COO",
    Grafton: "GRA",
    Hillsborough: "HIL",
    Merrimack: "MER",
    Rockingham: "ROC",
    Strafford: "STR",
    Sullivan: "SUL",
  };

  let checked = 0;
  for (const f of geo.features) {
    const code = /\/sldl:(\d+)$/.exec(f.properties.ocdId)?.[1];
    const label = /District ([A-Za-z]+) (\d+)$/.exec(f.properties.label);
    if (!code || !label) continue;
    const abbrev = abbrevOf[label[1]];
    assert.ok(abbrev, `no abbreviation for NH county "${label[1]}"`);
    // Round-trip: LegiScan's string for this seat must produce this ocdId.
    const legiscan = `HD-${String(Number(label[2])).padStart(2, "0")}-${abbrev}`;
    assert.equal(
      districtKeyFor("NH", legiscan),
      `sldl:${Number(code)}`,
      `${legiscan} (${f.properties.label}) did not map to sldl:${code}`,
    );
    checked++;
  }

  // A selector that matched nothing would otherwise pass as a clean run.
  assert.ok(checked >= 40, `only ${checked} NH lower districts checked`);
  assert.equal(Object.keys(NH_COUNTY_ORDINAL).length, 10, "NH has ten counties");
});

test("the statewide-numbered states map straight through", () => {
  assert.equal(districtKeyFor("AZ", "HD-040"), "sldl:40");
  assert.equal(districtKeyFor("AZ", "SD-002"), "sldu:2");
  assert.equal(districtKeyFor("NJ", "HD-025"), "sldl:25");
  assert.equal(districtKeyFor("NH", "SD-022"), "sldu:22");

  // Unparseable is null and the caller counts it — never a guess.
  assert.equal(districtKeyFor("NH", "HD-12-ZZZ"), null);
  assert.equal(districtKeyFor("AZ", "AL"), null);
  assert.equal(districtKeyFor("NH", "HD-12"), null, "NH lower needs its county");
});

test("surnames fold accents and generational suffixes, and nothing else", () => {
  assert.equal(surname("Consuelo Hernández"), "hernandez");
  assert.equal(surname("Robert Smith Jr."), "smith");
  assert.equal(surname("Mary-Jane O'Brien"), "brien");
  // Two different people must not collapse onto one surname key by accident:
  // the surname is only ever compared WITHIN a district that already matched.
  assert.notEqual(surname("Alma Hernández"), surname("Alma Hernandes"));
});

/* --------------------------------------------------------- the snapshot --- */

test("the snapshot states its counts, and none of them is zero", () => {
  assert.ok(snapshot.rollCalls.length > 0, "no roll calls");
  assert.ok(snapshot.positions.length > 0, "no recorded positions");
  assert.ok(snapshot.datasets.length >= 3, "AZ, NJ and NH each need a dataset row");

  for (const d of snapshot.datasets) {
    assert.match(d.datasetHash, /^[0-9a-f]{32}$/, `${d.state} hash`);
    assert.ok(d.sessionId > 0, `${d.state} session id`);
  }

  // Per state, so one state's success cannot mask another's zero.
  for (const state of ["AZ", "NJ", "NH"]) {
    const m = snapshot.identifierMatch.byState[state];
    assert.ok(m, `${state} is missing from the match report`);
    assert.ok(m.peopleSeen > 0, `${state}: no people seen`);
    assert.ok(m.peopleMatched > 0, `${state}: zero people matched — the cd:0 shape`);
    assert.ok(m.rollCalls > 0, `${state}: no roll calls kept`);
  }
});

test("the join is distinct — a match rate is not a match", () => {
  // The D40 failure: 100% matched, every match the same row. Positions must
  // spread across many officeholders, and each officeholder's LegiScan
  // people_id must be their own.
  const holders = new Set(snapshot.positions.map((p) => p.officeholderId));
  assert.equal(
    holders.size,
    snapshot.identifierMatch.distinctOfficeholders,
    "the snapshot's own distinct count disagrees with its positions",
  );
  assert.ok(holders.size >= 100, `only ${holders.size} distinct officeholders`);

  const peopleIdByHolder = new Map<string, Set<number>>();
  for (const p of snapshot.positions) {
    const s = peopleIdByHolder.get(p.officeholderId) ?? new Set();
    s.add(p.legiscanPeopleId);
    peopleIdByHolder.set(p.officeholderId, s);
  }
  for (const [holder, ids] of peopleIdByHolder) {
    assert.equal(ids.size, 1, `${holder} is joined to ${ids.size} LegiScan people`);
  }
  // And no two officeholders share a LegiScan person.
  const seen = new Map<number, string>();
  for (const [holder, ids] of peopleIdByHolder) {
    const id = [...ids][0];
    const other = seen.get(id);
    assert.equal(other, undefined, `people_id ${id} is joined to ${holder} and ${other}`);
    seen.set(id, holder);
  }
});

test("every position points at a roll call that exists", () => {
  const ids = new Set(snapshot.rollCalls.map((r) => r.id));
  const orphans = snapshot.positions.filter((p) => !ids.has(p.rollCallId));
  assert.deepEqual(
    orphans.slice(0, 5).map((p) => p.rollCallId),
    [],
    `${orphans.length} of ${snapshot.positions.length} positions reference a missing roll call`,
  );
});

test("no state vote record carries a score, rank or recommendation", () => {
  // The same guard family as candidates, measures and federal votes.
  const banned = [
    "score",
    "rank",
    "rating",
    "match",
    "fit",
    "grade",
    "alignment",
    "recommendation",
  ];
  for (const row of [...snapshot.rollCalls, ...snapshot.positions]) {
    for (const key of Object.keys(row)) {
      assert.ok(
        !banned.includes(key.toLowerCase()),
        `a LegiScan record grew a "${key}" key`,
      );
    }
  }
});

test("titles and results are the legislature's words, never ours", () => {
  for (const r of snapshot.rollCalls) {
    // A roll call with no bill title is possible; an invented one is not.
    if (r.billTitle) assert.ok(r.billTitle.length > 3, r.id);
    assert.match(r.result, /^(Passed|Failed) \d+-\d+$/, `${r.id} result`);
    assert.match(r.rollCallUrl, /^https:\/\/legiscan\.com\/[A-Z]{2}\/rollcall\/\d+$/);
    // A bill URL, when present, is the LEGISLATURE's own page — never a
    // constructed one. Every state's host, named.
    if (r.billUrl) {
      assert.match(
        new URL(r.billUrl).host,
        /(azleg\.gov|njleg\.state\.nj\.us|nj\.gov|gc\.nh\.gov|legiscan\.com)/,
        `${r.id} bill url host ${new URL(r.billUrl).host}`,
      );
    }
  }
});

/* ------------------------------------------------------------- the route --- */

test("a state legislator's votes come back with the CC BY attribution", async () => {
  const member = snapshot.positions[0].officeholderId;
  const response = await votesGet(
    new Request(`https://example.test/api/votes?member=${member}`),
  );
  const payload = (await response.json()) as {
    attribution?: typeof LEGISCAN_ATTRIBUTION;
    votes: Array<{
      id: string;
      date: string;
      position: string;
      partyBreakdown: unknown;
    }>;
  };

  assert.equal(response.status, 200);
  assert.ok(payload.votes.length > 0, `${member} came back with no votes`);
  // The licence requires attribution wherever the data appears.
  assert.equal(payload.attribution?.text, "LegiScan");
  assert.equal(payload.attribution?.licence, "CC BY 4.0");
  assert.match(payload.attribution?.licenceUrl ?? "", /creativecommons\.org/);

  // Newest first, and the party breakdown is refused rather than estimated.
  const dates = payload.votes.map((v) => v.date);
  assert.deepEqual(dates, [...dates].sort().reverse(), "not newest-first");
  for (const v of payload.votes) assert.equal(v.partyBreakdown, null);
});

test("a federal member's votes carry no LegiScan attribution", async () => {
  const response = await votesGet(
    new Request("https://example.test/api/votes?member=congress:A000370"),
  );
  const payload = (await response.json()) as { attribution?: unknown };
  assert.equal(response.status, 200);
  assert.equal(
    payload.attribution,
    undefined,
    "the chambers' public-domain XML must not be credited to LegiScan",
  );
});

test("an id that is neither shape is refused, not guessed at", async () => {
  for (const bad of ["", "plural:nope", "congress:xyz", "curated:az/thing"]) {
    const response = await votesGet(
      new Request(`https://example.test/api/votes?member=${encodeURIComponent(bad)}`),
    );
    assert.equal(response.status, 400, `"${bad}" was accepted`);
  }
});

/* ---------------------------------------------------------------- the zip --- */

test("the zip reader rejects what it cannot read rather than returning nothing", () => {
  assert.throws(
    () => readZip(Buffer.from("not a zip at all, not even close")),
    /no end-of-central-directory/,
  );
});
