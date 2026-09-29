/**
 * Fail-closed successor readback planner. This executable reads sanitized,
 * exact-key V2 authority artifacts and complete Reader censuses. It does not
 * turn a plan into public delivery evidence: a later hosted executor must
 * actually read every affected Reader surface and bind before/after authority.
 * No Ask request or provider call is made here.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildReaderExecutionAuthorityEvidence,
  canonicalReaderAuthorityJson,
  readerAuthorityAffectedSurfaces,
  readerAuthorityChangedPointers,
  readerAuthorityChangedKeyHistoryProblems,
  readerAuthorityPostReadbackProblems,
  readerAuthoritySuccessorCensusProblems,
  readerAuthoritySuccessorProblems,
  readerSuccessorPublicProbeKind,
} from "../lib/holdings/reader-execution-authority.ts";
import { applyReaderApplicability, buildReaderCensus, composeCanonicalRouteProofs,
  projectCanonicalReaderRecords, readerRowStructuralSha256, readerSourceFingerprint,
  reconcileDelivery, type ReaderCensus,
  type ReaderClosureExecutionAuthorityEvidence } from "../lib/holdings/reader-census.ts";
import { PUBLIC_SITE_ORIGIN } from "../lib/ops/origins.ts";
import { createNeonReaderAuthoritySql } from "./reader-execution-authority-evidence.mts";
import { prepareReaderProofRuntime, requiredPreparedReaderProofMeetingsAuthority } from "./lib/reader-proof-runtime.ts";

const args = process.argv.slice(2);
function option(name: string): string {
  const at = args.indexOf(name);
  if (at < 0 || !args[at + 1] || args[at + 1]!.startsWith("--")) {
    throw new Error(`Missing required ${name} path`);
  }
  return args[at + 1]!;
}
function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(path), "utf8")) as T;
}

const certified = readJson<ReaderClosureExecutionAuthorityEvidence>(option("--certified-authority"));
const current = readJson<ReaderClosureExecutionAuthorityEvidence>(option("--current-authority"));
const certifiedCensus = readJson<ReaderCensus>(option("--certified-census"));
const currentCensus = readJson<ReaderCensus>(option("--current-census"));
const changedPointers = readerAuthorityChangedPointers(certified, current);
const classes = [...new Set(changedPointers.map((pointer) => pointer.recordClass))].sort();
const affected = readerAuthorityAffectedSurfaces(classes);
const census = readerAuthoritySuccessorCensusProblems(certifiedCensus, currentCensus,
  classes, readerRowStructuralSha256);
const authorityProblems = readerAuthoritySuccessorProblems(certified, current);
const changedMessages = new Set(changedPointers.map((pointer) =>
  `Reader execution authority changed ${pointer.recordClass} key ${pointer.key}; exact successor projection and public readback are unproved`));
const otherAuthorityProblems = authorityProblems.filter((problem) => !changedMessages.has(problem));
const rowById = new Map(currentCensus.rows.map((row) => [row.id, row]));
const requiredRows = census.affectedRowIds.map((id) => {
  const row = rowById.get(id)!;
  return { rowId: id, surface: row.readerSurface, family: row.datasetFamily, state: row.state,
    eligibleRecordCount: (row.applicableEligibleRecordIds ?? row.eligibleRecordIds).length };
});
const status = certified.formatVersion !== 2 || current.formatVersion !== 2 ||
  otherAuthorityProblems.length || census.problems.length || affected.unknownClasses.length
  ? "BLOCKED_BASELINE_OR_PROJECTION"
  : changedPointers.length ? "BLOCKED_PENDING_HISTORICAL_CHAIN_AND_PUBLIC_READBACK"
    : "NO_CHANGED_POINTER_READBACK_REQUIRED";
const report = {
  formatVersion: 1,
  status,
  certifiedHead: certified.exactHead,
  currentHead: current.exactHead,
  changedPointers,
  affectedSurfaces: affected.surfaces,
  unclassifiedRecordClasses: affected.unknownClasses,
  requiredRows,
  authorityProblems,
  censusProblems: census.problems,
  execution: { publicRequests: 0, paidRequests: 0, publicReadbackComplete: false,
    historicalChainChecked: false, postReadbackAuthorityChecked: false },
  rule: "This plan never admits a changed pointer. Every required row needs an executed, exact-current-public-origin witness with the full applicable identity/count set; the old certified pointer and every successor candidate need immutable GOOD-chain verification, then authority must remain exact across readback. Ask must have a deterministic no-paid proof path or remains blocked.",
};
if (args.includes("--execute")) {
  let stage = "INPUT";
  try {
  const root = process.cwd();
  const connection = process.env.WTP_PRODUCTION_DATABASE_URL_READONLY?.trim() ?? "";
  if (process.env.DATABASE_URL && process.env.DATABASE_URL !== connection) {
    throw new Error("Successor local selector is not bound to the read-only production handle");
  }
  const deployedCommit = option("--deployed-commit");
  const evidenceOutput = option("--evidence-output");
  const probePlan = readJson<{ readonly probes: readonly { readonly key: string; readonly path: string }[] }>(option("--probes"));
  if (!/^[0-9a-f]{40}$/.test(deployedCommit) || !/^docs\/evidence\/reader-last-mile-successor-[a-z0-9-]+\.json$/.test(evidenceOutput)) {
    throw new Error("Successor execution requires a deployed commit and a new named evidence path");
  }
  if (status !== "BLOCKED_PENDING_HISTORICAL_CHAIN_AND_PUBLIC_READBACK" || !connection ||
      !Array.isArray(probePlan.probes) || !probePlan.probes.length || probePlan.probes.length > 256 ||
      new Set(probePlan.probes.map((probe) => probe.path)).size !== probePlan.probes.length ||
      changedPointers.some((pointer) => !probePlan.probes.some((probe) => probe.key === pointer.key)) ||
      probePlan.probes.some((probe) => !changedPointers.some((pointer) => pointer.key === probe.key))) {
    throw new Error("Successor execution plan is incomplete, unbounded, or has no exact changed-key binding");
  }
  const sql = createNeonReaderAuthoritySql(connection);
  const authorityOptions = {
    phase: current.phase, exactHead: current.exactHead, connection, sql,
    providerMetadataPath: current.store.providerMetadataPath,
    providerMetadataBytes: readFileSync(resolve(current.store.providerMetadataPath)),
    importReceiptPath: current.import.receiptPath,
    importReceiptBytes: readFileSync(resolve(current.import.receiptPath)),
  } as const;
  stage = "AUTHORITY_BEFORE";
  const before = await buildReaderExecutionAuthorityEvidence(authorityOptions);
  if (canonicalReaderAuthorityJson(before) !== canonicalReaderAuthorityJson(current)) {
    throw new Error("Successor authority advanced before hosted public readback");
  }
  stage = "HISTORICAL_CHAIN";
  const history = await readerAuthorityChangedKeyHistoryProblems(certified, before, sql);
  if (history.length) throw new Error(`Successor predecessor or GOOD-chain proof failed for ${history.length} key(s)`);
  stage = "CURRENT_CENSUS";
  await prepareReaderProofRuntime();
  const liveBase = buildReaderCensus(root);
  const projection = await projectCanonicalReaderRecords(root, liveBase, requiredPreparedReaderProofMeetingsAuthority());
  const liveCensus = applyReaderApplicability(liveBase, projection);
  const staleCensus = readerAuthoritySuccessorCensusProblems(currentCensus, liveCensus, [], readerRowStructuralSha256);
  const liveImpact = readerAuthoritySuccessorCensusProblems(certifiedCensus, liveCensus,
    classes, readerRowStructuralSha256);
  if (projection.failures.length || staleCensus.problems.length || liveImpact.problems.length ||
      JSON.stringify(liveImpact.affectedRowIds) !== JSON.stringify(census.affectedRowIds)) {
    throw new Error("Successor live Reader projection, eligibility, or prepared census differs from the certified obligation");
  }
  const buildRead = async () => {
    const response = await fetch(`${PUBLIC_SITE_ORIGIN}/api/build`, { cache: "no-store" });
    if (response.status !== 200) throw new Error("Public Reader build identity is unavailable");
    const build = await response.json() as { commit?: unknown };
    if (build.commit !== deployedCommit) throw new Error("Public Reader serves a different deployed commit");
  };
  stage = "PUBLIC_BUILD_BEFORE";
  await buildRead();
  const records: Record<string, unknown>[] = [];
  stage = "PUBLIC_ROUTE_READBACK";
  for (const probe of probePlan.probes) {
    const url = new URL(probe.path, PUBLIC_SITE_ORIGIN);
    const kind = readerSuccessorPublicProbeKind(probe.path);
    if (!kind) throw new Error("Successor probe is not an approved no-provider public route");
    const localRequest = new Request(`http://localhost${probe.path}`, { headers: { "x-wtp-synthetic-run": "reader-successor" } });
    let localResponse: Response;
    if (kind === "representation") {
      const { GET } = await import("../app/api/representation/[...division]/route.ts");
      const division = url.pathname.slice("/api/representation/".length).split("/");
      localResponse = await GET(localRequest, { params: Promise.resolve({ division }) });
    } else if (kind === "meetings") {
      const { GET } = await import("../app/api/meetings/route.ts");
      localResponse = await GET(localRequest);
    } else if (kind === "agenda") {
      const { GET } = await import("../app/api/agenda/route.ts");
      localResponse = await GET(localRequest);
    } else {
      const { GET } = await import("../app/api/votes/route.ts");
      localResponse = await GET(localRequest);
    }
    const publicResponse = await fetch(url, { cache: "no-store", headers: { "x-wtp-synthetic-run": "reader-successor" } });
    if (localResponse.status !== 200 || publicResponse.status !== 200) {
      throw new Error("Successor local or public route returned a non-success status");
    }
    const expected = await localResponse.json() as Record<string, unknown>;
    const actual = await publicResponse.json() as Record<string, unknown>;
    if (canonicalReaderAuthorityJson(expected) !== canonicalReaderAuthorityJson(actual)) {
      throw new Error("Successor public route differs from its current canonical selector");
    }
    const payloadSha256 = createHash("sha256").update(canonicalReaderAuthorityJson(actual)).digest("hex");
    const values = (value: unknown) => Array.isArray(value) ? value as Record<string, unknown>[] : [];
    if (kind === "representation") {
      const division = decodeURIComponent(url.pathname.slice("/api/representation/".length));
      const ids = values(actual.holders).map((holder) => String(holder.id));
      records.push({ surface: "representation", division, expectedIds: ids, returnedIds: ids,
        returnedCount: ids.length, payload: actual, payloadSha256, publicPath: probe.path,
        pointerKey: probe.key });
    } else if (kind === "meetings") {
      const meetings = values(actual.meetings);
      records.push({ surface: "meetings/map", returnedCount: meetings.length,
        identities: meetings.map((meeting) => ({ id: meeting.id, bodyId: meeting.bodyId })),
        payloadSha256, publicPath: probe.path, pointerKey: probe.key });
    } else if (kind === "agenda") {
      const documents = values(actual.documents);
      const ids = documents.map((document) => String(document.id));
      records.push({ surface: "agenda", meetingId: url.searchParams.get("meetingId"),
        documents, expectedIds: ids, returnedIds: ids, returnedCount: ids.length,
        payloadSha256, publicPath: probe.path, pointerKey: probe.key });
    } else {
      const votes = values(actual.votes);
      records.push({ surface: "votes", member: url.searchParams.get("member"),
        expectedCount: votes.length, statedCount: actual.count, returnedCount: votes.length,
        canonicalIds: votes.map((vote) => String(vote.id)), payloadSha256,
        publicPath: probe.path, pointerKey: probe.key });
    }
  }
  stage = "PUBLIC_BUILD_AFTER";
  await buildRead();
  stage = "AUTHORITY_AFTER";
  const after = await buildReaderExecutionAuthorityEvidence(authorityOptions);
  if (readerAuthorityPostReadbackProblems(before, after).length) {
    throw new Error("Successor authority advanced during hosted public readback");
  }
  const evidence = { exactHead: current.exactHead, deployedCommit, origin: PUBLIC_SITE_ORIGIN,
    beforeAuthority: canonicalReaderAuthorityJson(before), afterAuthority: canonicalReaderAuthorityJson(after),
    sourceHashes: readerSourceFingerprint(root), records, failures: [] as string[] };
  writeFileSync(resolve(evidenceOutput), `${JSON.stringify(evidence, null, 2)}\n`, { flag: "wx" });
  stage = "CENSUS_RECONCILIATION";
  const composed = composeCanonicalRouteProofs(root, liveCensus, [evidenceOutput]);
  const unproved: string[] = [];
  for (const rowId of liveImpact.affectedRowIds) {
    const original = liveCensus.rows.find((row) => row.id === rowId)!;
    let row: ReaderCensus["rows"][number] = { ...original, provedHead: undefined, observedExpectedRecordIds: [],
      observedRenderedRecordIds: [], bundleProvedRecordIds: [] };
    for (const proof of composed.proofs.filter((proof) => proof.rowId === rowId)) {
      const result = reconcileDelivery(row, proof, root);
      row = result.row;
      if (result.failures.length) unproved.push(rowId);
    }
    if (row.deliveryState !== "RENDERED" || row.falseNegativeCount !== 0 || row.falsePositiveCount !== 0) {
      unproved.push(rowId);
    }
  }
  const final = { ...report, status: unproved.length || composed.failures.length
    ? "BLOCKED_INCOMPLETE_PUBLIC_READBACK" : "PUBLIC_READBACK_MEASURED_PENDING_TERMINAL_ADMISSION",
    execution: { publicRequests: probePlan.probes.length + 2, paidRequests: 0,
      publicReadbackComplete: unproved.length === 0 && composed.failures.length === 0,
      historicalChainChecked: true, postReadbackAuthorityChecked: true },
    evidenceOutput, unprovedRows: [...new Set(unproved)].sort(), routeFailures: composed.failures };
  const serialized = `${JSON.stringify(final, null, 2)}\n`;
  const outputAt = args.indexOf("--output");
  if (outputAt >= 0) writeFileSync(resolve(option("--output")), serialized);
  else process.stdout.write(serialized);
  process.exit(unproved.length || composed.failures.length ? 1 : 0);
  } catch {
    const failure = { status: "BLOCKED", stage, publicReadbackComplete: false,
      paidRequests: 0, reason: "A source, route, authority, or proof check failed; no public delivery credit was granted." };
    const outputAt = args.indexOf("--output");
    if (outputAt >= 0) writeFileSync(resolve(option("--output")), `${JSON.stringify(failure, null, 2)}\n`);
    process.stderr.write(`${JSON.stringify(failure)}\n`);
    process.exit(1);
  }
}
const serialized = `${JSON.stringify(report, null, 2)}\n`;
const outputAt = args.indexOf("--output");
if (outputAt >= 0) writeFileSync(resolve(option("--output")), serialized);
else process.stdout.write(serialized);
process.exit(status === "NO_CHANGED_POINTER_READBACK_REQUIRED" ? 0 : 1);
