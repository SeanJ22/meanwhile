import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { EXACT_SERVED_WITNESS_SQL, parsePublishedResultSubjectKey,
  readExactServedWitness, readPublishedResultObservation } from "../lib/control-plane/admin-view/public-reader-observation-read.ts";
import type { WorkItem } from "../lib/control-plane/work-item.ts";
import type { ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";
import { PUBLIC_SITE_ORIGIN } from "../lib/ops/origins.ts";
import { ADMIN_HOST, PUBLIC_HOST, adminSessionCookie, withAdminSessionKey } from "./admin-session.ts";

const item = {
  id: "wi-123", project: "Meanwhile", subject: "ocd-division/country:us/state:az/place:sierra_vista",
  publicationOutcome: { at: "2026-09-28T12:00:00.000Z", workerResultId: "wr-1", status: "PARTIALLY_PUBLISHED",
    code: "PARTIAL_RECORD_COVERAGE", candidateId: "cv-1", versionId: "cv-1" },
} as WorkItem;
const subjectKey = { kind: "WORK_ITEM" as const, workItemId: item.id, subject: item.subject };
const witness = { itemId: item.id, approvalId: "wr-1", versionId: "cv-1", readerKey: "body-1",
  url: `${PUBLIC_SITE_ORIGIN}/ballot?zip=85635`, checkedAt: "2026-09-28T12:05:00.000Z",
  state: "CONFIRMED" as const, reason: "Public body roster observed.", responseSha256: "a".repeat(64) };
const reposFor = (saved: WorkItem | null) => ({ workItems: { read: async () => saved && ({ value: saved }) } }) as unknown as Pick<ControlPlaneRepositories, "workItems">;

test("one exact published receipt returns its independently saved browser witness", async () => {
  const calls: unknown[][] = [];
  const sql = { query: async (text: string, params?: readonly unknown[]) => {
    assert.equal(text, EXACT_SERVED_WITNESS_SQL);
    calls.push([...(params ?? [])]);
    return [{ witness }];
  } };
  const result = await readPublishedResultObservation({ repos: reposFor(item), subjectKey,
    readWitness: row => readExactServedWitness(sql, row) });
  assert.deepEqual(calls, [[item.id, "wr-1", "cv-1"]]);
  assert.equal(result?.publication?.state, "PARTIALLY_PUBLISHED");
  assert.equal(result?.factualVerification.state, "NOT_READ");
  assert.equal(result?.publicObservation.state, "CONFIRMED");
  assert.deepEqual(result?.publicObservation.witness, witness);
  assert.match(EXACT_SERVED_WITNESS_SQL, /snapshot\.id = 'current'/);
  assert.match(EXACT_SERVED_WITNESS_SQL, /LIMIT 1/);
});

test("missing or mismatched browser evidence stays unavailable, never inferred from publication", async () => {
  const missing = await readPublishedResultObservation({ repos: reposFor(item), subjectKey,
    readWitness: async () => null });
  assert.equal(missing?.publication?.versionId, "cv-1");
  assert.deepEqual(missing?.publicObservation, { state: "UNAVAILABLE", witness: null });
  assert.equal(await readExactServedWitness({ query: async () => [{ witness: { ...witness, versionId: "cv-old" } }] }, item), null);
  assert.equal(await readPublishedResultObservation({ repos: reposFor(null), subjectKey, readWitness: async () => witness }), null);
  const held = { ...item, publicationOutcome: { ...item.publicationOutcome!, status: "HELD" as const } } as WorkItem;
  let called = false;
  const result = await readPublishedResultObservation({ repos: reposFor(held), subjectKey,
    readWitness: async () => { called = true; return witness; } });
  assert.equal(result?.publication, null);
  assert.equal(result?.publicObservation.state, "UNAVAILABLE");
  assert.equal(called, false);
});

test("typed subject key rejects wrong scope and malformed identifiers", async () => {
  assert.throws(() => parsePublishedResultSubjectKey("wi-123", null), /INVALID_SUBJECT_KEY/);
  assert.throws(() => parsePublishedResultSubjectKey("../wi-123", item.subject), /INVALID_SUBJECT_KEY/);
  assert.throws(() => parsePublishedResultSubjectKey("wi-123", "bad\nsubject"), /INVALID_SUBJECT_KEY/);
  await assert.rejects(readPublishedResultObservation({ repos: reposFor(item),
    subjectKey: { ...subjectKey, subject: "another-place" }, readWitness: async () => witness }), /SUBJECT_MISMATCH/);
});
