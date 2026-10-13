import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { legistarMemberRosters, makeLegistarMembersReader, type LegistarMembers } from "../lib/sources/legistar/members.ts";
import { legistarMembersPackage, publishLegistarMembers } from "../lib/sources/legistar/members-publication.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { readRegistryRuntimePrior, registryRuntimeCandidate } from "../lib/registry/runtime-data-plane.ts";
import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { CENSUS_PLACEHOLDER_LABELS } from "../lib/registry/census-placeholders.ts";
import type { BodySourceWiring } from "../lib/registry/source-wiring.ts";
import { automaticRefreshContract } from "../lib/civic-data/automatic-refresh.ts";
import { legistarMemberTasks, legistarMemberClocks } from "../lib/sources/legistar/members-tasks.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { loadLegistarMembers, saveLegistarMembers } from "../lib/sources/legistar/members-cache.ts";
import { dataDoorConfig } from "../lib/civic-data/derived-door-kinds.ts";

const NOW = "2026-10-13T20:00:00.000Z";
const fixture = (tenant: string, file: string) => readFileSync(new URL(`./fixtures/legistar-members/${tenant}/${file}`, import.meta.url), "utf8");
const rawFor = (slug: string): LegistarMembers => {
  const readings = ["bodies", "persons", "officerecords"].map(collection => {
    const text = fixture(slug, `${collection}.json`), meta = JSON.parse(fixture(slug, `${collection}.meta.json`));
    assert.equal(createHash("sha256").update(text).digest("hex"), meta.sha256);
    return { url: meta.sourceUrl, text, retrievedAt: meta.retrievedAt };
  });
  return { slug, bodies: JSON.parse(readings[0].text), persons: JSON.parse(readings[1].text), offices: JSON.parse(readings[2].text),
    signature: createHash("sha256").update(readings.map(reading => reading.text).join("\n")).digest("hex"), collectedAt: readings[2].retrievedAt, readings };
};
const wiring = (raw: LegistarMembers, state: string, zone: string): BodySourceWiring[] => raw.bodies.map(body => ({
  bodyId: `ocd-division/country:us/state:${state.toLowerCase()}/place:${raw.slug}#body:${body.BodyId}`,
  ocdId: `ocd-division/country:us/state:${state.toLowerCase()}/place:${raw.slug}`, agendaSourceType: "LEGISTAR",
  publishingOrg: raw.slug, jurisdiction: raw.slug, timeZone: zone, verifiedAt: NOW,
  config: { slug: raw.slug, eventBodyId: String(body.BodyId), sourceRoutes: "legistar" },
}));

for (const [tenant, state, zone] of [["pima", "AZ", "America/Phoenix"], ["seattle", "WA", "America/Los_Angeles"], ["madison", "WI", "America/Chicago"]]) {
  test(`${state}: ${tenant}'s real office records retain exact people, bodies and term dates`, () => {
    const raw = rawFor(tenant), rows = wiring(raw, state, zone);
    assert.equal(JSON.parse(fixture(tenant, "bodies.meta.json")).state, state);
    const rosters = legistarMemberRosters(raw, rows, NOW);
    assert.equal(rosters.length, raw.bodies.length);
    const members = rosters.flatMap(roster => roster.members);
    assert.ok(members.length > 0);
    for (const roster of rosters) for (const member of roster.members) {
      const office = raw.offices.find(office => member.id === `legistar:${tenant}:person:${office.OfficeRecordPersonId}:office:${office.OfficeRecordId}`)!;
      assert.equal(member.personId, `legistar:${tenant}:person:${office.OfficeRecordPersonId}`);
      assert.equal(roster.bodyId, rows.find(row => Number(row.config.eventBodyId) === office.OfficeRecordBodyId)!.bodyId);
      assert.equal(member.termStart, office.OfficeRecordStartDate?.slice(0, 10) ?? null);
      assert.equal(member.termEnd, office.OfficeRecordEndDate?.slice(0, 10) ?? null);
      assert.equal(member.name, office.OfficeRecordFullName.trim());
    }
  });
}

