/**
 * **Build the candidate statement corpus** — tracker D05.
 *
 * `pnpm candidates:fetch` → `data/candidates/corpus-2026.json`
 *
 * ## What it retrieves, and what it will not
 *
 * Only the links `data/ballot/candidate-links-2026.json` already holds, and
 * only because every one of those was fetched and read by a previous session
 * before it was recorded. D05's source rule is absolute: the person's own
 * site or their own filing, never an advocacy organisation, never an
 * endorsement site, never a news characterisation of what they said.
 *
 * ## Append-only, and why
 *
 * A page is stored per `contentHash`. An unchanged page is re-stamped, never
 * duplicated; a CHANGED page is appended beside its predecessor rather than
 * replacing it. A position that appeared on a campaign site in September and
 * vanished in October is the accountability half of this product, and it
 * exists only if the prior version was kept.
 *
 * ## A refusal is recorded, never rendered as silence
 *
 * A 403, a timeout, a stale URL — each lands in `failures` with the reason
 * and the date. "We tried and their site refused us" and "we have never
 * looked" are different facts and the surface says which.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  contentHashOf,
  extractHtmlText,
} from "../lib/meetings/agenda-documents.ts";
import { sourceUserAgent } from "../lib/sources/http.ts";
import { stripChromeHtml } from "../lib/text/boilerplate.ts";
import type {
  CandidateCorpus,
  CandidateDocument,
  CandidateSourceClass,
  CandidateUrlBasis,
} from "../lib/candidates/corpus.ts";
import { ballotPeople } from "./b14-coverage.mts";

/**
 * **The campaign's own one-line self-description** — B14's blurb rung.
 *
 * `og:description`, then `<meta name="description">`. A sentence the campaign
 * wrote to describe itself to a search engine is the campaign's words about
 * the campaign; a lead sentence WE picked out of a page would be an editorial
 * act attributed to a real person. Taking the one they authored for exactly
 * this purpose is not the same thing.
 */
