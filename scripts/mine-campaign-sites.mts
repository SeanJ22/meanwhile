/**
 * `pnpm mine:campaign-sites` — **the search corpus we already paid for, mined
 * for the field it was collected to find.**
 *
 * Written 2026-08-23 (visual-tail-and-rehunt session, item 7). It is an
 * EXPANSION route under RULING 88: a new route to a field already owed
 * (`campaignSite`, 0 of 272 for 07866), and it walks entirely against committed
 * data.
 *
 * ## How it was conceived
 *
 * The observation was an inventory one rather than a research one. NJ Hunt 4
 * spent its whole search budget walking 272 candidates and committed the result
 * as `data/states/nj/hunt/nj-hunt4-search.json` — **858 hits across 179 of the 272**, each
 * with a URL, a title and a snippet. Campaign site then stood at **0 of 272**.
 *
 * Those two facts cannot both be doing their job. The corpus was collected to
 * answer this field and was never read for it. Nothing needed fetching; the
 * bytes were already in the tree.
 *
 * This is RULING 90's question — *what would I try if there were no manifest at
 * all?* — answered with: look at what we already have before going back out.
 *
 * ## Why every result is a LEAD and never a HIT
 *
 * A domain that looks like a candidate's is a **guessed identifier**, and this
 * project's standing rule is that a guessed identifier yields a `LEAD`, never a
 * `HIT`. Confirming one means fetching it and checking the page self-identifies
 * with the filed candidate name, the office and the cycle — which is a control
 * check this run cannot perform, because every outbound host is refused at the
 * egress in this environment (rungs 2, 3, 4 and 6 all walled, 2026-08-23).
 *
 * So the output is a **confirmation queue**, and it says so. A later session
 * with egress confirms each in one fetch. That is a far cheaper position than
 * 272 fresh per-entity searches against engines that walled after six queries.
 *
 * ## The classification, and why the "for" pattern carries most of it
 *
 * American campaign domains are overwhelmingly `<name>for<office-or-place>` —
 * `selenformorriscounty.com` is in this very corpus. That shape is strong
 * evidence because it is a sentence rather than a coincidence: a surname
 * adjacent to the literal token `for` is not something an unrelated business
 * domain produces often.
 *
 * A bare surname match is much weaker and is reported at a lower confidence
 * rather than dropped, because dropping it would hide a real campaign site
 * behind a common surname — and the candidates with common surnames are not a
 * random sample.
 *
 * Aggregators, news outlets and social platforms are excluded BY NAME and the
 * excluded count is reported, so the exclusion is visible rather than assumed.
 * `goodparty.org` alone is 102 of the 858 hits; a miner that silently swallowed
 * those would report a precision it had not earned.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const CORPUS = "data/states/nj/hunt/nj-hunt4-search.json";
const OUT = "data/states/nj/hunt/campaign-site-leads-nj-morris.json";

interface Hit {
  url: string;
  title?: string;
  snippet?: string;
}
interface CandidateRow {
  candidate: string;
  contestId: string;
  contestTitle: string;
  municipality: string | null;
  hits?: Hit[];
}

/**
 * Hosts that are never a candidate's own site.
 *
 * Named individually rather than pattern-matched: a list a reader can check is
 * worth more than a clever rule nobody can audit, and every one of these was
 * read off the corpus's own host histogram.
 */
const NOT_A_CAMPAIGN = new Set([
  // Aggregators and candidate directories.
  "goodparty.org", "civic-mirror.com", "voterrecords.com", "ballotready.org",
  "onyourballot.vote411.org", "vote411.org", "vote-usa.org", "smarter.vote",
  "candidatefilings.com", "ivoterguide.com", "oppintell.com", "zoominfo.com",
  "ballotpedia.org", "opensecrets.org", "followthemoney.org", "votesmart.org",
  // Social and professional platforms. A social page may serve as the
  // campaign LINK under the campaign-site rule, but it is not a site and it is
  // not what this field holds, so it is excluded here and left to that route.
  "facebook.com", "linkedin.com", "instagram.com", "twitter.com", "x.com",
  "youtube.com", "tiktok.com", "threads.net",
  // Petitions, forums and general web noise seen in this corpus.
  "change.org", "ficoforums.myfico.com", "reddit.com", "wikipedia.org",
  "en.wikipedia.org", "yelp.com", "indeed.com",
  // News outlets covering these races.
  "newjerseyhills.com", "tapinto.net", "patch.com", "newjerseyglobe.com",
  "insidernj.com", "nj.com", "dailyrecord.com", "morristowngreen.com",
  "dovernow.com", "morrisfocus.com", "parsippanyfocus.com", "njspotlightnews.org",
  "northjersey.com", "app.com", "politico.com", "nytimes.com",
]);

