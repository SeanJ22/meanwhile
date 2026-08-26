/**
 * `pnpm verify:extraction` — DOES THE PAGE STILL SAY WHAT WE EXTRACTED?
 * (2026-08-26, the descent session, Item 7b. **The first measurement of its
 * kind in this project's history.**)
 *
 * ## The defect no existing check can catch
 *
 * A silently failed extraction leaves a PLAUSIBLE VALUE behind. The Carruth
 * case is the shape: the district published the name six times on a page
 * fetched at HTTP 200, and the extractor read a news blurb instead. Every
 * instrument in this repo asks *did something come back* — and something did.
 *
 * RULING 100 named this one floor up: *a total that reconciles is not a total
 * that is correct.* This is that reasoning pointed at a ROSTER: a name in our
 * store, a page on the body's own site, and until today **nothing had ever
 * compared the two — 0 of 42.**
 *
 * ## What agreement means, and why it is deliberately generous
 *
 * A name AGREES when it appears in the page's rendered text. The comparison is
 * over normalised text with markup stripped, because a name split across
 * `<strong>Ravi</strong> Shah` is the same name to a reader and the failure this
 * hunts is a name that is not there AT ALL.
 *
 * **Generous on purpose.** A false disagreement sends a session to re-hunt a
 * roster that is fine; a false agreement is the defect surviving the check
 * written to find it. So a partial match — surname present, given name absent —
 * is reported as its OWN state rather than folded into either column. RULING
 * 100's second half: *we read four and the page never said how many there
 * should be* is a different claim from *we read four and the page says four*.
 *
 * ## Fail closed
 *
 * A page that cannot be read is `COULD_NOT_READ` and is counted SEPARATELY
 * (RULING 24, RULING 114). Folding it into agreement would report confidence
 * never measured; folding it into disagreement would raise a false alarm about
 * a roster nobody has any evidence against.
 *
 * Usage:
 *   pnpm verify:extraction
 *   pnpm verify:extraction --limit 12
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { BODY_ROSTERS } from "../lib/registry/body-rosters.ts";
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
      const res = await fetch(url, { headers, redirect: "follow", signal: AbortSignal.timeout(25_000) });
      if (res.ok) return await res.text();
    } catch {
      /* next rung */
    }
  }
  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const run = promisify(execFile);
    const { stdout } = await run("curl", ["-sL", "--max-time", "25", "-A", BROWSER_UA, url], {
      timeout: 40_000,
      maxBuffer: 24 * 1024 * 1024,
    });
    return stdout.length > 0 ? stdout : null;
  } catch {
    return null;
  }
}

/** Rendered text, as close as a fetch gets to what a reader sees. */
export function renderedText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&rsquo;|&apos;/gi, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/gi, '"')
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export type NameVerdict = "AGREED" | "PARTIAL" | "DISAGREED";

/**
 * Is this extracted name on this page?
 *
 * Three states, never two. A surname present with the given name absent is a
 * real and different fact — it usually means the page changed the person's
 * preferred form rather than that we invented them — and reporting it as a
 * disagreement would send somebody hunting a roster that is broadly right.
 */
