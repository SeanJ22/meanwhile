import { strict as assert } from "node:assert";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { lockKey, unlockKey } from "../lib/core/keys-crypto.ts";
import { CAPABILITY_DDL } from "../lib/core/capability.ts";
import { KEYS_DDL, keysStore } from "../lib/core/keys-store.ts";
import { testDueKeys, testKey } from "../lib/core/keys-test.ts";
import { keyProblems, keysRunnerPass, savedKeysLane } from "../lib/core/keys-runner.ts";
import { IndependentRuntimeLaneScheduler } from "../lib/ops/independent-runtime-pass.ts";
import { importExistingKeys, importRuntimeKeys } from "../lib/core/keys-import.ts";
import initializer from "../netlify/functions/line-keeper-initialize.mts";
import { handleKeys } from "../lib/core/keys-http.ts";
import { ADMIN_ORIGIN, PUBLIC_SITE_ORIGIN, hostOf } from "../lib/ops/origins.ts";
import { adminSessionCookie, withAdminSessionKey } from "./admin-session.ts";

const MASTER = "42".repeat(32), SECRET = "test-private-key-never-display";
const AT = "2026-10-29T12:00:00.000Z";
async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const db = new PGlite();
  t.after(async () => { await db.close(); });
  await db.exec(KEYS_DDL);
  for (const ddl of CAPABILITY_DDL) await db.exec(ddl);
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
  assert.equal((await testKey("maptiler-service", SECRET, (async (_url, init) => {
    assert.equal(new Headers(init?.headers).get("authorization"), `Token ${SECRET}`);
    return Response.json({ datasets: [] });
  }) as typeof fetch)).working, true);
});

test("search keys are checked against a rejected control without submitting paid searches", async () => {
  for (const service of ["brave", "exa"] as const) {
    let calls = 0;
    const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
      calls++;
      if (service === "brave") assert.match(String(url), /count=-1/);
      else assert.equal(JSON.parse(String(init?.body)).numResults, -1);
      const headers = new Headers(init?.headers);
      const actual = (headers.get("x-api-key") ?? headers.get("x-subscription-token")) === SECRET;
      return actual ? Response.json({ error: "Invalid search parameters" }, { status: 400 })
        : Response.json({ error: "Invalid API key" }, { status: 401 });
    }) as typeof fetch;
    assert.equal((await testKey(service, SECRET, fetcher)).working, true);
    assert.equal(calls, 2);
  }
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

test("imports preserve distinct runtime credentials and never replace an owner's saved change", async t => {
  const { store } = await fixture(t);
  // Signing checks exercise the real site's HMAC without external services.
  await importExistingKeys({ WTP_ADMIN_SESSION_KEY: "runner-".repeat(8) }, store, AT, "runner");
  await importExistingKeys({ WTP_ADMIN_SESSION_KEY: "website-".repeat(8) }, store, AT, "website");
  assert.equal((await store.list()).length, 2);
  assert.equal(await store.read("WTP_ADMIN_SESSION_KEY"), "runner-".repeat(8));
  assert.equal(await store.read("WTP_ADMIN_SESSION_KEY.website"), "website-".repeat(8));
  assert.equal(await store.read("WTP_ADMIN_SESSION_KEY", false, AT, "website"), "website-".repeat(8));
  assert.equal(await store.read("WTP_ADMIN_SESSION_KEY", true, AT, "runner"), "runner-".repeat(8));
  await store.save("WTP_ADMIN_SESSION_KEY", SECRET, "signing", AT);
  await importExistingKeys({ WTP_ADMIN_SESSION_KEY: "runner-".repeat(8) }, store, AT, "runner");
  assert.equal(await store.read("WTP_ADMIN_SESSION_KEY"), SECRET);
  assert.equal((await store.list()).length, 2);
  await store.remove("WTP_ADMIN_SESSION_KEY", AT);
  await importExistingKeys({ WTP_ADMIN_SESSION_KEY: "runner-".repeat(8) }, store, AT, "runner");
  assert.equal(await store.read("WTP_ADMIN_SESSION_KEY"), undefined, "the import cannot restore a deleted key");
});

