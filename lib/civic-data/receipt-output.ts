import type { Writable } from "node:stream";

/** Awaits the write: `console.log()` then `process.exit()` can truncate piped stdout and lose the receipt. */
export async function writeRoutineReceiptLine(
  line: string,
  output: Writable = process.stdout,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    output.write(`${line}\n`, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
