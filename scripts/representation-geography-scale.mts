import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, createReadStream, existsSync, readFileSync } from "node:fs";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { parseCsv } from "../lib/reference/csv.ts";
import { FIPS_TO_STATE } from "../lib/ocd/fips.ts";
import { ScopeAccumulator, parseTab20Header, resolveTab20Columns, type Tab20Spec } from "../lib/census-geography/build.ts";
import type { BuiltDataset, BuiltGrouping, BuiltOverlap, BuiltScope } from "../lib/census-geography/dataset.ts";
import type { GeographyGeometry, GeographyVersion } from "../lib/census-geography/contract.ts";
import { LocalFileArtifactStore } from "../lib/meetings/edge-store-local.ts";
import { contains, type GeoFeature } from "../lib/registry/resolve.ts";

const root = resolve(import.meta.dirname, "..");
const argument = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const directory = resolve(argument("dir") ?? join(root, ".runtime", "sl02-scale"));
const selected = new Set((argument("states") ?? Object.keys(FIPS_TO_STATE).join(",")).split(","));
const now = "2026-10-15T00:00:00.000Z";
const version = "representation-geography-scale";
const sources: readonly (Tab20Spec & { file: string; url: string })[] = [
  { type: "congressional_district", version: "cd:119", geoTag: "CD119_20", file: "cd119.txt", url: "https://www2.census.gov/geo/docs/maps-data/data/rel2020/cd-sld/tab20_cd11920_zcta520_natl.txt" },
  { type: "state_leg_upper", version: "sldu:2024", geoTag: "SLDU2024_20", file: "sldu2024.txt", url: "https://www2.census.gov/geo/docs/maps-data/data/rel2020/cd-sld/tab20_sldu202420_zcta520_natl.txt" },
  { type: "state_leg_lower", version: "sldl:2024", geoTag: "SLDL2024_20", file: "sldl2024.txt", url: "https://www2.census.gov/geo/docs/maps-data/data/rel2020/cd-sld/tab20_sldl202420_zcta520_natl.txt" },
];
interface Government {
  id: string; name: string; dependent: boolean; category: "census" | "state" | "territorial" | "tribal";
  areaIds?: readonly string[]; componentIds?: readonly string[];
}
interface ZipWork { zip: string; edges: number }
interface Workload { stateFips: string; state: string; governments: Government[]; zips: ZipWork[] }
interface WorkerResult {
  state: string; governments: number; dependentSchools: number; districts: number; zips: number; localEdges: number;
  censusGovernments: number; stateGovernments: number; territorialGovernments: number; tribalNations: number;
  aiannhAreas: number; aiannhComponents: number; polygons: number; pointRequests: number;
  peakRssBytes: number; runtimeMs: number; rawGeometryBytes: number; artifactBytesWritten: number;
  metadataBytesWritten: number;
  readerDatabaseBytes: number; pointArtifactBytes: number; largestPointArtifactBytes: number; largestPointArtifactReads: number;
  stateIndex: unknown;
}
interface ReaderResult { state: string; peakRssBytes: number; runtimeMs: number; artifactBytesRead: number; readKeys: string[]; polygons: number; databaseBytesRead: number; databaseBytesWritten: number }

function peakRssBytes(): number {
  return Number(/^VmHWM:\s+(\d+)/m.exec(readFileSync("/proc/self/status", "utf8"))?.[1] ?? 0) * 1024;
}

async function child<T>(task: string, stateFips: string): Promise<T> {
  const output = await new Promise<string>((accept, reject) => {
    const process = spawn(globalThis.process.execPath, [...globalThis.process.execArgv, import.meta.filename, `--${task}=${stateFips}`, `--dir=${directory}`], { cwd: root, env: globalThis.process.env, stdio: ["ignore", "pipe", "inherit"] });
    let stdout = "";
    process.stdout.on("data", chunk => { stdout += chunk; });
    process.once("error", reject);
    process.once("exit", code => code === 0 ? accept(stdout) : reject(new Error(`${stateFips} ${task} failed: ${code}`)));
  });
  return JSON.parse(output) as T;
}

