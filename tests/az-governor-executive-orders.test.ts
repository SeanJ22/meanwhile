import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { manualCandidateContractIssue, processRegisteredRoutineCandidate } from "../lib/civic-data/promotion.ts";
import { ROUTINE_SOURCE_CONTRACTS } from "../lib/civic-data/contracts.ts";
import { MANUAL_PRODUCTION_SOURCE_CONTRACTS } from "../lib/civic-data/manual-contracts.ts";
import { repairRoutineReaderProjectionReadback } from "../lib/civic-data/reader-verification.ts";
import { parseRoutineReaderRepairRecords, routineReaderRepairRecord, serializeRoutineReaderRepairRecord } from "../lib/civic-data/reader-repair-protocol.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import type { CandidateVersionRecord, PromotedPointerIdentity } from "../lib/civic-data/types.ts";
import type { ExecutiveActionStore } from "../lib/officials/executive-actions.ts";
import { azGovernorExecutiveOrdersCandidate, azOfficialActionsCandidate } from "../lib/outcomes/data-plane.ts";
import {
  AZ_GOVERNOR_ORDERS_INDEX,
  captureGovernorOrderResponse,
  parseGovernorOrderIndex,
  verifiedGovernorOrder,
  type GovernorOrderCapture,
} from "../lib/sources/az-governor-executive-orders.ts";

const NOW = "2026-09-28T11:45:00.000Z";
const DETAIL = "https://azgovernor.gov/office-arizona-governor/executive-order/2026-02";
const PDF = "https://azgovernor.gov/sites/default/files/executive-order-2026-02.pdf";

function fixture(path: string, requestedUrl: string): GovernorOrderCapture {
  return captureGovernorOrderResponse({ requestedUrl, finalUrl: requestedUrl, httpStatus: 200,
    retrievedAt: NOW, bytes: readFileSync(`tests/fixtures/${path}`) });
}

const index = fixture("az-governor-executive-orders-index.html", AZ_GOVERNOR_ORDERS_INDEX);
const detail = fixture("az-governor-eo-2026-02.html", DETAIL);
const pdf = fixture("az-governor-eo-2026-02.pdf", PDF);

test("exact official index/detail/PDF bytes establish one dated executive order and a partial horizon", async () => {
  assert.equal(index.rawHash, "80f9025c380bee0776a9192300bbf2c6f3f1a9e8c6fc87c9474eaaff49ba32a6");
  assert.equal(detail.rawHash, "3932216eb450392e0f7a8e99f0e08f2a2645f6326fe7a408e83240363fe8d0c7");
  assert.equal(pdf.rawHash, "c4b655d65901677726bb918c22a97f8e96d5287dec0040739f6bf56f059e7ba8");
  const page = parseGovernorOrderIndex(index);
  assert.equal(page.orders.length, 11);
  assert.equal(page.hasNextPage, true);
  const first = page.orders.find((row) => row.number === "2026-02");
  assert.ok(first);
  const action = await verifiedGovernorOrder({ index: first, detail, pdf });
  assert.equal(action.id, "az-eo-2026-02");
  assert.equal(action.occurredAt, "2026-07-08");
  assert.equal(action.documentUrl, PDF);
  assert.equal(action.kind, "EXECUTIVE_ORDER");

  const held = page.orders.filter((row) => row.number !== "2026-02").map((row) => ({
    key: `action:az-eo-${row.number}`, code: "UNREAD_DETAIL", detail: "The exact detail and PDF were not supplied in this bounded fixture.",
  }));
  const candidate = await azGovernorExecutiveOrdersCandidate({ index, captures: [detail, pdf],
    verified: [{ detail, pdf }], held, prior: null, retrievedAt: NOW });
  assert.equal(candidate.retrieval.manualSourceReceipt, undefined);
  assert.equal(candidate.horizon.claimsComplete, false);
  assert.equal(candidate.horizon.paginationComplete, false);
  assert.equal((candidate.readModel as ExecutiveActionStore).actions.length, 1);
  assert.equal((candidate.normalizedPayload as { sourceDocuments: GovernorOrderCapture[] }).sourceDocuments.length, 3);
  const outcome = await processRegisteredRoutineCandidate(new MemoryRoutineDataStore(),
    "az-governor-executive-orders", candidate, NOW, null);
  assert.equal(outcome.candidate.state, "PROMOTED", outcome.candidate.failureCode ?? "");
  assert.equal(outcome.readerReadback?.status, "PASS");
});

