import assert from "node:assert/strict";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { KEYS_DDL, keysStore } from "../lib/core/keys-store.ts";
import { savedKeysCache } from "../lib/core/keys-cache.ts";
import { installSavedValues, storedKeyValue, storedKeyEnvironment, selectSavedDatabase } from "../lib/core/keys-values.ts";

test("saved snapshots fetch only changes, retain the last complete read, and never reopen deleted keys from host settings", async () => {
  const db = new PGlite(), statements: string[] = [];
  const master = "42".repeat(32), at = new Date().toISOString();
  const query = async (text: string, params?: readonly unknown[]) => {
    statements.push(text); return (await db.query<Record<string, unknown>>(text, params ? [...params] : [])).rows;
  };
  const store = keysStore(query, master);
  const oldHost = process.env.ANTHROPIC_API_KEY, oldOptions = process.env.NODE_OPTIONS;
  let installed, closed = false;
  try {
    await db.exec(KEYS_DDL);
    process.env.ANTHROPIC_API_KEY = "stale-host-setting"; process.env.NODE_OPTIONS = "--no-warnings";
    await store.save("NODE_OPTIONS", "a-key-with-a-human-chosen-name", "signing", at);
    await store.save("ANTHROPIC_API_KEY", "saved-website-key", "anthropic", at, false, "website");
    await store.save("ANTHROPIC_API_KEY.runner", "saved-runner-key", "anthropic", at, false, "runner");
    await store.save("CENSUS_API_KEY", "shared-source-key", "census", at, false, "website");
    await store.save("WTP_PRODUCTION_DATABASE_URL_READONLY", "reader-connection", "postgres", at, false, "runner");
    await store.save("WTP_PRODUCTION_DATABASE_URL_WRITE", "writer-connection", "postgres", at, false, "runner");
    await store.save("NEON_BILLING_API_KEY", "billing-only-key", "neon", at, false, "runner");
    const cache = savedKeysCache(query, master, "runner", name => name !== "NEON_BILLING_API_KEY");
    statements.length = 0;
    installed = installSavedValues(await cache.refresh());
    assert.equal(statements.length, 1);
    assert.equal(storedKeyValue("ANTHROPIC_API_KEY"), "saved-runner-key");
    assert.equal(storedKeyValue("NEON_BILLING_API_KEY"), undefined);
    assert.equal(storedKeyValue("CENSUS_API_KEY"), "shared-source-key", "a key already saved by either runtime is available to the other");
    assert.equal(storedKeyValue("NODE_OPTIONS"), "a-key-with-a-human-chosen-name");
    assert.equal(storedKeyValue("NODE_OPTIONS", storedKeyEnvironment()), "a-key-with-a-human-chosen-name", "computed saved names remain readable without becoming OS settings");
    const duplicate = await import(new URL("../lib/core/keys-values.ts?other-bundle", import.meta.url).href);
    assert.equal(duplicate.storedKeyValue("NODE_OPTIONS", storedKeyEnvironment()), "a-key-with-a-human-chosen-name");
    assert.equal(storedKeyValue("NODE_OPTIONS", duplicate.storedKeyEnvironment()), "a-key-with-a-human-chosen-name");
    assert.equal({...storedKeyEnvironment()}.NODE_OPTIONS, "--no-warnings", "arbitrary saved names cannot change child runtime settings");
    assert.equal(storedKeyValue("ANTHROPIC_API_KEY", { ANTHROPIC_API_KEY: "injected-fixture" }), "injected-fixture");
    selectSavedDatabase("WTP_PRODUCTION_DATABASE_URL_READONLY");
    assert.equal(storedKeyValue("DATABASE_URL"), "reader-connection");
    assert.equal({...storedKeyEnvironment()}.DATABASE_URL, "reader-connection");
    selectSavedDatabase("WTP_PRODUCTION_DATABASE_URL_WRITE");
    assert.equal(storedKeyValue("DATABASE_URL"), "writer-connection");
    selectSavedDatabase(undefined);
    statements.length = 0;
    installSavedValues(await cache.refresh());
    assert.equal(statements.length, 1);
    assert.ok(!statements[0].includes("locked"));
    await store.save("ANTHROPIC_API_KEY.runner", "replacement-key", "anthropic", at, false, "runner");
    statements.length = 0;
    const a = cache.refresh(), b = cache.refresh();
    assert.equal(a, b);
    installSavedValues(await a);
    assert.equal(statements.length, 2);
    assert.equal(storedKeyValue("ANTHROPIC_API_KEY"), "replacement-key");
    await store.remove("ANTHROPIC_API_KEY.runner", at);
    installSavedValues(await cache.refresh());
    assert.equal(storedKeyValue("ANTHROPIC_API_KEY"), undefined);
    assert.equal(storedKeyEnvironment().ANTHROPIC_API_KEY, undefined);
    assert.equal("ANTHROPIC_API_KEY" in storedKeyEnvironment(), false);
    assert.equal(Object.keys(storedKeyEnvironment()).includes("ANTHROPIC_API_KEY"), false);
    await store.save("ANTHROPIC_API_KEY.runner", "new-key", "anthropic", at, false, "runner");
    installSavedValues(await cache.refresh());
    await db.exec("UPDATE cp_keys SET locked='broken',version='new-invalid-version' WHERE name='ANTHROPIC_API_KEY.runner'");
    await assert.rejects(cache.refresh(), /could not be opened/);
    assert.equal(storedKeyValue("ANTHROPIC_API_KEY"), "new-key");
    await db.close(); closed = true;
    await assert.rejects(cache.refresh());
    assert.equal(storedKeyValue("ANTHROPIC_API_KEY"), "new-key");
  } finally {
    selectSavedDatabase(undefined);
    installSavedValues(installed);
    if (oldOptions === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = oldOptions;
    if (oldHost === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = oldHost;
    if (!closed) await db.close();
  }
});


test("local fixtures accept loopback only and never substitute a remote host setting", async () => {
  const { installLocalDatabaseFixture } = await import("../lib/core/keys-local-fixture.ts");
  const previous = installSavedValues(undefined);
  try {
    installLocalDatabaseFixture(undefined);
    assert.equal(storedKeyValue("DATABASE_URL"), undefined);
    assert.throws(() => installLocalDatabaseFixture("postgres://fixture:fixture@remote.example/fixture"), /on this machine/);
    const local = "postgres://fixture:fixture@127.0.0.1:5432/fixture";
    installLocalDatabaseFixture(local);
    assert.equal(storedKeyValue("DATABASE_URL"), local);
  } finally { installSavedValues(previous); }
});
