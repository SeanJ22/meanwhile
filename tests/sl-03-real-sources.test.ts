import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import manifest from "./fixtures/sl-03/manifest.json" with { type: "json" };
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { publishPeopleSource, readPeopleSourceProjection } from "../lib/civic-data/people-source-publication.ts";
import { acquireKnownRelease } from "../lib/sources/known-release.ts";
import { acquirePeopleSource } from "../lib/sources/people/acquisition.ts";
import { normalizeOfficialLegislaturePage } from "../lib/sources/people/legislature.ts";
import { normalizeCongressMember } from "../lib/sources/people/congress.ts";
import { emptyRoster, type PeopleAcquisitionOptions } from "../lib/sources/people/common.ts";
import { parseStatewideAssociation, verifyStatewideOfficialPage, statewideRoster } from "../lib/sources/statewide/parse.ts";
import { STATEWIDE_REFERENCE_SOURCES } from "../lib/sources/statewide/reference.ts";
import { statePeoplePortraits } from "../lib/civic-data/state-people-publication.ts";
import { portraitHash, type PortraitSources } from "../lib/photos/evidence.ts";
import { storeVerifiedPortrait } from "../lib/photos/store.ts";
import { portraitBindingMatches } from "../lib/photos/binding.ts";

const NOW = "2026-10-12T22:35:26.000Z";
function fixture(name: string) {
  const metadata = manifest.captures.find(row => row.name === name)!;
  assert.ok(metadata, name);
  const bytes = readFileSync(new URL(`./fixtures/sl-03/${metadata.file}`, import.meta.url));
  return { ...metadata, bytes, body: bytes.toString("utf8") };
}
function options(state: string): PeopleAcquisitionOptions {
  return { sourceId: "official-state-people", state, asOf: NOW, signal: new AbortController().signal,
    store: new MemoryEvidenceStore(), locks: createMemoryRepositories().locks, now: () => NOW, acquire: acquireKnownRelease };
}

test("real SL-03 captures retain their original bytes, capture times and public URLs", () => {
  for (const metadata of manifest.captures) {
    const capture = fixture(metadata.name);
    assert.equal(capture.bytes.length, metadata.bytes);
    assert.equal(createHash("sha256").update(capture.bytes).digest("hex"), metadata.sha256);
    assert.equal(metadata.httpStatus, 200);
    assert.ok(Date.parse(metadata.retrievedAt) <= Date.parse(NOW));
    assert.doesNotMatch(metadata.requestedUrl + metadata.finalUrl, /[?&](?:api_key|key)=/i);
  }
});

test("the real NASS directory keeps party-suffixed names and uses jurisdiction headings over street names", () => {
  const page = fixture("nass-membership"), source = STATEWIDE_REFERENCE_SOURCES.find(row => row.id === "nass")!;
  const parsed = parseStatewideAssociation(page.body, source, page.finalUrl, page.retrievedAt);
  assert.equal(parsed.leads.length, 52);
  for (const [state, name] of [["az", "Adrian Fontes"], ["me", "Shenna Bellows"], ["wi", "Sarah Godlewski"]]) {
    assert.deepEqual(parsed.leads.filter(row => row.state === state).map(row => row.name), [name]);
  }
  assert.ok(parsed.leads.find(row => row.state === "az")!.evidenceExcerpt!.includes("Washington"));
  assert.ok(parsed.leads.every(row => row.sourceUrl === page.finalUrl && row.sourceOrg === source.publisher));
});

