import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { directoryFor, directorySource } from "../lib/officials/directory.ts";
import { identityChipsFor } from "../lib/officials/identity-chips.ts";
import type { SeatHolder } from "../lib/officials/lookup.ts";
import { installRegistryRuntimeFirstSeeds } from "./helpers/registry-runtime-first-seed.ts";
import { currentCongressSourceRevision } from "../lib/officials/congress-source-revision.ts";

test("directory refresh resolves one current immutable revision and refuses unavailable or malformed revisions", async () => {
  let calls = 0;
  const sha = "a".repeat(40);
  const revision = await currentCongressSourceRevision((async (url) => {
    calls++;
    assert.equal(String(url), "https://api.github.com/repos/unitedstates/congress-legislators/commits?per_page=1");
    return Response.json([{ sha }]);
  }) as typeof fetch);
  assert.equal(revision, sha);
  assert.equal(calls, 1);
  for (const body of [[], [{ sha: "main" }], { sha }]) {
    await assert.rejects(currentCongressSourceRevision((async () => Response.json(body)) as typeof fetch), /REVISION_INVALID/);
  }
  await assert.rejects(currentCongressSourceRevision((async () => new Response("", { status: 403 })) as typeof fetch), /REVISION_HTTP_403/);
});

await installRegistryRuntimeFirstSeeds();

/**
 * The congress-legislators adoption — item 7, 2026-08-16.
 *
 * The adoption has two boundaries and both are guarded here:
 *
 * 1. **The provenance tag names the PROJECT, never "official records."** It
 *    is a community-maintained aggregation of the official sources. A tag
 *    calling it official is the first step toward citing it for something a
 *    directory cannot answer.
 * 2. **It is a DIRECTORY, not a ledger.** No votes, no money, no statements.
 *    B17 stays on the chambers, FEC stays FEC, PRL stays PRL.
 *
 * Plus the counts, against the denominators the brief stated — a snapshot
 * that reports success while holding nothing is the failure mode this whole
 * file exists to catch.
 */

const ROOT = process.cwd();

const snapshot = JSON.parse(
  readFileSync(join(ROOT, "data/congress-legislators/snapshot.json"), "utf8"),
) as {
  source: { sha: string; sourceOrg: string; licence: string; collectedAt: string };
  counts: Record<string, number>;
  members: { bioguide: string; social: Record<string, string | null>; birthDate: string | null }[];
};

const store = JSON.parse(
  readFileSync(join(ROOT, "lib/registry/officeholders-us.json"), "utf8"),
) as {
  officeholders: {
    id: string;
    name: string;
    social?: Record<string, string>;
    state?: string;
    chamber?: string;
  }[];
};

test("the snapshot is SHA-pinned, never main", () => {
  assert.match(
    snapshot.source.sha,
    /^[0-9a-f]{40}$/,
    "a full commit SHA — fetching `main` means the same command returns " +
      "different data on different days and nothing records which",
  );
});

test("the provenance tag names the PROJECT, not official records", () => {
  assert.match(snapshot.source.sourceOrg, /congress-legislators/);
  assert.ok(
    !/official record/i.test(snapshot.source.sourceOrg),
    "the author's ruling: a community aggregation of official sources is " +
      "not itself an official record, and the tag must not say it is",
  );
  assert.match(snapshot.source.licence, /CC0/);
});

test("the counts match the denominators the brief stated", () => {
  // Each of these is a count WITH its denominator. A thin fetch, a redirect
  // to an error page, or a schema change all present as a smaller number.
  assert.equal(snapshot.counts.members, 539);
  assert.equal(snapshot.counts.membersWithBirthday, 539, "birthday on all 539");
  assert.equal(snapshot.counts.membersWithFecId, 537, "FEC ids on 537 of 539");
  assert.equal(snapshot.counts.membersWithTwitter, 505, "505 of 539 carry X");
  assert.equal(snapshot.counts.districtOffices, 1306);
  assert.equal(snapshot.counts.committees, 49);
  assert.equal(snapshot.counts.subcommittees, 181);
});

