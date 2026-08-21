/**
 * `pnpm hunt:roster` — walk a list of body pages, read every roster off them,
 * and record the rung each one landed on (NH Hunt, 2026-08-20).
 *
 *   pnpm hunt:roster <urls-file> [--out docs/evidence/<name>.jsonl]
 *   pnpm hunt:roster --url https://www.newbury.nh.gov/selectboard
 *
 * `<urls-file>` is one URL per line; `#` starts a comment and a blank line is
 * skipped. Anything after a tab or two spaces on a URL line is a LABEL carried
 * onto every row that page produces, so a run's output says which body a person
 * belongs to without a second lookup.
 *
 * ## What it is for
 *
 * A hunt against a town reads twenty pages, not one. `pnpm extract roster`
 * answers one page and prints to a terminal; this walks a list, follows the
 * redirects a municipal CMS is full of, and writes an EVIDENCE LEDGER — one
 * JSON object per line, carrying the URL, the redirect chain, the HTTP status,
 * the ladder rung the retrieval landed on, the extraction outcome and its
 * counts, and the rows.
 *
 * ## Every line is a rung, whether or not it worked
 *
 * `CLAUDE.md`: *every wall met is a rung, and the rung is written down whether
 * or not it worked. A rung that failed is as valuable as one that succeeded,
 * because the next hunt does not repeat it.* So a 404, a challenge page and a
 * roster-less page each get a line naming what happened, and the run prints
 * PAGES READ, PAGES WITH A ROSTER and PEOPLE FOUND as a set of counts rather
 * than a single number. An operation that can return nothing is asked what it
 * returned.
 *
 * ## Rung numbering
 *
 * `CLAUDE.md`'s canonical retrieval-mechanics ladder, and no other:
 *   2 — plain fetch
 *   3 — fetch with the full browser header set (what `politeGetText` sends
 *       with `profile: "browser"`, which is this script's first attempt)
 *   4 — a different client whose TLS fingerprint passes (the shared client
 *       escalates to `curl` itself when a challenge is served at 200)
 *   6 — THE LIVE BROWSER, taken automatically when the host answers with a
 *       Cloudflare interstitial. Newbury serves one on six of its own board
 *       pages and the plain page on the other twenty-two, from the same host,
 *       in the same run — so a hunt that stopped at rung 3 would have reported
 *       the Energy Committee and the Fire Department as unreachable while
 *       reading the Selectboard fine. **This is not circumvention**: it is the
 *       page rendering the way it renders for a person, which is exactly what
 *       rung 6 is for. Nothing is authenticated and no control is bypassed —
 *       a page behind the site's own LOGIN stops here and is named, which is
 *       what happens to Parks & Recreation below.
 *
 * A page reached after a redirect is still the rung that reached it; the chain
 * is recorded so the next hunt can go straight to the final URL.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { launchGuarded } from "./browser.mts";
import { extractRosterTables } from "../lib/extract/roster-table.ts";
import type { RosterRow } from "../lib/extract/roster-table.ts";
import { challengeIn, politeGetText } from "../lib/sources/http.ts";

interface LedgerLine {
  url: string;
  label: string | null;
  attemptedAt: string;
  /** Every hop, in order, when the CMS redirected us. Empty when it did not. */
  redirects: string[];
  finalUrl: string;
  status: number | null;
  /** The canonical mechanics rung this retrieval landed on. */
  rung: number;
  /** `OK`, or the wall in the source's own words. */
  retrieval: string;
  outcome: string;
  rows: number;
  counts: Record<string, number>;
  reason: string;
  people: RosterRow[];
}

const args = process.argv.slice(2);
const outAt = args.indexOf("--out");
const OUT = outAt >= 0 ? args[outAt + 1] : null;
const urlAt = args.indexOf("--url");