async function* lines(file: string) {
  const input = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  try { for await (const line of input) yield line; } finally { input.close(); }
}

async function prepare() {
  await mkdir(join(directory, "work"), { recursive: true });
  for (const stateFips of selected) await writeFile(join(directory, "work", `${stateFips}.jsonl`), "");
  const government = (stateFips: string, value: Government) => {
    if (selected.has(stateFips)) appendFileSync(join(directory, "work", `${stateFips}.jsonl`), `${JSON.stringify({ government: value })}\n`);
  };
  for (const name of ["census_govt_units_2022.csv", "census_govt_units_2022_dependent_school_systems.csv"]) {
    let header: string[] | undefined;
    for await (const line of lines(join(root, "data", "reference", name))) {
      const row = parseCsv(line)[0];
      if (!header) { header = row; continue; }
      const stateFips = row[header.indexOf("fips_state")];
      government(stateFips, { id: row[header.indexOf("census_id_pid6")], name: row[header.indexOf("unit_name")],
        dependent: name.includes("dependent"), category: "census" });
    }
  }
  for (const stateFips of selected) {
    const held = JSON.parse(await readFile(join(root, "data", "derived", "registration", `${FIPS_TO_STATE[stateFips].postal.toLowerCase()}.json`), "utf8")) as { governments: string[][] };
    const states = held.governments.filter(row => row[3] === "STATE");
    assert.equal(states.length, 1, `${stateFips} statewide government`);
    government(stateFips, { id: states[0][0], name: states[0][2], dependent: false, category: "state" });
  }
  let territoryHeader: string[] | undefined;
  for await (const line of lines(join(root, "data", "reference", "census_tiger_2023_territory_functional_status.csv"))) {
    const row = parseCsv(line)[0];
    if (!territoryHeader) { territoryHeader = row; continue; }
    if (!["A", "B", "C", "G"].includes(row[territoryHeader.indexOf("funcstat")])) continue;
    government(row[territoryHeader.indexOf("statefp")], {
      id: `${row[territoryHeader.indexOf("layer")]}-${row[territoryHeader.indexOf("geoid")]}`,
      name: row[territoryHeader.indexOf("namelsad")], dependent: false, category: "territorial",
    });
  }
  const tribal = JSON.parse(await readFile(join(root, "data", "reference", "geography", "tribal-seat-areas.json"), "utf8")) as { stateFips: string; nation: string; aiannhAreaIds: string[] }[];
  for (const [index, nation] of tribal.entries()) government(nation.stateFips, { id: `tribal-${index}`, name: nation.nation,
    dependent: false, category: "tribal", areaIds: [...new Set(nation.aiannhAreaIds.map(id => id.slice(0, 4)))], componentIds: nation.aiannhAreaIds });
  const index = JSON.parse(await readFile(join(root, "data", "derived", "zip-divisions", "index.json"), "utf8"));
  let uniqueZips = 0;
  for (const shard of Object.keys(index.shards)) {
    const held = JSON.parse(await readFile(join(root, "data", "derived", "zip-divisions", `${shard}.json`), "utf8")) as { divisions: string[]; zips: Record<string, number[]> };
    for (const [zip, rows] of Object.entries(held.zips)) {
      uniqueZips++;
      const counts = new Map<string, number>();
      for (const id of rows) {
        const postal = /\/(?:state|district|territory):([^/]+)/.exec(held.divisions[id])?.[1].toUpperCase();
        if (postal) counts.set(postal, (counts.get(postal) ?? 0) + 1);
      }
      for (const [postal, edges] of counts) {
        const fips = Object.keys(FIPS_TO_STATE).find(key => FIPS_TO_STATE[key].postal === postal)!;
        if (selected.has(fips)) appendFileSync(join(directory, "work", `${fips}.jsonl`), `${JSON.stringify({ zip: { zip, edges } })}\n`);
      }
    }
  }
  const sourceEvidence = [];
  await mkdir(join(directory, "sources"), { recursive: true });
  for (const source of sources) {
    const target = join(directory, "sources", source.file);
    if (!existsSync(target)) {
      const response = await fetch(source.url, { signal: AbortSignal.timeout(60_000) });
      assert.ok(response.ok && response.body, `Source unavailable: ${source.url}: ${response.status}`);
      await writeFile(target, "");
      for await (const chunk of Readable.fromWeb(response.body as import("node:stream/web").ReadableStream)) await appendFile(target, chunk);
    }
    const digest = createHash("sha256");
    let bytes = 0;
    for await (const chunk of createReadStream(target)) { digest.update(chunk); bytes += chunk.byteLength; }
    sourceEvidence.push({ url: source.url, bytes, sha256: digest.digest("hex") });
  }
  return { uniqueZips, sourceEvidence };
}

