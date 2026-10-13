import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

import { processRegisteredRoutineCandidate } from "../lib/civic-data/promotion.ts";
import { routineTaskDue, routineTaskFromContract } from "../lib/civic-data/runner.ts";
import {
  durableRoutineRunnerReceiptIssue,
  parseRoutineRunnerReceipt,
} from "../lib/civic-data/runner-receipt.ts";
import {
  isSourceAcquisitionFailure,
  readPublisherBody,
  recordRegisteredSourceAcquisitionFailure,
  requestPublisher,
  sourceAcquisitionFailure,
  withPublisherAcquisitionDeadline,
} from "../lib/civic-data/source-acquisition-failure.ts";
import {
  ROUTINE_SOURCE_ACQUISITION_TIMEOUT_MS,
  ROUTINE_SOURCE_SETTLEMENT_BUDGET_MS,
  runInSourceAcquisitionDomain,
  sourceAcquisitionSleep,
} from "../lib/sources/acquisition-deadline.ts";
import { curlGetText, politeGetText } from "../lib/sources/http.ts";
import { ROUTINE_CHILD_TIMEOUT_MS } from "../lib/civic-data/bounded-child-pass.ts";
import { STANDING_NEON_REQUEST_DEADLINE_MS } from "../lib/ops/neon-request-deadline.ts";
import {
  fetch as fetchAcs,
  normalize as normalizeAcs,
  type AcsFetch,
} from "../lib/sources/census-acs-population/index.ts";
import { parseMembers } from "../scripts/nh-gencourt-members.mts";
import { requiredRoutineContract } from "../lib/civic-data/contracts.ts";
import { MemoryRoutineDataStore, type RoutineDataStore } from "../lib/civic-data/store.ts";
import { sourceProjectionEvidence, type RoutineCandidate } from "../lib/civic-data/types.ts";
import { fecFundingCandidate, normalizedHash } from "../lib/civic-data/candidate-builders.ts";
import { collectFecCandidate } from "../lib/funding/fec-collector.ts";
import type { FundingSnapshot } from "../lib/funding/types.ts";

const GOOD_AT = "2026-09-08T12:00:00.000Z";
const FAILED_AT = "2026-09-08T13:00:00.000Z";
const HASH = "a".repeat(64);

function goodFecCandidate(): RoutineCandidate {
  const normalizedPayload = { amount: 10 };
  const readModel = {
    formatVersion: 1 as const,
    candidates: [{ fecCandidateId: "H6AZ01001" }],
    absences: [],
  };
  return {
    id: "source-boundary-good-fec",
    sourceId: "fec-open-api",
    recordClass: "FEC_FUNDING",
    scope: "federal-supported",
    sourceProjectionEvidence: sourceProjectionEvidence("fec-open-api", "FEC_FUNDING", "federal-supported"),
    retrieval: {
      succeeded: true,
      requestedUrl: "https://api.open.fec.gov/v1/candidates/search/",
      finalUrl: "https://api.open.fec.gov/v1/candidates/search/",
      httpStatus: 200,
      retrievedAt: GOOD_AT,
      rawHash: HASH,
    },
    normalization: {
      succeeded: true,
      parserVersion: "fec-funding/4",
      schemaVersion: "2",
      normalizedHash: normalizedHash(readModel),
      normalizedPayloadHash: normalizedHash(normalizedPayload),
      inputRecords: 1,
      outputRecords: 1,
      droppedRecords: 0,
      missingRequiredFields: [],
    },
    identities: [{
      subjectId: "H6AZ01001",
      jurisdiction: "US",
      identifiers: { candidate_id: "H6AZ01001", committee_id: "C00999999" },
      matchBasis: "OFFICIAL_ID",
      ambiguous: false,
    }],
    temporal: {
      version: "2026",
      expectedVersion: "2026",
      sourceThrough: GOOD_AT,
      staleAtRetrieval: false,
    },
    semantics: { factKind: "filed campaign-finance total", violations: [] },
    horizon: {
      kind: "OPEN_FACT_SET",
      query: "registered 2026 federal candidates represented in Reader",
      returnedRecords: 1,
      declaredTotal: null,
      paginationComplete: true,
      claimsComplete: false,
    },
    absence: { claimsAbsence: false, basis: "NONE", exactSubject: null, exactHorizon: null },
    dependentChecks: [{ consumer: "Reader funding card", passed: true, detail: "accepted" }],
    normalizedPayload,
    readModel,
  };
}

