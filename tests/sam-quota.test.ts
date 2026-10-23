import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { DurableEvidenceStore } from "../lib/control-plane/evidence/durable-store.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { acquireFederalMoney } from "../lib/federal-money/acquire.ts";
import { refreshFederalMoney } from "../lib/federal-money/refresh.ts";
import { readSavedSamQuota, recordSamQuotaResponse, SAM_QUOTA_KEY, SamQuotaFailure } from "../lib/federal-money/sam-quota.ts";

const checkedAt = "2026-10-23T10:15:00.000Z", retryAt = "2026-10-24T00:00:00.000Z";

for (const status of [429, 200, 202]) test(`SAM quota 900804 on HTTP ${status} makes no further requests until the persisted reset`, async t => {
  const root = await mkdtemp(join(tmpdir(), "sam-quota-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const vaultRoot = join(root, "vault"), evidenceStore = new DurableEvidenceStore(vaultRoot, { remote: null });
  const key = "synthetic-private-sam-key", token = "synthetic-private-download-token";
  let calls = 0, sleeps = 0, now = checkedAt;
  const options = { now: () => now, samGovApiKey: key, evidenceStore, cacheRoot: join(root, "cache"),
    sleep: async () => { sleeps++; throw new Error("A daily quota must never sleep and retry."); },
    fetch: (async () => {
      calls++;
      return Response.json({ code: "900804", message: "Message throttled out", description: `You have exceeded your quota .You can access API after 2026-Oct-24 00:00:00+0000 UTC ${key}`, nextAccessTime: "2026-Oct-24 00:00:00+0000 UTC", token }, { status, headers: { "Retry-After": "Sat, 24 Oct 2026 00:00:00 GMT" } });
    }) as typeof fetch };
  const quota = (error: unknown) => error instanceof SamQuotaFailure && error.checkedAt === checkedAt && error.retryAt === retryAt && !error.message.includes(key) && !error.message.includes(token);
  await assert.rejects(acquireFederalMoney("sam-gov-entities", "CT", options), quota);
  assert.equal(calls, 1); assert.equal(sleeps, 0);
  now = "2026-10-23T23:59:59.999Z";
  for (const state of ["CA", "DE", "FL", "CT"]) await assert.rejects(acquireFederalMoney("sam-gov-entities", state, { ...options, evidenceStore: new DurableEvidenceStore(vaultRoot, { remote: null }) }), quota);
  assert.equal(calls, 1); assert.equal(sleeps, 0);
  const hold = await readSavedSamQuota(evidenceStore);
  assert.deepEqual(hold, { formatVersion: 1, source: "sam-gov-entities", publisherCode: "900804", checkedAt, retryAt });
  const saved = Buffer.from((await evidenceStore.get(SAM_QUOTA_KEY))!.bytes).toString("utf8");
  assert.equal(saved.includes(key), false); assert.equal(saved.includes(token), false);
  if (status === 429) {
    const child = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", `
      import { DurableEvidenceStore } from './lib/control-plane/evidence/durable-store.ts';
      import { acquireFederalMoney } from './lib/federal-money/acquire.ts';
      import { SamQuotaFailure } from './lib/federal-money/sam-quota.ts';
      let calls = 0;
      try {
        await acquireFederalMoney('sam-gov-entities', 'AZ', { evidenceStore: new DurableEvidenceStore(process.argv[1], { remote: null }), now: () => '2026-10-23T23:59:59.999Z', samGovApiKey: 'synthetic-key', fetch: async () => { calls++; throw new Error('No request before reset.'); } });
        throw new Error('The saved daily hold must stop a new process.');
      } catch(error) { if (!(error instanceof SamQuotaFailure)) throw error; console.log(JSON.stringify({ calls, checkedAt: error.checkedAt, retryAt: error.retryAt })); }
    `, vaultRoot], { cwd: process.cwd(), encoding: "utf8", timeout: 15_000, env: { ...process.env, NODE_TEST_CONTEXT: undefined } });
    assert.equal(child.error, undefined, child.error?.message);
    assert.equal(child.status, 0, child.stderr);
    assert.deepEqual(JSON.parse(child.stdout), { calls: 0, checkedAt, retryAt });
  }
  now = retryAt;
  await acquireFederalMoney("sam-gov-entities", "CT", { ...options, fetch: async () => { calls++; return Response.json({ totalRecords: 0, entityData: [] }); } });
  assert.equal(calls, 2, "the first call at the publisher's reset resumes, including after a quota HTTP 200 control response");
  assert.equal((await readSavedSamQuota(evidenceStore))?.checkedAt, checkedAt, "blocked checks and reset admission preserve the original observation for Admin");
});

test("SAM holds until the later publisher reset and never retries during its quota day", async () => {
  const cases = [
    { body: { nextAccessTime: "2026-Oct-25 03:45:00+0000 UTC" }, header: null, expected: "2026-10-25T03:45:00.000Z" },
    { body: { description: "You can access API after 2026-Oct-24 02:30:00+0000 UTC" }, header: null, expected: "2026-10-24T02:30:00.000Z" },
    { body: { nextAccessTime: retryAt }, header: "Sun, 25 Oct 2026 00:00:00 GMT", expected: "2026-10-25T00:00:00.000Z" },
    { body: { nextAccessTime: "2026-10-23T23:00:00Z" }, header: "60", expected: retryAt },
    { body: { nextAccessTime: "unavailable" }, header: null, expected: retryAt },
  ];
  for (const row of cases) {
    const vault = new MemoryEvidenceStore();
    await assert.rejects(recordSamQuotaResponse(vault, { code: 900804, ...row.body }, checkedAt, row.header), error => error instanceof SamQuotaFailure && error.retryAt === row.expected);
    assert.equal((await readSavedSamQuota(vault))?.retryAt, row.expected);
  }
});

test("one SAM quota response stops every remaining state and later source invocation", async t => {
  t.mock.method(Date, "now", () => Date.parse("2026-10-23T23:59:59.999Z"));
  const evidenceStore = new MemoryEvidenceStore(), store = new MemoryRoutineDataStore();
  let calls = 0;
  const input = { source: "sam-gov-entities" as const, store, states: ["CT", "DE", "DC", "FL"], now: () => checkedAt,
    identities: async () => ({ divisions: [], governments: [], bodies: [] }),
    acquireOptions: { evidenceStore, samGovApiKey: "synthetic-key", fetch: (async () => { calls++; return Response.json({ code: "900804", nextAccessTime: retryAt }, { status: 429 }); }) as typeof fetch,
      sleep: async () => { throw new Error("No quota retry sleep."); } } };
  const first = await refreshFederalMoney(input);
  assert.equal(calls, 1); assert.equal(first.outcome.candidate.state, "SOURCE_BLOCKED");
  assert.ok(first.projection.states.every(row => row.status === "OUTAGE" && row.reason?.includes(retryAt)));
  await refreshFederalMoney({ ...input, store: new MemoryRoutineDataStore(), now: () => "2026-10-23T20:00:00.000Z" });
  assert.equal(calls, 1, "the durable source hold covers every state, even in a fresh refresh invocation");
});

test("a SAM quota on an extract download stops pending polls immediately", async t => {
  const root = await mkdtemp(join(tmpdir(), "sam-download-quota-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const evidenceStore = new MemoryEvidenceStore();
  let calls = 0;
  const options = { evidenceStore, cacheRoot: root, now: () => checkedAt, samGovApiKey: "synthetic-key",
    sleep: async () => { throw new Error("No polling after the daily request allowance is exhausted."); },
    fetch: (async (input, init) => {
      calls++;
      if (new URL(String(input)).pathname.endsWith("/entities")) return new Response("Extract File will be available for download with POST url: https://api.sam.gov/entity-information/v3/download-entities?token=synthetic-token in some time.");
      assert.equal(init?.method, "POST");
      return Response.json({ code: "900804", nextAccessTime: retryAt }, { status: 429 });
    }) as typeof fetch };
  await assert.rejects(acquireFederalMoney("sam-gov-entities", "CT", options), SamQuotaFailure);
  assert.equal(calls, 2);
  await assert.rejects(acquireFederalMoney("sam-gov-entities", "CT", options), SamQuotaFailure);
  assert.equal(calls, 2, "the saved hold prevents the next extract request as well as its download polls");
});