test("it is a DIRECTORY — no votes, no money, no statements", () => {
  const keys = new Set(Object.keys(snapshot));
  for (const forbidden of ["votes", "rollCalls", "contributions", "statements", "positions"]) {
    assert.ok(
      !keys.has(forbidden),
      `the snapshot must not carry ${forbidden}: B17 stays on the chambers, ` +
        `FEC stays FEC, PRL stays PRL`,
    );
  }
  // And the same at the render table.
  const sample = directoryFor("congress:C000127");
  assert.ok(sample, "a sitting senator must resolve");
  assert.deepEqual(
    Object.keys(sample.entry).sort(),
    ["committees", "districtOffices"],
    "a member's directory slice is offices and committees, and nothing else",
  );
});

test("the join is by BIOGUIDE, never by name", () => {
  // Every store row that gained social did so through its `congress:<bioguide>`
  // id. A name join would be invisible until two members shared a surname.
  const bioguides = new Set(snapshot.members.map((m) => m.bioguide));
  let joined = 0;
  for (const person of store.officeholders) {
    if (!person.social) continue;
    const bioguide = person.id.replace(/^congress:/, "");
    assert.ok(
      bioguides.has(bioguide),
      `${person.name} carries social with no matching bioguide in the snapshot`,
    );
    joined += 1;
  }
  assert.equal(joined, 518, "518 of 539 members publish at least one account");
});

test("state and chamber land on every federal row", () => {
  const withState = store.officeholders.filter((p) => p.state).length;
  const withChamber = store.officeholders.filter((p) => p.chamber).length;
  assert.equal(withState, 539);
  assert.equal(withChamber, 539);
});

test("a non-federal holder gets no directory slice, and that is a real answer", () => {
  // The source's scope is sitting federal members. A scope is not widened by
  // wanting it to be, and the card renders nothing rather than an empty
  // "Committees" heading that would read as "sits on none".
  assert.equal(directoryFor("roster:pima#1"), null);
  assert.equal(directoryFor("statewide:az/governor"), null);
});

test("the directory source carries its SHA and read date to the render", () => {
  const source = directorySource();
  assert.match(source.sha, /^[0-9a-f]{40}$/);
  assert.match(source.collectedAt, /^\d{4}-\d{2}-\d{2}$/);
});

/* ------------------------------------------------------------------------ */

function holder(extra: Partial<SeatHolder>): SeatHolder {
  return {
    id: "congress:X000001",
    name: "Test Member",
    officeTitle: "U.S. Representative",
    partyLabel: null,
    termEnd: null,
    birthDate: null,
    websiteUrl: null,
    sourceUrl: null,
    provenance: null,
    email: null,
    phone: null,
    contactFormUrl: null,
    photoUrl: null,
    campaignUrl: null,
    ...extra,
  };
}

test("identity chips are facts, never guesses from a seat label", () => {
  // Item 3. State and chamber come off the member's OWN current term in the
  // pinned file. "AZ-6" happens to start with a state code and "State House
  // District 19" does not; a chip derived by string-guessing would one day be
  // wrong about somebody's state.
  const federal = identityChipsFor(
    holder({ state: "AZ", chamber: "house" }),
    "national",
    "INCUMBENT",
  );
  assert.deepEqual(federal, ["AZ", "House", "Incumbent"]);

  const senator = identityChipsFor(
    holder({ state: "WA", chamber: "senate" }),
    "national",
    "INCUMBENT",
  );
  assert.deepEqual(senator, ["WA", "Senate", "Incumbent"]);
});

test("a local roster carries neither, and the chip row says the tier instead", () => {
  const local = identityChipsFor(holder({ id: "roster:pima#1" }), "local", "INCUMBENT");
  assert.deepEqual(local, ["Local", "Incumbent"]);
});

test("Incumbent and Challenger are the identical chip", () => {
  // Equal effort is a geometric claim here as much as an editorial one: the
  // two render through one code path, so neither can grow a treatment the
  // other lacks.
  const inc = identityChipsFor(holder({ state: "NH", chamber: "house" }), "national", "INCUMBENT");
  const cha = identityChipsFor(holder({ state: "NH", chamber: "house" }), "national", "CHALLENGER");
  assert.equal(inc.length, cha.length);
  assert.deepEqual(inc.slice(0, -1), cha.slice(0, -1));
  assert.equal(inc.at(-1), "Incumbent");
  assert.equal(cha.at(-1), "Challenger");
});

test("no standing means no standing chip — absence is not padded", () => {
  const none = identityChipsFor(holder({ state: "AZ", chamber: "house" }), "national");
  assert.deepEqual(none, ["AZ", "House"]);
});