test("a registered source failure is one durable attempt with retry clock and unchanged LKG", async () => {
  const store = new MemoryRoutineDataStore();
  const good = goodFecCandidate();
  const promoted = await processRegisteredRoutineCandidate(store, "fec-funding", good, GOOD_AT);
  assert.equal(promoted.promoted?.versionId, good.id);

  const recorded = await recordRegisteredSourceAcquisitionFailure({
    store,
    contractId: "fec-funding",
      requestedUrl: "https://api.open.fec.gov/v1/candidates/",
    attemptedAt: FAILED_AT,
    failure: sourceAcquisitionFailure("PUBLISHER_UNAVAILABLE", "FEC API request timed out."),
  });
  assert.equal(recorded.outcome.candidate.state, "SOURCE_BLOCKED");
  assert.equal(recorded.outcome.candidate.acquisitionSucceeded, false);
  assert.equal(recorded.outcome.candidate.lastKnownGoodVersion, good.id);
  assert.equal(recorded.outcome.promoted, null);
  assert.deepEqual((await store.events(recorded.receipt.candidateId)).map((event) => event.state), ["SOURCE_BLOCKED"]);
  assert.equal((await store.readPromotion("FEC_FUNDING", "federal-supported"))?.versionId, good.id);

  const parsed = parseRoutineRunnerReceipt(`${recorded.line}\n`);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.receipt.source, "fec-funding", "protocol identity is the exact registered task, not a publisher label");
  const task = routineTaskFromContract(requiredRoutineContract("fec-funding"));
  assert.equal(await durableRoutineRunnerReceiptIssue(parsed.receipt, task, store, "HELD"), null);
  assert.deepEqual(await store.clock(task.sourceId, task.recordClass, task.scope), {
    lastAttemptedAt: FAILED_AT,
    lastSucceededAt: GOOD_AT,
    lastSucceededObservedAt: GOOD_AT,
  });
  assert.equal(routineTaskDue(task, await store.clock(task.sourceId, task.recordClass, task.scope), Date.parse(FAILED_AT) + task.retryMs - 1), false);
  assert.equal(routineTaskDue(task, await store.clock(task.sourceId, task.recordClass, task.scope), Date.parse(FAILED_AT) + task.retryMs), true);
});

test("all five registered adapters can persist a well-formed source-scoped failure receipt", async () => {
  for (const [contractId, sourceLabel] of [
    ["fec-funding", "FEC OpenFEC"],
    ["nh-members", "NH General Court members"],
    ["census-acs-population", "Census ACS"],
    ["dotgov", "CISA dotgov"],
    ["nj-morris-filing", "Morris County Clerk filing"],
  ] as const) {
    const store = new MemoryRoutineDataStore();
    const recorded = await recordRegisteredSourceAcquisitionFailure({
      store,
      contractId,
      ...(contractId === "fec-funding" ? { requestedUrl: "https://api.open.fec.gov/v1/candidates/" } : {}),
      attemptedAt: FAILED_AT,
      failure: sourceAcquisitionFailure("PUBLISHER_RESPONSE_REFUSED", `${sourceLabel} answered HTTP 503.`),
    });
    const parsed = parseRoutineRunnerReceipt(recorded.line);
    assert.equal(parsed.ok, true, contractId);
    if (!parsed.ok) continue;
    assert.equal(parsed.receipt.source, contractId, `${contractId} must emit its exact task identity`);
    const task = routineTaskFromContract(requiredRoutineContract(contractId));
    assert.equal(await durableRoutineRunnerReceiptIssue(parsed.receipt, task, store, "HELD"), null, contractId);
    assert.equal((await store.events(parsed.receipt.candidateId)).length, 1, `${contractId} must write exactly one attempt event`);
    const clock = await store.clock(task.sourceId, task.recordClass, task.scope);
    assert.deepEqual(clock, { lastAttemptedAt: FAILED_AT });
    assert.equal(routineTaskDue(task, clock, Date.parse(FAILED_AT) + task.retryMs - 1), false, contractId);
    assert.equal(routineTaskDue(task, clock, Date.parse(FAILED_AT) + task.retryMs), true, contractId);
  }
});

