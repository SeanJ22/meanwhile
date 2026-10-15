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

import { factReader } from "../lib/facts/db.ts";
import { readFactRosters } from "../lib/facts/roster-read.ts";
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
    /*
     * **THE STATUS CODE IS ASKED FOR, BECAUSE A WALL IS NOT AN EMPTINESS.**
     * (2026-08-29, found while regenerating this report.)
     *
     * This rung used to be `curl -sL ...` and `return stdout.length > 0`. curl
     * prints the BODY of a refusal exactly as it prints the body of a page, so
     * a 403 came back as 5,591 bytes of denial HTML and became "the page" —
     * and every name on that roster was then reported DISAGREED, absent from a
     * document nobody had ever been allowed to read.
     *
     * Newbury Selectboard is the case: `www.newbury.nh.gov` answers this
     * script's own user-agent with a hard 403, and its three members were
     * accused of not being on their own town's page. The report was not even
     * reproducible run to run — the two earlier rungs sometimes get through, so
     * the same three people flipped between AGREED and DISAGREED between
     * consecutive runs of an instrument whose whole job is to be believed.
     *
     * `-w` appends the code on its own last line, so a refusal becomes
     * COULD_NOT_READ and is counted in its own column (RULING 24, RULING 114).
     * That is the constitution's own rule about the ladder, applied to the
     * instrument that checks the ladder's output: a failed retrieval is
     * reported as a failed retrieval, with the wall named.
     */
    const { stdout } = await run(
      "curl",
      ["-sL", "--max-time", "25", "-A", BROWSER_UA, "-w", "\n%{http_code}", url],
      { timeout: 40_000, maxBuffer: 24 * 1024 * 1024 },
    );
    const split = stdout.lastIndexOf("\n");
    if (split < 0) return null;
    const status = Number(stdout.slice(split + 1).trim());
    const body = stdout.slice(0, split);
    if (!Number.isFinite(status) || status < 200 || status >= 300) return null;
    return body.length > 0 ? body : null;
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

/**
 * **THE TEXT A CLIENT-RENDERED PAGE SERVES BUT DOES NOT YET SHOW.**
 * (2026-08-29, NH216.)
 *
 * `renderedText` strips `<script>`, which is right for CODE and wrong for
 * DATA. A Nuxt, Next or React page ships its content as a JSON payload inside a
 * `<script>` tag and paints it in the browser — so on those sites the stripping
 * throws away the entire page and leaves the chrome.
 *
 * That is what happened to Vail Unified. This verifier reported five of six
 * governing-board members ABSENT from the district's own board page and opened
 * NH216 against the roster. The roster was correct. **The instrument had
 * asserted an absence without having looked where the names were** — a plain
 * `fetch` has them, in the Apptegy payload, in the served HTML, at HTTP 200.
 *
 * That is the gravest failure available to a checking instrument in this
 * repository. A false DISAGREED is an accusation against a government's own
 * publication, and the constitution's rule is absolute: absence is never
 * asserted. RULING 193 says an instrument may rest its verdict only on evidence
 * it actually checked.
 *
 * ## Why JSON STRING LITERALS and not the whole script body
 *
 * Because searching raw script source would trade a false ABSENT for a false
 * PRESENT, which is the worse direction — a minified bundle contains enough
 * identifier fragments to "find" almost any surname, and a false agreement is
 * the defect surviving the check written to find it.
 *
 * A person's name in a hydration payload is a JSON STRING VALUE. Pulling only
 * quoted string literals keeps the data and discards the code.
 */
