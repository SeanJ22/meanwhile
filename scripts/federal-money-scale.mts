import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { closeSync, createReadStream, createWriteStream, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { DurableEvidenceStore } from "../lib/control-plane/evidence/durable-store.ts";
import { loadRegistrationReference } from "../lib/registration/reference.ts";
import { referenceGovernmentListings, type RegistrationGovernmentListing } from "../lib/registration/listings.ts";
import { FIPS_TO_STATE } from "../lib/ocd/fips.ts";
import { FEDERAL_MONEY_SOURCES, type FederalMoneyFact, type FederalMoneyPage, type FederalMoneySource } from "../lib/federal-money/model.ts";
import { parseFederalMoney } from "../lib/federal-money/parse.ts";
import { saveFederalMoneyCapture } from "../lib/federal-money/vault.ts";
import { refreshFederalMoney } from "../lib/federal-money/refresh.ts";
import { acquireFederalMoney } from "../lib/federal-money/acquire.ts";
import { readFederalMoneyJoinInput } from "../lib/federal-money/held-identities.ts";
import { locateFederalMoneyFacts } from "../lib/federal-money/locations.ts";
import { LocalFileArtifactStore } from "../lib/meetings/edge-store.ts";
import { publishFederalMoneyPartition, publishFederalMoneyProgress } from "../lib/federal-money/edge-publication.ts";
import { readFederalMoneyForPlace } from "../lib/federal-money/reader.ts";
import { FEDERAL_MONEY_CONFIG } from "../lib/federal-money/sources.ts";
import type { FederalMoneyJoinInput } from "../lib/federal-money/join.ts";
import { FederalMoneyBenchmarkStore } from "./lib/federal-money-benchmark-store.mts";
import { seedFederalMoneyBenchmarkIdentities } from "./lib/federal-money-benchmark-identities.mts";

const option = (name: string, fallback: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const directory = resolve(option("directory", "/workspace/src-money-scale"));
const seedDirectory = resolve(option("seed-directory", directory));
const temporaryDirectory = join(tmpdir(), `federal-money-scale-${createHash("sha256").update(directory).digest("hex").slice(0, 16)}`);
mkdirSync(directory, { recursive: true });
const mode = option("mode", "run");
const selected = option("states", "");
const inventory = JSON.parse(readFileSync("data/derived/registration/index.json", "utf8")) as { states: Record<string, unknown> };
const states = selected ? selected.split(",").map(state => state.toLowerCase()) : Object.keys(inventory.states).sort();
if (!selected && mode === "bulk-run" && option("source", "usaspending") === "federal-audit-clearinghouse") states.push("zz");
const years = Number(option("years", "1"));
const repetitions = Number(option("rows-per-government", "1"));
const selectedGovernment = option("government-uei", "");
const selectedSource = option("source", "usaspending");
const sources = selectedSource === "all" ? FEDERAL_MONEY_SOURCES : FEDERAL_MONEY_SOURCES.filter(source => source === selectedSource);
assert.ok(sources.length && Number.isInteger(years) && years > 0 && Number.isInteger(repetitions) && repetitions > 0);
let now = option("checked-at", "2026-10-15T12:00:00.000Z");
const unchanged = process.argv.includes("--unchanged");
const maxRunMs = Number(option("max-run-ms", "1500000"));
const checks = Number(option("checks", "1"));
assert.ok(Number.isInteger(checks) && checks > 0 && (checks === 1 || unchanged && sources.length === 1 && mode === "run"));
function memoryMeasurement() {
  let peak = process.memoryUsage.rss(), sampledPeakScratchBytes = 0, samples = 0;
  function scratchBytes(path: string): number {
    try { const stat = statSync(path); return stat.isDirectory() ? readdirSync(path).reduce((sum, name) => sum + scratchBytes(join(path, name)), 0) : stat.size; }
    catch { return 0; }
  }
  function sample(pid = process.pid): number {
    try {
      if (pid !== process.pid && readFileSync(`/proc/${pid}/cmdline`, "utf8").includes("federal-money-postgres-server.mts")) return 0;
      const status = readFileSync(`/proc/${pid}/status`, "utf8");
      const rss = Number(/^VmRSS:\s+(\d+)\s+kB$/m.exec(status)?.[1] ?? 0) * 1024;
      const children = readFileSync(`/proc/${pid}/task/${pid}/children`, "utf8").trim().split(/\s+/).filter(Boolean).map(Number);
      return rss + children.reduce((total, child) => total + sample(child), 0);
    } catch { return pid === process.pid ? process.memoryUsage.rss() : 0; }
  }
  const timer = setInterval(() => {
    peak = Math.max(peak, sample());
    if (++samples % 10 === 0) sampledPeakScratchBytes = Math.max(sampledPeakScratchBytes, scratchBytes(join(temporaryDirectory, "bulk-cache")));
  }, 100);
  timer.unref();
  return () => { clearInterval(timer); return { peakRssBytes: Math.max(peak, sample(), process.resourceUsage().maxRSS * 1024), sampledPeakScratchBytes }; };
}
const governmentPath = (uei: string) => join(seedDirectory, "identities", uei.slice(0, 2), `${uei}.json`);
const syntheticUei = (id: string) => createHash("sha256").update(id).digest("hex").slice(0, 12).toUpperCase();
type Division = FederalMoneyJoinInput["divisions"][number];
type GeneratedPageSource = Exclude<FederalMoneySource, "usaspending">;
interface BulkManifest { rows: number; expandedBytes: number; governments: number; syntheticCountyAssignments?: number; states: { state: string; path: string; rows: number; governments: number }[] }
interface Seed { government: RegistrationGovernmentListing | null; uei: string; state: string; divisions: Division[] }
const facTableNames = ["general", "findings", "findings_text", "corrective_action_plans", "additional_ueis"];
const facTableWeights = [4, 6, 1, 1, 1];
const facTableCounts = facTableWeights.map((weight, index) => Math.floor(repetitions / 13) * weight
  + Math.max(0, Math.min(weight, repetitions % 13 - facTableWeights.slice(0, index).reduce((a, b) => a + b, 0))));

async function writeLine(stream: ReturnType<typeof createWriteStream>, value: unknown) {
  if (!stream.write(`${JSON.stringify(value)}\n`)) await once(stream, "drain");
}

async function prepare() {
  mkdirSync(join(directory, "seeds"), { recursive: true });
  let governments = 0, divisions = 0, counties = 0;
  for (const state of states) {
    const loaded = loadRegistrationReference(process.cwd(), state);
    const held = referenceGovernmentListings(loaded);
    const output = createWriteStream(join(directory, "seeds", `${state}.jsonl`));
    const countyOutput = createWriteStream(join(directory, "seeds", `${state}-counties.jsonl`));
    const nativeDivisions = new Map(loaded.reference.divisions.map(row => [row[0], {
      ocdId: row[0], geoid: row[2], divisionType: /^(un|el|sc)sd$/.test(row[1]) ? "school_district" : row[1],
    }]));
    for (const heldGovernment of held) {
      const uei = syntheticUei(heldGovernment.id);
      const government = { ...heldGovernment, nativeIds: { ...heldGovernment.nativeIds, uei } };
      const seed: Seed = { government, uei, state: state.toUpperCase(), divisions: government.associations.flatMap(link => {
        const division = nativeDivisions.get(link.divisionId); return division ? [division] : [];
      }) };
      mkdirSync(join(governmentPath(uei), ".."), { recursive: true });
      writeFileSync(governmentPath(uei), JSON.stringify(seed));
      await writeLine(output, seed);
      governments++;
    }
    for (const division of nativeDivisions.values()) if (division.divisionType === "county") {
      const seed: Seed = { government: null, uei: syntheticUei(division.ocdId), state: state.toUpperCase(), divisions: [division] };
      await writeLine(countyOutput, seed);
      counties++;
    }
    divisions += nativeDivisions.size;
    output.end(); countyOutput.end();
    await Promise.all([once(output, "finish"), once(countyOutput, "finish")]);
  }
  const prepared = { states, governments, divisions, counties, synthetic: true };
  writeFileSync(join(directory, "inventory.json"), JSON.stringify(prepared));
  await prepareSam();
  console.log(JSON.stringify({ mode: "prepare", ...prepared }));
}

async function prepareSam() {
  mkdirSync(temporaryDirectory, { recursive: true });
  for (const state of states) {
    const keyed = join(temporaryDirectory, `${state}.keys`), sorted = `${keyed}.sorted`, output = createWriteStream(keyed);
    for await (const line of createInterface({ input: createReadStream(join(seedDirectory, "seeds", `${state}.jsonl`)), crlfDelay: Infinity })) {
      const seed = JSON.parse(line) as Seed, key = createHash("sha256").update(`sam-gov-entities:${seed.uei}`).digest("hex");
      if (!output.write(`${key}\t${line}\n`)) await once(output, "drain");
    }
    output.end(); await once(output, "finish");
    const child = spawn("sort", ["--stable", "--buffer-size=16M", "--temporary-directory", temporaryDirectory, "--field-separator=\t", "--key=1,1", "--output", sorted, keyed], { stdio: "inherit", env: { ...process.env, LC_ALL: "C" } });
    const [code] = await once(child, "exit"); assert.equal(code, 0);
    const seeds = createWriteStream(join(seedDirectory, "seeds", `${state}-sam.jsonl`));
    for await (const line of createInterface({ input: createReadStream(sorted), crlfDelay: Infinity })) if (!seeds.write(`${line.slice(line.indexOf("\t") + 1)}\n`)) await once(seeds, "drain");
    seeds.end(); await once(seeds, "finish");
    rmSync(keyed); rmSync(sorted);
  }
}

const stateFips = Object.fromEntries(Object.entries(FIPS_TO_STATE).map(([fips, value]) => [value.postal, fips]));
function sourceRow(source: GeneratedPageSource, seed: Seed, year: number, repetition: number, table: string): Record<string, unknown> {
  const identifier = `GENERATED-${seed.uei}-${year}-${repetition}`;
  const name = seed.government?.name ?? seed.divisions[0]?.ocdId ?? seed.state;
  const county = seed.divisions.find(row => row.divisionType === "county")?.geoid ?? seed.government?.countyFips;
  if (source === "federal-audit-clearinghouse") return { report_id: identifier, auditee_state: seed.state,
    auditee_uei: seed.uei, auditee_name: name, audit_year: year, fac_accepted_date: now, total_amount_expended: 1234.56,
    reference_number: `2026-${repetition}`, ...(table === "additional_ueis" ? { additional_uei: seed.uei } : {}),
    ...(table === "findings_text" ? { finding_text: "Generated audit finding. ".repeat(32) } : {}),
    ...(table === "corrective_action_plans" ? { planned_action: "Generated corrective action. ".repeat(32) } : {}),
    is_internal_control_material_weakness_disclosed: repetition % 2 ? "Y" : "N" };
  if (source === "sam-gov-entities") return { entityRegistration: { ueiSAM: seed.uei, legalBusinessName: name,
    registrationDate: `${year}-01-01`, lastUpdateDate: now, registrationStatus: "Active", samRegistered: "Yes" },
    coreData: { physicalAddress: { stateOrProvinceCode: seed.state }, generalInformation: { entityTypeDesc: "Government" } } };
  return { id: identifier, state: seed.state, fipsStateCode: stateFips[seed.state], fipsCountyCode: county?.slice(2),
    disasterNumber: 1234, declarationTitle: "Generated benchmark disaster", designatedArea: name,
    declarationDate: `${year}-01-01T00:00:00.000Z`, lastRefresh: now, declarationType: "DR", incidentType: "Flood" };
}

interface GeneratorPosition { year: number; offset: number; repetition: number; table: number }
function generatedRows(source: GeneratedPageSource, state: string, position: GeneratorPosition) {
  const filename = join(seedDirectory, "seeds", `${state.toLowerCase()}${source === "openfema" ? "-counties" : source === "sam-gov-entities" ? "-sam" : ""}.jsonl`);
  const file = openSync(filename, "r"), buffer = Buffer.alloc(16 * 1024);
  const rows: { seed: Seed; row: Record<string, unknown>; table: string }[] = [];
  let seed: Seed | null = null, nextOffset = 0;
  try {
    while (rows.length < 500 && position.year <= 2026) {
      if (source === "federal-audit-clearinghouse" && !facTableCounts[position.table]) {
        position.table++;
        if (position.table === facTableNames.length) { position.table = 0; position.year++; }
        continue;
      }
      if (!seed) {
        const length = readSync(file, buffer, 0, buffer.length, position.offset);
        if (!length) {
          if (source === "federal-audit-clearinghouse" && position.table < facTableNames.length - 1) position.table++;
          else { position.year++; position.table = 0; }
          position.offset = 0; position.repetition = 0;
          if (source === "federal-audit-clearinghouse" && rows.length) break;
          continue;
        }
        const end = buffer.subarray(0, length).indexOf(10);
        assert.ok(end >= 0, "A generated government seed exceeds the bounded input row.");
        seed = JSON.parse(buffer.subarray(0, end).toString("utf8")) as Seed;
        nextOffset = position.offset + end + 1;
        if (selectedGovernment && seed.uei !== selectedGovernment) { position.offset = nextOffset; seed = null; continue; }
      }
      const table = facTableNames[position.table]!;
      const repetition = position.repetition + (source === "federal-audit-clearinghouse" ? facTableCounts.slice(0, position.table).reduce((a, b) => a + b, 0) : 0);
      rows.push({ seed, row: sourceRow(source, seed, position.year, repetition, table), table });
      position.repetition++;
      if (position.repetition === (source === "federal-audit-clearinghouse" ? facTableCounts[position.table] : repetitions)) { position.offset = nextOffset; position.repetition = 0; seed = null; }
    }
  } finally { closeSync(file); }
  return { rows, complete: position.year > 2026 };
}

const urls: Record<GeneratedPageSource, string> = {
  "federal-audit-clearinghouse": "https://api.fac.gov/general",
  "sam-gov-entities": "https://api.sam.gov/entity-information/v3/entities",
  openfema: "https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries",
};

async function run() {
  assert.ok(existsSync(join(seedDirectory, "inventory.json")), "Run --mode=prepare in a separate process before measuring the worker.");
  const started = performance.now();
  const memory = memoryMeasurement();
  const useBulk = mode === "bulk-run";
  const bulkInput = useBulk ? resolve(option("input", "")) : null;
  assert.ok(useBulk || !sources.includes("usaspending") || unchanged, "USAspending refresh measurement requires native bulk archives in provider order.");
  const bulkManifest = bulkInput && statSync(bulkInput).isDirectory() ? JSON.parse(readFileSync(join(bulkInput, "manifest.json"), "utf8")) as BulkManifest : null;
  const bulkPaths = new Map(bulkManifest?.states.map(row => [row.state.toUpperCase(), row.path]));
  if (useBulk) assert.ok(sources.length === 1 && bulkInput && (sources[0] === "federal-audit-clearinghouse" && !bulkManifest || sources[0] === "usaspending" && (bulkManifest ? states.every(state => bulkPaths.has(state.toUpperCase())) : states.length === 1)));
  const reports = [];
  for (const source of sources) {
    mkdirSync(join(directory, "database"), { recursive: true });
    const store = await FederalMoneyBenchmarkStore.open(join(directory, "database", source), source);
    const vault = new DurableEvidenceStore(join(directory, "vault", source), { remote: null });
    const artifactStore = new LocalFileArtifactStore(join(temporaryDirectory, "reader", source));
    const positions = new Map<string, GeneratorPosition>();
    const checkedStates = new Set<string>();
    const providerRequests: Record<string, number> = {}, providerPhases: Record<string, number> = {};
    let inputRows = 0, inputBytes = 0, pages = 0, maxPageFacts = 0, completedStates = 0;
    let partitions = 0, readerBytesWritten = 0, slowestReaderMs = 0, largestPartitionRows = 0;
    const stateCounts: Record<string, unknown> = {};
    const sourceStarted = performance.now();
    const result = await refreshFederalMoney({ source, store, states: states.map(state => state.toUpperCase()),
      now: () => now, maxRunMs, acquireOptions: { evidenceStore: vault },
      onProgress: (row, checkedAt) => publishFederalMoneyProgress({ store: artifactStore, source, state: row.state,
        checkedAt, complete: row.status === "COMPLETE", reason: row.reason }),
      onPartition: async change => {
        if (bulkManifest) for (const fact of change.projection.records) {
          assert.ok(fact.uei, "Every generated government award needs its native UEI.");
          const seed = JSON.parse(readFileSync(governmentPath(fact.uei), "utf8")) as Seed;
          assert.ok(seed.government && fact.bodyIds.includes(seed.government.id), "Recipient coverage must match the government independently of geographic reach.");
        }
        const published = await publishFederalMoneyPartition({ ...change, store: artifactStore });
        partitions++; readerBytesWritten += published.bytesWritten;
        largestPartitionRows = Math.max(largestPartitionRows, change.projection.records.length);
        const fact = change.projection.records[0];
        if (fact?.joinStatus === "JOINED") {
          const jurisdiction = FIPS_TO_STATE[stateFips[fact.state]!];
          if (!jurisdiction && !fact.divisionIds.length) return;
          const divisionId = fact.divisionIds[0] ?? `ocd-division/country:us/${jurisdiction!.prefix}:${fact.state.toLowerCase()}`;
          const readStarted = performance.now();
          const read = await readFederalMoneyForPlace({ divisionId, ...(fact.bodyIds[0] ? { bodyId: fact.bodyIds[0] } : {}) }, { artifactStore });
          const duration = performance.now() - readStarted;
          assert.ok(read.sources.find(row => row.source === source)?.records.length, `Published ${source} records did not reach ${fact.state}:${divisionId}.`);
          assert.ok(duration < 3000, `First place read took ${duration}ms.`);
          slowestReaderMs = Math.max(slowestReaderMs, duration);
        }
      },
      acquire: async (_source, state, options): Promise<FederalMoneyPage> => {
        if (unchanged) {
          if (!checkedStates.has(state)) assert.ok(!options?.cursor, "An unchanged fixture cannot complete an unfinished source backfill.");
          checkedStates.add(state);
          const cursor = options?.cursor;
          const phase = source === "usaspending" ? `download:${cursor?.category ?? 0}:${cursor?.location ?? "performance"}`
            : source === "sam-gov-entities" ? `extract:${cursor?.registered === false ? "unregistered" : "registered"}`
              : source === "federal-audit-clearinghouse" ? cursor?.phase ?? "general" : "declarations";
          providerPhases[phase] = (providerPhases[phase] ?? 0) + 1;
          const page = await acquireFederalMoney(source, state, { ...options, cacheRoot: join(temporaryDirectory, "bulk-cache"),
            dataGovApiKey: "generated-benchmark-key", samGovApiKey: "generated-benchmark-key", fetch: async input => {
              const url = new URL(String(input));
              providerRequests[url.pathname] = (providerRequests[url.pathname] ?? 0) + 1;
              if (source === "usaspending") {
                if (url.pathname.endsWith("/awards/")) return Response.json({ status_url: "https://api.usaspending.gov/status/benchmark-empty", file_url: "https://files.usaspending.gov/benchmark-empty.zip" });
                if (url.pathname.includes("/status/")) return Response.json({ status: "finished" });
                const inputPath = resolve(option("input", ""));
                assert.ok(statSync(inputPath).isFile(), "USAspending unchanged checks require a header-only native ZIP via --input.");
                return new Response(Readable.toWeb(createReadStream(inputPath)) as ReadableStream<Uint8Array>);
              }
              return source === "sam-gov-entities" ? Response.json({ totalRecords: 0, entityData: [] })
                : source === "openfema" ? Response.json({ metadata: { count: 0 }, DisasterDeclarationsSummaries: [] })
                  : Response.json([], { headers: { "Content-Range": "*/0" } });
            } });
          assert.equal(page.facts.length, 0);
          inputBytes += page.captures.reduce((total, capture) => total + capture.byteLength, 0); pages++;
          return page;
        }
        if (useBulk) {
          const page = await acquireFederalMoney(source, state, { ...options, cacheRoot: join(temporaryDirectory, "bulk-cache"),
            cursor: options?.cursor ?? (source === "federal-audit-clearinghouse" ? { source, phase: "historic", year: 2015 }
              : { source, phase: "download", year: 2026, category: 2, location: "recipient",
                statusUrl: "https://api.usaspending.gov/status/benchmark", fileUrl: "https://files.usaspending.gov/benchmark.zip" }),
            fetch: async url => String(url).includes("/status/") ? Response.json({ status: "finished" })
              : String(url).endsWith("/historic/") ? new Response('<a href="https://app.fac.gov/dissemination/public-data/census/csv/census-2015.zip">2015</a>')
              : new Response(Readable.toWeb(createReadStream(bulkPaths.get(state) ?? bulkInput!)) as ReadableStream<Uint8Array>) });
          inputRows += page.facts.length; inputBytes += page.captures.reduce((total, capture) => total + capture.byteLength, 0);
          pages++; maxPageFacts = Math.max(maxPageFacts, page.facts.length);
          return page;
        }
        let position = positions.get(state);
        if (!position) {
          position = options?.cursor?.phase.startsWith("benchmark:") ? { year: options.cursor.year!, offset: options.cursor.offset!, repetition: options.cursor.chunkIndex!, table: Number(options.cursor.phase.split(":")[1]) }
            : { year: 2026 - years + 1, offset: 0, repetition: 0, table: 0 };
          positions.set(state, position);
        }
        assert.ok(source !== "usaspending");
        const generated = generatedRows(source, state, position);
        const rows = generated.rows.map(row => row.row), complete = generated.complete;
        const captures: FederalMoneyPage["captures"][number][] = [], facts: FederalMoneyFact[] = [];
        const groups = source === "federal-audit-clearinghouse" ? [...new Set(generated.rows.map(row => row.table))] : [""];
        for (const table of groups) {
          const groupRows = table ? generated.rows.filter(row => row.table === table).map(row => row.row) : rows;
          const body = JSON.stringify(source === "openfema" ? { DisasterDeclarationsSummaries: groupRows }
            : source === "sam-gov-entities" ? { entityData: groupRows } : groupRows);
          const capture = await saveFederalMoneyCapture({ url: table ? `https://api.fac.gov/${table}` : urls[source], body, retrievedAt: now, publicationDate: now }, vault);
          captures.push(capture); facts.push(...parseFederalMoney(source, capture, state, body)); inputBytes += Buffer.byteLength(body);
        }
        inputRows += rows.length; pages++; maxPageFacts = Math.max(maxPageFacts, facts.length);
        return { facts, captures, complete, declaredTotal: null,
          continuation: complete ? null : { source, phase: `benchmark:${position.table}`, year: position.year, offset: position.offset, chunkIndex: position.repetition } };
      },
      identities: (state, facts = []) => readFederalMoneyJoinInput(state, facts, store.query),
      locate: (state, facts) => locateFederalMoneyFacts(source, state, facts, store.query),
      onState: row => {
        if (row.status === "COMPLETE") { completedStates++; stateCounts[row.state] = row; }
        if (pages % (useBulk ? 10 : 100) === 0 || row.status === "COMPLETE") console.error(JSON.stringify({ source, state: row.state, pages, inputRows,
          status: row.status, elapsedMs: performance.now() - sourceStarted, rssBytes: process.memoryUsage.rss() }));
      },
    });
    assert.ok(result.outcome.promoted, result.outcome.candidate.failureDetail ?? "National marker did not promote.");
    completedStates = result.projection.states.filter(row => row.status === "COMPLETE").length;
    if (bulkManifest && completedStates === states.length) {
      const expected = bulkManifest.states.filter(row => states.includes(row.state.toLowerCase())).reduce((total, row) => total + row.rows, 0);
      assert.equal(result.projection.counts.loaded, expected);
      assert.equal(result.projection.counts.joined, expected, "Every generated government recipient must join through its native UEI.");
    }
    for (const row of result.projection.states) stateCounts[row.state] = row;
    assert.ok(maxPageFacts <= 500);
    await store.close();
    reports.push({ source, inputRows, inputBytes, pages, providerRequests, providerPhases, complete: completedStates === states.length, states: completedStates, counts: result.projection.counts, stateCounts,
      partitions, readerBytesWritten, slowestReaderMs, largestPartitionRows,
      elapsedMs: performance.now() - sourceStarted, databaseJsonBodyBytes: { ...store.bytes } });
  }
  const { peakRssBytes, sampledPeakScratchBytes } = memory();
  const report = { generated: !useBulk || option("input-kind", "generated") !== "official", inputGovernmentCoverage: bulkManifest?.states.filter(row => states.includes(row.state.toLowerCase())).reduce((total, row) => total + row.governments, 0) ?? null, syntheticCountyAssignments: bulkManifest && states.length === bulkManifest.states.length ? bulkManifest.syntheticCountyAssignments ?? null : null, unchanged, checkedAt: now, clock: unchanged ? "Controlled fixture wall clock; elapsed measurements use performance.now()." : "Real worker wall clock with explicit source publication timestamp.", maxRunMs, databaseMeasurement: "Actual Neon JSON bodies for native identity/location queries and partition/checkpoint promotion; isolated PostgreSQL engine, not production traffic or WAL.", worker: useBulk ? "actual sorted bulk acquisition through SQL joins, refresh, promotion and place reader" : "SQL joins, refresh, promotion and place reader with generated source pages", states: states.length, years, rowsPerGovernment: repetitions,
    elapsedMs: performance.now() - started, peakRssBytes, sampledPeakScratchBytes,
    runner8GiBWith075GiBMarginCopies: Math.floor((8 * 1024 ** 3 - 0.75 * 1024 ** 3) / peakRssBytes),
    runnerWithResearchParent2928MiBCopies: Math.max(0, Math.floor((8 * 1024 ** 3 - (768 + 2928) * 1024 ** 2) / peakRssBytes)),
    databaseJsonBodyBytes: reports.reduce((sum, report) => ({ read: sum.read + report.databaseJsonBodyBytes.read,
      written: sum.written + report.databaseJsonBodyBytes.written }), { read: 0, written: 0 }),
    projectedUnchangedDay: unchanged ? reports.map(report => ({ source: report.source,
      basis: "Measured unchanged check multiplied by the source publication clock; not an observed production day.",
      checks: 86_400_000 / FEDERAL_MONEY_CONFIG[report.source].everyMs,
      read: report.databaseJsonBodyBytes.read * 86_400_000 / FEDERAL_MONEY_CONFIG[report.source].everyMs,
      written: report.databaseJsonBodyBytes.written * 86_400_000 / FEDERAL_MONEY_CONFIG[report.source].everyMs })) : null, reports };
  writeFileSync(join(directory, `report-${Date.now()}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, reports: reports.map(({ stateCounts: _stateCounts, ...sourceReport }) => sourceReport) }));
  return report;
}

async function bulk() {
  const source = sources[0]!;
  assert.ok(source === "usaspending" || source === "sam-gov-entities");
  const input = resolve(option("input", ""));
  const manifest = statSync(input).isDirectory() ? JSON.parse(readFileSync(join(input, "manifest.json"), "utf8")) as BulkManifest : null;
  const expectedRows = Number(option("rows", String(manifest?.rows ?? 0)));
  const expandedBytes = Number(option("expanded-bytes", String(manifest?.expandedBytes ?? 0)));
  const inputs = manifest?.states ?? [{ state: selected.toUpperCase() || "CA", path: input, rows: expectedRows, governments: null }];
  assert.ok(expectedRows > 0 && inputs.every(row => statSync(row.path).isFile()));
  const vault = new DurableEvidenceStore(join(directory, "bulk-vault", source), { remote: null });
  const started = performance.now();
  const memory = memoryMeasurement();
  let requests = 0, rows = 0, pages = 0, largestCaptureBytes = 0;
  const stateRows: Record<string, number> = {};
  for (const entry of inputs) {
    const before = rows;
    let cursor = source === "usaspending"
    ? { source, phase: "download", year: 2026, category: 2, location: "recipient" as const,
      statusUrl: "https://api.usaspending.gov/status/benchmark", fileUrl: "https://files.usaspending.gov/benchmark.zip" }
    : { source, phase: "extract", registered: false };
    for (;;) {
    const page = await acquireFederalMoney(source, entry.state, { cursor, now: () => now,
      evidenceStore: vault, cacheRoot: join(temporaryDirectory, "bulk-cache", source), samGovApiKey: "generated-benchmark-key",
      fetch: async url => {
        requests++;
        if (String(url).includes("/status/")) return Response.json({ status: "finished" });
        return new Response(Readable.toWeb(createReadStream(entry.path)) as ReadableStream<Uint8Array>);
      } });
    rows += page.facts.length; pages++;
    for (const capture of page.captures) largestCaptureBytes = Math.max(largestCaptureBytes, capture.byteLength);
    assert.ok(page.facts.length <= 500);
    if (pages % 1000 === 0) console.error(JSON.stringify({ source, pages, rows, elapsedMs: performance.now() - started, rssBytes: process.memoryUsage.rss() }));
    if (page.complete) break;
    assert.ok(page.continuation);
    cursor = page.continuation as typeof cursor;
    }
    stateRows[entry.state] = rows - before;
    assert.equal(stateRows[entry.state], entry.rows);
    console.error(JSON.stringify({ source, state: entry.state, rows: rows - before, totalRows: rows, elapsedMs: performance.now() - started, rssBytes: process.memoryUsage.rss() }));
  }
  assert.equal(rows, expectedRows);
  const { peakRssBytes, sampledPeakScratchBytes } = memory();
  const report = { source, generated: true, worker: "actual bulk acquisition, evidence vault, native row parser", rows, pages, stateRows,
    inputGovernmentCoverage: manifest?.governments ?? null,
    inputCompressedBytes: inputs.reduce((total, row) => total + statSync(row.path).size, 0), inputExpandedBytes: expandedBytes || null, requests, largestCaptureBytes,
    elapsedMs: performance.now() - started, peakRssBytes, sampledPeakScratchBytes,
    runner8GiBWith075GiBMarginCopies: Math.floor((8 * 1024 ** 3 - 0.75 * 1024 ** 3) / peakRssBytes),
    runnerWithResearchParent2928MiBCopies: Math.max(0, Math.floor((8 * 1024 ** 3 - (768 + 2928) * 1024 ** 2) / peakRssBytes)),
    databaseWireBytes: 0, databaseDailyBytes: 0 };
  writeFileSync(join(directory, `report-bulk-${source}-${Date.now()}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}

if (mode === "prepare") await prepare();
else if (mode === "prepare-sam") await prepareSam();
else if (mode === "prepare-db") {
  mkdirSync(join(directory, "database"), { recursive: true });
  for (const source of sources) {
    const store = await FederalMoneyBenchmarkStore.open(join(directory, "database", source), source);
    try { console.log(JSON.stringify({ source, prepared: await seedFederalMoneyBenchmarkIdentities(store, seedDirectory, states) })); }
    finally { await store.close(); }
  }
}
else if (mode === "run" || mode === "bulk-run") {
  const start = Date.parse(now);
  const runs: Awaited<ReturnType<typeof run>>[] = [];
  const wallClock = Date;
  for (let check = 0; check < checks; check++) {
    now = new Date(start + check * FEDERAL_MONEY_CONFIG[sources[0]!].everyMs).toISOString();
    const elapsedStart = performance.now(), fixtureStart = Math.max(Date.parse(now), wallClock.now());
    if (unchanged) globalThis.Date = new Proxy(wallClock, {
      construct(target, args) { return Reflect.construct(target, args.length ? args : [fixtureStart + performance.now() - elapsedStart]); },
      get(target, name, receiver) { return name === "now" ? () => Math.floor(fixtureStart + performance.now() - elapsedStart) : Reflect.get(target, name, receiver); },
    });
    try { runs.push(await run()); }
    finally { globalThis.Date = wallClock; }
  }
  if (checks > 1) {
    const report = { source: sources[0], generated: true, measuredChecks: checks, virtualClockStart: new Date(start).toISOString(), virtualClockEnd: now,
      elapsedMs: runs.reduce((total, run) => total + run.elapsedMs, 0), peakRssBytes: Math.max(...runs.map(run => run.peakRssBytes)),
      databaseJsonBodyBytes: runs.reduce((total, run) => ({ read: total.read + run.databaseJsonBodyBytes.read,
        written: total.written + run.databaseJsonBodyBytes.written }), { read: 0, written: 0 }),
      partitionWrites: runs.reduce((total, run) => total + run.reports.reduce((sum, source) => sum + source.partitions, 0), 0),
      providerRequests: runs.reduce((total, run) => total + run.reports.reduce((sum, source) => sum + Object.values(source.providerRequests).reduce((a, b) => a + b, 0), 0), 0),
      providerPhases: Object.fromEntries([...new Set(runs.flatMap(run => run.reports.flatMap(source => Object.keys(source.providerPhases))))].map(phase => [phase, runs.reduce((sum, run) => sum + run.reports.reduce((total, source) => total + (source.providerPhases[phase] ?? 0), 0), 0)])),
      clock: "Controlled fixture wall clock; elapsed measurements use performance.now()." };
    writeFileSync(join(directory, `report-day-${Date.now()}.json`), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  }
}
else if (mode === "bulk") await bulk();
else throw new Error(`Unknown benchmark mode ${mode}.`);
