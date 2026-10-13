import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { refreshCongressDirectory } from "../scripts/fetch-congress-legislators.mts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { readFederalDirectoryProjection } from "../lib/officials/federal-directory-read-model.ts";
import { durableRoutineRunnerReceiptIssue, parseRoutineRunnerReceipt } from "../lib/civic-data/runner-receipt.ts";
import { requiredManualProductionContract } from "../lib/civic-data/manual-contracts.ts";
import { sourceAcquisitionFailure } from "../lib/civic-data/source-acquisition-error.ts";
import type { KnownRelease, KnownReleaseOptions } from "../lib/sources/known-release.ts";

const NOW = "2026-10-09T21:30:00.000Z", SHA = "a".repeat(40);
const files: Record<string, unknown> = {
  "legislators-current": [{ id: { bioguide: "A000001" }, name: { first: "Jane", last: "Example" },
    terms: [{ type: "rep", state: "AZ", district: 1, start: "2025-01-03", end: "2027-01-03", phone: "202-225-1000" }] }],
  "legislators-social-media": [{ id: { bioguide: "A000001" }, social: { twitter: "janeexample" } }],
  "legislators-district-offices": [{ id: { bioguide: "A000001" }, offices: [{ city: "Phoenix", address: "1 Example Street" }] }],
  "committees-current": [{ type: "house", name: "Example Committee", thomas_id: "HSEX" }],
  "committee-membership-current": { HSEX: [{ name: "Jane Example", bioguide: "A000001", title: "Chair" }] },
};
const revision = async () => ({ sha: SHA, sourceCheck: {
  requestedUrl: "https://api.github.com/repos/unitedstates/congress-legislators/commits?per_page=1",
  finalUrl: "https://api.github.com/repos/unitedstates/congress-legislators/commits?per_page=1",
  httpStatus: 200 as const, rawHash: "b".repeat(64), checkedAt: NOW,
} });
function fixtureRelease(options: KnownReleaseOptions): KnownRelease {
  const name = options.releaseId.split("/").at(-1)!;
  const bytes = new TextEncoder().encode(JSON.stringify(files[name]));
  return { sourceId: options.sourceId, releaseId: options.releaseId, requestedUrl: options.url, finalUrl: options.url,
    bytes, sha256: createHash("sha256").update(bytes).digest("hex"), httpStatus: 200, retrievedAt: NOW,
    sourceObservedAt: NOW, checkedAt: NOW, lastCheckStatus: 200, etag: null, lastModified: null,
    contentType: "text/plain", reused: false, vaultKey: `fixture/congress/${name}` };
}
const expected = { id: "congress-bulk-roster", sourceId: "congress-directory-project", recordClass: "FEDERAL_DIRECTORY" as const,
  scope: "US:current-congress-directory", contract: requiredManualProductionContract("congress-bulk-roster") };

test("the Congress roster runner keeps each publication and emits one supervisor receipt after all five source files", async t => {
  const store = new MemoryRoutineDataStore(), lines: string[] = [], stages: string[] = [];
  t.mock.method(console, "log", (line: string) => { lines.push(line); });
  const create = store.create.bind(store);
  t.mock.method(store, "create", async (...args: Parameters<typeof store.create>) => {
    await create(...args); stages.push(args[0].candidate.id);
  });
  let acquired = 0;
  await refreshCongressDirectory({ store, now: () => NOW, revision,
    acquire: async options => {
      if (acquired++) {
        const held = await readFederalDirectoryProjection({ store, now: NOW, bypassCache: true });
        assert.equal(held.kind, "PROMOTED", "accepted people publish before the next optional acquisition starts");
      }
      const held = fixtureRelease(options); await options.validate?.(held.bytes, held); return held;
    },
  });
  assert.equal(acquired, 5);
  assert.equal(stages.length, 5);
  for (const id of stages) {
    const held = await store.readCandidate(id);
    assert.equal(held?.state, "PROMOTED");
    assert.equal(held?.receipt?.decision, "GOOD", "every staged fact retains its own durable validation receipt");
  }
  const parsed = parseRoutineRunnerReceipt(lines.join("\n"));
  assert.equal(parsed.ok, true, JSON.stringify(parsed));
  if (!parsed.ok) return;
  assert.equal(parsed.receipt.candidateId, stages.at(-1));
  assert.equal(await durableRoutineRunnerReceiptIssue(parsed.receipt, expected, store, "SUCCESS"), null);
  const read = await readFederalDirectoryProjection({ store, now: NOW, bypassCache: true });
  assert.equal(read.kind, "PROMOTED");
  if (read.kind !== "PROMOTED") return;
  assert.equal(read.value.roster.officeholders[0].phone, "202-225-1000");
  assert.equal(read.value.directory.byMember.A000001.committees[0].title, "Chair");
});

test("an unavailable optional Congress file keeps accepted people and a single durable success receipt", async t => {
  const store = new MemoryRoutineDataStore(), lines: string[] = [], diagnostics: string[] = [];
  t.mock.method(console, "log", (line: string) => { lines.push(line); });
  t.mock.method(console, "error", (line: string) => { diagnostics.push(line); });
  await refreshCongressDirectory({ store, now: () => NOW, revision,
    acquire: async options => {
      if (options.releaseId.endsWith("legislators-social-media")) throw sourceAcquisitionFailure("PUBLISHER_UNAVAILABLE", "Fixture optional file unavailable");
      const held = fixtureRelease(options); await options.validate?.(held.bytes, held); return held;
    },
  });
  const parsed = parseRoutineRunnerReceipt(lines.join("\n"));
  assert.equal(parsed.ok, true, JSON.stringify(parsed));
  if (!parsed.ok) return;
  assert.equal(await durableRoutineRunnerReceiptIssue(parsed.receipt, expected, store, "SUCCESS"), null);
  assert.ok(diagnostics.some(line => line.includes("legislators-social-media") && line.includes("Fixture optional file unavailable")));
});

test("a Congress core-source failure emits one durable held receipt and never invents a successful publication", async t => {
  const store = new MemoryRoutineDataStore(), lines: string[] = [];
  t.mock.method(console, "log", (line: string) => { lines.push(line); });
  await assert.rejects(refreshCongressDirectory({ store, now: () => NOW, revision,
    acquire: async () => { throw sourceAcquisitionFailure("PUBLISHER_UNAVAILABLE", "Fixture core file unavailable"); },
  }), /Fixture core file unavailable/);
  const parsed = parseRoutineRunnerReceipt(lines.join("\n"));
  assert.equal(parsed.ok, true, JSON.stringify(parsed));
  if (!parsed.ok) return;
  assert.equal(parsed.receipt.acquisitionSucceeded, false);
  assert.equal(parsed.receipt.promotedVersion, null);
  assert.equal(await durableRoutineRunnerReceiptIssue(parsed.receipt, expected, store, "HELD"), null);
  assert.equal(await store.readPromotion("FEDERAL_DIRECTORY", expected.scope), null);
});
