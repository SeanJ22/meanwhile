import assert from "node:assert/strict";
import test from "node:test";
import { runtimeContractRetry, RUNTIME_CONTRACT_RETRY_MS, RUNTIME_CONTRACT_SQL_SETTINGS } from "../scripts/apply-migrations.mts";

const settle = () => new Promise<void>(resolve => setImmediate(resolve));

test("contract SQL bounds are local to the migration transaction", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = new PGlite();
  try {
    await pg.exec("BEGIN");
    for (const statement of RUNTIME_CONTRACT_SQL_SETTINGS) await pg.exec(statement);
    assert.equal((await pg.query<{ lock_timeout: string }>("SHOW lock_timeout")).rows[0].lock_timeout, "250ms");
    assert.equal((await pg.query<{ statement_timeout: string }>("SHOW statement_timeout")).rows[0].statement_timeout, "1s");
    await pg.exec("ROLLBACK");
    assert.equal((await pg.query<{ statement_timeout: string }>("SHOW statement_timeout")).rows[0].statement_timeout, "0");
  } finally { await pg.close(); }
});

test("a slow or failed contract never holds work and retries only on its slow clock", async () => {
  let finish!: (ok: boolean) => void;
  let scheduled: (() => void) | null = null;
  let runs = 0;
  let work = 0;
  const retries = runtimeContractRetry({
    run: async () => { runs++; return new Promise(resolve => { finish = resolve; }); },
    onError: error => { throw error; },
    schedule: (run, delay) => { assert.equal(delay, RUNTIME_CONTRACT_RETRY_MS); scheduled = run; return () => { scheduled = null; }; },
  });
  assert.equal(retries.request("sha", "/checkout"), undefined);
  for (let i = 0; i < 3; i++) { retries.request("sha", "/checkout"); work++; }
  await settle();
  assert.equal(work, 3, "every work clock ran while the migration is still unresolved");
  assert.equal(runs, 1);
  finish(false); await settle();
  for (let i = 0; i < 3; i++) { retries.request("sha", "/checkout"); work++; }
  await settle();
  assert.equal(runs, 1, "cycle boundaries cannot retry the failed migration early");
  assert.ok(scheduled);
  (scheduled as () => void)(); await settle();
  assert.equal(runs, 2);
  finish(true); await settle();
  retries.request("sha", "/checkout"); await settle();
  assert.equal(runs, 2, "successful contracts are not replayed");
  await retries.stop();
});

test("exceptions are reported, release changes never overlap DDL, and shutdown cancels retry", async () => {
  const errors: string[] = [], starts: string[] = [];
  let finish!: () => void;
  let scheduled: (() => void) | null = null;
  const retries = runtimeContractRetry({
    run: async (sha, cwd) => {
      starts.push(sha + cwd);
      if (sha === "old") await new Promise<void>(resolve => { finish = resolve; });
      throw new Error("migration failed");
    },
    onError: (error, sha) => { errors.push(`${sha}:${String(error)}`); },
    schedule: run => { scheduled = run; return () => { scheduled = null; }; },
  });
  retries.request("old", "/old"); await settle();
  retries.request("new", "/new"); await settle();
  assert.deepEqual(starts, ["old/old"]);
  finish(); await settle(); await settle();
  assert.deepEqual(starts, ["old/old", "new/new"]);
  assert.equal(errors.length, 2);
  assert.ok(scheduled);
  await retries.stop();
  assert.equal(scheduled, null);
  retries.request("another", "/another"); await settle();
  assert.equal(starts.length, 2);
});

test("shutdown ends an owned migration instead of waiting for its full attempt ceiling", async () => {
  let finish!: (ok: boolean) => void;
  let cancelled = false;
  const retries = runtimeContractRetry({ run: () => new Promise(resolve => { finish = resolve; }),
    onError: error => { throw error; }, cancelActive: async () => { cancelled = true; finish(false); } });
  retries.request("sha", "/checkout"); await settle();
  await retries.stop();
  assert.equal(cancelled, true);
});
