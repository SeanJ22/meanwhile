import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zip } from "../scripts/xlsx.mjs";
import { openZipFile, readZipEntries } from "../lib/sources/archive.ts";
const make = (name = "records.csv", body = "id,name\n1,Person\n"): Buffer => zip([{ name, data: Buffer.from(body) }], "2026-10-01");
const central = (bytes: Buffer) => bytes.readUInt32LE(bytes.length - 6);
async function fromFile<T>(bytes: Buffer, read: (path: string) => Promise<T>) {
  const root = await mkdtemp(join(tmpdir(), "meanwhile-zip-test-"));
  try { const path = join(root, "source.zip"); await writeFile(path, bytes); return await read(path); }
  finally { await rm(root, { recursive: true, force: true }); }
}
test("bounded memory and file readers decode the same complete archive", async () => {
  const bytes = make(); assert.equal(readZipEntries(bytes)[0].data.toString(), "id,name\n1,Person\n");
  await fromFile(bytes, async path => {
    const [entry] = await openZipFile(path), chunks: Uint8Array[] = [];
    for await (const chunk of entry.stream()) chunks.push(chunk);
    assert.equal(Buffer.concat(chunks).toString(), "id,name\n1,Person\n");
  });
});
test("truncated, unsafe, duplicate and locally inconsistent archives are refused", () => {
  assert.throws(() => readZipEntries(make().subarray(0, -1)), /ZIP_INVALID/);
  assert.throws(() => readZipEntries(make("../records.csv")), /unsafe/);
  const duplicate = zip([{ name: "x", data: Buffer.from("one") }, { name: "x", data: Buffer.from("two") }], "2026-10-01");
  assert.throws(() => readZipEntries(duplicate), /duplicate/);
  const wrongLocalSize = make(); wrongLocalSize.writeUInt32LE(1, 22);
  assert.throws(() => readZipEntries(wrongLocalSize), /local size/);
  const wrongLocalName = make(); wrongLocalName[30] = 88;
  assert.throws(() => readZipEntries(wrongLocalName), /local identity/);
});
test("expanded bounds are checked before inflate and a lying CRC fails the entire stream", async () => {
  const bytes = make("large", "x".repeat(100_000));
  assert.throws(() => readZipEntries(bytes, { maxMemberBytes: 100 }), /resource bound/);
  const corrupted = make(); corrupted.writeUInt32LE(1, 14); corrupted.writeUInt32LE(1, central(corrupted) + 16);
  assert.throws(() => readZipEntries(corrupted), /CRC/);
  await fromFile(corrupted, async path => {
    const [entry] = await openZipFile(path);
    await assert.rejects(async () => { for await (const chunk of entry.stream()) void chunk; }, /CRC/);
  });
});
test("ZIP64 release directories reconcile their exact size and count", async () => {
  const original = make(), end = original.length - 22, zip64 = Buffer.alloc(56), locator = Buffer.alloc(20), eocd = Buffer.from(original.subarray(end));
  zip64.writeUInt32LE(0x06064b50); zip64.writeBigUInt64LE(BigInt(44), 4); zip64.writeUInt16LE(45, 12); zip64.writeUInt16LE(45, 14);
  zip64.writeBigUInt64LE(BigInt(1), 24); zip64.writeBigUInt64LE(BigInt(1), 32);
  zip64.writeBigUInt64LE(BigInt(original.readUInt32LE(end + 12)), 40); zip64.writeBigUInt64LE(BigInt(central(original)), 48);
  locator.writeUInt32LE(0x07064b50); locator.writeBigUInt64LE(BigInt(end), 8); locator.writeUInt32LE(1, 16);
  eocd.writeUInt16LE(0xffff, 8); eocd.writeUInt16LE(0xffff, 10); eocd.writeUInt32LE(0xffffffff, 12); eocd.writeUInt32LE(0xffffffff, 16);
  const bytes = Buffer.concat([original.subarray(0, end), zip64, locator, eocd]);
  assert.equal(readZipEntries(bytes)[0].name, "records.csv");
  await fromFile(bytes, async path => { assert.equal((await openZipFile(path)).length, 1); });
});
