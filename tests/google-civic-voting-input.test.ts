import assert from "node:assert/strict";
import test from "node:test";
import { civicLookupFromRaw } from "../lib/sources/google-civic/model.ts";
import { readCivicApi } from "../lib/sources/google-civic/acquisition.ts";
import { readGoogleVotingAnswer } from "../lib/sources/google-civic/reader-lookup.ts";
import { votingPlaceFromZip } from "../lib/ballot/voting-answer-geography.ts";

const checkedAt = "2026-10-27T17:00:00.000Z";
const response = (office: Record<string, unknown>) => JSON.stringify({
  election: { id: "12000", electionDay: "2026-11-03" },
  normalizedInput: { state: "WI" },
  state: [{ name: "Wisconsin", electionAdministrationBody: { name: "Wisconsin Elections Commission", ...office } }],
});

test("a correspondence address never becomes an election-office location", () => {
  const lookup = civicLookupFromRaw(response({
    correspondenceAddress: { line1: "P.O. Box 7984", city: "Madison", state: "WI", zip: "53707" },
    votingLocationFinderUrl: "https://myvote.wi.gov/en-us/Find-My-Polling-Place",
  }), "12000", checkedAt);
  assert.equal(lookup.electionOffices?.[0].address, undefined);
  assert.equal(lookup.electionOffices?.[0].url, "https://myvote.wi.gov/en-us/Find-My-Polling-Place");
  assert.doesNotMatch(JSON.stringify(lookup), /P\.O\. Box|53707/);
});

test("a published physical office address remains distinct from polling locations", () => {
  const lookup = civicLookupFromRaw(response({
    physicalAddress: { line1: "201 W Washington Ave", city: "Madison", state: "WI", zip: "53703" },
    correspondenceAddress: { line1: "P.O. Box 7984", city: "Madison", state: "WI", zip: "53707" },
  }), "12000", checkedAt);
  assert.equal(lookup.electionOffices?.[0].address, "201 W Washington Ave, Madison, WI, 53703");
  assert.equal(lookup.rows.length, 0);
});

test("a partial successful HTTP response cannot supply voting locations", async t => {
  const failures: string[] = [];
  t.mock.method(console, "error", (value: string) => failures.push(value));
  await assert.rejects(readCivicApi("voterinfo", { address: "private reader street" }, {
    apiKey: "private-test-key",
    fetchImpl: async () => new Response("partial private reader street private-test-key", { status: 206 }),
  }), /incomplete response/);
  assert.equal(JSON.parse(failures[0]).httpStatus, 206);
  assert.doesNotMatch(failures.join(""), /private reader street|private-test-key/);
});

test("a same-state lookup resolved to another town cannot supply a polling place", () => {
  const raw = JSON.parse(response({}));
  raw.normalizedInput.city = "New London";
  assert.throws(() => civicLookupFromRaw(JSON.stringify(raw), "12000", checkedAt, new Set(), ["Concord city"]), /different town/);
  assert.doesNotThrow(() => civicLookupFromRaw(JSON.stringify(raw), "12000", checkedAt, new Set(), ["New London town"]));
});

test("Google polling rows reject mailing destinations and another state without rejecting legal cross-town assignments", async () => {
  const raw = JSON.parse(response({}));
  raw.normalizedInput.city = "Wauwatosa";
  raw.pollingLocations = [
    { address: { locationName: "Mailing office", line1: "P.O. Box 7984", city: "Madison", state: "WI", zip: "53707" } },
    { address: { locationName: "Other state", line1: "100 Public St", city: "Minneapolis", state: "MN", zip: "55401" } },
    { address: { locationName: "Assigned public building", line1: "200 Public St", line2: "PO Box 39", city: "Milwaukee", state: "WI", zip: "53213" }, latitude: 43.06, longitude: -87.99, pollingHours: "7 am–8 pm" },
  ];
  const answer = await readGoogleVotingAnswer("private reader street", {
    ...votingPlaceFromZip(["ocd-division/country:us/state:wi"]), precision: "ADDRESS", towns: ["Wauwatosa city"],
  }, {
    apiKey: "private-test-key", now: () => checkedAt,
    electionCatalog: Promise.resolve({ raw: JSON.stringify({ elections: [{ id: "12000", name: "General Election", electionDay: "2026-11-03", ocdDivisionId: "ocd-division/country:us" }] }), checkedAt, status: 200 }),
    fetchImpl: async () => Response.json(raw),
  });
  assert.equal(answer.jurisdictions.length, 1);
  assert.deepEqual(answer.jurisdictions[0].sites.map(site => site.name), ["Assigned public building"]);
  assert.equal(answer.jurisdictions[0].sites[0].kind, "ELECTION_DAY");
  assert.equal(answer.jurisdictions[0].sites[0].hours, "7 am–8 pm");
  assert.equal(answer.jurisdictions[0].sites[0].address, "200 Public St, Milwaukee, WI, 53213");
  assert.equal(answer.jurisdictions[0].assignedSiteIds?.length, 1);
  assert.doesNotMatch(JSON.stringify(answer), /private reader street|private-test-key|PO Box 39/);
});

