import assert from "node:assert/strict";
import test from "node:test";
import { preferCurrentSource, resolveRecordConflicts } from "../lib/civic-data/source-conflicts.ts";
import type { Provenance } from "../lib/sources/types.ts";
import type { ManualSourceSetReceipt } from "../lib/civic-data/types.ts";
const source = (kind: Provenance["kind"], day: string): Provenance => ({ kind, sourceUrl: "https://source.example/row", sourceOrg: "Publisher", collectedAt: day, verifiedAt: day });
test("CP-07: standing wins, then the newer read; unranked kinds share the same tie rule", () => {
  assert.equal(preferCurrentSource(source("OFFICIAL", "2026-09-01"), source("NEWS", "2026-10-01")), true);
  assert.equal(preferCurrentSource(source("OFFICIAL", "2026-10-01"), source("OFFICIAL", "2026-09-01")), true);
  assert.equal(preferCurrentSource(source("OFFICIAL", "2026-09-01"), source("OFFICIAL", "2026-10-01")), false);
  assert.equal(preferCurrentSource(source("FORUM", "2026-10-01"), source("REFERENCE", "2026-09-01")), true);
});
const receipt = (sourceClass: "NEWS" | "OFFICIAL_PUBLISHER", url: string, at: string): ManualSourceSetReceipt => ({ contractVersion: 1, reviewedAt: at, reviewedBy: "section3-validator", sources: [{ requestedUrl: url, finalUrl: url, sourceClass, publisher: "Publisher", retrievedAt: at, httpStatus: 200, rawHash: "a".repeat(64), reviewedEvidence: "saved page" }] });
test("CP-07: a losing phone is recorded and the winner retains its captured source", () => {
  const old = { id: "person", phone: "111", sourceUrl: "https://office.gov/person", collectedAt: "2026-09-01" };
  const fresh = { id: "person", phone: "222", sourceUrl: "https://news.example/person", collectedAt: "2026-10-01" };
  const result = resolveRecordConflicts(fresh, old, receipt("NEWS", fresh.sourceUrl, fresh.collectedAt), receipt("OFFICIAL_PUBLISHER", old.sourceUrl, old.collectedAt));
  assert.equal(result.record.phone, "111");
  assert.equal(result.conflicts[0].code, "CONFLICT_SUPERSEDED");
  assert.deepEqual((result.conflicts[0].record as { value: string }).value, "222");
  assert.equal((result.record.fieldSources as Record<string, Provenance>).phone.sourceUrl, old.sourceUrl);
});
