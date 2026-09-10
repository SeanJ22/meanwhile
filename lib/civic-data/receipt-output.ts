import type { Writable } from "node:stream";

/**
 * Write one machine-readable receipt and wait until the stream has accepted it.
 *
 * Source adapters occasionally need to terminate with a non-zero status after
 * durably recording a held attempt. `console.log()` followed by
 * `process.exit()` can truncate a piped stdout buffer, causing the supervisor
 * to miss that receipt and misclassify the durable source outcome as a
 * protocol failure. Awaiting the write callback closes that transport gap.
 */
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