export function embeddedDataText(html: string): string {
  const scripts = html.match(/<script[\s\S]*?<\/script>/gi) ?? [];
  const strings: string[] = [];
  for (const block of scripts) {
    const body = block.replace(/^<script[^>]*>/i, "").replace(/<\/script>$/i, "");
    for (const literal of body.match(/"(?:[^"\\]|\\.)*"/g) ?? []) {
      strings.push(literal.slice(1, -1).replace(/\\u0026/gi, "&").replace(/\\"/g, '"'));
    }
  }
  return strings
    .join(" ")
    .replace(/\\n|\\t|\\r/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export type NameVerdict =
  | "AGREED"
  /**
   * On the page the government served, inside its client-rendering payload
   * rather than its static markup.
   *
   * **This is agreement, not a lesser form of it.** The district publishes the
   * name; a reader opening that URL sees it. It is reported separately only
   * because the DISTINCTION is a fact a session needs — it says the page is
   * client-rendered, which is what a future extractor has to handle — and never
   * because the name is in any doubt.
   */
  | "AGREED_IN_EMBEDDED_DATA"
  | "PARTIAL"
  | "DISAGREED";

/**
 * Is this extracted name on this page?
 *
 * Three states, never two. A surname present with the given name absent is a
 * real and different fact — it usually means the page changed the person's
 * preferred form rather than that we invented them — and reporting it as a
 * disagreement would send somebody hunting a roster that is broadly right.
 */
export function judgeName(name: string, text: string, embedded = ""): NameVerdict {
  const clean = name
    .toLowerCase()
    .replace(/\b(dr|mr|mrs|ms|hon|rev|sen|rep|jr|sr|ii|iii|iv)\b\.?/g, " ")
    .replace(/[^a-z\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return "DISAGREED";
  if (text.includes(clean)) return "AGREED";
  /*
   * The static markup does not say it. Before this may become an accusation
   * against the government's page, look in the payload the page ships to paint
   * itself — see `embeddedDataText`. NH216 was opened because this step did not
   * exist, and five correct names were reported absent from the page publishing
   * them.
   */
  if (embedded.includes(clean)) return "AGREED_IN_EMBEDDED_DATA";

  const parts = clean.split(" ").filter((p) => p.length > 1);
  if (parts.length === 0) return "DISAGREED";
  const surname = parts[parts.length - 1];
  const given = parts[0];
  /* PARTIAL is searched across BOTH views for the same reason: a half-match
     that exists only in the payload is still not an absence. */
  const both = embedded ? `${text} ${embedded}` : text;
  const hasSurname = both.includes(surname);
  const hasGiven = both.includes(given);
  if (hasSurname && hasGiven) {
    /* Both present, just not adjacent. Which VIEW they came from still matters:
       adjacent-in-neither but present-in-payload is a client-rendered page. */
    return text.includes(surname) && text.includes(given)
      ? "AGREED"
      : "AGREED_IN_EMBEDDED_DATA";
  }
  if (hasSurname || hasGiven) return "PARTIAL";
  return "DISAGREED";
}

interface RosterResult {
  readonly body: string;
  readonly url: string;
  readonly agreed: string[];
  /** Present in the payload the page ships to render itself. Still agreement. */
  readonly agreedInEmbeddedData: string[];
  readonly partial: string[];
  readonly disagreed: string[];
  readonly readable: boolean;
  readonly permission: string;
}

async function main(): Promise<void> {
  const facts = factReader();
  if (!facts) throw new Error("VERIFY REFUSED — set DATABASE_URL: the live rosters are facts in the reader database.");
  const rosters = (await readFactRosters(facts)).rosters;
  const limit = Number(arg("limit") ?? rosters.length);
  const stamp = today();

  if (rosters.length === 0) {
    /* RULING 159 — a denominator of zero is an ERROR, never a clean board. */
    throw new Error("VERIFY REFUSED — no live roster. A sweep with no denominator did not run.");
  }

  const results: RosterResult[] = [];
  let n = 0;

  for (const roster of rosters) {
    if (n >= limit) break;
    n += 1;
    const url = roster.sourceUrl;
    /* robots.txt is read and recorded on the result, never a refusal (owner decision 2026-09-25). */
    const perm = await judgeUrl(url);

    const html = await getPage(url);
    if (html === null) {
      results.push({
        body: roster.bodyName,
        url,
        agreed: [],
        agreedInEmbeddedData: [],
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
        agreedInEmbeddedData: [],
        partial: [],
        disagreed: [],
        readable: false,
        permission: "COULD_NOT_ASSERT — the source is a PDF and this reader reads HTML (ladder rung 9 owed)",
      });
      console.log(`  COULD NOT ASSERT  PDF source  ${roster.bodyName}`);
      continue;
    }

    const text = renderedText(html);
    /* The payload a client-rendered page ships to paint itself. Read BEFORE any
       name may be called absent - see embeddedDataText and NH216. */
    const embedded = embeddedDataText(html);
    const agreed: string[] = [];
    const agreedInEmbeddedData: string[] = [];
    const partial: string[] = [];
    const disagreed: string[] = [];
    for (const m of roster.members) {
      const v = judgeName(m.name, text, embedded);
      if (v === "AGREED") agreed.push(m.name);
      else if (v === "AGREED_IN_EMBEDDED_DATA") agreedInEmbeddedData.push(m.name);
      else if (v === "PARTIAL") partial.push(m.name);
      else disagreed.push(m.name);
    }
    results.push({ body: roster.bodyName, url, agreed, agreedInEmbeddedData, partial, disagreed, readable: true, permission: perm.verdict });
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
  const embeddedNames = readable.reduce((sum, r) => sum + r.agreedInEmbeddedData.length, 0);
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
    `| Rosters sampled | **${n} of ${rosters.length}** |`,
    `| Rosters read | ${readable.length} |`,
    `| Rosters unreadable or refused | ${results.length - readable.length} |`,
    `| **Rosters where every name AGREED** | **${bodiesClean} of ${readable.length}** |`,
    `| Names agreed | **${agreedNames}** |`,
    `| Names agreed ONLY in the page's client-render payload | ${embeddedNames} |`,
    `| Names PARTIAL (one of given/surname present) | ${partialNames} |`,
    `| Names DISAGREED (absent from the page) | **${disagreedNames}** |`,
    "",
    "**The client-render payload column exists because this instrument once produced a FALSE ABSENCE.** It",
    "reported five of Vail Unified's six governing-board members missing from the district's own board page and",
    "opened NH216 against the roster. The roster was right: the names ship in the page's Apptegy payload, which",
    "this reader was stripping along with the scripts. A name found there IS published by the government - the",
    "column is separate because it says the page is CLIENT-RENDERED, never because the name is in doubt.",
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
    /*
     * `In payload` is its own column rather than folded into `Agreed`, because
     * a reader of this table needs to see WHICH rosters sit on client-rendered
     * pages — that is the fact a future extractor has to handle. Folding it into
     * `Agreed` would hide it; leaving it out entirely made Vail read `0 agreed`
     * while five of its members were verified, which is how a corrected row
     * still looked like a broken one.
     */
    "| Body | Agreed | In payload | Partial | Disagreed | Names absent from the page | Source |",
    "|---|---|---|---|---|---|---|",
  ];
  for (const r of results) {
    if (!r.readable) {
      lines.push(`| ${r.body} | — | — | — | — | **could not read (${r.permission})** | ${r.url} |`);
      continue;
    }
    lines.push(
      `| ${r.body} | ${r.agreed.length} | ${r.agreedInEmbeddedData.length} | ${r.partial.length} | ` +
        `**${r.disagreed.length}** | ` +
        `${[...r.disagreed, ...r.partial.map((p) => `${p} (partial)`)].join("; ") || "—"} | ${r.url} |`,
    );
  }

  writeFileSync(join(ROOT, "docs", "extraction-verification.md"), `${lines.join("\n")}\n`, "utf8");
  console.log(`\n${lines.slice(10, 24).join("\n")}`);
  console.log("\nwrote docs/extraction-verification.md");
}

/*
 * GUARDED, BECAUSE A TEST IMPORTS THIS FILE. (2026-08-30.)
 *
 * `tests/verify-extraction-client-rendered.test.ts` imports `judgeName`,
 * `renderedText` and `embeddedDataText` from here, and an unguarded top-level
 * `main()` meant EVERY `pnpm test` fetched all 44 roster pages live and
 * rewrote `docs/extraction-verification.md` as a side effect — live calls in
 * tests, which `tests/fixtures/`'s own law forbids, and a measurement doc
 * whose date moved on every unrelated suite run. The same guard shape as
 * `scripts/production-integrity.mts`: run only when this file IS the entry
 * point, export quietly when it is merely imported.
 */
if (
  import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}` ||
  process.argv[1]?.endsWith("verify-extraction.mts")
) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
