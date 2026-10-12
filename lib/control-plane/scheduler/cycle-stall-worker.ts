/** The stall diagnostic's worker thread. Writes with fs directly (the main thread may be blocked); its timer stays referenced to keep this thread alive. */
import { mkdirSync, writeFileSync, writeSync } from "node:fs";
import { dirname } from "node:path";
import { workerData } from "node:worker_threads";

import {
  RECORD_CLAIM,
  claimRecord,
  lastMainThreadPing,
  readPendingSnapshot,
  settleRecordClaim,
  stallDiagnosticBlock,
  stallRunRecord,
} from "./cycle-stall-report.ts";

interface StallWorkerData {
  readonly sab: SharedArrayBuffer;
  readonly fireAtMs: number;
  readonly processStartedMs: number;
  readonly wallAtMs: number;
  readonly recordPath: string;
  readonly startedAt: string;
  readonly cycleId: string;
  readonly testedSha: string | null;
  readonly stdoutFd: number;
  readonly stderrFd: number;
  readonly blockedAfterMs: number;
}

const data = workerData as StallWorkerData;

function write(fd: number, text: string): void {
  try {
    writeSync(fd, text);
  } catch {
    /* a closed descriptor must not stop the record being written */
  }
}

function fire(): void {
  /* The cycle wrote its own record first: nothing to diagnose. */
  if (claimRecord(data.sab, RECORD_CLAIM.ARMED, RECORD_CLAIM.STALL_WRITING) !== RECORD_CLAIM.ARMED) return;
  try {
    const block = stallDiagnosticBlock({
      snapshot: readPendingSnapshot(data.sab),
      nowMs: Date.now(),
      processStartedMs: data.processStartedMs,
      wallAtMs: data.wallAtMs,
      mainThreadPingMs: lastMainThreadPing(data.sab),
      blockedAfterMs: data.blockedAfterMs,
    });
    write(data.stderrFd, `\n${block.lines.join("\n")}\n`);
    try {
      mkdirSync(dirname(data.recordPath), { recursive: true });
      const record = stallRunRecord({ startedAt: data.startedAt, testedSha: data.testedSha, cycleId: data.cycleId, block });
      writeFileSync(data.recordPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
      write(data.stdoutFd, `  stall diagnostic: ${data.recordPath}\n`);
    } catch (error) {
      write(
        data.stderrFd,
        `freshness:shadow · the stall diagnostic could not write its record (${error instanceof Error ? error.message : String(error)})\n`,
      );
    }
  } finally {
    settleRecordClaim(data.sab, RECORD_CLAIM.STALL_WRITTEN);
  }
}

setTimeout(fire, Math.max(0, data.fireAtMs - Date.now()));