test("undo restores the previous encrypted value, retests it, and keeps every value out of history", async t => {
  const { store } = await fixture(t);
  await store.save("Example", SECRET, "signing", AT);
  await store.save("Example", "a-different-secret-long-enough", "signing", AT);
  assert.equal((await store.list())[0].canUndo, true);
  await store.undo("Example", AT);
  assert.equal(await store.read("Example"), SECRET);
  assert.equal((await store.list())[0].testedAt, null);
  await testDueKeys(store, AT, undefined, good);
  await store.remove("Example", AT);
  assert.equal(await store.read("Example"), undefined);
  await store.undo("Example", AT);
  assert.equal(await store.read("Example"), SECRET);
  const metadata = JSON.stringify(await store.list(true));
  assert.equal(metadata.includes(SECRET), false);
  assert.equal(metadata.includes("a-different-secret-long-enough"), false);
  assert.match(metadata, /No key/);
});

test("the protected Settings API saves, tests, lists and deletes without returning the submitted secret", async t => {
  const { store } = await fixture(t);
  const cookie = (await adminSessionCookie()).split("=")[1];
  const deps = { store: () => store, test: (s: typeof store, at: string, name?: string) => testDueKeys(s, at, name, good) };
  const request = (method: string, body?: unknown, host = hostOf(ADMIN_ORIGIN), origin = ADMIN_ORIGIN) =>
    new Request(`https://${host}/api/admin/v6/keys`, { method, headers: { host, origin, "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}) });
  await withAdminSessionKey(async () => {
    let opened = false;
    const blocked = { store: () => { opened = true; return store; } };
    assert.equal((await handleKeys(request("GET", undefined, hostOf(PUBLIC_SITE_ORIGIN)), cookie, blocked)).status, 404);
    assert.equal((await handleKeys(request("GET"), undefined, blocked)).status, 401);
    assert.equal((await handleKeys(request("POST", {}, undefined, "https://elsewhere.example"), cookie, blocked)).status, 403);
    assert.equal(opened, false);
    const saved = await handleKeys(request("POST", { name: "Example", value: SECRET, service: "signing" }), cookie, deps);
    assert.equal(saved.status, 200);
    assert.equal((await saved.text()).includes(SECRET), false);
    const listed = await handleKeys(request("GET"), cookie, deps);
    assert.match(listed.headers.get("cache-control")!, /no-store/);
    assert.equal((await listed.json()).rows[0].working, true);
    await keysRunnerPass(store);
    assert.ok((await store.list())[0].runnerReadAt);
    const deleted = await handleKeys(request("DELETE", { name: "Example" }), cookie, deps);
    assert.equal(deleted.status, 200);
    assert.equal(await store.read("Example"), undefined);
  });
});

test("known credentials cannot skip their provider check by choosing a different purpose", async t => {
  const { store } = await fixture(t);
  await withAdminSessionKey(async () => {
    const cookie = (await adminSessionCookie()).split("=")[1];
    for (const name of ["CONGRESS_API_KEY", "CONGRESS_API_KEY.website"]) {
      const response = await handleKeys(new Request(`${ADMIN_ORIGIN}/api/admin/v6/keys`, {
        method: "POST", headers: { host: hostOf(ADMIN_ORIGIN), origin: ADMIN_ORIGIN, "content-type": "application/json" },
        body: JSON.stringify({ name, value: SECRET, service: "signing" }),
      }), cookie, { store: () => store, test: (saved, at, key) => testDueKeys(saved, at, key, async service => {
        assert.equal(service, "congress"); return good();
      }) });
      assert.equal(response.status, 200);
    }
    assert.ok((await store.list()).every(row => row.service === "congress"));
  });
});

test("simultaneous runtime imports preserve both keys, and a later owner edit wins over a first import", async t => {
  const { store } = await fixture(t);
  await Promise.all([
    importExistingKeys({ WTP_ADMIN_SESSION_KEY: "runner-".repeat(8) }, store, AT, "runner"),
    importExistingKeys({ WTP_ADMIN_SESSION_KEY: "website-".repeat(8) }, store, AT, "website"),
  ]);
  assert.equal(await store.read("WTP_ADMIN_SESSION_KEY", false, AT, "runner"), "runner-".repeat(8));
  assert.equal(await store.read("WTP_ADMIN_SESSION_KEY", false, AT, "website"), "website-".repeat(8));
  await store.save("ANTHROPIC_API_KEY", SECRET, "signing", AT);
  await importExistingKeys({ ANTHROPIC_API_KEY: "old-website-setting" }, store, AT, "website");
  assert.equal(await store.read("ANTHROPIC_API_KEY", false, AT, "website"), SECRET);
});

test("the standing clock picks up saved keys on its next tick and tests again on the following day", async t => {
  const { store } = await fixture(t);
  let at = AT, checked = 0;
  const clock = new IndependentRuntimeLaneScheduler([savedKeysLane(async () => {
    await testDueKeys(store, at, undefined, async () => { checked++; return good(); });
    for (const key of await store.list()) await store.read(key.name, true, at);
  })]);
  clock.tick(Date.parse(at)); await clock.waitForIdle();
  await store.save("Clock check", SECRET, "signing", at);
  assert.equal(checked, 0);
  at = "2026-10-29T12:01:00.000Z";
  clock.tick(Date.parse(at)); await clock.waitForIdle();
  assert.equal(checked, 1);
  assert.equal((await store.list())[0].runnerReadAt, at);
  at = "2026-10-30T12:00:00.000Z";
  clock.tick(Date.parse(at)); await clock.waitForIdle();
  assert.equal(checked, 1);
  at = "2026-10-30T12:01:00.000Z";
  clock.tick(Date.parse(at)); await clock.waitForIdle();
  assert.equal(checked, 2);
});

test("runtime copy records only names, imports function-only signing settings, and preserves absence evidence", async t => {
  const { store } = await fixture(t), reports: import("../lib/control-plane/owner-surface.ts").OwnerDigestRecord[] = [];
  const env = { WTP_ADMIN_SECRET: SECRET, WTP_ADMIN_SESSION_KEY: "session-secret", WTP_STAGING_MANIFEST_COOKIE: "staging-cookie" };
  const event = (context: string) => ({ deploy: { context, publishedAt: AT } });
  const copy = () => importRuntimeKeys(env, "website", AT, store, async record => { reports.push(record); });
  const seed = async () => {};
  await initializer.deploySucceeded(event("deploy-preview"), copy, seed);
  assert.equal((await store.list()).length, 0, "preview deploys never copy their values into production");
  await initializer.deploySucceeded(event("production"), copy, seed);
  for (const name of Object.keys(env)) assert.equal((await store.list()).find(row => row.name === name)?.working, true);
  assert.ok(reports[0].lines[0].includes("WTP_ADMIN_SESSION_KEY"));
  assert.ok(reports[0].lines[1].includes("WTP_CONTROL_PLANE_DATABASE_URL_READONLY"));
  assert.equal(JSON.stringify(reports).includes(SECRET), false);
  await importRuntimeKeys(env, "website", AT, store, async record => { reports.push(record); });
  assert.equal(reports.length, 1, "an unchanged process inventory is recorded once");
});

test("the running runner imports its existing CLI login without asking for a token", async t => {
  const { store } = await fixture(t);
  const previous = globalThis.fetch;
  globalThis.fetch = (async (_url, init) => {
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer existing_cli_login");
    return Response.json({ login: "fixture-owner" });
  }) as typeof fetch;
  t.after(async () => { globalThis.fetch = previous; });
  await keysRunnerPass(store, AT, { env: { NODE_ENV: "test", WTP_RUNTIME_MODE: "production", GH_TOKEN: "" },
    github: () => "existing_cli_login", report: async record => { assert.equal(JSON.stringify(record).includes("existing_cli_login"), false); } });
  assert.equal(await store.read("GH_TOKEN"), "existing_cli_login");
  assert.equal((await store.list())[0].working, true);
  await keysRunnerPass(store, AT, { env: { NODE_ENV: "test", WTP_RUNTIME_MODE: "production" },
    github: () => { throw new Error("the saved login must be reused"); }, report: async () => {} });
});

test("the PRL archive key pair uses a bounded signed list and never records its secret", async t => {
  const { store } = await fixture(t), previous = globalThis.fetch;
  const oldEndpoint = process.env.PRL_ARCHIVE_S3_ENDPOINT, oldBucket = process.env.PRL_ARCHIVE_S3_BUCKET;
  process.env.PRL_ARCHIVE_S3_ENDPOINT = "https://archive.example.test"; process.env.PRL_ARCHIVE_S3_BUCKET = "source-bucket";
  t.after(async () => {
    globalThis.fetch = previous;
    if (oldEndpoint === undefined) delete process.env.PRL_ARCHIVE_S3_ENDPOINT; else process.env.PRL_ARCHIVE_S3_ENDPOINT = oldEndpoint;
    if (oldBucket === undefined) delete process.env.PRL_ARCHIVE_S3_BUCKET; else process.env.PRL_ARCHIVE_S3_BUCKET = oldBucket;
  });
  globalThis.fetch = (async (url, init) => {
    assert.equal(new URL(String(url)).searchParams.get("max-keys"), "1");
    assert.match(new Headers(init?.headers).get("authorization")!, /AWS4-HMAC-SHA256 Credential=fixture_id/);
    assert.equal(JSON.stringify(init?.headers).includes(SECRET), false);
    return new Response("<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>");
  }) as typeof fetch;
  await importExistingKeys({ PRL_ARCHIVE_S3_ACCESS_KEY_ID: "fixture_id", PRL_ARCHIVE_S3_SECRET_ACCESS_KEY: SECRET }, store, AT);
  assert.equal((await store.list()).filter(row => row.working).length, 2);
  assert.equal(JSON.stringify(await store.list()).includes(SECRET), false);
  globalThis.fetch = (async () => new Response(null, { status: 403 })) as typeof fetch;
  assert.equal((await testKey("prlarchive", SECRET, fetch, { archiveAccessId: "fixture_id", archiveSecret: SECRET })).working, false);
});

test("key checks use current provider routes, reporting scope and the dedicated map test origin", async t => {
  const { store } = await fixture(t);
  await store.save("WTP_MAPTILER_SMOKE_KEY", SECRET, "maptiler", AT);
  await testDueKeys(store, AT, undefined, async (service, value, _fetch, companion) => testKey(service, value,
    (async (_url, init) => {
      assert.equal(new Headers(init?.headers).get("origin"), "http://maptiler-smoke.localhost");
      return Response.json({ version: 8, layers: [{}] });
    }) as typeof fetch, companion));
  assert.equal((await store.list())[0].working, true);
  for (const [service, path, body] of [
    ["lda", "https://lda.gov/api/v1/filings/", { results: [{}] }],
    ["sam", "https://api.sam.gov/opportunities/v2/search", { totalRecords: 0, opportunitiesData: [] }],
    ["neon", "https://console.neon.tech/api/v2/users/me/organizations", { organizations: [] }],
  ] as const) {
    assert.equal((await testKey(service, SECRET, (async (url, init) => {
      assert.equal(String(url).split("?")[0], path);
      assert.equal(init?.redirect, "error");
      return Response.json(body);
    }) as typeof fetch)).working, true);
  }
  assert.equal((await testKey("neon", SECRET, (async url => {
    assert.equal(new URL(String(url)).searchParams.get("org_id"), "existing-billing-account");
    return Response.json({ projects: [] });
  }) as typeof fetch, { neonOrganization: "existing-billing-account" })).working, true);
});


test("the website copy imports its configured feedback and control-plane read handles and tests the connections", async t => {
  const { db, store } = await fixture(t);
  const { neonConfig } = await import("../lib/db/client.ts");
  const previous = neonConfig.fetchFunction, oldReport = process.env.WTP_VITAL_SIGNS_REPORT;
  process.env.WTP_VITAL_SIGNS_REPORT = "1";
  t.after(async () => { neonConfig.fetchFunction = previous;
    if (oldReport === undefined) delete process.env.WTP_VITAL_SIGNS_REPORT; else process.env.WTP_VITAL_SIGNS_REPORT = oldReport; });
  neonConfig.fetchFunction = async (_url: RequestInfo | URL, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body));
    const execute = async (statement: { query: string; params?: unknown[] }) => {
      const result = await db.query<Record<string, unknown>>(statement.query, statement.params);
      return { command: "SELECT", rowCount: result.rows.length, rowAsArray: true, fields: result.fields,
        rows: result.rows.map(row => result.fields.map(({ name }) => row[name] == null ? null : typeof row[name] === "boolean" ? row[name] ? "t" : "f" : typeof row[name] === "object" ? JSON.stringify(row[name]) : String(row[name]))) };
    };
    if (!request.queries) return Response.json(await execute(request));
    const results = []; for (const statement of request.queries) results.push(await execute(statement));
    return Response.json({ results });
  };
  const names = ["FEEDBACK_DATABASE_URL", "WTP_CONTROL_PLANE_DATABASE_URL_READONLY", "WTP_CONTROL_PLANE_POST_DEPLOY_DATABASE_URL", "WTP_STAGING_DATABASE_URL_READONLY"];
  await importExistingKeys(Object.fromEntries(names.map(name => [name, "postgresql://readonly:fixture@db.example.neon.tech/fixture"])), store, AT, "website");
  assert.deepEqual((await store.list()).map(row => row.name), [...names].sort());
  assert.ok((await store.list()).every(row => row.working));
});
