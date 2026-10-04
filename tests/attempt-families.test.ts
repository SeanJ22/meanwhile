import assert from "node:assert/strict";
import test from "node:test";
import { attemptFamilyOf, attemptsByFamily, type FamilyAttemptLike } from "../lib/registry/attempt-families.ts";
import { bodyPublicationAttempts } from "../lib/control-plane/assignment-view.ts";

const attempt = (family: FamilyAttemptLike["family"], at: string, status: FamilyAttemptLike["status"], extra: Partial<FamilyAttemptLike> = {}): FamilyAttemptLike =>
  ({ bodyId: "school-district", family, at, status, acceptedCount: null, versionId: null, ...extra });

test("a school district's meeting coverage never shows an election-office error", () => {
  const byFamily = attemptsByFamily([
    attempt("meetings", "2026-10-01T00:00:00Z", "PUBLISHED", { acceptedCount: 4, versionId: "v1" }),
    attempt("elections", "2026-10-03T00:00:00Z", "HELD"),
  ]);
  assert.equal(byFamily.meetings?.latest.status, "PUBLISHED");
  assert.equal(byFamily.elections?.latest.status, "HELD");
  assert.equal(byFamily.elections?.lastGood, null);
  assert.equal(byFamily.elections?.publishedNow, null);
});

test("each family reports its last good check, its latest attempt and what is published now", () => {
  const byFamily = attemptsByFamily([
    attempt("meetings", "2026-10-01T00:00:00Z", "PUBLISHED", { acceptedCount: 4, versionId: "v1" }),
    attempt("meetings", "2026-10-02T00:00:00Z", "PARTIALLY_PUBLISHED", { acceptedCount: 2, versionId: "v2" }),
    attempt("meetings", "2026-10-03T00:00:00Z", "HELD"),
  ]);
  assert.equal(byFamily.meetings?.latest.at, "2026-10-03T00:00:00Z");
  assert.equal(byFamily.meetings?.lastGood?.at, "2026-10-02T00:00:00Z");
  assert.deepEqual(byFamily.meetings?.publishedNow, { at: "2026-10-02T00:00:00Z", acceptedCount: 2, versionId: "v2" });
});

test("an attempt with no known family belongs to none, and a family with no attempt is absent", () => {
  const byFamily = attemptsByFamily([attempt(null, "2026-10-03T00:00:00Z", "HELD")]);
  assert.deepEqual(byFamily, {});
  assert.equal(attemptFamilyOf("unmapped-door"), null);
  assert.equal(attemptFamilyOf("ballot-navigation"), "elections");
  assert.equal(attemptFamilyOf("comment-access"), "meetings");
});

test("published body attempts carry the family of the door they used", () => {
  const item = { id: "w1", project: "freshness", subject: "s", publicationOutcome: { at: "2026-10-03T00:00:00Z", status: "HELD", code: "X", workerResultId: "r", versionId: null },
    autonomousPlan: { publication: { contractId: "ballot-navigation", bodyId: "school-district" }, contract: { schemaVersion: 1 } } };
  const [row] = bodyPublicationAttempts([item as never]);
  assert.equal(row.family, "elections");
});
