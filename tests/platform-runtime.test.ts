import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { cycleVault } from "../lib/control-plane/scheduler/vault.ts";
import { readPlatformDirectory } from "../lib/control-plane/discovery/platform-directory.ts";

test("directory metadata avoids repeated downloads and a failed refresh retains its original source timestamp", async () => {
  const root = await mkdtemp(join(tmpdir(), "mp01-directory-")), repos = createMemoryRepositories(), vault = cycleVault(root);
  let now = "2026-10-20T00:00:00.000Z", requests = 0, fail = false;
  const runtime = { now: () => now, spaceOut: async () => {}, budget: { spent: () => false }, vault: vault.put,
    open: async () => { requests++; return { status: fail ? 503 : 200, body: "client\nexample\n", contentType: "text/csv", bytes: 15, location: null, transportError: null }; } };
  const input = { name: "Platform clients", url: "https://example.gov/clients.csv", repos, vault, runtime,
    validate: (text: string) => { assert.match(text, /^client\n/); } };
  try {
    const first = await readPlatformDirectory(input);
    assert.ok(first);
    assert.deepEqual(await readPlatformDirectory(input), first);
    assert.equal(requests, 1);
    now = "2026-10-21T00:00:00.000Z"; fail = true;
    assert.deepEqual(await readPlatformDirectory(input), first, "a retrieval failure cannot replace the working directory or freshen its evidence");
    assert.equal(requests, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});