async function loadWorkload(stateFips: string): Promise<Workload> {
  const result: Workload = { stateFips, state: FIPS_TO_STATE[stateFips].postal, governments: [], zips: [] };
  for await (const line of lines(join(directory, "work", `${stateFips}.jsonl`))) {
    const record = JSON.parse(line) as { government?: Government; zip?: ZipWork };
    if (record.government) result.governments.push(record.government);
    if (record.zip) result.zips.push(record.zip);
  }
  return result;
}

function metadata(type: BuiltScope["type"], key: string, stateFips: string): GeographyVersion {
  return { key, type, plan: "Generated national-volume workload", stateFips, states: [FIPS_TO_STATE[stateFips].postal],
    zctaTabulation: "2020", effectiveFor: "Scale measurement", retrievalComplete: true,
    provenance: { sourceUrls: sources.map(source => source.url), sourceFiles: sources.map(source => source.file),
      sourceChecksums: sources.map(() => "0".repeat(64)), sourceDataset: "GENERATED_BOUNDARIES_REAL_NATIONAL_CARDINALITIES",
      method: "Real Census district/ZIP relationships and government counts; synthetic polygons from the single retained state fixture.", computedAt: now } };
}

function templates(): GeographyGeometry[] {
  return (JSON.parse(readFileSync(join(root, "tests", "fixtures", "geography", "overlay", "floterials.geojson"), "utf8")) as { features: { geometry: GeographyGeometry }[] }).features.map(feature => feature.geometry);
}

function sourcePoint(geometry: GeographyGeometry): [number, number] {
  const coordinates = geometry.type === "Polygon" ? geometry.coordinates.flat() : geometry.coordinates.flat(2);
  const xs = coordinates.map(point => point[0]), ys = coordinates.map(point => point[1]);
  const west = Math.min(...xs), south = Math.min(...ys), width = Math.max(...xs) - west, height = Math.max(...ys) - south;
  for (let y = 1; y < 20; y++) for (let x = 1; x < 20; x++) {
    const point: [number, number] = [west + width * x / 20, south + height * y / 20];
    if (contains(point, { geometry } as GeoFeature)) return point;
  }
  throw new Error("No interior fixture point");
}

function geometryAt(template: GeographyGeometry, origin: [number, number], index: number): { geometry: GeographyGeometry; point: [number, number] } {
  const point: [number, number] = [-72 + index % 100 * 0.02, 42 + Math.floor(index / 100) * 0.02];
  const ring = (value: number[][]) => value.map(([x, y]) => [point[0] + (x - origin[0]) * 0.01, point[1] + (y - origin[1]) * 0.01]);
  return { point, geometry: template.type === "Polygon" ? { type: "Polygon", coordinates: template.coordinates.map(ring) }
    : { type: "MultiPolygon", coordinates: template.coordinates.map(polygon => polygon.map(ring)) } };
}

