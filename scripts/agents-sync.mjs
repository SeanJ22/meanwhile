/**
 * `pnpm agents:sync` — regenerate the project-law mirror in `AGENTS.md` from
 * `CLAUDE.md`. `pnpm agents:check` (`--check`) reports and writes nothing.
 * (Provider transition, 2026-09-02. The rules are in `lib/ops/agents-mirror.mjs`.)
 *
 *   node scripts/agents-sync.mjs           write AGENTS.md if it is stale; exit 0
 *   node scripts/agents-sync.mjs --check   exit 0 when current, 1 when stale or
 *                                          unreadable, and SAY which line
 *
 * Registered in `lib/ops/generated-register.ts` as a pure generator, so the
 * suite regenerates it in place and compares bytes (RULING 92, RULING 102).
 * Plain `.mjs` so the pre-commit hook can run it with bare `node`.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  checkAgentsFile,
  lineEndingOf,
  renderAgentsFile,
} from "../lib/ops/agents-mirror.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLAUDE = join(ROOT, "CLAUDE.md");
const AGENTS = join(ROOT, "AGENTS.md");
const CHECK_ONLY = process.argv.includes("--check");

function refuse(message) {
  console.error(`agents-sync: ${message}`);
  process.exit(1);
}

if (!existsSync(CLAUDE)) refuse("CLAUDE.md is absent; nothing can be mirrored from a file that is not there.");
if (!existsSync(AGENTS)) refuse("AGENTS.md is absent; the generator preserves its Next.js block and never creates the file.");

const claude = readFileSync(CLAUDE, "utf8");
const agents = readFileSync(AGENTS, "utf8");
if (claude.trim().length < 1024) {
  // The R01 clobber: a 12-byte CLAUDE.md mirrored verbatim would erase the law from both files.
  refuse(`CLAUDE.md is ${Buffer.byteLength(claude, "utf8")} bytes — below the 1,024-byte floor, so it is not the constitution and is not mirrored.`);
}

const verdict = checkAgentsFile(agents, claude);
if (verdict.ok) {
  console.log(`agents-sync: current — ${verdict.reason}`);
  process.exit(0);
}
if (CHECK_ONLY) refuse(verdict.reason);

const eol = lineEndingOf(agents);
const rendered = renderAgentsFile(agents, claude).replace(/\n/g, eol);
writeFileSync(AGENTS, rendered, "utf8");
console.log(`agents-sync: wrote AGENTS.md (${Buffer.byteLength(rendered, "utf8")} bytes, ${eol === "\r\n" ? "CRLF" : "LF"}) — it was: ${verdict.reason}`);
