import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CivicReadCache } from "../lib/db/civic-read-cache.ts";

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
  const first = await new CivicReadCache(root).rows(input);
  reads.length = 0;
  assert.deepEqual(await new CivicReadCache(root).rows(input), first);
  assert.deepEqual(reads, [], "a new process transfers no unchanged payloads");
  rows.set("az", { key: "az", etag: "2", text: "new verified facts" });
  const changed = await new CivicReadCache(root).rows(input);
  assert.deepEqual(reads, [["az"]]);
  assert.equal(changed.find(row => row.key === "az")?.text, "new verified facts");
  assert.equal(changed.find(row => row.key === "nh")?.text, first[1]!.text);
  rows.delete("az");
  assert.deepEqual((await new CivicReadCache(root).rows(input)).map(row => row.key), ["nh"]);
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
  assert.equal((await new CivicReadCache(root).rows(input))[0]!.text, "1");
  assert.equal((await new CivicReadCache(root).rows(input))[0]!.text, "2");
  assert.equal(calls, 2);
  await new CivicReadCache(root).rows(input);
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
  await new CivicReadCache(root).rows(input);
  latestConfirmation = "new source check";
  const current = await new CivicReadCache(root).rows(input);
  assert.equal(current[0]!.latestConfirmation, latestConfirmation);
  assert.equal(calls, 1);
  await assert.rejects(() => new CivicReadCache(root).rows({ ...input,
    versions: async () => { throw new Error("database unavailable"); },
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
  await new CivicReadCache(root).rows(input);
  const [file] = await readdir(root);
  await writeFile(join(root, file!), "truncated json");
  assert.deepEqual(await new CivicReadCache(root).rows(input), [{ hash: "hash", payload: { verified: true } }]);
  assert.equal(calls, 2);
  const blocked = join(root, "file-cannot-be-directory");
  await writeFile(blocked, "held file");
  assert.deepEqual(await new CivicReadCache(blocked).rows(input), [{ hash: "hash", payload: { verified: true } }]);
});
