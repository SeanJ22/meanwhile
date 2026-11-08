import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { stateRegistryRuntimeScope } from "../lib/civic-data/state-scopes.ts";
import { countNeonBytes } from "../lib/db/transfer-by-caller.ts";
import { LocalFileArtifactStore } from "../lib/meetings/edge-store.ts";
import { owedMs, resetZipLaneMemory, runZipAnswersLane, ZIP_ANSWER_BYTES_PER_HOUR, zipAnswersTurn } from "../lib/reader/zip-lane.ts";
import { packZipAnswer, readZipAnswer, zipAnswerKey, type ZipAnswer } from "../lib/reader/zip-answer.ts";
import { migratedFactDb } from "./helpers/migrated-reader-db.ts";

const AZ = "ocd-division/country:us/state:az", NJ = "ocd-division/country:us/state:nj";
const P1 = `${AZ}/place:p1`, P2 = `${AZ}/place:p2`, N1 = `${NJ}/place:n1`, BODY = "az:city:p1#governing";
const T0 = Date.parse("2026-11-01T12:00:00.000Z");
const at = (hours: number) => new Date(T0 + hours * 3_600_000).toISOString();
/** AZ ZIPs 85001-85010 (priority 10..1) lie over P1, and 85002 also over P2; 07001 lies over New Jersey's N1. */
const AZ_ZIPS = Array.from({ length: 10 }, (_, index) => `850${String(index + 1).padStart(2, "0")}`);

async function open() {
  const db = await migratedFactDb();
  await db.pg.exec("CREATE TABLE IF NOT EXISTS pass_cursor(name text PRIMARY KEY, position text NOT NULL)").catch(() => undefined);
  const entity = (id: string, kind: string, state: string, priority = 0) => db.query("INSERT INTO entity(id,kind,name,state,page_priority) VALUES($1,$2,$1,$3,$4)", [id, kind, state, priority]);
  for (const [id, state] of [[AZ, "AZ"], [P1, "AZ"], [P2, "AZ"], [NJ, "NJ"], [N1, "NJ"]]) await entity(id, "place", state);
  await entity(BODY, "body", "AZ");
  await db.query("INSERT INTO entity_place(entity_id,place_id,boundary_year) VALUES($1,$2,2023)", [BODY, P1]);
  for (const [index, zip] of [...AZ_ZIPS, "07001"].entries()) {
    await entity(`zip:${zip}`, "place", zip === "07001" ? "NJ" : "AZ", zip === "07001" ? 0 : 10 - index);
    await db.query("INSERT INTO zip_place(zip,place_id,share,boundary_year) VALUES($1,$2,1,2023)", [zip, zip === "07001" ? N1 : P1]);
  }
  await db.query("INSERT INTO zip_place(zip,place_id,share,boundary_year) VALUES('85002',$1,0.5,2023)", [P2]);
  const page = (id: string, hours: number) => db.query(`INSERT INTO place_page(place_id,version,built_at,body) VALUES($1,1,$2,'{}')
    ON CONFLICT(place_id) DO UPDATE SET version=place_page.version+1,built_at=excluded.built_at`, [id, at(hours)]);

  const events: string[] = [], versions = new Map<string, number>(), built: string[] = [];
  const store = new LocalFileArtifactStore(mkdtempSync(join(tmpdir(), "zip-lane-")));
  const writeBytes = store.writeBytes.bind(store);
  store.writeBytes = async (key, bytes) => { events.push(`write ${key}`); await writeBytes(key, bytes); };
  const purge = async (tags: readonly string[]) => {
    // Every file named by a tag is already in the store, with the print the index holds, when the purge goes out.
    for (const tag of tags) assert.ok(await store.readBytes(zipAnswerKey(tag.slice("reader-zip:".length))), `${tag} is written before it is cleared`);
    events.push(`purge ${[...tags].sort().join(",")}`);
    return { purged: true };
  };
  /** A small answer whose content moves only when its ZIP's version does. */
  const build = async (zip: string): Promise<ZipAnswer | null> => {
    built.push(zip);
    return { zip, location: { zip, version: versions.get(zip) ?? 0 }, states: {}, place: { ids: [], partial: [], samples: 0, states: [zip === "07001" ? "NJ" : "AZ"] },
      point: { zip, lat: 33, lng: -112 }, territoryBodyIds: [], pageIds: [], package: { registry: null } as never };
  };
  const deps = { facts: db.query, store, build, purge, now: () => T0 };
  const turn = (hours = 0) => zipAnswersTurn({ ...deps, now: () => T0 + hours * 3_600_000 });
  const forget = () => { built.length = 0; events.length = 0; };
  /** Looks until the changes are all read. */
  const drain = async (hours: number) => { while ((await turn(hours)).kind === "changes"); };
  return { db, page, store, events, versions, built, turn, drain, forget, deps };
}

