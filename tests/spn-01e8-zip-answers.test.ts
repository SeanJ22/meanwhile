import assert from "node:assert/strict";
import { test } from "node:test";
import { brotliDecompressSync } from "node:zlib";

import { GET as locationGET } from "../app/api/location/zip/route.ts";
import { GET as stateGET } from "../app/api/reader/state/route.ts";
import { GET as meetingsGET } from "../app/api/meetings/route.ts";
import { installRegistryAuthority, installFederalDirectory, syntheticFederalDirectory } from "./helpers/promoted-fixtures.ts";
import { recordedMeetingsSnapshot } from "./helpers/reader-fixtures.ts";
import { publishRecordedEdge } from "./helpers/reader-edge-meetings.ts";
import { azDistricts } from "./helpers/ballot-district-fixtures.ts";
import { fixturePlaceMapQuery } from "./helpers/place-map.ts";
import { installPlaceMapQuery, placeMapQuery } from "../lib/place-map/reader.ts";
import { factReader, installFactReader } from "../lib/facts/db.ts";
import { installReaderDatabaseQuery, readerDatabaseQuery } from "../lib/reader/database.ts";
import { resolveReaderArtifactStore } from "../lib/meetings/edge-store.ts";
import { buildZipAnswer } from "../lib/reader/zip-answer-build.ts";
import { packZipAnswer, readZipAnswer, zipAnswerKey, type ZipAnswer } from "../lib/reader/zip-answer.ts";

await installRegistryAuthority();
{
  const recorded = recordedMeetingsSnapshot();
  await publishRecordedEdge(recorded.meetings, recorded.agendaDocuments, recorded.generatedAt, {
    "census-districts": { value: azDistricts, versionId: azDistricts.versionId },
  });
  await installFederalDirectory(syntheticFederalDirectory());
}

/** A ZIP lying in Arizona and New Jersey: its places are those of 85701 and 07866 under a ZIP of its own. */
const CROSSING = "85799";
{
  const base = fixturePlaceMapQuery();
  installPlaceMapQuery(async (sql, params = []) => {
    if (!JSON.stringify(params).includes(CROSSING)) return base(sql, params);
    const own = await base(sql, JSON.parse(JSON.stringify(params).replaceAll(CROSSING, "85701")));
    if (!sql.includes("m.zip=ANY(")) return own.map(row => ({ ...row, zip: CROSSING }));
    const [other] = await base(sql, [["07866"]]);
    return own.map(row => ({ ...row, zip: CROSSING, memberships: [...row.memberships as unknown[], ...other.memberships as unknown[]] }));
  });
}
const placeMap = placeMapQuery();
const ZIPS = ["85701", "85641", "07866", CROSSING] as const;

const call = async (handler: (request: Request) => Promise<Response>, path: string) => {
  const response = await handler(new Request(`https://example.test${path}`));
  const { "server-timing": _timing, ...headers } = Object.fromEntries(response.headers);
  return { status: response.status, headers, body: await response.json() as Record<string, unknown> };
};
const answers = (zip: string) => [
  ["location", locationGET, `/api/location/zip?zip=${zip}`],
  ["state", stateGET, `/api/reader/state?zip=${zip}`],
  ["meetings", meetingsGET, `/api/meetings?zip=${zip}`],
  ["meetings with state", meetingsGET, `/api/meetings?zip=${zip}&include=state`],
] as const;

const publish = async (zip: string): Promise<ZipAnswer> => {
  const answer = await buildZipAnswer(zip), store = resolveReaderArtifactStore()!;
  assert.ok(answer, `${zip} has an answer to publish`);
  const packed = packZipAnswer(answer);
  if (packed.part) await store.writeBytes(packed.part.key, packed.part.bytes);
  await store.writeBytes(zipAnswerKey(zip), packed.file);
  return answer;
};
const withoutUndefined = (value: unknown): unknown => Array.isArray(value) ? value.map(withoutUndefined)
  : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, withoutUndefined(item)])) : value;

/** What the routes answered from the database, before anything is published. */
const fromDatabase = new Map<string, Awaited<ReturnType<typeof call>>[]>();
test("the routes answer every fixture ZIP from the database while nothing is published", async () => {
  for (const zip of ZIPS) {
    assert.equal(await readZipAnswer(zip), null);
    const held = [];
    for (const [, handler, path] of answers(zip)) held.push(await call(handler, path));
    assert.deepEqual(held.map(answer => answer.status), [200, 200, 200, 200], zip);
    fromDatabase.set(zip, held);
  }
  assert.equal(fromDatabase.get(CROSSING)![1].body.state, "AZ", "the crossing ZIP's first state answers by default");
});

test("a published ZIP's three answers are the database's answers, in bodies and cache headers", async () => {
  for (const zip of ZIPS) {
    await publish(zip);
    const held = fromDatabase.get(zip)!;
    for (const [index, [name, handler, path]] of answers(zip).entries()) {
      const published = await call(handler, path);
      assert.deepEqual(published.body, held[index].body, `${zip} ${name}: body`);
      assert.deepEqual(published.headers, held[index].headers, `${zip} ${name}: headers`);
      assert.match(published.headers["netlify-cache-tag"] ?? "", new RegExp(`(?:^|,)reader-zip:${zip}(?:,|$)`), `${zip} ${name}: carries the ZIP's tag`);
    }
  }
});

