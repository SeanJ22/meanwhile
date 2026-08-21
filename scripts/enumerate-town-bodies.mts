/**
 * **WHAT BODIES DOES THIS TOWN HAVE?** (built 2026-08-21, NH Hunt 2 item 3.)
 *
 * ```
 * pnpm bodies:enumerate <town-site-url> [<url> …] [--json]
 * ```
 *
 * The gap ledger measures coverage against an OUTSIDE denominator — the Census
 * of Governments and NCES — and that denominator counts GOVERNMENTS. RULING 9:
 * a New Hampshire town is ONE government and a dozen or more BODIES, and the
 * product renders bodies. So the per-town denominator has to come from the
 * town itself, and reading it out of seven town websites by hand is how six of
 * the seven Kearsarge member towns ended up with no bodies in this registry at
 * all.
 *
 * This reads a town site and reports the BOARDS, COMMITTEES AND COMMISSIONS it
 * links to, with the URL of each. That is a candidate list a session judges,
 * never a registry write — a link labelled "Planning Board" is strong evidence
 * and a link labelled "Board of Selectmen Minutes" is a document, and telling
 * those apart is a person's job.
 *
 * ## How it finds them, and why it is a LIST OF LINKS rather than a parse
 *
 * New Hampshire town sites are a handful of CMS families — VTS/Drupal 7,
 * CivicPlus, Revize, Squarespace, and a long tail of hand-built pages — and
 * every one of them puts its boards in a differently-shaped menu. What they all
 * do is LINK to each body's own page with the body's name as the anchor text.
 * So the contract here is the anchor, not the markup: every link whose text
 * names a governing body shape is reported with its href.
 *
 * The vocabulary is deliberately generous and the false positives are left IN.
 * A missed body is invisible; a wrongly-included link is one line a session
 * reads and discards. Under-reporting is the failure that costs something.
 *
 * ## The ladder
 *
 * It reads through the same rungs as everything else in this hunt — plain
 * fetch, then `curl`, then a different egress — and it PRINTS THE RUNG, because
 * five of the six towns this was built for have moved to `.gov` domains and
 * the redirect is itself a finding a session needs to see.
 *
 * A page that reads at 200 and yields ZERO body-shaped links is reported as
 * `ZERO_ROWS` with the count of links it did see, never as a town with no
 * boards. That is the extraction contract every layer in this repo follows.
 */
import { challengeIn, sourceUserAgent } from "../lib/sources/http.ts";
import { EGRESS_SPACING_MS, readViaEgress } from "../lib/hunt/egress.ts";

/**
 * The shapes a New Hampshire governing body's name takes.
 *
 * `selectboard` and `select board` are both live in New Hampshire and so is
 * `board of selectmen`; a town that uses one never uses the others, and a
 * vocabulary missing any of the three would silently skip that town's
 * governing body — the one body it is least acceptable to miss.
 */
const BODY_WORDS = [
  "selectboard",
  "select board",
  "selectmen",
  "planning board",
  "zoning board",
  "board of adjustment",
  "conservation commission",
  "budget committee",
  "advisory budget",
  "library trustees",
  "trustees of the trust funds",
  "trust funds",
  "cemetery trustees",
  "supervisors of the checklist",
  "recreation commission",
  "recreation committee",
  "parks and recreation",
  "parks & recreation",
  "energy committee",
  "heritage commission",
  "historic district commission",
  "historical commission",
  "agricultural commission",
  "economic development committee",
  "capital improvement",
  "board of assessors",
  "assessing board",
  "water commission",
  "sewer commission",
  "solid waste committee",
  "transfer station committee",
  "housing committee",
  "joint loss management",
  "safety committee",
  "master plan committee",
  "board of health",
  "welfare",
  "board of fire",
  "commission",
  "committee",
  "board",
];

/** Words that mean the link is a DOCUMENT about a body rather than the body. */
const DOCUMENT_WORDS = [
  "minutes",
  "agenda",
  "packet",
  "warrant",
  "ordinance",
  "regulation",
  "application",
  "form",
  ".pdf",
  "archive",
  "notice",
];

interface Found {
  text: string;
  url: string;
  looksLikeDocument: boolean;
}

