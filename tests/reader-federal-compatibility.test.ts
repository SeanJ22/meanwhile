import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "../app/api/directory/route.ts";
import { federalDirectoryForState } from "../lib/officials/federal-directory-data-plane.ts";
import { readFederalDirectoryProjection } from "../lib/officials/federal-directory-read-model.ts";
import { readNationalShelf } from "../lib/reader/national.ts";
import { installReaderDatabaseQuery } from "../lib/reader/database.ts";
import { installFederalDirectory, syntheticFederalDirectory, registryTransferImport } from "./helpers/promoted-fixtures.ts";
import { activateCanonicalFixture } from "./helpers/canonical-reader-fixtures.ts";
import { stateCoverage } from "../lib/reader/coverage.ts";
import type { Division } from "../lib/registry/types.ts";

test("held vacancies and chamber offices survive state and national composition without another directory query", async () => {
  const original = syntheticFederalDirectory();
  const states = [...new Set(original.roster.officeholders.flatMap(holder => holder.state ? [holder.state] : []))].sort();
  assert.ok(states.length >= 2);
  const member = original.roster.officeholders.find(holder => holder.state)!;
  const sourceUrl = "https://clerk.house.gov/Members/MemberData.xml", at = original.directory.source.collectedAt;
  const vacancies = states.slice(0, 2).map(state => ({ ocdId: `ocd-division/country:us/state:${state.toLowerCase()}/cd:99`,
    sourceUrl, sourceOrg: "House Clerk", collectedAt: at, reason: "Resigned" }));
  const model = { ...original, vacancies, roster: { ...original.roster, officeholders: original.roster.officeholders.map(holder => holder === member ? {
    ...holder, phone: "202-555-0199", offices: [{ name: "Capitol office", address: "1 First St, Washington, DC 20515",
      phone: "202-555-0101", sourceUrl, collectedAt: at }],
    fieldSources: { ...holder.fieldSources, offices: { sourceUrl, sourceOrg: "House Clerk", collectedAt: at, verifiedAt: at } },
  } : holder) } };
  await installFederalDirectory(model);
  activateCanonicalFixture("default");
  for (const state of states.slice(0, 2)) assert.deepEqual(federalDirectoryForState(model, state).vacancies,
    vacancies.filter(row => row.ocdId.includes(`/state:${state.toLowerCase()}/`)));
  const combined = await readFederalDirectoryProjection(states);
  assert.ok(combined.kind === "PROMOTED" || combined.kind === "BOOTSTRAP");
  assert.deepEqual(combined.value.vacancies, vacancies);
  const shelf = await readNationalShelf();
  assert.deepEqual([...shelf.congress.vacancies ?? []].sort((a, b) => a.ocdId.localeCompare(b.ocdId)), vacancies);
  const runtime = registryTransferImport().projection.payload;
  const division: Division = { ...runtime.registry.divisions[0], ocdId: vacancies[0].ocdId,
    divisionType: "cd", tier: "national", state: states[0], label: "Vacant House district" };
  const coverage = stateCoverage({ state: states[0], version: "held-vacancy", federal: federalDirectoryForState(model, states[0]),
    registry: { ...runtime, registry: { ...runtime.registry, bodies: [], divisions: [division] } } }, [division.ocdId], 0, 0);
  assert.deepEqual(coverage.seats[0].vacancy, vacancies[0], "state and place composition retain the sourced vacancy");
  let queries = 0;
  installReaderDatabaseQuery(async () => { queries++; throw new Error("The held national directory must not query again"); });
  try {
    const response = await GET(new Request(`https://meanwhile.example/api/directory?member=${encodeURIComponent(member.id)}&state=${member.state}`));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.districtOffices.length, 1 + original.directory.byMember[member.id.slice(9)].districtOffices.length);
    assert.equal(body.districtOffices[0].phone, "202-555-0101", "the chamber office keeps its own phone");
    assert.deepEqual(body.officeDetails[0], { officeKind: "CAPITOL", sourceUrl, sourceOrg: "House Clerk", collectedAt: at, official: true });
    assert.equal(body.officeDetails.length, body.districtOffices.length);
    assert.equal(queries, 0);
  } finally { installReaderDatabaseQuery(undefined); }
});
