import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { acquirePresidentPeople, ADMINISTRATION_URL } from "../lib/sources/white-house/president.ts";
import { enrichNationalExecutives, checkedExecutivePerson } from "../lib/sources/white-house/enrichment.ts";
import { EXECUTIVE_TERM_SOURCES, CABINET_TENURE_SOURCE_URL } from "../lib/sources/white-house/profile.ts";
import { acquireKnownRelease } from "../lib/sources/known-release.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { indexByDivision } from "../lib/officials/lookup.ts";
import type { ExecutiveEnrichmentOptions } from "../lib/sources/white-house/enrichment.ts";
import { personCardSources } from "../lib/officials/card-sources.ts";

const fixture = (path: string) => readFileSync(new URL(`./fixtures/${path}`, import.meta.url), "utf8");
test("standing enrichment replays all held profiles, keeps membership dates, and leaves failed sources open", async () => {
  const store = new MemoryEvidenceStore(), { locks } = createMemoryRepositories(), at = "2026-10-23T00:00:00.000Z";
  const heldPages = new Map([
    [ADMINISTRATION_URL, fixture("white-house/administration.html")],
    [`${ADMINISTRATION_URL}donald-j-trump/`, fixture("white-house/donald-j-trump.html")],
    [`${ADMINISTRATION_URL}jd-vance/`, fixture("white-house/jd-vance.html")],
    [`${ADMINISTRATION_URL}cabinet/`, fixture("white-house/cabinet.html")],
    [`${ADMINISTRATION_URL}the-cabinet/`, fixture("white-house/cabinet.html")],
    [EXECUTIVE_TERM_SOURCES.inauguration, fixture("nx-executive/profiles/inauguration-2025.html")],
    [EXECUTIVE_TERM_SOURCES.schedule, fixture("nx-executive/profiles/usa-presidential-inauguration.html")],
    [EXECUTIVE_TERM_SOURCES.amendment, fixture("nx-executive/profiles/constitution-amendment-20.html")],
    [EXECUTIVE_TERM_SOURCES.election, fixture("nx-executive/profiles/archives-president-2025.html")],
    [CABINET_TENURE_SOURCE_URL, fixture("nx-executive/profiles/cabinet-tenure-manual.html")],
    ["https://www.whitehouse.gov/contact/", fixture("nx-executive/profiles/whitehouse-contact.html")],
  ]);
  const requested = new Map<string, number>();
  const fetchImpl = (async (resource, init) => {
    const url = String(resource);
    if (!url.includes("/api/v2/federal_accounts/")) assert.ok(!init?.method || init.method === "GET", "ordinary sources keep their GET request");
    requested.set(url, (requested.get(url) ?? 0) + 1);
    if (heldPages.has(url)) return new Response(heldPages.get(url));
    return new Response("Source unavailable in this saved-source replay", { status: 404 });
  }) as typeof fetch;
  const options = { store, locks, now: () => at, fetchImpl, acquire: acquireKnownRelease, signal: new AbortController().signal };
  const base = await acquirePresidentPeople(options);
  assert.equal(base.roster.officeholders.length, 23);
  let profilesPublished = false;
  const enriched = await enrichNationalExecutives(base, { ...options,
    portraits: (async input => ({ roster: input.roster, excludedFacts: [], attempted: 0 })) as ExecutiveEnrichmentOptions["portraits"],
    onProfiles: async release => {
      profilesPublished = true;
      assert.equal(release.roster.officeholders.filter(person => person.executive?.biography && person.portraitCandidate).length, 23);
      assert.ok(![...requested.keys()].some(url => url.includes("api.open.fec.gov") || url.includes("api.usaspending.gov")), "profiles publish before the activity/statistics reads");
    },
  });
  assert.equal(profilesPublished, true);
  assert.equal(enriched.roster.officeholders.length, 23);
  for (const person of enriched.roster.officeholders) {
    assert.ok(person.executive?.biography, person.name);
    assert.ok(person.portraitCandidate, person.name);
    assert.equal(person.executive?.complete, false, "a portrait lead and failed sources never finish the floor");
  }
  const holders = indexByDivision([enriched.roster]).get("ocd-division/country:us")!;
  for (const title of ["President of the United States", "Vice President of the United States"]) {
    const holder = holders.find(person => person.officeTitle === title)!;
    assert.equal(holder.partyLabel, "Republican");
    assert.equal(holder.termStart, "2025-01-20");
    assert.equal(holder.termEnd, "2029-01-20");
  }
  for (const url of [ADMINISTRATION_URL, `${ADMINISTRATION_URL}donald-j-trump/`, `${ADMINISTRATION_URL}jd-vance/`]) assert.equal(requested.get(url), 1, `held bytes reused: ${url}`);
  assert.ok(enriched.gaps.length > 0);
  assert.ok(enriched.acquisitions.length > base.acquisitions.length);
});

test("a source recheck updates checked dates while retaining the saved bytes' original date", async () => {
  const store = new MemoryEvidenceStore(), { locks } = createMemoryRepositories(), original = "2026-10-20T00:00:00.000Z", rechecked = "2026-10-23T00:00:00.000Z";
  const url = `${ADMINISTRATION_URL}donald-j-trump/`;
  const base = await acquirePresidentPeople({ store, locks, now: () => original, acquire: acquireKnownRelease, signal: new AbortController().signal,
    fetchImpl: (async resource => new Response(fixture(String(resource) === ADMINISTRATION_URL ? "white-house/administration.html" : String(resource).includes("jd-vance") ? "white-house/jd-vance.html" : String(resource).includes("cabinet") ? "white-house/cabinet.html" : "white-house/donald-j-trump.html"))) as typeof fetch });
  const person = base.roster.officeholders.find(row => row.provenance.sourceUrl === url)!;
  person.executive = { biography: { text: "A biography from its saved source.", sourceUrl: url, collectedAt: original } };
  const checked = checkedExecutivePerson(person, [{ requestedUrl: url, finalUrl: url, httpStatus: 200, body: "saved body", retrievedAt: original,
    sourceCheck: { requestedUrl: url, finalUrl: url, httpStatus: 304, rawHash: "a".repeat(64), checkedAt: rechecked } }]);
  assert.equal(checked.executive?.biography?.collectedAt, original);
  assert.equal(checked.executive?.biography?.checkedAt, rechecked);
  assert.equal(checked.fieldSources?.name.verifiedAt, rechecked);
  const holder = indexByDivision([{ ...base.roster, officeholders: [checked], divisions: base.roster.divisions.filter(row => row.officeholderId === person.id) }]).get("ocd-division/country:us")![0];
  const sources = personCardSources(holder);
  assert.ok(sources.some(source => source.provenance.verifiedAt === rechecked));
});
