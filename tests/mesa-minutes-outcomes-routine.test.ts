import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { meetingOutcomeEvidenceFor } from "../lib/ask/meeting-outcomes.ts";
import { buildTopicTimeline, composeTopicAnswer } from "../lib/ask/topic-timeline.ts";
import { cadenceMsAt, routineContract, ROUTINE_SOURCE_CONTRACTS } from "../lib/civic-data/contracts.ts";
import { MANUAL_PRODUCTION_SOURCE_CONTRACTS } from "../lib/civic-data/manual-contracts.ts";
import { MEETING_PARTITION_CONTRACTS, meetingPartitionId, observableRoutineContracts } from "../lib/civic-data/meeting-partitions.ts";
import { processRegisteredRoutineCandidate, routineCandidateContractIssue } from "../lib/civic-data/promotion.ts";
import { ROUTINE_SOURCE_TASKS, routineTaskFromContract } from "../lib/civic-data/runner.ts";
import { durableRoutineRunnerReceiptIssue, parseRoutineRunnerReceipt, successfulRoutineRunnerReceiptIssue } from "../lib/civic-data/runner-receipt.ts";
import { sourceAuthority } from "../lib/civic-data/source-authority.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { latestUnchangedConfirmation } from "../lib/civic-data/unchanged-confirmation.ts";
import { NEVER_READ } from "../lib/ops/freshness.ts";
import { MESA_LEGISTAR_MINUTES_OUTCOMES_CONTRACT, legistarOutcomesCandidate } from "../lib/outcomes/data-plane.ts";
import { applyMinutesApprovals, concludedSittingRows, minutesLinkFor, minutesSitting } from "../lib/outcomes/minutes-ingest.ts";
import {
  combinedOutcomeVersionId,
  combineOutcomeProjections,
  doorOutcomeParts,
  getOutcomeSnapshot,
  loadedFrom,
  outcomeEvidenceFor,
  outcomeGapWhose,
  primeOutcomeProjection,
  readDoorOutcomeProjection,
  refreshOutcomeSnapshotFromPromoted,
  resetOutcomeSnapshotCache,
} from "../lib/outcomes/store.ts";
import type { OutcomeSnapshot } from "../lib/outcomes/types.ts";
import { DATE_RANGE_CONTROL, parseCalendarRows } from "../lib/sources/legistar-insite/calendar.ts";
import { findTenant } from "../lib/sources/legistar-insite/tenant-registry.ts";
import { agendaTopicFor } from "../lib/routing/agenda-search.ts";
import {
  minutesOutcomeWindow,
  parseMinutesIngestArgs,
  rangesForWindow,
  runInSiteMinutesOutcomeIngest,
} from "../scripts/legistar-insite-minutes-ingest.mts";
import { withFetch } from "./helpers/with-fetch.ts";

const CONTRACT_ID = "mesa-legistar-minutes-outcomes";
const SCOPE = "US-AZ:place:mesa:legistar-minutes-outcomes";
const PIMA_SCOPE = "US-AZ:county:pima:legistar-outcomes";
const MESA = "ocd-division/country:us/state:az/place:mesa#governing";
const PIMA_BOARD = "ocd-division/country:us/state:az/county:pima#governing";
const DIR = "tests/fixtures/legistar-insite-mesa-minutes";
const HOUR = 60 * 60 * 1_000;
const tenant = findTenant("mesa")!;

const FRESH = readFileSync(`${DIR}/calendar-2026-09-25.html`, "utf8");
const THIS_YEAR = readFileSync("tests/fixtures/legistar-insite-mesa-calendar-this-year-paged.html", "utf8");
const THIS_YEAR_PAGE_2 = readFileSync("tests/fixtures/legistar-insite-mesa-calendar-this-year-page2.html", "utf8");

