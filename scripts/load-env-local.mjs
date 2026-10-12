import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * `.env.local` into `process.env`, for the scripts `pnpm` runs without dotenv.
 * An existing value always wins: a CI environment's real values are never
 * overridden by the file.
 */
export function loadEnvLocal(root = ROOT) {
  const p = join(root, ".env.local");
  if (!existsSync(p)) return false;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const [, k, raw] = m;
    if (process.env[k] === undefined) {
      process.env[k] = raw.trim().replace(/^["']|["']$/g, "");
    }
  }
  return true;
}
