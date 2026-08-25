import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * **`.env.local` into `process.env`, for the scripts `pnpm` runs without dotenv.**
 *
 * One implementation. It was written inside `scripts/deploy-live.mjs` and the
 * handoff needed the same thing the moment its deploy check started reading the
 * Netlify record — RULING 103: the cheapest way to have no duplicate is to move
 * the original rather than write a second.
 *
 * ## The failure that made this necessary, recorded because it was silent
 *
 * `pnpm handoff --ship` reported **no NETLIFY_AUTH_TOKEN — the deploy record
 * cannot be read** on 2026-08-25, while the token was sitting in `.env.local` and
 * `pnpm deploy:live` was reading it fine. The handoff simply never loaded the
 * file. That is a could-not-run rather than a pass, which is the correct
 * reporting — and a could-not-run caused by not looking is still a check that
 * did not run.
 *
 * **An existing value always wins.** A CI environment sets these for real, and a
 * committed-adjacent file must never override what the platform supplied.
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
