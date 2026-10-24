import assert from "node:assert/strict";
import test from "node:test";
import { heldSubjectDetails, heldSubjectEnrichmentObligations } from "../lib/control-plane/scheduler/providers/held-subject-enrichment.ts";
import type { RegistryRuntimeReadModel } from "../lib/registry/runtime-data-plane.ts";
import { extractHeldSubjectDetails } from "../lib/control-plane/scheduler/providers/held-subject-extraction.ts";
import type { Officeholder } from "../lib/officials/types.ts";
import { readHeldSubjectDetails } from "../lib/control-plane/scheduler/providers/held-subject-loader.ts";

const NOW = "2026-10-20T08:00:00.000Z";
const OH = "ocd-division/country:us/state:oh/place:alder";
const AZ = "ocd-division/country:us/state:az/place:elsewhere";
const body = (division: string) => ({ id: `${division}#governing`, ocdId: division, name: "City Council", bodyClass: "GOVERNING",
  homepageUrl: "https://alder.example.gov/council", agendaSourceRef: null, meetingCadence: null,
  provenance: { sourceUrl: "https://alder.example.gov/government", collectedAt: NOW } });

test("a held national directory reads only its exact native person and current state and chamber", () => {
  const held = heldSubjectDetails(registry(true), "OH", NOW).find(row => row.subjectKind === "official")!;
  const sourceUrl = "https://directory.example.gov/current.json";
  const subject = { ...held, personId: "congress:A000001", personName: "Avery Example", officeTitle: "U.S. Representative",
    sourceUrls: [sourceUrl], divisionIds: [OH] };
  const source = JSON.stringify([{ id: { bioguide: "B000001" }, name: { official_full: "Someone Else" }, terms: [{ type: "rep", state: "OH", start: "2025-01-03", end: "2027-01-03", phone: "202-555-0999" }] },
    { id: { bioguide: "A000001" }, name: { official_full: "Avery Example" }, terms: [
      { type: "rep", state: "OH", start: "2023-01-03", end: "2025-01-03", phone: "202-555-0199" },
      { type: "rep", state: "OH", start: "2025-01-03", end: "2027-01-03", phone: "202-555-0101", url: "https://avery.house.gov", office: "100 House Office Building" }] }]);
  const found = extractHeldSubjectDetails(subject, source, sourceUrl, NOW);
  assert.equal(found.refused, null);
  assert.deepEqual(found.facts.map(row => row.value), ["202-555-0101", "https://avery.house.gov", "100 House Office Building", "2025-01-03", "2027-01-03"]);
  assert.ok(found.facts.every(row => source.includes(row.quote)));
  const canonical = extractHeldSubjectDetails({ ...subject, subjectId: "congress:A000001", personId: "person:avery" }, source, sourceUrl, NOW);
  assert.equal(canonical.facts.length, 5);
  assert.ok(canonical.facts.every(row => row.entityId === "person:avery"), "source-native directory identity retains the held canonical person");
  assert.equal(extractHeldSubjectDetails({ ...subject, personName: "Someone Else" }, source, sourceUrl, NOW).facts.length, 0);
  assert.equal(extractHeldSubjectDetails({ ...subject, divisionIds: [AZ] }, source, sourceUrl, NOW).facts.length, 0);
  assert.equal(extractHeldSubjectDetails({ ...subject, officeTitle: "U.S. Senator" }, source, sourceUrl, NOW).facts.length, 0);
});

function registry(complete = false): RegistryRuntimeReadModel {
  const own = body(OH);
  return { registry: { generatedAt: NOW, divisions: [{ ocdId: OH, label: "Alder" }, { ocdId: AZ, label: "Elsewhere" }],
    bodies: [complete ? { ...own, officePhone: "614-555-0100", agendaSourceRef: "https://alder.example.gov/calendar",
      meetingCadence: "Meets every Monday at 7 PM" } : own, body(AZ)] },
    bodyRosters: complete ? [{ bodyId: own.id, bodyName: own.name, sourceUrl: "https://alder.example.gov/roster", collectedAt: NOW,
      members: [{ id: `roster:${own.id}#1`, name: "Avery Example", officeTitle: "Council Member", phone: "614-555-0100",
        email: "avery@alder.example.gov", websiteUrl: null, termNote: "Term ends in 2028" }] }] : [],
    statewideExecutives: [], officialCandidacies: { rows: [] },
  } as unknown as RegistryRuntimeReadModel;
}

