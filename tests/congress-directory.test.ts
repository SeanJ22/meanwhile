import assert from "node:assert/strict";
import test from "node:test";

import { directoryFor } from "../lib/officials/directory.ts";
import { identityChipsFor } from "../lib/officials/identity-chips.ts";
import type { SeatHolder } from "../lib/officials/lookup.ts";
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

test("a non-federal holder gets no directory slice, and that is a real answer", () => {
  assert.equal(directoryFor("roster:example#1"), null);
  assert.equal(directoryFor("statewide:example/governor"), null);
});

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
  const local = identityChipsFor(holder({ id: "roster:example#1" }), "local", "INCUMBENT");
  assert.deepEqual(local, ["Local", "Incumbent"]);
});

test("Incumbent and Challenger are the identical chip", () => {
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