test("Legistar checks every row version before full reads and detects changed or deleted low-id records", async () => {
  const raw = rawFor("pima"), calls: string[] = [];
  let data = raw;
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = new URL(String(input)), collection = url.pathname.split("/").at(-1)!;
    calls.push(collection + (url.searchParams.has("$select") ? ":probe" : ":full"));
    const rows = collection === "bodies" ? data.bodies : collection === "persons" ? data.persons : data.offices;
    const selected = url.searchParams.get("$select")?.split(",");
    return Response.json(selected ? rows.map(row => Object.fromEntries(selected.map(key => [key, (row as unknown as Record<string, unknown>)[key]]))) : rows);
  }) as typeof fetch;
  const read = makeLegistarMembersReader(fetchImpl);
  const first = await read("pima");
  assert.deepEqual(calls.slice(0, 3), ["bodies:probe", "persons:probe", "officerecords:probe"]);
  calls.length = 0;
  assert.equal((await read("pima")).signature, first.signature);
  assert.equal(calls.length, 3);
  data = { ...raw, offices: raw.offices.map((office, i) => i === 0 ? { ...office, OfficeRecordRowVersion: "changed" } : office) };
  calls.length = 0;
  assert.notEqual((await read("pima")).signature, first.signature);
  assert.equal(calls.length, 6);
  data = { ...data, offices: data.offices.slice(1) };
  assert.equal((await read("pima")).offices.length, raw.offices.length - 1);
});

test("terms advance on the body's date without dropping open-ended or future memberships", () => {
  const raw = rawFor("pima"), rows = wiring(raw, "AZ", "America/Phoenix");
  const office = raw.offices.find(office => office.OfficeRecordBodyId === 138)!;
  const control = { ...raw, offices: [{ ...office, OfficeRecordStartDate: "2026-10-14T00:00:00", OfficeRecordEndDate: null }] };
  assert.equal(legistarMemberRosters(control, rows, NOW).flatMap(row => row.members).length, 0);
  assert.equal(legistarMemberRosters(control, rows, "2026-10-14T12:00:00Z").flatMap(row => row.members).length, 1);
  assert.throws(() => legistarMemberRosters({ ...control, offices: [{ ...office, OfficeRecordStartDate: "2026-02-30T00:00:00" }] }, rows, NOW), /TERM_INVALID/);
});