test("a failed FEC candidate cannot mint an absence or block another candidate's verified totals", async () => {
  const store = new MemoryRoutineDataStore();
  const sourceBodies: string[] = [];
  const [received, failed] = await Promise.allSettled(["H6AZ01001", "H6AZ01002"].map(candidateId => collectFecCandidate({
    candidateId, cycle: 2026, targets: [{ targetKey: `fec:${candidateId}`, knownFecCandidateId: candidateId,
      displayName: `Fixture ${candidateId}`, state: "AZ", office: "H", district: "01", route: "roster" }],
    observedAt: () => GOOD_AT,
    read: async path => {
      if (candidateId === "H6AZ01002") throw sourceAcquisitionFailure("PUBLISHER_UNAVAILABLE", "FEC totals timed out.");
      const results = path.endsWith("/totals/") ? [{ candidate_id: candidateId, cycle: 2026, receipts: 10 }] : [];
      const page = { results, pagination: { count: results.length, pages: 1 }, sourceObservedAt: GOOD_AT };
      sourceBodies.push(JSON.stringify(page)); return page;
    },
  })));
  assert.equal(failed.status, "rejected");
  if (failed.status === "rejected") assert.ok(isSourceAcquisitionFailure(failed.reason));
  assert.equal(received.status, "fulfilled");
  if (received.status !== "fulfilled") return;
  assert.ok(received.value.candidate);
  const snapshot: FundingSnapshot = { formatVersion: 1, fetchedAt: GOOD_AT, cycle: 2026,
    candidates: [received.value.candidate], absences: [], secondHop: [],
    matchReport: { rosterMatched: 1, rosterTotal: 2, ballotMatched: 0, ballotTotal: 0 } };
  const candidate = fecFundingCandidate({ snapshot, rawBodies: sourceBodies,
    finalUrl: "https://api.open.fec.gov/v1/candidate/H6AZ01001/totals/?cycle=2026", retrievedAt: GOOD_AT,
    excludedFacts: [{ code: "FEC_CANDIDATE_RETAINED", detail: "H6AZ01002: source acquisition failed; no prior row or absence invented." }] });
  const published = await processRegisteredRoutineCandidate(store, "fec-funding", candidate, FAILED_AT);
  assert.ok(published.promoted, published.candidate.failureDetail ?? "");
  const held = (await store.readPromotion<FundingSnapshot>("FEC_FUNDING", "federal-supported"))!.payload;
  assert.deepEqual(held.candidates.map(row => row.fecCandidateId), ["H6AZ01001"]);
  assert.equal(held.candidates[0].totals.receipts, 10);
  assert.equal(held.candidates[0].provenance.collectedAt, GOOD_AT);
  assert.deepEqual(held.absences, []);
});

test("program/store/protocol exceptions cannot be relabelled as a source attempt", async () => {
  const store = new MemoryRoutineDataStore();
  await assert.rejects(
    recordRegisteredSourceAcquisitionFailure({
      store,
      contractId: "fec-funding",
      requestedUrl: "https://api.open.fec.gov/v1/candidates/",
      attemptedAt: FAILED_AT,
      failure: new Error("program defect") as never,
    }),
    /SOURCE_FAILURE_NOT_CLASSIFIED/,
  );
  assert.deepEqual(await store.clock("fec-open-api", "FEC_FUNDING", "federal-supported"), {});
});