test("a statewide early/drop list keeps only the confirmed reader town before geocoding", async () => {
  const raw = {
    election: { id: "12000", electionDay: "2026-11-03" }, normalizedInput: { city: "Lebanon", state: "OR" },
    pollingLocations: [{ address: { locationName: "Assigned Election Day site", line1: "100 Public St", city: "Other Town", state: "OR", zip: "97355" }, latitude: 44.54, longitude: -122.9, pollingHours: "7 am–8 pm" }],
    earlyVoteSites: [
      { address: { locationName: "Local early voting", line1: "200 Public St", city: "LEBANON", state: "OR", zip: "97355" }, latitude: 44.54, longitude: -122.9, pollingHours: "9 am–5 pm" },
      { address: { locationName: "Other town early voting", line1: "255 N Main St", city: "Brownsville", state: "OR", zip: "97327" } },
    ],
    dropOffLocations: [
      { address: { locationName: "Local ballot box", line1: "40 N 2nd St", line2: "PO Box 39", city: "Lebanon", state: "OR", zip: "97355" }, pollingHours: "24 hours" },
      { address: { locationName: "Other town ballot box", line1: "2450 14th Ave SE", city: "Albany", state: "OR", zip: "97322" } },
    ],
  };
  const batches: string[] = [];
  const opts = {
    apiKey: "private-test-key", now: () => checkedAt,
    electionCatalog: Promise.resolve({ raw: JSON.stringify({ elections: [{ id: "12000", name: "General Election", electionDay: "2026-11-03", ocdDivisionId: "ocd-division/country:us" }] }), checkedAt, status: 200 }),
    fetchImpl: async () => Response.json(raw),
    censusFetchImpl: (async (_url: URL | RequestInfo, init?: RequestInit) => {
      const file = (init?.body as FormData).get("addressFile") as Blob;
      batches.push(await file.text());
      return new Response("");
    }) as typeof fetch,
  };
  const local = { ...votingPlaceFromZip(["ocd-division/country:us/state:or"]), precision: "ADDRESS" as const, towns: ["Lebanon city"] };
  const answer = await readGoogleVotingAnswer("private reader street", local, opts);
  const sites = answer.jurisdictions.flatMap(j => j.sites);
  assert.deepEqual(sites.map(site => [site.name, site.kind, site.hours]), [
    ["Assigned Election Day site", "ELECTION_DAY", "7 am–8 pm"],
    ["Local early voting", "EARLY_VOTING", "9 am–5 pm"],
    ["Local ballot box", "DROP_BOX", "24 hours"],
  ]);
  assert.equal(batches.length, 1);
  assert.match(batches[0], /40 N 2nd St/);
  assert.doesNotMatch(batches[0], /Brownsville|Albany|private reader street|PO Box 39/);
  assert.doesNotMatch(JSON.stringify(sites), /PO Box 39/);

  batches.length = 0;
  const unlocated = await readGoogleVotingAnswer("private reader street", { ...local, towns: [] }, opts);
  assert.deepEqual(unlocated.jurisdictions.flatMap(j => j.sites).map(site => site.name), ["Assigned Election Day site"]);
  assert.deepEqual(batches, [], "without a confirmed town, nonassigned statewide rows cannot trigger geocodes");
});