test("a ZIP crossing a state line answers each of its states from the published file", async () => {
  const held = await readZipAnswer(CROSSING);
  assert.deepEqual(Object.keys(held!.states).sort(), ["AZ", "NJ"]);
  for (const state of ["AZ", "NJ"]) {
    const path = `/api/reader/state?state=${state}&zip=${CROSSING}`;
    const published = await call(stateGET, path);
    assert.equal(published.status, 200);
    assert.equal(published.body.state, state);
    assert.deepEqual(published.body, held!.states[state].body);
    assert.equal(published.headers.etag, `"${held!.states[state].version}:${CROSSING}"`);
  }
  const meetings = (await call(meetingsGET, `/api/meetings?zip=${CROSSING}&include=state`)).body as { stateResponse: { value: { state: string } } };
  assert.equal(meetings.stateResponse.value.state, "AZ");
});

test("the saved pages round-trip through the published file exactly", async () => {
  for (const zip of ZIPS) {
    const built = (await buildZipAnswer(zip))!, { print, ...held } = (await readZipAnswer(zip))!;
    // JSON drops keys whose value is undefined; nothing else (a Map, a Date, a NaN) may change on the way.
    assert.deepStrictEqual(held, withoutUndefined(built), zip);
    assert.equal(print, packZipAnswer(built).print, "building the same ZIP again gives the same print");
  }
});

test("stored sizes and the cost of reading a published answer", async () => {
  const store = resolveReaderArtifactStore()!;
  const rows = [];
  for (const zip of ZIPS) {
    const built = (await buildZipAnswer(zip))!, packed = packZipAnswer(built);
    const times: number[] = [];
    for (let run = 0; run < 15; run++) { const start = performance.now(); assert.ok(await readZipAnswer(zip, store)); times.push(performance.now() - start); }
    times.sort((a, b) => a - b);
    rows.push({ zip, json: JSON.stringify(built).length, file: packed.file.length, sharedRegistry: packed.part?.bytes.length ?? 0,
      readDecodeMsMedian: Number(times[7].toFixed(1)), readDecodeMsWorst: Number(times.at(-1)!.toFixed(1)) });
    assert.equal(JSON.parse(brotliDecompressSync(packed.file).toString()).answer.zip, zip);
  }
  console.log("ZIP_ANSWER_SIZES", JSON.stringify(rows));
});

test("with the database unreachable, a published ZIP still answers all three routes and touches neither database", async () => {
  let queries = 0, fetches = 0;
  const fact = factReader(), reader = readerDatabaseQuery(), originalFetch = globalThis.fetch;
  const down = async () => { queries++; throw new Error("the database is down"); };
  const env = { build: process.env.WTP_BUILD_CONTEXT, plane: process.env.WTP_CONTROL_PLANE_DATABASE_URL };
  installFactReader(down); installReaderDatabaseQuery(down as never); installPlaceMapQuery(down);
  globalThis.fetch = (async () => { fetches++; throw new Error("no network"); }) as typeof fetch;
  // The saved keys come from the control-plane database, which has no address here: anything that waits on them fails.
  process.env.WTP_BUILD_CONTEXT = "production"; delete process.env.WTP_CONTROL_PLANE_DATABASE_URL;
  try {
    for (const zip of ZIPS) for (const [name, handler, path] of answers(zip)) assert.equal((await call(handler, path)).status, 200, `${zip} ${name}`);
    assert.deepEqual([queries, fetches], [0, 0], "no query on either database and no request to one");
    const unpublished = answers("85705");
    await assert.rejects(() => call(unpublished[2][1], unpublished[2][2]), /saved keys could not be reached/, "a ZIP without a published file waits on the saved keys, so the check above is measuring");
  } finally {
    globalThis.fetch = originalFetch;
    process.env.WTP_BUILD_CONTEXT = env.build; if (env.build === undefined) delete process.env.WTP_BUILD_CONTEXT;
    if (env.plane !== undefined) process.env.WTP_CONTROL_PLANE_DATABASE_URL = env.plane;
    installFactReader(fact); installReaderDatabaseQuery(reader); installPlaceMapQuery(placeMap);
  }
});

test("a ZIP with no published file is answered from the database as before", async () => {
  let queries = 0;
  const reader = factReader(), counting = fixturePlaceMapQuery();
  installPlaceMapQuery(async (sql, params) => { queries++; return counting(sql, params); });
  try {
    const answer = await call(locationGET, "/api/location/zip?zip=85705");
    assert.equal(answer.status, 200);
    assert.ok(queries > 0, "the long way reads the place map");
  } finally { installFactReader(reader); installPlaceMapQuery(placeMap); }
});

test("a request naming its own point is answered from the file only when the point has the same territory boards", async () => {
  const published = (await readZipAnswer("85701"))!;
  let queries = 0;
  const fact = factReader(), reader = readerDatabaseQuery();
  const down = async () => { queries++; throw new Error("the database is down"); };
  installFactReader(down); installReaderDatabaseQuery(down as never); installPlaceMapQuery(down);
  try {
    const same = await meetingsGET(new Request(`https://example.test/api/meetings?zip=85701&lat=${published.point.lat}&lng=${published.point.lng}`));
    assert.equal(same.status, 200);
    assert.equal(queries, 0);
  } finally { installFactReader(fact); installReaderDatabaseQuery(reader); installPlaceMapQuery(placeMap); }
});