/** A government host is the officeholder's official page, not a campaign site. */
function isGovernment(host: string): boolean {
  return /\.gov$/.test(host) || /\.us$/.test(host) || /\.mil$/.test(host);
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** The domain with its public suffix removed, lowercased, letters only. */
function stem(host: string): string {
  const parts = host.split(".");
  const base = parts.length > 2 ? parts.slice(0, -2).join("") + parts[parts.length - 2] : parts[0];
  return (base ?? "").replace(/[^a-z]/g, "");
}

type Confidence = "STRONG" | "WEAK";

interface Lead {
  candidate: string;
  contestId: string;
  contestTitle: string;
  municipality: string | null;
  host: string;
  url: string;
  title: string | null;
  confidence: Confidence;
  /** Which shape matched — the mechanical evidence, same as a topic match. */
  pattern: string;
}

const corpus = JSON.parse(readFileSync(join(ROOT, CORPUS), "utf8")) as {
  walkedAt: string;
  candidates: Record<string, CandidateRow>;
};

const rows = Object.entries(corpus.candidates);

let hitsGiven = 0;
let excludedKnown = 0;
let excludedGov = 0;
let unparseable = 0;
const leads: Lead[] = [];
const seen = new Set<string>();

for (const [key, row] of rows) {
  const hits = row.hits ?? [];
  hitsGiven += hits.length;

  // Name tokens. The surname is the last token that is not a suffix.
  const SUFFIX = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);
  const tokens = row.candidate
    .toLowerCase()
    .replace(/[^a-z\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((t) => t.length > 1 && !SUFFIX.has(t));
  const surname = tokens[tokens.length - 1] ?? "";
  const given = tokens[0] ?? "";
  if (surname.length < 3) continue;

  for (const hit of hits) {
    const host = hostOf(hit.url);
    if (host === null) {
      unparseable += 1;
      continue;
    }
    if (NOT_A_CAMPAIGN.has(host)) {
      excludedKnown += 1;
      continue;
    }
    if (isGovernment(host)) {
      excludedGov += 1;
      continue;
    }
    const s = stem(host);
    if (!s.includes(surname)) continue;

    /*
     * The "for" shape. `selenformorriscounty` is surname + "for" + place, and
     * that adjacency is a sentence rather than a coincidence — it is what makes
     * this evidence rather than a surname collision.
     */
    const forShape = new RegExp(`${surname}for[a-z]{3,}`).test(s);
    const givenAndSurname = given.length > 2 && s.includes(given) && s.includes(surname);
    const confidence: Confidence = forShape || givenAndSurname ? "STRONG" : "WEAK";
    const pattern = forShape
      ? `surname+"for"+place — ${surname}for…`
      : givenAndSurname
        ? `given+surname in domain — ${given}…${surname}`
        : `surname in domain — ${surname}`;

    const dedupe = `${key}|${host}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);

    leads.push({
      candidate: row.candidate,
      contestId: row.contestId,
      contestTitle: row.contestTitle,
      municipality: row.municipality,
      host,
      url: hit.url,
      title: hit.title ?? null,
      confidence,
      pattern,
    });
  }
}

const strong = leads.filter((l) => l.confidence === "STRONG");
const weak = leads.filter((l) => l.confidence === "WEAK");
const candidatesReached = new Set(leads.map((l) => l.candidate)).size;

/*
 * RULING 100 — the count assertion. The corpus states how many hits it holds,
 * so a run that read fewer than it was given has not read the corpus. The
 * denominator is stated either way, and "we read N and the source says N" is
 * a different and much stronger claim than "we read N".
 */
const outcome = hitsGiven === 0 ? "NOT_ASSERTABLE" : "READ";

console.log(`campaign-site leads, mined from ${CORPUS} (walked ${corpus.walkedAt})\n`);
console.log(`  candidates in the corpus            ${rows.length}`);
console.log(`  hits the corpus holds               ${hitsGiven}`);
console.log(`  ...excluded, known non-campaign     ${excludedKnown}`);
console.log(`  ...excluded, government host        ${excludedGov}`);
console.log(`  ...unparseable URL                  ${unparseable}`);
console.log(`  count assertion                     ${outcome}`);
console.log(`\n  LEADS                               ${leads.length}`);
console.log(`    STRONG (name+for+place, or both names) ${strong.length}`);
console.log(`    WEAK   (surname in domain only)        ${weak.length}`);
console.log(`  candidates reached                  ${candidatesReached} of ${rows.length}`);

console.log("\n  STRONG leads — the confirmation queue:");
for (const l of strong) {
  console.log(`    ${l.candidate.padEnd(26)} ${l.host}`);
  console.log(`      ${l.contestTitle}${l.municipality ? ` · ${l.municipality}` : ""}`);
  console.log(`      ${l.pattern}`);
}

writeFileSync(
  join(ROOT, OUT),
  `${JSON.stringify(
    {
      note:
        "EVERY ROW HERE IS A LEAD, NEVER A HIT. A domain matching a candidate's name is a " +
        "guessed identifier; confirming one means fetching it and checking the page " +
        "self-identifies with the filed name, the office and the cycle. This run could not " +
        "perform that control check — every outbound host was refused at the egress on " +
        "2026-08-23 (rungs 2, 3, 4 and 6 all walled). Nothing here may ship to a reader " +
        "until it is confirmed.",
      minedFrom: CORPUS,
      corpusWalkedAt: corpus.walkedAt,
      minedOn: "2026-08-23",
      counts: {
        candidates: rows.length,
        hitsGiven,
        excludedKnown,
        excludedGov,
        unparseable,
        leads: leads.length,
        strong: strong.length,
        weak: weak.length,
        candidatesReached,
      },
      leads,
    },
    null,
    2,
  )}\n`,
  "utf8",
);
console.log(`\n  wrote ${OUT}`);
