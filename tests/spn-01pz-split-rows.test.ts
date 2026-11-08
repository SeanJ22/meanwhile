import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { writePassCursor } from "../lib/facts/db.ts";
import { LocalFileArtifactStore, type ReaderArtifactStore } from "../lib/meetings/edge-store.ts";
import { splitPlace, withMore, type PlaceAgendas, type PlaceFile, type PlaceHistory } from "../lib/reader/place-file.ts";
import { indexPointerKey, openPlaceFiles, putFile, type NationalFile } from "../lib/reader/place-files.ts";
import { closePlaceFilesLane, placeFilesTurn } from "../lib/reader/place-files-lane.ts";
import { buildMapIndex, buildZipRows, type IndexPointer, type ZipPlaces } from "../lib/reader/place-index.ts";
import { packPlaceContext } from "../lib/reader/place-ready.ts";
import { stateDivisionId } from "../lib/reader/state-share.ts";
import { READER_ZIP3_TAG, zip3Key, type Zip3File, type ZipRow } from "../lib/reader/zip3.ts";
import { migratedFactDb } from "./helpers/migrated-reader-db.ts";

const STATE = stateDivisionId("AZ"), A = `${STATE}/county:pima`;
const page = (name: string) => ({ entities: [], fields: [{ entity_id: "e", field: "name", value: name, url: "https://example.gov/", quote: name, checked_at: "2026-10-01T00:00:00Z" }],
  rosters: [], comments: [], sittings: [], meeting_rows: [], archived_documents: [], archived_document_links: [], agenda_texts: [], registry: null, governments: [], divisions: [], registration_held: false, division_ids: [] });

/** A state published the way the lane publishes it: the map index, the pointer and the rows of its prefixes. */
async function publish(store: ReaderArtifactStore, files: Map<string, string>, zips: Record<string, ZipPlaces>, national: string, now = new Date("2026-10-03T16:00:00Z")) {
  const rows = buildZipRows("AZ", files, zips, national, "", () => ({ key: "", districts: [] }), now);
  for (const [prefix, found] of Object.entries(rows)) await store.writeJsonPointer(zip3Key(prefix), { v: 1, zips: found }, null);
  const { map, boards } = buildMapIndex("AZ", files, new Map());
  const pointer: IndexPointer = { map: (await putFile(store, map)).name, boards: (await putFile(store, boards)).name, national, prefixes: Object.keys(rows) };
  assert.equal((await store.writeJsonPointer<IndexPointer>(indexPointerKey("AZ"), pointer, null)).modified, true);
}
const rowsOf = async (store: ReaderArtifactStore, prefix: string): Promise<Record<string, ZipRow>> => (await store.readJsonPointer<Zip3File>(zip3Key(prefix)))?.value.zips ?? {};