test("Governor-only successor retains every prior legislative and unwalked order row", async () => {
  const prior = JSON.parse(readFileSync("data/states/az/officials/az-governor-actions.json", "utf8")) as ExecutiveActionStore;
  const page = parseGovernorOrderIndex(index);
  const held = page.orders.filter((row) => row.number !== "2026-02").map((row) => ({
    key: `action:az-eo-${row.number}`, code: "UNREAD_DETAIL", detail: "Not part of this bounded fixture.",
  }));
  const candidate = await azGovernorExecutiveOrdersCandidate({ index, captures: [detail, pdf],
    verified: [{ detail, pdf }], held, prior: { versionId: "promoted-prior", store: prior }, retrievedAt: NOW });
  const value = candidate.readModel as ExecutiveActionStore;
  assert.deepEqual(value.legislative, prior.legislative);
  assert.ok(prior.actions.every((action) => value.actions.some((later) => later.id === action.id)));
  assert.equal((candidate.normalizedPayload as { predecessorVersionId: string }).predecessorVersionId, "promoted-prior");
});

test("an unindexed or unretained order capture cannot enter the direct source candidate", async () => {
  const page = parseGovernorOrderIndex(index);
  const held = page.orders.filter((row) => row.number !== "2026-02").map((row) => ({
    key: `action:az-eo-${row.number}`, code: "UNREAD_DETAIL", detail: "Not part of this bounded fixture.",
  }));
  await assert.rejects(azGovernorExecutiveOrdersCandidate({ index, captures: [detail],
    verified: [{ detail, pdf }], held, prior: null, retrievedAt: NOW }), /UNRETAINED_SOURCE_BYTES/);
  const wrongDetail = { ...detail, requestedUrl: DETAIL.replace("2026-02", "2026-99") };
  await assert.rejects(azGovernorExecutiveOrdersCandidate({ index, captures: [wrongDetail, pdf],
    verified: [{ detail: wrongDetail, pdf }], held, prior: null, retrievedAt: NOW }), /UNINDEXED_ORDER/);
});

test("a later human-review door cannot launder machine captures into a reviewer receipt", () => {
  const prior = JSON.parse(readFileSync("data/states/az/officials/az-governor-actions.json", "utf8")) as ExecutiveActionStore;
  const one = { ...prior, actions: [prior.actions[0]!] };
  const receipt = { contractVersion: 1 as const, reviewedAt: NOW, reviewedBy: "test-human-reviewer",
    sources: [prior.source.index, prior.actions[0]!.documentUrl ?? prior.actions[0]!.sourceUrl].map((url) => ({
      requestedUrl: url, finalUrl: url, publisher: "Office of the Arizona Governor",
      sourceClass: "OFFICIAL_PUBLISHER" as const, retrievedAt: NOW, httpStatus: 200,
      rawHash: "a".repeat(64), reviewedEvidence: "Exact test-reviewed source bytes",
    })) };
  const candidate = azOfficialActionsCandidate({ store: one, sourceReceipt: receipt,
    retrievedAt: NOW, sourceThrough: NOW, prior: { versionId: "direct-predecessor", store: prior, sourceReceipt: null } });
  assert.ok(candidate.semantics.violations.some((issue) => issue.includes("direct predecessor")));
  assert.equal(candidate.retrieval.manualSourceReceipt?.reviewedBy, "test-human-reviewer");
  assert.equal(candidate.retrieval.manualSourceReceipt?.sources.length, 2,
    "the machine sources were not copied into the human's review receipt");
  assert.match(manualCandidateContractIssue("az-official-actions", {
    ...candidate, retrieval: { ...candidate.retrieval, manualSourceReceipt: undefined },
  }) ?? "", /requires its exact manual source-set receipt/);
});

