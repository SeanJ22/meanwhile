import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CivicReadCache, runtimeCivicReadCache } from "../lib/db/civic-read-cache.ts";
import { civicReadCopyStore, saveCivicReadCopy, startCivicReadCacheHost } from "../lib/db/civic-read-cache-host.ts";

function cache(root: string) {
  return new CivicReadCache({ read: key => readFile(join(root, key + ".json"), "utf8"),
    write: (key, saved) => saveCivicReadCopy(root, key, saved) });
}

async function scratch(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await mkdtemp(join(tmpdir(), "civic-read-cache-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("fresh processes transfer only changed rows and never serve a deleted pointer", async t => {
  const root = await scratch(t);
  const rows = new Map(["az", "nh"].map(key => [key, { key, etag: "1", text: key.repeat(500_000) }]));
  const reads: string[][] = [];
  const input = {
    namespace: "promotion", keys: ["az", "nh"],
    versions: async (keys: readonly string[]) => keys.flatMap(key => rows.has(key) ? [{ key, etag: rows.get(key)!.etag }] : []),
    values: async (keys: readonly string[]) => { reads.push([...keys]); return keys.map(key => ({ ...rows.get(key)! })); },
    keyOf: (row: { key: string; etag: string; text: string }) => row.key,
  };
  const first = await cache(root).rows(input);
  reads.length = 0;
  assert.deepEqual(await cache(root).rows(input), first);
  assert.deepEqual(reads, [], "a new process transfers no unchanged payloads");
  rows.set("az", { key: "az", etag: "2", text: "new verified facts" });
  const changed = await cache(root).rows(input);
  assert.deepEqual(reads, [["az"]]);
  assert.equal(changed.find(row => row.key === "az")?.text, "new verified facts");
  assert.equal(changed.find(row => row.key === "nh")?.text, first[1]!.text);
  rows.delete("az");
  assert.deepEqual((await cache(root).rows(input)).map(row => row.key), ["nh"]);
});

test("an UPDATE during a whole read cannot cache old bytes under the new etag", async t => {
  const root = await scratch(t);
  let version = "1";
  let calls = 0;
  const input = { namespace: "candidate", keys: ["held"],
    versions: async () => [{ key: "held", etag: version }],
    values: async () => { calls++; const text = version; version = "2"; return [{ id: "held", text }]; },
    keyOf: (row: { id: string; text: string }) => row.id,
  };
  assert.equal((await cache(root).rows(input))[0]!.text, "1");
  assert.equal((await cache(root).rows(input))[0]!.text, "2");
  assert.equal(calls, 2);
  await cache(root).rows(input);
  assert.equal(calls, 2);
});

test("confirmations stay current without transferring an unchanged promotion payload", async t => {
  const root = await scratch(t);
  let latestConfirmation = "first check";
  let calls = 0;
  const input = { namespace: "promotion", keys: ["scope"],
    versions: async () => [{ key: "scope", etag: "unchanged", latestConfirmation }],
    values: async () => { calls++; return [{ key: "scope", payload: ["held facts"], latestConfirmation }]; },
    keyOf: (row: { key: string; payload: string[]; latestConfirmation: string }) => row.key,
    freshen: (row: { key: string; payload: string[]; latestConfirmation: string }, version: { latestConfirmation: string }) => ({ ...row, latestConfirmation: version.latestConfirmation }),
  };
  await cache(root).rows(input);
  latestConfirmation = "new source check";
  const current = await cache(root).rows(input);
  assert.equal(current[0]!.latestConfirmation, latestConfirmation);
  assert.equal(calls, 1);
  await assert.rejects(() => cache(root).rows({ ...input,
    versions: async (): Promise<readonly { key: string; etag: string; latestConfirmation: string }[]> => { throw new Error("database unavailable"); },
  }), /database unavailable/, "a failed version read never serves an unconfirmed copy");
});

test("corrupt or unwritable disposable copies fall back to the actual database read", async t => {
  const root = await scratch(t);
  let calls = 0;
  const input = { namespace: "part", keys: ["hash"],
    versions: async () => [{ key: "hash", etag: "hash" }],
    values: async () => { calls++; return [{ hash: "hash", payload: { verified: true } }]; },
    keyOf: (row: { hash: string; payload: { verified: boolean } }) => row.hash,
  };
  await cache(root).rows(input);
  const [file] = await readdir(root);
  await writeFile(join(root, file!), "truncated json");
  assert.deepEqual(await cache(root).rows(input), [{ hash: "hash", payload: { verified: true } }]);
  assert.equal(calls, 2);
  const blocked = join(root, "file-cannot-be-directory");
  await writeFile(blocked, "held file");
  assert.deepEqual(await cache(blocked).rows(input), [{ hash: "hash", payload: { verified: true } }]);
});

test("the runner's one copy host serves every child, and a child that inherits it starts no other", async t => {
  const saved = { ...process.env };
  const cwd = process.cwd();
  const root = await scratch(t);
  t.after(() => {
    process.chdir(cwd);
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  });
  process.chdir(root);
  process.env.DATABASE_URL = "postgresql://local:local@ep-cache-host.invalid/neondb";
  delete process.env.WTP_CIVIC_READ_CACHE_URL;
  delete process.env.WTP_CIVIC_READ_CACHE_TOKEN;
  const runner = await startCivicReadCacheHost();
  const url = process.env.WTP_CIVIC_READ_CACHE_URL;
  assert.match(url ?? "", /^http:\/\/127\.0\.0\.1:\d+$/);
  const child = await startCivicReadCacheHost();
  await child.close();
  assert.equal(process.env.WTP_CIVIC_READ_CACHE_URL, url, "a process that inherited the host keeps it, and its close leaves it");
  const input = { namespace: "payload-part", keys: ["part-a"], versions: async (keys: readonly string[]) => keys.map(key => ({ key, etag: key })),
    values: async (keys: readonly string[]) => keys.map(hash => ({ hash, payload: "held" })), keyOf: (row: { hash: string }) => row.hash };
  await runtimeCivicReadCache()!.rows(input);
  let read = false;
  assert.deepEqual(await runtimeCivicReadCache()!.rows({ ...input, values: async () => { read = true; return []; } }), [{ hash: "part-a", payload: "held" }]);
  assert.equal(read, false, "a second process reads the part from the runner's copy");
  await runner.close();
  assert.equal(process.env.WTP_CIVIC_READ_CACHE_URL, undefined);
});

async function diskBytes(root: string): Promise<number> {
  let total = 0;
  for (const file of await readdir(root, { withFileTypes: true })) {
    const path = join(root, file.name);
    total += file.isDirectory() ? await diskBytes(path) : (await stat(path)).size;
  }
  return total;
}

test("startup evicts oldest copies across database namespaces and removes abandoned writes", async t => {
  const root = await scratch(t);
  for (const [namespace, at] of [["retired-db", 1], ["current-db", 2]] as const) {
    await mkdir(join(root, namespace));
    const path = join(root, namespace, "held.json");
    await writeFile(path, "12345678");
    await utimes(path, at, at);
  }
  await writeFile(join(root, "abandoned.tmp"), "abandoned".repeat(50));
  const store = civicReadCopyStore(root, 12);
  await store.ready;
  await assert.rejects(readFile(join(root, "retired-db", "held.json")), { code: "ENOENT" });
  assert.equal(await readFile(join(root, "current-db", "held.json"), "utf8"), "12345678");
  assert.equal(await diskBytes(root), 8);
});

test("concurrent streamed writes stay under the hard limit including temporary files for 24 controlled hours", async t => {
  const root = await scratch(t);
  const store = civicReadCopyStore(root, 32, 24);
  await store.ready;
  const body = async function* () {
    for (let chunk = 0; chunk < 3; chunk++) {
      assert.ok(await diskBytes(root) <= 32, "temporary writes count against the same disk limit");
      yield Buffer.from("12345678");
    }
  };
  for (let hour = 0; hour < 24; hour++) {
    await Promise.all(Array.from({ length: 4 }, (_, worker) => store.write(`hour-${hour}-worker-${worker}`, body())));
    assert.ok(await diskBytes(root) <= 32);
    assert.equal((await readdir(root)).some(file => file.endsWith(".tmp")), false);
  }
  await assert.rejects(store.write("too-big", "x".repeat(25)), /TOO_LARGE/);
  const broken = async function* () { yield Buffer.from("1234"); throw new Error("sender disconnected"); };
  await assert.rejects(store.write("disconnected", broken()), /sender disconnected/);
  assert.equal((await readdir(root)).some(file => file.endsWith(".tmp")), false);
  await store.write("recovered", "12345678");
  assert.ok(await diskBytes(root) <= 32);
});
