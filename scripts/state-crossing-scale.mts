import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, createReadStream, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import { US_JURISDICTIONS } from "../lib/coverage/states.ts";
import { ballotPlaceFromParams, ballotPointStateDivisions } from "../lib/ballot/reader-place.ts";
import { genericBallotProblems, readGenericBallotProjection, type GenericBallotProjection } from "../lib/ballot/generic-projection.ts";
import { readerBallotSourcesForDivisions } from "../lib/ballot/reader-sources.ts";
import { stateBallotContractId, stateBallotScope } from "../lib/civic-data/state-scopes.ts";
import { nearestZctaAsync } from "../lib/geo/zcta-table.ts";
import { ensureReaderAuthorityEdge, publishReaderEdgeArtifacts, type PublishStateAuthorities } from "../lib/meetings/edge-serving.ts";
import { LocalFileArtifactStore } from "../lib/meetings/edge-store.ts";
import { withReaderAuthorityEdge } from "../lib/registry/runtime-edge.ts";
import { carryPins } from "../lib/map/carry-pins.ts";
import { absentEdgeEntry, manualEdgeEntry, promotedFamily } from "../tests/helpers/promoted-edge-entry.ts";
import { outlineFor, stateContainsPoint, stateOcdIdAt, type StateOutlines } from "../lib/map/state-focus.ts";
import { csvRows } from "../lib/reference/csv.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const directory = process.env.WTP_STATE_CROSSING_SCALE_DIR ?? "/tmp/state-crossing-scale";
const [state, mode] = process.argv.slice(2);
const edgeDirectory = `${directory}/edge`;
type Government = { id: string; name: string; zip: string | null };
type Measurement = {
  state: string; governments: number; generatedRows: number; generatedBytes: number;
  sharedOutlineBytes: number; peakBytes: number; runtimeMs: number;
  databaseReadBytes: number; databaseWriteBytes: number;
};

type ReadMeasurement = {
  state: string; contests: number; stateBallotBytes: number; edgeBytesRead: number; readMs: number;
  zipTableMs: number; nearestZipMs: number; nationalZipMs: number; peakBytes: number;
  databaseReadBytes: number; databaseWriteBytes: number;
};

class CountingStore extends LocalFileArtifactStore {
  bytes = 0;
  override async readBytes(key: string) {
    const read = await super.readBytes(key);
    this.bytes += read?.byteLength ?? 0;
    return read;
  }
}

const ballotFile = (code: string) => `${root}/data/ballot/2026-general/${code.toLowerCase()}.json`;

/** The state's published ballot, or for a state without a file, the empty record production publishes. */
function projectionFor(code: string): GenericBallotProjection | null {
  try {
    const file = JSON.parse(readFileSync(ballotFile(code), "utf8")) as Pick<GenericBallotProjection, "ballots">;
    return { kind: "ballot-contests", ballots: file.ballots };
  } catch { return null; }
}

/** Clones one real ballot's contests, candidacies and measures until it reaches the given contest count. */
function stressProjection(real: GenericBallotProjection, contests: number): GenericBallotProjection {
  const [key, ballot] = Object.entries(real.ballots)[0];
  const copies = Math.ceil(contests / ballot.contests.length);
  const suffix = (id: string, copy: number) => `${id}~${copy}`;
  const grown = {
    ...ballot, absences: [], scopedCoverageNotes: [], measureRecords: undefined, measureAnalyses: undefined, filingCandidacies: undefined,
    generalLineup: undefined, lineupReconciliation: undefined,
    contests: Array.from({ length: copies }, (_, copy) => ballot.contests.map(row => ({ ...row, id: suffix(row.id, copy) }))).flat(),
    candidacies: Array.from({ length: copies }, (_, copy) => ballot.candidacies.map(row => ({ ...row, id: suffix(row.id, copy), contestId: suffix(row.contestId, copy) }))).flat(),
    measures: Array.from({ length: copies }, (_, copy) => ballot.measures.map(row => ({ ...row, id: suffix(row.id, copy), contestId: row.contestId ? suffix(row.contestId, copy) : row.contestId }))).flat(),
  };
  return { kind: "ballot-contests", ballots: { [key]: grown } } as GenericBallotProjection;
}