function textPdf(lines: readonly string[]): Uint8Array {
  const escape = (line: string) => line.replace(/[\\()]/g, (c) => `\\${c}`);
  const stream = `BT /F1 10 Tf 40 760 Td ${lines.map((line, i) => `${i === 0 ? "" : "0 -14 Td "}(${escape(line)}) Tj`).join(" ")} ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

/** Minutes that record no motion and do not say no action was taken: a failed extraction by rule. */
const MOTIONLESS = textPdf([
  "OFFICE OF THE CITY CLERK COUNCIL MINUTES July 20, 2026",
  "The City Council of the City of Mesa met in the Council Chambers on July 20, 2026, at 5:45 p.m.",
  "Mayor Freeman conducted a roll call and welcomed the Council and staff.",
  "Staff displayed a presentation and the Council discussed it.",
  "Adjournment. Without objection, the Regular Council Meeting adjourned at 7:02 p.m.",
]);

/** A recorded Mesa portal. A number answers that document with that status; bytes serve those bytes. */
function recordedPortal(options: {
  readonly calendarStatus?: number;
  readonly documents?: Readonly<Record<string, number>>;
  readonly bytes?: Readonly<Record<string, Uint8Array>>;
  /** A HEAD answered with this status (405: the portal refuses the check). */
  readonly headStatus?: number;
} = {}) {
  const requests: string[] = [];
  const html = (body: string) => new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
  const fetchImpl = async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? "GET";
    requests.push(`${method} ${url}`);
    const parsed = new URL(url);
    assert.equal(parsed.origin, "https://mesa.legistar.com", `unexpected host ${url}`);
    if (parsed.pathname === "/Calendar.aspx") {
      if (options.calendarStatus) return new Response("refused", { status: options.calendarStatus });
      if (method === "GET") return html(FRESH);
      const form = new URLSearchParams(String(init?.body ?? ""));
      if (form.get("__EVENTTARGET") === DATE_RANGE_CONTROL) {
        assert.equal(form.get(DATE_RANGE_CONTROL), "This Year", "only the range the window needs is asked for");
        return html(THIS_YEAR);
      }
      return html(THIS_YEAR_PAGE_2);
    }
    if (parsed.pathname === "/View.ashx" && parsed.searchParams.get("M") === "M") {
      const id = parsed.searchParams.get("ID")!;
      const status = options.documents?.[id];
      if (status !== undefined) return new Response("refused", { status });
      const bytes = options.bytes?.[id] ?? new Uint8Array(readFileSync(`${DIR}/minutes-${id}.pdf`));
      // Mesa's portal answers HEAD with the length and type and no ETag or Last-Modified.
      if (method === "HEAD") {
        if (options.headStatus) return new Response(null, { status: options.headStatus });
        return new Response(null, { status: 200, headers: { "content-type": "application/pdf", "content-length": String(bytes.byteLength) } });
      }
      return new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": "application/pdf" } });
    }
    throw new Error(`unrecorded portal route ${method} ${url}`);
  };
  return { requests, fetchImpl };
}

function steppedClock(startIso: string): () => string {
  let at = Date.parse(startIso);
  return () => {
    at += 1_000;
    return new Date(at).toISOString();
  };
}

async function pass(store: MemoryRoutineDataStore, portal: ReturnType<typeof recordedPortal>, window: { from: string; to: string }, clockStart: string) {
  const lines: string[] = [];
  const result = await withFetch(portal.fetchImpl, () => runInSiteMinutesOutcomeIngest({
    store,
    tenant,
    args: parseMinutesIngestArgs(["--promote", "--slug", "mesa"]),
    window,
    now: steppedClock(clockStart),
    log: (line) => lines.push(line),
    spacingMs: 0,
  }));
  return { result, lines };
}

async function verdict(store: MemoryRoutineDataStore, receiptLine: string | null, exitCode: number) {
  assert.ok(receiptLine);
  const parsed = parseRoutineRunnerReceipt(`diagnostic line\n${receiptLine}\n`);
  assert.ok(parsed.ok, "the child emits exactly one schema-valid RCD_RECEIPT line");
  const outcome = successfulRoutineRunnerReceiptIssue(parsed.receipt) === null ? "SUCCESS" : "HELD";
  assert.equal(exitCode === 0, outcome === "SUCCESS", "the process exit agrees with the durable receipt");
  const task = ROUTINE_SOURCE_TASKS.find(({ id }) => id === CONTRACT_ID)!;
  return { outcome, issue: await durableRoutineRunnerReceiptIssue(parsed.receipt, task, store, outcome), candidateId: parsed.receipt.candidateId };
}

const SEPTEMBER = { from: "2026-07-28", to: "2026-09-24" };
const JULY_20 = { from: "2026-07-18", to: "2026-07-26" };
const AFTER_READS = "2026-09-25T17:40:00.000Z";

test("Mesa's minutes are one routine contract on the standing clock, following the council's InSite sittings", () => {
  const contract = routineContract(CONTRACT_ID);
  assert.ok(contract);
  assert.equal(ROUTINE_SOURCE_CONTRACTS.filter(({ id }) => id === CONTRACT_ID).length, 1);
  assert.deepEqual(
    [...observableRoutineContracts(), ...MANUAL_PRODUCTION_SOURCE_CONTRACTS].filter(({ recordClass, scope }) => recordClass === "MEETING_OUTCOME" && scope === SCOPE).map(({ id }) => id),
    [CONTRACT_ID],
    "the scope has exactly one authoritative writer",
  );
  assert.equal(contract.sourceId, CONTRACT_ID);
  assert.equal(contract.recordClass, "MEETING_OUTCOME");
  assert.equal(contract.parserNormalizerVersion, MESA_LEGISTAR_MINUTES_OUTCOMES_CONTRACT.parserVersion);
  assert.deepEqual(contract.acquisitionAdapter, {
    authorityMode: "SINGLE_ROUTE",
    command: ["scripts/legistar-insite-minutes-ingest.mts", "--promote", "--slug", "mesa"],
    requestedUrl: "https://mesa.legistar.com/Calendar.aspx",
  });
  assert.deepEqual(contract.readerProjection, { id: CONTRACT_ID, consumers: ["agenda", "Ask", "meeting Reader records", "map"] });
  assert.deepEqual(contract.schedule?.follows, [{ meetingSource: "legistar-insite", bodyId: MESA }]);
  assert.equal(cadenceMsAt(contract, Date.parse("2026-09-24T12:00:00.000Z")), 14 * HOUR);
  assert.equal(contract.retry.afterMs, HOUR);

  // One portal host, one lane: the same lane as the council's own InSite partition.
  const task = routineTaskFromContract(contract);
  const partition = MEETING_PARTITION_CONTRACTS.find(({ id }) => id === meetingPartitionId("legistar-insite", MESA))!;
  assert.equal(task.acquisitionFailureDomain, routineTaskFromContract(partition).acquisitionFailureDomain);

  const authority = sourceAuthority(CONTRACT_ID)!;
  assert.deepEqual(authority.routePrefixes, ["https://mesa.legistar.com/", "https://legistar.granicus.com/mesa/"]);
  assert.ok(
    authority.routePrefixes.every((p) => p.startsWith("https://mesa.legistar.com/") || p.startsWith("https://legistar.granicus.com/mesa/")),
    "the vendor's document host is admitted for Mesa's own path only: robots.txt is recorded, not blocking (owner decision 2026-09-25)",
  );

  const adapter = readFileSync("scripts/legistar-insite-minutes-ingest.mts", "utf8");
  assert.match(adapter, /processRegisteredRoutineCandidate\(/);
  assert.doesNotMatch(adapter, /processRegisteredManualCandidate/);
  assert.match(adapter, /RCD_RECEIPT=[\s\S]{0,500}?source:\s*"mesa-legistar-minutes-outcomes"/);
});

test("the rolling window ends today in Mesa and reaches back 120 days; one grid range covers it unless it crosses a year", () => {
  assert.deepEqual(minutesOutcomeWindow({ from: null, to: null }, "America/Phoenix", new Date("2026-09-25T05:30:00.000Z")), { from: "2026-05-27", to: "2026-09-24" });
  assert.deepEqual(rangesForWindow({ from: "2026-05-27", to: "2026-09-24" }), ["This Year"]);
  assert.deepEqual(rangesForWindow({ from: "2025-11-01", to: "2026-02-28" }), ["This Year", "Last Year"]);
  assert.throws(() => minutesOutcomeWindow({ from: "2026-09-02", to: "2026-09-01" }, "America/Phoenix", new Date()), /MINUTES_OUTCOME_WINDOW_INVALID/);
});

test("a routine pass reads the minutes the portal links, records the rest as not yet published, and promotes", async () => {
  const store = new MemoryRoutineDataStore();
  const portal = recordedPortal();
  const { result, lines } = await pass(store, portal, SEPTEMBER, AFTER_READS);
  assert.equal(result.exitCode, 0, lines.join("\n"));
  assert.equal(result.documentsRead, 1, "only 2026-09-17 links minutes in this window");
  assert.ok(result.notYetPublished >= 10, `${result.notYetPublished} concluded sittings without minutes yet`);
  assert.deepEqual(result.refusedSittings, []);
  assert.deepEqual(portal.requests.filter((request) => request.includes("View.ashx")), [
    "GET https://mesa.legistar.com/View.ashx?M=M&ID=1343177&GUID=EC50B047-7BFE-4885-A3C9-F9D705D303F5",
  ]);
  const proof = await verdict(store, result.receiptLine, result.exitCode);
  assert.deepEqual({ outcome: proof.outcome, issue: proof.issue }, { outcome: "SUCCESS", issue: null });

  const read = await readDoorOutcomeProjection(SCOPE, { store, bypassCache: true });
  assert.equal(read.kind, "PROMOTED");
  if (read.kind !== "PROMOTED") return;
  assert.equal(read.metadata.versionId, proof.candidateId);
  assert.deepEqual(read.value.tenants, ["mesa"]);
  const strategic = read.value.sittings.find(({ meetingId }) => meetingId === "legistar-insite:mesa:1343177")!;
  assert.equal(strategic.extraction, "RETRIEVED");
  assert.equal(strategic.minutesDocument?.approval.state, "DRAFT_ACTION_MINUTES");
  assert.equal(strategic.minutesDocument?.sha256, "9baa0f5c246df3118c0d51455fe61fc71cc9fb0d2ffa02333c22f99a1eeb3b1b");
  const council = read.value.sittings.find(({ meetingId }) => meetingId === "legistar-insite:mesa:1336069")!;
  assert.equal(council.extraction, "NOT_YET_PUBLISHED");
  assert.equal(council.startsAt, "2026-09-14T17:45:00-07:00");
  assert.ok(read.value.sittings.every((sitting) => sitting.bodyId === MESA && sitting.slug === "mesa"));

  // An unchanged day costs the calendar reads and ends in a validated no-change receipt.
  const pointerBefore = await store.readPromotion("MEETING_OUTCOME", SCOPE);
  const again = recordedPortal();
  const second = await pass(store, again, SEPTEMBER, "2026-09-25T17:45:00.000Z");
  assert.equal(second.result.exitCode, 0, second.lines.join("\n"));
  assert.equal(second.result.documentsRead, 1);
  assert.ok(again.requests.some((request) => request.startsWith("HEAD") && request.includes("View.ashx")));
  const secondProof = await verdict(store, second.result.receiptLine, second.result.exitCode);
  assert.deepEqual({ outcome: secondProof.outcome, issue: secondProof.issue }, { outcome: "SUCCESS", issue: null });
  // Unchanged facts confirm the live candidate.
  assert.notEqual(secondProof.candidateId, pointerBefore?.versionId);
  const refreshed = await store.readPromotion<OutcomeSnapshot>("MEETING_OUTCOME", SCOPE);
  assert.equal(refreshed?.payload.sittings.find(row => row.minutesDocument)?.minutesDocument?.sha256, strategic.minutesDocument?.sha256);
  resetOutcomeSnapshotCache();
});

test("R2B minutes: a successfully read real document is rechecked and its replacement publishes within a day", async () => {
  const store = new MemoryRoutineDataStore();
  assert.equal((await pass(store, recordedPortal(), SEPTEMBER, AFTER_READS)).result.exitCode, 0);
  const before = await store.readPromotion<OutcomeSnapshot>("MEETING_OUTCOME", SCOPE);
  const bytes = Buffer.concat([readFileSync(`${DIR}/minutes-1343177.pdf`), Buffer.from("\n% document revised\n")]);
  const portal = recordedPortal({ bytes: { "1343177": bytes } });
  const next = await pass(store, portal, SEPTEMBER, "2026-09-26T05:00:00.000Z");
  assert.equal(next.result.exitCode, 0, next.lines.join("\n"));
  assert.ok(portal.requests.some(row => row.startsWith("HEAD") && row.includes("1343177")));
  assert.equal(next.result.documentsRead, 1);
  const held = await store.readPromotion<OutcomeSnapshot>("MEETING_OUTCOME", SCOPE);
  const document = held?.payload.sittings.find(row => row.minutesDocument)?.minutesDocument;
  assert.equal(document?.sha256, createHash("sha256").update(bytes).digest("hex"));
  assert.notEqual(held?.versionId, before?.versionId);
});

test("R2B minutes: every linked sitting on the real calendar is attempted beyond 25 documents", async () => {
  const window = { from: "2026-01-01", to: "2026-09-24" };
  const rows = concludedSittingRows([FRESH, THIS_YEAR, THIS_YEAR_PAGE_2].flatMap(parseCalendarRows), tenant, window, new Date(AFTER_READS));
  const linked = rows.filter(row => minutesLinkFor(row, tenant.host));
  assert.ok(linked.length > 25, `${linked.length} linked official sittings`);
  const documents = Object.fromEntries(linked.map(row => [row.insiteId!, 503]));
  const portal = recordedPortal({ documents });
  const result = await pass(new MemoryRoutineDataStore(), portal, window, AFTER_READS);
  assert.equal(result.result.documentsRead, linked.length);
  assert.equal(portal.requests.filter(row => row.startsWith("GET") && row.includes("View.ashx")).length, linked.length);
});

test("a failed minutes read is a held attempt that leaves the last good pointer live; a failed calendar read too", async () => {
  const store = new MemoryRoutineDataStore();
  const first = await pass(store, recordedPortal(), SEPTEMBER, AFTER_READS);
  assert.equal(first.result.exitCode, 0);
  const before = await store.readPromotion("MEETING_OUTCOME", SCOPE);

  const refused = await pass(store, recordedPortal({ documents: { "1336056": 404 } }), JULY_20, "2026-09-25T17:50:00.000Z");
  assert.equal(refused.result.exitCode, 2);
  assert.match(refused.result.refusedSittings[0] ?? "", /^legistar-insite:mesa:1336056 /);
  const proof = await verdict(store, refused.result.receiptLine, refused.result.exitCode);
  assert.deepEqual({ outcome: proof.outcome, issue: proof.issue }, { outcome: "HELD", issue: null });
  const read = await readDoorOutcomeProjection(SCOPE, { store, bypassCache: true });
  assert.equal(read.kind, "PROMOTED");
  if (read.kind !== "PROMOTED") return;
  assert.ok(!read.value.sittings.some(({ meetingId }) => meetingId === "legistar-insite:mesa:1336056"), "the failed read never entered the pointer");
  assert.ok(read.value.sittings.some(({ meetingId }) => meetingId === "legistar-insite:mesa:1343177"), "what was good stays live");

  // The unaffected 7/20 study session (no minutes yet) still promoted, so the pointer moved past `before`.
  const live = await store.readPromotion("MEETING_OUTCOME", SCOPE);
  assert.notEqual(live?.versionId, before?.versionId);
  assert.equal(proof.candidateId !== live?.versionId, true, "the held run record is not the pointer");

  const blocked = await pass(store, recordedPortal({ calendarStatus: 503 }), SEPTEMBER, "2026-09-25T17:55:00.000Z");
  assert.equal(blocked.result.exitCode, 2);
  const held = await verdict(store, blocked.result.receiptLine, blocked.result.exitCode);
  assert.deepEqual({ outcome: held.outcome, issue: held.issue }, { outcome: "HELD", issue: null });
  const heldRecord = await store.readCandidate(held.candidateId);
  assert.equal(heldRecord?.state, "SOURCE_BLOCKED");
  assert.equal(heldRecord?.lastKnownGoodVersion, live?.versionId);
  assert.equal((await store.readPromotion("MEETING_OUTCOME", SCOPE))?.versionId, live?.versionId, "a failed calendar read moves nothing");
  resetOutcomeSnapshotCache();
});

test("minutes whose extraction fails are held as a failed extraction and not downloaded again until they change (2026-09-25)", async () => {
  // A failed extraction is held and is not downloaded again on every retry.
  const store = new MemoryRoutineDataStore();
  const first = await pass(store, recordedPortal({ bytes: { "1336056": MOTIONLESS } }), JULY_20, "2026-09-25T17:50:00.000Z");
  assert.equal(first.result.exitCode, 0, `a held failed extraction is a named result, not a refused run:\n${first.lines.join("\n")}`);
  assert.equal(first.result.documentsRead, 1);
  assert.deepEqual(first.result.refusedSittings, []);
  const proof = await verdict(store, first.result.receiptLine, first.result.exitCode);
  assert.deepEqual({ outcome: proof.outcome, issue: proof.issue }, { outcome: "SUCCESS", issue: null }, "no hourly retry is scheduled for it");
  const candidate = await store.readCandidate(proof.candidateId);
  assert.ok(
    candidate?.candidate.excludedFacts?.some((fact) => fact.key === "legistar-insite:mesa:1336056:minutes-extraction" && fact.code === "MINUTES_EXTRACTION_FAILED_HELD"),
    "the failure stays visible on every candidate while it is held",
  );
  const read = await readDoorOutcomeProjection(SCOPE, { store, bypassCache: true });
  assert.equal(read.kind, "PROMOTED");
  if (read.kind !== "PROMOTED") return;
  const held = read.value.sittings.find(({ meetingId }) => meetingId === "legistar-insite:mesa:1336056")!;
  assert.equal(held.extraction, "ZERO_ROWS_FAILED", "the fail-closed rule: never 'nothing was decided'");
  assert.deepEqual(held.outcomes, []);
  assert.match(held.extractionNote ?? "", /yielded no motion, and they do not say that no action was taken/);
  assert.equal(held.failedMinutesRead?.byteCount, MOTIONLESS.byteLength);
  assert.equal(held.failedMinutesRead?.sha256, createHash("sha256").update(MOTIONLESS).digest("hex"));
  assert.equal(held.failedMinutesRead?.contentType, "application/pdf");
  const pointer = await store.readPromotion("MEETING_OUTCOME", SCOPE);

  // An hour later: one HEAD, no download, the same pointer.
  const hourLater = recordedPortal({ bytes: { "1336056": MOTIONLESS } });
  const second = await pass(store, hourLater, JULY_20, "2026-09-25T18:50:00.000Z");
  assert.equal(second.result.exitCode, 0, second.lines.join("\n"));
  assert.deepEqual(hourLater.requests.filter((request) => request.includes("View.ashx")), [
    "HEAD https://mesa.legistar.com/View.ashx?M=M&ID=1336056&GUID=4857278C-CC37-46A5-A15A-F34A2E577C70",
  ]);
  assert.equal(second.result.documentsRead, 0);
  assert.equal(second.result.heldFailedExtractions, 1);
  assert.match(second.lines.join("\n"), /DOCUMENT_UNCHANGED/);
  const secondProof = await verdict(store, second.result.receiptLine, second.result.exitCode);
  // The failed extraction is preserved on the same version, without another payload.
  assert.equal(secondProof.candidateId, pointer?.versionId);
  assert.equal(latestUnchangedConfirmation(await store.events(secondProof.candidateId!), secondProof.candidateId!)?.retrieval.retrievedAt, "2026-09-25T18:50:03.000Z");
  assert.deepEqual((await store.readPromotion("MEETING_OUTCOME", SCOPE))?.payload, pointer?.payload);

  // The portal does not answer the check: still no download; the failure stays held.
  const unanswered = recordedPortal({ bytes: { "1336056": MOTIONLESS }, headStatus: 405 });
  const third = await pass(store, unanswered, JULY_20, "2026-09-25T19:50:00.000Z");
  assert.equal(third.result.exitCode, 0);
  assert.ok(!unanswered.requests.some((request) => request.startsWith("GET") && request.includes("View.ashx")));
  assert.match(third.lines.join("\n"), /DOCUMENT_UNCHECKED/);

  // The clerk replaces the document: the check sees a new length, and it is read at once.
  const replaced = recordedPortal();
  const fourth = await pass(store, replaced, JULY_20, "2026-09-25T20:50:00.000Z");
  assert.equal(fourth.result.exitCode, 0, fourth.lines.join("\n"));
  assert.deepEqual(replaced.requests.filter((request) => request.includes("View.ashx")).map((request) => request.split(" ")[0]), ["HEAD", "GET"]);
  assert.match(fourth.lines.join("\n"), /DOCUMENT_CHANGED \(length/);
  const after = await readDoorOutcomeProjection(SCOPE, { store, bypassCache: true });
  assert.equal(after.kind, "PROMOTED");
  if (after.kind !== "PROMOTED") return;
  const now = after.value.sittings.find(({ meetingId }) => meetingId === "legistar-insite:mesa:1336056")!;
  assert.equal(now.extraction, "RETRIEVED");
  assert.ok(now.outcomes.length > 0);
  assert.equal(now.failedMinutesRead, undefined, "a read that succeeds clears the remembered failure");
  resetOutcomeSnapshotCache();
});

test("a held failed extraction's bytes are read again after a week, whatever the check would say", async () => {
  const store = new MemoryRoutineDataStore();
  // Both clocks in the past: the store refuses a candidate dated after the wall clock.
  const first = await pass(store, recordedPortal({ bytes: { "1336056": MOTIONLESS } }), JULY_20, "2026-09-17T17:50:00.000Z");
  assert.equal(first.result.exitCode, 0);
  const weekLater = recordedPortal({ bytes: { "1336056": MOTIONLESS } });
  const again = await pass(store, weekLater, JULY_20, "2026-09-24T17:50:05.000Z");
  assert.equal(again.result.exitCode, 0, again.lines.join("\n"));
  assert.deepEqual(weekLater.requests.filter((request) => request.includes("View.ashx")).map((request) => request.split(" ")[0]), ["GET"], "re-verified by its bytes, with no HEAD first");
  assert.match(again.lines.join("\n"), /FAILED_DOCUMENT_REVERIFY/);
  const read = await readDoorOutcomeProjection(SCOPE, { store, bypassCache: true });
  assert.equal(read.kind, "PROMOTED");
  if (read.kind !== "PROMOTED") return;
  const held = read.value.sittings.find(({ meetingId }) => meetingId === "legistar-insite:mesa:1336056")!;
  assert.equal(held.extraction, "ZERO_ROWS_FAILED");
  assert.equal(held.failedMinutesRead?.readAt.slice(0, 10), "2026-09-24", "the week starts again from the re-read");
  resetOutcomeSnapshotCache();
});

const PIMA_MEETING = "legistar:pima:1848";
const PIMA_STARTS_AT = "2026-05-05T13:30:00-07:00";

/** A store holding one recorded Pima sitting and Mesa's two July/September passes. */
async function storeWithBothTenants(): Promise<{ store: MemoryRoutineDataStore; pima: OutcomeSnapshot }> {
  const store = new MemoryRoutineDataStore();
  const recorded = JSON.parse(readFileSync("tests/fixtures/legistar-outcome-store/data/outcomes/legistar-outcomes.json", "utf8")) as OutcomeSnapshot;
  const pima: OutcomeSnapshot = { ...recorded, sittings: recorded.sittings.filter(({ eventId }) => eventId === 1848) };
  const candidate = legistarOutcomesCandidate({
    snapshot: pima,
    acquisitions: [{ source: "pima-legistar-outcomes", requestedUrl: "https://webapi.legistar.com/v1/pima/events?$top=1000", finalUrl: "https://webapi.legistar.com/v1/pima/events?$top=1000", httpStatus: 200, rawHash: "b".repeat(64), byteCount: 123 }],
    retrievedAt: "2026-09-20T19:00:00.000Z",
    sourceThrough: "2026-09-20T18:59:00.000Z",
  });
  assert.equal(routineCandidateContractIssue("pima-legistar-outcomes", candidate), null);
  assert.equal((await processRegisteredRoutineCandidate(store, "pima-legistar-outcomes", candidate, "2026-09-20T19:01:00.000Z")).candidate.state, "PROMOTED");
  assert.equal((await pass(store, recordedPortal(), SEPTEMBER, AFTER_READS)).result.exitCode, 0);
  const july = await pass(store, recordedPortal(), JULY_20, "2026-09-25T17:50:00.000Z");
  assert.equal(july.result.exitCode, 0, july.lines.join("\n"));
  return { store, pima };
}

test("the Reader combines Pima's and Mesa's pointers, each tenant's records and provenance intact, and Pima's answers unchanged", async () => {
  const { store, pima } = await storeWithBothTenants();

  // Pima alone, as the Reader reads it before Mesa has a pointer.
  resetOutcomeSnapshotCache();
  const pimaRead = await readDoorOutcomeProjection(PIMA_SCOPE, { store, bypassCache: true });
  const pimaOnly = outcomeEvidenceFor({ bodyId: PIMA_BOARD, meetingId: PIMA_MEETING, questionClass: "WHAT_WAS_DECIDED" });
  const pimaAsk = meetingOutcomeEvidenceFor({ bodyId: PIMA_BOARD, meetingId: PIMA_MEETING, startsAt: PIMA_STARTS_AT, question: "What did the board decide?" });

  resetOutcomeSnapshotCache();
  const combinedVersion = await refreshOutcomeSnapshotFromPromoted({ store, bypassCache: true });
  const pimaPointer = await store.readPromotion("MEETING_OUTCOME", PIMA_SCOPE);
  const mesaPointer = await store.readPromotion("MEETING_OUTCOME", SCOPE);
  assert.equal(combinedVersion, `${CONTRACT_ID}=${mesaPointer?.versionId}|pima-legistar-outcomes=${pimaPointer?.versionId}`, "the refresh names every door's version");
  assert.ok(doorOutcomeParts().some(({ pointer }) => pointer.contractId === CONTRACT_ID), "Mesa's door was read");
  assert.equal(loadedFrom(), "DATA_PLANE");
  const combined = getOutcomeSnapshot();
  assert.deepEqual(combined.tenants, ["mesa", "pima"]);
  assert.deepEqual(combined.pointers, [
    { contractId: CONTRACT_ID, tenant: "mesa", versionId: mesaPointer?.versionId },
    { contractId: "pima-legistar-outcomes", tenant: "pima", versionId: pimaPointer?.versionId },
  ]);
  assert.deepEqual(combined.sittings.filter(({ slug }) => slug === "pima"), [...pima.sittings].sort((a, b) => a.meetingId.localeCompare(b.meetingId)), "Pima's sittings are Pima's pointer, byte for byte");
  assert.ok(combined.sittings.filter(({ slug }) => slug === "mesa").every((sitting) => sitting.sourceOrg === "City of Mesa City Clerk"));
  assert.deepEqual(outcomeEvidenceFor({ bodyId: PIMA_BOARD, meetingId: PIMA_MEETING, questionClass: "WHAT_WAS_DECIDED" }), pimaOnly);
  assert.deepEqual(meetingOutcomeEvidenceFor({ bodyId: PIMA_BOARD, meetingId: PIMA_MEETING, startsAt: PIMA_STARTS_AT, question: "What did the board decide?" }), pimaAsk, "Pima's Ask evidence is unchanged");

  // The edge artifact carries the same combination and primes both tenants with no database read.
  const edge = combineOutcomeProjections([
    { value: pimaRead.kind === "PROMOTED" ? pimaRead.value : pima, pointers: [{ contractId: "pima-legistar-outcomes", tenant: "pima", versionId: pimaPointer!.versionId }] },
    { value: (await readDoorOutcomeProjection(SCOPE, { store, bypassCache: true })).value!, pointers: [{ contractId: CONTRACT_ID, tenant: "mesa", versionId: mesaPointer!.versionId }] },
  ])!;
  assert.equal(edge.versionId, combinedVersion);
  assert.equal(combinedOutcomeVersionId([{ contractId: "pima-legistar-outcomes", versionId: pimaPointer!.versionId }]), `pima-legistar-outcomes=${pimaPointer!.versionId}`, "one door's artifact names that door alone");
  resetOutcomeSnapshotCache();
  primeOutcomeProjection(edge.value, edge.versionId);
  assert.equal(loadedFrom(), "DATA_PLANE");
  assert.deepEqual(getOutcomeSnapshot().sittings.map(({ meetingId }) => meetingId), combined.sittings.map(({ meetingId }) => meetingId));
  // An artifact published before Mesa had a pointer is Pima's alone.
  resetOutcomeSnapshotCache();
  primeOutcomeProjection(pima, pimaPointer!.versionId);
  assert.deepEqual(getOutcomeSnapshot(), pima);
  resetOutcomeSnapshotCache();
});

test("Ask answers a Mesa council decision from the council's own minutes, with the exact passage, and never presents a tally as a roll call", async () => {
  const { store } = await storeWithBothTenants();
  resetOutcomeSnapshotCache();
  await refreshOutcomeSnapshotFromPromoted({ store, bypassCache: true });

  const meetingId = "legistar-insite:mesa:1336056";
  const answer = meetingOutcomeEvidenceFor({
    bodyId: MESA,
    meetingId,
    startsAt: "2026-07-20T17:45:00-07:00",
    question: "What did the Mesa City Council decide about the school resource officer agreement?",
  });
  assert.deepEqual(answer.gaps, []);
  const sro = answer.records.find((record) => record.kind === "MEETING_ACTION" && /Resolution No\. 12551/.test(record.text));
  assert.ok(sro, "the council's recorded action on item 5-c reaches the evidence pack");
  assert.match(sro.text, /It was moved by Councilmember Duff, seconded by Councilmember Taylor, that Resolution No\. 12551 be adopted\. Upon tabulation of votes, it showed: AYES – Somers–Adams–Duff–Heredia–Taylor NAYS – None ABSENT – Freeman–Goforth Vice Mayor Somers declared the motion carried unanimously by those present\./);
  assert.match(sro.text, /School Resource Officer duties/, "the item as the minutes print it");
  assert.match(sro.text, /Published as the council's minutes \("Minutes"\)\. No later sitting we hold records approving them/, "the document's standing travels with the answer");
  assert.equal(sro.sourceUrl, "https://mesa.legistar.com/View.ashx?M=M&ID=1336056&GUID=4857278C-CC37-46A5-A15A-F34A2E577C70");
  assert.equal(sro.sourceOrg, "City of Mesa City Clerk");
  assert.ok(answer.denominators.outcomeRecordsForThatMeeting! > 4);

  // "How did they vote" is not answered from a tally: our gap, never "the council recorded no votes".
  const votes = meetingOutcomeEvidenceFor({ bodyId: MESA, meetingId, startsAt: "2026-07-20T17:45:00-07:00", question: "How did the council members vote?" });
  assert.equal(votes.records.filter((record) => record.kind === "MEETING_MEMBER_VOTE").length, 0);
  assert.equal(votes.gaps[0]?.whose, "OURS");
  assert.match(votes.gaps[0]?.statement ?? "", /list how its members voted, by surname/);
  const evidence = outcomeEvidenceFor({ meetingId, questionClass: "HOW_DID_THEY_VOTE" });
  assert.equal(outcomeGapWhose(evidence.state), "OURS");

  // An agenda question is answered by the meeting's agenda document, not by the minutes store.
  assert.deepEqual(meetingOutcomeEvidenceFor({ bodyId: MESA, meetingId, startsAt: "2026-07-20T17:45:00-07:00", question: "What is on the agenda?" }), { records: [], gaps: [], denominators: {}, actions: [] });

  // Minutes not yet published answer as the publisher's state.
  const september = meetingOutcomeEvidenceFor({ bodyId: MESA, meetingId: "legistar-insite:mesa:1336069", startsAt: "2026-09-14T17:45:00-07:00", question: "What did the council decide?" });
  assert.deepEqual(september.records, []);
  assert.equal(september.gaps[0]?.whose, "THEIRS");
  assert.match(september.gaps[0]?.statement ?? "", /has not published minutes for this sitting yet/);
  resetOutcomeSnapshotCache();
});

test("Ask's topic timeline joins a Mesa decision to the topic from the minutes and composes the answer without a model", () => {
  const fixture = JSON.parse(readFileSync(`${DIR}/minutes-1336059.pages.json`, "utf8")) as { url: string; sha256: string; byteCount: number; pageCount: number; pages: { page: number; text: string }[] };
  const rows = parseCalendarRows(readFileSync("tests/fixtures/legistar-insite-mesa-calendar-this-year-paged.html", "utf8"));
  const row = rows.find(({ insiteId }) => insiteId === "1336059")!;
  const link = minutesLinkFor(row, tenant.host)!;
  const { sitting } = minutesSitting({
    tenant, row, calendarUrl: "https://mesa.legistar.com/Calendar.aspx", observedAt: AFTER_READS, readOn: NEVER_READ,
    document: { link, sha256: fixture.sha256, byteCount: fixture.byteCount, pageCount: fixture.pageCount, pages: fixture.pages, unreadable: null },
  });
  const [held] = applyMinutesApprovals({ generatedOn: "2026-09-25", generatedAt: AFTER_READS, tenants: ["mesa"], sittings: [sitting] }).sittings;
  const timeline = buildTopicTimeline({
    topic: agendaTopicFor("rezoning")!,
    bodyId: MESA,
    bodyName: "Mesa City Council",
    meetings: [{ id: sitting.meetingId, bodyName: "City Council", title: "City Council", startsAt: sitting.startsAt! }],
    documents: [],
    sittings: [held!],
    now: Date.parse(AFTER_READS),
  });
  const entry = timeline.entries.find((candidate) => candidate.agendaNumber === "7-a, 7-b");
  assert.ok(entry, "the San Antonio Tire Shop rezoning, decided on 2026-07-27, is on the timeline");
  assert.equal(entry.status, "PASSED");
  assert.equal(entry.basis, "MINUTES_RECORD");
  assert.equal(entry.localDay, "2026-07-27");
  assert.equal(timeline.denominators.topicMinutesRecords, 1);
  assert.deepEqual(timeline.unreadSittings, [], "a sitting whose minutes were read is not an unread sitting");
  const action = timeline.records.find((record) => record.kind === "MEETING_ACTION")!;
  assert.match(action.text, /It was moved by Councilmember Heredia, seconded by Vice Mayor Somers, that Resolution No\. 12560 and Ordinance No\. 6023 be adopted\./);
  assert.match(action.text, /AYES – Somers–Adams–Duff–Heredia NAYS – Freeman–Goforth–Taylor Mayor Freeman declared the motion carried by majority vote\./);
  const composed = composeTopicAnswer(timeline, Date.parse(AFTER_READS));
  assert.ok(composed);
  assert.match(composed.answer, /^On July 27th, 2026, the Mesa City Council passed agenda item 7-a, 7-b \(Resolution No\. 12560, Ordinance No\. 6023\)/);
  assert.match(composed.answer, /Rezone from Office Commercial/);
  assert.deepEqual(composed.citedUrls, [fixture.url]);
});
