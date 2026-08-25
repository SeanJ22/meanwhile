#!/usr/bin/env tsx
/**
 * @freshness-reads-here
 *
 * RULING 107 — every clock stamp in this file is minted by the code path that
 * performs the read. `attemptedAt` and `walkedAt` are taken in the same run
 * that fetched the page they describe, which is what the ruling asks for rather
 * than what it forbids: a READ stamp from evidence of a read, never a RUN stamp
 * written into a freshness field. Declared rather than inferred, because a
 * carve-out nobody has to write down is a carve-out that grows.
 */
/**
 * **ADJUDICATE THE HELD LEADS — the final pass, 2026-08-25, item 3.**
 *
 * ```
 * pnpm leads:adjudicate                     # walk and report, write nothing
 * pnpm leads:adjudicate --write             # record the adjudication
 * pnpm leads:adjudicate --zip=07866         # the ballot to adjudicate against
 * pnpm leads:adjudicate --limit=40          # stop after N hosts, and SAY SO
 * ```
 *
 * ## What was actually in the pile, stated before anything was done to it
 *
 * The brief describes "33 party + 1,366 press LEADs, unadjudicated". The
 * committed artifact holds **2,344 LEAD rows**, and that number is the wrong
 * unit twice over.
 *
 * The hunt that produced them walked a CROSS PRODUCT: for each candidate on the
 * ballot it fetched every link mined from every page that mentioned any
 * candidate, and asked *does THIS candidate's name appear on THAT site*. So
 * `analiliafornj.com` carries a HIT row for Analilia Mejia and four LEAD rows —
 * Kean, Bennett, Hathaway, Booker — each correctly recording that the page
 * carries none of that person's name forms. **Those are not held leads awaiting
 * a decision. They are decided negatives, and every one records the decision
 * and the exact forms searched.** 2,282 of the 2,344 rows are that shape.
 *
 * What is genuinely undecided is the remainder: a strong name match on a page
 * carrying no word about standing for office, or a surname match on a page that
 * IS about standing for office.
 *
 * ## AND THE CROSS PRODUCT NEVER ASKED THE USEFUL QUESTION
 *
 * It asked, of each candidate, *is this that candidate's site*. It never asked,
 * of a site, *whose site is this*. A campaign site linked from a press page
 * about candidate A, belonging to candidate B, is invisible to every row in the
 * artifact — B was never paired with the page A's article linked from.
 *
 * So this INVERTS the question. Every distinct host in the corpus is fetched
 * once and tested against **all** the ballot's candidates at once. That is one
 * fetch per host rather than one per pair, it is strictly more information than
 * the cross product produced, and it is the only route here that can surface a
 * site nobody had paired.
 *
 * ## The promotion bar does not move
 *
 * `verdictFor` in `lib/hunt/candidate-evidence.ts` is the same function the
 * original hunt used and it is called here unchanged: a strong name form plus
 * office evidence promotes, a surname alone never does, and a page carrying a
 * name but no word about standing for office stays a LEAD. Every host is
 * control-probed first (RULING 68) — a 200 indistinguishable from the host's own
 * answer for a name that cannot exist is the host talking about itself.
 *
 * Hosts that cannot be a candidate's own campaign site are demoted WITHOUT a
 * fetch, with the reason stated, because fetching a news organisation's home
 * page to discover it is not a campaign site spends a request to learn nothing.
 * That list is narrow and every entry says why, because the cost of a wrong
 * entry is a real campaign site demoted unread.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  classifyCampaignPage,
  flattenForEvidence,
  matchNameForms,
  officeEvidenceIn,
  partyOrganSelfIdIn,
  verdictFor,
} from "../lib/hunt/candidate-evidence.ts";
import { CONTROL_IDENTIFIER, ControlledProbe, type ProbeResponse } from "../lib/hunt/control-query.ts";
import { politeGetText } from "../lib/sources/http.ts";
import { today } from "./doc-dates.mjs";

const ROOT = join(import.meta.dirname, "..");
const WRITE = process.argv.includes("--write");
const ZIP = (process.argv.find((a) => a.startsWith("--zip=")) ?? "--zip=07866").slice(6);
const LIMIT = Number((process.argv.find((a) => a.startsWith("--limit=")) ?? "--limit=0").slice(8));

const BALLOTS: Record<string, string> = {
  "07866": "nj-morris-2026.json",
  "03255": "nh-merrimack-2026.json",
};
const LEADS_FILE =
  "nj-campaign-sites-press-outlet-wp-search+party-municipal-committee+party-county-gop+party-committee-domain-shape.json";

/**
 * Hosts that are not a candidate's own campaign site, and the reason for each.
 *
 * A SHAPE where one exists and a name where one does not (RULING 110). The bar
 * is "could this conceivably be a person's campaign site", and anything that
 * conceivably could be is fetched — because the cost of a wrong entry here is a
 * real campaign site demoted unread, which is the failure this whole item
 * exists to undo.
 */
