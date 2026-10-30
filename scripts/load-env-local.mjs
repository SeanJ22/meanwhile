import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { KEY_NAMES } from "../lib/core/keys-model.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Local configuration and the two database-key bootstrap settings; service keys come from the Keys box. */
export function loadEnvLocal(root = ROOT, environment = process.env) {
  const path = join(root, ".env.local");
  if (!existsSync(path)) return false;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match || Object.hasOwn(KEY_NAMES, match[1])) continue;
    const [, name, raw] = match;
    if (environment[name] === undefined) environment[name] = raw.trim().replace(/^["']|["']$/g, "");
  }
  return true;
}
