import assert from "node:assert/strict";
import test from "node:test";
import { PUBLISH_NOW_RETRY_MS, PUBLISH_NOW_SCAN_SLICE_MS, publishNowRetryItemIds, readPublishNowRetryIds, readPublishNowWorkerTasks, readWorkerPublicationItems, savePublishNowProgress } from "../lib/civic-data/publish-now.ts";
import { readPassCursor } from "../lib/facts/db.ts";
import type { FactDb } from "../lib/facts/publish.ts";
import { factDb } from "./helpers/fact-db.ts";

const NOW = "2026-10-22T10:00:00.000Z";
const later = (ms: number) => new Date(Date.parse(NOW) + ms).toISOString();

test("held inputs that cannot be read keep their future fallback even while its hour is in backoff", async () => {
  const item = { id: "held-board", autonomousPlan: { publication: { contractId: "registry-runtime:AZ" as const }, contract: { recordClass: "OFFICIAL_BOARD_DIRECTORY" } },
    publicationOutcome: { workerResultId: "none", status: "HELD" as const, recovery: "WORKER" as const, at: NOW } };
  const minute = later(60_000);
  assert.deepEqual(await readPublishNowWorkerTasks([item], async () => [], minute, null), [], "the hourly fallback is not due yet");
  assert.deepEqual(publishNowRetryItemIds([item], [], null), [item.id], "advancing the window must retain the future retry");
  assert.deepEqual(publishNowRetryItemIds([item], [], { pagesAt: new Map(), bodyPagesAt: new Map(), nationalAt: null, registryAt: null, routesAt: null }), [],
    "known unchanged inputs wait for changed source evidence");
  assert.deepEqual((await readPublishNowWorkerTasks([item], async () => [], later(3_600_000), null)).flatMap(task => task.ownerInvocation?.workItemIds ?? []), [item.id]);
});

test("a stuck item retries across restart without pinning the publication window or rereading unrelated old work", async () => {
  const db = await factDb();
  try {
    await db.pg.exec(`CREATE TABLE cp_work_items_history (id text PRIMARY KEY, value jsonb NOT NULL, changed_at timestamptz NOT NULL);
      CREATE TABLE cp_log_worker_results (log_key text, changed_at timestamptz);
      CREATE TABLE cp_log_artifacts (log_key text, changed_at timestamptz)`);
    const put = (id: string, at: string) => db.query("INSERT INTO cp_work_items_history VALUES ($1, $2::jsonb, $3)", [id,
      JSON.stringify({ autonomousPlan: { publication: { contractId: "registry-runtime:AZ" }, contract: { recordClass: "OFFICIAL_BOARD_DIRECTORY" } } }), at]);
    await put("stuck", "2026-10-13T00:00:00.000Z");
    await put("finished-old-work", "2026-10-13T00:00:00.000Z");
    await savePublishNowProgress(db, { startedAt: NOW, selectedItemIds: ["stuck", "finished-old-work"], owedItemIds: ["stuck"] });
    assert.equal(await readPassCursor(db.query, "publish-now"), NOW);
    assert.deepEqual(await readPublishNowRetryIds(db.query, later(PUBLISH_NOW_RETRY_MS - 1)), []);

    // The next process has no memory of the failed task. Its fresh window still reaches new work.
    await put("new-finding", later(30_000));
    const cursor = await readPassCursor(db.query, "publish-now");
    const { items: fresh } = await readWorkerPublicationItems(db.query, ["registry-runtime:AZ"], { at: cursor!, until: later(60_000), sharedInputsMoved: false },
      await readPublishNowRetryIds(db.query, later(60_000)));
    assert.deepEqual(fresh.map(item => item.id), ["new-finding"]);

    // A later process gets the old stuck item by its own due clock, with a cursor far beyond its changed_at.
    const retryAt = later(PUBLISH_NOW_RETRY_MS);
    const retries = await readPublishNowRetryIds(db.query, retryAt);
    assert.deepEqual(retries, ["stuck"]);
    const { items: due } = await readWorkerPublicationItems(db.query, ["registry-runtime:AZ"], { at: later(60_000), until: retryAt, sharedInputsMoved: false }, retries);
    assert.deepEqual(due.map(item => item.id), ["stuck"]);
    await savePublishNowProgress(db, { startedAt: retryAt, selectedItemIds: ["stuck"], owedItemIds: [] });
    assert.deepEqual(await readPublishNowRetryIds(db.query, later(PUBLISH_NOW_RETRY_MS * 3)), []);
    assert.equal(await readPassCursor(db.query, "publish-now"), retryAt);
  } finally { await db.pg.close(); }
});