test("an unavailable canonical store remains an operational failure and emits no synthetic receipt", async () => {
  const unavailableStore = {
    readPromotion: async () => { throw new Error("STORE_UNAVAILABLE"); },
  } as unknown as RoutineDataStore;
  await assert.rejects(
    recordRegisteredSourceAcquisitionFailure({
      store: unavailableStore,
      contractId: "fec-funding",
      requestedUrl: "https://api.open.fec.gov/v1/candidates/",
      attemptedAt: FAILED_AT,
      failure: sourceAcquisitionFailure("PUBLISHER_UNAVAILABLE", "The publisher timed out."),
    }),
    /STORE_UNAVAILABLE/,
  );
});

test("narrow publisher transport boundaries brand failures without leaking the thrown message", async () => {
  await assert.rejects(
    requestPublisher("Census ACS", async () => { throw new TypeError("https://api.census.gov/?key=SECRET"); }),
    (error: unknown) => error instanceof Error &&
      /publisher request did not complete \(TypeError\)/.test(error.message) &&
      !error.message.includes("SECRET"),
  );
  await assert.rejects(
    readPublisherBody("Morris County Clerk", async () => { throw new Error("socket with private detail"); }),
    (error: unknown) => error instanceof Error &&
      /response body could not be read \(Error\)/.test(error.message) &&
      !error.message.includes("private detail"),
  );
});

test("publisher request, body, and retry deadlines cancel their real work before reporting failure", async () => {
  const cases: readonly [
    string,
    (signal: AbortSignal, settle: () => void) => Promise<unknown>,
  ][] = [
    ["request", async (signal: AbortSignal, settle: () => void) =>
      requestPublisher("hung request", () => new Promise<Response>((_resolve, reject) => {
        const abort = () => { settle(); reject(signal.reason); };
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
      }))],
    ["body", async (signal: AbortSignal, settle: () => void) =>
      readPublisherBody("hung body", () => new Promise<string>((_resolve, reject) => {
        const abort = () => { settle(); reject(signal.reason); };
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
      }))],
    ["retry sleep", async (signal: AbortSignal, settle: () => void) => {
      try {
        await sourceAcquisitionSleep(60_000, signal);
      } finally {
        settle();
      }
      return "unreachable";
    }],
  ];
  for (const [kind, operation] of cases) {
    let active = 1;
    await assert.rejects(
      withPublisherAcquisitionDeadline(kind, 25, (signal) =>
        operation(signal, () => { active -= 1; })),
      (error: unknown) => isSourceAcquisitionFailure(error),
      kind,
    );
    assert.equal(active, 0, `${kind} settled from abort before its failure escaped`);
  }
});

test("the curl rung receives both a native deadline and an abortable process signal", async () => {
  let activeProcesses = 0;
  let observedMaxTime = false;
  await assert.rejects(
    runInSourceAcquisitionDomain(
      { sourceLabel: "curl fixture", timeoutMs: 25 },
      (signal) => curlGetText(
        "https://example.invalid/hung",
        { "User-Agent": "fixture" },
        signal,
        (args, options) => new Promise<Buffer>((_resolve, reject) => {
          activeProcesses += 1;
          observedMaxTime = args.includes("--max-time") && Number(args[args.indexOf("--max-time") + 1]) >= 1;
          assert.equal(options.signal, signal);
          const abort = () => {
            activeProcesses -= 1;
            reject(signal.reason);
          };
          if (signal.aborted) abort();
          else signal.addEventListener("abort", abort, { once: true });
        }),
        async () => [{address:"93.184.216.34",family:4}],
      ),
    ),
    /acquisition deadline/,
  );
  assert.equal(observedMaxTime, true);
  assert.equal(activeProcesses, 0, "curl process settled from abort before the domain returned");
});

test("the source deadline leaves a bounded durable-settlement window inside the outer child kill", () => {
  assert.equal(
    ROUTINE_SOURCE_ACQUISITION_TIMEOUT_MS + ROUTINE_SOURCE_SETTLEMENT_BUDGET_MS,
    ROUTINE_CHILD_TIMEOUT_MS,
  );
  assert.ok(
    ROUTINE_SOURCE_SETTLEMENT_BUDGET_MS >= 16 * STANDING_NEON_REQUEST_DEADLINE_MS,
    "at least sixteen sequential canonical-store transports fit after acquisition aborts",
  );
});