const NOT_A_CAMPAIGN_SITE: ReadonlyArray<[RegExp, string]> = [
  [
    /^gmpg\.org$/,
    "the XFN profile link every WordPress theme emits in its <head> — site chrome present on every WordPress page in the corpus, belonging to no campaign",
  ],
  [/^(www\.)?w3\.org$/, "a standards body's namespace URL, emitted by markup rather than linked by an author"],
  [/^(.+\.)?wordpress\.(org|com)$/, "the publishing platform's own site, linked by the theme"],
  [/^(.+\.)?(gravatar|automattic)\.com$/, "the publishing platform's avatar and corporate hosts"],
  [
    /^(.+\.)?(facebook|twitter|x|instagram|linkedin|youtube|tiktok|threads|pinterest|reddit)\.com$/,
    "a social platform's own domain — a campaign PRESENCE on one is RULING 145's business and is reached by its own compliant routes, never by treating the platform root as a site",
  ],
  [/^(flic\.kr|flickr\.com)$/, "a photo host"],
  [
    /^(.+\.)?(nbcnews|cnn|npr|cbsnews|abcnews|foxnews|nytimes|washingtonpost|politico|politicopro|semafor|axios|theatlantic|newrepublic|notus|forbes|nypost|observer|gothamist|philly|northjersey|dailyrecord|starledger)\.com$/,
    "a news organisation — it reports on candidates and is never a candidate's own site",
  ],
  [
    /^(.+\.)?(insidernj|hudsoncountyview|newjerseyglobe|morristowngreen|villagegreennj|tapinto|patch)\.(com|net|org)$/,
    "a New Jersey news outlet — in most rows here, the publisher of the very page the link was mined from",
  ],
  [/^(.+\.)?govtrack\.us$/, "a legislative-tracking site — a third party's page about a member of Congress"],
  [/^results\.enr\.clarityelections\.com$/, "an election-results reporting host"],
  [/^(.+\.)?heisman\.com$/, "a sports award — it matched a surname and nothing else"],
];

interface LeadRow {
  candidacyId: string;
  subject: string;
  outcome: string;
  url: string;
  siteUrl: string;
}

interface Candidate {
  id: string;
  contestId: string;
  givenName: string;
  familyName: string;
}

const leads = JSON.parse(readFileSync(join(ROOT, "data", "hunt", LEADS_FILE), "utf8")) as {
  walkedAt: string;
  rows: LeadRow[];
};
const ballotFile = BALLOTS[ZIP];
if (!ballotFile) {
  console.error(`pnpm leads:adjudicate --zip=<${Object.keys(BALLOTS).join("|")}>`);
  process.exit(1);
}
const ballot = JSON.parse(readFileSync(join(ROOT, "data", "ballot", ballotFile), "utf8")) as {
  contests: { id: string; title: string }[];
  candidacies: Candidate[];
};
const contestTitle = new Map(ballot.contests.map((c) => [c.id, c.title]));

