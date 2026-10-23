import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeContractHandoff } from "./contract-handoff.ts";

/** Only the supervisor writes this private handoff. Source children import the separate read-only module. */
export function writeContractHandoff<T extends string | { readonly id: string }>(values: readonly T[]): {
  readonly args: readonly string[]; cleanup(): void;
} {
  const selection = encodeContractHandoff(values);
  const directory = mkdtempSync(join(tmpdir(), "meanwhile-contracts-"));
  try {
    const path = join(directory, "contracts.json");
    writeFileSync(path, selection.bytes, { encoding: "utf8", mode: 0o600, flag: "wx" });
    return { args: [`--contracts-file=${path}`, `--contracts-count=${selection.count}`, `--contracts-sha256=${selection.sha256}`],
      cleanup: () => rmSync(directory, { recursive: true, force: true }) };
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}
