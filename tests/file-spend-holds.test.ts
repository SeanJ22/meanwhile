import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createLedger, type BudgetLedger } from "../lib/control-plane/budget.ts";
import { createFileRepositories, fileAggregateRepository } from "../lib/control-plane/repository/file-store.ts";
import { BUDGET_AGGREGATE_ID } from "../lib/control-plane/repository/shared.ts";
import { SPEND_HOLD_STALE_MS, type BudgetLine } from "../lib/control-plane/expansion/spend-holds.ts";

const at = "2026-10-15T12:00:00.000Z";
const line: BudgetLine = { key: "send:one", label: "One hunt", budgetUsd: 0.7, historicalUsd: 0, historyReadAt: at };
const admission = (id: string, key = line.key) => ({ holdId: `${id}#0`, jobId: id, obligationId: id,
  lines: { sends: [{ ...line, key }], areas: [] }, usd: 0.1, what: "one model request" });
const after = (ms: number) => new Date(Date.parse(at) + ms).toISOString();

test("file spend holds share atomic indexed admission and survive reopening without a budget ledger", async t => {
  const root = await mkdtemp(join(tmpdir(), "file-spend-holds-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const first = await createFileRepositories(root), second = await createFileRepositories(root);
  const decisions = await Promise.all(Array.from({ length: 30 }, (_, index) =>
    (index % 2 ? first : second).spendHolds.admit(admission(`job-${index}`), at)));
  assert.equal(decisions.filter(row => row.admit).length, 7);
  await assert.rejects(first.budget.read(), /no shared budget/);
  assert.deepEqual(await second.spendHolds.left([line], at), [0]);
  await first.spendHolds.settle({ jobId: "job-0", usd: 0.02, costRecordedAt: after(1) }, after(1));
  assert.deepEqual(await second.spendHolds.left([line], after(1)), [0.08]);
  const reopened = await createFileRepositories(root);
  assert.deepEqual(await reopened.spendHolds.left([line], after(1)), [0.08]);
  await reopened.spendHolds.release("job-1#0", after(1));
  assert.deepEqual(await first.spendHolds.left([line], after(1)), [0.18]);
  assert.equal(await first.spendHolds.sweep(after(SPEND_HOLD_STALE_MS + 1)), 5);
  assert.deepEqual(await second.spendHolds.left([line], after(SPEND_HOLD_STALE_MS + 1)), [0.68]);
});

test("file hold migration removes the ledger property and a replay preserves a hold already settled in SQLite", async t => {
  const root = await mkdtemp(join(tmpdir(), "file-spend-hold-move-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const budget = fileAggregateRepository<BudgetLedger>(root, "BudgetLedger", "budget");
  const hold = { holdId: "old#0", jobId: "old", obligationId: "old", keys: [line.key], usd: 0.1, heldAt: at, what: "old request", settled: null };
  await budget.put(BUDGET_AGGREGATE_ID, { ...createLedger({ hosts: [] }), spendHolds: { [hold.holdId]: hold } }, at);
  const migrated = await createFileRepositories(root);
  assert.equal("spendHolds" in (await migrated.budget.read()).value, false);
  assert.deepEqual(await migrated.spendHolds.left([line], at), [0.6]);
  await migrated.spendHolds.settle({ jobId: "old", usd: 0.02, costRecordedAt: after(1) }, after(1));
  const current = await migrated.budget.read();
  await migrated.budget.compareAndSet(current.revision, { ...current.value, spendHolds: { [hold.holdId]: hold } }, after(2));
  const replayed = await createFileRepositories(root);
  assert.equal("spendHolds" in (await replayed.budget.read()).value, false);
  assert.deepEqual(await replayed.spendHolds.left([line], after(2)), [0.68]);
});

test("file hold queries keep unrelated budgets separate and settle only the named job", async t => {
  const root = await mkdtemp(join(tmpdir(), "file-spend-hold-lines-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { spendHolds: store } = await createFileRepositories(root);
  for (let index = 0; index < 100; index++) await store.admit(admission(`other-${index}`, `send:other-${index}`), at);
  await store.admit(admission("ours"), at);
  await store.admit({ ...admission("ours"), holdId: "ours#1" }, at);
  await store.settle({ jobId: "ours", usd: 0.03, costRecordedAt: after(1) }, after(1));
  assert.deepEqual(await store.left([line, { ...line, key: "send:other-99" }], after(1)), [0.67, 0.6]);
  assert.deepEqual(await store.left([{ ...line, historicalUsd: 0.03, historyReadAt: after(1) }], after(1)), [0.67]);
  assert.deepEqual(await store.left([], at), []);
});


test("separate file workers cannot both spend the same remaining line budget", async t => {
  const root = await mkdtemp(join(tmpdir(), "file-spend-hold-workers-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await createFileRepositories(root);
  const factory = new URL("../lib/control-plane/repository/file-store.ts", import.meta.url).href;
  const loader = fileURLToPath(new URL("../scripts/register-test-loader.mjs", import.meta.url));
  const fixture = fileURLToPath(new URL("./helpers/install-fixture-doors.ts", import.meta.url));
  const results = await Promise.all(["one", "two", "three"].map(async worker => {
    const code = `const { createFileRepositories } = await import(${JSON.stringify(factory)});
      const { spendHolds } = await createFileRepositories(${JSON.stringify(root)});
      let admitted = 0;
      for (let index = 0; index < 10; index++) {
        const id = ${JSON.stringify(worker)} + index;
        const result = await spendHolds.admit({holdId:id,jobId:id,obligationId:id,
          lines:{sends:[${JSON.stringify(line)}],areas:[]},usd:0.1,what:'worker request'},${JSON.stringify(at)});
        if (result.admit) admitted++;
      }
      console.log(JSON.stringify(admitted));`;
    const { stdout } = await promisify(execFile)(process.execPath,
      ["--experimental-strip-types", "--import", loader, "--import", fixture, "--input-type=module", "-e", code]);
    return JSON.parse(stdout) as number;
  }));
  assert.equal(results.reduce((total, count) => total + count, 0), 7);
});