async function publishBallots(dir: string, replace: { state: string; projection: GenericBallotProjection } | null) {
  const version = "state-crossing-scale";
  const ballots: PublishStateAuthorities["ballot-contests"] = Object.fromEntries(US_JURISDICTIONS.map(({ usps }) => {
    const projection = replace?.state === usps ? replace.projection : projectionFor(usps);
    if (projection) assert.deepEqual(genericBallotProblems(projection, usps), [], usps);
    return [usps, promotedFamily([projection
      ? manualEdgeEntry(stateBallotContractId("ballot-contests", usps), projection, version)
      : absentEdgeEntry("BALLOT_CANDIDACY", stateBallotScope("ballot-contests", usps))], version)];
  }));
  const published = await publishReaderEdgeArtifacts({ formatVersion: 1, generatedAt: "2026-10-17T00:00:00.000Z",
    counts: { fresh: 0, carried: 0, total: 0, duplicatesCollapsed: 0 }, sources: [], meetings: [], agendaDocuments: [] },
  { sourceThrough: null, retrievedAt: null, promotedThrough: null },
  { store: new LocalFileArtifactStore(dir), authority: {}, stateAuthorities: { "ballot-contests": ballots }, registrations: {} });
  assert.equal(published.status, "PUBLISHED", JSON.stringify(published));
}

async function* sourceRows(file: string): AsyncGenerator<string[]> {
  let record = "";
  let quoted = false;
  for await (const line of createInterface({ input: createReadStream(file), crlfDelay: Infinity })) {
    record += line + "\n";
    for (const char of line) if (char === '"') quoted = !quoted;
    if (quoted) continue;
    yield* csvRows(record);
    record = "";
  }
  assert.equal(record, "", "Unclosed CSV record");
}

function interior(code: string) {
  const outlineText = readFileSync(`${root}/public/geo/state-outlines.geojson`, "utf8");
  const outlines = JSON.parse(outlineText) as StateOutlines;
  const identity = US_JURISDICTIONS.find(jurisdiction => jurisdiction.usps === code);
  assert.ok(identity, code);
  const id = `ocd-division/country:us/${identity.prefix}:${identity.slug}`;
  const feature = outlineFor(outlines, id);
  assert.ok(feature);
  let point: [number, number] | null = null;
  for (const [x, y] of feature.geometry.coordinates.flat()) {
    for (const delta of [0.1, -0.1, 0.01, -0.01]) {
      if (stateContainsPoint(feature, y + delta, x + delta) && stateOcdIdAt(outlines, y + delta, x + delta) === id) {
        point = [y + delta, x + delta];
        break;
      }
    }
    if (point) break;
  }
  assert.ok(point);
  assert.equal(stateOcdIdAt(outlines, ...point), id);
  return { outlineText, outlines, id, feature, point };
}

