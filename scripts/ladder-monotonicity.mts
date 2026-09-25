/**
 * `pnpm ladder:monotonicity` — WHICH RUNG ACTUALLY WORKS FOR THIS HOST FAMILY?
 * (2026-08-26, the descent-resume session. **RULING 182**, **RULING 178**.)
 *
 * ## The assumption this exists to falsify
 *
 * The retrieval ladder is numbered, and a numbered ladder invites the belief
 * that a higher rung is a stronger client. `scripts/ladder-fetch.mts` says as
 * much about rung 4 in its own header: *"a different CLIENT — `curl`, whose
 * TLS fingerprint passes walls Node's does not."* That is true often enough to
 * have been worth building.
 *
 * ## What this instrument actually found, including where it corrected me
 *
 * The first framing was "rung 3 serves where rung 4 is refused", from a probe
 * that had sent a RAW Chrome `User-Agent`. Run properly — through the rungs
 * this repository really sends — it measured **0 of 40** and was right to.
 * Rung 3 is not a raw Chrome UA: `browserProfileHeaders()` appends
 * `we-the-people civic meeting index (…)` to it, exactly as rung 2 does and
 * exactly as rung 4 is handed. All three carry our name, so all three are
 * refused together and there is no inversion between them to find.
 *
 * The pattern that IS there, across the whole `*.nh.gov` family:
 *
 * ```
 * host                    r0 bare   r2 project   r3 browser   r4 curl
 * www.nh.gov              200       403          403          403
 * www.revenue.nh.gov      200       403          403          403
 * www.sos.nh.gov          200       403          403          403
 * www.education.nh.gov    200       403          403          403
 * …and thirty more
 * ```
 *
 * **An anonymous request is served and every client that says who we are is
 * refused.** Isolating one variable at a time confirmed the cause is the
 * substring and nothing else — a raw Chrome UA is admitted, the same UA with
 * our suffix appended is refused, and a clean UA carrying the identification
 * in `From:` and `X-Purpose:` is admitted again.
 *
 * So the ladder's numbering is not the problem and neither is the TLS stack.
 * **The politest client in the ladder is the one the filter dislikes most**,
 * and the fix is rung 3b in `lib/sources/http.ts` — same disclosure, moved to
 * the headers HTTP defines for it.
 *
 * ## Why the instrument stays, now that it has an answer
 *
 * Because the answer is per-host-family and the next family will differ.
 * `newbury.nh.gov` is the exact inverse — it refuses rungs 0, 2 and 3 and
 * answers `curl` at 200 — which is why rung 4 stays in the ladder and why this
 * is measured rather than assumed. Both routes below are recorded at UNKNOWN
 * portability, and the command prints the curl build it measured with, because
 * this machine's curl is Schannel-built and a Linux runner's is not.
 *
 * Usage:
 *   pnpm ladder:monotonicity --hosts states/nh
 *   pnpm ladder:monotonicity --url https://www.nh.gov/ --url https://az.gov/
 */

import { execFile } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

import { learnRoute, recordRouteOutcome, type MethodKnowledge } from "../lib/method/knowledge.ts";
import { unknownApplicability } from "../lib/method/portability.ts";
import { floored, floorLine } from "../lib/ops/denominator-floor.ts";
import { sourceRequestHeaders, sourceUserAgent } from "../lib/sources/http.ts";
import { present, repeated } from "./cli-args.mts";
import { today } from "./doc-dates.mjs";

const run = promisify(execFile);
const ROOT = process.cwd();
const STORE = join(ROOT, "data", "method", "knowledge.json");
/*
 * TWO ROUTES, AND THE FIRST ONE KEEPS ITS ZERO.
 *
 * `ladder-rung-inversion` asked whether rung 4 is weaker than rung 3 and
 * measured 0 of 40. That ZERO is knowledge (RULING 88) and the id is immutable
 * (RULING 176), so it is neither renamed nor quietly widened to cover the
 * finding that came next.
 *
 * `identified-agent-refused` is the finding that came next, and it is a
 * different claim: not that one client is stronger than another, but that
 * naming ourselves at all is what gets refused.
 */
const ROUTE_ID = "ladder-rung-inversion";
const NAME_ROUTE_ID = "identified-agent-refused";

const has = (n: string): boolean => present(process.argv, n);
const args = (n: string): string[] => repeated(process.argv, n);

type Verdict = { rung: number; name: string; status: number | "ERR"; bytes: number };

