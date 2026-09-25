/**
 * **THE RETRIEVAL LADDER, WALKED BY A COMMAND** (built 2026-08-21, NH Hunt 2).
 *
 * ```
 * pnpm ladder <url> [--out <file>] [--stop-at <rung>] [--json]
 * ```
 *
 * `CLAUDE.md` names fourteen rungs and says a hunt is over only when every one
 * has been walked and RECORDED with its result. Until this existed, walking
 * them meant a session typing four different clients by hand and remembering
 * what each returned — so the record was a memory, the rungs were walked in
 * whatever order occurred to whoever was typing, and a rung that was skipped
 * looked exactly like a rung that failed.
 *
 * This walks rungs 2 → 3 → 4 → 5 → 6 in order, stops at the first that returns
 * the document, and PRINTS EVERY RUNG WITH ITS RESULT — including the ones it
 * did not need to walk, marked as not attempted rather than left off the list.
 * The rung numbers are `CLAUDE.md`'s canonical retrieval-mechanics numbering
 * (RULING 16) and no other.
 *
 * | Rung | What it is here |
 * |---|---|
 * | 2 | Plain fetch, this project's identified `User-Agent` |
 * | 3 | Fetch with the full browser header set |
 * | 4 | A different CLIENT — `curl`, whose TLS fingerprint passes walls Node's does not |
 * | 5 | A different EGRESS — `lib/hunt/egress.ts` |
 * | 6 | The live browser, JavaScript executed and content awaited |
 *
 * Rung 1 (a committed snapshot) is the caller's own repo and is not a fetch.
 * Rungs 7 and up are decisions about WHERE to look rather than how to get
 * bytes — the page's own network calls, the markup behind the prose, the
 * archive, the vendor platform — and each is its own hunt. This walks the part
 * that is mechanical.
 *
 * ## A challenge page is a WALL, never a document
 *
 * Every rung body goes through `challengeIn()` before it counts as a read. A
 * Cloudflare interstitial served at HTTP 200 is the exact shape that made a
 * walled school-board roster render as a body with no members, and the size
 * floor that let it through is recorded in the playbook. A rung whose body is a
 * challenge is reported as WALLED with the challenge named, and the walk
 * continues.
 *
 * ## What it never does
 *
 * It does not retry a rung, rate-limit itself into a load test, or follow the
 * links on the page. One URL, one pass, one ledger.
 */
import { writeFileSync } from "node:fs";

import { challengeIn, sourceRequestHeaders, sourceUserAgent } from "../lib/sources/http.ts";
import { EGRESS_SPACING_MS, readViaEgress } from "../lib/hunt/egress.ts";
import { launchGuarded } from "./browser.mts";

interface RungResult {
  rung: number;
  name: string;
  outcome: "READ" | "WALLED" | "FAILED" | "NOT_ATTEMPTED";
  status?: number;
  bytes?: number;
  detail?: string;
  text?: string;
}

const RUNGS: { rung: number; name: string }[] = [
  { rung: 2, name: "plain fetch" },
  { rung: 3, name: "full browser header set" },
  { rung: 4, name: "a different client (curl)" },
  { rung: 5, name: "a different egress" },
  { rung: 6, name: "the live browser" },
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Rungs 2 and 3 are RAW fetches, deliberately not `politeGetText`.
 *
 * `politeGetText` walks 2 → 3 → 4 by itself on a 403 — which is correct for an
 * adapter and WRONG here, because it reports a document without saying which
 * rung produced it. The first run of this tool used it and printed "rung 2 READ,
 * 200, 74,600 bytes" for a page whose raw rung 2 is a Cloudflare 403 and whose
 * rung 4 is a 200. That is a manufactured retrieval history: a `walledAtRung`
 * value written from it would be wrong in the database, and wrong in the
 * direction that makes a wall disappear.
 *
 * So each rung here is exactly the one thing it is named after, and the
 * escalation is this function's caller walking the list.
 */
async function walkHttp(url: string, profile: "plain" | "browser"): Promise<RungResult> {
  const rung = profile === "plain" ? 2 : 3;
  const name = RUNGS.find((r) => r.rung === rung)!.name;
  const headers =
    profile === "browser"
      ? sourceRequestHeaders("text/html,application/xhtml+xml,*/*;q=0.8") /* Since 2026-09-25 the browser header set is retired (it disguised the client); this is the one identified client. */
      : { "User-Agent": sourceUserAgent(), Accept: "*/*" };
  try {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(60_000) });
    const text = await response.text();
    const status = response.status;
    if (status >= 400)
      return { rung, name, outcome: "WALLED", status, bytes: text.length, detail: `HTTP ${status}` };
    const wall = challengeIn(text);
    if (wall) return { rung, name, outcome: "WALLED", status, bytes: text.length, detail: wall };
    return { rung, name, outcome: "READ", status, bytes: text.length, text };
  } catch (error) {
    return { rung, name, outcome: "FAILED", detail: (error as Error).message.slice(0, 300) };
  }
}

