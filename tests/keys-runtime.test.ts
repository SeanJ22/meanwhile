import assert from "node:assert/strict";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { KEYS_DDL, keysStore } from "../lib/core/keys-store.ts";
import { savedKeysRuntime } from "../lib/core/keys-runtime.ts";
import { installSavedValues, storedKeyValue } from "../lib/core/keys-values.ts";

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
    assert.equal(storedKeyValue("WTP_PRODUCTION_DATABASE_URL_WRITE"), undefined);
    assert.equal(storedKeyValue("NEON_BILLING_API_KEY"), undefined);
    assert.equal((await store.list())[0].runnerReadAt, null, "website reads do not claim a runner read");
    const runner = savedKeysRuntime(query, master, "runner", () => now, message => warnings.push(message));
    await runner.refresh();
    assert.equal(storedKeyValue("WTP_PRODUCTION_DATABASE_URL_WRITE"), "saved-writer");
    const readAt = (await store.list()).find(row => row.name === "ANTHROPIC_API_KEY")!.runnerReadAt;
    assert.ok(readAt);
    statements.length = 0;
    await runner.refresh();
    assert.equal(statements.length, 0, "a warm request within the minute needs no database read");
    now += 60_000;
    await runner.refresh();
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
    await assert.rejects(cold.refresh(), { message: "The saved keys could not be reached." });
  } finally { installSavedValues(previous); await db.close(); }
});
