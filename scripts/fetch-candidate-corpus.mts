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
import type {
  CandidateCorpus,
  CandidateDocument,
  CandidateSourceClass,
} from "../lib/candidates/corpus.ts";

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
}> = [];
for (const [candidateKey, entry] of Object.entries(linkFile.links)) {
  if (entry.official) {
    targets.push({ candidateKey, url: entry.official.url, sourceClass: "OFFICIAL_SITE" });
  }
  if (entry.campaign) {
    targets.push({ candidateKey, url: entry.campaign.url, sourceClass: "CAMPAIGN_SITE" });
  }
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

const documents: CandidateDocument[] = [...priorDocs];
const failures: CandidateCorpus["failures"] = [];
let added = 0;
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

    let text: string | null = null;
    let extraction: CandidateDocument["extraction"] = "html";
    let extractionNote: string | null = null;
    try {
      text = extractHtmlText(new TextDecoder().decode(bytes));
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
    const hadOther = priorDocs.some(
      (d) => d.candidateKey === target.candidateKey && d.documentUrl === target.url,
    );
    if (hadOther) revised += 1;

    documents.push({
      id,
      candidateKey: target.candidateKey,
      sourceClass: target.sourceClass,
      documentUrl: target.url,
      contentHash: hash,
      retrievedAt: attemptedAt,
      contentType,
      text,
      extraction,
      extractionNote,
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