async function worker(stateFips: string): Promise<WorkerResult> {
  const started = performance.now();
  const { publishScopeBoundaries, hydrateBoundaryGeometries } = await import("../lib/census-geography/boundary-artifacts.ts");
  const { buildCensusDistrictEdge, createCensusDistrictReaderEdge } = await import("../lib/census-geography/district-edge.ts");
  const workload = await loadWorkload(stateFips);
  const originals = templates(), origins = originals.map(sourcePoint);
  const store = new LocalFileArtifactStore(join(directory, "artifacts"));
  let artifactBytesWritten = 0, artifactBytesRead = 0, artifactReads = 0;
  const put = store.putImmutable.bind(store), get = store.readBytes.bind(store);
  store.putImmutable = async (bytes, suffix) => {
    const key = `reader/artifacts/${createHash("sha256").update(bytes).digest("hex")}.${suffix}`;
    if (!existsSync(join(directory, "artifacts", key))) artifactBytesWritten += bytes.byteLength;
    return put(bytes, suffix);
  };
  store.readBytes = async key => { const bytes = await get(key); artifactBytesRead += bytes?.byteLength ?? 0; artifactReads++; return bytes; };
  let ordinal = 0, rawGeometryBytes = 0, districts = 0;
  const points: [number, number][] = [];
  const jobs: { name: string; type: "overlay_district" | "aiannh"; targets: { geoid: string; point: [number, number] }[] }[] = [];
  const grouping = (identity: Omit<BuiltGrouping, "geometry">): BuiltGrouping => {
    const generated = geometryAt(originals[ordinal % originals.length], origins[ordinal % origins.length], ordinal++);
    points.push(generated.point);
    rawGeometryBytes += Buffer.byteLength(JSON.stringify(generated.geometry));
    return { ...identity, geometry: generated.geometry };
  };
  const governments = workload.governments;
  assert.ok(governments.length > 0);
  const boundaries = governments.filter(government => government.category !== "tribal");
  const overlaps: BuiltOverlap[][] = Array.from({ length: boundaries.length }, () => []);
  for (const [zipIndex, zip] of workload.zips.entries()) for (let edge = 0; edge < zip.edges; edge++) {
    overlaps[(zipIndex + edge) % boundaries.length].push({ zcta5: zip.zip, whole: true, fraction: 1 });
  }
  const governmentGroups = boundaries.map((government, index) => {
    const group = grouping({ geoid: `${stateFips}G${government.id}`, ocdId: null,
      label: government.name, stateFips, stateAbbr: workload.state, memberStates: [workload.state], chamber: "lower", representation: "overlay", overlaps: overlaps[index] });
    jobs.push({ name: government.name, type: "overlay_district", targets: [{ geoid: group.geoid, point: points.at(-1)! }] });
    return group;
  });
  const scopes: BuiltScope[] = [{ type: "overlay_district", version: "overlay:scale", versionMeta: metadata("overlay_district", "overlay:scale", stateFips),
    fractionBasis: "area", groupings: governmentGroups, instanceCount: governmentGroups.length,
    zctaEdgeCount: governmentGroups.reduce((sum, group) => sum + group.overlaps.length, 0) }];
  const areaGroups: BuiltGrouping[] = [];
  for (const nation of governments.filter(government => government.category === "tribal")) {
    const targets: { geoid: string; point: [number, number] }[] = [];
    for (const geoid of nation.areaIds ?? []) {
      assert.ok(!areaGroups.some(group => group.geoid === geoid));
      const zip = workload.zips[areaGroups.length % workload.zips.length];
      assert.ok(zip);
      const group = grouping({ geoid, ocdId: null, label: nation.name, stateFips, stateAbbr: workload.state, memberStates: [workload.state],
        chamber: "lower", representation: "tribal", overlaps: [{ zcta5: zip.zip, whole: true, fraction: 1 }] });
      areaGroups.push(group);
      targets.push({ geoid, point: points.at(-1)! });
    }
    jobs.push({ name: nation.name, type: "aiannh", targets });
  }
  assert.equal(jobs.length, governments.length);
  const aiannhAreas = areaGroups.length;
  if (aiannhAreas) scopes.push({ type: "aiannh", version: "aiannh:2020", versionMeta: metadata("aiannh", "aiannh:2020", stateFips),
    fractionBasis: "area", groupings: areaGroups, instanceCount: aiannhAreas, zctaEdgeCount: aiannhAreas });
  for (const source of sources) {
    let accumulator: ScopeAccumulator | undefined;
    let column = 0;
    for await (const line of lines(join(directory, "sources", source.file))) {
      if (!accumulator) {
        const columns = resolveTab20Columns(parseTab20Header(line), source.geoTag);
        column = columns.geoGeoid;
        accumulator = new ScopeAccumulator(source, columns);
      } else {
        const row = line.split("|");
        if (row[column]?.startsWith(stateFips)) accumulator.add(row);
      }
    }
    assert.ok(accumulator);
    const scope = accumulator.finish(metadata(source.type, source.version, stateFips));
    if (!scope.groupings.length) continue;
    districts += scope.groupings.length * 2;
    scopes.push({ ...scope, groupings: scope.groupings.map(grouping) });
    const successor = source.type === "congressional_district" ? "cd:120" : source.version.replace("2024", "2026");
    scopes.push({ ...scope, version: successor, versionMeta: metadata(source.type, successor, stateFips), groupings: scope.groupings.map(grouping) });
  }
  const dataset: BuiltDataset = { formatVersion: 1, builtAt: now, coverage: `${workload.state} generated polygon volume`, scopes: [], zctaUniverse: workload.zips.map(zip => zip.zip) };
  const published: BuiltScope[] = [];
  for (const scope of scopes) published.push(await publishScopeBoundaries(scope, store));
  scopes.length = 0;
  governmentGroups.length = 0;
  areaGroups.length = 0;
  const clean = { ...dataset, scopes: published };
  const metadataBytesWritten = Buffer.byteLength(JSON.stringify(clean));
  assert.ok(!JSON.stringify(clean).includes('"coordinates"'), "database metadata must contain no polygons");
  await writeFile(join(directory, "work", `${stateFips}-dataset.json`), JSON.stringify(clean));
  const index = await buildCensusDistrictEdge(clean, version, store);
  const edge = createCensusDistrictReaderEdge(index, store);
  const slice = await edge.loadState(workload.state);
  assert.equal(slice.kind, "HELD");
  if (slice.kind !== "HELD") throw new Error("State publication unread");
  assert.equal(slice.value.containers.length, published.reduce((sum, scope) => sum + scope.groupings.length, 0));
  let largestPointArtifactBytes = 0, largestPointArtifactReads = 0;
  artifactBytesRead = 0;
  for (const job of jobs) for (const { geoid, point } of job.targets) {
    const before = artifactBytesRead, reads = artifactReads;
    const local = await hydrateBoundaryGeometries(slice.value, "accurate", store, { points: [point] });
    const hits = local.containers.filter(container => container.ref.geometry && contains(point, { geometry: container.ref.geometry } as GeoFeature));
    assert.ok(hits.some(hit => hit.ref.geoid === geoid && hit.ref.type === job.type && (job.type !== "aiannh" || hit.ref.representation === "tribal")), `${workload.state} ${job.name} point`);
    assert.ok(local.containers.filter(container => container.ref.geometry).length <= originals.length, "a place must not hydrate the state");
    largestPointArtifactBytes = Math.max(largestPointArtifactBytes, artifactBytesRead - before);
    largestPointArtifactReads = Math.max(largestPointArtifactReads, artifactReads - reads);
  }
  const pointArtifactBytes = artifactBytesRead;
  for (const zip of workload.zips) assert.equal((await edge.loadZip(zip.zip)).kind, "HELD");
  return { state: workload.state, governments: workload.governments.filter(government => !government.dependent).length,
    dependentSchools: workload.governments.filter(government => government.dependent).length,
    censusGovernments: governments.filter(government => government.category === "census" && !government.dependent).length,
    stateGovernments: governments.filter(government => government.category === "state").length,
    territorialGovernments: governments.filter(government => government.category === "territorial").length,
    tribalNations: governments.filter(government => government.category === "tribal").length,
    aiannhAreas, aiannhComponents: governments.reduce((sum, government) => sum + (government.componentIds?.length ?? 0), 0),
    polygons: ordinal, pointRequests: jobs.reduce((sum, job) => sum + job.targets.length, 0),
    districts, zips: workload.zips.length, localEdges: workload.zips.reduce((sum, zip) => sum + zip.edges, 0),
    peakRssBytes: peakRssBytes(), runtimeMs: performance.now() - started, rawGeometryBytes, artifactBytesWritten,
    metadataBytesWritten, readerDatabaseBytes: 0, pointArtifactBytes,
    largestPointArtifactBytes, largestPointArtifactReads, stateIndex: index };
}