if (!state) {
  mkdirSync(directory, { recursive: true });
  for (const identity of US_JURISDICTIONS) writeFileSync(`${directory}/${identity.usps}.jsonl`, "");
  const append = (code: string, government: Government) => {
    assert.ok(US_JURISDICTIONS.some(identity => identity.usps === code), code);
    appendFileSync(`${directory}/${code}.jsonl`, JSON.stringify(government) + "\n");
  };
  for (const file of ["census_govt_units_2022", "census_govt_units_2022_dependent_school_systems"]) {
    let header: string[] | null = null;
    for await (const row of sourceRows(`${root}/data/reference/${file}.csv`)) {
      if (!header) { header = row; continue; }
      const values = Object.fromEntries(header.map((key, index) => [key, row[index]]));
      const code = values.state || (values.fips_state === "48" ? "TX" : "");
      append(code, { id: values.census_id_pid6, name: values.unit_name, zip: values.zip });
    }
  }
  let header: string[] | null = null;
  for await (const row of sourceRows(`${root}/data/reference/census_tiger_2023_territory_functional_status.csv`)) {
    if (!header) { header = row; continue; }
    const values = Object.fromEntries(header.map((key, index) => [key, row[index]]));
    if (!["A", "B", "C", "G"].includes(values.funcstat)) continue;
    const code = US_JURISDICTIONS.find(identity => identity.fips === values.statefp)!.usps;
    append(code, { id: values.geoid, name: values.name, zip: null });
  }
  const results: Measurement[] = [];
  for (const { usps: code } of US_JURISDICTIONS) {
    const child = spawnSync(process.execPath, ["--experimental-strip-types", "--import", `${root}/scripts/register-test-loader.mjs`, import.meta.filename, code], {
      encoding: "utf8", maxBuffer: 2 ** 20,
    });
    assert.equal(child.status, 0, child.stderr);
    results.push(JSON.parse(child.stdout));
  }
  const measure = <T,>(args: string[], env: Record<string, string> = {}) => {
    const child = spawnSync(process.execPath, ["--experimental-strip-types", "--import", `${root}/scripts/register-test-loader.mjs`, import.meta.filename, ...args], {
      encoding: "utf8", maxBuffer: 2 ** 20, env: { ...process.env, ...env },
    });
    assert.equal(child.status, 0, child.stderr);
    return JSON.parse(child.stdout) as T;
  };
  await publishBallots(edgeDirectory, null);
  const reads = US_JURISDICTIONS.map(({ usps: code }) => measure<ReadMeasurement>([code, "read"]));
  const largest = results.reduce((a, b) => a.generatedRows > b.generatedRows ? a : b);
  const template = projectionFor(largest.state) ?? projectionFor("AZ")!;
  await publishBallots(`${directory}/edge-stress`, { state: largest.state, projection: stressProjection(template, largest.governments) });
  const stress = measure<ReadMeasurement>([largest.state, "read"], { WTP_STATE_CROSSING_EDGE: `${directory}/edge-stress` });
  writeFileSync(`${directory}/results.json`, JSON.stringify({ results, reads, stress }, null, 2));
  const biggest = reads.reduce((a, b) => a.stateBallotBytes > b.stateBallotBytes ? a : b);
  console.log(JSON.stringify({
    states: results.length, governments: results.reduce((sum, row) => sum + row.governments, 0),
    largestMap: largest, mapPeakBytes: Math.max(...results.map(row => row.peakBytes)),
    mapRuntimeMs: results.reduce((sum, row) => sum + row.runtimeMs, 0),
    realReads: { states: reads.length, contests: reads.reduce((sum, row) => sum + row.contests, 0),
      stateBallotBytes: reads.reduce((sum, row) => sum + row.stateBallotBytes, 0),
      edgeBytesRead: reads.reduce((sum, row) => sum + row.edgeBytesRead, 0), biggest,
      peakBytes: Math.max(...reads.map(row => row.peakBytes)), readMs: reads.reduce((sum, row) => sum + row.readMs, 0),
      slowestReadMs: Math.max(...reads.map(row => row.readMs)), nearestZipMs: Math.max(...reads.map(row => row.nearestZipMs)),
      nationalZipMs: Math.max(...reads.map(row => row.nationalZipMs)),
      databaseBytes: reads.reduce((sum, row) => sum + row.databaseReadBytes + row.databaseWriteBytes, 0) },
    stress,
  }));
} else if (mode === "read") {
  const start = performance.now();
  for (const key of ["DATABASE_URL", "DATABASE_URL_UNPOOLED", "NEON_DATABASE_URL"]) delete process.env[key];
  const { point: [lat, lng], id } = interior(state);
  const store = new CountingStore(process.env.WTP_STATE_CROSSING_EDGE ?? edgeDirectory);
  const manifest = (await store.readManifest())!.manifest;
  const tableStart = performance.now();
  await nearestZctaAsync(lat, lng, state);
  const zipTableMs = performance.now() - tableStart;
  const nearestStart = performance.now();
  const near = await nearestZctaAsync(lat, lng, state);
  const nearestZipMs = performance.now() - nearestStart;
  const nationalStart = performance.now();
  await nearestZctaAsync(lat, lng);
  const nationalZipMs = performance.now() - nationalStart;
  const place = ballotPlaceFromParams({ state, lat: String(lat), lng: String(lng) });
  assert.equal(place.state?.ocdId, id);
  const edge = await ensureReaderAuthorityEdge(manifest, store, ["ballot-contests"]);
  const { ballots, stateBallotBytes } = await withReaderAuthorityEdge(edge, async () => {
    const whole = await readGenericBallotProjection(state);
    const sources = await readerBallotSourcesForDivisions(await ballotPointStateDivisions(place.state!, lat, lng));
    return { ballots: sources.map(row => row.source.normalize(null as never)),
      stateBallotBytes: whole.kind === "PROMOTED" ? Buffer.byteLength(JSON.stringify(whole.value)) : 0 };
  });
  assert.ok(near === null || /^\d{5}$/.test(near.zip));
  console.log(JSON.stringify({
    state, contests: ballots.reduce((sum, ballot) => sum + ballot.contests.length, 0), stateBallotBytes,
    edgeBytesRead: store.bytes, readMs: performance.now() - start, zipTableMs, nearestZipMs, nationalZipMs,
    peakBytes: process.resourceUsage().maxRSS * 1024, databaseReadBytes: 0, databaseWriteBytes: 0,
  } satisfies ReadMeasurement));
} else {
  const start = performance.now();
  const { outlineText, id, feature, point } = interior(state);
  const governments = readFileSync(`${directory}/${state}.jsonl`, "utf8").split("\n").filter(Boolean)
    .map(row => JSON.parse(row) as Government);
  const [lat, lng] = point;
  const records = governments.map((government, index) => ({
    government,
    officials: Array.from({ length: 10 }, (_, official) => ({
      id: `${government.id}:official:${official}`, ocdId: id, name: `Generated official ${official}`, state,
    })),
    meetings: Array.from({ length: 26 }, (_, meeting) => ({
      id: `${government.id}:meeting:${meeting}`, ocdId: id, bodyName: government.name,
      startsAt: new Date(Date.UTC(2026, 6, 1 + meeting * 7)).toISOString(), lat, lng,
    })),
    ballot: {
      contest: `${government.id}:board`,
      candidates: Array.from({ length: 10 }, (_, candidate) => ({
        id: `${government.id}:candidate:${candidate}`, name: `Generated candidate ${candidate}`,
      })),
      measure: "Generated benchmark text. ".repeat(40),
    }, index,
  }));
  let rows = 0;
  for (const record of records) {
    for (const meeting of record.meetings) {
      assert.equal(stateContainsPoint(feature, meeting.lat, meeting.lng), true);
      rows++;
    }
    rows += record.officials.length + record.ballot.candidates.length + 1;
  }
  const held = { result: records, forZip: "85701", stateOcdId: id };
  assert.equal(carryPins({ current: null, held, locationZip: "85701", stateOcdId: "other" }), null);
  assert.equal(carryPins({ current: null, held, locationZip: "85701", stateOcdId: id }), records);
  console.log(JSON.stringify({
    state, governments: governments.length, generatedRows: rows,
    generatedBytes: Buffer.byteLength(JSON.stringify(records)), sharedOutlineBytes: Buffer.byteLength(outlineText),
    peakBytes: process.resourceUsage().maxRSS * 1024, runtimeMs: performance.now() - start,
    databaseReadBytes: 0, databaseWriteBytes: 0,
  } satisfies Measurement));
}