for (const [state, count, name, phone, district] of [
  ["az", 93, "David Gowan", "(602) 926-5154", "19"],
  ["me", 35, "Donna Bailey", null, null],
  ["wi", 33, "Julian Bradley", "(608) 266-5400", "28"],
] as const) {
  test(`captured ${state.toUpperCase()} roster publishes its source rows without navigation or cross-person contacts`, async () => {
    const page = fixture(`${state}-legislators`);
    const roster = normalizeOfficialLegislaturePage(page.body, page.finalUrl, options(state), page.retrievedAt);
    assert.equal(roster.officeholders.length, count);
    assert.equal(roster.currentMembershipComplete, undefined);
    assert.ok(roster.officeholders.every(person => person.state === state.toUpperCase()));
    assert.ok(!roster.officeholders.some(person => /Chief Clerk|Visitor Information|Live Senate Video|Listed by/.test(person.name)));
    const person = roster.officeholders.find(person => person.name === name)!;
    assert.ok(person, name);
    assert.equal(person.phone, phone);
    assert.equal(person.memberships?.[0].district ?? null, district);
    assert.equal(person.fieldSources?.name.sourceUrl, page.finalUrl);
    if (state === "az") {
      assert.ok(roster.officeholders.some(row => row.name === 'Timothy "Tim" Dunn'));
      assert.ok(roster.officeholders.some(row => row.name === "David Marshall, Sr."));
      assert.equal(roster.officeholders.find(row => row.name === "Anna Abeytia")?.chamber, "lower");
      assert.equal(person.chamber, "upper");
    }
    if (state === "wi") {
      assert.ok(roster.officeholders.some(row => row.name === "André Jacque"));
      assert.equal(roster.officeholders.find(row => row.name === "Dora Drake")?.phone, "(608) 266-5810");
    }
    const store = new MemoryRoutineDataStore();
    const publication = await publishPeopleSource({ store, state, sourceId: "official-state-people", roster,
      acquisitions: [page], releaseId: page.sha256, now: NOW });
    assert.ok(publication.outcome.promoted, JSON.stringify(publication.outcome.candidate.receipt));
    const read = await readPeopleSourceProjection(`US-${state.toUpperCase()}`, "official-state-people", { store, now: NOW, bypassCache: true });
    assert.equal(read.kind, "PROMOTED");
    if (read.kind === "PROMOTED") assert.equal(read.value.roster.officeholders.length, count);
  });
}

test("an observed Arizona member redirect retains the held person binding during saved-source acquisition", async () => {
  const page = fixture("az-senator"), listing = fixture("az-legislators"), input = options("az");
  const held = normalizeOfficialLegislaturePage(listing.body, listing.finalUrl, input, listing.retrievedAt);
  const holder = held.officeholders.find(person => person.name === "David Gowan")!;
  const roster = { ...held, officeholders: [holder], divisions: [], unmatched: [] };
  const requested: string[] = [];
  const release = await acquirePeopleSource({ ...input, roster, fetchImpl: async resource => {
    const observed = String(resource); requested.push(observed);
    if (observed !== page.requestedUrl && observed !== page.finalUrl) return new Response("unsampled route", { status: 404 });
    const response = new Response(page.body, { headers: { "content-type": page.contentType } });
    Object.defineProperty(response, "url", { value: page.finalUrl });
    return response;
  } });
  const person = release.roster.officeholders.find(row => row.name === holder.name)!;
  assert.ok(person);
  assert.ok(requested.includes(page.requestedUrl));
  assert.equal(person.provenance.sourceUrl, page.finalUrl);
  assert.equal(person.portraitCandidate?.imageUrl, fixture("az-senator-portrait").requestedUrl);
});

test("real official secretary pages preserve unresolved selection rather than inheriting the directory's elected label", async () => {
  const directory = fixture("nass-membership"), source = STATEWIDE_REFERENCE_SOURCES.find(row => row.id === "nass")!;
  const leads = parseStatewideAssociation(directory.body, source, directory.finalUrl, directory.retrievedAt).leads;
  for (const state of ["az", "me"]) {
    const page = fixture(`${state}-secretary`), lead = leads.find(row => row.state === state)!;
    const verified = verifyStatewideOfficialPage({ ...lead, profileUrls: [page.finalUrl] }, { url: page.finalUrl, html: page.body, retrievedAt: page.retrievedAt });
    assert.ok("person" in verified, JSON.stringify(verified));
    if (!("person" in verified)) continue;
    assert.equal(verified.person.selectionMethod, "UNKNOWN");
    assert.ok(verified.person.portraitCandidate);
    const roster = statewideRoster(state, [verified.person], page.retrievedAt);
    assert.equal(roster.divisions.length, 0);
    assert.equal(roster.unmatched[0]?.reason, "STATEWIDE_SELECTION_METHOD_UNRESOLVED");
    const publication = await publishPeopleSource({ store: new MemoryRoutineDataStore(), state, sourceId: "statewide-executive-sources",
      roster, acquisitions: [page], releaseId: page.sha256, now: NOW });
    assert.ok(publication.outcome.promoted, JSON.stringify(publication.outcome.candidate.receipt));
  }
});