export function judgeName(name: string, text: string): NameVerdict {
  const clean = name
    .toLowerCase()
    .replace(/\b(dr|mr|mrs|ms|hon|rev|sen|rep|jr|sr|ii|iii|iv)\b\.?/g, " ")
    .replace(/[^a-z\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return "DISAGREED";
  if (text.includes(clean)) return "AGREED";

  const parts = clean.split(" ").filter((p) => p.length > 1);
  if (parts.length === 0) return "DISAGREED";
  const surname = parts[parts.length - 1];
  const given = parts[0];
  const hasSurname = text.includes(surname);
  const hasGiven = text.includes(given);
  if (hasSurname && hasGiven) return "AGREED"; // both present, just not adjacent
  if (hasSurname || hasGiven) return "PARTIAL";
  return "DISAGREED";
}

interface RosterResult {
  readonly body: string;
  readonly url: string;
  readonly agreed: string[];
  readonly partial: string[];
  readonly disagreed: string[];
  readonly readable: boolean;
  readonly permission: string;
}

async function main(): Promise<void> {
  const limit = Number(arg("limit") ?? BODY_ROSTERS.length);
  const stamp = today();

  if (BODY_ROSTERS.length === 0) {
    /* RULING 159 — a denominator of zero is an ERROR, never a clean board. */
    throw new Error("VERIFY REFUSED — BODY_ROSTERS is empty. A sweep with no denominator did not run.");
  }

  const results: RosterResult[] = [];
  let n = 0;

  for (const roster of BODY_ROSTERS) {
    if (n >= limit) break;
    n += 1;
    const url = roster.sourceUrl;
    const perm = await judgeUrl(url);
    if (perm.verdict !== "ALLOWED" && perm.verdict !== "NO_ROBOTS") {
      results.push({
        body: roster.bodyName,
        url,
        agreed: [],
        partial: [],
        disagreed: [],
        readable: false,
        permission: perm.verdict,
      });
      console.log(`  REFUSED  ${perm.verdict.padEnd(12)} ${roster.bodyName}`);
      continue;
    }

    const html = await getPage(url);
    if (html === null) {
      results.push({
        body: roster.bodyName,
        url,
        agreed: [],
        partial: [],
        disagreed: [],
        readable: false,
        permission: "UNREACHABLE",
      });
      console.log(`  COULD NOT READ            ${roster.bodyName}  ${url}`);
      continue;
    }

    /*
     * A PDF IS NOT A DISAGREEMENT — it is a question this reader cannot ask.
     * (Found 2026-08-26 on the first run, and corrected before the number was
     * reported.)
     *
     * Merrimack County's Board of Commissioners roster is sourced from
     * `Final Annual Report 2025.pdf`. This reader strips HTML tags; handed a
     * PDF's bytes it produces noise, and all three commissioners came back
     * **DISAGREED** — an accusation against a roster there is no evidence
     * against, produced by an instrument being asked the wrong question.
     *
     * RULING 100's second state exactly: *we could not assert a count* is a
     * distinct, named, reportable outcome and never a silent pass — and here
     * never a silent FAILURE either, which is the same error pointed the other
     * way. Rung 9 says PDFs ARE data and text-layer extraction is owed; that is
     * real work and it is a tracker row, not something to fake here.
     */
    if (/^%PDF-/.test(html.slice(0, 8)) || /\.pdf(\?|$)/i.test(url)) {
      results.push({
        body: roster.bodyName,
        url,
        agreed: [],
        partial: [],
        disagreed: [],
        readable: false,
        permission: "COULD_NOT_ASSERT — the source is a PDF and this reader reads HTML (ladder rung 9 owed)",
      });
      console.log(`  COULD NOT ASSERT  PDF source  ${roster.bodyName}`);
      continue;
    }

    const text = renderedText(html);
    const agreed: string[] = [];
    const partial: string[] = [];
    const disagreed: string[] = [];
    for (const m of roster.members) {
      const v = judgeName(m.name, text);
      if (v === "AGREED") agreed.push(m.name);
      else if (v === "PARTIAL") partial.push(m.name);
      else disagreed.push(m.name);
    }
    results.push({ body: roster.bodyName, url, agreed, partial, disagreed, readable: true, permission: perm.verdict });
    console.log(
      `  ${disagreed.length === 0 ? "AGREES  " : "DISAGREES"} ${String(agreed.length).padStart(2)}/${String(
        roster.members.length,
      ).padStart(2)}  ${roster.bodyName}${disagreed.length ? `  MISSING: ${disagreed.join(", ")}` : ""}`,
    );
  }

  const readable = results.filter((r) => r.readable);
  const agreedNames = readable.reduce((s, r) => s + r.agreed.length, 0);
  const partialNames = readable.reduce((s, r) => s + r.partial.length, 0);
  const disagreedNames = readable.reduce((s, r) => s + r.disagreed.length, 0);
  const bodiesClean = readable.filter((r) => r.disagreed.length === 0 && r.partial.length === 0).length;

  const lines: string[] = [
    "# Extraction, verified against rendered content",
    "",
    `**Measured ${stamp}** by \`pnpm verify:extraction\`.`,
    "",
    "**THIS IS THE FIRST MEASUREMENT OF ITS KIND IN THIS PROJECT.** Before today, extraction had never been",
    "verified against rendered content for any body — **0 of 42**. A silently failed extraction leaves a",
    "plausible value behind, so no existing check could catch it: every instrument here asks *did something",
    "come back*, and something did. The Carruth case is the shape — a district published a name six times on",
    "a page fetched at HTTP 200, and the extractor read a news blurb instead.",
    "",
    "## The numbers",
    "",
    "| | Count |",
    "|---|---|",
    `| Rosters sampled | **${n} of ${BODY_ROSTERS.length}** |`,
    `| Rosters read | ${readable.length} |`,
    `| Rosters unreadable or refused | ${results.length - readable.length} |`,
    `| **Rosters where every name AGREED** | **${bodiesClean} of ${readable.length}** |`,
    `| Names agreed | **${agreedNames}** |`,
    `| Names PARTIAL (one of given/surname present) | ${partialNames} |`,
    `| Names DISAGREED (absent from the page) | **${disagreedNames}** |`,
    "",
    "**`PARTIAL` is its own column on purpose.** A surname present with the given name absent usually means",
    "the page changed a person's preferred form, not that we invented them — and folding it into either",
    "neighbouring column would either raise a false alarm or hide a real one (RULING 100).",
    "",
    "**Unreadable is counted SEPARATELY** (RULING 24). Folding it into agreement would report confidence",
    "never measured; folding it into disagreement would accuse a roster nothing has evidence against.",
    "",
    "## Every roster",
    "",
    "| Body | Agreed | Partial | Disagreed | Names absent from the page | Source |",
    "|---|---|---|---|---|---|",
  ];
  for (const r of results) {
    if (!r.readable) {
      lines.push(`| ${r.body} | — | — | — | **could not read (${r.permission})** | ${r.url} |`);
      continue;
    }
    lines.push(
      `| ${r.body} | ${r.agreed.length} | ${r.partial.length} | **${r.disagreed.length}** | ` +
        `${[...r.disagreed, ...r.partial.map((p) => `${p} (partial)`)].join("; ") || "—"} | ${r.url} |`,
    );
  }

  writeFileSync(join(ROOT, "docs", "extraction-verification.md"), `${lines.join("\n")}\n`, "utf8");
  console.log(`\n${lines.slice(10, 24).join("\n")}`);
  console.log("\nwrote docs/extraction-verification.md");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
