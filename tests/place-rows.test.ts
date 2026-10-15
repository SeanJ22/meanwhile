import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { readPlacePointerSlices } from "../lib/civic-data/held-place-slices.ts";
import { HELD_PLACE_ROWS_SQL, placeRowsOf, placeRowStatements, UNBUILT_PLACE_ROWS_SQL } from "../lib/civic-data/place-rows.ts";
import type { ReadOnlyQuery } from "../lib/control-plane/admin-view/promoted-slices.ts";

const AZ = "ocd-division/country:us/state:az";
const PIMA = `${AZ}/county:pima`, COCHISE = `${AZ}/county:cochise`, TUCSON = `${AZ}/place:tucson`;

async function db() {
  const pg = new PGlite();
  await pg.exec(`CREATE TABLE civic_data_promotions (record_class text, scope text, current_version_id text, payload jsonb, promoted_at timestamptz,
    PRIMARY KEY (record_class, scope))`);
  const migration = readFileSync(join(import.meta.dirname, "..", "lib", "db", "migrations", "H-01_place_rows.sql"), "utf8");
  for (const statement of migration.split("--> statement-breakpoint")) await pg.exec(statement);
  /* The registry overlay reads the fact store, which these tests leave empty. */
  const query: ReadOnlyQuery = async statements => Promise.all(statements.map(async s => /\bFROM fact\b/.test(s.text) ? []
    : (await pg.query<Record<string, unknown>>(s.text, [...s.params])).rows));
  const promote = async (recordClass: string, scope: string, version: string, payload: unknown, at: string) => {
    await pg.query(`INSERT INTO civic_data_promotions VALUES ($1,$2,$3,$4,$5) ON CONFLICT (record_class, scope) DO UPDATE
      SET current_version_id=excluded.current_version_id, payload=excluded.payload, promoted_at=excluded.promoted_at`, [recordClass, scope, version, JSON.stringify(payload), at]);
    const held = new Map((await pg.query<{ id: string; digest: string }>(HELD_PLACE_ROWS_SQL, [recordClass, scope])).rows.map(row => [row.id, row.digest]));
    for (const s of placeRowStatements({ recordClass, scope, versionId: version, set: placeRowsOf(recordClass, scope, payload), held, changedAt: at })) {
      await pg.query(s.text, [...s.params]);
    }
  };
  return { pg, query, promote };
}

const registry = (bodyName: string) => ({
  registry: {
    divisions: [{ ocdId: PIMA, name: "Pima" }, { ocdId: COCHISE, name: "Cochise" }, { ocdId: TUCSON, name: "Tucson" }],
    bodies: [{ id: `${PIMA}#board`, ocdId: PIMA, name: bodyName }, { id: `${COCHISE}#board`, ocdId: COCHISE, name: "Cochise board" },
      { id: `${TUCSON}#council`, ocdId: TUCSON, alsoServesOcdIds: [PIMA], name: "Tucson council" }],
    jurisdictions: ["never read by a place"],
  },
  statewideExecutives: [{ stateOcdId: AZ, office: "Governor" }],
  officialCandidacies: { rows: [{ holder: { divisions: [COCHISE] }, candidacy: { candidacyId: "c1" } }] },
});

test("a place reads only its own rows of a promoted payload, as the payload's own slice", async () => {
  const { query, promote } = await db();
  await promote("REGISTRY_RUNTIME_BINDING", "registry", "v1", registry("Pima board"), "2026-10-01T00:00:00.000Z");
  const [other] = await readPlacePointerSlices("MEETING_OUTCOME", ["registry"], [PIMA], [], [], query);
  assert.equal(other!.kind, "NOT_RECORDED", "another record class's pointer is not this one");
  const [read] = await readPlacePointerSlices<ReturnType<typeof registry>>("REGISTRY_RUNTIME_BINDING", ["registry"], [PIMA], [], [], query);
  assert.deepEqual(read!.value, {
    registry: { divisions: [{ ocdId: PIMA, name: "Pima" }],
      bodies: [{ id: `${PIMA}#board`, ocdId: PIMA, name: "Pima board" }, { id: `${TUCSON}#council`, ocdId: TUCSON, alsoServesOcdIds: [PIMA], name: "Tucson council" }] },
    statewideExecutives: [], officialCandidacies: { rows: [] }, bodyRosters: [], rosterReaderDispositions: [],
  }, "the bodies serving the place come in order; national collections nobody slices never cross");
});

test("a held read refuses a pointer whose rows are not at its version, and the backfill finds it", async () => {
  const { pg, query, promote } = await db();
  await pg.query("INSERT INTO civic_data_promotions VALUES ('MEETING','pima-meetings','m1','{\"meetings\":[]}', now())");
  await assert.rejects(readPlacePointerSlices("MEETING", ["pima-meetings"], [PIMA], [], [], query), /HELD_PLACE_ROWS_NOT_BUILT:MEETING:pima-meetings:m1/);
  assert.deepEqual((await pg.query<{ scope: string }>(UNBUILT_PLACE_ROWS_SQL, [JSON.stringify(["MEETING"])])).rows.map(row => row.scope), ["pima-meetings"]);
  await promote("MEETING", "pima-meetings", "m1", { meetings: [] }, "2026-10-01T00:00:00.000Z");
  await pg.query("UPDATE civic_data_promotions SET current_version_id='m2' WHERE scope='pima-meetings'");
  await assert.rejects(readPlacePointerSlices("MEETING", ["pima-meetings"], [PIMA], [], [], query), /HELD_PLACE_ROWS_NOT_BUILT/, "rows of an older version are not served");
});

