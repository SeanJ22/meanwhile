import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { researchFetch, type ResearchMemory, type RobotsMemo } from "../lib/hunt/robots-first-fetch.ts";
import { nodeResearchGet } from "../lib/hunt/robots-first-fetch.ts";

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

const target = process.argv.slice(2).find((a, i, all) => !a.startsWith("--") && (i === 0 || !all[i - 1].startsWith("--")));
if (target === undefined) {
  process.stderr.write("usage: pnpm research:fetch <url> [--out <file>] [--cache <dir>] [--log <file.tsv>]\n");
  process.exit(1);
}

const cacheDir = arg("--cache") ?? join(tmpdir(), "wtp-research-fetch");
mkdirSync(cacheDir, { recursive: true });
const statePath = join(cacheDir, "state.json");
type State = { robots: Record<string, RobotsMemo> };
const state: State = existsSync(statePath) ? (JSON.parse(readFileSync(statePath, "utf8")) as State) : { robots: {} };
const persist = (): void => writeFileSync(statePath, JSON.stringify(state, null, 1));

const memory: ResearchMemory = {
  robots: (origin) => state.robots[origin],
  rememberRobots: (origin, memo) => {
    state.robots[origin] = memo;
    persist();
  },

};

const logPath = arg("--log");
const result = await researchFetch(target, {
  memory,
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log: logPath === null ? undefined : (e) => appendFileSync(logPath, `${e.at}\t${e.purpose}\t${e.url}\t${e.status ?? ""}\t${e.transportError ?? ""}\t${e.bytes}\n`),
  get: nodeResearchGet,
});

const out = arg("--out");
if (result.outcome === "FETCHED" && out !== null) writeFileSync(out, result.body);
const { body: _body, ...summary } = result.outcome === "FETCHED" ? result : { ...result, body: undefined };
process.stdout.write(`${JSON.stringify({ ...summary, bodyBytes: result.outcome === "FETCHED" ? result.body.byteLength : null, savedTo: result.outcome === "FETCHED" ? out : null }, null, 1)}\n`);
process.exit(result.outcome === "FETCHED" ? 0 : 3);