test("the standing roster task publishes real Pima members and terms through the typed reader projection", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse(NOW) });
  const { record, projection } = JSON.parse(gunzipSync(readFileSync("tests/fixtures/registry-transfer-import.json.gz")).toString());
  const store = new MemoryRoutineDataStore();
  Object.assign(store, { candidates: new Map([[record.candidate.id, record]]), promotions: new Map([[projection.key, projection]]) });
  let prior = (await readRegistryRuntimePrior(store, NOW))!;
  const divisions = prior.payload.registry.divisions.filter(row => CENSUS_PLACEHOLDER_LABELS[row.label]).map(row => ({ ...row, label: CENSUS_PLACEHOLDER_LABELS[row.label] }));
  const corrected = registryRuntimeCandidate({ contractId: "registry-runtime-bindings", scope: "MEMBERS", version: "fixture-census-correction", sourceThrough: NOW,
    sourceReceipt: { contractVersion: 1, reviewedAt: NOW, reviewedBy: "fixture-census-correction", sources: [...new Set(divisions.map(row => row.provenance!.sourceUrl!))].map(url => ({ requestedUrl: url, finalUrl: url, publisher: "U.S. Census Bureau", sourceClass: "OFFICIAL_PUBLISHER", retrievedAt: NOW, httpStatus: 200, rawHash: createHash("sha256").update(JSON.stringify(divisions)).digest("hex"), reviewedEvidence: "Fixture replay of the deployed Census placeholder correction." })) },
    payload: { ...prior.payload, registry: { ...prior.payload.registry, divisions, bodies: [] }, bodyRosters: [], rosterReaderDispositions: [], statewideExecutives: [], officialCandidacies: { ...prior.payload.officialCandidacies, rows: [] }, officialPhotos: { photos: [] }, rosterPhotos: {} } }, { prior });
  const correction = await processRegisteredManualCandidate(store, "registry-runtime-bindings", corrected, NOW, prior.versionId);
  assert.ok(correction.promoted, correction.candidate.failureDetail ?? "fixture correction held");
  prior = (await readRegistryRuntimePrior(store, NOW))!;
  const pima = prior.payload.registry.bodies.find(body => body.ocdId?.endsWith("/county:pima") && body.bodyClass === "GOVERNING")!;
  assert.ok(pima);
  const raw = rawFor("pima"), rows = [{ ...wiring(raw, "AZ", "America/Phoenix")[0], bodyId: pima.id, ocdId: pima.ocdId }];
  const prepared = legistarMembersPackage(raw, rows, prior, NOW);
  assert.ok(prepared.payload.bodyRosters.some(roster => roster.bodyId === pima.id));
  const result = await publishLegistarMembers({ store, raw, rows, prior, now: NOW });
  assert.equal(result.members, 15);
  const read = (await readRegistryRuntimePrior(store, NOW))!;
  const roster = read.payload.bodyRosters.find(row => row.bodyId === pima.id)!;
  const rex = roster.members.find(member => member.id === "legistar:pima:person:206:office:571")!;
  assert.equal(rex.name, "Rex Scott"); assert.equal(rex.termStart, "2021-01-01"); assert.equal(rex.termEnd, "2028-12-31");
  const updated = { ...raw, offices: raw.offices.map(office => office.OfficeRecordId === 571 ? { ...office, OfficeRecordEndDate: "2026-10-12T00:00:00" } : office) };
  const next = legistarMembersPackage(updated, rows, read, NOW);
  assert.ok(next.departures.some(departure => departure.holderId === rex.id));
  assert.equal(automaticRefreshContract("legistar-members:pima"), "registry-runtime-bindings");
  assert.ok(legistarMemberTasks(rows)[0].command.includes("--legistar-client=pima"));
  const clocks = await legistarMemberClocks(store, NOW);
  assert.ok(clocks.has("legistar-members:pima"));
  assert.equal(clocks.has("legistar-members:seattle"), false);
  assert.equal(dataDoorConfig({ kind: "LEGISTAR", route: "https://webapi.legistar.com/v1/pima/events", slug: "unused", bodyName: "Board of Supervisors", filter: { eventBodyId: "138" } }).sourceRoutes, "legistar");
});

test("a new process reuses intact vaulted source pages after checking every native row version", async () => {
  const vault = new MemoryEvidenceStore(), raw = rawFor("pima");
  await saveLegistarMembers(vault, raw, NOW);
  const cached = await loadLegistarMembers(vault, "pima");
  assert.ok(cached);
  let fullReads = 0;
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const selected = url.searchParams.get("$select")?.split(",");
    if (!selected) fullReads++;
    const rows = url.pathname.endsWith("/bodies") ? raw.bodies : url.pathname.endsWith("/persons") ? raw.persons : raw.offices;
    return Response.json(rows.map(row => Object.fromEntries(selected!.map(key => [key, (row as unknown as Record<string, unknown>)[key]]))));
  }) as typeof fetch;
  const read = await makeLegistarMembersReader(fetchImpl, cached)("pima");
  assert.equal(fullReads, 0);
  assert.equal(read.collectedAt, raw.collectedAt);
  await saveLegistarMembers(vault, read, NOW);
  assert.equal((await loadLegistarMembers(vault, "pima"))!.signature, read.signature);
  assert.ok(read.readings.some(reading => new URL(reading.url).searchParams.has("$select")));
});

test("a shared tenant preserves exact existing body bindings while unbound bodies stay owed", () => {
  const raw = rawFor("pima"), rows = wiring(raw, "AZ", "America/Phoenix").slice(0, 2);
  rows[1] = { ...rows[1], ocdId: "ocd-division/country:us/state:az/place:other" };
  const base = JSON.parse(gunzipSync(readFileSync("tests/fixtures/registry-transfer-import.json.gz")).toString()).projection.payload;
  const prepared = legistarMembersPackage(raw, rows, { versionId: "fixture", payload: base, sourceReceipt: { contractVersion: 1, reviewedAt: NOW, reviewedBy: "fixture", sources: [] }, readModelSha256: "a".repeat(64) }, NOW);
  assert.deepEqual(prepared.payload.bodyRosters.map(row => row.bodyId), rows.map(row => row.bodyId));
  assert.equal(prepared.excludedFacts.length, raw.bodies.length - rows.length);
});
