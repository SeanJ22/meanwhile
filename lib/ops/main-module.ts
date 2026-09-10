import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** True only when an ES module is the process entry point. */
export function isDirectModuleExecution(
  moduleUrl: string,
  entry: string | undefined = process.argv[1],
): boolean {
  if (!entry) return false;
  const normalize = (value: string) =>
    process.platform === "win32" ? value.toLowerCase() : value;
  return normalize(resolve(entry)) === normalize(resolve(fileURLToPath(moduleUrl)));
}
