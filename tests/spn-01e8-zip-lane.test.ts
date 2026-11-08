import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { stateRegistryRuntimeScope } from "../lib/civic-data/state-scopes.ts";
import { countNeonBytes } from "../lib/db/transfer-by-caller.ts";
import { LocalFileArtifactStore } from "../lib/meetings/edge-store.ts";
import { closeZipLane, owedMs, runZipAnswersLane, statePrint, ZIP_ANSWER_BYTES_PER_HOUR, zipAnswersTurn, type ZipBuilders } from "../lib/reader/zip-lane.ts";
import { readZipAnswer, zipAnswerKey } from "../lib/reader/zip-answer.ts";
import { migratedFactDb } from "./helpers/migrated-reader-db.ts";

const AZ = "ocd-division/country:us/state:az", NJ = "ocd-division/country:us/state:nj";
const P1 = `${AZ}/place:p1`, P2 = `${AZ}/place:p2`, N1 = `${NJ}/place:n1`, BODY = "az:city:p1#governing";
const T0 = Date.parse("2026-11-01T12:00:00.000Z"), MINUTE = 60_000;
const at = (hours: number) => new Date(T0 + hours * 3_600_000).toISOString();
/** AZ ZIPs 85001-85010 lie over P1 (85002 also over P2), and 07001 over New Jersey's N1; Arizona is the busier state. */
const AZ_ZIPS = Array.from({ length: 10 }, (_, index) => `850${String(index + 1).padStart(2, "0")}`);

async function open() {
  const db = await migratedFactDb();
  const entity = (id: string, kind: string, state: string, priority = 0) => db.query("INSERT INTO entity(id,kind,name,state,page_priority) VALUES($1,$2,$1,$3,$4)", [id, kind, state, priority]);
  for (const [id, state] of [[AZ, "AZ"], [P1, "AZ"], [P2, "AZ"], [NJ, "NJ"], [N1, "NJ"]]) await entity(id, "place", state);
  await entity(BODY, "body", "AZ");
  await db.query("INSERT INTO entity_place(entity_id,place_id,boundary_year) VALUES($1,$2,2023)", [BODY, P1]);
  for (const [index, zip] of [...AZ_ZIPS, "07001"].entries()) {
    await entity(`zip:${zip}`, "place", zip === "07001" ? "NJ" : "AZ", zip === "07001" ? 5 : 10 - index);
    await db.query("INSERT INTO zip_place(zip,place_id,share,boundary_year) VALUES($1,$2,1,2023)", [zip, zip === "07001" ? N1 : P1]);
  }
  await db.query("INSERT INTO zip_place(zip,place_id,share,boundary_year) VALUES('85002',$1,0.5,2023)", [P2]);
  const page = (id: string, hours: number) => db.query(`INSERT INTO place_page(place_id,version,built_at,body) VALUES($1,1,$2,'{}')
    ON CONFLICT(place_id) DO UPDATE SET version=place_page.version+1,built_at=excluded.built_at`, [id, at(hours)]);

  const events: string[] = [], versions = new Map<string, number>(), calls = { meetings: [] as string[], location: [] as string[], stateBody: [] as string[], opened: [] as string[], closed: [] as string[] };
  const store = new LocalFileArtifactStore(mkdtempSync(join(tmpdir(), "zip-lane-")));
  const writeBytes = store.writeBytes.bind(store);
  store.writeBytes = async (key, bytes) => { events.push(`write ${key}`); await writeBytes(key, bytes); };
  const purge = async (tags: readonly string[]) => {
    // Every file named by a ZIP's tag is already in the store when the purge goes out.
    for (const tag of tags) if (tag.startsWith("reader-zip:")) assert.ok(await store.readBytes(zipAnswerKey(tag.slice("reader-zip:".length))), `${tag} is written before it is cleared`);
    events.push(`purge ${[...tags].sort().join(",")}`);
    return { purged: true };
  };
  const stateOf = (zip: string) => zip === "07001" ? "NJ" : "AZ";
  const build: ZipBuilders = {
    meetings: async zip => { calls.meetings.push(zip); return { place: { ids: [], partial: [], samples: 0, states: [stateOf(zip)] }, point: { zip, lat: 33, lng: -112 }, territoryBodyIds: [],
      pageIds: [], package: { registry: null, everydayRouting: null, marker: versions.get(`m:${zip}`) ?? 0 } as never }; },
    location: async zip => { calls.location.push(zip); return { zip }; },
    stateBody: async (state, zip, _entry, copy) => { assert.equal(copy.state, state, "a ZIP's state is read from that state's copy"); calls.stateBody.push(zip);
      return { version: `s${versions.get(`s:${state}`) ?? 0}`, body: { state, zip, version: versions.get(`s:${state}`) ?? 0 } }; },
    routing: async () => (versions.get("national") ? { marker: versions.get("national") } as never : null),
    openMirror: async state => { calls.opened.push(state); return { state, seam: { reader: async () => [], facts: async () => [] }, close: async () => { calls.closed.push(state); } }; },
  };
  const deps = { facts: db.query, store, build, purge };
  const turn = (minutes = 0) => zipAnswersTurn({ ...deps, now: () => T0 + minutes * MINUTE });
  /** Looks until the lane has nothing left to do at that time. */
  const settle = async (minutes: number) => { let looks = 0; while ((await turn(minutes)).kind !== "idle") if (++looks > 100) throw new Error("the lane does not settle"); };
  const forget = () => { for (const list of Object.values(calls)) list.length = 0; events.length = 0; };
  return { db, page, store, events, versions, calls, turn, settle, forget, deps };
}
const fresh = () => closeZipLane(true);

