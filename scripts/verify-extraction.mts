import { fetchSource } from "../lib/sources/fetch-source.ts";
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

async function getPage(url: string): Promise<string | null> {
  try {
    const response = await fetchSource(url, { headers: { accept: "text/html" }, signal: AbortSignal.timeout(25_000) });
    return response.ok ? response.text() : null;
  } catch { return null; }
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

  | "AGREED_IN_EMBEDDED_DATA"
  | "PARTIAL"
  | "DISAGREED";


export function judgeName(name: string, text: string, embedded = ""): NameVerdict {
  const clean = name
    .toLowerCase()
    .replace(/\b(dr|mr|mrs|ms|hon|rev|sen|rep|jr|sr|ii|iii|iv)\b\.?/g, " ")
    .replace(/[^a-z\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return "DISAGREED";
  if (text.includes(clean)) return "AGREED";

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


if (
  import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}` ||
  process.argv[1]?.endsWith("verify-extraction.mts")
) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