test("ballots, the national ballot's states, candidacies by contest and meetings by body reach the place that holds them", async () => {
  const { query, promote } = await db();
  const contest = (id: string, ocdId: string) => ({ id, ocdId, title: id, type: "CANDIDACY" });
  await promote("BALLOT_CANDIDACY", "US:state-election-ballots", "b1", { kind: "ballot-contests", ballots: {
    "AZ:general": { election: { id: "general", state: "AZ" }, contests: [contest("az-house-1", `${AZ}/cd:1`), contest("pima-sheriff", PIMA)],
      candidacies: [{ id: "c-house", contestId: "az-house-1" }, { id: "c-sheriff", contestId: "pima-sheriff" }, { id: "c-sheriff-2", contestId: "pima-sheriff" }], measures: [] },
    "NH:general": { election: { id: "general", state: "NH" }, contests: [contest("nh-gov", "ocd-division/country:us/state:nh")], candidacies: [], measures: [] },
  } }, "2026-10-01T00:00:00.000Z");
  const [ballot] = await readPlacePointerSlices<{ ballots: Record<string, { contests: { id: string }[]; candidacies: { id: string }[] }> }>(
    "BALLOT_CANDIDACY", ["US:state-election-ballots"], [PIMA], [], [], query);
  assert.deepEqual(ballot!.value!.ballots["AZ:general"]!.contests.map(c => c.id), ["pima-sheriff"]);
  assert.deepEqual(ballot!.value!.ballots["AZ:general"]!.candidacies.map(c => c.id), ["c-sheriff", "c-sheriff-2"], "in the ballot's own order");
  assert.deepEqual(ballot!.value!.ballots["NH:general"]!.contests, [], "another state's ballot keeps its election and holds no contest here");
  await promote("MEETING", "pima", "m1", { meetings: [{ id: "a", bodyId: `${PIMA}#board` }, { id: "b", ocdId: COCHISE }] }, "2026-10-01T00:00:00.000Z");
  const [meetings] = await readPlacePointerSlices<{ meetings: { id: string }[] }>("MEETING", ["pima"], [], [`${PIMA}#board`], [], query);
  assert.deepEqual(meetings!.value!.meetings.map(m => m.id), ["a"]);
});

test("a new version rewrites only the rows that changed and marks only the divisions they touch", async () => {
  const { pg, query, promote } = await db();
  await promote("REGISTRY_RUNTIME_BINDING", "registry", "v1", registry("Pima board"), "2026-10-01T00:00:00.000Z");
  const before = (await pg.query("SELECT 1 FROM civic_data_place_rows WHERE collection<>''")).rows.length;
  await promote("REGISTRY_RUNTIME_BINDING", "registry", "v2", registry("Pima Board of Supervisors"), "2026-10-02T00:00:00.000Z");
  const after = (await pg.query<{ version_id: string }>("SELECT version_id FROM civic_data_place_rows WHERE collection<>''")).rows;
  assert.equal(after.filter(row => row.version_id === "v2").length, 1, "only the renamed board's row is written again");
  assert.equal(after.length, before);
  const changed = (await pg.query<{ division_id: string; changed_at: Date }>("SELECT division_id, changed_at FROM civic_data_place_changes ORDER BY division_id")).rows
    .filter(row => row.changed_at.toISOString() === "2026-10-02T00:00:00.000Z").map(row => row.division_id);
  assert.deepEqual(changed, [PIMA]);
  const [read] = await readPlacePointerSlices<ReturnType<typeof registry>>("REGISTRY_RUNTIME_BINDING", ["registry"], [PIMA], [], [], query);
  assert.equal(read!.metadata.versionId, "v2");
  assert.equal(read!.value!.registry.bodies[0]!.name, "Pima Board of Supervisors");
  const smaller = registry("Pima Board of Supervisors");
  smaller.registry.bodies = smaller.registry.bodies.filter(body => !body.id.startsWith(COCHISE));
  await promote("REGISTRY_RUNTIME_BINDING", "registry", "v3", smaller, "2026-10-03T00:00:00.000Z");
  const [cochise] = await readPlacePointerSlices<ReturnType<typeof registry>>("REGISTRY_RUNTIME_BINDING", ["registry"], [COCHISE], [], [], query);
  assert.deepEqual(cochise!.value!.registry.bodies, [], "a body the new version no longer has is gone");
});

test("a candidate's profile and links reach a place only under that candidate's exact key", async () => {
  const { query, promote } = await db();
  const key = "ballot-az-pima:supervisor|Candidate One", other = "ballot-az-pima:supervisor|Candidate Two";
  const links = { campaign: { url: "https://candidate-one.example/", verification: "Verified candidate." }, official: null };
  await promote("CANDIDATE_PROFILE", "profiles", "p1", { cards: { cards: { [key]: { bio: "One" }, [other]: { bio: "Two" } } },
    links: { links: { [key]: links, [other]: { campaign: { url: "https://outside.example/" }, official: null } } } }, "2026-10-01T00:00:00.000Z");
  const [read] = await readPlacePointerSlices<{ cards: { cards: Record<string, unknown> }; links: { links: Record<string, unknown> } }>(
    "CANDIDATE_PROFILE", ["profiles"], [PIMA], [], [key], query);
  assert.deepEqual(read!.value, { cards: { cards: { [key]: { bio: "One" } } }, links: { links: { [key]: links } } });
});