test("states are read most populated first, each from one copy, and a ZIP with no answer yet gets all of it", async () => {
  await fresh();
  const { db, calls, settle, store } = await open();
  try {
    await settle(0);
    assert.deepEqual(calls.opened, ["AZ", "NJ"], "one copy per state, Arizona first");
    assert.deepEqual(calls.closed, ["AZ", "NJ"], "each dropped when its state is done");
    assert.deepEqual([...calls.stateBody].sort(), [...AZ_ZIPS, "07001"].sort(), "every ZIP read once, from its state's copy");
    const held = (await readZipAnswer("85001", store))!;
    assert.deepEqual([held.zip, held.location, Object.keys(held.states)], ["85001", { zip: "85001" }, ["AZ"]]);
    assert.equal((await readZipAnswer("07001", store))!.states.NJ.version, "s0");
  } finally { await db.pg.close(); await fresh(); }
});

test("when nothing moved, nothing is copied, read or written", async () => {
  await fresh();
  const { db, calls, settle, events, forget } = await open();
  try {
    await settle(0); forget();
    await settle(30);
    assert.deepEqual([calls.opened, calls.meetings, calls.stateBody, events], [[], [], [], []]);
  } finally { await db.pg.close(); await fresh(); }
});

test("a change to a state's inputs reads that state again from one copy, keeps the rest of each answer, and writes only the answers that differ", async () => {
  await fresh();
  const { db, calls, settle, events, forget, versions, store } = await open();
  try {
    await settle(0); forget();
    const before = await statePrint(db.query, "AZ");
    await db.publish({ id: "az-registry", recordClass: "REGISTRY_RUNTIME_BINDING", scope: stateRegistryRuntimeScope("AZ"), sourceId: "registry", at: at(1), value: {} });
    assert.notEqual(await statePrint(db.query, "AZ"), before, "the state's inputs have a new version");
    assert.equal(await statePrint(db.query, "NJ"), await statePrint(db.query, "NJ"));
    // The published entries changed but the answers composed from them did not: no file is written and nothing is cleared.
    await settle(30);
    assert.deepEqual(calls.opened, ["AZ"], "Arizona only");
    assert.equal(calls.meetings.length, 0, "the saved pages are not read again for a state change");
    assert.equal(calls.location.length, 0);
    assert.equal(events.length, 0, "the same answers are not written again");
    forget();
    // Now they do differ.
    await db.publish({ id: "az-registry-2", recordClass: "REGISTRY_RUNTIME_BINDING", scope: stateRegistryRuntimeScope("AZ"), sourceId: "registry", at: at(2), value: { more: true } });
    versions.set("s:AZ", 1);
    await settle(60);
    assert.equal(events.filter(event => event.startsWith("write ")).length, AZ_ZIPS.length, "each Arizona ZIP's file once");
    assert.deepEqual((await readZipAnswer("85003", store))!.states.AZ.body, { state: "AZ", zip: "85003", version: 1 });
    assert.equal(calls.meetings.length, 0);
    const purged = events.filter(event => event.startsWith("purge")).join(",").split(/[ ,]/).filter(tag => tag.startsWith("reader-zip:")).sort();
    assert.deepEqual(purged, AZ_ZIPS.map(zip => `reader-zip:${zip}`), "and exactly their tags, after the writes");
    assert.ok(events.findIndex(event => event.startsWith("purge")) > events.map(event => event.startsWith("write")).lastIndexOf(true) - 1);
  } finally { await db.pg.close(); await fresh(); }
});

