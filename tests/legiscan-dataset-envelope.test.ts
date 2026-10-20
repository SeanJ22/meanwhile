import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { decodeLegiscanDatasetEnvelope } from "../lib/sources/legiscan/dataset-envelope.ts";
import { parseLegiscanDatasetList } from "../lib/sources/legiscan/dataset.ts";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/legiscan/${name}`, import.meta.url), "utf8");
const metadata = JSON.parse(fixture("tx-dataset-metadata.json"));
const session = parseLegiscanDatasetList(fixture("tx-dataset-list.json"), "TX").find(row => row.sessionId === metadata.session_id)!;
async function decode(body: string): Promise<Buffer> {
  const directory = await mkdtemp(join(tmpdir(), "vt01-legiscan-envelope-"));
  try {
    const path = join(directory, "response.json"), archivePath = join(directory, "session.zip");
    await writeFile(path, body);
    await decodeLegiscanDatasetEnvelope({ path, archivePath, session, signal: AbortSignal.timeout(10_000) });
    return await readFile(archivePath);
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test("LegiScan envelope decoder handles split JSON tokens and escaped base64 across file chunks", async () => {
  const bytes = Buffer.alloc(150_001, 255);
  const encoded = bytes.toString("base64").replace(/\//g, (_slash, offset: number) => offset % 7 ? "\\/" : "\\u002f");
  const header = JSON.stringify({ status: "OK", padding: "x".repeat(65_515), dataset: { ...metadata, zip: "BASE64" } });
  assert.deepEqual(await decode(header.replace('"BASE64"', `"${encoded}"`)), bytes);
});

test("LegiScan envelope metadata must identify the requested state and exact session release", async () => {
  const variants = [
    { session_id: session.sessionId + 1 }, { state_id: session.stateId + 1 },
    { dataset_hash: "0".repeat(32) }, { dataset_date: "2000-01-01" }, { mime_type: "text/plain" },
  ];
  for (const mismatch of variants) await assert.rejects(decode(JSON.stringify({ status: "OK", dataset: {
    ...metadata, ...mismatch, zip: Buffer.from("test archive").toString("base64"),
  } })), /LEGISCAN_DATASET_RESPONSE_IDENTITY_INVALID/);
});

test("LegiScan envelope rejects noncanonical base64 and malformed or duplicated JSON fields", async () => {
  for (const encoded of ["AB==", "AA=A", "A===", "AA$=", ""]) {
    await assert.rejects(decode(JSON.stringify({ status: "OK", dataset: { ...metadata, zip: encoded } })), /LEGISCAN_DATASET_BASE64_INVALID/);
  }
  const valid = JSON.stringify({ status: "OK", dataset: { ...metadata, zip: "YWJj" } });
  await assert.rejects(decode(`${valid}garbage`), /LEGISCAN_DATASET_RESPONSE_IDENTITY_INVALID/);
  await assert.rejects(decode(valid.slice(0, -1)), /LEGISCAN_DATASET_RESPONSE_IDENTITY_INVALID/);
  await assert.rejects(decode(valid.replace('"zip":"YWJj"', '"zip":"YWJj","zip":"YWJj"')), /LEGISCAN_DATASET_RESPONSE_IDENTITY_INVALID/);
});

test("LegiScan envelope refuses a repository output path before creating a file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "vt01-legiscan-confined-"));
  const archivePath = resolve(".scratch", `vt01-envelope-refused-${process.pid}.zip`);
  try {
    const path = join(directory, "response.json");
    await writeFile(path, JSON.stringify({ status: "OK", dataset: { ...metadata, zip: "YWJj" } }));
    await assert.rejects(decodeLegiscanDatasetEnvelope({ path, archivePath, session, signal: AbortSignal.timeout(10_000) }),
      /filesystem destination must stay (?:inside the operating system temporary directory|outside the repository)/);
    await assert.rejects(access(archivePath), { code: "ENOENT" });
  } finally { await rm(directory, { recursive: true, force: true }); await rm(archivePath, { force: true }); }
});