async function nodeRung(url: string, rung: 2 | 3 | 0): Promise<Verdict> {
  const headers: Record<string, string> =
    rung === 2
      ? { "User-Agent": sourceUserAgent(), Accept: "*/*" }
      : rung === 3
        ? sourceRequestHeaders("text/html,application/xhtml+xml,*/*;q=0.8") /* Since 2026-09-25 the browser header set is retired (it disguised the client); this is the one identified client. */
        : {};
  const name = rung === 2 ? "node + project UA" : rung === 3 ? "node + browser headers" : "node, NO headers";
  try {
    const res = await fetch(url, { headers, redirect: "follow", signal: AbortSignal.timeout(20_000) });
    const body = await res.text();
    return { rung, name, status: res.status, bytes: body.length };
  } catch {
    return { rung, name, status: "ERR", bytes: 0 };
  }
}

async function curlRung(url: string): Promise<Verdict> {
  try {
    const { stdout } = await run(
      "curl",
      [
        "-sL",
        "--max-time",
        "20",
        "-o",
        process.platform === "win32" ? "NUL" : "/dev/null",
        "-w",
        "%{http_code} %{size_download}",
        "-A",
        sourceUserAgent(),
        url,
      ],
      { timeout: 35_000 },
    );
    const [code, size] = stdout.trim().split(/\s+/);
    return { rung: 4, name: "curl (different TLS stack)", status: Number(code) || "ERR", bytes: Number(size) || 0 };
  } catch {
    return { rung: 4, name: "curl (different TLS stack)", status: "ERR", bytes: 0 };
  }
}

/** The hosts a state's own corpus already names, so this is not a guess list. */
function hostsFromCorpus(dir: string): string[] {
  const out = new Set<string>();
  for (const f of ["NOTES.md", "sources.md", "tenancy.md"]) {
    const p = join(ROOT, dir, f);
    if (!existsSync(p)) continue;
    const text = readFileSync(p, "utf8");
    for (const m of text.matchAll(/\b((?:[a-z0-9-]+\.)+(?:gov|us|org|net|com))\b/gi)) {
      const h = m[1].toLowerCase();
      if (/\.(gov|us)$/.test(h)) out.add(h);
    }
  }
  return [...out].sort();
}

