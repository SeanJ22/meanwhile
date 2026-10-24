/** All FAC jurisdictions: production SELECTs and publisher GETs; promotion and reader artifacts stay local. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, readFileSync, existsSync } from "node:fs";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import type { ReadOnlyQuery, Row } from "../lib/control-plane/admin-view/promoted-slices.ts";
import { requiredRoutineContract } from "../lib/civic-data/contracts.ts";
import { routineTaskDue, routineTaskFromContract } from "../lib/civic-data/runner.ts";
import { verifyRoutineReaderProjection } from "../lib/civic-data/reader-verification.ts";
import { refreshFederalMoney } from "../lib/federal-money/refresh.ts";
import { acquireFederalMoney } from "../lib/federal-money/acquire.ts";
import { readFederalMoneyJoinInput } from "../lib/federal-money/held-identities.ts";
import { federalMoneySourceStates } from "../lib/federal-money/sources.ts";
import { federalMoneyStateDivision } from "../lib/federal-money/view.ts";
import type { FederalMoneyCursor, FederalMoneyProjection } from "../lib/federal-money/model.ts";
import type { FederalMoneyHeldAudit } from "../lib/federal-money/join.ts";
import { LocalFileArtifactStore } from "../lib/meetings/edge-store.ts";
import { publishFederalMoneyPartition, publishFederalMoneyProgress } from "../lib/federal-money/edge-publication.ts";
import type { FederalMoneyPartitionChange } from "../lib/federal-money/partitions.ts";
import { readFederalMoneyForPlace } from "../lib/federal-money/reader.ts";
import { FederalMoneySection } from "../components/funding/federal-money-section.tsx";

const source = "federal-audit-clearinghouse" as const;
const option = (name: string, fallback: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const cacheRoot = resolve(option("cache", "/tmp/src-01-fac-all-states"));
const output = resolve(option("output", "docs/measurements/src-01/fac-all-states.json"));
const connectionFile = option("connection-file", "/tmp/src-01-prod-readonly-url");
const baseAt = option("at", new Date().toISOString());
const savedOnly = process.argv.includes("--saved");
const state = option("state", "");
const sourceStates = federalMoneySourceStates(source);
const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const parserSource = readFileSync(new URL("../lib/federal-money/parse.ts", import.meta.url), "utf8");
const sourceParserSha256 = digest(parserSource);
const facParserImplementationSha256 = digest(parserSource.slice(0, parserSource.indexOf("function spending(")) +
  parserSource.slice(parserSource.indexOf("function audit("), parserSource.indexOf("function entity(")) +
  parserSource.slice(parserSource.indexOf("export function parseFederalMoney(")));

interface StateProof {
  state: string;
  status: string;
  productionWrites: number;
  failure?: string;
  runs: Record<string, unknown>[];
  [key: string]: unknown;
}

function compactProof(proof: StateProof): StateProof {
  const cursor = (value: unknown): unknown => {
    if (!value || typeof value !== "object") return value;
    const { reportIds, ...fields } = value as FederalMoneyCursor;
    return { ...fields, ...(reportIds ? { reportIdsCount: reportIds.length, reportIdsSha256: digest(JSON.stringify(reportIds)) } : {}) };
  };
  return { ...proof,
    runs: proof.runs.map(run => ({ ...run, cursorBefore: cursor(run.cursorBefore), cursorAfter: cursor(run.cursorAfter) })),
    sourceCaptures: ((proof.sourceCaptures as Record<string, unknown>[] | undefined) ?? []).map(capture => {
      const { url, ...metadata } = capture;
      const request = new URL(String(url));
      const reports = request.searchParams.get("report_id");
      request.searchParams.delete("report_id");
      return { ...metadata, routeAndQuery: request.href, requestSha256: digest(String(url)),
        ...(reports ? { reportFilterCount: reports.startsWith("in.(") ? reports.slice(4, -1).split(",").length : 1, reportFilterSha256: digest(reports) } : {}) };
    }),
  };
}

async function replayState(postal: string): Promise<StateProof> {
  assert.ok(sourceStates.includes(postal));
  const directory = join(cacheRoot, postal);
  await mkdir(directory, { recursive: true });
  const productionQueries: { hash: string; rows: number; bytes: number }[] = [];
  const connection = savedOnly ? null : readFileSync(connectionFile, "utf8").trim();
  if (connection) assert.equal(decodeURIComponent(new URL(connection).username), "readonly");
  const sql = connection ? neon(connection) : null;
  const query: ReadOnlyQuery = async statements => {
    const key = digest(JSON.stringify(statements));
    const path = join(directory, `production-${key}.json`);
    const rows = savedOnly
      ? JSON.parse(await readFile(path, "utf8")) as (readonly Row[])[]
      : await sql!.transaction(statements.map(statement => sql!.query(statement.text, [...statement.params])), { readOnly: true }) as unknown as (readonly Row[])[];
    if (!savedOnly) await writeFile(path, JSON.stringify(rows));
    productionQueries.push({ hash: key, rows: rows.reduce((count, values) => count + values.length, 0), bytes: Buffer.byteLength(JSON.stringify(rows)) });
    return rows;
  };
  const [who] = await query([{ text: "SELECT current_user AS role, current_setting('transaction_read_only') AS read_only", params: [] }]);
  assert.equal(who[0]?.role, "readonly"); assert.equal(who[0]?.read_only, "on");
  const [before] = await query([{
    text: "SELECT (SELECT count(*)::int FROM civic_data_candidates WHERE source_id=$1 AND record_class='FEDERAL_MONEY' AND scope=$2 AND state='PROMOTED') AS promoted_candidates," +
      " (SELECT count(*)::int FROM civic_data_promotions WHERE record_class='FEDERAL_MONEY' AND source_id=$1 AND scope LIKE $2 || ':%') AS promoted_partitions," +
      " (SELECT current_version_id FROM civic_data_promotions WHERE record_class='REGISTRATION' AND scope=$3) AS registration_version",
    params: [source, `${source}:${postal}`, `US-${postal}:registration:v1`],
  }]);
  const captures: Record<string, unknown>[] = [];
  let lastSourceObservedAt: string | null = null;
  const fetchSource: typeof fetch = async (request, init) => {
    const url = typeof request === "string" ? request : request instanceof URL ? request.href : request.url;
    const target = new URL(url);
    assert.equal(target.protocol, "https:");
    assert.ok(target.hostname.endsWith(".gov") && target.hostname !== "api.sam.gov", "Only FAC's government source routes are read");
    const key = digest(url), bodyPath = join(directory, `source-${key}.body`), metadataPath = join(directory, `source-${key}.json`);
    let metadata: { url: string; status: number; headers: Record<string, string>; retrievedAt: string; sha256: string; bytes: number };
    if (savedOnly) metadata = JSON.parse(await readFile(metadataPath, "utf8"));
    else {
      const response = await fetch(request, init);
      const headers = Object.fromEntries(["content-type", "content-range", "last-modified", "retry-after"].flatMap(name => response.headers.has(name) ? [[name, response.headers.get(name)!]] : []));
      if (response.body) await pipeline(Readable.fromWeb(response.body as never), createWriteStream(bodyPath));
      else await writeFile(bodyPath, "");
      const hash = createHash("sha256"); let bytes = 0;
      for await (const chunk of createReadStream(bodyPath)) { hash.update(chunk); bytes += chunk.length; }
      metadata = { url, status: response.status, headers, retrievedAt: new Date().toISOString(), sha256: hash.digest("hex"), bytes };
      await writeFile(metadataPath, JSON.stringify(metadata));
    }
    captures.push(metadata);
    lastSourceObservedAt = metadata.retrievedAt;
    return new Response(Readable.toWeb(createReadStream(bodyPath)) as ReadableStream<Uint8Array>, { status: metadata.status, headers: metadata.headers });
  };
  const store = new MemoryRoutineDataStore(), evidenceStore = new MemoryEvidenceStore();
  await rm(join(directory, "reader"), { recursive: true, force: true });
  const artifacts = new LocalFileArtifactStore(join(directory, "reader"));
  const heldReports = new Map<string, FederalMoneyHeldAudit>();
  const proof: StateProof = { state: postal, status: "FAILED", productionWrites: 0, sourceParserSha256, facParserImplementationSha256, productionIdentity: who[0], productionBefore: before[0], runs: [] };
  const division = federalMoneyStateDivision(postal);
  let clock = baseAt, requestedCursor: FederalMoneyCursor | null = null;
  const originalNow = Date.now;
  Date.now = () => Date.parse(clock);
  try {
    const input = {
      source, store, states: [postal], now: () => clock, maxRounds: 1,
      acquireOptions: { evidenceStore, fetch: fetchSource, cacheRoot: join(cacheRoot, "bulk") },
      acquire: async (...args: Parameters<typeof acquireFederalMoney>) => {
        requestedCursor = args[2]?.cursor ?? null;
        const page = await acquireFederalMoney(args[0], args[1], { ...args[2], now: () => lastSourceObservedAt ?? new Date().toISOString() });
        clock = new Date(Math.max(Date.parse(clock), ...page.captures.map(capture => Date.parse(capture.retrievedAt)))).toISOString();
        return page;
      },
      identities: async (current: string, facts: Parameters<typeof readFederalMoneyJoinInput>[1]) => {
        const identities = await readFederalMoneyJoinInput(current, facts, query);
        const ids = new Set(facts.flatMap(fact => fact.identifiers.reportId ? [fact.identifiers.reportId] : []));
        return { ...identities, auditReports: [...identities.auditReports ?? [], ...[...heldReports.values()].filter(report => ids.has(report.reportId))] };
      },
      onPartition: async (change: FederalMoneyPartitionChange) => {
        for (const fact of change.projection.records) if (fact.details.table === "general" && fact.identifiers.reportId) heldReports.set(fact.identifiers.reportId,
          { reportId: fact.identifiers.reportId, uei: fact.uei, identifiers: fact.identifiers, bodyIds: fact.bodyIds, divisionIds: fact.divisionIds });
        return publishFederalMoneyPartition({ ...change, store: artifacts });
      },
      onProgress: (row: { state: string; status: string; reason: string | null }, at: string) => publishFederalMoneyProgress({ store: artifacts, state: row.state, source, checkedAt: at, complete: row.status === "COMPLETE", reason: row.reason }),
    };
    let initialIds = new Set<string>();
    let firstSucceededAt: string | null = null;
    for (let runIndex = 0; runIndex < 2; runIndex++) {
      clock = runIndex === 0 ? baseAt : new Date(Date.parse(firstSucceededAt!) + 86_400_000).toISOString();
      const prior = await store.readPromotion("FEDERAL_MONEY", `${source}:${postal}`);
      const priorCursor = (prior?.payload as { checkpoint?: { cursor?: FederalMoneyCursor | null } } | undefined)?.checkpoint?.cursor ?? null;
      const task = routineTaskFromContract(requiredRoutineContract(source));
      const scheduling = await store.clock(source, "FEDERAL_MONEY", `${source}:US`, task.parserVersion);
      assert.equal(routineTaskDue(task, scheduling, Date.parse(clock)), true);
      const result = await refreshFederalMoney(input);
      const at = clock;
      if (runIndex === 0) firstSucceededAt = at;
      assert.ok(result.outcome.promoted, result.outcome.candidate.failureDetail ?? "No registered publication");
      assert.deepEqual(requestedCursor, priorCursor);
      const readerCheck = await verifyRoutineReaderProjection(requiredRoutineContract(source), { store, now: at, expectedVersionId: result.outcome.promoted.versionId, scope: result.outcome.promoted.scope });
      assert.equal(readerCheck.status, "PASS", readerCheck.detail);
      const ids = new Set<string>(); let bodyMatches = 0;
      for (const pointer of await store.listPromotionScopes(["FEDERAL_MONEY"])) {
        if (!pointer.scope.startsWith(`${source}:${postal}:`)) continue;
        const held = await store.readPromotion<FederalMoneyProjection>("FEDERAL_MONEY", pointer.scope);
        for (const fact of held?.payload.records ?? []) { ids.add(fact.id); bodyMatches += fact.bodyIds.length; }
      }
      assert.equal(ids.size, result.projection.counts.loaded);
      let pages = 0, visible = 0, htmlBytes = 0;
      const renderedIds = new Set<string>(), htmlHash = createHash("sha256");
      if (division) {
        let cursor: string | null = null;
        do {
          const read = await readFederalMoneyForPlace({ divisionId: division }, { artifactStore: artifacts, cursor });
          const records = read.sources.find(row => row.source === source)!;
          assert.ok(records.status !== "UNAVAILABLE");
          const html = renderToStaticMarkup(createElement(FederalMoneySection, { divisionId: division, data: read }));
          htmlHash.update(html); htmlBytes += Buffer.byteLength(html);
          for (const record of records.records) { assert.ok(html.includes(`data-federal-record="${record.id}"`)); renderedIds.add(record.id); }
          visible += records.records.length; pages++; cursor = read.nextCursor;
          if (pages === 1) await writeFile(join(directory, runIndex === 0 ? "first-reader.html" : "tomorrow-reader.html"), html);
        } while (cursor);
        assert.equal(renderedIds.size, ids.size, "Every accepted record in this state slice reaches the public state reader and actual component");
        assert.ok([...initialIds].every(id => renderedIds.has(id)), "Prior accepted records remain readable on tomorrow's run");
      } else assert.equal(result.projection.counts.joined, 0, "Unresolved source state must not acquire a fabricated public location");
      proof.runs.push({ at, status: result.outcome.candidate.state, publishedRecords: ids.size, counts: result.projection.counts, bodyMatches,
        publicationVersion: result.outcome.promoted.versionId, typedReader: readerCheck.status, scheduledDue: true, continuationResumed: runIndex !== 0,
        cursorBefore: priorCursor, cursorAfter: result.projection.states[0].cursor, readerDivision: division, readerRecords: renderedIds.size,
        readerPages: pages, renderedRows: visible, cardHtmlBytes: htmlBytes, cardHtmlSha256: htmlHash.digest("hex"), priorAcceptedRowsRetained: initialIds.size });
      if (runIndex === 0) initialIds = ids;
    }
    proof.status = division ? "PASS" : "UNRESOLVED_LOCATION_RETAINED";
    if (!division) proof.reason = "ZZ is the source's unresolved-state bucket, not a US jurisdiction; source rows are retained without inventing a reader location.";
  } catch (error) {
    proof.failure = error instanceof Error ? error.message : String(error);
    if (proof.failure.includes("distinct source rows share one native finding identity")) {
      proof.failureKind = "PUBLISHER_ROWS_CONFLICT_WITHOUT_UNIQUE_ID";
      proof.reason = "Different same-date official findings share report, finding reference, award and requirement identifiers. Neither has a unique source row ID, so code preserves the source response and retains previously verified audits instead of inventing a winning flag value.";
    }
    if (division && proof.runs.length) {
      const kept = new Set<string>(); let cursor: string | null = null;
      do {
        const read = await readFederalMoneyForPlace({ divisionId: division }, { artifactStore: artifacts, cursor });
        const held = read.sources.find(row => row.source === source)!;
        assert.equal(held.status, "HELD");
        const html = renderToStaticMarkup(createElement(FederalMoneySection, { divisionId: division, data: read }));
        for (const record of held.records) { assert.ok(html.includes(`data-federal-record="${record.id}"`)); kept.add(record.id); }
        cursor = read.nextCursor;
      } while (cursor);
      proof.afterFailure = { retainedReaderRecords: kept.size, actualCardRendering: "PASS", priorPublishedRecords: proof.runs.at(-1)?.publishedRecords };
      assert.equal(kept.size, proof.runs.at(-1)?.publishedRecords);
    }
  }
  finally {
    Date.now = originalNow;
    proof.productionQueries = productionQueries;
    proof.sourceCaptures = captures;
    proof.readerLocation = division;
    await writeFile(join(directory, "result.json"), JSON.stringify(proof, null, 2));
  }
  return proof;
}

if (state) {
  const proof = await replayState(state);
  console.log(JSON.stringify({ state, status: proof.status, runs: proof.runs.map(row => ({ records: row.publishedRecords, reader: row.readerRecords })), failure: proof.failure ?? null }));
  if (proof.status === "FAILED") process.exitCode = 1;
} else {
  await mkdir(cacheRoot, { recursive: true });
  const results: StateProof[] = new Array(sourceStates.length);
  let nextState = 0;
  await Promise.all(Array.from({ length: 2 }, async () => {
  for (;;) {
    const index = nextState++;
    if (index >= sourceStates.length) return;
    const postal = sourceStates[index];
    const resultPath = join(cacheRoot, postal, "result.json");
    const priorResult = existsSync(resultPath) ? JSON.parse(await readFile(resultPath, "utf8")) as StateProof : null;
    const reusable = process.argv.includes("--resume") && priorResult?.facParserImplementationSha256 === facParserImplementationSha256 && ["PASS", "UNRESOLVED_LOCATION_RETAINED"].includes(priorResult.status);
    if (!reusable) {
      const args = [...process.execArgv, fileURLToPath(import.meta.url), `--state=${postal}`, `--at=${baseAt}`, `--cache=${cacheRoot}`, `--connection-file=${connectionFile}`, ...(savedOnly ? ["--saved"] : [])];
      await new Promise<void>(resolveChild => {
        const child = spawn(process.execPath, args, { cwd: process.cwd(), env: process.env, stdio: ["ignore", "inherit", "inherit"] });
        child.once("exit", () => resolveChild());
      });
    }
    let proof: StateProof;
    try { proof = JSON.parse(await readFile(resultPath, "utf8")) as StateProof; }
    catch { proof = { state: postal, status: "FAILED", productionWrites: 0, failure: "State replay exited before writing its evidence", runs: [] }; }
    results[index] = proof;
  }
  }));
  await mkdir(resolve(output, ".."), { recursive: true });
  await writeFile(output, JSON.stringify({ source, productionWrites: 0, productionProject: "tiny-hill-13996172", productionBranch: "br-delicate-lab-ax02xuo5", role: "readonly",
      coverageFrom: "federalMoneySourceStates('federal-audit-clearinghouse')", coverageCount: sourceStates.length, coverage: sourceStates,
      inputToReader: "Actual publisher bytes + production read-only identity joins -> registered local promotion -> bounded local reader artifacts -> public state reader -> actual FederalMoneySection",
      nextRun: "Controlled tomorrow clock; scheduler admission, persisted continuation, actual subsequent publisher response, registered promotion, public reader and rendering are all checked. No future production run is claimed.",
      slice: "One actual scheduled source page per jurisdiction on each of two runs; source cursors and declared totals are retained. This is not a completed historical backfill.",
      generatedAt: new Date().toISOString(), complete: results.length === sourceStates.length, stateWorkers: 2, results: results.map(compactProof) }, null, 2) + "\n");
  console.log(JSON.stringify({ output, scopes: results.length, passed: results.filter(row => row.status === "PASS").length, unresolved: results.filter(row => row.status === "UNRESOLVED_LOCATION_RETAINED").length,
    failed: results.filter(row => row.status === "FAILED").map(row => ({ state: row.state, reason: row.failure })) }));
  if (results.some(row => row.status === "FAILED")) process.exitCode = 1;
}