test("ZIPs never published are filed busiest first, and a ZIP is not read again once filed", async () => {
  resetZipLaneMemory();
  const { db, built, turn, store, events } = await open();
  try {
    assert.deepEqual(await turn(), { considered: 8, written: 8, kind: "first" });
    assert.deepEqual([...built].sort(), AZ_ZIPS.slice(0, 8), "the eight busiest ZIPs go first");
    assert.deepEqual(await turn(), { considered: 2, written: 2, kind: "first" });
    assert.deepEqual([...built].sort(), AZ_ZIPS, "then the rest");
    const held = await readZipAnswer("85001", store);
    assert.equal(held?.zip, "85001");
    assert.equal(events.filter(event => event.startsWith("purge")).length, 2, "one purge after each look's writes");
    assert.equal((await turn()).kind, "check", "with every busy ZIP filed, the daily check begins");
  } finally { await db.pg.close(); }
});

test("a saved place page republishes exactly the ZIPs laid over it, and a state's own page every ZIP of the state", async () => {
  resetZipLaneMemory();
  const { db, page, built, turn, drain, versions, forget, events } = await open();
  try {
    await turn(); await turn(); forget();
    assert.equal((await turn()).kind, "check");
    forget();
    // Looks begin from the moment the lane first looked, so only pages saved after it count.
    await page(P2, 1); versions.set("85002", 1);
    assert.deepEqual(await turn(2), { considered: 1, written: 1, kind: "changes" });
    assert.deepEqual(built, ["85002"], "the one ZIP laid over P2");
    assert.deepEqual(events, [`write ${zipAnswerKey("85002")}`, "purge reader-zip:85002"], "its file, then its tag");
    forget();
    await page(BODY, 3); await page(P1, 3);
    await drain(4);
    assert.deepEqual([...new Set(built)].sort(), [...AZ_ZIPS].sort(), "a board's page reaches the ZIPs over its place, and P1's own page the same ZIPs");
    forget();
    await page(AZ, 5);
    await drain(6);
    assert.deepEqual([...new Set(built)].sort(), [...AZ_ZIPS].sort(), "Arizona's own page reaches every ZIP in Arizona and no ZIP in New Jersey");
    assert.ok(!built.includes("07001"));
  } finally { await db.pg.close(); }
});

test("a ZIP read again with the same print writes nothing and purges nothing", async () => {
  resetZipLaneMemory();
  const { db, page, built, turn, forget, events } = await open();
  try {
    await turn(); await turn(); forget();
    await turn();
    forget();
    await page(P1, 1);
    const first = await turn(2);
    assert.equal(first.kind, "changes");
    assert.equal(first.considered, 8);
    assert.equal(first.written, 0, "every answer is the one already published");
    const second = await turn(2);
    assert.deepEqual([second.considered, second.written], [2, 0]);
    assert.equal(built.length, 10);
    assert.deepEqual(events, [], "no file written and no cache cleared");
  } finally { await db.pg.close(); }
});