async function main(): Promise<void> {
  const stamp = today();
  const dirs = args("hosts");
  const urls = args("url");
  const targets = [
    ...urls,
    ...dirs.flatMap((d) => hostsFromCorpus(d).map((h) => `https://${h}/`)),
  ];
  if (targets.length === 0) {
    throw new Error("pnpm ladder:monotonicity --hosts states/nh   |   --url https://host/");
  }

  let curlBuild = "(curl not available)";
  try {
    const { stdout } = await run("curl", ["--version"], { timeout: 10_000 });
    curlBuild = stdout.split("\n")[0]?.trim() ?? curlBuild;
  } catch {
    /* named below as unavailable */
  }
  console.log(`measuring with: ${curlBuild}\n`);
  console.log(
    "host".padEnd(34) + "r0 bare".padEnd(9) + "r2 project".padEnd(12) + "r3 browser".padEnd(12) + "r4 curl",
  );

  /*
   * WHAT IS COUNTED, AND WHY IT IS NOT WHAT THIS FILE FIRST COUNTED.
   *
   * The first version asked "rung 3 serves and rung 4 refuses" and measured
   * **0 of 40**. The zero was correct and the QUESTION was wrong: rung 3
   * carries the same `we-the-people` suffix as rungs 2 and 4, so on this host
   * family all three are refused together and there is no inversion between
   * them to find.
   *
   * The pattern that is actually there is starker — **every identified rung
   * refused, and an anonymous request served** — and it is the one worth
   * counting, because it is the one that says the wall is our name rather than
   * our client. Recorded as its own outcome rather than by quietly widening
   * the old one, so the ZERO already written against the first framing stays
   * true of the question it answered.
   */
  let identifiedRefused = 0;
  let measured = 0;
  const rows: string[] = [];

  for (const url of targets.slice(0, 40)) {
    const [r0, r2, r3] = await Promise.all([nodeRung(url, 0), nodeRung(url, 2), nodeRung(url, 3)]);
    const r4 = await curlRung(url);
    measured += 1;
    /* The anonymous client is served and every client that names us is not. */
    const nameIsTheWall =
      r0.status === 200 && r2.status !== 200 && r3.status !== 200 && r4.status !== 200;
    if (nameIsTheWall) identifiedRefused += 1;
    const host = (() => {
      try {
        return new URL(url).hostname;
      } catch {
        return url;
      }
    })();
    console.log(
      host.slice(0, 33).padEnd(34) +
        String(r0.status).padEnd(9) +
        String(r2.status).padEnd(12) +
        String(r3.status).padEnd(12) +
        String(r4.status) +
        (nameIsTheWall ? "   <-- OUR NAME IS THE WALL: anonymous served, every identified rung refused" : ""),
    );
    rows.push(
      `| ${host} | ${r0.status} | ${r2.status} | ${r3.status} | ${r4.status} | ${nameIsTheWall ? "**name is the wall**" : ""} |`,
    );
  }

  console.log("");
  console.log(
    "  " +
      floorLine(
        measured > 0
          ? floored("hosts refusing every client that names us", "the hosts measured", measured, identifiedRefused)
          : floored("hosts refusing every client that names us", "the hosts measured", 0, 0, "no host was measured"),
      ),
  );

  if (has("dry")) return;

  /* ---- persist the route and what it measured --------------------------- */
  let k = JSON.parse(readFileSync(STORE, "utf8")) as MethodKnowledge;
  const learned = learnRoute(
    k,
    {
      id: ROUTE_ID,
      title:
        "ladder rung inversion: measure rungs 0/2/3/4 against a host family before trusting the numbering — a higher rung can be a WEAKER client",
      tier: "A0",
      fields: ["body", "roster", "meeting", "source"],
      applicability: unknownApplicability(
        "measured across the *.nh.gov family, where rungs 2, 3 AND 4 are all refused 403 and a HEADER-LESS request is served 200. Isolating one variable at a time identified the cause: the substring `we-the-people civic meeting index`, which every rung puts in the User-Agent. Not the TLS stack — curl carrying the same suffix is refused too. The SHAPE — a WAF that pattern-matches an unfamiliar agent string, so that the politest client in the ladder is the one most likely to be refused — belongs to no single state, and one family is not evidence that it travels.",
      ),
      outcomes: [],
      subBranches: [],
      origin:
        "conceived 2026-08-26 after a private curl-only client reported 23 governments unreachable that Node's fetch reached; rung-by-rung measurement across the NH state family showed every identified rung refused and a bare request served, which is the opposite of what the ladder's numbering implies",
      learnedOn: stamp,
    },
    stamp,
  );
  if (learned.duplicate) console.log(`\nroute ${ROUTE_ID} already known (method v${k.version})`);
  else {
    k = learned.knowledge;
    console.log(`\nLEARNED route ${ROUTE_ID} — method version now ${k.version}`);
  }
  /* The route the measurement is actually ABOUT. */
  const nameRoute = learnRoute(
    k,
    {
      id: NAME_ROUTE_ID,
      title:
        "the identified agent is the wall: when every client carrying this project's name is refused and an anonymous one is served, move the identification to From:/X-Purpose: rather than removing it",
      tier: "A0",
      fields: ["body", "roster", "meeting", "source"],
      applicability: unknownApplicability(
        "measured across the *.nh.gov family, where a raw Chrome User-Agent is served 200 and the same UA with `we-the-people civic meeting index` appended is refused 403. The SHAPE is a WAF pattern-matching an unfamiliar agent string, which is not New Hampshire's alone. The OPPOSITE also exists in the same state and must keep it honest: newbury.nh.gov refuses every Node client and admits curl, and morriscountyclerk.org and tucsonaz.gov both ALLOWLIST this project by name. Which way a host leans is measured, never assumed.",
      ),
      outcomes: [],
      subBranches: [],
      origin:
        "conceived 2026-08-26 by isolating one header at a time after every rung of the ladder was refused by hosts that served a bare request",
      learnedOn: stamp,
    },
    stamp,
  );
  if (nameRoute.duplicate) console.log(`route ${NAME_ROUTE_ID} already known`);
  else {
    k = nameRoute.knowledge;
    console.log(`LEARNED route ${NAME_ROUTE_ID} — method version now ${k.version}`);
  }
  const outcome = recordRouteOutcome(k, NAME_ROUTE_ID, {
    jurisdiction: dirs[0]?.split("/").pop() ?? "multi",
    walkedOn: stamp,
    rows: identifiedRefused,
    outcome: identifiedRefused > 0 ? "YIELDED" : "ZERO",
    note: `${identifiedRefused} of ${measured} host(s) served an anonymous request and refused EVERY client carrying this project's name; measured with ${curlBuild}`,
  });
  if (outcome.recorded) k = outcome.knowledge;
  writeFileSync(STORE, `${JSON.stringify({ ...k, updatedOn: stamp }, null, 2)}\n`, "utf8");
  console.log(outcome.reason);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
