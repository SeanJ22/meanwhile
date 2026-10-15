import { OWNER_SURFACE_FORMAT_VERSION, type OwnerDigestRecord } from "../control-plane/owner-surface.ts";
import type { AppendOnlyRepository } from "../control-plane/repository/types.ts";
import type { BoundedChildResult } from "./bounded-child-pass.ts";

/** The runner converts held versions that embed source pages once; this record is what keeps it from running again. */
export const CAPTURE_CONVERSION_LOG_KEY = "capture-conversion";
const RECORD_ID = "capture-conversion:v1";
const LINE = "CAPTURE_CONVERTED ";

export const captureConversionLine = (row: { readonly scope: string; readonly from: string; readonly to: string | null; readonly refusal?: string }) =>
  `${LINE}${JSON.stringify(row)}`;

export async function captureConversionRecorded(digests: AppendOnlyRepository<OwnerDigestRecord>): Promise<boolean> {
  return (await digests.read(CAPTURE_CONVERSION_LOG_KEY)).some(row => row.digestId === RECORD_ID);
}

/** A finished child's record, refusals included; null when it did not finish, so the next pass runs it again. */
export function captureConversionRecord(run: BoundedChildResult, at: string, testedSha: string | null): OwnerDigestRecord | null {
  if (run.status !== 0) return null;
  const lines = run.stdout.split("\n").filter(line => line.startsWith(LINE)).map(line => line.slice(LINE.length));
  const refused = lines.filter(line => !(JSON.parse(line) as { to: string | null }).to).length;
  return { formatVersion: OWNER_SURFACE_FORMAT_VERSION, digestId: RECORD_ID, writtenAt: at, lines, cycleOk: refused === 0, testedSha,
    headline: `Capture conversion: ${lines.length - refused} held versions now hold vault references; ${refused} refused and republish on their next read.` };
}