function targets(): Array<{ url: string; label: string | null }> {
  if (urlAt >= 0) return [{ url: args[urlAt + 1]!, label: null }];
  const file = args.find((a) => !a.startsWith("--") && a !== OUT);
  if (!file || !existsSync(file)) {
    console.error(
      "usage: pnpm hunt:roster <urls-file> [--out <file.jsonl>]\n" +
        "       pnpm hunt:roster --url <url>",
    );
    process.exit(2);
  }
  return readFileSync(file, "utf8")
    .split("\n")
    .map((l) => l.replace(/\r$/, ""))
    .filter((l) => l.trim() && !l.trim().startsWith("#"))
    .map((line) => {
      const split = /\t|\s{2,}/.exec(line);
      return split
        ? { url: line.slice(0, split.index).trim(), label: line.slice(split.index).trim() }
        : { url: line.trim(), label: null };
    });
}

/**
 * Follow the CMS's redirects by hand, recording every hop.
 *
 * The shared client reports a 301 as a refusal, which is correct for an
 * ADAPTER — a body's agenda URL that moved is a wiring row to fix, not a hop to
 * paper over. A HUNT is the opposite case: the redirect is the trail, and
 * following it is the work. So the hop is taken here and the chain is written
 * down, which is what turns it into a rung the next session inherits.
 */
async function fetchFollowing(
  url: string,
  redirects: string[] = [],
): Promise<{ text: string; status: number; finalUrl: string; redirects: string[] }> {
  if (redirects.length > 5) {
    throw new Error(`redirect loop: ${[...redirects, url].join(" → ")}`);
  }
  try {
    const r = await politeGetText(url, { profile: "browser" });
    return { text: r.text, status: r.status, finalUrl: url, redirects };
  } catch (error) {
    const message = String((error as Error).message ?? error);
    const moved = /HTTP (30[1278])/.exec(message);
    if (!moved) throw error;
    /*
     * **RUNG 4 — A DIFFERENT CLIENT, AND THE REDIRECT IS THE TRAIL.**
     * (NH Hunt, 2026-08-20. The single most productive rung of the Newbury
     * sweep.)
     *
     * Seven of Newbury's own board pages answer 301 to every fetch client in
     * this repo, and a `redirect: "manual"` probe from the same process gets a
     * Cloudflare 403 instead of a `Location` header — so the hop could not be
     * READ, and the first two runs recorded all seven as walls. `curl` follows
     * them in one call, and what is on the other side is the point:
     *
     *   /newbury-energy-committee          → newburyenergynh.org
     *   /newbury-beautification-committee  → newburybeautification.org
     *   /fire-rescue-department            → fire.newbury.nh.gov
     *   /joint-assessing-board-…           → sunapeenh.gov/joint-assessing-board
     *   /newbury-public-library-trustees   → newburynhlibrary.net/trustees_meetings
     *
     * **A board's entry in a town's own menu can be an off-site link.** Three
     * of Newbury's committees run their own domains, one lives on a SUBDOMAIN,
     * and the joint board is hosted by a DIFFERENT MEMBER TOWN. A hunt that
     * treated the 301 as a refusal would have reported five real, published,
     * findable bodies as unreachable — and would have been wrong about which
     * government publishes them, which is worse.
     *
     * The two that do NOT open are the honest ones: Parks & Recreation and the
     * Housing Committee both land on `/user/login?destination=node/…`. That is
     * the site's own access control, and this product never authenticates past
     * one. They are named, with rungs 11 and 9 as what is owed next.
     */
    const { execFileSync } = await import("node:child_process");
    let effective: string;
    try {
      effective = execFileSync(
        "curl",
        [
          "-sL",
          "-o",
          process.platform === "win32" ? "NUL" : "/dev/null",
          "-w",
          "%{url_effective}",
          "--max-time",
          "45",
          "-A",
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          url,
        ],
        { encoding: "utf8", timeout: 60_000 },
      ).trim();
    } catch {
      throw error;
    }
    if (!effective || effective === url) throw error;
    return fetchFollowing(effective, [...redirects, url]);
  }
}

/**
 * Rung 6 — the live browser, opened once and reused for every challenged page.
 *
 * Lazy on purpose: most runs never meet a challenge, and launching Chromium
 * for a town that does not need it is a cost with no return.
 */