test("the real Congress member document retains its native term, state, contact and portrait binding", () => {
  const page = fixture("congress-kelly"), index = JSON.parse(fixture("congress-az-members").body);
  assert.ok(index.members.some((member: { bioguideId: string }) => member.bioguideId === "K000377"));
  const roster = normalizeCongressMember(JSON.parse(page.body), { ...options("az"), sourceId: "congress-api" }, page.finalUrl, page.retrievedAt);
  assert.equal(roster.officeholders[0]?.name, "Mark Kelly");
  assert.equal(roster.officeholders[0]?.termStart, "2025");
  assert.equal(roster.officeholders[0]?.phone, "(202) 224-2235");
  assert.equal(roster.divisions[0]?.ocdId, "ocd-division/country:us/state:az");
  assert.equal(roster.officeholders[0]?.portraitCandidate?.imageUrl, fixture("congress-kelly-portrait").requestedUrl);
});

test("captured federal, governor, attorney general, secretary and legislator images pass own-page evidence, decoding and storage", async () => {
  for (const [pageName, name] of [
    ["congress-kelly", "Mark Kelly"], ["az-governor-bio", "Katie Hobbs"], ["az-attorney-general", "Kris Mayes"],
    ["az-secretary", "Adrian Fontes"], ["me-secretary", "Shenna Bellows"], ["az-senator", "David Gowan"], ["wi-senator-details", "Julian Bradley"],
  ]) {
    const page = fixture(pageName), image = fixture(`${pageName}-portrait`), personId = `fixture:${pageName}`;
    const sources: PortraitSources = { subject: { personId, name, profileUrls: [page.finalUrl],
      ...(pageName === "congress-kelly" ? { nativeIds: { bioguide: ["K000377"] } } : {}) }, imageUrl: image.requestedUrl,
      captures: [{ observedAt: page.retrievedAt, httpStatus: 200, transport: "REACHABLE", partial: false,
        evidence: { canonicalUrl: page.finalUrl, sourceId: "sl-03-fixture", contentHash: portraitHash(page.bytes), text: page.body,
          retrievedAt: page.retrievedAt, artifactId: `fixture:${page.sha256}` } }] };
    const writes: string[] = [];
    const photo = await storeVerifiedPortrait(personId, sources, NOW, {
      read: async url => { assert.equal(url, image.requestedUrl); return { bytes: image.bytes, retrievedAt: image.retrievedAt, contentType: image.contentType }; },
      put: async (key, bytes) => { assert.ok(bytes.length > 0); writes.push(key); },
    });
    assert.ok(portraitBindingMatches(personId, photo), name);
    assert.equal(photo.verification?.basis, "OWN_PAGE");
    assert.equal(photo.verification?.sourceImageHash, portraitHash(image.bytes));
    assert.equal(photo.collectedAt, image.retrievedAt);
    assert.equal(writes.length, 1);
  }
});

test("standing portraits publish captured statewide images through the normal worker without production writes", async () => {
  const page = fixture("me-secretary"), image = fixture("me-secretary-portrait"), state = "me";
  const verified = verifyStatewideOfficialPage({ state, name: "Shenna Bellows", officeTitle: "Secretary of State", sourceId: "nass",
    sourceOrg: "NASS", sourceUrl: page.finalUrl, profileUrls: [page.finalUrl], collectedAt: page.retrievedAt },
  { url: page.finalUrl, html: page.body, retrievedAt: page.retrievedAt });
  assert.ok("person" in verified);
  if (!("person" in verified)) return;
  const input = options(state), writes: string[] = [];
  const result = await statePeoplePortraits({ state, roster: { ...emptyRoster(state, NOW), officeholders: [verified.person] }, now: NOW }, {
    now: () => NOW, acquire: request => acquireKnownRelease({ ...request, store: input.store, locks: input.locks, now: () => NOW,
      fetchImpl: async resource => { assert.equal(String(resource), page.finalUrl); return new Response(page.body, { headers: { "content-type": page.contentType } }); } }),
    storePortrait: (id, sources, at, signal) => storeVerifiedPortrait(id, sources, at, {
      read: async url => { assert.equal(url, image.requestedUrl); return { bytes: image.bytes, retrievedAt: image.retrievedAt, contentType: image.contentType }; },
      put: async key => { writes.push(key); },
    }, "officials", signal),
  });
  assert.equal(result.attempted, 1);
  assert.deepEqual(result.excludedFacts, []);
  assert.ok(portraitBindingMatches(verified.person.personId!, result.roster.officeholders[0].photo!));
  assert.equal(writes.length, 1);
});