test("held bodies get real reads for their remaining details with exact Admin geography and one subject per record", () => {
  const subjects = heldSubjectDetails(registry(), "OH", NOW);
  assert.equal(subjects.length, 1, "another state's body never enters this worker's scope");
  const subject = subjects[0]!;
  assert.equal(subject.subjectId, `${OH}#governing`);
  assert.equal(subject.needsMembers, true);
  assert.ok(subject.checklistIds.includes("GOV-03"));
  assert.ok(subject.checklistIds.includes("GOV-08"));
  assert.ok(subject.checklistIds.includes("MTG-04"));
  assert.deepEqual(subject.divisionIds, [OH]);
  assert.deepEqual(subject.sourceUrls, ["https://alder.example.gov/council", "https://alder.example.gov/government"]);
  const obligations = heldSubjectEnrichmentObligations(subjects);
  assert.equal(obligations.length, 1);
  assert.deepEqual(obligations[0]!.scopeDivisions, [OH], "existing owner-order joins can prioritize this subject");
  assert.equal(obligations[0]!.autonomousPlans, undefined, "free source work cannot start an unbudgeted model scout");
  assert.equal(obligations[0]!.routes.length, 2, "each distinct known publisher page is read");
  assert.equal(new Set(obligations[0]!.routes.map(route => route.routeId)).size, 2);
  assert.ok(obligations[0]!.routes.every(route => route.routeId.startsWith("held-subject-details:") && route.open.kind === "HTTP_GET" && route.executorClass === "DETERMINISTIC"));
});

test("fresh independent facts leave other owed families open, then their own work reopens when stale", () => {
  const current = heldSubjectDetails(registry(true), "oh", NOW);
  const body = current.find(subject => subject.subjectKind === "body")!;
  const person = current.find(subject => subject.subjectKind === "official")!;
  assert.ok(body.checklistIds.includes("GOV-04"), "unread legal enumeration is still owed after contacts are filled");
  assert.ok(person.checklistIds.includes("OFF-12"), "committee assignments are still owed after contact and term attach");
  assert.ok(!body.checklistIds.includes("GOV-08"));
  assert.ok(!person.checklistIds.includes("OFF-09"));
  assert.ok(!person.checklistIds.includes("OFF-06"));
  const later = "2026-12-20T08:00:00.000Z";
  const stale = heldSubjectDetails(registry(true), "oh", later);
  assert.ok(stale.find(subject => subject.subjectKind === "official")!.checklistIds.includes("OFF-09"));
});

test("source URLs are exact held public pages, deduplicated without embedded credentials", () => {
  const value = registry();
  Object.assign(value.registry.bodies[0]!, { homepageUrl: "https://user:private@alder.example.gov/", provenance: { sourceUrl: "https://alder.example.gov/roster", collectedAt: NOW } });
  const subjects = heldSubjectDetails(value, "OH", NOW);
  assert.deepEqual(subjects[0]!.sourceUrls, ["https://alder.example.gov/roster"]);
  const first = heldSubjectEnrichmentObligations(subjects)[0]!.routes[0]!.routeId;
  assert.equal(heldSubjectEnrichmentObligations(subjects)[0]!.routes[0]!.routeId, first);
});

test("held officials and governments keep all owed families with known exact source identities", () => {
  const value = registry(true);
  Object.assign(value.bodyRosters[0]!.members[0]!, { websiteUrl: "https://alder.example.gov/avery", personId: "person:avery" });
  const subjects = heldSubjectDetails(value, "OH", NOW, [{ id: "oh:city:alder", stateCode: "OH", name: "City of Alder",
    ownWebAddress: "https://alder.example.gov/", ocdId: OH, bodyId: `${OH}#governing`, govClass: "CITY_OR_TOWN", checkedAt: NOW }]);
  const official = subjects.find(subject => subject.subjectKind === "official")!;
  assert.equal(official.personId, "person:avery");
  assert.equal(official.bodyId, `${OH}#governing`);
  assert.deepEqual(official.sourceUrls, ["https://alder.example.gov/avery", "https://alder.example.gov/roster"]);
  assert.ok(official.checklistIds.includes("OFF-17"), "portraits remain owed with no parser ceiling");
  assert.ok(official.checklistIds.includes("OFF-18"), "committee hierarchy remains owed after basic term/contact facts attach");
  const government = subjects.find(subject => subject.subjectKind === "government")!;
  assert.equal(government.subjectId, "oh:city:alder");
  assert.deepEqual(government.sourceUrls, ["https://alder.example.gov/"]);
  assert.ok(government.checklistIds.includes("GOV-03"));
  assert.ok(government.checklistIds.includes("GOV-08"));
  assert.ok(!government.checklistIds.some(id => id.startsWith("MTG-")), "a government is not a fictitious meeting body");
});

