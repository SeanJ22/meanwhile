import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, createReadStream, existsSync, readFileSync } from "node:fs";
import { appendFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { parseCsv } from "../lib/reference/csv.ts";
import { FIPS_TO_STATE } from "../lib/ocd/fips.ts";
import type { Tab20Spec } from "../lib/census-geography/build.ts";
import type { BuiltDataset, BuiltGrouping, BuiltOverlap, BuiltScope } from "../lib/census-geography/dataset.ts";
import type { GeographyGeometry, GeographyVersion } from "../lib/census-geography/contract.ts";
import { LocalFileArtifactStore } from "../lib/meetings/edge-store-local.ts";
import { contains, type GeoFeature } from "../lib/registry/resolve.ts";
import type { DatabaseMeasurement } from "./lib/representation-scale-database.mts";
import type { EvidenceStore, ObjectMeta } from "../lib/control-plane/evidence/store.ts";

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
interface PreparationResult {
  uniqueZips: number; sourceEvidence: { url: string; bytes: number; sha256: string }[]; largestState: string;
  peakRssBytes: number; runtimeMs: number; largestSourceUnit: { state: string; bytes: number; districts: number; edges: number };
}
interface WorkerResult {
  state: string; governments: number; dependentSchools: number; districts: number; zips: number; localEdges: number;
  censusGovernments: number; stateGovernments: number; territorialGovernments: number; tribalNations: number;
  aiannhAreas: number; aiannhComponents: number; polygons: number; pointRequests: number;
  peakRssBytes: number; runtimeMs: number; vertices: number; artifactBytesWritten: number;
  baselineRssBytes: number; sourcePeakRssBytes: number; publicationPeakRssBytes: number; sourceMetadataBytes: number;
  database: Omit<DatabaseMeasurement, "index">;
  readerDatabaseBytes: number; pointArtifactBytes: number; largestPointArtifactBytes: number; largestPointArtifactReads: number;
}
interface ReaderResult { state: string; peakRssBytes: number; runtimeMs: number; artifactBytesRead: number; readKeys: string[]; polygons: number; databaseBytesRead: number; databaseBytesWritten: number }
type StateReadResult = Awaited<ReturnType<typeof import("./lib/representation-scale-database.mts").measureCensusStateIndex>>;
type CompletionMeasurement = Awaited<ReturnType<typeof import("./lib/representation-scale-database.mts").measureCensusCompletion>>;

function peakRssBytes(): number {
  return Number(/^VmHWM:\s+(\d+)/m.exec(readFileSync("/proc/self/status", "utf8"))?.[1] ?? 0) * 1024;
}

async function child<T>(task: string, stateFips: string): Promise<T> {
  const output = await new Promise<string>((accept, reject) => {
    const endpoint = argument("database-endpoint");
    const process = spawn(globalThis.process.execPath, [...globalThis.process.execArgv, import.meta.filename, `--${task}=${stateFips}`, `--dir=${directory}`,
      `--states=${[...selected].join(",")}`,
      ...(endpoint ? [`--database-endpoint=${endpoint}`] : [])], { cwd: root, env: { ...globalThis.process.env,
        DATABASE_URL: "postgresql://scale:scale@ep-scale-fixture.us-east-2.aws.neon.tech/neondb" }, stdio: ["ignore", "pipe", "inherit"] });
    let stdout = "";
    process.stdout.on("data", chunk => { stdout += chunk; });
    process.once("error", reject);
    process.once("exit", code => code === 0 ? accept(stdout) : reject(new Error(`${stateFips} ${task} failed: ${code}`)));
  });
  return JSON.parse(output.trim().split(/\r?\n/).at(-1)!) as T;
}

async function databaseServer() {
  const server = spawn(process.execPath, [...process.execArgv, import.meta.filename, "--database-server=1", `--dir=${directory}`], {
    cwd: root, env: process.env, stdio: ["ignore", "pipe", "inherit"],
  });
  const exited = new Promise<void>((accept, reject) => {
    server.once("error", reject);
    server.once("exit", code => code === 0 ? accept() : reject(new Error(`Database engine failed: ${code}`)));
  });
  const { endpoint, method } = await new Promise<{ endpoint: string; method: string }>((accept, reject) => {
    let output = "";
    server.stdout.on("data", chunk => {
      output += chunk;
      if (output.includes("\n")) accept(JSON.parse(output.split("\n")[0]) as { endpoint: string; method: string });
    });
    server.once("error", reject);
    server.once("exit", code => reject(new Error(`Database engine stopped before startup: ${code}`)));
  });
  process.argv.push(`--database-endpoint=${endpoint}`);
  return { endpoint, method, async close() {
    const response = await fetch(`${endpoint}/close`, { method: "POST" });
    assert.ok(response.ok);
    const metrics = await response.json() as { peakRssBytes: number; bytesRead: number; bytesWritten: number; requests: number; statements: number };
    await exited;
    return metrics;
  } };
}

async function* lines(file: string) {
  const input = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  try { for await (const line of input) yield line; } finally { input.close(); }
}

async function prepare(): Promise<PreparationResult> {
  const started = performance.now();
  await mkdir(join(directory, "work"), { recursive: true });
  for (const stateFips of selected) await writeFile(join(directory, "work", `${stateFips}.jsonl`), "");
  const governmentCounts: Record<string, number> = {};
  const government = (stateFips: string, value: Government) => {
    if (selected.has(stateFips)) {
      governmentCounts[stateFips] = (governmentCounts[stateFips] ?? 0) + 1;
      appendFileSync(join(directory, "work", `${stateFips}.jsonl`), `${JSON.stringify({ government: value })}\n`);
    }
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
  const { acquireStatePublications } = await import("../lib/census-geography/acquire.ts");
  const { createMemoryRepositories } = await import("../lib/control-plane/repository/memory.ts");
  const vault = join(directory, "source-vault");
  await mkdir(vault, { recursive: true });
  const sourceKeys = new Map<string, { path: string; meta: ObjectMeta }>();
  const store: EvidenceStore = {
    async put(key, bytes, meta) {
      const path = join(vault, createHash("sha256").update(key).digest("hex"));
      await writeFile(path, bytes);
      sourceKeys.set(key, { path, meta });
    },
    async get(key) {
      const held = sourceKeys.get(key);
      return held ? { key, bytes: await readFile(held.path), meta: held.meta } : null;
    },
    async head(key) { return sourceKeys.get(key)?.meta ?? null; },
    async list(prefix) { return [...sourceKeys.keys()].filter(key => key.startsWith(prefix)).sort(); },
  };
  const fetchImpl = (async (input, init) => {
    assert.notEqual(init?.method, "HEAD");
    const source = sources.find(source => source.url === String(input));
    assert.ok(source, `Unexpected source ${String(input)}`);
    const path = join(directory, "sources", source.file);
    return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream, {
      headers: { "content-type": "text/plain", "content-length": String((await stat(path)).size), etag: '"real-national-source"' },
    });
  }) as typeof fetch;
  let largestSourceUnit = { state: "", bytes: 0, districts: 0, edges: 0 };
  await acquireStatePublications({ only: ["cd119", "sldu", "sldl"], discoverPlans: false, states: selected,
    fetchImpl, cache: { store, locks: createMemoryRepositories().locks } }, async ({ state, dataset }) => {
    const fips = [...selected].find(fips => FIPS_TO_STATE[fips].postal === state);
    assert.ok(fips);
    const encoded = JSON.stringify(dataset), bytes = Buffer.byteLength(encoded);
    if (bytes > largestSourceUnit.bytes) largestSourceUnit = { state, bytes,
      districts: dataset.scopes.reduce((sum, scope) => sum + scope.instanceCount, 0),
      edges: dataset.scopes.reduce((sum, scope) => sum + scope.zctaEdgeCount, 0) };
    await writeFile(join(directory, "work", `${fips}-source.json`), encoded);
  }, async (_state, error) => { throw error; });
  return { uniqueZips, sourceEvidence, largestState: Object.keys(governmentCounts).sort((a, b) => governmentCounts[b] - governmentCounts[a])[0],
    peakRssBytes: peakRssBytes(), runtimeMs: performance.now() - started, largestSourceUnit };
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
  const { hydrateBoundaryGeometries } = await import("../lib/census-geography/boundary-artifacts.ts");
  const { createCensusDistrictReaderEdge } = await import("../lib/census-geography/district-edge.ts");
  const { promoteCensusState } = await import("../lib/census-geography/state-publication.ts");
  const { measureCensusPromotion } = await import("./lib/representation-scale-database.mts");
  const endpoint = argument("database-endpoint");
  assert.ok(endpoint);
  const baselineRssBytes = process.memoryUsage().rss;
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
  let ordinal = 0, vertices = 0, districts = 0;
  const points: [number, number][] = [];
  const jobs: { name: string; type: "overlay_district" | "aiannh"; targets: { geoid: string; point: [number, number] }[] }[] = [];
  const grouping = (identity: Omit<BuiltGrouping, "geometry">): BuiltGrouping => {
    const generated = geometryAt(originals[ordinal % originals.length], origins[ordinal % origins.length], ordinal++);
    points.push(generated.point);
    const polygons = generated.geometry.type === "Polygon" ? [generated.geometry.coordinates] : generated.geometry.coordinates;
    for (const polygon of polygons) for (const ring of polygon) vertices += ring.length;
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
  const native = JSON.parse(await readFile(join(directory, "work", `${stateFips}-source.json`), "utf8")) as BuiltDataset;
  for (const scope of native.scopes) {
    if (!scope.groupings.length) continue;
    districts += scope.groupings.length * 2;
    scopes.push({ ...scope, groupings: scope.groupings.map(grouping) });
    const successor = scope.type === "congressional_district" ? "cd:120" : scope.version.replace("2024", "2026");
    scopes.push({ ...scope, version: successor, versionMeta: metadata(scope.type, successor, stateFips), groupings: scope.groupings.map(grouping) });
  }
  const dataset: BuiltDataset = { formatVersion: 1, builtAt: now, coverage: `${workload.state} generated polygon volume`, scopes, zctaUniverse: workload.zips.map(zip => zip.zip) };
  const sourcePeakRssBytes = peakRssBytes();
  const measured = await measureCensusPromotion(endpoint, routineStore => promoteCensusState({ state: workload.state, dataset, sourceVersion: version }, {
    store: routineStore, artifactStore: store, now,
  }));
  const publicationPeakRssBytes = peakRssBytes();
  for (const scope of scopes) assert.ok(scope.groupings.every(group => !group.geometry), "publication must consume the owned source geometry");
  scopes.length = 0;
  governmentGroups.length = 0;
  areaGroups.length = 0;
  const { index, ...database } = measured;
  assert.deepEqual(Object.keys(index.states), [workload.state]);
  await writeFile(join(directory, "work", `${stateFips}-index.json`), JSON.stringify(index));
  const edge = createCensusDistrictReaderEdge(index, store);
  const slice = await edge.loadState(workload.state);
  assert.equal(slice.kind, "HELD");
  if (slice.kind !== "HELD") throw new Error("State publication unread");
  assert.equal(slice.value.containers.length, ordinal);
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
    peakRssBytes: peakRssBytes(), runtimeMs: performance.now() - started, vertices, artifactBytesWritten,
    baselineRssBytes, sourcePeakRssBytes, publicationPeakRssBytes,
    sourceMetadataBytes: (await stat(join(directory, "work", `${stateFips}-source.json`))).size,
    database, readerDatabaseBytes: 0, pointArtifactBytes,
    largestPointArtifactBytes, largestPointArtifactReads };
}

async function reader(stateFips: string): Promise<ReaderResult> {
  const started = performance.now();
  const { hydrateBoundaryGeometries } = await import("../lib/census-geography/boundary-artifacts.ts");
  const { createCensusDistrictReaderEdge } = await import("../lib/census-geography/district-edge.ts");
  const state = FIPS_TO_STATE[stateFips].postal;
  const index = JSON.parse(await readFile(join(directory, "work", `${stateFips}-index.json`), "utf8"));
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
  const input = await child<PreparationResult>("prepare", "1");
  const database = await databaseServer();
  const workers: WorkerResult[] = [], readers: ReaderResult[] = [];
  let nationalReader: ReaderResult;
  let firstStateRead: StateReadResult | undefined, nationalStateRead: StateReadResult;
  let completion: CompletionMeasurement;
  let databaseTotals: Awaited<ReturnType<typeof database.close>>;
  try {
    for (const stateFips of [input.largestState, ...[...selected].filter(state => state !== input.largestState)]) {
      const result = await child<WorkerResult>("worker", stateFips);
      workers.push(result);
      await writeFile(join(directory, "work", `${stateFips}-result.json`), JSON.stringify(result));
      readers.push(await child<ReaderResult>("reader", stateFips));
      if (!firstStateRead) firstStateRead = await child<StateReadResult>("database-read", stateFips);
      process.stdout.write(`${result.state}: ${result.governments + result.dependentSchools} jobs, ${result.districts} districts, ${Math.ceil(result.peakRssBytes / 1024 ** 2)} MiB peak, promoted before next state\n`);
    }
    completion = await child<CompletionMeasurement>("completion", String(workers.length));
    nationalReader = await child<ReaderResult>("reader", input.largestState);
    nationalStateRead = await child<StateReadResult>("database-read", input.largestState);
  } finally {
    databaseTotals = await database.close();
  }
  const largest = workers[0], oneReader = readers[0];
  assert.equal(largest.state, FIPS_TO_STATE[input.largestState].postal);
  assert.deepEqual(nationalReader.readKeys, oneReader.readKeys, "adding the country must not add local artifact reads");
  assert.equal(nationalReader.artifactBytesRead, oneReader.artifactBytesRead, "adding the country must not add local artifact bytes");
  assert.ok(firstStateRead);
  assert.equal(nationalStateRead.bytesRead, firstStateRead.bytesRead, "adding the country must not add state SQL response bytes");
  assert.equal(nationalStateRead.bytesWritten, firstStateRead.bytesWritten, "adding the country must not add state SQL request bytes");
  assert.deepEqual(nationalStateRead.stateKeys, [largest.state]);
  const total = (key: keyof WorkerResult) => workers.reduce((sum, worker) => sum + Number(worker[key]), 0);
  const sumDatabase = (run: "firstRun" | "unchangedRun", key: keyof DatabaseMeasurement["firstRun"]) => workers.reduce((sum, worker) => sum + worker.database[run][key], 0);
  const peak = Math.max(...workers.map(worker => worker.peakRssBytes));
  const coordinatorPeakRssBytes = peakRssBytes();
  const databaseBytesRead = sumDatabase("firstRun", "bytesRead") + completion.firstRun.bytesRead;
  const databaseBytesWritten = sumDatabase("firstRun", "bytesWritten") + completion.firstRun.bytesWritten;
  const report = { measuredAt: new Date().toISOString(), runtimeMs: performance.now() - started, coordinatorPeakRssBytes,
    sourceAcquisition: { peakRssBytes: input.peakRssBytes, runtimeMs: input.runtimeMs, largestSourceUnit: input.largestSourceUnit },
    localDatabaseMeasurementPeakRssBytes: databaseTotals.peakRssBytes,
    nationalInputs: { sourceEvidence: input.sourceEvidence, uniqueZips: input.uniqueZips, jurisdictions: workers.length,
      governments: total("governments"), censusGovernments: total("censusGovernments"), stateGovernments: total("stateGovernments"),
      territorialGovernments: total("territorialGovernments"), tribalNations: total("tribalNations"), dependentSchools: total("dependentSchools"),
      aiannhAreas: total("aiannhAreas"), aiannhComponents: total("aiannhComponents"), polygons: total("polygons"), vertices: total("vertices"), pointRequests: total("pointRequests"),
      localEdges: total("localEdges"), districts: total("districts") },
    databaseMeasurement: database.method,
    database: { firstRun: { requests: sumDatabase("firstRun", "requests") + completion.firstRun.requests,
      statements: sumDatabase("firstRun", "statements") + completion.firstRun.statements, bytesRead: databaseBytesRead,
      bytesWritten: databaseBytesWritten, runtimeMs: sumDatabase("firstRun", "runtimeMs") + completion.firstRun.runtimeMs },
      unchangedRun: { requests: sumDatabase("unchangedRun", "requests") + completion.unchangedRun.requests,
        statements: sumDatabase("unchangedRun", "statements") + completion.unchangedRun.statements,
        bytesRead: sumDatabase("unchangedRun", "bytesRead") + completion.unchangedRun.bytesRead,
        bytesWritten: sumDatabase("unchangedRun", "bytesWritten") + completion.unchangedRun.bytesWritten,
        runtimeMs: sumDatabase("unchangedRun", "runtimeMs") + completion.unchangedRun.runtimeMs },
      largestState: largest.database, completion, engineTotals: databaseTotals },
    geometryMeasurement: "Synthetic polygons from three retained real floterials for Census governments, all statewide and governing territorial identities, and five typed AIANNH areas for three nations; real 2024/119th district identities and ZIP memberships duplicated for 2026/120th plans.",
    largestInput: { state: largest.state, jobs: largest.governments + largest.dependentSchools, polygons: largest.polygons,
      vertices: largest.vertices, sourceMetadataBytes: largest.sourceMetadataBytes, sourcePeakRssBytes: largest.sourcePeakRssBytes,
      publicationPeakRssBytes: largest.publicationPeakRssBytes, baselineRssBytes: largest.baselineRssBytes },
    publication: { unit: "one state", statesPromotedBeforeNextGeometryInput: workers.length, nationalCatalogs: 0, metadataReplays: 0, rawGeometrySerializationsForMeasurement: 0 },
    countryGrowthCheck: { requestedState: largest.state, publishedStates: workers.length, localArtifactReads: oneReader.readKeys.length,
      identicalReadKeys: true, firstStateRead, nationalStateRead },
    perRun: { databaseBytesRead, databaseBytesWritten, artifactBytesWritten: total("artifactBytesWritten") },
    perDayAtMonthlyCadence: { databaseBytesRead: databaseBytesRead / 30, databaseBytesWritten: databaseBytesWritten / 30, artifactBytesWritten: total("artifactBytesWritten") / 30 },
    peakWorkerRssBytes: peak, peakSourceRssBytes: Math.max(...workers.map(worker => worker.sourcePeakRssBytes)),
    peakPublicationRssBytes: Math.max(...workers.map(worker => worker.publicationPeakRssBytes)),
    peakReaderRssBytes: Math.max(...readers.map(reader => reader.peakRssBytes)), productionHostBytes: 8 * 1024 ** 3, marginBytes: 768 * 1024 ** 2,
    copiesAtMargin: Math.floor((8 * 1024 ** 3 - 768 * 1024 ** 2 - coordinatorPeakRssBytes) / peak),
    copiesWithResearchParent: Math.floor((8 * 1024 ** 3 - (768 + 2928) * 1024 ** 2 - coordinatorPeakRssBytes) / peak),
    configuredCensusReservationBytes: 1258 * 1024 ** 2,
    admissionsAtConfiguredReservation: Math.floor((8 * 1024 ** 3 - 768 * 1024 ** 2 - coordinatorPeakRssBytes) / (1258 * 1024 ** 2)),
    limitations: ["Full national real-source boundary geometry was not tested; polygon complexity is bounded to the largest retained real fixture. SQL ran locally through the real Neon HTTP driver; production network latency and physical storage I/O were not measured."], workers, readers, nationalReader };
  await writeFile(join(directory, "report.json"), JSON.stringify(report, null, 2));
  process.stdout.write(`${JSON.stringify({ ...report, workers: undefined, readers: undefined })}\n`);
}

if (argument("prepare")) process.stdout.write(`${JSON.stringify(await prepare())}\n`);
else if (argument("database-server")) {
  const { serveCensusPromotionDatabase } = await import("./lib/representation-scale-database.mts");
  await serveCensusPromotionDatabase(peakRssBytes);
} else if (argument("completion")) {
  const { measureCensusCompletion } = await import("./lib/representation-scale-database.mts");
  const endpoint = argument("database-endpoint");
  assert.ok(endpoint);
  process.stdout.write(`${JSON.stringify(await measureCensusCompletion(endpoint, now, Number(argument("completion"))))}\n`);
} else if (argument("database-read")) {
  const { measureCensusStateIndex } = await import("./lib/representation-scale-database.mts");
  const endpoint = argument("database-endpoint");
  assert.ok(endpoint);
  const result = await measureCensusStateIndex(endpoint, FIPS_TO_STATE[argument("database-read")!].postal);
  process.stdout.write(`${JSON.stringify(result)}\n`);
} else if (argument("reader")) process.stdout.write(`${JSON.stringify(await reader(argument("reader")!))}\n`);
else if (argument("worker")) process.stdout.write(`${JSON.stringify(await worker(argument("worker")!))}\n`);
else await main();
