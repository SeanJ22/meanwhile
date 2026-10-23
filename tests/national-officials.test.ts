import assert from "node:assert/strict";
import test from "node:test";
import { publishPeopleSource } from "../lib/civic-data/people-source-publication.ts";
import { readPeopleSourceProjection } from "../lib/civic-data/people-source-read.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { acquireKnownRelease } from "../lib/sources/known-release.ts";
import { ADMINISTRATION_URL, acquirePresidentPeople, currentWhiteHouseLink, verifiedWhiteHouseOfficial } from "../lib/sources/white-house/president.ts";
import type { OfficeholderSet } from "../lib/officials/types.ts";
import { withMigratedRoutineStore } from "./helpers/migrated-routine-store.ts";

const SOURCE = "statewide-executive-sources", COUNTRY = "ocd-division/country:us";
const profile = (slug: string) => `${ADMINISTRATION_URL}${slug}/`;
const index = (president: string, vice = "Taylor Example") => `<main><a href="${profile(president.toLowerCase().replaceAll(" ", "-"))}">President ${president}</a>` +
  `<a href="${profile(vice.toLowerCase().replaceAll(" ", "-"))}">Vice President ${vice}</a><a href="https://www.whitehouse.gov/contact/">Contact</a></main>`;
const page = (name: string, vice = false) => `<main><h1>${name}</h1><p>${vice ? "Vice President" : "President"} of the United States</p></main>`;

async function acquire(president: string, at: string, vice: string | null = "Taylor Example", malformedVice = false) {
  const vault = new MemoryEvidenceStore(), { locks } = createMemoryRepositories();
  const presidentUrl = profile(president.toLowerCase().replaceAll(" ", "-")), viceName = vice ?? "Taylor Example";
  const viceUrl = profile(viceName.toLowerCase().replaceAll(" ", "-"));
  return acquirePresidentPeople({ store: vault, locks, now: () => at, signal: new AbortController().signal, acquire: acquireKnownRelease,
    fetchImpl: (async resource => {
      const url = String(resource);
      if (url === ADMINISTRATION_URL) return new Response(index(president, viceName));
      if (url === presidentUrl) return new Response(page(president));
      assert.equal(url, viceUrl);
      if (!vice) throw new Error("Vice President profile unavailable");
      return new Response(page(malformedVice ? "Someone Else" : vice, true));
    }) as typeof fetch });
}

test("White House roles have independent index/profile identity and official contact attribution", async () => {
  const at = "2026-10-20T00:00:00.000Z", html = index("Jordan Example");
  assert.equal(currentWhiteHouseLink("vice-president", html).name, "Taylor Example");
  assert.throws(() => verifiedWhiteHouseOfficial("vice-president", { url: ADMINISTRATION_URL, html },
    { url: profile("jordan-example"), html: page("Jordan Example"), retrievedAt: at }));
  assert.throws(() => verifiedWhiteHouseOfficial("vice-president", { url: ADMINISTRATION_URL, html },
    { url: "https://obamawhitehouse.archives.gov/administration/taylor-example/", html: page("Taylor Example", true), retrievedAt: at }));
  const acquired = await acquire("Jordan Example", at);
  assert.deepEqual(acquired.roster.officeholders.map(person => person.officeTitle), ["President of the United States", "Vice President of the United States"]);
  for (const person of acquired.roster.officeholders) {
    assert.equal(person.contactFormUrl, "https://www.whitehouse.gov/contact/");
    assert.equal(person.fieldSources?.contactFormUrl?.sourceUrl, ADMINISTRATION_URL);
    assert.equal(person.memberships?.[0].divisionId, COUNTRY);
  }
  const partial = await acquire("Jordan Example", at, null);
  assert.deepEqual(partial.roster.officeholders.map(person => person.name), ["Jordan Example"]);
  assert.ok(partial.gaps.some(gap => gap.detail.includes("vice-president")));
});

test("national publication isolates invalid offices, retains missing VP facts and evidence, and retires only verified replacements", async () => {
  await withMigratedRoutineStore("people-statewide-executive-sources-us", async (store, vault, pg) => {
    const start = Date.now() - 60_000;
    let sequence = 0;
    const at = () => new Date(start + sequence++ * 1000).toISOString();
    const publish = (release: Awaited<ReturnType<typeof acquire>>, now: string) => publishPeopleSource({ store, vault, state: "us", sourceId: SOURCE,
      roster: release.roster, acquisitions: release.acquisitions, gaps: release.gaps, releaseId: release.releaseId, now });
    const current = async () => {
      const read = await readPeopleSourceProjection("US", SOURCE, { store, bypassCache: true });
      assert.equal(read.kind, "PROMOTED");
      if (read.kind !== "PROMOTED") throw new Error(JSON.stringify(read));
      const ids = new Set(read.value.roster.divisions.map(link => link.officeholderId));
      return { roster: read.value.roster, people: read.value.roster.officeholders.filter(person => ids.has(person.id)) };
    };
    const firstAt = at(), initial = await publish(await acquire("Jordan Example", firstAt), firstAt);
    assert.ok(initial.outcome.promoted, JSON.stringify(initial.outcome.candidate.receipt));
    assert.deepEqual((await current()).people.map(person => person.name), ["Jordan Example", "Taylor Example"]);
    for (const malformed of [false, true, true]) {
      const nextAt = at(), release = await acquire("Alex Example", nextAt, malformed ? "Taylor Example" : null, malformed);
      const result = await publish(release, nextAt);
      assert.ok(result.outcome.promoted || result.outcome.confirmed, JSON.stringify(result.outcome.candidate.receipt));
      const read = await current();
      assert.deepEqual(read.people.map(person => person.name).sort(), ["Alex Example", "Taylor Example"]);
      assert.equal(read.people.find(person => person.name === "Taylor Example")?.provenance.collectedAt, firstAt);
      assert.equal(read.people.find(person => person.name === "Taylor Example")?.contactFormUrl, "https://www.whitehouse.gov/contact/");
      assert.ok(read.roster.endedMemberships?.some(membership => membership.personId === "white-house:jordan-example" && membership.current === false));
    }
    // An invalid row injected after parsing is independently refused by publication.
    const badAt = at(), injected = await acquire("Morgan Example", badAt);
    injected.roster = { ...injected.roster, officeholders: injected.roster.officeholders.map(person => person.officeTitle.startsWith("Vice") ? { ...person, name: "Fabricated Name" } : person) } as OfficeholderSet;
    const isolated = await publish(injected, badAt);
    assert.ok(isolated.outcome.promoted);
    assert.ok(isolated.candidate.excludedFacts?.some(fact => fact.code === "NATIONAL_OFFICIAL_UNVERIFIED"));
    assert.deepEqual((await current()).people.map(person => person.name).sort(), ["Morgan Example", "Taylor Example"]);
    const finalAt = at(), final = await publish(await acquire("Morgan Example", finalAt, "Casey Example"), finalAt);
    assert.ok(final.outcome.promoted);
    assert.deepEqual((await current()).people.map(person => person.name).sort(), ["Casey Example", "Morgan Example"]);
    const rows = await pg.query<{ state: string }>("SELECT state FROM civic_data_candidates");
    assert.ok(rows.rows.some(row => row.state === "PROMOTED"));
    const triggers = await pg.query("SELECT tgname FROM pg_trigger WHERE tgrelid='civic_data_candidates'::regclass AND NOT tgisinternal");
    assert.ok(triggers.rows.length > 0, "the real migration's candidate integrity triggers remain active");
  });
});