test("SPN-01PZ: a place's file holds the brief page, and its history and agenda are files of their own that a read opens only when it asks", async () => {
  const root = mkdtempSync(join(tmpdir(), "pz-split-")), store = new LocalFileArtifactStore(root);
  try {
    const agenda = { agenda_texts: [{ id: "t" }], archived_documents: [], archived_document_links: [], meetingAgenda: [] as never[] };
    const whole: PlaceFile = { v: 1, id: A, kind: "place", state: "AZ", version: 1, builtAt: 1, readAt: 1, variants: {
      current: { row: { which: "current" }, agenda, checks: { facts: [[0, "2026-10-01T00:00:00Z"]] } as never }, history: { row: { which: "history" }, agenda },
      emptyCurrent: { row: { which: "emptyCurrent" } }, emptyHistory: { row: { which: "emptyHistory" } } } };
    const { answer, extras } = splitPlace(whole);
    assert.deepEqual(Object.keys(answer.variants).sort(), ["current", "emptyCurrent"], "a ZIP's file holds the brief variants only");
    assert.equal(answer.variants.current!.agenda, undefined);
    assert.equal(extras.length, 2);
    assert.deepEqual(splitPlace(answer).answer, answer, "a file already split is split the same");
    for (const extra of extras) await putFile(store, extra);
    const filed = await putFile(store, answer), national = await putFile(store, { v: 1, president: null, routing: null } satisfies NationalFile);
    await publish(store, new Map([[A, filed.name]]), {}, national.name);
    const source = await openPlaceFiles(store).source("AZ");
    assert.deepEqual(await source.file(A), answer, "a read that asks for nothing more reads the one file");
    assert.deepEqual((await source.file(A, { history: true, agenda: false }))!.variants.history, whole.variants.history);
    assert.equal(((await source.file(A, { history: false, agenda: true }))!.variants.current!.agenda!.agenda_texts as unknown[]).length, 1);
    assert.equal((await source.file(A, { history: false, agenda: true }))!.variants.history, undefined);
    assert.deepEqual(withMore(answer, extras.find((extra): extra is PlaceHistory => "variants" in extra)!, extras.find((extra): extra is PlaceAgendas => "agenda" in extra)!), { ...whole, history: answer.history, agenda: answer.agenda });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("SPN-01PZ: the lane writes the rows of a ZIP from its state's keys, leaves the rows of other states in the prefix, and writes a prefix again only when its rows changed", async () => {
  const root = mkdtempSync(join(tmpdir(), "pz-rows-")), store = new LocalFileArtifactStore(root), db = await migratedFactDb();
  try {
    await db.query("INSERT INTO entity(id,kind,name,state) VALUES($1,'place','Pima','AZ')", [A]);
    await db.query("INSERT INTO place_page(place_id,version,built_at,context) VALUES($1,1,'2026-10-01T00:00:00Z',$2::jsonb)", [A, JSON.stringify(packPlaceContext({ formatVersion: 1, current: page("Pima") }))]);
    const { buildPlaceFile, PLACE_FILE_PAGE_SQL } = await import("../lib/reader/place-file-build.ts");
    const [pageRow] = await db.query(`${PLACE_FILE_PAGE_SQL} AND p.place_id=$1`, [A]);
    const file = await putFile(store, splitPlace({ ...await buildPlaceFile(db.query, pageRow!), readAt: Date.now() }).answer);
    const national = await putFile(store, { v: 1, president: null, routing: null } satisfies NationalFile);
    const zips = { "85701": { point: [32.2, -110.9] as const, states: ["AZ"], ids: [A], partial: [], fringe: [], districts: [], postal: { type: "STANDARD" } } };
    const elsewhere = { states: ["NM"], point: [-106.6, 35.1] as const, key: "nmnmnmnmnmnm", day: "2026-10-03", ids: [], partial: [], fringe: [], districts: [] };
    await publish(store, new Map([[A, file.name]]), zips, national.name);
    await store.writeJsonPointer(zip3Key("857"), { v: 1, zips: { ...await rowsOf(store, "857"), "85750": elsewhere } }, (await store.readJsonPointer(zip3Key("857")))!.etag);
    await writePassCursor(db.query, "place-files:pages", JSON.stringify({ at: "2026-10-02T00:00:00Z", id: "" }));
    const purges: string[][] = [], cleared = () => purges.flat();
    let now = Date.parse("2026-10-03T16:00:00Z");
    const deps = { facts: db.query, store, national: async () => ({ president: null, routing: null }), purge: async (tags: readonly string[]) => { purges.push([...tags]); return { purged: true }; }, now: () => now };
    closePlaceFilesLane();
    await placeFilesTurn(deps);
    const first = await rowsOf(store, "857");
    assert.equal(first["85701"]!.day, "2026-10-03", "a row names the Eastern day its answer shows");
    assert.deepEqual(first["85701"]!.point, [-110.9, 32.2]);
    assert.deepEqual(first["85701"]!.postal, { type: "STANDARD" }, "and the postal area the ZIP's lookup gave");
    assert.deepEqual(first["85750"], elsewhere, "the row of a ZIP that belongs to another state is left alone");
    const key = first["85701"]!.key;
    purges.length = 0;
    assert.equal((await placeFilesTurn(deps)).kind, "idle");
    assert.deepEqual(purges, [], "nothing changed: no prefix is written again");
    // The place's page changes: its file is new, so the ZIP's key is, and only its prefix is cleared.
    await db.query("UPDATE place_page SET context=$2::jsonb,version=version+1,built_at='2026-10-03T12:00:00Z' WHERE place_id=$1", [A, JSON.stringify(packPlaceContext({ formatVersion: 1, current: page("Pima County") }))]);
    closePlaceFilesLane();
    await placeFilesTurn(deps);
    const second = await rowsOf(store, "857");
    assert.notEqual(second["85701"]!.key, key);
    assert.deepEqual(second["85750"], elsewhere);
    assert.ok(cleared().includes(READER_ZIP3_TAG("857")));
    // The Eastern day turns: every key moves with it, and the prefix is written once.
    now = Date.parse("2026-10-04T16:00:00Z"); purges.length = 0;
    await placeFilesTurn(deps);
    const third = await rowsOf(store, "857");
    assert.deepEqual([third["85701"]!.day, third["85701"]!.key === second["85701"]!.key], ["2026-10-04", false]);
    assert.equal(cleared().filter(tag => tag === READER_ZIP3_TAG("857")).length, 1);
  } finally { closePlaceFilesLane(); await db.pg.close(); rmSync(root, { recursive: true, force: true }); }
});