test("a failed retry save rolls back cursor advancement and all partial retries", async () => {
  const db = await factDb();
  try {
    await savePublishNowProgress(db, { startedAt: NOW, selectedItemIds: [], owedItemIds: [] });
    const fail: FactDb = { transaction: work => db.transaction(query => work(async (sql, params) => {
      if (params?.[0] === "publish-now") throw new Error("cursor write failed");
      return query(sql, params);
    })) };
    await assert.rejects(savePublishNowProgress(fail, { startedAt: later(60_000), selectedItemIds: ["owed"], owedItemIds: ["owed"] }), /cursor write failed/);
    assert.equal(await readPassCursor(db.query, "publish-now"), NOW);
    assert.deepEqual(await readPublishNowRetryIds(db.query, later(PUBLISH_NOW_RETRY_MS * 2)), []);
  } finally { await db.pg.close(); }
});

test("retry clocks do not get pushed back by an unchanged item echoing in the next minute, and large retries page completely", async () => {
  const db = await factDb();
  try {
    const ids = Array.from({ length: 2_037 }, (_, index) => `item-${String(index).padStart(5, "0")}`);
    await savePublishNowProgress(db, { startedAt: NOW, selectedItemIds: ids, owedItemIds: ids });
    await savePublishNowProgress(db, { startedAt: later(60_000), selectedItemIds: ids, owedItemIds: ids });
    assert.deepEqual(await readPublishNowRetryIds(db.query, later(PUBLISH_NOW_RETRY_MS)), ids);
    await savePublishNowProgress(db, { startedAt: later(PUBLISH_NOW_RETRY_MS), selectedItemIds: ids, owedItemIds: ids });
    assert.deepEqual(await readPublishNowRetryIds(db.query, later(PUBLISH_NOW_RETRY_MS)), []);
    assert.deepEqual(await readPublishNowRetryIds(db.query, later(PUBLISH_NOW_RETRY_MS * 2)), ids);
  } finally { await db.pg.close(); }
});

test("a cursor days behind catches up in bounded slices and moves only as far as it read", async () => {
  const db = await factDb();
  try {
    await db.pg.exec(`CREATE TABLE cp_work_items_history (id text PRIMARY KEY, value jsonb NOT NULL, changed_at timestamptz NOT NULL);
      CREATE TABLE cp_log_worker_results (log_key text, changed_at timestamptz);
      CREATE TABLE cp_log_artifacts (log_key text, changed_at timestamptz)`);
    const put = (id: string, at: string) => db.query("INSERT INTO cp_work_items_history VALUES ($1, $2::jsonb, $3)", [id,
      JSON.stringify({ autonomousPlan: { publication: { contractId: "registry-runtime:AZ" }, contract: { recordClass: "OFFICIAL_ROSTER" } } }), at]);
    const stuck = "2026-10-12T10:00:00.000Z";
    await put("early", "2026-10-12T10:30:00.000Z");
    await put("late", "2026-10-22T09:30:00.000Z");
    const slices: unknown[][] = [];
    const counting = (sql: string, values: readonly unknown[]) => { slices.push([...values]); return db.query(sql, [...values]); };

    // An expired deadline still reads one slice, then stops; the cursor may move only to the end of that slice.
    const first = await readWorkerPublicationItems(counting, ["registry-runtime:AZ"], { at: stuck, until: NOW, sharedInputsMoved: false }, [], 0);
    assert.deepEqual(first.items.map(item => item.id), ["early"]);
    assert.equal(first.through, new Date(Date.parse(stuck) + PUBLISH_NOW_SCAN_SLICE_MS).toISOString());
    assert.equal(slices.length, 1);
    await savePublishNowProgress(db, { startedAt: NOW, scannedThrough: first.through!, selectedItemIds: ["early"], owedItemIds: [] });
    assert.equal(await readPassCursor(db.query, "publish-now"), first.through);

    // Given time, the next pass reads on from there to the pass start, skipping nothing.
    const rest = await readWorkerPublicationItems(counting, ["registry-runtime:AZ"], { at: first.through!, until: NOW, sharedInputsMoved: false });
    assert.deepEqual(rest.items.map(item => item.id), ["late"]);
    assert.equal(rest.through, NOW);
    assert.ok(slices.every(([, from, , to]) => Date.parse(String(to)) - Date.parse(String(from)) <= PUBLISH_NOW_SCAN_SLICE_MS), "no read spans more than one slice");
    await assert.rejects(savePublishNowProgress(db, { startedAt: NOW, scannedThrough: later(1), selectedItemIds: [], owedItemIds: [] }), /PUBLISH_NOW_PROGRESS_TIME_INVALID/);
  } finally { await db.pg.close(); }
});