test("a known delegate's native state scopes its owed work when the held bridge lacks district links", () => {
  const value = { registry: { generatedAt: NOW, divisions: [], bodies: [] }, bodyRosters: [], statewideExecutives: [],
    officialCandidacies: { rows: [{ holder: { id: "congress:A000001", name: "Avery Example", officeTitle: "Delegate", divisions: [],
      sourceUrl: "https://directory.example.gov/current.json", authority: "FEDERAL_DIRECTORY" } }] } } as unknown as RegistryRuntimeReadModel;
  const person = { id: "congress:A000001", state: "AS", websiteUrl: "https://avery.house.gov", provenance: { sourceUrl: "https://directory.example.gov/current.json", collectedAt: NOW } } as Officeholder;
  const found = heldSubjectDetails(value, "AS", NOW, [], [person]);
  assert.equal(found.length, 1);
  assert.deepEqual(found[0]!.divisionIds, ["ocd-division/country:us/territory:as"]);
  assert.equal(found[0]!.sourceUrl, new URL(person.websiteUrl!).href);
  assert.deepEqual(heldSubjectDetails(value, "AS", NOW, [], [{ ...person, state: "GU" }]), []);
});

test("a standing lookup reads only the exact held subject and retains all of its known sources", async () => {
  const queries: { text: string; params: readonly unknown[] }[] = [];
  const value = registry(true), source = value.bodyRosters[0]!;
  const member = { ...source.members[0]!, personId: "person:avery", websiteUrl: "https://alder.example.gov/avery" };
  const subject = await readHeldSubjectDetails(async (text, params = []) => {
    queries.push({ text, params });
    return [{ body: value.registry.bodies[0], roster: { ...source, members: [member] }, executive: null, bridge: null,
      person: null, government: null, checked: NOW }];
  }, "OH", member.id, NOW);
  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0]!.params, ["OH", member.id, NOW]);
  assert.doesNotMatch(queries[0]!.text, /SELECT \*|INSERT|UPDATE|DELETE/);
  assert.equal(subject?.subjectId, member.id);
  assert.equal(subject?.personId, "person:avery");
  assert.equal(subject?.bodyId, source.bodyId);
  assert.deepEqual(subject?.sourceUrls, [member.websiteUrl, source.sourceUrl]);
  assert.ok(subject?.checklistIds.includes("OFF-12"));
});

test("a held government's native state scopes its own source without requiring an unrelated body record", async () => {
  const subject = await readHeldSubjectDetails(async () => [{ body: null, roster: null, executive: null, bridge: null, person: null,
    government: { id: "as:government:held", name: "Held government", stateCode: "AS", ownWebAddress: "https://held.example.gov/", checkedAt: NOW }, checked: NOW }],
  "AS", "as:government:held", NOW);
  assert.equal(subject?.subjectKind, "government");
  assert.deepEqual(subject?.divisionIds, ["ocd-division/country:us/territory:as"]);
  assert.ok(subject?.checklistIds.includes("GOV-08"));
  assert.deepEqual(subject?.sourceUrls, ["https://held.example.gov/"]);
});

test("a body's roster and schedule stop at another named board on the same source page", () => {
  const subject = heldSubjectDetails(registry(), "OH", NOW)[0]!;
  const table = (name: string, office: string) => `<table><tr><th>Name</th><th>Office</th></tr><tr><td>${name}</td><td>${office}</td></tr></table>`;
  const source = `<main><h2>City Council</h2><h3>Members</h3>${table("Avery Example", "Council Member")}
    <h2>Planning Commission</h2>${table("Someone Else", "Commission Member")}<p>Meets every Thursday at 7 PM</p></main>`;
  const found = extractHeldSubjectDetails(subject, source, subject.sourceUrl);
  assert.deepEqual(found.rosterRows.map(row => row.name), ["Avery Example"]);
  assert.equal(found.completeRoster, true);
  assert.ok(!found.facts.some(row => typeof row.value === "string" && row.value.includes("Thursday")));
  const mixed = extractHeldSubjectDetails(subject, `<h1>City Council</h1>${table("Avery Example", "Council Member")}
    ${table("Staff Example", "City Manager")}`, subject.sourceUrl);
  assert.equal(mixed.completeRoster, false, "mixed staff or partial rosters cannot depart a held member");
  assert.deepEqual(mixed.rosterRows.map(row => row.name), ["Avery Example"]);
});

function official() {
  const value = registry(true);
  Object.assign(value.bodyRosters[0]!.members[0]!, { websiteUrl: "https://alder.example.gov/avery", personId: "person:avery" });
  return heldSubjectDetails(value, "OH", NOW).find(subject => subject.subjectKind === "official")!;
}

