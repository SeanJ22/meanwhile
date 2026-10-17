import { createReadStream } from "node:fs";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { randomUUID } from "node:crypto";
import { DurableEvidenceStore } from "../lib/control-plane/evidence/durable-store.ts";
import { LocalFileArtifactStore } from "../lib/meetings/edge-store.ts";
import { publishCampaignFinanceResource } from "../lib/funding/state-publication.ts";
import { acquireCampaignFinanceResource } from "../lib/funding/state-acquisition.ts";
import { campaignFinanceSource, campaignFinanceSourceId } from "../lib/funding/state-sources.ts";
import { FederalMoneyBenchmarkStore } from "./lib/federal-money-benchmark-store.mts";
import { assignment } from "./cli-args.mts";

const state = assignment(process.argv, "state"), resourceId = assignment(process.argv, "resource"), input = assignment(process.argv, "input");
const generatedRecords = Number(assignment(process.argv, "generated-records") ?? 0), generatedFilers = Number(assignment(process.argv, "generated-filers") ?? 1);
const stage = assignment(process.argv, "stage") ?? "publish";
if (stage !== "acquire" && stage !== "publish") throw new Error("Scale stage must be acquire or publish.");
if (!state || !resourceId || !input && !generatedRecords) throw new Error("--state, --resource and a captured --input or --generated-records are required.");
if (!Number.isSafeInteger(generatedRecords) || generatedRecords < 0 || !Number.isSafeInteger(generatedFilers) || generatedFilers < 1 || generatedRecords && (state !== "WA" || input || generatedFilers > generatedRecords)) throw new Error("Generated input requires a positive native Washington row count and filer count, without a captured input.");
const source = campaignFinanceSource(state), resource = source.resources.find(row => row.id === resourceId);
if (!resource) throw new Error("The scale run requires one registered native resource profile.");
if (generatedRecords && resource.id !== source.resources[0].id) throw new Error("Generated input uses the registered Washington summary schema.");
const path = input ? resolve(input) : null;
if (path?.startsWith(resolve(process.cwd()) + "/")) throw new Error("Scale input must stay outside the repository.");
const template = generatedRecords ? JSON.parse(await readFile(new URL("../tests/fixtures/campaign-finance/wa-native-excerpt.json", import.meta.url), "utf8"))[0] : null;
let generatedBytes = 0;
const directory = join(tmpdir(), `campaign-finance-scale-${state}-${randomUUID()}`);
await mkdir(directory, { recursive: true });
const store = stage === "publish" ? await FederalMoneyBenchmarkStore.open(join(directory, "database"), campaignFinanceSourceId(state)) : null;
const vault = new DurableEvidenceStore(join(directory, "vault"), { remote: null });
const artifacts = new LocalFileArtifactStore(join(directory, "artifacts"));
let artifactRead = 0, artifactWritten = 0, largestArtifactRead = 0, largestArtifactWrite = 0;
const read = artifacts.readBytes.bind(artifacts), put = artifacts.putImmutable.bind(artifacts);
artifacts.readBytes = async key => { const bytes = await read(key); artifactRead += bytes?.length ?? 0; largestArtifactRead = Math.max(largestArtifactRead, bytes?.length ?? 0); return bytes; };
artifacts.putImmutable = async (bytes, suffix) => { artifactWritten += bytes.length; largestArtifactWrite = Math.max(largestArtifactWrite, bytes.length); return put(bytes, suffix); };
let sourceReads = 0;
const sourceFetch: typeof fetch = async (request, init) => {
  if (new Headers(init?.headers).get("if-none-match") === "complete-source-replay") return new Response(null, { status: 304 });
  sourceReads++;
  if (template) {
    const url = new URL(String(request)), offset = Number(url.searchParams.get("$offset") ?? 0), limit = Number(url.searchParams.get("$limit") ?? generatedRecords);
    async function* rows() {
      let batch = "[", bytes = 1;
      generatedBytes++;
      const end = Math.min(generatedRecords, offset + limit);
      for (let index = offset; index < end; index++) {
        const filer = index % generatedFilers;
        const text = (index === offset ? "" : ",") + JSON.stringify({ ...template, id: String(index), filer_id: `scale-${filer}`, filer_name: `Generated scale filer ${filer}` });
        const length = Buffer.byteLength(text);
        generatedBytes += length; batch += text; bytes += length;
        if (bytes >= 64 * 1024) { yield Buffer.from(batch); batch = ""; bytes = 0; }
      }
      yield Buffer.from(batch + "]"); generatedBytes++;
    }
    return new Response(Readable.toWeb(Readable.from(rows())) as ReadableStream<Uint8Array>, { headers: { etag: "complete-source-replay" } });
  }
  if (!path) throw new Error("The captured source input is missing.");
  return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>, { headers: { etag: "complete-source-replay" } });
};
const sortMemoryPath = join(directory, "sort-memory-kib");
const originalSpawn = childProcess.spawn;
const sortProfiler = "import subprocess,resource,sys,json; r=subprocess.run(sys.argv[2:]); open(sys.argv[1],'a').write(json.dumps([resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss,resource.getrusage(resource.RUSAGE_SELF).ru_maxrss])+'\\n'); sys.exit(r.returncode)";
const profiledSpawn = (command: string, args: readonly string[] | childProcess.SpawnOptions = [], options: childProcess.SpawnOptions = {}) => {
  if (!Array.isArray(args)) return originalSpawn(command, args as childProcess.SpawnOptions);
  return command === "sort" ? originalSpawn("python", ["-c", sortProfiler, sortMemoryPath, "sort", ...args], options)
    : originalSpawn(command, args, options);
};
childProcess.spawn = profiledSpawn as unknown as typeof childProcess.spawn;
syncBuiltinESMExports();
async function sortPeakBytes() {
  try { return Math.max(0, ...(await readFile(sortMemoryPath, "utf8")).trim().split("\n").map(line => JSON.parse(line)[0])) * 1024; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0; throw error; }
}
const capturedBytes = path ? (await stat(path)).size : 0, baselineRssBytes = process.memoryUsage().rss;
const mode = template ? "generated native Washington rows from the committed real-source schema" : "complete captured-source replay";
try {
  if (stage === "acquire") {
    const started = performance.now();
    let records = 0, unjoined = 0, largestCaptureBytes = 0, largestPageRecords = 0;
    for await (const page of acquireCampaignFinanceResource(state, resource, { directory: join(directory, "sources"), vault,
      signal: new AbortController().signal, fetch: sourceFetch, runId: randomUUID() })) {
      records += page.records.length;
      unjoined += page.records.filter(row => row.unjoinedReason !== null).length;
      largestCaptureBytes = Math.max(largestCaptureBytes, page.capture?.byteLength ?? 0);
      largestPageRecords = Math.max(largestPageRecords, page.records.length);
    }
    const sortPeak = await sortPeakBytes();
    console.log(`CAMPAIGN_FINANCE_SCALE=${JSON.stringify({ state, resource: resource.id, stage, mode,
      inputBytes: capturedBytes || generatedBytes, generatedRecords, generatedFilers, records, unjoined, largestCaptureBytes, largestPageRecords, baselineRssBytes, elapsedMs: performance.now() - started,
      nodePeakRssBytes: process.resourceUsage().maxRSS * 1024, sortPeakRssBytes: sortPeak,
      peakWorkerRssUpperBoundBytes: process.resourceUsage().maxRSS * 1024 + sortPeak, databaseProtocolReadBytes: 0, databaseProtocolWrittenBytes: 0 })}`);
  } else {
  if (!store) throw new Error("The publication scale run has no local PostgreSQL worker.");
  for (const pass of ["initial", "unchanged"]) {
    const before = { ...store.bytes }, oldRead = artifactRead, oldWritten = artifactWritten, started = performance.now();
    const result = await publishCampaignFinanceResource(state, resource, { directory: join(directory, "sources"), store, vault, artifacts,
      signal: new AbortController().signal, fetch: sourceFetch, runId: randomUUID() });
    const sortPeak = await sortPeakBytes(), nodePeak = process.resourceUsage().maxRSS * 1024, peak = nodePeak + sortPeak;
    console.log(`CAMPAIGN_FINANCE_SCALE=${JSON.stringify({ state, resource: resource.id, mode: `${mode} into local PostgreSQL`, pass,
      inputBytes: capturedBytes || generatedBytes, generatedRecords, generatedFilers, baselineRssBytes, recordsAcquired: result.records, unjoinedAcquired: result.unjoined, publicationState: result.outcome.candidate.state,
      elapsedMs: performance.now() - started, peakWorkerRssUpperBoundBytes: peak, nodePeakRssBytes: nodePeak, sortPeakRssBytes: sortPeak,
      databaseProtocolReadBytes: store.bytes.read - before.read, databaseProtocolWrittenBytes: store.bytes.written - before.written,
      databaseRequests: store.bytes.requests - before.requests, largestDatabaseReadBytes: store.bytes.largestRead, largestDatabaseWriteBytes: store.bytes.largestWrite,
      artifactReadBytes: artifactRead - oldRead, artifactWrittenBytes: artifactWritten - oldWritten, largestArtifactReadBytes: largestArtifactRead, largestArtifactWriteBytes: largestArtifactWrite,
      sourceDownloads: sourceReads, dailyDatabaseProtocolReadBytes: store.bytes.read - before.read, dailyDatabaseProtocolWrittenBytes: store.bytes.written - before.written })}`);
  }
  }
} finally {
  childProcess.spawn = originalSpawn;
  syncBuiltinESMExports();
  if (store) {
    await store.close();
    console.log(`CAMPAIGN_FINANCE_SCALE_DATABASE=${JSON.stringify({ peakRssBytes: store.bytes.databasePeakRssBytes })}`);
  }
  await rm(directory, { recursive: true, force: true });
}
