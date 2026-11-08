import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { brotliDecompressSync } from "node:zlib";
import { writePassCursor, installFactReader } from "../lib/facts/db.ts";
import { LocalFileArtifactStore, type ReaderArtifactStore } from "../lib/meetings/edge-store.ts";
import { contentHash, fileKey, loadPlaceFromFiles, type PlaceFile } from "../lib/reader/place-file.ts";
import { getFile, indexPointerKey, openPlaceFiles, putFile, READER_INDEX_TAG, type IndexPointer, type NationalFile } from "../lib/reader/place-files.ts";
import { closePlaceFilesLane, placeFilesTurn } from "../lib/reader/place-files-lane.ts";
import { servePlaceFile, servePlaceIndexPointer } from "../lib/reader/place-files-serve.ts";
import { buildPlaceIndex, type PlaceIndex } from "../lib/reader/place-index.ts";
import { packPlaceContext } from "../lib/reader/place-ready.ts";
import { composeState, cutState, stateDivisionId } from "../lib/reader/state-share.ts";
import { stateAnswerFromFiles, zipEntry } from "../lib/reader/zip-files.ts";
import type { ReaderStatePackage } from "../lib/reader/state.ts";
import { migratedFactDb } from "./helpers/migrated-reader-db.ts";

const STATE = stateDivisionId("AZ"), A = `${STATE}/county:pima`, B = `${STATE}/county:cochise`;
const page = (name: string, checked?: string) => ({ entities: [], fields: [{ entity_id: "e", field: "name", value: name, url: "https://example.gov/", quote: name, checked_at: checked ?? "2026-10-01T00:00:00Z" }],
  rosters: [], comments: [], sittings: [], meeting_rows: [], archived_documents: [], archived_document_links: [], agenda_texts: [], registry: null, governments: [], divisions: [], registration_held: false, division_ids: [] });

/** A store that remembers the order of its writes. */
function recording(root: string) {
  const inner = new LocalFileArtifactStore(root), log: string[] = [];
  const store: ReaderArtifactStore = {
    kind: inner.kind, readBytes: (key, options) => inner.readBytes(key, options), readJsonPointer: key => inner.readJsonPointer(key), putImmutable: (bytes, suffix) => inner.putImmutable(bytes, suffix),
    putIfAbsent: async (key, bytes) => { const written = await inner.putIfAbsent(key, bytes); if (written) log.push(`file:${key}`); return written; },
    writeJsonPointer: async (key, value, etag) => { const moved = await inner.writeJsonPointer(key, value, etag); if (moved.modified) log.push(`pointer:${key}`); return moved; },
  };
  return { store, log };
}

test("SPN-01PF: the lane files only the places that changed, moves the pointer after the files, and clears the cache after the pointer", async () => {
  const root = mkdtempSync(join(tmpdir(), "pf-")), { store, log } = recording(root), db = await migratedFactDb();
  try {
    for (const [id, name] of [[A, "Pima"], [B, "Cochise"]] as const) {
      await db.query("INSERT INTO entity(id,kind,name,state) VALUES($1,'place',$2,'AZ')", [id, name]);
      await db.query("INSERT INTO place_page(place_id,version,built_at,context) VALUES($1,1,'2026-10-01T00:00:00Z',$2::jsonb)", [id, JSON.stringify(packPlaceContext({ formatVersion: 1, current: page(name) }))]);
    }
    const national = await putFile(store, { v: 1, president: null, routing: null } satisfies NationalFile);
    // The state was filled before: both places are filed under the index the pointer names.
    const first = new Map<string, string>(), meta = new Map();
    const { buildPlaceFile, PLACE_FILE_PAGE_SQL } = await import("../lib/reader/place-file-build.ts");
    for (const row of await db.query(PLACE_FILE_PAGE_SQL)) first.set(String(row.id), (await putFile(store, { ...await buildPlaceFile(db.query, row), readAt: Date.now() })).name);
    const index = await putFile(store, buildPlaceIndex("AZ", national.name, first, meta, {}, {}));
    assert.equal((await store.writeJsonPointer<IndexPointer>(indexPointerKey("AZ"), { index: index.name, national: national.name }, null)).modified, true);
    await writePassCursor(db.query, "place-files:pages", JSON.stringify({ at: "2026-10-02T00:00:00Z", id: "" }));
    log.length = 0;

    const purges: string[][] = [];
    const deps = { facts: db.query, store, national: async () => ({ president: null, routing: null }), openMirror: async () => { throw new Error("no state copy is needed for a changed page"); },
      purge: async (tags: readonly string[]) => { purges.push([...tags]); log.push(`purge:${tags.join(",")}`); return { purged: true }; }, now: () => Date.parse("2026-10-03T00:00:00Z") };

    // Nothing changed: nothing is written and nothing is cleared.
    closePlaceFilesLane();
    assert.deepEqual(await placeFilesTurn(deps), { considered: 0, kind: "idle" });
    assert.deepEqual(log.filter(line => !line.startsWith("purge")), []);

    // One page changes: only its file, the index and the pointer are written, in that order, and the cache is cleared last.
    await db.query("UPDATE place_page SET context=$2::jsonb,version=version+1,built_at='2026-10-02T12:00:00.123456Z' WHERE place_id=$1", [A, JSON.stringify(packPlaceContext({ formatVersion: 1, current: page("Pima County") }))]);
    closePlaceFilesLane();
    const turn = await placeFilesTurn(deps);
    assert.deepEqual(turn, { considered: 1, kind: "pages" });
    assert.equal((await placeFilesTurn(deps)).kind, "idle", "the page just filed is not looked at again, though its time has microseconds");
    assert.equal(log.filter(line => line.startsWith("file:")).length, 2, "the place's new file and the new index");
    assert.equal(log.at(-2), `pointer:${indexPointerKey("AZ")}`);
    assert.equal(log.at(-1), `purge:${READER_INDEX_TAG("AZ")}`);
    assert.ok(log.findIndex(line => line.startsWith("pointer:")) > log.findLastIndex(line => line.startsWith("file:")), "the pointer moves after every file");
    assert.deepEqual(purges, [[READER_INDEX_TAG("AZ")]]);
    const moved = (await store.readJsonPointer<IndexPointer>(indexPointerKey("AZ")))!.value;
    const filed = (await getFile<PlaceIndex>(store, moved.index))!;
    const names = new Map(filed.places.map(row => [row[0].startsWith("/") ? filed.base + row[0] : row[0], row[4]]));
    assert.equal(names.get(B), first.get(B), "the place that did not change keeps its file");
    assert.notEqual(names.get(A), first.get(A));
    assert.equal(await store.readBytes(fileKey(first.get(A)!)) !== null, true, "the earlier file is never overwritten or removed");

    // Only a check date moves: the file is filed again after a day, not before.
    const aged = (await getFile<PlaceFile>(store, names.get(A)!))!;
    assert.equal(contentHash(aged), contentHash({ ...aged, variants: Object.fromEntries(Object.entries(aged.variants).map(([name, held]) => [name, { ...held, checks: { facts: [[0, "2026-10-02T00:00:00Z"]] } }])) }));
  } finally { closePlaceFilesLane(); await db.pg.close(); rmSync(root, { recursive: true, force: true }); }
});