test("the shared meeting client cancels hung request/body work and its real retry sleep", async () => {
  for (const kind of ["request", "body"] as const) {
    let active = 0;
    const fetchImpl = ((_input: URL | RequestInfo, init?: RequestInit) => {
      const signal = init?.signal;
      assert.ok(signal);
      if (kind === "request") {
        active += 1;
        return new Promise<Response>((_resolve, reject) => {
          const abort = () => { active -= 1; reject(signal.reason); };
          if (signal.aborted) abort();
          else signal.addEventListener("abort", abort, { once: true });
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "text/plain" }),
        arrayBuffer: () => {
          active += 1;
          return new Promise<ArrayBuffer>((_resolve, reject) => {
            const abort = () => { active -= 1; reject(signal.reason); };
            if (signal.aborted) abort();
            else signal.addEventListener("abort", abort, { once: true });
          });
        },
      } as Response);
    }) as typeof fetch;

    await assert.rejects(
      runInSourceAcquisitionDomain(
        { sourceLabel: `meeting ${kind}`, timeoutMs: 25 },
        (signal) => politeGetText("https://example.invalid/meetings", { fetchImpl, signal }),
      ),
      /acquisition deadline/,
    );
    assert.equal(active, 0, `meeting ${kind} settled before its failure was reported`);
  }

  let attempts = 0;
  const started = Date.now();
  await assert.rejects(
    runInSourceAcquisitionDomain(
      { sourceLabel: "meeting retry", timeoutMs: 25 },
      (signal) => politeGetText("https://example.invalid/meetings", {
        signal,
        fetchImpl: async () => {
          attempts += 1;
          return new Response("busy", {
            status: 503,
            headers: { "retry-after": "60" },
          });
        },
      }),
    ),
    /acquisition deadline/,
  );
  assert.equal(attempts, 1, "the aborted retry sleep never launches another publisher request");
  assert.ok(Date.now() - started < 1_000, "Retry-After was interrupted by the source deadline");
});

test("a real acquisition deadline persists one exact source failure while retaining LKG", async () => {
  const store = new MemoryRoutineDataStore();
  const good = goodFecCandidate();
  await processRegisteredRoutineCandidate(store, "fec-funding", good, GOOD_AT);

  let failure: unknown;
  try {
    await withPublisherAcquisitionDeadline("FEC OpenFEC", 25, (signal) =>
      requestPublisher("FEC OpenFEC", () => new Promise<Response>((_resolve, reject) => {
        const abort = () => reject(signal.reason);
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
      })));
  } catch (error) {
    failure = error;
  }
  assert.equal(isSourceAcquisitionFailure(failure), true);
  if (!isSourceAcquisitionFailure(failure)) return;

  const recorded = await recordRegisteredSourceAcquisitionFailure({
    store,
    contractId: "fec-funding",
      requestedUrl: "https://api.open.fec.gov/v1/candidates/",
    attemptedAt: FAILED_AT,
    failure,
  });
  assert.equal(recorded.outcome.promoted, null);
  assert.equal(recorded.receipt.lastKnownGoodVersion, good.id);
  assert.equal((await store.readPromotion("FEC_FUNDING", "federal-supported"))?.versionId, good.id);
  assert.equal((await store.events(recorded.receipt.candidateId)).length, 1);
});

test("source parsers brand publisher evidence while a missing credential remains configuration", async () => {
  await assert.rejects(
    fetchAcs("zcta", undefined),
    (error: unknown) => error instanceof Error &&
      /CENSUS_API_KEY is not set/.test(error.message) &&
      !isSourceAcquisitionFailure(error),
  );
  await assert.rejects(
    fetchAcs("zcta", "test-key", async () => { throw new TypeError("network down"); }),
    (error: unknown) => isSourceAcquisitionFailure(error) && error.code === "PUBLISHER_UNAVAILABLE",
  );
  await assert.rejects(
    fetchAcs("zcta", "test-key", async () => new Response("not-json", { status: 200 })),
    (error: unknown) => isSourceAcquisitionFailure(error) && error.code === "PUBLISHER_DOCUMENT_INVALID",
  );
  const malformed: AcsFetch = {
    scope: "state",
    url: "https://api.census.gov/data/2024/acs/acs5",
    status: 200,
    fetchedAt: FAILED_AT,
    rows: [["NAME", "state"], ["Arizona", "04"]],
  };
  assert.throws(
    () => normalizeAcs(malformed),
    (error: unknown) => isSourceAcquisitionFailure(error) && error.code === "PUBLISHER_DOCUMENT_INVALID",
  );
  assert.throws(
    () => parseMembers("not a roster"),
    (error: unknown) => isSourceAcquisitionFailure(error) && error.code === "PUBLISHER_DOCUMENT_INVALID",
  );
});

