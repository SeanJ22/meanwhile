/**
 * `pnpm tenancy --state <code>` — WHICH DISCOVERED BODIES ARE ALREADY ON A
 * PLATFORM WE READ?
 * (2026-08-26, the descent session, Item 4.)
 *
 * This project runs nine meeting adapters, every one wired a tenant at a time
 * for a body somebody had already decided to cover. **Nothing had ever asked
 * the inverse** — given a body, is it already sitting on a platform we can
 * read? A body reachable by an adapter we already had and never connected is
 * the cheapest coverage in this product, and it is invisible in every report
 * that counts what the adapters got.
 *
 * Reads `states/<code>/descent-candidates.md` — the descent's output, so the
 * two are one motion rather than two projects — and probes each distinct host.
 *
 * Reports the RULING 105 three-way split, plus the fourth column RULING 24
 * requires: **reachable now · on a platform we do not handle · nothing
 * detected · could not read.** A count that folded the last into the third
 * would report a wall as a finding.
 *
 * Usage:
 *   pnpm tenancy --state nj
 *   pnpm tenancy --state az --limit 60
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  detectTenancy,
  splitTenancy,
  type TenancyRow,
} from "../lib/hunt/platform-tenancy.ts";
import { today } from "./doc-dates.mjs";
import { judgeUrl } from "./robots-sweep.mts";

const ROOT = process.cwd();

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

async function getPage(url: string): Promise<string | null> {
  const rungs: Record<string, string>[] = [
    { "user-agent": "we-the-people/1.0 (civic data; +mailto:seanj22@gmail.com)", accept: "text/html,*/*" },
    { "user-agent": BROWSER_UA, accept: "text/html,application/xhtml+xml,*/*;q=0.8", "accept-language": "en-US,en;q=0.9" },
  ];
  for (const headers of rungs) {
    try {
      const res = await fetch(url, { headers, redirect: "follow", signal: AbortSignal.timeout(20_000) });
      if (res.ok) return await res.text();
    } catch {
      /* next rung */
    }
  }
  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const run = promisify(execFile);
    const { stdout } = await run("curl", ["-sL", "--max-time", "20", "-A", BROWSER_UA, url], {
      timeout: 35_000,
      maxBuffer: 24 * 1024 * 1024,
    });
    return stdout.length > 0 ? stdout : null;
  } catch {
    return null;
  }
}

/**
 * The hosts to probe, taken from what the descent actually saw.
 *
 * One row per HOST rather than per candidate: tenancy is a property of the site
 * a body publishes on, and probing fifty links into one town's site fifty times
 * would burn the budget answering one question repeatedly.
 */
function hostsFromCandidates(state: string): Map<string, string> {
  const file = join(ROOT, "states", state, "descent-candidates.md");
  if (!existsSync(file)) {
    throw new Error(
      `TENANCY REFUSED — no states/${state}/descent-candidates.md. The descent produces it. ` +
        `Run \`pnpm descent --state ${state}\` first: asking which bodies are on a platform we read ` +
        "requires knowing which bodies there are (RULING 169).",
    );
  }
  const out = new Map<string, string>();
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\|\s*(.+?)\s*\|\s*(?:yes|\*\*no\*\*)\s*\|\s*(\S+)\s*\|$/.exec(line);
    if (!m) continue;
    try {
      const u = new URL(m[2]);
      if (!out.has(u.origin)) out.set(u.origin, m[1]);
    } catch {
      /* not a URL — skip */
    }
  }
  return out;
}

async function main(): Promise<void> {
  const state = (arg("state") ?? "").trim().toLowerCase();
  if (!state) throw new Error("pnpm tenancy --state <code>");
  const limit = Number(arg("limit") ?? 60);

  const hosts = hostsFromCandidates(state);
  if (hosts.size === 0) {
    /* RULING 159 — a selector that matches nothing is an ERROR naming the
     * selector, never a clean zero. */
    throw new Error(
      `TENANCY REFUSED — states/${state}/descent-candidates.md parsed to ZERO hosts. The row shape the ` +
        "reader looks for is `| name | yes/**no** | url |`. A sweep with no denominator is a sweep that " +
        "did not run (RULING 159), not a state with no bodies.",
    );
  }

  const stamp = today();
  const rows: TenancyRow[] = [];
  let unreadable = 0;
  let refused = 0;
  let n = 0;

  for (const [origin, body] of hosts) {
    if (n >= limit) break;
    n += 1;
    const perm = await judgeUrl(origin);
    if (perm.verdict !== "ALLOWED" && perm.verdict !== "NO_ROBOTS") {
      refused += 1;
      console.log(`  REFUSED       ${perm.verdict.padEnd(12)} ${origin}`);
      continue;
    }
    const html = await getPage(origin);
    if (html === null) {
      unreadable += 1;
      console.log(`  COULD NOT READ             ${origin}`);
      continue;
    }
    const hits = detectTenancy(html, origin);
    rows.push({ body, url: origin, hits });
    const real = hits.filter((h) => h.strength !== "DERIVED_LEAD");
    const owned = real.filter((h) => h.haveAdapter).map((h) => h.label);
    const other = real.filter((h) => !h.haveAdapter).map((h) => h.label);
    console.log(
      `  ${owned.length > 0 ? "REACHABLE NOW" : other.length > 0 ? "no adapter   " : "nothing found"}  ` +
        `${origin}  ${[...owned, ...other].join(", ") || "-"}`,
    );
  }

  const split = splitTenancy(rows, unreadable);
  const lines: string[] = [
    `# ${state.toUpperCase()} — platform tenancy`,
    "",
    `**Probed ${stamp}** by \`pnpm tenancy --state ${state}\`, over the hosts \`pnpm descent\` actually saw.`,
    "",
    `**${hosts.size} host(s) known · ${n} probed · ${refused} refused on permission (RULING 148).**`,
    "",
    "| | Count | What it means |",
    "|---|---|---|",
    `| **Reachable now** | **${split.reachableNow}** | on a platform this project ALREADY reads — the cheapest coverage there is |`,
    `| On a platform we do not handle | ${split.unhandledPlatform} | scoped work: we know the vendor and have no adapter |`,
    `| Nothing detected | ${split.nothingDetected} | a hunt, not a build. **Not the same fact as the row above** |`,
    `| Could not read | ${split.couldNotRead} | RULING 24 — a check that cannot reach its subject never prints like a pass |`,
    "",
    "## Every host, and the evidence",
    "",
    "| Host | Platform | Adapter? | How we know | Evidence |",
    "|---|---|---|---|---|",
  ];
  for (const r of rows) {
    if (r.hits.length === 0) {
      lines.push(`| ${r.url} | — | — | nothing detected | — |`);
      continue;
    }
    for (const h of r.hits) {
      lines.push(
        `| ${r.url} | ${h.label} | ${h.haveAdapter ? "**yes**" : "no"} | \`${h.strength}\` | ` +
          `${h.evidence.replace(/\|/g, "\\|").slice(0, 120)} |`,
      );
    }
  }
  lines.push(
    "",
    "**`LINKED` is the body's own page pointing at a vendor. `SERVED_BY` is a vendor's markup on the body's own",
    "domain — the only route to a vendor that hosts under the customer's name, which a link-out test cannot",
    "find. `DERIVED_LEAD` is a guessed tenant slug and is a LEAD, never a HIT.**",
  );

  writeFileSync(join(ROOT, "states", state, "tenancy.md"), `${lines.join("\n")}\n`, "utf8");
  console.log(`\n${lines.slice(4, 14).join("\n")}`);
  console.log(`\nwrote states/${state}/tenancy.md`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
