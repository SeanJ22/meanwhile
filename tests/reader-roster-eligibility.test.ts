import test from "node:test";
import assert from "node:assert/strict";
import { installRegistryAuthority } from "./helpers/promoted-fixtures.ts";

await installRegistryAuthority();

import { BODY_ROSTERS, HELD_BODY_ROSTERS, ROSTER_READER_DISPOSITIONS, projectReaderRoster, rosterHoldersForBody, rosterGapForBody, rosterGapsForDivision } from "../lib/registry/body-rosters.ts";
import { readerPersonKeys } from "../lib/identity/reader-person.ts";
import { allSeatHolders, seatHolderById } from "../lib/registry/server.ts";

test("malformed roster identities stay held but cannot become an official or contact", async () => {
  const unresolved = ROSTER_READER_DISPOSITIONS.filter(row => row.state === "IDENTITY_UNRESOLVED");
  assert.deepEqual(unresolved.map(row => row.sourceId).sort(), ["roster:nj-morris-boonton#1", "roster:nj-morris-boonton#10", "roster:nj-morris-lincoln_park#1", "roster:nj-morris-mendham_township#1", "roster:nj-morris-mendham_township#6"].sort());
  const raw = HELD_BODY_ROSTERS.flatMap(row => row.members);
  const officials = await allSeatHolders();
  for (const row of unresolved) {
    assert.ok(raw.some(member => member.id === row.sourceId));
    assert.ok(!officials.some(member => member.id === row.sourceId));
    assert.equal(await seatHolderById(row.sourceId), null);
    assert.deepEqual(readerPersonKeys(row.sourceId), { status: "IDENTITY_UNRESOLVED", keys: [] });
  }
});

test("all five identical sourced row aliases resolve to one current official", async () => {
  const aliases = ROSTER_READER_DISPOSITIONS.filter(row => row.state === "EXACT_DUPLICATE");
  assert.equal(aliases.length, 5);
  assert.equal(HELD_BODY_ROSTERS.reduce((n, roster) => n + roster.members.length, 0), 305);
  assert.equal(BODY_ROSTERS.reduce((n, roster) => n + roster.members.length, 0), 295);
  for (const row of aliases) {
    const raw = HELD_BODY_ROSTERS.find(roster => roster.members.some(member => member.id === row.sourceId))!;
    const withoutId = (id: string) => Object.fromEntries(Object.entries(raw.members.find(member => member.id === id)!).filter(([key]) => key !== "id"));
    assert.deepEqual(withoutId(row.sourceId), withoutId(row.canonicalId!));
    const projected = rosterHoldersForBody(raw.bodyId);
    assert.equal(projected.filter(member => member.id === row.canonicalId).length, 1);
    assert.ok(!projected.some(member => member.id === row.sourceId));
    assert.deepEqual(await seatHolderById(row.sourceId), await seatHolderById(row.canonicalId!));
    assert.deepEqual(readerPersonKeys(row.sourceId), readerPersonKeys(row.canonicalId!));
  }
});

test("a duplicate source row cannot conceal the unresolved fifth roster identity", () => {
  const division = "ocd-division/country:us/state:nj/county:morris/place:pequannock_township";
  const gap = rosterGapForBody(`${division}#governing`);
  assert.ok(gap);
  assert.equal(gap.expectedMembers, 5);
  assert.equal(gap.verifiedMembers, 4);
  assert.equal(gap.unresolvedSlots, 1);
  assert.match(gap.statement, /incomplete roster/);
  assert.deepEqual(rosterGapsForDivision(division), [gap]);
  assert.equal(rosterGapForBody("another-body"), null);
  assert.deepEqual(rosterGapsForDivision("another-division"), []);
});

test("same names with different fields never become row aliases; unrelated bodies remain separate", () => {
  const source = HELD_BODY_ROSTERS[0];
  const member = source.members[0];
  const planted = { ...source, members: [member, { ...member, id: "different-person", email: "different@example.org" }, { ...member, id: "navigation", name: "Contact Us" }] };
  const first = projectReaderRoster(planted);
  assert.deepEqual(first.roster.members.map(row => row.id), [member.id, "different-person"]);
  assert.equal(first.dispositions.find(row => row.sourceId === "navigation")?.state, "IDENTITY_UNRESOLVED");
  assert.equal(projectReaderRoster({ ...source, bodyId: "another-body", members: [{ ...member, id: "another-body-person" }] }).roster.members[0].id, "another-body-person");
});

test("a single page word such as Actions never becomes an officeholder's name", () => {
  const source = HELD_BODY_ROSTERS[0];
  const member = source.members[0];
  const out = projectReaderRoster({ ...source, members: [member, { ...member, id: "label", name: "Actions" }] });
  assert.deepEqual(out.roster.members.map(row => row.id), [member.id]);
  assert.equal(out.dispositions.find(row => row.sourceId === "label")?.state, "IDENTITY_UNRESOLVED");
});
