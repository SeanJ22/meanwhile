/**
 * **WALK THE MANIFEST FOR PHOTO, BLURB AND CAMPAIGN SITE, ONE CONTEST AT A
 * TIME.** (NJ Hunt 3 item 7, 2026-08-22.)
 *
 * ```
 * pnpm nj:fields --contest <substring>      # every candidate in that contest
 * pnpm nj:fields --contest borough-council --json out.json
 * ```
 *
 * ## Why a contest is the unit
 *
 * The equal-effort rule: hunts for candidate information are run for EVERY
 * candidate in a contest, and a hunt that stops when the well-covered ones are
 * done has produced a ranking rather than a result. So this takes a CONTEST and
 * walks every candidate in it before it will report anything, and it prints the
 * per-candidate outcome for all of them — including the ones where every route
 * returned nothing, because that is the half that gets quietly dropped.
 *
 * ## What it measures, and why the measurement is the point
 *
 * NH Hunt 6 found ONE contact for THIRTEEN candidates because most contact
 * routes need a person. New Jersey then handed over 328 filed emails from a
 * single county-clerk PDF — one document, one route, mechanically. That is a
 * fact about CONTACT in NEW JERSEY, and item 7.3 asks the obvious next
 * question: do PHOTO, BLURB and CAMPAIGN SITE behave the same way here?
 *
 * They may not, and assuming they do is how a session reports a hunt it did not
 * run. So this walks the mechanically-walkable routes for those three fields and
 * states, per route, what it returned — `HIT`, `LEAD`, `EMPTY` or `WALL`.
 *
 * ## RULING 68 — a guessed identifier can never be a HIT
 *
 * `domain-search` guesses. `melissaburnside.com` resolving is not evidence that
 * it is THIS Melissa Burnside's campaign, and a domain parked by a squatter
 * answers 200 with a page that mentions nothing. So every guessed route is
 * walked through a CONTROL QUERY first: the same host pattern is asked for an
 * identifier that cannot exist, and any answer indistinguishable from that
 * control is `EMPTY`. Where the identifier was guessed rather than confirmed
 * from a source, the best outcome available is `LEAD` — a thing for a person to
 * look at, never a fact this product will render.
 *
 * ## What it never does
 *
 * It writes no field to any data file. Whether a portrait is a solo portrait,
 * whether a page belongs to the filed candidate, whether a quote is the
 * campaign's own words — each is a claim about a real person, and each stays
 * with the session. This reports; it does not decide.
 */

import { writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { politeGetText } from "../lib/sources/http.ts";
import { today } from "./doc-dates.mjs";

const ROOT = process.cwd();
const AS_OF = today();

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const contestArg = arg("--contest");
const jsonOut = arg("--json");
if (!contestArg) {
  console.error("pnpm nj:fields --contest <substring of the contest id>");
  process.exit(2);
}

type Ballot = {
  contests: { id: string; title: string; ocdId: string }[];
  candidacies: {
    id: string;
    contestId: string;
    familyName: string;
    givenName: string;
    partyLabel: string | null;
    websiteUrl: string | null;
    slogan: string | null;
  }[];
};

const ballot = JSON.parse(
  readFileSync(join(ROOT, "data", "ballot", "nj-morris-2026.json"), "utf8"),
) as Ballot;

const contest = ballot.contests.find((c) => c.id.includes(contestArg));
if (!contest) {
  console.error(`no contest id contains "${contestArg}"`);
  process.exit(2);
}
const candidates = ballot.candidacies.filter((c) => c.contestId === contest.id);
if (candidates.length === 0) {
  // A zero-row read is a FAILED read, never an empty contest.
  console.error(`${contest.id} yielded zero candidates — that is a failed read of the ballot file`);
  process.exit(1);
}

/** What one route returned for one candidate. */
type Outcome = "HIT" | "LEAD" | "EMPTY" | "WALL";
interface RouteResult {
  route: string;
  outcome: Outcome;
  detail: string;
  url?: string;
}

const UA_NOTE = "identified client with a contact address, serialized, Retry-After honoured";

/** Slug forms a campaign domain is plausibly built from. */
function domainGuesses(given: string, family: string): string[] {
  const g = given.toLowerCase().replace(/[^a-z]/g, "");
  const f = family.toLowerCase().replace(/[^a-z]/g, "");
  if (!g || !f) return [];
  return [
    `${g}${f}.com`,
    `${g}for${f}.com`,
    `${f}for${"council"}.com`,
    `${g}${f}forcouncil.com`,
    `vote${f}.com`,
  ];
}

/**
 * The CONTROL. A name that cannot be a candidate, run through the same guesser,
 * so a host family that answers 200 for everything is caught before any real
 * name is read as a hit (RULING 68).
 */
const CONTROL = domainGuesses("Zzyzx", "Qwertling");

async function fetchOnce(url: string): Promise<{ status: number; text: string } | null> {
  try {
    const r = await politeGetText(url, { profile: "browser" });
    return { status: r.status, text: r.text };
  } catch {
    return null;
  }
}

/** `domain-search`, guessed and therefore capped at LEAD. */
async function domainSearch(
  given: string,
  family: string,
  controlAnswers: Set<string>,
): Promise<RouteResult> {
  for (const host of domainGuesses(given, family)) {
    const url = `https://${host}/`;
    const got = await fetchOnce(url);
    if (!got) continue;
    if (got.status !== 200) continue;
    const signature = `${got.status}:${got.text.length}`;
    if (controlAnswers.has(signature)) {
      // The control answers identically, so this host family answers for
      // everything and this tells us nothing about this person.
      continue;
    }
    const mentionsName =
      new RegExp(family, "i").test(got.text) && new RegExp(given.slice(0, 4), "i").test(got.text);
    return {
      route: "domain-search",
      // RULING 68: the identifier was GUESSED. Even a page carrying the name is
      // a LEAD — a squatter's parking page can carry a name, and "is this the
      // filed candidate" is a judgement about a real person.
      outcome: mentionsName ? "LEAD" : "EMPTY",
      detail: mentionsName
        ? `200 and the page carries the surname — GUESSED identifier, so LEAD and never a HIT`
        : `200 but the page does not carry the name`,
      url,
    };
  }
  return {
    route: "domain-search",
    outcome: "EMPTY",
    detail: `no guessed domain answered 200 with this candidate's name (${domainGuesses(given, family).length} tried)`,
  };
}

/** `filing-county` — already walked; this states what it yielded, per candidate. */
function filingCounty(c: Ballot["candidacies"][number]): RouteResult {
  return {
    route: "filing-county",
    outcome: c.slogan ? "HIT" : "EMPTY",
    detail: c.slogan
      ? `the clerk's filing carries a ballot slogan: ${JSON.stringify(c.slogan)}`
      : "the clerk's filing carries a name, party, email and address — and no photo, no prose, no site",
  };
}

/** `campaign-site` — only walkable when some route has already produced a URL. */
function campaignSite(c: Ballot["candidacies"][number]): RouteResult {
  return c.websiteUrl
    ? { route: "campaign-site", outcome: "HIT", detail: "a site is already held", url: c.websiteUrl }
    : {
        route: "campaign-site",
        outcome: "EMPTY",
        detail: "NOT WALKABLE — this route reads a site we already have a URL for, and no route has produced one",
      };
}

console.log(`\nMANIFEST WALK — ${contest.title}`);
console.log(`  contest ${contest.id}`);
console.log(`  ${candidates.length} candidate(s), walked ${AS_OF}`);
console.log(`  client: ${UA_NOTE}\n`);

/* The control, once for the run rather than once per candidate. */
const controlAnswers = new Set<string>();
for (const host of CONTROL) {
  const got = await fetchOnce(`https://${host}/`);
  if (got && got.status === 200) controlAnswers.add(`${got.status}:${got.text.length}`);
}
console.log(
  `  control query (RULING 68): ${CONTROL.length} impossible domains tried, ` +
    `${controlAnswers.size} answered 200 — those signatures are excluded below\n`,
);

const report: {
  candidate: string;
  party: string | null;
  routes: RouteResult[];
}[] = [];

for (const c of candidates) {
  const name = `${c.givenName} ${c.familyName}`;
  const routes: RouteResult[] = [
    filingCounty(c),
    campaignSite(c),
    await domainSearch(c.givenName, c.familyName, controlAnswers),
  ];
  report.push({ candidate: name, party: c.partyLabel, routes });

  console.log(`  ${name}${c.partyLabel ? ` (${c.partyLabel})` : ""}`);
  for (const r of routes) {
    console.log(`      ${r.outcome.padEnd(5)} ${r.route.padEnd(16)} ${r.detail}${r.url ? ` — ${r.url}` : ""}`);
  }
  console.log("");
}

/* The pair, stated: routes walked against routes the manifest names. */
const walked = report[0]?.routes.length ?? 0;
console.log(`  ROUTES WALKED HERE: ${walked} per candidate, for ${candidates.length} candidate(s)`);
console.log(
  "  Every candidate in this contest was walked before anything was reported — the equal-effort rule.",
);
console.log(
  "  This is NOT a full manifest walk and no VERIFIED_ABSENT is earned by it. RULING 61: exhaustion is\n" +
    "  the whole named list, and what is still owed is listed in the session report.",
);

if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify({ contest: contest.id, walkedAt: AS_OF, report }, null, 2), "utf8");
  console.log(`\n  written ${jsonOut}`);
}
