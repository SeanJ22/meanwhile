import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, createReadStream, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import { US_JURISDICTIONS } from "../lib/coverage/states.ts";
import { carryPins } from "../lib/map/carry-pins.ts";
import { outlineFor, stateContainsPoint, stateOcdIdAt, type StateOutlines } from "../lib/map/state-focus.ts";
import { csvRows } from "../lib/reference/csv.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const directory = process.env.WTP_STATE_CROSSING_SCALE_DIR ?? "/tmp/state-crossing-scale";
const state = process.argv[2];
type Government = { id: string; name: string; zip: string | null };
type Measurement = {
  state: string; governments: number; generatedRows: number; generatedBytes: number;
  sharedOutlineBytes: number; peakBytes: number; runtimeMs: number;
  databaseReadBytes: number; databaseWriteBytes: number; readerDatabaseMeasured: boolean;
};

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
    const child = spawnSync(process.execPath, ["--experimental-strip-types", import.meta.filename, code], {
      encoding: "utf8", maxBuffer: 2 ** 20,
    });
    assert.equal(child.status, 0, child.stderr);
    results.push(JSON.parse(child.stdout));
  }
  writeFileSync(`${directory}/results.json`, JSON.stringify({
    kind: "Map geography and carry-state benchmark; downstream readers and database not exercised",
    results,
  }, null, 2));
  console.log(JSON.stringify({
    states: results.length, governments: results.reduce((sum, row) => sum + row.governments, 0),
    largest: results.reduce((a, b) => a.generatedRows > b.generatedRows ? a : b),
    peakBytes: Math.max(...results.map(row => row.peakBytes)),
    runtimeMs: results.reduce((sum, row) => sum + row.runtimeMs, 0),
  }));
} else {
  const start = performance.now();
  const outlineText = readFileSync(`${root}/public/geo/state-outlines.geojson`, "utf8");
  const outlines = JSON.parse(outlineText) as StateOutlines;
  const identity = US_JURISDICTIONS.find(jurisdiction => jurisdiction.usps === state);
  assert.ok(identity, state);
  const id = `ocd-division/country:us/${identity.prefix}:${identity.slug}`;
  const feature = outlineFor(outlines, id);
  assert.ok(feature);
  const governments = readFileSync(`${directory}/${state}.jsonl`, "utf8").split("\n").filter(Boolean)
    .map(row => JSON.parse(row) as Government);
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
    databaseReadBytes: 0, databaseWriteBytes: 0, readerDatabaseMeasured: false,
  } satisfies Measurement));
}
