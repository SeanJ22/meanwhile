import assert from "node:assert/strict";
import { test } from "node:test";
import { acquirePresidentPeople, currentPresidentLink, verifiedPresident, ADMINISTRATION_URL } from "../lib/sources/white-house/president.ts";
import { acquireKnownRelease } from "../lib/sources/known-release.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { publishPeopleSource } from "../lib/civic-data/people-source-publication.ts";
import { peopleJurisdiction, readPeopleSourceProjection } from "../lib/civic-data/people-source-read.ts";
import { parsePeopleSourceArguments, runPeopleSourceRefresh } from "../lib/civic-data/people-source-runtime.ts";
import { peopleSourceContractId } from "../lib/civic-data/people-source-contracts.ts";
import { currentPresidentRoster } from "../lib/reader/national.ts";
import { ROUTINE_SOURCE_TASKS } from "../lib/civic-data/runner.ts";

const AT = "2026-10-12T00:00:00.000Z";
const SOURCE = "statewide-executive-sources";
const profileUrl = (slug: string) => `${ADMINISTRATION_URL}${slug}/`;
const indexHtml = (name: string, slug: string) => `<main><a href="${profileUrl("vice-president")}">Vice President Other Person</a><a href="${profileUrl(slug)}">President ${name}</a></main>`;
const profileHtml = (name: string) => `<main><h1>${name}</h1><p>47th President of the United States</p></main>`;

async function acquired(name: string, slug: string, at = AT) {
  const { locks } = createMemoryRepositories(), store = new MemoryEvidenceStore(), requests: string[] = [];
  const release = await acquirePresidentPeople({ store, locks, signal: new AbortController().signal, acquire: acquireKnownRelease, now: () => at,
    fetchImpl: (async resource => {
      const url = String(resource); requests.push(url);
      assert.ok([ADMINISTRATION_URL, profileUrl(slug)].includes(url));
      return new Response(url === ADMINISTRATION_URL ? indexHtml(name, slug) : profileHtml(name), { headers: { "content-type": "text/html" } });
    }) as typeof fetch });
  return { ...release, requests };
}

test("the standing national command uses the existing executive source and exact US scope", () => {
  assert.deepEqual(parsePeopleSourceArguments(["--promote", "--state=us", `--source=${SOURCE}`]), { state: "us", sourceId: SOURCE });
  assert.throws(() => parsePeopleSourceArguments(["--promote", "--state=us", "--source=legiscan-api"]));
  assert.equal(peopleJurisdiction("us"), "US");
  const task = ROUTINE_SOURCE_TASKS.find(task => task.id === peopleSourceContractId("us", SOURCE));
  assert.deepEqual(task?.command, ["scripts/national-people-refresh.mts", "--promote", "--state=us", `--source=${SOURCE}`]);
  assert.equal(task?.scope, "US:people:statewide-executive-sources:v1");
});

test("acquisition derives the current President from the official index and rejects unrelated or archived profiles", async () => {
  const release = await acquired("Jordan Example", "jordan-example");
  assert.deepEqual(release.requests, [ADMINISTRATION_URL, profileUrl("jordan-example")]);
  assert.equal(release.roster.officeholders[0].name, "Jordan Example");
  assert.equal(release.roster.officeholders[0].officeTitle, "President of the United States");
  assert.equal(release.roster.officeholders[0].level, "FEDERAL");
  assert.equal(release.roster.officeholders[0].partyLabel, null);
  assert.equal(release.roster.officeholders[0].termStart, "");
  assert.equal(release.roster.divisions[0].ocdId, "ocd-division/country:us");
  assert.throws(() => currentPresidentLink('<a href="/administration/vice/">Vice President Someone Else</a>'));
  assert.throws(() => verifiedPresident({ url: ADMINISTRATION_URL, html: indexHtml("Jordan Example", "jordan-example") },
    { url: "https://trumpwhitehouse.archives.gov/administration/jordan-example/", html: profileHtml("Jordan Example"), retrievedAt: AT }));
  assert.throws(() => verifiedPresident({ url: ADMINISTRATION_URL, html: indexHtml("Jordan Example", "jordan-example") },
    { url: profileUrl("jordan-example"), html: profileHtml("Someone Else"), retrievedAt: AT }));
});

test("verified President facts publish through the standing store, retain the prior record after failure, and follow a transition", async () => {
  const store = new MemoryRoutineDataStore(), vault = new MemoryEvidenceStore();
  const first = await acquired("Jordan Example", "jordan-example");
  const publish = (release: Awaited<ReturnType<typeof acquired>>, now: string) => publishPeopleSource({ store, vault, state: "us", sourceId: SOURCE,
    roster: release.roster, acquisitions: release.acquisitions, releaseId: release.releaseId, now });
  const initial = await publish(first, AT);
  assert.ok(initial.outcome.promoted, JSON.stringify(initial.outcome));
  const read = await readPeopleSourceProjection("US", SOURCE, { store, now: AT });
  assert.equal(read.kind, "PROMOTED");
  assert.equal(read.value?.roster.officeholders[0].name, "Jordan Example");
  const invalid = { ...first, roster: { ...first.roster, officeholders: first.roster.officeholders.map(person => ({ ...person, name: "Invented Person" })) } };
  const failed = await publish(invalid, "2026-10-12T00:01:00.000Z");
  assert.equal(failed.outcome.promoted, null);
  assert.equal((await readPeopleSourceProjection("US", SOURCE, { store, now: AT })).value?.roster.officeholders[0].name, "Jordan Example");
  const nextAt = "2026-10-14T00:00:00.000Z", next = await acquired("Alex Example", "alex-example", nextAt);
  const changed = await publish(next, nextAt);
  assert.ok(changed.outcome.promoted, JSON.stringify(changed.outcome));
  const current = await readPeopleSourceProjection("US", SOURCE, { store, now: nextAt });
  const currentIds = new Set(current.value?.roster.divisions.map(link => link.officeholderId));
  assert.deepEqual(current.value?.roster.officeholders.filter(person => currentIds.has(person.id)).map(person => person.name), ["Alex Example"]);
  assert.deepEqual(currentPresidentRoster(current.value!.roster)?.officeholders.map(person => person.name), ["Alex Example"]);
  assert.equal(currentPresidentRoster({ ...current.value!.roster, divisions: [] }), null);
  assert.ok(current.value?.roster.endedMemberships?.some(membership => membership.personId === first.roster.officeholders[0].id && membership.current === false));
  assert.ok(await store.readCandidate(initial.candidate.id), "the earlier source-backed candidate remains retrievable");
});


test("the normal standing runtime publishes the national source without opening a state partition", async () => {
  const store = new MemoryRoutineDataStore(), vault = new MemoryEvidenceStore(), release = await acquired("Jordan Example", "jordan-example");
  const scopes: string[] = [], readPromotion = store.readPromotion.bind(store), lines: string[] = [];
  store.readPromotion = async (recordClass, scope) => { scopes.push(scope); return readPromotion(recordClass, scope); };
  const result = await runPeopleSourceRefresh({ state: "us", sourceId: SOURCE, store, vault }, {
    now: () => AT, acquire: async () => release, writeLine: line => lines.push(line),
    readDivisions: async () => { throw new Error("A President does not need state boundaries"); },
  });
  assert.equal(result.succeeded, true, lines.join("\n"));
  assert.ok(scopes.length > 0 && scopes.every(scope => scope === "US:people:statewide-executive-sources:v1"));
  assert.ok(lines.some(line => line.startsWith("RCD_RECEIPT=") && line.includes("people-statewide-executive-sources-us")));
});
