import { strict as assert } from "node:assert";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { lockKey, unlockKey } from "../lib/core/keys-crypto.ts";
import { KEYS_DDL, keysStore } from "../lib/core/keys-store.ts";
import { testDueKeys, testKey } from "../lib/core/keys-test.ts";
import { keyProblems, keysRunnerPass } from "../lib/core/keys-runner.ts";

const MASTER = "42".repeat(32), SECRET = "test-private-key-never-display";
const AT = "2026-10-29T12:00:00.000Z";
async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const db = new PGlite();
  t.after(async () => { await db.close(); });
  await db.exec(KEYS_DDL);
  const store = keysStore(async (text, params) => (await db.query<Record<string, unknown>>(text, params ? [...params] : [])).rows, MASTER);
  return { db, store };
}
const good = async () => ({ working: true, says: "The service accepted the key." });

test("key encryption uses a new nonce and refuses changed names, bytes and master keys", () => {
  const a = lockKey("Example", SECRET, MASTER), b = lockKey("Example", SECRET, MASTER);
  assert.notEqual(a, b);
  assert.equal(a.includes(SECRET), false);
  assert.equal(unlockKey("Example", a, MASTER), SECRET);
  assert.throws(() => unlockKey("Other", a, MASTER), /could not be opened/);
  assert.throws(() => unlockKey("Example", a, "43".repeat(32)), /could not be opened/);
  const parts = a.split("."); parts[3] = Buffer.from("changed").toString("base64url");
  assert.throws(() => unlockKey("Example", parts.join("."), MASTER), /could not be opened/);
  assert.throws(() => lockKey("Example", SECRET, undefined), /encryption setting/);
});

test("save, test, direct runner read and delete work without an Admin session", async t => {
  const { db, store } = await fixture(t);
  await store.save("Example", SECRET, "anthropic", AT);
  assert.equal(await testDueKeys(store, AT, "Example", async (service, value) => {
    assert.equal(service, "anthropic"); assert.equal(value, SECRET); return good();
  }), 1);
  const saved = (await db.query<{ locked: string }>("SELECT locked FROM cp_keys")).rows[0];
  assert.equal(saved.locked.includes(SECRET), false);
  const list = await store.list();
  assert.equal(list[0].working, true);
  assert.equal(JSON.stringify(list).includes(SECRET), false);
  assert.equal(JSON.stringify(list).includes(saved.locked), false);
  assert.equal(list[0].runnerReadAt, null);
  await keysRunnerPass(store, "2026-10-29T12:01:00.000Z");
  assert.equal((await store.list())[0].runnerReadAt, "2026-10-29T12:01:00.000Z");
  assert.equal(await store.read("Example"), SECRET);
  await store.remove("Example");
  assert.equal(await store.read("Example", true), undefined);
  assert.deepEqual(await store.list(), []);
});

test("daily checks run at 24 hours, survive restart and are claimed once by competing runners", async t => {
  const { store } = await fixture(t);
  await store.save("Example", SECRET, "anthropic", AT);
  let tests = 0;
  const check = async () => { tests++; return good(); };
  await testDueKeys(store, AT, undefined, check);
  assert.equal(await testDueKeys(store, "2026-10-30T11:59:59.999Z", undefined, check), 0);
  const next = "2026-10-30T12:00:00.000Z";
  const counts = await Promise.all([testDueKeys(store, next, undefined, check), testDueKeys(store, next, undefined, check)]);
  assert.equal(counts.reduce((n, x) => n + x, 0), 1);
  assert.equal(tests, 2);
});

test("a killed test is reclaimed and old results cannot overwrite a replacement or resurrect a deleted key", async t => {
  const { store } = await fixture(t);
  const old = await store.save("Example", SECRET, "anthropic", AT);
  assert.equal((await store.claimTests(AT)).length, 1);
  assert.equal((await store.claimTests("2026-10-29T12:01:59.999Z")).length, 0);
  assert.equal((await store.claimTests("2026-10-29T12:02:00.000Z")).length, 1);
  await store.save("Example", "replacement", "anthropic", AT);
  await store.tested("Example", old, await good(), AT);
  assert.equal((await store.list())[0].working, false);
  await testDueKeys(store, AT, "Example", good);
  assert.equal((await store.list())[0].working, true);
  await store.remove("Example");
  await store.tested("Example", old, await good(), AT);
  assert.deepEqual(await store.list(), []);
});

test("HTML success pages and provider failures never count as working or expose secret-bearing errors", async () => {
  const fake = (response: Response) => (async () => response) as typeof fetch;
  assert.equal((await testKey("census", SECRET, fake(new Response("<html>Invalid Key</html>")))).working, false);
  assert.equal((await testKey("anthropic", SECRET, fake(Response.json({ error: "no" })))).working, false);
  assert.equal((await testKey("anthropic", SECRET, fake(Response.json({ data: [{ id: "claude" }] })))).working, true);
  const failure = await testKey("anthropic", SECRET, (async () => { throw new Error(SECRET); }) as typeof fetch);
  assert.equal(failure.working, false);
  assert.equal(JSON.stringify(failure).includes(SECRET), false);
  assert.match((await testKey("anthropic", SECRET, fake(new Response(null, { status: 429 })))).says, /usage limit/);
});

test("failed and overdue key checks appear in the brief and disappear after recovery", async t => {
  const { store } = await fixture(t);
  await store.save("Congress", SECRET, "congress", AT);
  await testDueKeys(store, AT, undefined, async () => ({ working: false, says: "The service refused this key or its access." }));
  assert.match(keyProblems(await store.list(), AT)[0].what, /Congress.*refused/);
  const next = "2026-10-30T12:00:00.000Z";
  await testDueKeys(store, next, undefined, good);
  assert.deepEqual(keyProblems(await store.list(), next), []);
  assert.match(keyProblems(await store.list(), "2026-10-31T12:00:00.000Z")[0].what, /overdue/);
});