test("dotgov refuses a registry CSV cut short of its declared length", async () => {
  // acquireDotGov reads the pinned SHA then the raw CSV through the global
  // fetch, so the completeness check is exercised by standing in a truncated
  // transfer whose row count would otherwise still have to clear the floor.
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("api.github.com")) {
      return new Response(JSON.stringify([{ sha: "a".repeat(40) }]), { status: 200 });
    }
    return new Response("Domain name,Domain type\nwhitehouse.gov,Federal Agency - Executive\n", {
      status: 200,
      headers: { "content-length": "5000000" },
    });
  }) as typeof fetch;
  try {
    const { acquireDotGov } = await import("../scripts/fetch-dotgov.mts");
    await assert.rejects(
      acquireDotGov(),
      (error: unknown) =>
        isSourceAcquisitionFailure(error) &&
        error.code === "PUBLISHER_RESPONSE_REFUSED" &&
        /short read/.test(error.message),
    );
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("each standing source entrypoint uses the source-aware durable failure door", () => {
  for (const path of [
    "scripts/fetch-fec.mts",
    "scripts/nh-gencourt-members.mts",
    "scripts/acs-population-promote.mts",
    "scripts/fetch-dotgov.mts",
    "scripts/build-nj-morris-ballot.mts",
  ]) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /recordRegisteredSourceAcquisitionFailure/, path);
    assert.match(source, /isSourceAcquisitionFailure/, path);
    assert.match(source, /ROUTINE_SOURCE_ACQUISITION_TIMEOUT_MS/, path);
    assert.match(source, /installNeonRequestDeadline\(\)/, path);
  }
  assert.match(readFileSync("scripts/ingest.ts", "utf8"), /installNeonRequestDeadline\(\)/);
});

test("every registered meeting capability carries the composite's exact abort signal to transport", () => {
  for (const capability of [
    "apptegy",
    "boardbook",
    "civicplus",
    "clerksboards",
    "civicclerk",
    "diligent",
    "ical",
    "iqm2",
    "revize",
    "schedulepage",
    "onbase",
    "legistar",
    "legistar-insite",
  ]) {
    const source = readFileSync(`lib/sources/${capability}/index.ts`, "utf8");
    assert.match(
      source,
      /signal:\s*(?:query|meetingQuery)\??\.signal/,
      `${capability} must not detach its HTTP work from the exact partition child`,
    );
  }
});

test("a receipt is fully transported through a child pipe before a nonzero exit", async () => {
  const payloadBytes = 512 * 1024;
  const program = [
    'import { writeRoutineReceiptLine } from "./lib/civic-data/receipt-output.ts";',
    `await writeRoutineReceiptLine("RCD_RECEIPT=" + "x".repeat(${payloadBytes}));`,
    "process.exit(2);",
  ].join("\n");

  const result = await new Promise<{ code: number | string | undefined; stdout: string; stderr: string }>((resolve) => {
    execFile(
      process.execPath,
      ["--experimental-strip-types", "--input-type=module", "--eval", program],
      { cwd: process.cwd(), encoding: "utf8", maxBuffer: 2 * 1024 * 1024 },
      (error, stdout, stderr) => resolve({
        code: error && "code" in error ? error.code ?? undefined : undefined,
        stdout,
        stderr,
      }),
    );
  });

  assert.equal(result.code, 2);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, `RCD_RECEIPT=${"x".repeat(payloadBytes)}\n`);
});