function hostOf(u: string): string | null {
  try {
    return new URL(u).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

/*
 * Every distinct host behind a LEAD row, with the rows that pointed at it — so
 * a demotion can name how many rows it disposed of rather than just how many
 * hosts.
 */
const hosts = new Map<string, { url: string; rows: number }>();
let leadRows = 0;
for (const r of leads.rows) {
  if (r.outcome !== "LEAD") continue;
  leadRows += 1;
  const h = hostOf(r.siteUrl || r.url);
  if (!h) continue;
  const entry = hosts.get(h) ?? { url: `https://${h}/`, rows: 0 };
  entry.rows += 1;
  hosts.set(h, entry);
}

const excluded: { host: string; rows: number; why: string }[] = [];
const walkable: string[] = [];
for (const h of hosts.keys()) {
  const why = NOT_A_CAMPAIGN_SITE.find(([re]) => re.test(h))?.[1];
  if (why) excluded.push({ host: h, rows: hosts.get(h)!.rows, why });
  else walkable.push(h);
}
walkable.sort();

console.log(`\nADJUDICATING THE HELD LEADS — ${ZIP}, ${today()}\n`);
console.log(`  LEAD rows in the artifact       ${leadRows}`);
console.log(`  distinct hosts behind them      ${hosts.size}`);
console.log(
  `  demoted unread, reason stated   ${excluded.length} host(s) / ${excluded.reduce((n, e) => n + e.rows, 0)} row(s)`,
);
console.log(`  hosts to walk                   ${walkable.length}`);
console.log(`  candidates tested per host      ${ballot.candidacies.length} — the WHOLE ballot, which is the inversion\n`);

const bodies = new Map<string, string>();
const fetcher = async (url: string): Promise<ProbeResponse> => {
  try {
    const r = await politeGetText(url, { profile: "browser" });
    bodies.set(url, r.text);
    return { status: r.status, length: r.text.length };
  } catch {
    return { status: 0, length: 0 };
  }
};
const probe = new ControlledProbe(fetcher);

interface Verdict {
  host: string;
  url: string;
  outcome: string;
  detail: string;
  bytes: number;
  control: number;
  subject: string | null;
  candidacyId: string | null;
  contestTitle: string | null;
  formsMatched: string[];
  officeEvidence: string[];
  partyOrganSelfId: string[];
  pageKind: string;
  pageKindWhy: string;
  rowsCovered: number;
  attemptedAt: string;
}

const verdicts: Verdict[] = [];
const cap = LIMIT > 0 ? Math.min(LIMIT, walkable.length) : walkable.length;

for (let i = 0; i < cap; i++) {
  const host = walkable[i];
  const entry = hosts.get(host)!;
  /*
   * The control and the real request are the same host, differing only in the
   * path — so the control measures THIS host's answer for a page that cannot
   * exist, which is the only thing that makes a 200 mean anything.
   */
  const r = await probe.probe(
    (id) => (id === CONTROL_IDENTIFIER ? `https://${host}/${id}` : entry.url),
    "",
    { guessed: false },
  );
  const reachable = r.outcome === "HIT" || r.outcome === "LEAD";
  const flat = reachable ? flattenForEvidence(bodies.get(entry.url) ?? "") : "";
  const office = reachable ? officeEvidenceIn(flat) : [];
  const organ = reachable ? partyOrganSelfIdIn(flat) : [];

  /* THE INVERSION: every candidate on the ballot against this one page. */
  let best: {
    c: Candidate;
    forms: ReturnType<typeof matchNameForms>;
    verdict: ReturnType<typeof verdictFor>;
  } | null = null;
  if (reachable) {
    for (const c of ballot.candidacies) {
      const forms = matchNameForms(`${c.givenName} ${c.familyName}`.trim(), flat);
      if (!forms.some((f) => f.matched)) continue;
      const v = verdictFor("HIT", forms, office);
      const better =
        !best ||
        (v.outcome === "HIT" && best.verdict.outcome !== "HIT") ||
        (v.outcome === best.verdict.outcome &&
          forms.filter((f) => f.matched && f.kind !== "surname").length >
            best.forms.filter((f) => f.matched && f.kind !== "surname").length);
      if (better) best = { c, forms, verdict: v };
    }
  }

  /*
   * WHAT KIND OF PAGE IS THIS — asked separately from WHOSE it is, because the
   * two questions have different evidence and conflating them is what promoted
   * a news site as a comedian-adjacent candidate's campaign site.
   */
  const kind = reachable
    ? classifyCampaignPage({ officeEvidence: office, partyOrganSelfId: organ })
    : { kind: "LEAD" as const, why: "not reached" };

  const identified = Boolean(best) && best!.verdict.outcome === "HIT";
  const outcome = !reachable
    ? r.outcome
    : identified && kind.kind === "CAMPAIGN_SITE"
      ? "HIT"
      : identified && kind.kind === "PARTY_HOSTED_PAGE"
        ? "PARTY_HOSTED_PAGE"
        : "LEAD";
  const detail = !reachable
    ? r.detail
    : identified
      ? `${best!.verdict.detail} — and ${kind.why}`
      : best
        ? best.verdict.detail
        : `the page cleared the control and names NONE of the ${ballot.candidacies.length} candidates on this ballot — a live host, and not any of their sites`;

  verdicts.push({
    host,
    url: entry.url,
    outcome,
    detail,
    bytes: r.length,
    control: r.control,
    subject: best ? `${best.c.givenName} ${best.c.familyName}` : null,
    candidacyId: best?.c.id ?? null,
    contestTitle: best ? (contestTitle.get(best.c.contestId) ?? null) : null,
    formsMatched: best ? best.forms.filter((f) => f.matched).map((f) => f.form) : [],
    officeEvidence: office,
    partyOrganSelfId: organ,
    pageKind: kind.kind,
    pageKindWhy: kind.why,
    rowsCovered: entry.rows,
    attemptedAt: today(),
  });

  const mark = outcome === "HIT" ? "HIT " : outcome === "LEAD" ? "lead" : outcome.toLowerCase().slice(0, 4);
  console.log(
    `  ${String(i + 1).padStart(3)}/${cap} ${mark} ${host.padEnd(38)} ${best ? `${best.c.givenName} ${best.c.familyName}` : ""}`,
  );
}

const hits = verdicts.filter((v) => v.outcome === "HIT");
const partyHosted = verdicts.filter((v) => v.outcome === "PARTY_HOSTED_PAGE");
const stillLead = verdicts.filter((v) => v.outcome === "LEAD");
const refused = verdicts.filter((v) => v.outcome === "REFUSED");
const empty = verdicts.filter((v) => v.outcome === "EMPTY");

console.log(
  `\n  walked        ${verdicts.length} of ${walkable.length} host(s)` +
    (cap < walkable.length
      ? ` — CLIPPED at --limit=${LIMIT}; ${walkable.length - cap} host(s) NOT walked and still owed`
      : ""),
);
console.log(`  HIT (campaign site)      ${hits.length}`);
console.log(`  PARTY-HOSTED PAGE        ${partyHosted.length} — RULING 122, and the host is named`);
console.log(`  still LEAD    ${stillLead.length}`);
console.log(`  refused       ${refused.length} — a wall, never an absence`);
console.log(`  empty         ${empty.length}`);
console.log(
  `  accounted for ${hits.length + partyHosted.length + stillLead.length + refused.length + empty.length} of ${verdicts.length}`,
);
if (partyHosted.length) {
  console.log("\n  PROMOTED — the page their party publishes about them (RULING 122, host named):");
  for (const h of partyHosted) console.log(`    ${h.subject} — ${h.url}  (${h.contestTitle})`);
}
if (hits.length) {
  console.log("\n  PROMOTED:");
  for (const h of hits) console.log(`    ${h.subject} — ${h.url}  (${h.contestTitle})`);
}

if (WRITE) {
  const out = join(ROOT, "data", "hunt", `lead-adjudication-${ZIP}-0825.json`);
  writeFileSync(
    out,
    `${JSON.stringify(
      {
        note:
          "Adjudication of the held campaign-site LEADs, by INVERSION: every distinct host in the " +
          "corpus fetched once and tested against every candidate on the ballot, rather than each " +
          "candidate tested against each host. The promotion bar is verdictFor() unchanged. Hosts " +
          "demoted without a fetch carry their reason. Written by scripts/adjudicate-leads-0825.mts.",
        zip: ZIP,
        walkedAt: today(),
        sourceArtifact: LEADS_FILE,
        candidatesTested: ballot.candidacies.length,
        totals: {
          leadRows,
          distinctHosts: hosts.size,
          demotedUnreadHosts: excluded.length,
          demotedUnreadRows: excluded.reduce((n, e) => n + e.rows, 0),
          walked: verdicts.length,
          notWalked: walkable.length - verdicts.length,
          hit: hits.length,
          partyHostedPage: partyHosted.length,
          stillLead: stillLead.length,
          refused: refused.length,
          empty: empty.length,
        },
        demotedUnread: excluded,
        verdicts,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  console.log(`\n  written ${out}`);
} else {
  console.log("\n  report only — pass --write to record the adjudication");
}