test("SPN-01PF: files are served from the store alone, immutable, with the pointer short-lived and tagged", async () => {
  const root = mkdtempSync(join(tmpdir(), "pf-serve-")), store = new LocalFileArtifactStore(root), saved = process.env.WTP_READER_EDGE_DIR;
  process.env.WTP_READER_EDGE_DIR = root;
  installFactReader(async () => { throw new Error("a published file never reads the database"); });
  try {
    const filed = await putFile(store, { v: 1, id: "x", note: "the same for every reader" });
    await store.writeJsonPointer(indexPointerKey("AZ"), { index: filed.name, national: filed.name }, null);
    const asked = (encoding: string) => new Request("https://example.test/f", { headers: { "accept-encoding": encoding } });
    const file = await servePlaceFile(asked("gzip, br"), filed.name);
    assert.equal(file.headers.get("cache-control"), "public, max-age=31536000, immutable");
    assert.match(file.headers.get("netlify-cdn-cache-control")!, /durable.*immutable/);
    assert.equal(file.headers.get("content-encoding"), "br");
    assert.deepEqual(JSON.parse(brotliDecompressSync(Buffer.from(await file.arrayBuffer())).toString()), { v: 1, id: "x", note: "the same for every reader" });
    assert.deepEqual(await (await servePlaceFile(asked("identity"), filed.name)).json(), { v: 1, id: "x", note: "the same for every reader" });
    assert.equal((await servePlaceFile(asked("br"), "0".repeat(32))).status, 404);
    assert.equal((await servePlaceFile(asked("br"), "../etc/passwd")).status, 404);
    const pointer = await servePlaceIndexPointer("AZ");
    assert.deepEqual(await pointer.json(), { index: filed.name, national: filed.name });
    assert.equal(pointer.headers.get("netlify-cache-tag"), READER_INDEX_TAG("AZ"));
    assert.match(pointer.headers.get("netlify-cdn-cache-control")!, /max-age=60, stale-while-revalidate=600/);
    assert.equal((await servePlaceIndexPointer("ZZ")).status, 404);
  } finally { installFactReader(undefined); if (saved === undefined) delete process.env.WTP_READER_EDGE_DIR; else process.env.WTP_READER_EDGE_DIR = saved; rmSync(root, { recursive: true, force: true }); }
});

