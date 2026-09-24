/**
 * Capture the Reader proof's meeting pin: ONE version per meeting partition
 * for one full reproof run (see lib/meetings/proof-pin.ts).
 *
 *   node --import tsx scripts/reader-proof-meeting-pin.mts <pin-path>
 *
 * `scripts/reader-last-mile-full-reproof.sh` runs this once, after the build and
 * before prepare, then exports READER_PROOF_MEETING_PIN=<pin-path>. Every later
 * stage, and the proof server, then reads that one version of every partition.
 * The capture is itself the strict Reader proof read. The phase authority is
 * admitted with its connection and head binding, the projection is read with
 * the cache bypassed, and `requireReaderProofMeetingsProjection` must pass.
 * So a partition that is unreadable or fails its proof cannot be pinned.
 *
 * It refuses to overwrite an existing pin. A resumed run reuses the pin it
 * started with, and a fresh run deletes the previous one first.
 * @freshness-reads-here `capturedAt` is the instant this process observed the
 * pointers. It is diagnostic provenance for the pin, never a source-data date.
 */
import { existsSync, writeFileSync } from "node:fs";

import { readMeetingsProjection, requireReaderProofMeetingsProjection } from "../lib/meetings/snapshot.ts";
import { READER_PROOF_MEETING_PIN_ENV, readerProofMeetingPinFromReadback } from "../lib/meetings/proof-pin.ts";
import { loadReaderProofMeetingsExpectedAuthority } from "./lib/reader-proof-runtime.ts";

const out = process.argv[2]?.trim();
if (!out) throw new Error("usage: reader-proof-meeting-pin.mts <pin-path>");
if (process.env[READER_PROOF_MEETING_PIN_ENV]?.trim()) {
  throw new Error(`${READER_PROOF_MEETING_PIN_ENV} is set; the pin must be captured from an unpinned read.`);
}
if (existsSync(out)) throw new Error(`${out} already exists; one reproof run has exactly one meeting pin.`);

const authority = loadReaderProofMeetingsExpectedAuthority();
const result = await readMeetingsProjection({ bypassCache: true });
requireReaderProofMeetingsProjection(result, authority);
if (result.kind !== "PROMOTED") throw new Error("Unreachable meeting pin capture state.");
const pin = readerProofMeetingPinFromReadback(result.partitions, new Date().toISOString());
writeFileSync(out, `${JSON.stringify(pin, null, 2)}\n`, { flag: "wx" });
const promoted = pin.partitions.filter(({ kind }) => kind === "PROMOTED").length;
console.log(`meeting pin ${pin.partitionsSha256.slice(0, 12)}: ${promoted} promoted + ${pin.partitions.length - promoted} not-recorded partitions captured at ${pin.capturedAt} -> ${out}`);
