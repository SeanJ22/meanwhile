import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { LocalFileArtifactStore } from "../lib/meetings/edge-store.ts";
import { answerPath, boardPath, easternDay, easternDayStart, slimAnswer } from "../lib/reader/answer.ts";
import { serveAnswer, serveBoard, serveZip3 } from "../lib/reader/answer-serve.ts";
import { putFile } from "../lib/reader/place-files.ts";
import { indexPointerKey } from "../lib/reader/place-files.ts";
import { buildPlaceIndex } from "../lib/reader/place-index.ts";
import { READER_ZIP3_TAG, zip3Key, type Zip3File, type ZipRow } from "../lib/reader/zip3.ts";

const row = (key: string, day = easternDay(new Date())): ZipRow => ({ states: ["AZ"], point: [-110.9, 32.2], key, day, ids: [], partial: [], fringe: [], districts: [] });
const asked = (encoding = "gzip, br") => new Request("https://example.test/a", { headers: { "accept-encoding": encoding } });
const body = async (response: Response): Promise<unknown> => {
  const bytes = Buffer.from(await response.arrayBuffer()), encoding = response.headers.get("content-encoding");
  return JSON.parse((encoding === "br" ? brotliDecompressSync(bytes) : encoding === "gzip" ? gunzipSync(bytes) : bytes).toString());
};
async function withStore<T>(run: (store: LocalFileArtifactStore) => Promise<T>): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), "pc1-")), store = new LocalFileArtifactStore(root);
  try { return await run(store); } finally { rmSync(root, { recursive: true, force: true }); }
}
const publish = (store: LocalFileArtifactStore, prefix: string, zips: Record<string, ZipRow>) =>
  store.writeJsonPointer<Zip3File>(zip3Key(prefix), { v: 1, zips }, null);

test("SPN-01PC1: an answer is kept for a year by every CDN node and survives a deploy; the browser asks again and is told it is the same", async () => {
  await withStore(async store => {
    await publish(store, "857", { "85701": row("0123456789ab") });
    let made = 0;
    const assemble = async () => { made++; return { meetings: [], zip: "85701" }; };
    const response = await serveAnswer(asked(), "85701", "0123456789ab", store, assemble);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "public, max-age=0, must-revalidate");
    assert.equal(response.headers.get("netlify-cdn-cache-control"), "public, durable, max-age=31536000, immutable");
    assert.equal(response.headers.get("netlify-cache-id"), "reader-answer", "a deploy does not empty it");
    assert.equal(response.headers.get("etag"), '"0123456789ab"');
    assert.equal(response.headers.get("netlify-cache-tag"), "reader-settings", "the publication of the meeting settings clears it");
    assert.equal(response.headers.get("content-encoding"), "br");
    assert.equal(response.headers.get("vary"), null, "one copy for every reader");
    assert.deepEqual(await body(response), { meetings: [], zip: "85701" });
    const plain = await serveAnswer(asked("gzip"), "85701", "0123456789ab", store, assemble);
    assert.equal(plain.headers.get("content-encoding"), null, "a client without brotli is given the plain JSON");
    assert.equal(plain.headers.get("netlify-cdn-cache-control"), "no-store", "which the CDN does not keep in place of the brotli copy");
    assert.deepEqual(await body(plain), { meetings: [], zip: "85701" });
    assert.equal(made, 2);
  });
});

test("SPN-01PC1: a stale key is sent to the current one for a moment and assembles nothing; a ZIP that is not published is not there", async () => {
  await withStore(async store => {
    await publish(store, "857", { "85701": row("bbbbbbbbbbbb") });
    const assemble = async () => { throw new Error("a stale key must not assemble"); };
    const stale = await serveAnswer(asked(), "85701", "aaaaaaaaaaaa", store, assemble);
    assert.equal(stale.status, 307);
    assert.equal(stale.headers.get("location"), answerPath("85701", "bbbbbbbbbbbb"));
    assert.match(stale.headers.get("netlify-cdn-cache-control")!, /max-age=30$/);
    assert.equal(stale.headers.get("netlify-cache-id"), null, "a redirect is not kept past a deploy");
    for (const [zip, key] of [["85702", "bbbbbbbbbbbb"], ["8570", "bbbbbbbbbbbb"], ["85701", "../../x"], ["85701", "BBBB"]] as const) {
      const missing = await serveAnswer(asked(), zip, key, store, assemble);
      assert.equal(missing.status, 404, `${zip}/${key}`);
      assert.equal(missing.headers.get("netlify-cache-id"), null);
    }
    assert.equal((await serveAnswer(asked(), "85701", "bbbbbbbbbbbb", null, assemble)).status, 404, "no store, no answer");
  });
});