let guarded: Awaited<ReturnType<typeof launchGuarded>> | undefined;
async function viaBrowser(url: string): Promise<{ text: string; status: number }> {
  guarded ??= await launchGuarded({ label: "nhhunt-roster" });
  // `context` and `page`, not Playwright's own names — see GuardedBrowser.
  const context = await guarded.context();
  const page = await context.newPage();
  try {
    /*
     * `domcontentloaded`, NOT `networkidle` — RULING 12, whose stopwatch ran
     * out. The first version of this waited for network idle and timed out on
     * ten of Newbury's pages at 60s each, and every one of those was recorded
     * as a wall. It was not a wall: these pages hold a webcam widget and a
     * social embed that never stop talking, so idle never arrives and the wait
     * was OUR bug reported as the town's refusal. That is the failed-operation
     * -as-wall shape, and it is a JOB.
     */
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    // The interstitial clears a second or two after the first paint; poll for
    // it rather than sleeping a fixed budget on every page.
    for (let i = 0; i < 12; i++) {
      if (!challengeIn(await page.content())) break;
      await page.waitForTimeout(1_500);
    }
    return { text: await page.content(), status: response?.status() ?? 0 };
  } finally {
    await context.close();
  }
}

const lines: LedgerLine[] = [];
let pagesRead = 0;
let pagesWithRoster = 0;
let people = 0;

/*
 * Deliberate spacing between pages, on top of the shared client's own.
 * Newbury's host runs a reputation limiter: a sweep at the client's default
 * pace reads twenty-one pages and then starts getting challenged on pages it
 * read a minute earlier. Slowing down is the compliant answer and the only one
 * — `CLAUDE.md` requires that we never request at a rate that degrades
 * service, and a limiter tripping is the service telling us we are close.
 */
