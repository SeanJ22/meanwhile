import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parsePluralBulkSessionFile, type PluralBulkParseOptions } from "../../lib/sources/plural/vote-bulk.ts";
import type { PluralBillEvidence } from "../../lib/sources/plural/votes.ts";
import { parseLegiscanDatasetFile } from "../../lib/sources/legiscan/dataset.ts";

/** Retained byte fixtures stage in an isolated temporary directory. Runtime
 * acquisition passes its already-streamed source files to the parsers directly. */
export async function parsePluralBulkSession(state: string, session: string, bytes: Uint8Array,
  evidence: PluralBillEvidence, options: PluralBulkParseOptions = {}) {
  const directory = await mkdtemp(join(tmpdir(), "meanwhile-openstates-fixture-"));
  try {
    const path = join(directory, "session.zip");
    await writeFile(path, bytes);
    return await parsePluralBulkSessionFile(state, session, path, evidence, options);
  } finally { await rm(directory, { recursive: true, force: true }); }
}

export async function parseLegiscanDataset(input: Omit<Parameters<typeof parseLegiscanDatasetFile>[0], "path"> & { bytes: Uint8Array }) {
  const directory = await mkdtemp(join(tmpdir(), "meanwhile-legiscan-fixture-"));
  try {
    const path = join(directory, "session.zip");
    await writeFile(path, input.bytes);
    return await parseLegiscanDatasetFile({ ...input, path });
  } finally { await rm(directory, { recursive: true, force: true }); }
}