test("SPN-01PC1: an answer made for a day that has passed is kept only a minute, so the lane being late never pins yesterday", async () => {
  await withStore(async store => {
    await publish(store, "857", { "85701": row("cccccccccccc", "2020-01-01") });
    const response = await serveAnswer(asked(), "85701", "cccccccccccc", store, async () => ({ ok: true }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("netlify-cdn-cache-control"), "public, durable, max-age=60");
    assert.equal(response.headers.get("netlify-cache-id"), null);
  });
});

test("SPN-01PC1: a failed assembly is not kept", async () => {
  await withStore(async store => {
    await publish(store, "857", { "85701": row("dddddddddddd") });
    const response = await serveAnswer(asked(), "85701", "dddddddddddd", store, async () => { throw new Error("PLACE_INDEX_MISSING:AZ"); });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "no-store");
  });
});

test("SPN-01PC1: the file of a prefix is short-lived and tagged so the lane can clear it", async () => {
  await withStore(async store => {
    await publish(store, "857", { "85701": row("0123456789ab") });
    const response = await serveZip3("857", store);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("netlify-cache-tag"), READER_ZIP3_TAG("857"));
    assert.match(response.headers.get("netlify-cdn-cache-control")!, /max-age=60, stale-while-revalidate=86400/);
    assert.equal(((await response.json()) as Zip3File).zips["85701"]!.key, "0123456789ab");
    assert.equal((await serveZip3("858", store)).status, 404);
    assert.equal((await serveZip3("85", store)).status, 404);
  });
});

test("SPN-01PC1: a board's detail is immutable at its file's version, and a version that has moved is sent on", async () => {
  await withStore(async store => {
    const id = "government:US-AZ:cog:1#body:council";
    const file = (name: string) => ({ v: 1, id, kind: "body", state: "AZ", version: 1, builtAt: 1, readAt: 1, variants: {}, name });
    const old = await putFile(store, file("old")), current = await putFile(store, file("current")), national = await putFile(store, { v: 1, president: null, routing: null });
    const index = await putFile(store, buildPlaceIndex("AZ", national.name, new Map([[id, current.name]]), new Map([[id, { id, kind: "body", name: "Council", parent: null, box: null }]]), {}, {}));
    await store.writeJsonPointer(indexPointerKey("AZ"), { index: index.name, national: national.name }, null);
    const assemble = async () => ({ bodyId: id, readerRoster: { members: [] }, fieldSources: null, meetings: {} });
    const response = await serveBoard(asked(), id, current.name, store, assemble);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("netlify-cdn-cache-control"), "public, durable, max-age=31536000, immutable");
    assert.equal(response.headers.get("netlify-cache-id"), "reader-answer");
    const stale = await serveBoard(asked(), id, old.name, store, async () => { throw new Error("a stale version must not assemble"); });
    assert.equal(stale.status, 307);
    assert.equal(stale.headers.get("location"), boardPath(id, current.name));
    assert.equal((await serveBoard(asked(), "another", current.name, store, assemble)).status, 404);
    assert.equal((await serveBoard(asked(), id, "0".repeat(32), store, assemble)).status, 404);
    assert.equal((await serveBoard(asked(), id, "nope", store, assemble)).status, 404);
  });
});

test("SPN-01PC1: a board's id travels in a path whole", () => {
  assert.equal(boardPath("government:US-WI:cog:205654#body:housing", "f".repeat(32)), `/api/answer/board/government%3AUS-WI%3Acog%3A205654%23body%3Ahousing/${"f".repeat(32)}`);
  assert.equal(decodeURIComponent(boardPath("a/b#c", "f".repeat(32)).split("/")[4]!), "a/b#c");
});

