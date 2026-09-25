/**
 * **RESEARCH FETCHES GO THROUGH HERE.** (2026-09-24, R15.)
 *
 * The one way a research session or its agents read a government site: robots.txt
 * first by construction, every redirect's origin asked again, walls and hosts
 * awaiting the owner's decision refused before any request, requests to one host
 * spaced, and every request written to the log. The rules are in
 * `lib/hunt/robots-first-fetch.ts`; this is its command line.
 *
 *   pnpm research:fetch <url> [--out <file>] [--cache <dir>] [--log <file.tsv>]
 *
 * - `--out`   writes the body, byte-exact (a PDF stays a PDF).
 * - `--cache` keeps robots.txt readings and per-host request times between runs,
 *             so a batch of calls asks each host once and stays spaced. Default:
 *             `<os tmpdir>/wtp-research-fetch`.
 * - `--log`   appends one tab-separated line per request, robots.txt included.
 *
 * Prints one JSON object: the outcome (FETCHED or REFUSED and why), the final URL,
 * status, content type, sha256, the redirects followed and each origin's robots
 * verdict. It exits 0 on FETCHED, 3 on REFUSED, 1 on a usage error.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { nodeResearchGet, researchFetch, type ResearchMemory, type RobotsMemo } from "../lib/hunt/robots-first-fetch.ts";

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
type State = { robots: Record<string, RobotsMemo>; requests: Record<string, number> };
const state: State = existsSync(statePath) ? (JSON.parse(readFileSync(statePath, "utf8")) as State) : { robots: {}, requests: {} };
const persist = (): void => writeFileSync(statePath, JSON.stringify(state, null, 1));

const memory: ResearchMemory = {
  robots: (origin) => state.robots[origin],
  rememberRobots: (origin, memo) => {
    state.robots[origin] = memo;
    persist();
  },
  lastRequestAt: (host) => state.requests[host],
  noteRequest: (host, at) => {
    state.requests[host] = at;
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