test("a known official's own labelled page yields office contacts and term with tight source quotes", () => {
  const subject = official();
  const html = `<main><h1>Avery Example</h1><dl><dt>Office phone</dt><dd>614-555-0101</dd><dt>Email</dt><dd>avery@alder.example.gov</dd>
    <dt>Term ends</dt><dd>December 31, 2028</dd><dt>Home address</dt><dd>19 Private Lane</dd>
    <dt>Office address</dt><dd>500 Municipal Plaza</dd></dl><h2>Staff contact</h2><p>Phone: 614-555-9999</p></main>`;
  const read = extractHeldSubjectDetails(subject, html, subject.sourceUrl);
  assert.equal(read.refused, null);
  assert.equal(read.facts.find(fact => fact.field === "phone")?.value, "614-555-0101");
  assert.equal(read.facts.find(fact => fact.field === `term_end:${subject.bodyId}`)?.value, "December 31, 2028");
  assert.equal(read.facts.find(fact => fact.field === "office_address")?.value, "500 Municipal Plaza");
  assert.ok(read.facts.every(fact => fact.entityId === "person:avery" && fact.sourceUrl === subject.sourceUrl));
  assert.ok(read.facts.every(fact => typeof fact.value === "string" && !fact.value.includes("Private") && !fact.quote.includes("Private") && !fact.value.includes("9999")));
});

test("wrong-person pages and a changed source URL cannot supply another official's contacts", () => {
  const subject = official();
  const wrong = `<main><h1>Jordan Other</h1><p>Avery Example formerly served here.</p><dl><dt>Office phone</dt><dd>614-555-9999</dd></dl></main>`;
  assert.equal(extractHeldSubjectDetails(subject, wrong, subject.sourceUrl).refused, "SOURCE_NOT_ABOUT_HELD_SUBJECT");
  const elsewhere = extractHeldSubjectDetails(subject, `<main><h1>Avery Example</h1><p>Phone: 614-555-9999</p></main>`, "https://other.example.gov/");
  assert.equal(elsewhere.refused, "SOURCE_NOT_REGISTERED_FOR_HELD_SUBJECT");
  assert.deepEqual(elsewhere.facts, []);
});

test("roster fields and terms stay on the exact held name and office; staff rows never become body members", () => {
  const subject = official();
  const html = `<main><h1>City Council</h1><table><tr><th>Name</th><th>Office</th><th>Email</th><th>Term ends</th></tr>
    <tr><td>Avery Example</td><td>Council Member</td><td>avery@alder.example.gov</td><td>2028</td></tr>
    <tr><td>Jordan Other</td><td>City Manager</td><td>jordan@alder.example.gov</td><td>2027</td></tr></table></main>`;
  const person = extractHeldSubjectDetails(subject, html, "https://alder.example.gov/roster");
  assert.equal(person.facts.find(fact => fact.field === "email")?.value, "avery@alder.example.gov");
  assert.equal(person.facts.find(fact => fact.field === `term_end:${subject.bodyId}`)?.value, "2028");
  assert.ok(person.facts.every(fact => typeof fact.value === "string" && !fact.value.includes("jordan")));
  const body = heldSubjectDetails(registry(true), "OH", NOW).find(subject => subject.subjectKind === "body")!;
  const roster = extractHeldSubjectDetails(body, html, "https://alder.example.gov/roster");
  assert.deepEqual(roster.rosterRows.map(row => row.name), ["Avery Example"]);
  assert.equal(roster.completeRoster, false, "a filtered table cannot remove absent current members");
});

test("body office contacts, calendar statements and structured own-person fields cite their literal source", () => {
  const body = heldSubjectDetails(registry(), "OH", NOW)[0]!;
  const html = `<main><h1>City Council</h1><p>Office phone: 614-555-0102</p><p>Office address: 500 Municipal Plaza</p>
    <p>The City Council meets every Monday at 7 PM.</p><a href="/agendas">Meeting agendas</a></main>`;
  const read = extractHeldSubjectDetails(body, html, body.sourceUrl);
  assert.equal(read.facts.find(fact => fact.field === "office_phone")?.value, "614-555-0102");
  assert.equal(read.facts.find(fact => fact.field === "meeting_cadence")?.value, "The City Council meets every Monday at 7 PM.");
  assert.equal(read.facts.find(fact => fact.field === "agenda_url")?.value, "https://alder.example.gov/agendas");
  const person = official();
  const structured = `<main><h1>Avery Example</h1></main><script type="application/ld+json">${JSON.stringify([
    { "@type": "Person", name: "Jordan Other", telephone: "614-555-9999" },
    { "@type": "Person", name: "Avery Example", telephone: "614-555-0103", address: "19 Private Lane" },
  ])}</script>`;
  const own = extractHeldSubjectDetails(person, structured, person.sourceUrl);
  assert.deepEqual(own.facts.map(fact => fact.value), ["614-555-0103"]);
  assert.ok(own.facts.every(fact => !fact.quote.includes("Private") && !fact.quote.includes("Jordan")));
});