async function reader(stateFips: string, national = false): Promise<ReaderResult> {
  const started = performance.now();
  const { hydrateBoundaryGeometries } = await import("../lib/census-geography/boundary-artifacts.ts");
  const { createCensusDistrictReaderEdge } = await import("../lib/census-geography/district-edge.ts");
  const state = FIPS_TO_STATE[stateFips].postal;
  const single = JSON.parse(await readFile(join(directory, "work", `${stateFips}-result.json`), "utf8")) as WorkerResult;
  const index = national ? JSON.parse(await readFile(join(directory, "catalog.json"), "utf8")) : single.stateIndex;
  const store = new LocalFileArtifactStore(join(directory, "artifacts"));
  const read = store.readBytes.bind(store), readKeys: string[] = [];
  let artifactBytesRead = 0;
  store.readBytes = async key => { const bytes = await read(key); readKeys.push(key); artifactBytesRead += bytes?.byteLength ?? 0; return bytes; };
  const slice = await createCensusDistrictReaderEdge(index, store).loadState(state);
  assert.equal(slice.kind, "HELD");
  if (slice.kind !== "HELD") throw new Error("Cold state lookup unread");
  const point: [number, number] = [-72, 42];
  const accurate = await hydrateBoundaryGeometries(slice.value, "accurate", store, { points: [point] });
  const polygons = accurate.containers.filter(container => container.ref.geometry);
  assert.ok(polygons.length > 0 && polygons.length <= 3);
  assert.ok(polygons.some(container => contains(point, { geometry: container.ref.geometry } as GeoFeature)));
  const display = await hydrateBoundaryGeometries(slice.value, "display", store, { bounds: [point[0] - 0.001, point[1] - 0.001, point[0] + 0.001, point[1] + 0.001] });
  assert.ok(display.containers.filter(container => container.ref.geometry).length <= 3);
  return { state, peakRssBytes: peakRssBytes(), runtimeMs: performance.now() - started,
    artifactBytesRead, readKeys, polygons: polygons.length, databaseBytesRead: 0, databaseBytesWritten: 0 };
}

