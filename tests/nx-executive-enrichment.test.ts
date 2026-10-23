import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { acquirePresidentPeople, ADMINISTRATION_URL } from "../lib/sources/white-house/president.ts";
import { enrichNationalExecutives } from "../lib/sources/white-house/enrichment.ts";
import { EXECUTIVE_TERM_SOURCES, CABINET_TENURE_SOURCE_URL } from "../lib/sources/white-house/profile.ts";
import { acquireKnownRelease } from "../lib/sources/known-release.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { indexByDivision } from "../lib/officials/lookup.ts";
import type { ExecutiveEnrichmentOptions } from "../lib/sources/white-house/enrichment.ts";

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
  const fetchImpl = (async resource => {
    const url = String(resource);
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