test("SPN-01PF: a place is read from its file and the national file alone", async () => {
  const root = mkdtempSync(join(tmpdir(), "pf-read-")), { store } = recording(root), db = await migratedFactDb();
  try {
    await db.query("INSERT INTO entity(id,kind,name,state) VALUES($1,'place','Pima','AZ')", [A]);
    await db.query("INSERT INTO place_page(place_id,version,built_at,context) VALUES($1,1,now(),$2::jsonb)", [A, JSON.stringify(packPlaceContext({ formatVersion: 1, current: page("Pima County") }))]);
    const { buildPlaceFile, PLACE_FILE_PAGE_SQL } = await import("../lib/reader/place-file-build.ts");
    const [row] = await db.query(`${PLACE_FILE_PAGE_SQL} AND p.place_id=$1`, [A]);
    const file = await putFile(store, { ...await buildPlaceFile(db.query, row!), readAt: 1 });
    const national = await putFile(store, { v: 1, president: null, routing: null } satisfies NationalFile);
    const zips = { "85701": { point: [32.2, -110.9] as const, states: ["AZ"], ids: [A], partial: [], fringe: [], districts: [] } };
    const index = await putFile(store, buildPlaceIndex("AZ", national.name, new Map([[A, file.name]]), new Map(), {}, zips));
    await store.writeJsonPointer(indexPointerKey("AZ"), { index: index.name, national: national.name }, null);
    installFactReader(async () => { throw new Error("a read from files never reads the database"); });
    const place = await loadPlaceFromFiles({ state: "AZ", divisionIds: [A] }, await openPlaceFiles(store).source("AZ"));
    assert.equal(place.registry, null);
    assert.equal(place.everydayRouting, null);
    assert.equal(place.bodies.length, 0);
    const listed = zipEntry((await openPlaceFiles(store).index("AZ"))!.index, "85701")!;
    assert.deepEqual([listed.ids, listed.states, listed.samples], [[A], ["AZ"], 0]);
    await assert.rejects(stateAnswerFromFiles(await openPlaceFiles(store).source("AZ"), "AZ", "85701", listed), /STATE_FILE_MISSING:AZ/, "a state without its statewide part is not answered from a guess");
  } finally { installFactReader(undefined); await db.pg.close(); rmSync(root, { recursive: true, force: true }); }
});

test("SPN-01PF: a state's package is cut by division and a ZIP's divisions put it back together in the state's own order", () => {
  const holder = (id: string, name: string) => ({ id, name, personId: id, nativeIds: {}, memberships: [] });
  const set = (people: ReturnType<typeof holder>[], links: [string, string][]) => ({ scope: "04", generatedAt: "t", officeholders: people, divisions: links.map(([officeholderId, ocdId]) => ({ officeholderId, ocdId })), unmatched: [], endedMemberships: [], disagreements: [] });
  const people = set([holder("p1", "Ann Lee"), holder("p2", "Bo Ray"), holder("p3", "Cy Poe"), holder("fed:ann", "Ann Lee")], [["p1", `${STATE}/sldl:1`], ["p2", `${STATE}/sldl:2`], ["p3", `${STATE}/sldl:3`]]);
  const division = (ocdId: string, tier: string) => ({ ocdId, tier, label: ocdId });
  const pkg = { state: "AZ", boundaryUrl: "/b", versionParts: ["r", "p", "f", "c", "o", undefined, undefined, "b", "g", "null", "[]"], stateLegislatorAuthority: {},
    districts: { kind: "NOT_PUBLISHED" }, memberOffices: [], people, legislativePeople: null, federal: null, ballotRead: undefined,
    registry: { registry: { generatedAt: "t", divisions: [division(STATE, "state"), division(`${STATE}/sldl:1`, "state"), division(`${STATE}/sldl:2`, "state"), division(`${STATE}/sldl:3`, "state")],
      bodies: [{ id: "b1", ocdId: `${STATE}/sldl:1`, alsoServesOcdIds: [`${STATE}/sldl:3`] }] }, bodyRosters: [], statewideExecutives: [], officialCandidacies: { rows: [] }, officialPhotos: { photos: [] }, rosterPhotos: {} } } as unknown as ReaderStatePackage;
  const probe = { ...pkg, peopleRead: { kind: "NOT_RECORDED" }, federalRead: { kind: "NOT_RECORDED" }, ballotRead: { kind: "NOT_RECORDED" } } as unknown as ReaderStatePackage;
  const { wide, shares } = cutState(pkg, [], probe);
  assert.deepEqual([...shares.keys()].sort(), [STATE, `${STATE}/sldl:1`, `${STATE}/sldl:2`, `${STATE}/sldl:3`]);
  const read = (...ids: string[]) => composeState(JSON.parse(JSON.stringify(wide)), ids.map(id => JSON.parse(JSON.stringify(shares.get(id)))));
  const zip = read(`${STATE}/sldl:3`, `${STATE}/sldl:1`, STATE);
  assert.deepEqual(zip.people!.officeholders.map(holder => holder.id), ["p1", "p3", "fed:ann"], "the same person held under another id travels with them, in the state's own order");
  assert.deepEqual(zip.registry.registry.bodies.map(body => body.id), ["b1"], "a board reaches every division it serves");
  assert.deepEqual(zip.registry.registry.divisions.map(row => row.ocdId), [STATE, `${STATE}/sldl:1`, `${STATE}/sldl:3`]);
  assert.equal(JSON.stringify(read(`${STATE}/sldl:2`).people!.officeholders.map(holder => holder.id)), '["p2"]');
});