const PACE_MS = Number(process.env.WTP_HUNT_PACE_MS ?? 4000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let index = 0;
for (const { url, label } of targets()) {
  if (index++ > 0) await sleep(PACE_MS);
  const attemptedAt = new Date().toISOString();
  let line: LedgerLine;
  try {
    const got = await fetchFollowing(url);
    pagesRead += 1;
    const result = extractRosterTables(got.text, got.finalUrl, got.finalUrl);
    if (result.outcome === "EXTRACTED") {
      pagesWithRoster += 1;
      people += result.rows;
    }
    line = {
      url,
      label,
      attemptedAt,
      redirects: got.redirects,
      finalUrl: got.finalUrl,
      status: got.status,
      rung: 3,
      retrieval: "OK",
      outcome: result.outcome,
      rows: result.rows,
      counts: result.counts,
      reason: result.reason,
      people: result.items,
    };
  } catch (error) {
    /*
     * Rung 3 refused. Escalate to rung 6 rather than recording a wall — a hunt
     * that ends before the ladder is exhausted is an incomplete hunt and may
     * never be reported as a finding.
     */
    const rung3 = String((error as Error).message ?? error);
    try {
      const got = await viaBrowser(url);
      /*
       * The SHARED signature check, not a private regex. A challenge page that
       * reaches the extractor becomes a ZERO_ROWS finding about the body's
       * page, which is a wall rendered as an emptiness — see `challengeIn`.
       */
      const wall = challengeIn(got.text);
      if (wall) {
        throw new Error(
          `${wall} did not clear in the live browser (rung 6). Next rungs: 11, the ` +
            "Internet Archive; 9, the body's own linked documents; 13, its records request path",
        );
      }
      if (/\/user\/login\?destination/.test(got.text) && !/views-table/.test(got.text)) {
        throw new Error(
          "the page is behind the site's OWN LOGIN — an access control, which " +
            "this product never authenticates past. Next rungs: 11 (the Internet " +
            "Archive) and 9 (the annual town report)",
        );
      }
      pagesRead += 1;
      const result = extractRosterTables(got.text, url, url);
      if (result.outcome === "EXTRACTED") {
        pagesWithRoster += 1;
        people += result.rows;
      }
      line = {
        url,
        label,
        attemptedAt,
        redirects: [],
        finalUrl: url,
        status: got.status,
        rung: 6,
        retrieval: `rung 3 refused (${rung3}); RUNG 6 READ IT`,
        outcome: result.outcome,
        rows: result.rows,
        counts: result.counts,
        reason: result.reason,
        people: result.items,
      };
    } catch (browserError) {
      line = {
        url,
        label,
        attemptedAt,
        redirects: [],
        finalUrl: url,
        status: Number(/HTTP (\d+)/.exec(rung3)?.[1] ?? 0) || null,
        rung: 6,
        retrieval:
          `rung 3: ${rung3} · rung 6: ${String((browserError as Error).message ?? browserError)}`,
        outcome: "CANNOT_RUN",
        rows: 0,
        counts: {},
        reason: "the page was not retrieved — see `retrieval`",
        people: [],
      };
    }
  }
  lines.push(line);
  const head = `${String(line.status ?? "—").padStart(3)} ${line.outcome.padEnd(11)} rows=${String(line.rows).padStart(3)}`;
  console.log(`${head}  ${line.label ?? line.finalUrl}`);
  if (line.redirects.length) console.log(`      via ${line.redirects.join(" → ")} → ${line.finalUrl}`);
  if (line.outcome !== "EXTRACTED") console.log(`      ${line.reason || line.retrieval}`);
  for (const p of line.people) {
    console.log(
      `      [${p.section}] ${p.name}${p.title ? ` — ${p.title}` : ""}` +
        `${p.phone ? ` · ${p.phone}` : ""}${p.email ? ` · ${p.email}` : ""}`,
    );
  }
}

console.log(
  `\npages attempted ${lines.length} · read ${pagesRead} · with a roster ${pagesWithRoster} · ` +
    `people ${people}`,
);
const walls = lines.filter((l) => l.retrieval !== "OK");
if (walls.length) {
  console.log(`\nwalls, named — ${walls.length}:`);
  for (const w of walls) console.log(`  ${w.url}\n    ${w.retrieval}`);
}
const empty = lines.filter((l) => l.retrieval === "OK" && l.outcome !== "EXTRACTED");
if (empty.length) {
  console.log(`\nread but no roster — ${empty.length} (a finding about the PAGE, never about the body):`);
  for (const e of empty) console.log(`  ${e.finalUrl}\n    ${e.reason}`);
}

if (OUT) {
  /*
   * **CARRY-FORWARD, ON THE LEDGER ITSELF.**
   *
   * `CLAUDE.md`: a failed fetch never silently empties a previously-full
   * surface. That rule was written about the meetings snapshot and it applies
   * to this file with no change at all — the third run of this sweep wrote 77
   * people over the first run's 88, because Cloudflare's reputation limiter
   * had started refusing pages the earlier run had read. Nothing was wrong
   * with the town, nothing was wrong with the earlier reading, and the ledger
   * would have said we had less.
   *
   * So a line that CANNOT_RUN this time keeps the last line that worked, with
   * its ORIGINAL `attemptedAt` intact — never restamped as fresh — and
   * `carriedFrom` naming the run it came out of. The count is stated per run.
   */
  mkdirSync(dirname(OUT), { recursive: true });
  const previous = new Map<string, LedgerLine & { carriedFrom?: string }>();
  if (existsSync(OUT)) {
    for (const raw of readFileSync(OUT, "utf8").split("\n")) {
      if (!raw.trim()) continue;
      const prior = JSON.parse(raw) as LedgerLine & { carriedFrom?: string };
      if (prior.outcome === "EXTRACTED") previous.set(prior.url, prior);
    }
  }
  let carried = 0;
  const merged = lines.map((l) => {
    if (l.outcome === "EXTRACTED") return l;
    const prior = previous.get(l.url);
    if (!prior) return l;
    carried += 1;
    return {
      ...prior,
      carriedFrom: prior.carriedFrom ?? prior.attemptedAt,
      retrieval: `${l.retrieval} — CARRIED from the read of ${prior.carriedFrom ?? prior.attemptedAt}`,
    };
  });
  writeFileSync(OUT, "", "utf8");
  for (const l of merged) appendFileSync(OUT, `${JSON.stringify(l)}\n`, "utf8");
  const total = merged.reduce((n, l) => n + l.rows, 0);
  console.log(
    `\nledger written  ${OUT}  ${merged.length} line(s) · ${carried} carried from an ` +
      `earlier read · ${total} people on the ledger against ${people} read this run`,
  );
}

await guarded?.close();

// A run that read nothing is a failed run, never an empty town.
if (pagesRead === 0) process.exit(1);
