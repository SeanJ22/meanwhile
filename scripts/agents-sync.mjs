// pnpm agents:sync — regenerate AGENTS.md from CLAUDE.md.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { lineEndingOf, renderAgentsFile } from "../lib/ops/agents-mirror.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const AGENTS = join(ROOT, "AGENTS.md");

const agents = readFileSync(AGENTS, "utf8");
const rendered = renderAgentsFile(agents, readFileSync(join(ROOT, "CLAUDE.md"), "utf8")).replace(/\n/g, lineEndingOf(agents));
writeFileSync(AGENTS, rendered, "utf8");
console.log(`agents-sync: wrote AGENTS.md (${Buffer.byteLength(rendered, "utf8")} bytes)`);