test("Reader repair calls a verified alternate source inactive without granting it a PASS", async () => {
  const direct = ROUTINE_SOURCE_CONTRACTS.find((row) => row.id === "az-governor-executive-orders");
  const manual = MANUAL_PRODUCTION_SOURCE_CONTRACTS.find((row) => row.id === "az-official-actions");
  assert.ok(direct && manual);
  const page = parseGovernorOrderIndex(index);
  const held = page.orders.filter((row) => row.number !== "2026-02").map((row) => ({
    key: `action:az-eo-${row.number}`, code: "UNREAD_DETAIL", detail: "Not part of this bounded fixture.",
  }));
  const candidate = await azGovernorExecutiveOrdersCandidate({ index, captures: [detail, pdf],
    verified: [{ detail, pdf }], held, prior: null, retrievedAt: NOW });
  const store = new MemoryRoutineDataStore();
  const promoted = await processRegisteredRoutineCandidate(store, direct.id, candidate, NOW, null);
  assert.equal(promoted.candidate.state, "PROMOTED");
  const inactive = await repairRoutineReaderProjectionReadback(store, manual, NOW, "a".repeat(40));
  assert.deepEqual(inactive, { kind: "NOT_CURRENT_SOURCE", receipt: null });
  const line = serializeRoutineReaderRepairRecord(routineReaderRepairRecord(manual, { ok: true, value: inactive }));
  const parsed = parseRoutineReaderRepairRecords(line, [manual]);
  assert.deepEqual(parsed.issues, []);
  assert.equal(parsed.records[0]?.disposition, "NOT_CURRENT_SOURCE");
  assert.equal(parsed.records[0]?.receipt, null);
  assert.notEqual((await repairRoutineReaderProjectionReadback(store, direct, NOW, "b".repeat(40))).kind,
    "NOT_CURRENT_SOURCE", "the active source still has its own Reader repair obligation");

  const originalPointer = store.readPromotionIdentity.bind(store);
  const originalCandidate = store.readCandidate.bind(store);
  let pointerPatch: Partial<PromotedPointerIdentity> = {};
  let recordPatch: ((row: CandidateVersionRecord) => CandidateVersionRecord) | null = null;
  store.readPromotionIdentity = async (recordClass, scope) => {
    const pointer = await originalPointer(recordClass, scope);
    return pointer ? { ...pointer, ...pointerPatch } : null;
  };
  store.readCandidate = async (id) => {
    const row = await originalCandidate(id);
    return row && recordPatch ? recordPatch(row) : row;
  };
  const rejected = async () => assert.rejects(
    repairRoutineReaderProjectionReadback(store, manual, NOW, "c".repeat(40)),
    /READER_PROMOTION_IDENTITY_INVALID:az-official-actions/,
  );
  pointerPatch = { sourceId: "unregistered-actions-source" };
  await rejected();
  pointerPatch = { sourceId: "az-governor-executive-orders", scope: "US-AZ:other:official-actions" };
  await rejected();
  pointerPatch = { sourceId: "az-governor-executive-orders", key: "STATE_EXECUTIVE_ACTION:wrong-scope" };
  await rejected();
  pointerPatch = { sourceId: "az-governor-executive-orders" };
  recordPatch = (row) => ({ ...row, receipt: { ...row.receipt!, decision: "FAIL" } });
  await rejected();
  recordPatch = (row) => ({ ...row, candidate: { ...row.candidate, normalization: {
    ...row.candidate.normalization, parserVersion: "unregistered-parser/0",
  } } });
  await rejected();
});