async function walkCurl(url: string): Promise<RungResult> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  const name = RUNGS[2]!.name;
  try {
    const { stdout } = await run(
      "curl",
      ["-sSL", "--max-time", "60", "-A", sourceUserAgent(), "-w", "\n__HTTP__%{http_code}", url],
      { maxBuffer: 64 * 1024 * 1024 },
    );
    const cut = stdout.lastIndexOf("\n__HTTP__");
    const body = cut < 0 ? stdout : stdout.slice(0, cut);
    const status = cut < 0 ? 0 : Number(stdout.slice(cut + 9).trim());
    if (status >= 400)
      return { rung: 4, name, outcome: "WALLED", status, bytes: body.length, detail: `HTTP ${status}` };
    const wall = challengeIn(body);
    if (wall) return { rung: 4, name, outcome: "WALLED", status, bytes: body.length, detail: wall };
    return { rung: 4, name, outcome: "READ", status, bytes: body.length, text: body };
  } catch (error) {
    return { rung: 4, name, outcome: "FAILED", detail: (error as Error).message.slice(0, 300) };
  }
}

async function walkEgress(url: string): Promise<RungResult> {
  const name = RUNGS[3]!.name;
  await sleep(EGRESS_SPACING_MS);
  try {
    const result = await readViaEgress(url);
    const wall = challengeIn(result.text);
    if (wall)
      return { rung: 5, name, outcome: "WALLED", status: result.status, bytes: result.bytes, detail: wall };
    return {
      rung: 5,
      name,
      outcome: "READ",
      status: result.status,
      bytes: result.bytes,
      detail: `relayed — cite ${result.url}, read via ${new URL(result.readerUrl).host}`,
      text: result.text,
    };
  } catch (error) {
    return { rung: 5, name, outcome: "FAILED", detail: (error as Error).message.slice(0, 300) };
  }
}

async function walkBrowser(url: string): Promise<RungResult> {
  const name = RUNGS[4]!.name;
  let browser: Awaited<ReturnType<typeof launchGuarded>> | null = null;
  try {
    browser = await launchGuarded({ label: "ladder-fetch" });
    const page = await browser.page();
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(5_000);
    const html = await page.content();
    const status = response?.status() ?? 0;
    const wall = challengeIn(html);
    if (wall) return { rung: 6, name, outcome: "WALLED", status, bytes: html.length, detail: wall };
    if (status >= 400)
      return { rung: 6, name, outcome: "WALLED", status, bytes: html.length, detail: `HTTP ${status}` };
    return { rung: 6, name, outcome: "READ", status, bytes: html.length, text: html };
  } catch (error) {
    return { rung: 6, name, outcome: "FAILED", detail: (error as Error).message.slice(0, 300) };
  } finally {
    await browser?.close();
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const url = args.find((a) => !a.startsWith("--"));
  if (!url) {
    console.error("usage: pnpm ladder <url> [--out <file>] [--stop-at <rung>] [--json]");
    process.exit(2);
  }
  const outIndex = args.indexOf("--out");
  const out = outIndex >= 0 ? args[outIndex + 1] : undefined;
  const stopIndex = args.indexOf("--stop-at");
  const stopAt = stopIndex >= 0 ? Number(args[stopIndex + 1]) : 6;
  const asJson = args.includes("--json");

  const ledger: RungResult[] = [];
  let read: RungResult | null = null;

  for (const { rung, name } of RUNGS) {
    if (rung > stopAt) {
      ledger.push({ rung, name, outcome: "NOT_ATTEMPTED", detail: `--stop-at ${stopAt}` });
      continue;
    }
    if (read) {
      ledger.push({
        rung,
        name,
        outcome: "NOT_ATTEMPTED",
        detail: `rung ${read.rung} returned the document`,
      });
      continue;
    }
    const result =
      rung === 2 || rung === 3
        ? await walkHttp(url, rung === 2 ? "plain" : "browser")
        : rung === 4
          ? await walkCurl(url)
          : rung === 5
            ? await walkEgress(url)
            : await walkBrowser(url);
    ledger.push(result);
    if (result.outcome === "READ") read = result;
  }

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          url,
          walkedAt: new Date().toISOString(),
          ledger: ledger.map(({ text: _text, ...rest }) => rest),
        },
        null,
        2,
      ),
    );
  } else {
    console.log(`\nLADDER — ${url}\n`);
    for (const r of ledger) {
      const bits = [
        `  rung ${String(r.rung).padStart(2)}`,
        r.outcome.padEnd(14),
        r.name.padEnd(28),
        r.status ? `HTTP ${r.status}` : "",
        r.bytes !== undefined ? `${r.bytes} bytes` : "",
        r.detail ?? "",
      ];
      console.log(bits.filter(Boolean).join("  "));
    }
    console.log("");
  }

  if (!read) {
    console.error(
      "NOT READ — every rung attempted is recorded above. This is a WALL, and the " +
        "rungs above 6 (the page's own calls, the markup behind the prose, linked " +
        "documents, the archive, the vendor platform, the records request) are " +
        "still owed. It is NEVER an absence.",
    );
    process.exit(1);
  }

  if (out) {
    writeFileSync(out, read.text ?? "", "utf8");
    console.log(`  written  ${out}  (${read.bytes} bytes, from rung ${read.rung})`);
  }
}

await main();