test("a publication reaches the ZIPs of its own state only, and a meeting calendar reaches none (its pages do)", async () => {
  resetZipLaneMemory();
  const { db, built, turn, drain, forget } = await open();
  try {
    await turn(); await turn(); forget();
    await turn();
    forget();
    await db.publish({ id: "cv-m", recordClass: "MEETING", scope: "source:legistar:body:az%3Acity", sourceId: "legistar", at: at(1), value: {} });
    assert.notEqual((await turn(2)).kind, "changes", "a calendar reaches readers through its place pages");
    await db.publish({ id: "cv-r", recordClass: "REGISTRY_RUNTIME_BINDING", scope: stateRegistryRuntimeScope("AZ"), sourceId: "registry", at: at(3), value: {} });
    forget();
    assert.equal((await turn(4)).kind, "changes");
    await drain(4);
    assert.ok(built.every(zip => zip.startsWith("850")), "no ZIP outside Arizona");
    assert.deepEqual([...new Set(built)].sort(), [...AZ_ZIPS].sort(), "every ZIP of the state");
  } finally { await db.pg.close(); }
});

test("the cap holds: a look that moved its allowance leaves the lane resting until the time it owes has passed", async () => {
  resetZipLaneMemory();
  const { db, deps, built } = await open();
  try {
    let now = T0 + 5 * 3_600_000, stop = 0;
    const total = { considered: 0, written: 0 };
    // Each ZIP read moves a tenth of the hour's allowance, as the database meter counts it.
    const metered = { ...deps, build: async (zip: string) => { countNeonBytes("reader", ZIP_ANSWER_BYTES_PER_HOUR / 10, Date.now(), { requests: 1, bytes: 0 }); return deps.build(zip); } };
    const look = async (advance = 0) => {
      now += advance; stop = 0;
      await runZipAnswersLane({ deps: metered, stopRequested: () => stop++ >= 1, log: () => {}, clock: () => now, sleep: async () => {}, total });
    };
    await look();
    assert.equal(built.length, 8, "the first look reads its eight ZIPs");
    assert.ok(Number((await db.query("SELECT position FROM pass_cursor WHERE name='zips:tab'"))[0]!.position) > now, "the time owed is kept, so a lane that starts again owes it too");
    assert.ok(owedMs(ZIP_ANSWER_BYTES_PER_HOUR / 1.05) === 3_600_000 && owedMs(0) === 0);
    await look(60_000);
    assert.equal(built.length, 8, "while the time owed has not run out, nothing is read");
    await look(3_600_000);
    assert.equal(built.length, 10, "once it has, the rest are");
  } finally { await db.pg.close(); }
});

test("a ZIP that could not be read keeps its last answer and the others go on", async () => {
  resetZipLaneMemory();
  const { db, deps, store } = await open();
  try {
    const lines: string[] = [];
    await zipAnswersTurn({ ...deps, log: line => lines.push(line), build: async zip => { if (zip === "85003") throw new Error("the store hiccupped"); return deps.build(zip); } });
    assert.equal(await readZipAnswer("85003", store), null);
    assert.ok(await readZipAnswer("85004", store));
    assert.ok(lines.some(line => line.includes("85003") && line.includes("keeps its last answer")));
    assert.equal(packZipAnswer((await deps.build("85004"))!).print, (await readZipAnswer("85004", store))!.print);
  } finally { await db.pg.close(); }
});

test("a purge the CDN refused is tried again at the next look, with the tags still owed", async () => {
  resetZipLaneMemory();
  const { db, deps } = await open();
  try {
    const sent: string[][] = [];
    let accept = false;
    const purge = async (tags: readonly string[]) => { sent.push([...tags].sort()); return accept ? { purged: true } : { purged: false, detail: "purge HTTP 500" }; };
    await zipAnswersTurn({ ...deps, purge });
    accept = true;
    await zipAnswersTurn({ ...deps, purge });
    assert.equal(sent.length, 2);
    assert.deepEqual(sent[1], [...sent[0], "reader-zip:85009", "reader-zip:85010"].sort(), "the eight owed, and the two just written");
    await zipAnswersTurn({ ...deps, purge });
    assert.deepEqual(sent.slice(2), [["reader-zip:07001"]], "nothing is owed once it went through; the only tag is the one ZIP the daily check filed for the first time");
  } finally { await db.pg.close(); }
});
