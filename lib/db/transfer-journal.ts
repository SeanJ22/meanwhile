import { mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NeonBytesHour } from "./transfer-by-caller.ts";
import { mayUseTestFixture } from "../civic-data/fixture-policy.ts";
import { operationalStatePath } from "../ops/operational-state-path.ts";

export const TRANSFER_JOURNAL_DIR_ENV = "WTP_DATABASE_TRANSFER_DIR";
export function transferJournalDir(): string | null {
  if (process.env[TRANSFER_JOURNAL_DIR_ENV]) return operationalStatePath(process.env[TRANSFER_JOURNAL_DIR_ENV]!);
  if (process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME || mayUseTestFixture(process.env)) return null;
  return operationalStatePath(join(tmpdir(), "meanwhile-database-transfer"));
}

/** The existing meter's process/hour buffer. Persist before handing a received chunk to its caller. */
export function journalProcessTransfer(part: NeonBytesHour): void {
  try {
    const journalDirectory = transferJournalDir();
    if (!journalDirectory || !Number.isSafeInteger(part.pid) || !Number.isSafeInteger(part.startedMs) ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:00:00\.000Z$/.test(part.hour)) return;
    mkdirSync(operationalStatePath(journalDirectory), { recursive: true });
    const journalDestination = operationalStatePath(join(journalDirectory, `${part.hour.slice(0, 13)}--${part.pid}-${part.startedMs}.json`));
    const journalTemporary = operationalStatePath(`${journalDestination}.owner.tmp`);
    writeFileSync(journalTemporary, JSON.stringify({ ...part, counterFormat: 1 }), { mode: 0o600 });
    renameSync(journalTemporary, operationalStatePath(journalDestination));
  } catch { /* The in-process meter and normal flush still count if this buffer is unavailable. */ }
}

const scanned = new Map<string, string>();
export function collectProcessTransfers(dir: string): readonly NeonBytesHour[] {
  let names: string[];
  try { names = readdirSync(dir); } catch { return []; }
  const result: NeonBytesHour[] = [];
  for (const name of names) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}--\d+-\d+\.json$/.test(name)) continue;
    const file = join(dir, name);
    try {
      const info = statSync(file), stamp = `${info.mtimeMs}:${info.size}`;
      if (scanned.get(file) === stamp) continue;
      const part = JSON.parse(readFileSync(file, "utf8"));
      if (part.counterFormat !== 1 || !Number.isSafeInteger(part.pid) || !Number.isFinite(part.startedMs)) continue;
      result.push(part);
      scanned.set(file, stamp);
    } catch { /* An unavailable buffer is retried on the next collection. */ }
  }
  return result;
}
