import assert from "node:assert/strict";
import test from "node:test";
import { answerUrl, centroidOfEntry, detailUrlOfBody, expandAnswer, loadAnswer, loadBoardDetail, loadZip3, loadZipEntry, withBoardDetail, zip3Url, type SlimAnswer } from "../lib/reader/answer-client.ts";
import { projectedBodyRoster } from "../lib/registry/body-roster-client.ts";

const entry = { states: ["MT"], point: [-112.53, 45.99] as const, key: "abc123def456", ids: ["ocd-division/country:us/state:mt"], partial: [], fringe: [] };
const board = "/api/answer/board/government%3AUS-MT%3Acog%3A1%23body%3Acouncil/0123456789abcdef";

const slim = (): SlimAnswer => ({
  tier: "exact", radiusKm: 25, center: { lat: 45.99, lng: -112.53 },
  meetings: [{ id: "m1", bodyId: "b1", bodyName: "Council", title: "Regular", startsAt: "2026-11-10T18:00:00-07:00", timeZone: "America/Denver", detail: board } as never,
    { id: "m2", bodyId: "b2", bodyName: "Plain", title: "Regular", startsAt: "2026-11-11T18:00:00-07:00", timeZone: "America/Denver" } as never],
  coverage: { state: "MEETINGS", bodies: [{ bodyId: "b1", readerRoster: { count: 3, gaps: [{ statement: "one missing" }], detail: board } }, { bodyId: "b2", readerRoster: { members: [], gaps: [], officePhone: null } }], seats: [], divisions: [] } as never,
  stateResponse: { status: 200, value: { state: "MT", version: "v", zipPlaces: {}, directory: null, boundaryUrl: "", coverage: { bodies: [{ bodyId: "s1", readerRoster: { count: 1, detail: board } }] } } as never },
});

test("an answer's light roster becomes a reference and a whole roster stays as it is", () => {
  const answer = expandAnswer(slim());
  const [light, whole] = answer.coverage!.bodies;
  assert.deepEqual(light!.readerRosterRef, { count: 3, gaps: [{ statement: "one missing" }], detail: board });
  assert.deepEqual(projectedBodyRoster(light).gaps, [{ statement: "one missing" }], "a board's gaps are read before its roster arrives");
  assert.equal(light!.readerRoster, undefined);
  assert.deepEqual(whole!.readerRoster, { members: [], gaps: [], officePhone: null });
  assert.equal(answer.stateResponse!.value.coverage.bodies[0]!.readerRosterRef!.count, 1);
  assert.equal(expandAnswer({ ...slim(), stateResponse: { status: 503, value: { error: "down" } } }).stateResponse, undefined);
});

test("a board's detail fills its roster, sources and meetings once, and a second fill changes nothing", () => {
  const answer = expandAnswer(slim());
  assert.equal(detailUrlOfBody(answer, "b1"), board);
  assert.equal(detailUrlOfBody(answer, "none"), null);
  const provenance = { sourceUrl: "https://example.gov/m1", sourceOrg: "City", collectedAt: "2026-11-01T00:00:00Z", verifiedAt: null };
  const roster = { members: [{ id: "p1", name: "A" }], gaps: [], officePhone: null } as never;
  const filled = withBoardDetail(answer, "b1", { readerRoster: roster, fieldSources: { name: provenance }, meetings: { m1: { provenance } } } as never);
  assert.notEqual(filled, answer);
  assert.equal(filled.coverage!.bodies[0]!.readerRoster, roster);
  assert.deepEqual(filled.coverage!.bodies[0]!.fieldSources, { name: provenance });
  assert.deepEqual(filled.meetings[0]!.provenance, provenance);
  assert.equal(filled.meetings[1], answer.meetings[1], "another board's meeting is the same object");
  assert.equal(withBoardDetail(answer, "unknown", { readerRoster: roster } as never), answer);
  assert.equal(filled.coverage!.bodies[0]!.readerRosterRef, undefined, "the reference that said not yet is gone");
  assert.equal(withBoardDetail(filled, "b1", { readerRoster: roster } as never), filled, "a second fill returns the same answer");
  const bare = withBoardDetail(expandAnswer(slim()), "b1", { readerRoster: null, fieldSources: null } as never);
  assert.equal(bare.coverage!.bodies[0]!.readerRoster, undefined);
  assert.equal(withBoardDetail(bare, "b1", { readerRoster: null } as never), bare, "a board with no roster is not asked for again");
});

test("a ZIP's point is [lng, lat] and becomes a located ZIP", () => {
  assert.deepEqual(centroidOfEntry("59601", entry), { zip: "59601", lat: 45.99, lng: -112.53, state: "MT" });
  assert.equal(answerUrl("59601", entry.key), "/api/answer/59601/abc123def456");
  assert.equal(zip3Url("59601"), "/api/reader/zip3/596.json");
});

test("a ZIP3 file is fetched once for every ZIP of its prefix, and a missing file sends the ZIP to the database routes", async t => {
  const urls: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = String(input); urls.push(url);
    return url.includes("/zip3/777.json") ? new Response(null, { status: 404 }) : Response.json({ v: 1, zips: { "59601": entry, "59602": { ...entry, key: "ffffffffffff" } } });
  });
  const [a, b, c] = await Promise.all([loadZipEntry("59601"), loadZipEntry("59602"), loadZipEntry("59603")]);
  assert.equal(a!.key, "abc123def456"); assert.equal(b!.key, "ffffffffffff"); assert.equal(c, null);
  assert.deepEqual(urls, ["/api/reader/zip3/596.json"]);
  assert.equal(await loadZipEntry("77701"), null);
  assert.equal(await loadZip3("77701"), null);
  assert.equal(urls.filter(url => url.includes("777")).length, 2, "a missing file is asked for again, not remembered");
});

test("an answer is one request and a missing answer is null", async t => {
  const urls: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = String(input); urls.push(url);
    return url.endsWith("/gone") ? new Response(null, { status: 404 }) : url.endsWith("/broken") ? new Response(null, { status: 503 }) : Response.json(slim());
  });
  const answer = await loadAnswer("59601", entry);
  assert.equal(answer!.coverage!.bodies[0]!.readerRosterRef!.count, 3);
  assert.deepEqual(urls, ["/api/answer/59601/abc123def456"]);
  assert.equal(await loadAnswer("59601", { ...entry, key: "gone" }), null);
  await assert.rejects(loadAnswer("59601", { ...entry, key: "broken" }), (error: { status?: number }) => error.status === 503);
});

test("a board's detail is fetched once however many cards ask", async t => {
  const urls: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => { urls.push(String(input)); return Response.json({ bodyId: "b1" }); });
  const [a, b] = await Promise.all([loadBoardDetail(board), loadBoardDetail(board)]);
  assert.equal(a, b);
  await loadBoardDetail(board);
  assert.deepEqual(urls, [board]);
});
