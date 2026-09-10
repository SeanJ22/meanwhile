/**
 * Owner-invoked PRL acquisition and canonical promotion.
 *
 * The national archive is PRL's own attributed measurement source. This
 * command writes no tracked snapshot and triggers no software release; every
 * attempt and decision is persisted through the civic-data candidate plane.
 *
 * @freshness-reads-here — retrieval time is captured after the official
 * archive body is decoded and normalized; failure time is attempt evidence.
 */
import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";

import { failedAcquisitionCandidate } from "../lib/civic-data/candidate-builders.ts";
import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { prlCandidate, PRL_CONTRACT } from "../lib/sources/prl/data-plane.ts";
import { normalizeProfiles, sourceBioguides } from "../lib/sources/prl/index.ts";
import {
  PRL_RHETORIC_ATTRIBUTION,
  type PrlSnapshot,
} from "../lib/sources/prl/types.ts";

const SOURCE_URL =
  "https://americaspoliticalpulse.com/data/elite/profiles-all-national.zip";
const UA = "we-the-people civic app (contact: seanj22@gmail.com)";

if (!process.argv.slice(2).includes("--promote")) {
  throw new Error(
    "PRL acquisition is promotion-only. Invoke pnpm prl:fetch; tracked snapshot writes are retired.",
  );
}
prepareProductionCivicDataWrite();

/** The archive holds one local-file member; reject every other container. */
function firstZipEntry(buf: Buffer): { name: string; data: Buffer } {
  if (buf.length < 30 || buf.readUInt32LE(0) !== 0x04034b50) {
    throw new Error("PRL response is not a ZIP archive");
  }
  const method = buf.readUInt16LE(8);
  const compressedSize = buf.readUInt32LE(18);
  const nameLength = buf.readUInt16LE(26);
  const extraLength = buf.readUInt16LE(28);
  const start = 30 + nameLength + extraLength;
  // Some publishers stream the member and put its size only in the trailing
  // descriptor. zlib stops at the end of the deflate stream, so retaining the
  // old whole-remainder handling is safe for that known one-member shape.
  const end = compressedSize > 0 ? start + compressedSize : buf.length;
  if (end > buf.length) throw new Error("PRL ZIP member is truncated");
  const name = buf.subarray(30, 30 + nameLength).toString("utf8");
  if (!/\.csv$/i.test(name) || name.includes("..") || /^[\\/]/.test(name)) {
    throw new Error(`PRL ZIP contains an unexpected member ${JSON.stringify(name)}`);
  }
  const body = buf.subarray(start, end);
  if (method === 0) return { name, data: body };
  if (method !== 8) throw new Error(`PRL ZIP uses unsupported method ${method}`);
  return { name, data: Buffer.from(inflateRawSync(body)) };
}

let candidateSubmitted = false;

async function main(): Promise<void> {
  console.log(`fetching ${SOURCE_URL}`);
  const response = await fetch(SOURCE_URL, {
    headers: { "user-agent": UA, accept: "application/zip" },
    redirect: "follow",
  });
  if (!response.ok) {
    throw new Error(`PRL answered HTTP ${response.status} ${response.statusText}`);
  }
  const zip = Buffer.from(await response.arrayBuffer());
  const digest = createHash("sha256").update(zip).digest("hex");
  const entry = firstZipEntry(zip);
  const csv = entry.data.toString("utf8");

  // The source file is the denominator. No tracked roster is an intermediary
  // authority or filter on which attributed profiles may enter the candidate.
  const result = normalizeProfiles(csv, sourceBioguides(csv));
  const c = result.counts;
  const retrievedAt = new Date().toISOString();
  const snapshot: PrlSnapshot = {
    formatVersion: 1,
    fetchedAt: retrievedAt,
    sourceFile: `${entry.name} (sha256 ${digest})`,
    sourceUrl: SOURCE_URL,
    rowsInFile: c.rowsInFile,
    rowsWithStatements: c.rowsWithStatements,
    profiles: result.profiles.sort((left, right) => left.bioguideId.localeCompare(right.bioguideId)),
    rosterMisses: result.rosterMisses,
    attribution: PRL_RHETORIC_ATTRIBUTION,
  };

  console.log(
    `PRL: ${zip.length} archive bytes; ${c.rowsInFile} rows; ` +
    `${c.rowsWithStatements} positive-statement rows; ${c.matched} attributed profiles`,
  );

  const candidate = prlCandidate({
    snapshot,
    rawZip: zip,
    finalUrl: response.url || SOURCE_URL,
    retrievedAt,
  });
  candidateSubmitted = true;
  const outcome = await processRegisteredManualCandidate(
    new PostgresRoutineDataStore(),
    PRL_CONTRACT.id,
    candidate,
    retrievedAt,
  );
  if (!outcome.promoted) {
    throw new Error(`PRL promotion refused: ${outcome.candidate.failureCode}`);
  }
  console.log(
    `promoted ${outcome.promoted.versionId}; exact changes and attribution are in the canonical outcome receipt; no tracked runtime artifact was written`,
  );
}

try {
  await main();
} catch (error) {
  if (!candidateSubmitted) {
    const attemptedAt = new Date().toISOString();
    const failed = failedAcquisitionCandidate({
      sourceId: PRL_CONTRACT.sourceId,
      recordClass: PRL_CONTRACT.recordClass,
      scope: PRL_CONTRACT.scope,
      requestedUrl: SOURCE_URL,
      attemptedAt,
      failureDetail: error instanceof Error ? error.message : String(error),
      parserVersion: PRL_CONTRACT.parserVersion,
    });
    await processRegisteredManualCandidate(
      new PostgresRoutineDataStore(),
      PRL_CONTRACT.id,
      failed,
      attemptedAt,
    );
  }
  throw error;
}
