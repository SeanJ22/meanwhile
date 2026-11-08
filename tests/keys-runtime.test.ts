import assert from "node:assert/strict";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { KEYS_DDL, keysStore } from "../lib/core/keys-store.ts";
import { keysUnreachable, savedKeysRuntime } from "../lib/core/keys-runtime.ts";
import { installSavedValues, storedKeyValue, storedKeyEnvironment } from "../lib/core/keys-values.ts";

test("direct runtime reads honor their role, record real openings, refresh changes and retain the last complete snapshot", async () => {
  const db = new PGlite(), master = "42".repeat(32), at = new Date().toISOString();
  const statements: string[] = [], warnings: string[] = [];
  let fail = false, now = Date.now();
  const query = async (text: string, params?: readonly unknown[]) => {
    statements.push(text);
    if (fail) throw new Error("a-private-connection-must-never-be-logged");
    return (await db.query<Record<string, unknown>>(text, params ? [...params] : [])).rows;
  };
  const previous = installSavedValues(undefined), store = keysStore(query, master);
  try {
    await db.exec(KEYS_DDL);
    await store.save("ANTHROPIC_API_KEY", "saved-ai", "anthropic", at);
    await store.save("WTP_PRODUCTION_DATABASE_URL_WRITE", "saved-writer", "postgres", at);
    await store.save("NEON_BILLING_API_KEY", "private-billing", "neon", at);
    const website = savedKeysRuntime(query, master, "website", () => now, message => warnings.push(message));
    await website.refresh();
    assert.equal(storedKeyValue("ANTHROPIC_API_KEY"), "saved-ai");
    assert.throws(() => { storedKeyEnvironment().ANTHROPIC_API_KEY = "legacy"; }, TypeError);
    assert.equal(storedKeyValue("WTP_PRODUCTION_DATABASE_URL_WRITE"), undefined);
    assert.equal(storedKeyValue("NEON_BILLING_API_KEY"), undefined);
    assert.equal((await store.list())[0].runnerReadAt, null, "website reads do not claim a runner read");
    const runner = savedKeysRuntime(query, master, "runner", () => now, message => warnings.push(message));
    await runner.refresh();
    assert.equal(storedKeyValue("WTP_PRODUCTION_DATABASE_URL_WRITE"), "saved-writer");
    assert.equal((await store.list())[0].runnerReadAt, null, "a lane child's startup read writes nothing");
    await runner.refresh(true);
    const readAt = (await store.list()).find(row => row.name === "ANTHROPIC_API_KEY")!.runnerReadAt;
    assert.ok(readAt);
    statements.length = 0;
    await runner.refresh();
    assert.equal(statements.length, 0, "a warm request within the minute needs no database read");
    now += 60_000;
    await runner.refresh(true);
    assert.equal(statements.length, 2, "one version read and one conditional batch receipt");
    assert.ok(!statements[0].includes("locked"));
    assert.equal((await store.list()).find(row => row.name === "ANTHROPIC_API_KEY")!.runnerReadAt, readAt, "unchanged cached bytes are not claimed as a new opening");
    await store.save("ANTHROPIC_API_KEY", "rotated-ai", "anthropic", at);
    fail = true;
    await runner.refresh(true);
    assert.equal(storedKeyValue("ANTHROPIC_API_KEY"), "saved-ai");
    assert.ok(!JSON.stringify(warnings).includes("a-private-connection"));
    fail = false;
    await runner.refresh(true);
    assert.equal(storedKeyValue("ANTHROPIC_API_KEY"), "rotated-ai");
    await store.remove("ANTHROPIC_API_KEY", at);
    await runner.refresh(true);
    assert.equal(storedKeyValue("ANTHROPIC_API_KEY"), undefined);
    fail = true;
    const cold = savedKeysRuntime(query, master, "runner", () => now, message => warnings.push(message));
    await assert.rejects(cold.refresh(), { message: /^The saved keys could not be reached: the control-plane database refused the read\. Technical details: Error\.$/ });
  } finally { installSavedValues(previous); await db.close(); }
});

test("a cold database that answers on its third try still loads the keys, and the next pass stays short", async () => {
  const db = new PGlite(), master = "42".repeat(32), at = new Date().toISOString(), previous = installSavedValues(undefined);
  const warned: string[] = [];
  let cold = 2, calls = 0, now = Date.now();
  const query = async (text: string, params?: readonly unknown[]) => {
    calls++;
    if (cold > 0) { cold--; throw Object.assign(new Error("aborted"), { name: "TimeoutError" }); }
    return (await db.query<Record<string, unknown>>(text, params ? [...params] : [])).rows;
  };
  try {
    await db.exec(KEYS_DDL);
    await keysStore(async (text, params) => (await db.query<Record<string, unknown>>(text, params ? [...params] : [])).rows, master).save("ANTHROPIC_API_KEY", "saved-ai", "anthropic", at);
    const runtime = savedKeysRuntime(query, master, "runner", () => now, message => warned.push(message));
    await runtime.refresh(true);
    assert.deepEqual(warned, [], "a recovered cold start warns nobody");
    assert.equal(storedKeyValue("ANTHROPIC_API_KEY"), "saved-ai", "the first load survives two slow answers");
    calls = 0; now += 60_000;
    await runtime.refresh(true);
    assert.ok(calls > 0 && calls <= 2, "the next scheduled pass is one short read");
    cold = 99;
    await assert.doesNotReject(runtime.refresh(true), "a later failure keeps the last snapshot and gives one attempt");
    assert.equal(storedKeyValue("ANTHROPIC_API_KEY"), "saved-ai");
    const never = savedKeysRuntime(async () => { throw Object.assign(new Error("secret-host.example"), { name: "TimeoutError" }); }, master, "runner", () => now, () => undefined);
    await assert.rejects(never.refresh(true), { message: "The saved keys could not be reached: the control-plane database did not answer within 2 seconds. Technical details: TimeoutError." });
  } finally { installSavedValues(previous); await db.close(); }
});

test("each cause of an unreachable read is named in plain words without a connection string or key", () => {
  const says = (error: unknown) => keysUnreachable(error).message;
  assert.match(says(new Error("The control-plane database address is not set.")), /^The saved keys could not be reached: the control-plane database address is not set on this machine\./);
  assert.match(says(new Error("The Keys box needs its encryption setting.")), /the encryption setting is missing or malformed/);
  assert.match(says(new Error("The saved key could not be opened.")), /a saved key would not open/);
  assert.match(says(Object.assign(new Error("fetch failed postgres://u:pw@host/db"), { cause: { name: "AbortError" } })), /did not answer within 2 seconds/);
  assert.ok(!says(new Error("postgres://user:pw@host/db")).includes("pw@host"));
});
