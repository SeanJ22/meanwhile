import assert from "node:assert/strict";
import test from "node:test";
import { ACTION_HISTORY_PAGE_SQL, readActionHistoryPage } from "../lib/control-plane/repository/action-history-atomic.ts";
import type { Sql } from "../lib/control-plane/repository/pg-store.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { submit } from "../lib/control-plane/gateway/gateway.ts";
import { PGlite } from "@electric-sql/pglite";
import type { ActionReceipt } from "../lib/control-plane/gateway/contract.ts";
import { confirmReceipt } from "../lib/control-plane/gateway/confirmation.ts";
import { readV6History } from "../lib/control-plane/admin-view/admin-v6-history.ts";

test("history checks revisions of the bounded newest-first receipt selection before reading changed bodies", async () => {
  const calls: unknown[][] = [];
  const sql = { query: async (query: string, params: unknown[]) => { calls.push([query, params]);
    return /source\.xmin/.test(query)?[{log_key:"admin-action",position:"42",etag:"receipt-42"}]
      :[{log_key:"admin-action",position:"42",changed_at:"2026-10-25T00:00:00Z",record:{type:"fleet.deployHere"},__etag:"receipt-42"}];
  } } as unknown as Sql;
  const result = await readActionHistoryPage(sql, { scope: "st:xx", beforePosition: 50, limit: 20 });
  assert.equal(result[0].position, 42);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0][1], ["st:xx", 50, 20]);
  assert.match(ACTION_HISTORY_PAGE_SQL, /JOIN cp_log_admin_receipts/);
  assert.match(ACTION_HISTORY_PAGE_SQL, /ORDER BY p.source_position DESC\s+LIMIT \$3/);
  assert.doesNotMatch(ACTION_HISTORY_PAGE_SQL, /mapping_state\s*=|readiness/);
  assert.doesNotMatch(ACTION_HISTORY_PAGE_SQL, /record->>'type'/, "receipt types must not change the raw page window");
  assert.deepEqual(await readActionHistoryPage(sql,{scope:"st:xx",beforePosition:50,limit:20}),result);
  assert.equal(calls.length,3,"unchanged receipts require only the version/membership query");
  await assert.rejects(readActionHistoryPage(sql, { scope: "us", limit: 52 }), /INVALID_HISTORY_QUERY/);
  assert.equal(calls.length, 3);
});
test("a send retains its requested place while its canonical subject still confirms the runner intent", async () => {
  const repos = createMemoryRepositories();
  const deps = { repos, now: () => "2026-10-04T06:00:00Z", currentStateVersion: null, codeSha: null };
  const result = await submit({ type: "fleet.deployHere", subject: "st:xx", input: { note: "Send agents to the selected place" },
    caller: "OWNER_SESSION", actorRef: "test", stateVersion: null, idempotencyKey: "history-place" }, deps);
  assert.equal(result.ok, true);
  assert.equal(result.receipt.requestedSubject, "st:xx");
  assert.notEqual(result.receipt.subject, "st:xx");
  assert.equal(result.receipt.outcome, "QUEUED");
});