test("a saved page republishes only the meetings part of the ZIPs laid over it, and a state's own page every ZIP of the state", async () => {
  await fresh();
  const { db, page, calls, settle, events, forget, versions, store } = await open();
  try {
    await settle(0); forget();
    await page(P2, 1); versions.set("m:85002", 1);
    await settle(2);
    assert.deepEqual(calls.meetings, ["85002"], "the one ZIP laid over P2");
    assert.deepEqual([calls.stateBody, calls.location, calls.opened], [[], [], []], "its state answer and location are the ones published, read from the store");
    assert.deepEqual(events, [`write ${zipAnswerKey("85002")}`, "purge reader-zip:85002"], "its file, then its tag");
    assert.deepEqual(Object.keys((await readZipAnswer("85002", store))!.states), ["AZ"]);
    forget();
    await page(BODY, 3); await page(P1, 3);
    await settle(4);
    assert.deepEqual([...new Set(calls.meetings)].sort(), [...AZ_ZIPS].sort(), "a board's page reaches the ZIPs over its place");
    forget();
    await page(AZ, 5);
    await settle(6);
    assert.deepEqual([...new Set(calls.meetings)].sort(), [...AZ_ZIPS].sort(), "Arizona's own page reaches every ZIP in Arizona and none in New Jersey");
    assert.deepEqual([calls.stateBody, calls.opened], [[], []]);
    assert.equal(events.length, 0, "the same answers are not written or cleared again");
  } finally { await db.pg.close(); await fresh(); }
});

test("a change to the national record writes one file and clears one tag, whatever the number of ZIPs", async () => {
  await fresh();
  const { db, calls, settle, events, forget, versions, store } = await open();
  try {
    await settle(0); forget();
    versions.set("national", 1);
    await settle(5);
    assert.equal(events.filter(event => event.startsWith("write ")).length, 1, "the record itself; the pointer is a pointer file, and no ZIP's");
    assert.deepEqual(events.filter(event => event.startsWith("purge")), ["purge reader-national"]);
    assert.deepEqual([calls.meetings, calls.stateBody], [[], []]);
    assert.deepEqual((await readZipAnswer("85001", store))!.package.everydayRouting, { marker: 1 });
  } finally { await db.pg.close(); await fresh(); }
});

test("the cap holds: a look that moved its allowance leaves the lane resting until the time it owes has passed", async () => {
  await fresh();
  const { db, deps, calls } = await open();
  try {
    let now = T0 + 5 * 3_600_000, stop = 0;
    const total = { considered: 0, written: 0 };
    // Each ZIP read moves a tenth of the hour's allowance, as the database meter counts it.
    const metered = { ...deps, build: { ...deps.build, meetings: async (zip: string) => { countNeonBytes("reader", ZIP_ANSWER_BYTES_PER_HOUR / 10, Date.now(), { requests: 1, bytes: 0 }); return deps.build.meetings(zip); } } };
    const look = async (advance = 0) => {
      now += advance; stop = 0;
      await runZipAnswersLane({ deps: metered, stopRequested: () => stop++ >= 1, log: () => {}, clock: () => now, sleep: async () => {}, total });
    };
    await look();
    assert.equal(calls.stateBody.length, 10, "the first look reads Arizona's ten ZIPs");
    assert.ok(Number((await db.query("SELECT position FROM pass_cursor WHERE name='zips:tab'"))[0]!.position) > now, "the time owed is kept, so a lane that starts again owes it too");
    assert.ok(owedMs(ZIP_ANSWER_BYTES_PER_HOUR / 1.05) === 3_600_000 && owedMs(0) === 0);
    await look(60_000);
    assert.equal(calls.stateBody.length, 10, "while the time owed has not run out, nothing is read");
    await look(3_600_000 * 2);
    assert.equal(calls.stateBody.length, 11, "once it has, New Jersey's is");
  } finally { await db.pg.close(); await fresh(); }
});

test("a ZIP that could not be read keeps its last answer and the others go on, and a purge the CDN refused is tried again", async () => {
  await fresh();
  const { db, deps, store } = await open();
  try {
    const lines: string[] = [], sent: string[][] = [];
    let accept = false;
    const purge = async (tags: readonly string[]) => { sent.push([...tags].sort()); return accept ? { purged: true } : { purged: false, detail: "purge HTTP 500" }; };
    const flaky = { ...deps, purge, build: { ...deps.build, stateBody: async (...args: Parameters<ZipBuilders["stateBody"]>) => { if (args[1] === "85003") throw new Error("the copy hiccupped"); return deps.build.stateBody(...args); } } };
    await zipAnswersTurn({ ...flaky, log: line => lines.push(line) });
    assert.equal(await readZipAnswer("85003", store), null);
    assert.ok(await readZipAnswer("85004", store));
    assert.ok(lines.some(line => line.includes("85003") && line.includes("keeps its last answer")));
    assert.ok(lines.some(line => line.includes("not cleared")));
    accept = true;
    await zipAnswersTurn({ ...deps, purge });
    assert.ok(sent.length >= 2 && sent[1].includes("reader-zip:85004"), "the tags owed from the refused purge go out with the next look's");
  } finally { await db.pg.close(); await fresh(); }
});