function decode(v: string): string {
  return v
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function read(url: string): Promise<{ html: string; rung: number; finalUrl: string; status: number }> {
  const plain = await fetch(url, {
    headers: { "User-Agent": sourceUserAgent(), Accept: "text/html,*/*" },
    signal: AbortSignal.timeout(45_000),
  }).catch(() => null);
  if (plain?.ok) {
    const html = await plain.text();
    if (!challengeIn(html)) return { html, rung: 2, finalUrl: plain.url, status: plain.status };
  }

  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  try {
    const { stdout } = await run(
      "curl",
      ["-sSL", "--max-time", "60", "-A", sourceUserAgent(), "-w", "\n__WTP__%{http_code}__%{url_effective}", url],
      { maxBuffer: 64 * 1024 * 1024 },
    );
    const cut = stdout.lastIndexOf("\n__WTP__");
    const html = cut < 0 ? stdout : stdout.slice(0, cut);
    const [code, effective] = (cut < 0 ? "" : stdout.slice(cut + 8)).split("__");
    const status = Number(code) || 0;
    if (status < 400 && !challengeIn(html))
      return { html, rung: 4, finalUrl: effective?.trim() || url, status };
  } catch {
    /* fall through */
  }

  await new Promise((r) => setTimeout(r, EGRESS_SPACING_MS));
  const relayed = await readViaEgress(url);
  return { html: relayed.text, rung: 5, finalUrl: relayed.url, status: relayed.status };
}

export function bodyLinksIn(html: string, base: string): { found: Found[]; totalLinks: number } {
  const anchors = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  const seen = new Set<string>();
  const found: Found[] = [];
  for (const a of anchors) {
    const text = decode(a[2]!);
    if (!text || text.length > 90) continue;
    const lower = text.toLowerCase();
    if (!BODY_WORDS.some((w) => lower.includes(w))) continue;
    let url: string;
    try {
      url = new URL(a[1]!, base).toString();
    } catch {
      continue;
    }
    const key = `${lower}|${url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({
      text,
      url,
      looksLikeDocument:
        DOCUMENT_WORDS.some((w) => lower.includes(w)) ||
        DOCUMENT_WORDS.some((w) => url.toLowerCase().includes(w)),
    });
  }
  return { found, totalLinks: anchors.length };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const urls = args.filter((a) => !a.startsWith("--"));
  const asJson = args.includes("--json");
  if (!urls.length) {
    console.error("usage: pnpm bodies:enumerate <town-site-url> [<url> …] [--json]");
    process.exit(2);
  }

  const report: Record<string, unknown>[] = [];
  for (const url of urls) {
    try {
      const { html, rung, finalUrl, status } = await read(url);
      const { found, totalLinks } = bodyLinksIn(html, finalUrl);
      const bodies = found.filter((f) => !f.looksLikeDocument);
      report.push({ url, finalUrl, status, rung, totalLinks, bodies: bodies.length, found });
      if (!asJson) {
        console.log(`\n=== ${url}`);
        console.log(
          `    HTTP ${status} via rung ${rung} -> ${finalUrl}` +
            (finalUrl.replace(/\/$/, "") !== url.replace(/\/$/, "") ? "   [REDIRECTED — the link we hold is stale]" : ""),
        );
        if (!found.length) {
          console.log(
            `    ZERO_ROWS — ${totalLinks} links on the page and none names a body shape. ` +
              "That is a fact about THIS PAGE, not about the town: the boards index is " +
              "somewhere else, or behind a script. The next rung is owed.",
          );
          continue;
        }
        console.log(`    ${bodies.length} body-shaped link(s) of ${totalLinks} links on the page:`);
        for (const f of bodies) console.log(`      ${f.text.padEnd(46)} ${f.url}`);
        const docs = found.filter((f) => f.looksLikeDocument);
        if (docs.length) console.log(`    (${docs.length} more matched but look like documents, not bodies)`);
      }
    } catch (error) {
      report.push({ url, error: (error as Error).message });
      if (!asJson) console.log(`\n=== ${url}\n    NOT READ — ${(error as Error).message}`);
    }
  }
  if (asJson) console.log(JSON.stringify(report, null, 2));
  else console.log("");
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, "/")}`) await main();
