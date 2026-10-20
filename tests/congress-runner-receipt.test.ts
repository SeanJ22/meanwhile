import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { holdRawCaptureFile } from "../lib/civic-data/raw-capture-vault.ts";
import type { acquireCongressSourceFile } from "../lib/officials/congress-source-file.ts";
import type { KnownReleaseFile, KnownReleaseFileOptions } from "../lib/sources/known-release-file.ts";
import { CHAMBER_DIRECTORY_URLS } from "../lib/officials/chamber-directory.ts";
import test from "node:test";
import { refreshCongressDirectory } from "../scripts/fetch-congress-legislators.mts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { readStateFederalDirectory } from "../lib/officials/federal-directory-read-model.ts";
import { durableRoutineRunnerReceiptIssue, parseRoutineRunnerReceipt } from "../lib/civic-data/runner-receipt.ts";
import { requiredManualProductionContract } from "../lib/civic-data/manual-contracts.ts";
import { sourceAcquisitionFailure } from "../lib/civic-data/source-acquisition-error.ts";

const NOW = "2026-10-09T21:30:00.000Z", SHA = "a".repeat(40);
const files: Record<string, unknown> = {
  "legislators-current": [{ id: { bioguide: "G000607" }, name: { first: "James", last: "Gallagher" },
    terms: [{ type: "rep", state: "CA", district: 1, start: "2026-06-02", end: "2027-01-03", phone: "(202) 225-3076" }] },
  { id: { bioguide: "B000002" }, name: { first: "Sam", last: "Elsewhere" },
    terms: [{ type: "sen", state: "WA", class: 1, start: "2025-01-03", end: "2031-01-03", phone: "202-224-1000" }] }],
  "legislators-social-media": [{ id: { bioguide: "G000607" }, social: { twitter: "fixture-social" } }],
  "legislators-district-offices": [{ id: { bioguide: "G000607" }, offices: [{ city: "Fixture City", address: "1 Example Street" }] }],
  "committees-current": [{ type: "house", name: "Example Committee", thomas_id: "HSEX" }, { type: "senate", name: "Other Committee", thomas_id: "SSOT" }],
  "committee-membership-current": { HSEX: [{ name: "James Gallagher", bioguide: "G000607", title: "Chair" }], SSOT: [{ name: "Sam Elsewhere", bioguide: "B000002", title: "Member" }] },
};
const revision = async () => ({ sha: SHA, sourceCheck: {
  requestedUrl: "https://api.github.com/repos/unitedstates/congress-legislators/commits?per_page=1",
  finalUrl: "https://api.github.com/repos/unitedstates/congress-legislators/commits?per_page=1",
  httpStatus: 200 as const, rawHash: "b".repeat(64), checkedAt: NOW,
} });
async function fixtureFile(options: Parameters<typeof acquireCongressSourceFile>[0]) {
  const name = options.url.split("/").at(-1)!.replace(/\.yaml$/, "");
  const root = await mkdtemp(join(tmpdir(), "rh01-congress-fixture-")), path = join(root, "source.yaml");
  await writeFile(path, stringify(files[name]));
  return { path, requestedUrl: options.url, finalUrl: options.url, httpStatus: 200, retrievedAt: NOW,
    raw: await holdRawCaptureFile(options.vault, "congress-directory-project", path, "text/plain"),
    dispose: () => rm(root, { recursive: true, force: true }) };
}
async function fixtureChamberFile(options: KnownReleaseFileOptions): Promise<KnownReleaseFile> {
  const chamber = options.url === CHAMBER_DIRECTORY_URLS.house ? "house" : "senate";
  assert.equal(options.url, CHAMBER_DIRECTORY_URLS[chamber]); assert.ok(options.store);
  const bytes = await readFile(new URL(`./fixtures/sh-01-${chamber}-contacts.xml`, import.meta.url));
  const root = await mkdtemp(join(tmpdir(), "rh01-chamber-fixture-")), path = join(root, "source.bin");
  await writeFile(path, bytes);
  const raw = await holdRawCaptureFile(options.store, options.sourceId, path, "application/xml");
  return { sourceId: options.sourceId, releaseId: options.releaseId, requestedUrl: options.url, finalUrl: options.url,
    path, raw, byteLength: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex"), httpStatus: 200, retrievedAt: NOW,
    sourceObservedAt: NOW, checkedAt: NOW, lastCheckStatus: 200, etag: null, lastModified: null,
    contentType: "application/xml", reused: false, vaultKey: raw.vaultKey, dispose: () => rm(root, { recursive: true, force: true }) };
}

