import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { refreshCongressDirectory } from "../scripts/fetch-congress-legislators.mts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { readStateFederalDirectory } from "../lib/officials/federal-directory-read-model.ts";
import { durableRoutineRunnerReceiptIssue, parseRoutineRunnerReceipt } from "../lib/civic-data/runner-receipt.ts";
import { requiredManualProductionContract } from "../lib/civic-data/manual-contracts.ts";
import { sourceAcquisitionFailure } from "../lib/civic-data/source-acquisition-error.ts";
import type { KnownRelease, KnownReleaseOptions } from "../lib/sources/known-release.ts";

const NOW = "2026-10-09T21:30:00.000Z", SHA = "a".repeat(40);
const files: Record<string, unknown> = {
  "legislators-current": [{ id: { bioguide: "A000001" }, name: { first: "Jane", last: "Example" },
    terms: [{ type: "rep", state: "AZ", district: 1, start: "2025-01-03", end: "2027-01-03", phone: "202-225-1000" }] },
  { id: { bioguide: "B000002" }, name: { first: "Sam", last: "Elsewhere" },
    terms: [{ type: "sen", state: "WA", class: 1, start: "2025-01-03", end: "2031-01-03", phone: "202-224-1000" }] }],
  "legislators-social-media": [{ id: { bioguide: "A000001" }, social: { twitter: "janeexample" } }],
  "legislators-district-offices": [{ id: { bioguide: "A000001" }, offices: [{ city: "Phoenix", address: "1 Example Street" }] }],
  "committees-current": [{ type: "house", name: "Example Committee", thomas_id: "HSEX" }, { type: "senate", name: "Other Committee", thomas_id: "SSOT" }],
  "committee-membership-current": { HSEX: [{ name: "Jane Example", bioguide: "A000001", title: "Chair" }], SSOT: [{ name: "Sam Elsewhere", bioguide: "B000002", title: "Member" }] },
};
const revision = async () => ({ sha: SHA, sourceCheck: {
  requestedUrl: "https://api.github.com/repos/unitedstates/congress-legislators/commits?per_page=1",
  finalUrl: "https://api.github.com/repos/unitedstates/congress-legislators/commits?per_page=1",
  httpStatus: 200 as const, rawHash: "b".repeat(64), checkedAt: NOW,
} });
function fixtureRelease(options: KnownReleaseOptions): KnownRelease {
  const name = options.releaseId.split("/").at(-1)!;
  const bytes = new TextEncoder().encode(options.releaseId === "chamber-directory:house"
    ? '<MemberData><member><statedistrict>AZ01</statedistrict><bioguideID>A000001</bioguideID><official-name>Jane Example</official-name><office-room>100</office-room><office-building>CHOB</office-building><office-zip>20515</office-zip><phone>202-225-1000</phone></member></MemberData>'
    : options.releaseId === "chamber-directory:senate"
      ? '<contact_information><member><state>WA</state><bioguide_id>B000002</bioguide_id><member_full>Sam Elsewhere</member_full></member></contact_information>'
      : JSON.stringify(files[name]));
  return { sourceId: options.sourceId, releaseId: options.releaseId, requestedUrl: options.url, finalUrl: options.url,
    bytes, sha256: createHash("sha256").update(bytes).digest("hex"), httpStatus: 200, retrievedAt: NOW,
    sourceObservedAt: NOW, checkedAt: NOW, lastCheckStatus: 200, etag: null, lastModified: null,
    contentType: "text/plain", reused: false, vaultKey: `fixture/congress/${name}` };
}
const expected = { id: "congress-bulk-roster:AZ", sourceId: "congress-directory-project", recordClass: "FEDERAL_DIRECTORY" as const,
  scope: "US-AZ:current-congress-directory", contract: requiredManualProductionContract("congress-bulk-roster:AZ") };

test("the Congress runner publishes core first, attaches chamber contacts, and emits one supervisor receipt", async t => {
  const store = new MemoryRoutineDataStore(), lines: string[] = [], stages: string[] = [];
  t.mock.method(console, "log", (line: string) => { lines.push(line); });
  const create = store.create.bind(store);
  t.mock.method(store, "create", async (...args: Parameters<typeof store.create>) => {
    await create(...args); stages.push(args[0].candidate.id);
  });
  let acquired = 0;
  await refreshCongressDirectory({ state: "AZ", store, vault: new MemoryEvidenceStore(), now: () => NOW, revision,
    acquire: async options => {
      if (acquired++) {
        const held = await readStateFederalDirectory("AZ", { store, now: NOW, bypassCache: true });
        assert.equal(held.kind, "PROMOTED", "accepted people publish before the next optional acquisition starts");
      }
      const held = fixtureRelease(options); await options.validate?.(held.bytes, held); return held;
    },
  });
  assert.equal(acquired, 7);
  assert.equal(stages.length, 5, "core and each enrichment publish independently; unrelated chamber rows confirm without writing");
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
  const read = await readStateFederalDirectory("AZ", { store, now: NOW, bypassCache: true });
  assert.equal(read.kind, "PROMOTED");
  if (read.kind !== "PROMOTED") return;
  assert.deepEqual(read.value.roster.officeholders.map(row => row.id), ["congress:A000001"], "a place's record holds only that place's members");
  assert.equal(read.value.roster.officeholders[0].phone, "202-225-1000");
  assert.equal(read.value.roster.officeholders[0].offices?.[0].address, "100 Cannon House Office Building, Washington, DC 20515");
  assert.equal(read.value.directory.byMember.A000001.committees[0].title, "Chair");
  assert.deepEqual(Object.keys(read.value.directory.committees), ["HSEX"], "and only the committees they sit on");
  assert.equal(await store.readPromotion("FEDERAL_DIRECTORY", "US-WA:current-congress-directory"), null, "another place publishes only on its own run");
});

test("an unavailable optional Congress file keeps accepted people and a single durable success receipt", async t => {
  const store = new MemoryRoutineDataStore(), lines: string[] = [], diagnostics: string[] = [];
  t.mock.method(console, "log", (line: string) => { lines.push(line); });
  t.mock.method(console, "error", (line: string) => { diagnostics.push(line); });
  await refreshCongressDirectory({ state: "AZ", store, vault: new MemoryEvidenceStore(), now: () => NOW, revision,
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
  await assert.rejects(refreshCongressDirectory({ state: "AZ", store, vault: new MemoryEvidenceStore(), now: () => NOW, revision,
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