function metaDescriptionOf(html: string): string | null {
  const patterns = [
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']{20,400})["']/i,
    /<meta[^>]+content=["']([^"']{20,400})["'][^>]+property=["']og:description["']/i,
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']{20,400})["']/i,
    /<meta[^>]+content=["']([^"']{20,400})["'][^>]+name=["']description["']/i,
  ];
  for (const pattern of patterns) {
    const m = pattern.exec(html);
    if (m) {
      const text = m[1]
        // Numeric references GENERICALLY. The named-entity list missed
        // `&#x27;` and Alexander Kolodin's description read
        // "AZ&#x27;s Chief of Elections" — markup reaching a reader, which
        // extractHtmlText already learned once and this copy had not.
        .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
        .replace(/&apos;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/\s+/g, " ")
        .trim();
      if (text.length >= 20) return text;
    }
  }
  return null;
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data", "candidates", "corpus-2026.json");
const LINKS = join(ROOT, "data", "ballot", "candidate-links-2026.json");

interface VerifiedLink {
  url: string;
  verification: string;
  attemptedAt: string;
}
const linkFile = JSON.parse(await readFile(LINKS, "utf8")) as {
  links: Record<string, { official: VerifiedLink | null; campaign: VerifiedLink | null }>;
};

let prior: CandidateCorpus | null = null;
try {
  prior = JSON.parse(await readFile(OUT, "utf8")) as CandidateCorpus;
} catch {
  prior = null;
}
const priorDocs = prior?.documents ?? [];
const priorHashes = new Set(priorDocs.map((d) => `${d.candidateKey}@${d.contentHash}`));

/** Every (candidate, url, class) this run will try. */
const targets: Array<{
  candidateKey: string;
  url: string;
  sourceClass: CandidateSourceClass;
  basis: CandidateUrlBasis;
}> = [];
for (const [candidateKey, entry] of Object.entries(linkFile.links)) {
  if (entry.official) {
    targets.push({
      candidateKey,
      url: entry.official.url,
      sourceClass: "OFFICIAL_SITE",
      basis: "HUNTED_AND_VERIFIED",
    });
  }
  if (entry.campaign) {
    targets.push({
      candidateKey,
      url: entry.campaign.url,
      sourceClass: "CAMPAIGN_SITE",
      basis: "HUNTED_AND_VERIFIED",
    });
  }
}

/*
 * B14, 2026-08-19 (g20): THE FILED URLs COUNT, and leaving them out was a
 * quiet inequality.
 *
 * A candidacy record carries `websiteUrl` — the site the candidate typed
 * into their own filing. A prior session hunted links for 42 candidates and
 * recorded those; the filed URLs were never retrieved from. That means the
 * candidates a session had time to hunt for got a corpus and the rest did
 * not, which is the information asymmetry the equal-effort rule exists to
 * catch, produced by our own scheduling rather than by anything about them.
 *
 * A filed URL is a WEAKER claim than a hunted one — nobody has confirmed the
 * page is theirs — so it carries `STATED_IN_FILING` and the surface can say
 * so. It is not treated as equivalent; it is simply not skipped.
 */
const alreadyTargeted = new Set(targets.map((t) => `${t.candidateKey}|${t.url}`));
for (const person of ballotPeople()) {
  const url = person.filedSiteUrl?.trim();
  if (!url || !/^https?:\/\//i.test(url)) continue;
  if (alreadyTargeted.has(`${person.key}|${url}`)) continue;
  if (targets.some((t) => t.candidateKey === person.key && t.url === url)) continue;
  targets.push({
    candidateKey: person.key,
    url,
    sourceClass: "CAMPAIGN_SITE",
    basis: "STATED_IN_FILING",
  });
}
const candidates = new Set(targets.map((t) => t.candidateKey));
console.log(
  `verified links to try: ${targets.length} across ${candidates.size} candidates`,
);

/**
 * **Ladder rung 11, wired in rather than walked by hand.**
 *
 * Two New Hampshire hosts — `governor.nh.gov` and `council.nh.gov` — refuse
 * this egress at rung 2, 3 AND 4: an identified User-Agent, a full browser
 * header set and a browser User-Agent through curl all take a 403 of the
 * same 377/422 bytes. That is not the Newbury wall (which curl walks
 * straight through); it is an egress-or-WAF refusal at the host.
 *
 * The Internet Archive holds those pages, and an archived copy of a
 * government's own page is the government's own published words with a date
 * attached. So the rung lives in the script: every wall that falls becomes a
 * rung, and one walked by hand costs the next session the same walk.
 *
 * A snapshot is recorded as what it is — the archive's URL, the archive's
 * timestamp — and never restamped as a fresh read of the live site.
 */
async function waybackFor(
  url: string,
): Promise<{ url: string; timestamp: string } | null> {
  try {
    const api = `https://archive.org/wayback/available?url=${encodeURIComponent(url.replace(/^https?:\/\//, ""))}`;
    const response = await fetch(api, {
      headers: { "User-Agent": sourceUserAgent() },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as {
      archived_snapshots?: { closest?: { available?: boolean; url?: string; timestamp?: string } };
    };
    const closest = body.archived_snapshots?.closest;
    if (!closest?.available || !closest.url || !closest.timestamp) return null;
    return { url: closest.url, timestamp: closest.timestamp };
  } catch {
    return null;
  }
}

/*
 * THE EXTRACTOR VERSION. Bump it when the extraction CHANGES what text a
 * page yields, never for an unrelated edit — the whole point is that a text
 * change carrying a new version number is our doing and a text change
 * carrying the same one is theirs.
 *
 * 1 — the original: extractHtmlText over the whole document (or its <main>).
 * 2 — F01-continued item 11 (2026-08-19): template chrome stripped first.
 */
const EXTRACTOR_VERSION = 2;

const documents: CandidateDocument[] = [...priorDocs];
const failures: CandidateCorpus["failures"] = [];
let added = 0;
let reextracted = 0;
let unchanged = 0;
let revised = 0;

for (const target of targets) {
  const attemptedAt = new Date().toISOString();
  try {
    const response = await fetch(target.url, {
      headers: { "User-Agent": sourceUserAgent() },
      redirect: "follow",
      signal: AbortSignal.timeout(25_000),
    });
    if (!response.ok) {
      // The live host refused. Rung 11 before this is recorded as a miss —
      // a wall is a reason to climb, not a reason to stop.
      const archived = await waybackFor(target.url);
      failures.push({
        candidateKey: target.candidateKey,
        documentUrl: target.url,
        reason: archived
          ? `HTTP ${response.status} ${response.statusText} at the live host; the Internet Archive holds ${archived.url} (${archived.timestamp})`
          : `HTTP ${response.status} ${response.statusText} at the live host; rungs 2, 3 and 4 refused and the Internet Archive returned no snapshot to this run`,
        attemptedAt,
      });
      console.log(
        `  MISS ${target.candidateKey} ${target.url} — HTTP ${response.status}` +
          (archived ? ` · archived at ${archived.timestamp}` : " · no archive snapshot this run"),
      );
      continue;
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    const contentType = response.headers.get("content-type") ?? "";
    const rawHtml = new TextDecoder().decode(bytes);
    const metaDescription = metaDescriptionOf(rawHtml);

    let text: string | null = null;
    let extraction: CandidateDocument["extraction"] = "html";
    let extractionNote: string | null = null;
    try {
      /*
       * F01-continued item 11.1, the STRUCTURAL half of the boilerplate test.
       *
       * `extractHtmlText` prefers `<main>` where a page declares one and takes
       * the whole document where it does not — so on a page with no `<main>`,
       * every navigation link, every footer address and every press-release
       * index rail was flattened into the text a candidate's issue positions
       * are searched over. That is how Analilia Mejia came to be credited with
       * "health care and prescription costs" on the strength of a Read More
       * rail. The strip runs FIRST, on every site, regardless of how many
       * pages of it are held.
       */
      text = extractHtmlText(stripChromeHtml(rawHtml));
      if (!text || text.length < 40) {
        // A page that extracts to almost nothing is a JS-rendered shell, and
        // recording it as text would make a false miss look like a search.
        extraction = "failed";
        extractionNote = `extracted ${text?.length ?? 0} characters — a rendered shell, not readable text`;
        text = null;
      }
    } catch (error) {
      extraction = "failed";
      extractionNote = String((error as Error)?.message ?? error);
    }

    /*
     * THE HASH IS OF THE EXTRACTED TEXT, NOT THE RAW BYTES, and that is a
     * correction made by running this twice five minutes apart.
     *
     * The byte hash reported 14 REVISIONS on the second run — pages whose
     * markup carries a nonce, a CSRF token or a build timestamp, changing on
     * every request while the words on them did not. Left alone, the corpus
     * would grow without bound and every run would print a revision count
     * that means nothing, which is worse than useless: a revised campaign
     * position is one of this product's real accountability signals, and a
     * signal that fires constantly cannot carry it.
     *
     * Hashing the text we actually searched makes a revision mean what the
     * word says: the words changed. An unreadable page falls back to the
     * bytes, because there is nothing else to compare.
     */
    const hash = contentHashOf(
      text ? new TextEncoder().encode(text) : bytes,
    );
    const id = `${target.candidateKey}@${hash}`;

    if (priorHashes.has(id)) {
      unchanged += 1;
      continue;
    }
    /*
     * F01-continued item 11: a hash change is only a REVISION when the same
     * extractor produced both sides of it. Stripping template chrome changed
     * every text in the file at once, and counting those as revisions would
     * have reported 59 campaigns changing their positions on a day none did —
     * destroying the signal by using it for something else.
     */
    const sameUrl = priorDocs.filter(
      (d) => d.candidateKey === target.candidateKey && d.documentUrl === target.url,
    );
    if (sameUrl.length > 0) {
      if (sameUrl.every((d) => (d.extractorVersion ?? 1) !== EXTRACTOR_VERSION)) {
        reextracted += 1;
      } else {
        revised += 1;
      }
    }

    documents.push({
      id,
      candidateKey: target.candidateKey,
      sourceClass: target.sourceClass,
      basis: target.basis,
      metaDescription,
      documentUrl: target.url,
      contentHash: hash,
      retrievedAt: attemptedAt,
      contentType,
      text,
      extraction,
      extractionNote,
      extractorVersion: EXTRACTOR_VERSION,
    });
    added += 1;
  } catch (error) {
    failures.push({
      candidateKey: target.candidateKey,
      documentUrl: target.url,
      reason: String((error as Error)?.message ?? error).slice(0, 200),
      attemptedAt,
    });
    console.log(`  MISS ${target.candidateKey} ${target.url} — ${String(error).slice(0, 80)}`);
  }
}

const readable = documents.filter((d) => d.text).length;
console.log("\n=== candidate corpus ===");
console.log(`  candidates with a verified link:   ${candidates.size}`);
console.log(`  urls attempted:                    ${targets.length}`);
console.log(`  documents added this run:          ${added}`);
console.log(`    of those, a revision of a page we already held: ${revised}`);
console.log(
  `    of those, a RE-EXTRACTION of a page we already held: ${reextracted}` +
    ` (our extractor changed, not their page — extractor v${EXTRACTOR_VERSION})`,
);
console.log(`  unchanged (same contentHash):      ${unchanged}`);
console.log(`  retrieval failures:                ${failures.length}`);
console.log(`  documents in the corpus:           ${documents.length}`);
console.log(`    of those, readable:              ${readable}`);
console.log(
  `    of those, unreadable (a shell or a failed extraction): ${documents.length - readable}`,
);

if (documents.length === 0) {
  console.error("candidate corpus: zero documents — refusing to write an empty corpus.");
  process.exit(1);
}

const corpus: CandidateCorpus = {
  formatVersion: 1,
  fetchedAt: new Date().toISOString(),
  attempted: targets.length,
  documents: documents.sort((a, b) => a.id.localeCompare(b.id)),
  failures,
};

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, `${JSON.stringify(corpus, null, 1)}\n`);
console.log(`\n  wrote ${OUT}`);