const expected = { id: "congress-bulk-roster:CA", sourceId: "congress-directory-project", recordClass: "FEDERAL_DIRECTORY" as const,
  scope: "US-CA:current-congress-directory", contract: requiredManualProductionContract("congress-bulk-roster:CA") };

test("the Congress runner publishes core first, attaches chamber contacts, and emits one supervisor receipt", async t => {
  const store = new MemoryRoutineDataStore(), lines: string[] = [], stages: string[] = [];
  t.mock.method(console, "log", (line: string) => { lines.push(line); });
  const create = store.create.bind(store);
  t.mock.method(store, "create", async (...args: Parameters<typeof store.create>) => {
    await create(...args); stages.push(args[0].candidate.id);
  });
  let acquired = 0;
  await refreshCongressDirectory({ state: "CA", store, vault: new MemoryEvidenceStore(), now: () => NOW, revision,
    acquire: async options => {
      if (acquired++) {
        const held = await readStateFederalDirectory("CA", { store, now: NOW, bypassCache: true });
        assert.equal(held.kind, "PROMOTED", "accepted people publish before the next optional acquisition starts");
      }
      return fixtureFile(options);
    },
    chamberAcquire: async options => {
      acquired++;
      assert.equal((await readStateFederalDirectory("CA", { store, now: NOW, bypassCache: true })).kind, "PROMOTED");
      return fixtureChamberFile(options);
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
  const accepted = await store.readCandidate(parsed.receipt.candidateId);
  const captures = (accepted?.candidate.normalizedPayload as { acquisitions: { finalUrl: string; raw: { rawHash: string; byteLength: number; chunked?: boolean }; body?: string }[] }).acquisitions;
  const chamber = captures.find(capture => capture.finalUrl === CHAMBER_DIRECTORY_URLS.house);
  assert.ok(chamber); assert.equal(chamber.raw.chunked, true); assert.equal(chamber.body, undefined);
  const originalXml = await readFile(new URL("./fixtures/sh-01-house-contacts.xml", import.meta.url));
  assert.equal(chamber.raw.rawHash, createHash("sha256").update(originalXml).digest("hex"));
  assert.equal(chamber.raw.byteLength, originalXml.byteLength, "raw evidence retains the entire original feed, including unrelated states");
  const read = await readStateFederalDirectory("CA", { store, now: NOW, bypassCache: true });
  assert.equal(read.kind, "PROMOTED");
  if (read.kind !== "PROMOTED") return;
  assert.deepEqual(read.value.roster.officeholders.map(row => row.id), ["congress:G000607"], "a place's record holds only that place's members");
  assert.equal(read.value.roster.officeholders[0].phone, "(202) 225-3076");
  assert.equal(read.value.roster.officeholders[0].offices?.[0].address, "408 Cannon House Office Building, Washington, DC 20515");
  assert.equal(read.value.roster.officeholders[0].offices?.[0].sourceUrl, CHAMBER_DIRECTORY_URLS.house);
  assert.equal(read.value.directory.byMember.G000607.committees[0].title, "Chair");
  assert.deepEqual(Object.keys(read.value.directory.committees), ["HSEX"], "and only the committees they sit on");
  assert.equal(await store.readPromotion("FEDERAL_DIRECTORY", "US-WA:current-congress-directory"), null, "another place publishes only on its own run");
});

test("an unavailable optional Congress file keeps accepted people and a single durable success receipt", async t => {
  const store = new MemoryRoutineDataStore(), lines: string[] = [], diagnostics: string[] = [];
  t.mock.method(console, "log", (line: string) => { lines.push(line); });
  t.mock.method(console, "error", (line: string) => { diagnostics.push(line); });
  await refreshCongressDirectory({ state: "CA", store, vault: new MemoryEvidenceStore(), now: () => NOW, revision,
    acquire: async options => {
      if (options.url.endsWith("legislators-social-media.yaml")) throw sourceAcquisitionFailure("PUBLISHER_UNAVAILABLE", "Fixture optional file unavailable");
      return fixtureFile(options);
    },
    chamberAcquire: fixtureChamberFile,
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
  await assert.rejects(refreshCongressDirectory({ state: "CA", store, vault: new MemoryEvidenceStore(), now: () => NOW, revision,
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
