import assert from "node:assert/strict";
import test from "node:test";

import { readFieldManual, type FieldManualEntry, type FieldManualRepos } from "../lib/control-plane/field-manual.ts";
import { fieldManualNotes, seedFieldManualNotes } from "../lib/control-plane/field-manual-notes.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { scoutFieldManualProjection, scoutFieldManualQuery } from "../lib/control-plane/scheduler/field-manual-scout.ts";

const NOW = "2026-10-14T12:00:00.000Z";
const KINDS = ["SOURCE_PAGE", "SEARCH_ROUTE", "DEAD_END", "WALL", "PLATFORM_NOTE", "SOURCE_REGISTER"];
const AZ = "ocd-division/country:us/state:az";
const MARICOPA = `${AZ}/county:maricopa`;
/** AZ-01's governments as its owed list resolves them: the country, the state, the district, the county, and the cities, towns and school districts inside it. */
const AZ_01 = [
  "ocd-division/country:us", AZ, `${AZ}/cd:1`, MARICOPA,
  ...["phoenix", "scottsdale", "paradise_valley", "fountain_hills", "cave_creek", "carefree"].map(place => `${AZ}/place:${place}`),
  ...["scottsdale", "paradise_valley", "cave_creek", "fountain_hills"].map(name => `${AZ}/school_district:${name}_unified_district`),
];
/** How many notes a hunt packet's brief carries. */
const PACKET_NOTES = 12;

/** The field-manual read a hunt packet's job makes for its government. */
async function packetNotes(repos: FieldManualRepos, governmentId: string) {
  const opts = { subjectId: governmentId, divisions: [governmentId] };
  return scoutFieldManualProjection(await readFieldManual(repos, scoutFieldManualQuery(opts)), { ...opts, limit: PACKET_NOTES });
}

test("the notes are one-line rows by state and kind, and the registry rows carry access, licence and status", async () => {
  const notes = await fieldManualNotes();
  assert.equal(new Set(notes.map(note => note.id)).size, notes.length);
  for (const note of notes) {
    assert.ok(KINDS.includes(note.kind), `${note.id} ${note.kind}`);
    assert.ok(note.summary.length > 0 && note.summary.length <= 320 && !/\n/.test(note.summary), note.id);
    assert.ok(note.states.every(state => /^[a-z]{2}$/.test(state)), note.id);
    if (note.kind === "DEAD_END" || note.kind === "WALL") assert.ok(["ZERO", "BLOCKED", "FAILED"].includes(note.outcome), note.id);
    if (note.kind === "SOURCE_REGISTER") {
      const payload = note.payload as { access?: unknown; licence?: unknown; status?: unknown };
      assert.ok([payload.access, payload.licence, payload.status].every(value => typeof value === "string"), note.id);
    }
  }
  for (const state of ["az", "nh", "nj"]) {
    for (const kind of ["SOURCE_PAGE", "DEAD_END", "WALL"]) assert.ok(notes.some(note => note.kind === kind && note.states.includes(state)), `${state} ${kind}`);
  }
  assert.ok(notes.filter(note => note.kind === "SOURCE_REGISTER").length >= 100);
});

test("seeding loads every note once, and a held row keeps what was written to it since", async () => {
  const repos = createMemoryRepositories();
  const notes = await fieldManualNotes();
  assert.deepEqual(await seedFieldManualNotes(repos, NOW), { created: notes.length, present: 0 });
  const held = (await repos.fieldManual.read(notes[0]!.id))!;
  const edited: FieldManualEntry = { ...held.value, summary: "Re-walked: the page moved." };
  await repos.fieldManual.compareAndSet(held.id, held.revision, edited, NOW);
  assert.deepEqual(await seedFieldManualNotes(repos, "2026-10-15T12:00:00.000Z"), { created: 0, present: notes.length });
  assert.equal((await repos.fieldManual.read(held.id))!.value.summary, "Re-walked: the page moved.");
});

test("an AZ-01 hunt packet carries the loaded notes for each of its governments", async () => {
  const repos = createMemoryRepositories();
  await seedFieldManualNotes(repos, NOW);
  const notes = new Map((await fieldManualNotes()).map(note => [note.id, note] as const));
  for (const government of AZ_01) {
    const read = await packetNotes(repos, government);
    assert.equal(read.lines.length, PACKET_NOTES, government);
    assert.ok(read.entryIds.every(id => notes.has(id)), government);
    const carried = read.entryIds.map(id => notes.get(id)!);
    if (government === "ocd-division/country:us") {
      assert.ok(carried.every(note => note.portable === true || note.platforms.length > 0), "the country carries national and platform notes");
    }
    else assert.ok(carried.some(note => note.states.includes("az")), `${government} carries Arizona notes`);
  }
  const maricopa = await packetNotes(repos, MARICOPA);
  const own = [...notes.values()].filter(note => note.ocdIds?.includes(MARICOPA));
  assert.ok(own.length > 0);
  assert.deepEqual(maricopa.entryIds.slice(0, own.length).sort(), own.map(note => note.id).sort(), "Maricopa's own notes come first");
  const state = await packetNotes(repos, AZ);
  assert.ok(state.lines.some(line => / seen \d{4}-\d{2}-\d{2}/.test(line)), "notes carry the date they were seen");
});