async function main() {
  const started = performance.now();
  const previous = argument("reuse-boundaries") ? JSON.parse(await readFile(join(directory, "report.json"), "utf8")) : null;
  const input = await prepare();
  const workers: WorkerResult[] = [];
  const readers: ReaderResult[] = [];
  for (const stateFips of selected) {
    const result = previous ? JSON.parse(await readFile(join(directory, "work", `${stateFips}-result.json`), "utf8")) as WorkerResult
      : await child<WorkerResult>("worker", stateFips);
    workers.push(result);
    await writeFile(join(directory, "work", `${stateFips}-result.json`), JSON.stringify(result));
    if (!previous) readers.push(await child<ReaderResult>("reader", stateFips));
    process.stdout.write(`${result.state}: ${result.governments + result.dependentSchools} governments, ${result.districts} districts, ${Math.ceil(result.peakRssBytes / 1024 ** 2)} MiB peak\n`);
  }
  const peak = Math.max(...workers.map(worker => worker.peakRssBytes));
  const total = (key: keyof WorkerResult) => workers.reduce((sum, worker) => sum + Number(worker[key]), 0);
  const { buildCensusDistrictEdge, publishCensusDistrictStates, createCensusDistrictReaderEdge } = await import("../lib/census-geography/district-edge.ts");
  async function* stateDatasets() {
    for (const stateFips of selected) {
      const dataset = JSON.parse(await readFile(join(directory, "work", `${stateFips}-dataset.json`), "utf8")) as BuiltDataset;
      yield { state: FIPS_TO_STATE[stateFips].postal, dataset: { ...dataset, scopes: dataset.scopes.filter(scope => scope.instanceCount > 0) } };
    }
  }
  const store = new LocalFileArtifactStore(join(directory, "artifacts"));
  let catalogArtifactBytes = 0;
  const put = store.putImmutable.bind(store);
  store.putImmutable = async (bytes, suffix) => {
    const key = `reader/artifacts/${createHash("sha256").update(bytes).digest("hex")}.${suffix}`;
    if (!existsSync(join(directory, "artifacts", key))) catalogArtifactBytes += bytes.byteLength;
    return put(bytes, suffix);
  };
  const national = await publishCensusDistrictStates(stateDatasets(), version, store);
  await writeFile(join(directory, "catalog.json"), JSON.stringify(national));
  assert.equal(Object.keys(national.states).length, selected.size);
  const coordinatorPeakRssBytes = peakRssBytes();
  assert.ok(!JSON.stringify(national).includes('"coordinates"'));
  if (previous) {
    for await (const input of stateDatasets()) {
      const worker = workers.find(worker => worker.state === input.state)!;
      worker.stateIndex = await buildCensusDistrictEdge(input.dataset, version, store);
      const fips = [...selected].find(fips => FIPS_TO_STATE[fips].postal === input.state)!;
      await writeFile(join(directory, "work", `${fips}-result.json`), JSON.stringify(worker));
      readers.push(await child<ReaderResult>("reader", fips));
    }
  }
  const largest = [...workers].sort((a, b) => b.governments + b.dependentSchools - a.governments - a.dependentSchools)[0];
  const requested = [...selected].find(fips => FIPS_TO_STATE[fips].postal === largest.state)!, state = largest.state;
  const oneState = (await readFile(join(directory, "work", `${requested}-result.json`), "utf8"));
  const oneIndex = (JSON.parse(oneState) as WorkerResult).stateIndex as typeof national;
  let readKeys: string[] = [];
  const read = store.readBytes.bind(store);
  store.readBytes = async key => { readKeys.push(key); return read(key); };
  const single = await createCensusDistrictReaderEdge(oneIndex, store).loadState(state);
  const onePlaceKeys = [...readKeys];
  readKeys = [];
  const nationalPlace = await createCensusDistrictReaderEdge(national, store).loadState(state);
  assert.deepEqual(nationalPlace, single, "a place must not change when the rest of the country is added");
  assert.deepEqual(readKeys, onePlaceKeys, "country growth must not add artifact reads to a place");
  const nationalReader = await child<ReaderResult>("national-reader", requested);
  const oneReader = readers.find(reader => reader.state === state)!;
  assert.deepEqual(nationalReader.readKeys, oneReader.readKeys, "cold place must read the same keys under a national catalog");
  assert.equal(nationalReader.artifactBytesRead, oneReader.artifactBytesRead, "cold place transfer must be independent of country size");
  const database = await child<Awaited<ReturnType<typeof import("./lib/representation-scale-database.mts").measureCensusPromotion>> & { peakRssBytes: number }>("database", "1");
  const databaseBytesRead = database.firstRun.bytesRead, databaseBytesWritten = database.firstRun.bytesWritten;
  const report = { measuredAt: new Date().toISOString(), runtimeMs: performance.now() - started, coordinatorPeakRssBytes,
    ...(previous ? { boundaryRunRuntimeMs: previous.boundaryRunRuntimeMs ?? previous.runtimeMs } : {}),
    localDatabaseMeasurementPeakRssBytes: database.peakRssBytes, database,
    nationalInputs: { sourceEvidence: input.sourceEvidence, uniqueZips: input.uniqueZips, jurisdictions: workers.length,
      governments: total("governments"), censusGovernments: total("censusGovernments"), stateGovernments: total("stateGovernments"),
      territorialGovernments: total("territorialGovernments"), tribalNations: total("tribalNations"), dependentSchools: total("dependentSchools"),
      aiannhAreas: total("aiannhAreas"), aiannhComponents: total("aiannhComponents"), polygons: total("polygons"), pointRequests: total("pointRequests"),
      localEdges: total("localEdges"), districts: total("districts") },
    databaseMeasurement: database.method,
    geometryMeasurement: "Synthetic polygons from three retained real floterials for Census governments, all statewide and governing territorial identities, and five typed AIANNH areas for three nations; real 2024/119th district identities and ZIP memberships duplicated for 2026/120th plans.",
    countryGrowthCheck: { requestedState: state, catalogStates: Object.keys(national.states).length, localArtifactReads: onePlaceKeys.length, identicalReadKeys: true },
    perRun: { databaseBytesRead, databaseBytesWritten, artifactBytesWritten: total("artifactBytesWritten") + catalogArtifactBytes, rawGeometryBytes: total("rawGeometryBytes") },
    perDayAtMonthlyCadence: { databaseBytesRead: databaseBytesRead / 30, databaseBytesWritten: databaseBytesWritten / 30, artifactBytesWritten: (total("artifactBytesWritten") + catalogArtifactBytes) / 30 },
    peakWorkerRssBytes: peak, peakReaderRssBytes: Math.max(...readers.map(reader => reader.peakRssBytes)), productionHostBytes: 8 * 1024 ** 3, marginBytes: 768 * 1024 ** 2,
    copiesAtMargin: Math.floor((8 * 1024 ** 3 - 768 * 1024 ** 2 - coordinatorPeakRssBytes) / peak),
    copiesWithResearchParent: Math.floor((8 * 1024 ** 3 - (768 + 2928) * 1024 ** 2 - coordinatorPeakRssBytes) / peak),
    configuredCensusReservationBytes: 1258 * 1024 ** 2,
    admissionsAtConfiguredReservation: Math.floor((8 * 1024 ** 3 - 768 * 1024 ** 2 - coordinatorPeakRssBytes) / (1258 * 1024 ** 2)),
    limitations: ["Full national real-source boundary geometry was not tested; polygon complexity is bounded to the largest retained real fixture. SQL ran locally through the real Neon HTTP driver; production network latency and physical storage I/O were not measured."], workers, readers, nationalReader };
  await writeFile(join(directory, "report.json"), JSON.stringify(report, null, 2));
  process.stdout.write(`${JSON.stringify({ ...report, workers: undefined, readers: undefined })}\n`);
}

if (argument("database")) {
  const { measureCensusPromotion } = await import("./lib/representation-scale-database.mts");
  const result = await measureCensusPromotion(JSON.parse(await readFile(join(directory, "catalog.json"), "utf8")));
  process.stdout.write(`${JSON.stringify({ ...result, peakRssBytes: peakRssBytes() })}\n`);
} else if (argument("national-reader")) process.stdout.write(`${JSON.stringify(await reader(argument("national-reader")!, true))}\n`);
else if (argument("reader")) process.stdout.write(`${JSON.stringify(await reader(argument("reader")!))}\n`);
else if (argument("worker")) process.stdout.write(`${JSON.stringify(await worker(argument("worker")!))}\n`);
else await main();
