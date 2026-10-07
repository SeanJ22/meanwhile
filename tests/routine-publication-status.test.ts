/**
 * Published versus reader-visible, from narrow evidence: the
 * promotion pointer and the typed Reader readback of exactly that version.
 * No payload is read. Unknown stays unknown: no pointer is NOT_PUBLISHED, and
 * no readback of the current version is PUBLISHED_NOT_READ_BACK.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  PUBLICATION_VERDICTS,
  projectPublicationStatus,
  type PublicationContract,
  type PublicationStatusRows,
} from "../lib/civic-data/publication-status.ts";
import { serializeReaderProjectionReadback } from "../lib/civic-data/reader-readback.ts";

const contract = (id: string, readerProjection: unknown | null = { id: `projection:${id}` }): PublicationContract => ({
  id,
  sourceId: `source:${id}`,
  recordClass: "MEETING",
  scope: `scope:${id}`,
  readerProjection,
});

const pointer = (c: PublicationContract, versionId: string, promotedAt = "2026-09-22T20:29:57.078Z") => ({
  key: `${c.recordClass}:${c.scope}`,
  sourceId: c.sourceId,
  recordClass: c.recordClass,
  scope: c.scope,
  currentVersionId: versionId,
  promotedAt,
});

const readback = (c: PublicationContract, versionId: string, status: "PASS" | "FAIL", at: string, contractId = c.id) => ({
  candidateId: versionId,
  at,
  detail: serializeReaderProjectionReadback({
    contractVersion: 2,
    kind: "READER_PROJECTION_READBACK",
    contractId,
    sourceId: c.sourceId,
    recordClass: "MEETING",
    scope: c.scope,
    projectionId: `projection:${c.id}`,
    versionId,
    pointerKey: `${c.recordClass}:${c.scope}`,
    observedAt: at,
    evidenceKind: "TYPED_READER_READ_MODEL",
    verifierId: "test:typed-reader",
    verifierCodeSha: "a".repeat(40),
    status,
    detail: `${status} for ${versionId}`,
  }),
});

const attempt = (c: PublicationContract, candidateId: string, state: string, failureCode: string | null, attemptedAt = "2026-09-23T02:19:47.568Z") => ({
  candidateId,
  sourceId: c.sourceId,
  recordClass: c.recordClass,
  scope: c.scope,
  state,
  attemptedAt,
  failureCode,
});

test("each contract gets the verdict its pointer and the readback of exactly that version support", () => {
  const visible = contract("visible");
  const failed = contract("failed");
  const stale = contract("stale-readback");
  const never = contract("never-published");
  const noSurface = contract("no-reader-surface", null);
  const foreign = contract("foreign-pointer");
  const misfiled = contract("misfiled-readback");
  const rows: PublicationStatusRows = {
    promotions: [
      pointer(visible, "v2"),
      pointer(failed, "f1"),
      pointer(stale, "s2"),
      pointer(noSurface, "n1"),
      { ...pointer(foreign, "x1"), sourceId: "some-other-source" },
      pointer(misfiled, "m1"),
    ],
    latestAttempts: [
      attempt(visible, "v3", "UNCHANGED", null),
      attempt(never, "e9", "SOURCE_BLOCKED", "SOURCE_RETRIEVAL_FAILED"),
      attempt(stale, "s3", "CANNOT_TELL", "ZERO_IS_NOT_ABSENCE"),
    ],
    readbacks: [
      readback(visible, "v1", "FAIL", "2026-09-21T10:00:00.000Z"),
      readback(visible, "v2", "PASS", "2026-09-22T20:29:59.025Z"),
      readback(failed, "f1", "FAIL", "2026-09-22T21:00:00.000Z"),
      readback(stale, "s1", "PASS", "2026-09-20T09:00:00.000Z"),
      readback(misfiled, "m1", "PASS", "2026-09-22T22:00:00.000Z", "some-other-contract"),
    ],
  };
  const view = projectPublicationStatus([visible, failed, stale, never, noSurface, foreign, misfiled], rows);
  const verdict = (id: string) => view.contracts.find((c) => c.contractId === id)?.verdict;
  assert.equal(verdict("visible"), "READER_VISIBLE", "the PASS of the current version counts; an older FAIL does not");
  assert.equal(verdict("failed"), "READBACK_FAILED");
  assert.equal(verdict("stale-readback"), "PUBLISHED_NOT_READ_BACK", "a readback of an older version is not a readback of this one");
  assert.equal(verdict("never-published"), "NOT_PUBLISHED");
  assert.equal(verdict("no-reader-surface"), "PUBLISHED_NO_READER_SURFACE");
  assert.equal(verdict("foreign-pointer"), "NOT_PUBLISHED", "another source's pointer does not publish this contract");
  assert.equal(verdict("misfiled-readback"), "PUBLISHED_NOT_READ_BACK", "a readback filed for another contract does not count");

  const visibleRow = view.contracts.find((c) => c.contractId === "visible")!;
  assert.deepEqual(visibleRow.published, { versionId: "v2", promotedAt: "2026-09-22T20:29:57.078Z" });
  assert.deepEqual(visibleRow.readback, { status: "PASS", at: "2026-09-22T20:29:59.025Z", versionId: "v2" });
  assert.equal(visibleRow.latestAttempt?.state, "UNCHANGED");

  const counted = PUBLICATION_VERDICTS.reduce((sum, v) => sum + view.counts[v], 0);
  assert.equal(counted, view.contracts.length, "every contract is counted exactly once");
  assert.equal(view.latestAttemptFailing, 2);
});

test("with nothing recorded, every contract is NOT_PUBLISHED with no attempt, never a pass", () => {
  const view = projectPublicationStatus([contract("a"), contract("b")], { promotions: [], latestAttempts: [], readbacks: [] });
  assert.deepEqual(view.contracts.map((c) => c.verdict), ["NOT_PUBLISHED", "NOT_PUBLISHED"]);
  assert.equal(view.counts.READER_VISIBLE, 0);
  assert.equal(view.contracts[0]?.latestAttempt, null);
});

test("the narrow read selects no payload and never touches the candidate JSON", () => {
  const store = readFileSync("lib/civic-data/publication-status-store.ts", "utf8");
  const code = store.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(code, /civicDataPromotions\.payload|civicDataPromotions\.validationReceipt/);
  assert.doesNotMatch(code, /civicDataCandidates\.candidate|c\.candidate|\bcandidate\s*#>|\bcandidate\s*->/);
  assert.match(code, /SET LOCAL statement_timeout = \$\{statementTimeoutMs\}/);
  assert.match(code, /e\.sequence = 1/, "the latest attempt is the local attempt clock, not the adapter's timestamp");
  assert.match(code, /like\(civicDataCandidateEvents\.detail, `\$\{READER_PROJECTION_READBACK_PREFIX\}%`\)/);
});

test("the Sources page reads its sources together, starts the full proof read only when asked by name, and shows the narrow panel first", () => {
  const server = readFileSync("lib/civic-data/observability-server.ts", "utf8");
  assert.match(server, /readPublicationStatusRows\(connection, ADMIN_PUBLICATION_STATUS_STATEMENT_TIMEOUT_MS\)/);
  assert.match(server, /No publication count is claimed/);
});
