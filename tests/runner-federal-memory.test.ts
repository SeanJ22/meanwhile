import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { holdRawCaptureFile, readRawCaptureText, restoreRawCaptureFile } from "../lib/civic-data/raw-capture-vault.ts";
import { acquireCongressSourceFile } from "../lib/officials/congress-source-file.ts";
import { readCongressStateSource } from "../lib/officials/congress-source-records.ts";

const person = (id: string, state: string, extra = "") => ({ id: { bioguide: id }, name: { first: "Person", last: id },
  terms: [{ type: "rep", state, district: 1, start: "2025-01-03", end: "2027-01-03" }], extra });

test("national Congress sources retain only state people and their joined optional records", async () => {
  const root = await mkdtemp(join(tmpdir(), "rh01-congress-state-"));
  try {
    const core = join(root, "core.yaml"), file = await open(core, "w");
    try {
      await file.write(stringify([person("A000001", "AZ")]));
      for (let n = 0; n < 1000; n++) await file.write(stringify([person(`B${String(n).padStart(6, "0")}`, "WA", "x".repeat(4096))]));
    } finally { await file.close(); }
    const args = { state: "AZ", asOf: "2026-10-01", memberIds: new Set(["A000001"]), committeeIds: new Set(["HSAA01"]) };
    const read = await readCongressStateSource({ ...args, name: "legislators-current", path: core });
    assert.equal(read.complete, true);
    assert.deepEqual((read.value as { id: { bioguide: string } }[]).map(row => row.id.bioguide), ["A000001"]);
    const members = join(root, "members.yaml");
    await writeFile(members, stringify({ HSAA01: [{ bioguide: "A000001", name: "Own" }, { bioguide: "B000000", name: "Other" }], SSBB: [{ bioguide: "B000000" }] }));
    assert.deepEqual((await readCongressStateSource({ ...args, name: "committee-membership-current", path: members })).value,
      { HSAA01: [{ bioguide: "A000001", name: "Own" }] });
    const committees = join(root, "committees.yaml");
    await writeFile(committees, stringify([{ thomas_id: "HSAA", name: "Own", subcommittees: [{ thomas_id: "01", name: "Own sub" }, { thomas_id: "02", name: "Other sub" }] }, { thomas_id: "SSBB", name: "Other" }]));
    assert.deepEqual((await readCongressStateSource({ ...args, name: "committees-current", path: committees })).value,
      [{ thomas_id: "HSAA", name: "Own", subcommittees: [{ thomas_id: "01", name: "Own sub" }] }]);
    const other = await readCongressStateSource({ ...args, state: "GU", name: "legislators-current", path: core });
    assert.equal(other.complete, true); assert.deepEqual(other.value, [], "scanning a complete source can establish an empty jurisdiction");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("full source evidence is stored and restored in bounded immutable chunks", async () => {
  const root = await mkdtemp(join(tmpdir(), "rh01-raw-chunks-"));
  try {
    const path = join(root, "source.txt"), restored = join(root, "restored.txt"), body = "a".repeat(2 * 1024 * 1024 + 123);
    await writeFile(path, body);
    const vault = new MemoryEvidenceStore(), raw = await holdRawCaptureFile(vault, "congress-directory-project", path, "text/plain");
    assert.equal(raw.chunked, true); assert.equal(raw.byteLength, body.length);
    assert.equal(raw.rawHash, createHash("sha256").update(body).digest("hex"));
    const manifest = await vault.get(raw.vaultKey); assert.ok(manifest);
    const chunks = JSON.parse(new TextDecoder().decode(manifest.bytes)).chunks as { vaultKey: string; byteLength: number }[];
    assert.equal(chunks.length, 3); assert.ok(chunks.every(row => row.byteLength <= 1024 * 1024));
    await restoreRawCaptureFile(vault, raw, restored);
    assert.equal(await readFile(restored, "utf8"), body);
    assert.equal(await readRawCaptureText(vault, raw), body);
    const corrupt = { put: vault.put.bind(vault), head: vault.head.bind(vault), list: vault.list.bind(vault),
      get: async (key: string) => key === chunks[0].vaultKey ? null : vault.get(key) };
    await assert.rejects(restoreRawCaptureFile(corrupt, raw, restored), /RAW_CAPTURE_MISSING_OR_CORRUPT/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("state Congress jobs reuse one commit-pinned source capture without renewing its read date", async () => {
  const vault = new MemoryEvidenceStore(), { locks } = createMemoryRepositories();
  const url = `https://raw.githubusercontent.com/unitedstates/congress-legislators/${"a".repeat(40)}/legislators-current.yaml`;
  const body = stringify([person("A000001", "AZ")]); let downloads = 0;
  const fetchImpl = (async () => { downloads++; return new Response(body); }) as typeof fetch;
  const first = await acquireCongressSourceFile({ url, vault, locks, fetchImpl, signal: AbortSignal.timeout(5000) });
  try {
    const second = await acquireCongressSourceFile({ url, vault, locks, fetchImpl, signal: AbortSignal.timeout(5000) });
    try {
      assert.equal(downloads, 1); assert.equal(second.retrievedAt, first.retrievedAt);
      assert.equal(second.raw.rawHash, first.raw.rawHash); assert.equal(await readFile(second.path, "utf8"), body);
    } finally { await second.dispose(); }
  } finally { await first.dispose(); }
});