test("history preserves the raw fifty-row window and cursors while leaving unsupported six-megabyte changes in the store", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE cp_log_admin_receipts(log_key text,record_id text,position bigint,recorded_at timestamptz,
      changed_at timestamptz DEFAULT now(),record jsonb,PRIMARY KEY(log_key,record_id));
      CREATE TABLE cp_admin_action_history_projection(gateway_receipt_id text,gateway_log_key text,source_position bigint);
      CREATE TABLE cp_admin_action_history_scope_ref(gateway_receipt_id text,scope_key text);`);
    const at = "2026-10-28T12:00:00.000Z";
    const make = (position: number, type: string): ActionReceipt => ({ formatVersion: 1, receiptId: `${type}:${position}`,
      idempotencyKey: String(position), type, label: "Saved order", authority: "REVERSIBLE_NONPRODUCTION", subjectKind: "a setting",
      subject: "us", requestedSubject: "us", inputDigest: "digest", caller: "OWNER_SESSION", actorRef: "fixture", stateVersion: null,
      codeSha: "sha", startedAt: at, completedAt: at, outcome: "DONE", says: "The selected setting is saved.", refusal: null,
      openedWork: [{ kind: "setting", id: "setting", title: "The selected setting" }], readBackAt: "/admin", undo: "undo command ".repeat(40_000),
      change: { before: "Previous setting ".repeat(100), after: "Current setting" } });
    const fullRows = Array.from({ length: 53 }, (_, index) => {
      const position = 53 - index;
      const type = position % 3 === 0 ? "config.setSetting" : position === 52 ? "decision.record" : "data.repair";
      const receipt = make(position, type);
      return { position, receipt: position === 53 ? { ...receipt,
        change: { before: "source body ".repeat(550_000), after: "saved" } } : receipt };
    });
    for (const { position, receipt } of fullRows) {
      await db.query("INSERT INTO cp_log_admin_receipts(log_key,record_id,position,recorded_at,record) VALUES('admin-action',$1,$2,$3,$4)", [receipt.receiptId, position, at, JSON.stringify(receipt)]);
      await db.query("INSERT INTO cp_admin_action_history_projection VALUES($1,'admin-action',$2)", [receipt.receiptId, position]);
    }
    const transferred: unknown[] = [];
    const sql: Sql = { query: async (text, params = []) => {
      const rows = (await db.query<Record<string, unknown>>(text, [...params])).rows;
      transferred.push(...rows); return rows;
    } };
    const first = await readActionHistoryPage(sql, { scope: "us", limit: 2 });
    assert.deepEqual(first.map(row => row.position), [53, 52], "unsupported receipts still occupy their original raw positions");
    assert.ok(first.every(row => !("change" in row.receipt)), "unsupported change fields are not transferred");
    assert.equal(first[0].receipt.says, fullRows[0].receipt.says, "common receipt fields remain intact");
    const settingPage = await readActionHistoryPage(sql, { scope: "us", beforePosition: 49, limit: 2 });
    assert.deepEqual(settingPage.map(row => row.position), [48, 47]);
    const setting = fullRows.find(row => row.position === 48)!.receipt;
    assert.equal(settingPage[0].receipt.change?.before, setting.change?.before, "displayed before/after words remain exact");
    assert.ok([...first, ...settingPage].every(row => !("undo" in row.receipt) && !("actorRef" in row.receipt) && !("inputDigest" in row.receipt)));
    assert.ok(Buffer.byteLength(JSON.stringify(transferred)) < 100_000, "unsupported source bodies and undo commands never cross the connection");
    const repos = createMemoryRepositories();
    assert.deepEqual(await confirmReceipt(repos, settingPage[0].receipt, Date.parse(at)), await confirmReceipt(repos, setting, Date.parse(at)));
    const full = { ...repos, adminActionHistoryPage: async (query: { beforePosition?: number | null; limit: number }) => fullRows
      .filter(row => query.beforePosition == null || row.position < query.beforePosition).slice(0, query.limit) };
    const projected = { ...repos, adminActionHistoryPage: (query: { scope: string; beforePosition?: number | null; limit: number }) => readActionHistoryPage(sql, query) };
    const query = { scope: "us", asOf: at, limit: 50 };
    const expected = await readV6History(full, query), actual = await readV6History(projected, query);
    assert.equal(actual.data.length, 16, "the original raw fifty receipts still yield sixteen visible entries");
    assert.deepEqual(actual, expected, "the public history page retains the same words, counts and continuation");
    assert.ok(actual.page.nextCursor);
    assert.equal(JSON.parse(Buffer.from(actual.page.nextCursor, "base64url").toString()).beforePosition, 4,
      "continuation advances by the raw window, including unsupported receipts");
    assert.deepEqual(await readV6History(projected, { ...query, cursor: actual.page.nextCursor }),
      await readV6History(full, { ...query, cursor: expected.page.nextCursor }));
    assert.ok(!JSON.stringify(transferred).includes("source body"), "the six-megabyte unsupported change remains in the database");
    const oldest = make(0, "data.repair");
    await repos.adminReceipts.append("admin-action", oldest.receiptId, oldest, at);
    for (const { receipt } of [...fullRows].reverse()) await repos.adminReceipts.append("admin-action", receipt.receiptId, receipt, at);
    assert.deepEqual((await repos.adminActionHistoryPage!({ scope: "us", limit: 2 })).map(row => row.receipt.receiptId),
      first.map(row => row.receipt.receiptId), "memory uses the same raw window");
    const file = { ...repos, adminActionHistoryPage: undefined };
    assert.deepEqual(await readV6History(file, query), expected, "the file-store fallback preserves raw-window counts and words");
  } finally { await db.close(); }
});