test("SPN-01PC1: the answer is made as of the first instant of the Eastern day its key names", () => {
  assert.equal(easternDayStart("2026-07-04").toISOString(), "2026-07-04T04:00:00.000Z", "summer");
  assert.equal(easternDayStart("2026-11-08").toISOString(), "2026-11-08T05:00:00.000Z", "winter");
  assert.equal(easternDayStart("2026-11-01").toISOString(), "2026-11-01T04:00:00.000Z", "the day the clocks go back began in summer time");
  assert.equal(easternDayStart("2026-03-08").toISOString(), "2026-03-08T05:00:00.000Z", "the day the clocks go forward began in winter time");
  for (const day of ["2026-03-08", "2026-11-01", "2027-01-01"]) assert.equal(easternDay(easternDayStart(day)), day);
  assert.throws(() => easternDayStart("nonsense"));
});

test("SPN-01PC1: the heavy parts of an answer stay at their boards, and a board that has no file keeps its own", () => {
  const roster = { members: [{ name: "A", officeTitle: "Alderman" }, { name: "B", officeTitle: "Alderman" }], gaps: [{ statement: "one missing" }], officePhone: null }, board = { members: [{ name: "C", officeTitle: "Select Board Member" }], gaps: [], officePhone: null }, sources = { name: { sourceUrl: "https://x.gov/" } };
  const url = boardPath("body:with", "a".repeat(32));
  const full = {
    meetings: [{ id: "m1", bodyId: "body:with", title: "T", fieldSources: sources, publicationConflicts: [1], provenance: { sourceUrl: "u" } },
      { id: "m2", bodyId: "body:without", title: "U", fieldSources: sources, provenance: { sourceUrl: "u" } }, { id: "m3", bodyId: null, title: "V", provenance: { sourceUrl: "u" } }],
    coverage: { bodies: [{ bodyId: "body:with", name: "W", readerRoster: roster, fieldSources: sources }, { bodyId: "body:without", name: "X", readerRoster: roster, fieldSources: sources },
      { bodyId: "body:with", bodyClass: "GOVERNING", name: "G", readerRoster: board, fieldSources: sources },
      { bodyId: "body:with", bodyClass: "GOVERNING", name: "H", readerRoster: roster, fieldSources: sources }] },
    stateResponse: { status: 200, headers: [], value: { coverage: { bodies: [{ bodyId: "body:with", readerRoster: roster }] }, zip: "85701" } },
    tier: "exact",
  };
  const slim = slimAnswer(full, id => id === "body:with" ? url : null) as typeof full & { meetings: Record<string, unknown>[] };
  assert.deepEqual(slim.meetings[0], { id: "m1", bodyId: "body:with", title: "T", sourceUrl: "u", detail: url }, "the page of the meeting stays for a row with no agenda");
  assert.deepEqual(slim.meetings[1], full.meetings[1]);
  assert.deepEqual(slim.meetings[2], full.meetings[2]);
  assert.deepEqual(slim.coverage.bodies[0], { bodyId: "body:with", name: "W", readerRoster: { count: 2, gaps: [{ statement: "one missing" }], detail: url } });
  assert.deepEqual(slim.coverage.bodies[1], full.coverage.bodies[1]);
  assert.deepEqual(slim.coverage.bodies[2], { bodyId: "body:with", bodyClass: "GOVERNING", name: "G", readerRoster: board, detail: url }, "a board with a Select Board line keeps its members; its sources are at the board");
  assert.deepEqual(slim.coverage.bodies[3], { bodyId: "body:with", bodyClass: "GOVERNING", name: "H", readerRoster: { count: 2, gaps: [{ statement: "one missing" }], detail: url } }, "any other governing board keeps only its gaps");
  assert.deepEqual(slim.stateResponse.value.coverage.bodies[0], { bodyId: "body:with", readerRoster: { count: 2, gaps: [{ statement: "one missing" }], detail: url } });
  assert.equal(slim.tier, "exact");
  assert.ok(full.meetings[0]!.fieldSources, "the answer it was made from is not changed");
});
