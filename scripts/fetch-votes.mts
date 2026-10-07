/**
 * @freshness-reads-here — each freshness date is taken at the moment of the fetch it describes.
 */
/**
 * Acquire and promote the recent federal roll-call window.
 *
 * `pnpm votes:fetch -- --window 20`
 *
 * Sources, all official:
 *  - House: https://clerk.house.gov/evs/<year>/roll<NNN>.xml (member votes
 *    keyed by bioguide in `name-id`)
 *  - Senate: https://www.senate.gov/legislative/LIS/roll_call_lists/
 *    vote_menu_<congress>_<session>.xml (the official per-vote title line)
 *    and .../roll_call_votes/vote<congress><session>/vote_..._<NNNNN>.xml
 *    (member votes keyed by LIS id)
 *  - Bill titles: api.congress.gov v3 (official titles; the bill page also
 *    hosts the CRS summary the surface links to)
 *
 * The Senate keys members by LIS id, not bioguide, so the public-domain
 * legislators-current.json provides the lis→bioguide bridge — and the run
 * PRINTS the identifier match rates with denominators; a zero-match join must
 * be loud.
 *
 * Serialized requests, identified User-Agent, bounded window. This explicit
 * owner operation writes only the candidate/event/promotion plane. It has no
 * scheduler and never changes a tracked file or invokes a software release.
 */
import type {
  MemberVote,
  RollCallVote,
  VotePosition,
  VotesSnapshot,
} from "../lib/votes/types.ts";
import { federalRollCallsCandidate, FEDERAL_ROLLCALL_SCOPE, FEDERAL_VOTES_PARSER_VERSION, FEDERAL_VOTES_SOURCE_ID, type OfficialAcquisition } from "../lib/votes/data-plane.ts";
import {
  billSummariesForRollCallAcquisition,
  readFederalRollCallsProjection,
} from "../lib/votes/snapshot.ts";
import { windowStart } from "../lib/votes/catch-up.ts";
import { failedAcquisitionCandidate } from "../lib/civic-data/candidate-builders.ts";
import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { printSourceRunnerReceipt } from "../lib/civic-data/runner-receipt.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";

const CONGRESS = 119;
const SESSION = 2;
const YEAR = 2026;
const UA = "we-the-people-civic-app/0.1 (contact: seanj22@gmail.com)";

const windowArg = process.argv.indexOf("--window");
const WINDOW = windowArg === -1 ? 20 : Number(process.argv[windowArg + 1]);
if (!process.argv.includes("--promote")) throw new Error("PASS_--promote: this command has no tracked-output mode");
prepareProductionCivicDataWrite();

const store = new PostgresRoutineDataStore();
const previous = await readFederalRollCallsProjection({ store, bypassCache: true });
const billSummaries = billSummariesForRollCallAcquisition(previous);
const acquisitions: OfficialAcquisition[] = [];
let failureRecorded = false;

async function recordFailure(url: string, detail: string): Promise<void> {
  if (failureRecorded) return;
  failureRecorded = true;
  const attemptedAt = new Date().toISOString();
  const failed = failedAcquisitionCandidate({
    sourceId: FEDERAL_VOTES_SOURCE_ID,
    recordClass: "FEDERAL_ROLL_CALL",
    scope: FEDERAL_ROLLCALL_SCOPE,
    requestedUrl: url,
    attemptedAt,
    failureDetail: detail,
    parserVersion: FEDERAL_VOTES_PARSER_VERSION,
  });
  const outcome = await processRegisteredManualCandidate(store, "congress-rollcalls", failed, attemptedAt);
  printSourceRunnerReceipt("congress-rollcalls", failed, outcome);
}

async function get(url: string, proveOfficial: boolean = true): Promise<string> {
  let response: Response;
  try {
    response = await fetch(url, { headers: { "user-agent": UA } });
  } catch (error) {
    await recordFailure(url, error instanceof Error ? error.message : "official fetch failed");
    throw error;
  }
  if (!response.ok) {
    await recordFailure(url, `${url} -> HTTP ${response.status}`);
    throw new Error(`${url} -> HTTP ${response.status}`);
  }
  const body = await response.text();
  if (proveOfficial) acquisitions.push({ requestedUrl: url, finalUrl: response.url || url, httpStatus: response.status, body });
  return body;
}

function tag(xml: string, name: string): string | null {
  const match = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`).exec(xml);
  return match ? match[1].replace(/\s+/g, " ").trim() : null;
}

function mapPosition(raw: string): VotePosition | null {
  const v = raw.trim().toLowerCase();
  if (v === "yea" || v === "aye" || v === "yes" || v === "guilty") return "YES";
  if (v === "nay" || v === "no" || v === "not guilty") return "NO";
  if (v === "present") return "PRESENT";
  if (v === "not voting") return "NOT_VOTING";
  return null;
}

// ---- The wired federal members and the LIS bridge --------------------------
const legislators = JSON.parse(
  await get(
    "https://unitedstates.github.io/congress-legislators/legislators-current.json",
    false,
  ),
) as { id: { bioguide: string; lis?: string } }[];
const lisToBioguide = new Map<string, string>();
const bioguides = new Set<string>();
for (const person of legislators) {
  bioguides.add(person.id.bioguide);
  if (person.id.lis) lisToBioguide.set(person.id.lis, person.id.bioguide);
}

// ---- House ---------------------------------------------------------------
async function latestHouseRoll(): Promise<number> {
  let lo = 1;
  let hi = 1200;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    const url = `https://clerk.house.gov/evs/${YEAR}/roll${String(mid).padStart(3, "0")}.xml`;
    let response: Response;
    try {
      response = await fetch(url, { method: "HEAD", headers: { "user-agent": UA } });
    } catch (error) {
      await recordFailure(url, error instanceof Error ? error.message : "House roll horizon lookup failed");
      throw error;
    }
    if (response.ok) lo = mid;
    else hi = mid;
  }
  return lo;
}

const votes: RollCallVote[] = [];
const positions: MemberVote[] = [];
const billNums = new Set<string>();
let houseMatched = 0;
let houseTotal = 0;

// Each window reaches back to the roll after the previous version's newest, so none is skipped between versions.
const heldWindow = previous.kind === "PROMOTED" || previous.kind === "BOOTSTRAP" ? previous.value.snapshot.window : null;
const newestHeld = (rolls: readonly number[] | undefined): number | null => rolls !== undefined && rolls.length > 0 ? Math.max(...rolls) : null;
const latestHouse = await latestHouseRoll();
const houseWindow = windowStart({ latest: latestHouse, previousNewest: newestHeld(heldWindow?.houseRolls), window: WINDOW });
if (houseWindow.unreached > 0) console.warn(`  House: ${houseWindow.unreached} roll(s) between the held version and this window were not reached; the next run continues from here`);
const houseRolls: number[] = [];
for (let n = houseWindow.start; n <= latestHouse; n++) {
  houseRolls.push(n);
}

for (const n of houseRolls) {
  const xml = await get(
    `https://clerk.house.gov/evs/${YEAR}/roll${String(n).padStart(3, "0")}.xml`,
  );
  const legisNumRaw = tag(xml, "legis-num");
  const legisNum =
    legisNumRaw && legisNumRaw !== "QUORUM" ? legisNumRaw : null;
  const question = tag(xml, "vote-question") ?? "";
  const result = tag(xml, "vote-result") ?? "";
  const desc = tag(xml, "vote-desc");
  const date = tag(xml, "action-date") ?? "";

  // The chamber-wide tally is the LAST yea/nay pair: the XML lists per-party
  // subtotals first and <totals-by-vote> last.
  const totalPairs = [
    ...xml.matchAll(/<yea-total>(\d+)<\/yea-total>\s*<nay-total>(\d+)<\/nay-total>/g),
  ];
  const totals = totalPairs[totalPairs.length - 1];
  const tally = totals ? ` ${totals[1]}–${totals[2]}` : "";

  const id = `house:${CONGRESS}-${SESSION}:${n}`;
  votes.push({
    id,
    chamber: "house",
    congress: CONGRESS,
    session: SESSION,
    rollNumber: n,
    date,
    // Placeholder; replaced by the official bill title below where one
    // exists. The chamber's own description line is the fallback.
    title: desc || question,
    titleSource: "CHAMBER_QUESTION",
    question,
    legisNum,
    result: `${result}${tally}`,
    billUrl: null,
    rollCallUrl: `https://clerk.house.gov/Votes/${YEAR}${n}`,
    retrievedAt: new Date().toISOString(),
  });
  if (legisNum) billNums.add(legisNum);

  for (const m of xml.matchAll(
    /<recorded-vote><legislator name-id="([^"]+)"[^>]*>[^<]*<\/legislator><vote>([^<]+)<\/vote><\/recorded-vote>/g,
  )) {
    houseTotal++;
    if (!bioguides.has(m[1])) continue;
    houseMatched++;
    const position = mapPosition(m[2]);
    if (!position) continue;
    positions.push({ officeholderId: `congress:${m[1]}`, voteId: id, position });
  }
}

// ---- Senate --------------------------------------------------------------
const menu = await get(
  `https://www.senate.gov/legislative/LIS/roll_call_lists/vote_menu_${CONGRESS}_${SESSION}.xml`,
);
const menuEntries = [...menu.matchAll(/<vote>[\s\S]*?<\/vote>/g)].map((m) => {
  const block = m[0];
  return {
    number: Number(tag(block, "vote_number")),
    issue: tag(block, "issue"),
    question: tag(block, "question") ?? "",
    result: tag(block, "result") ?? "",
    yeas: tag(block, "yeas"),
    nays: tag(block, "nays"),
    title: tag(block, "title") ?? "",
  };
});
menuEntries.sort((a, b) => a.number - b.number);
const latestSenate = menuEntries.at(-1)?.number ?? 0;
const senateStart = windowStart({ latest: latestSenate, previousNewest: newestHeld(heldWindow?.senateRolls), window: WINDOW });
if (senateStart.unreached > 0) console.warn(`  Senate: ${senateStart.unreached} roll(s) between the held version and this window were not reached; the next run continues from here`);
const senateWindow = menuEntries.filter((entry) => entry.number >= senateStart.start);

let senateMatched = 0;
let senateTotal = 0;

for (const entry of senateWindow) {
  const padded = String(entry.number).padStart(5, "0");
  const xml = await get(
    `https://www.senate.gov/legislative/LIS/roll_call_votes/vote${CONGRESS}${SESSION}/vote_${CONGRESS}_${SESSION}_${padded}.xml`,
  );
  const date = tag(xml, "vote_date") ?? "";
  const tally =
    entry.yeas && entry.nays ? ` ${entry.yeas}–${entry.nays}` : "";
  const id = `senate:${CONGRESS}-${SESSION}:${entry.number}`;

  votes.push({
    id,
    chamber: "senate",
    congress: CONGRESS,
    session: SESSION,
    rollNumber: entry.number,
    date,
    // The Senate menu's title line is the chamber's own official wording.
    title: entry.title,
    titleSource: "CHAMBER_QUESTION",
    question: entry.question,
    legisNum: entry.issue,
    result: `${entry.result}${tally}`,
    billUrl: null,
    rollCallUrl: `https://www.senate.gov/legislative/LIS/roll_call_votes/vote${CONGRESS}${SESSION}/vote_${CONGRESS}_${SESSION}_${padded}.htm`,
    retrievedAt: new Date().toISOString(),
  });
  if (entry.issue) billNums.add(entry.issue);

  for (const m of xml.matchAll(
    /<member>[\s\S]*?<vote_cast>([^<]+)<\/vote_cast>\s*<lis_member_id>([^<]+)<\/lis_member_id>[\s\S]*?<\/member>/g,
  )) {
    senateTotal++;
    const bioguide = lisToBioguide.get(m[2]);
    if (!bioguide) continue;
    senateMatched++;
    const position = mapPosition(m[1]);
    if (!position) continue;
    positions.push({
      officeholderId: `congress:${bioguide}`,
      voteId: id,
      position,
    });
  }
}

// ---- Official bill titles from Congress.gov ------------------------------
const apiKey = process.env.CONGRESS_API_KEY;
let titled = 0;
if (apiKey) {
  const billType = (legis: string): { type: string; num: string } | null => {
    const m = /^(H\.? ?R\.?|H\.? ?RES\.?|H\.? ?J\.? ?RES\.?|H\.? ?CON\.? ?RES\.?|S\.? ?J\.? ?RES\.?|S\.? ?CON\.? ?RES\.?|S\.? ?RES\.?|S\.?)\s*(\d+)$/i.exec(
      legis.trim(),
    );
    if (!m) return null;
    const key = m[1].replace(/[.\s]/g, "").toLowerCase();
    const map: Record<string, string> = {
      hr: "hr",
      hres: "hres",
      hjres: "hjres",
      hconres: "hconres",
      s: "s",
      sres: "sres",
      sjres: "sjres",
      sconres: "sconres",
    };
    return map[key] ? { type: map[key], num: m[2] } : null;
  };

  for (const legis of billNums) {
    const parsed = billType(legis);
    if (!parsed) continue;
    try {
      // Never persist the credential-bearing request URL in durable acquisition
      // evidence. The authority/route is provable without its query string.
      const requestedUrl = `https://api.congress.gov/v3/bill/${CONGRESS}/${parsed.type}/${parsed.num}`;
      const credentialedUrl = `${requestedUrl}?api_key=${encodeURIComponent(apiKey)}&format=json`;
      const response = await fetch(
        credentialedUrl,
        { headers: { "user-agent": UA } },
      );
      if (!response.ok) continue;
      const raw = await response.text();
      acquisitions.push({ requestedUrl, finalUrl: requestedUrl, httpStatus: response.status, body: raw });
      const data = JSON.parse(raw) as {
        bill?: { title?: string };
      };
      const title = data.bill?.title;
      if (!title) continue;
      // Every bill type has its own congress.gov path segment; collapsing them
      // to "-bill" links unrelated real bills.
      const URL_SLUG: Record<string, string> = {
        hr: "house-bill",
        hres: "house-resolution",
        hjres: "house-joint-resolution",
        hconres: "house-concurrent-resolution",
        s: "senate-bill",
        sres: "senate-resolution",
        sjres: "senate-joint-resolution",
        sconres: "senate-concurrent-resolution",
      };
      const billUrl = `https://www.congress.gov/bill/${CONGRESS}th-congress/${URL_SLUG[parsed.type]}/${parsed.num}`;
      for (const vote of votes) {
        if (vote.legisNum === legis) {
          vote.title = title;
          vote.titleSource = "BILL_TITLE";
          vote.billUrl = billUrl;
          titled++;
        }
      }
      if (
        !billSummaries.summaries[billUrl] &&
        !billSummaries.pending.some((pending) => pending.billUrl === billUrl)
      ) {
        console.warn(
          `  UNSUMMARIZED: ${legis} (${billUrl}) has no reviewed explanation in the current canonical projection`,
        );
      }
    } catch {
      // A missing title leaves the chamber's own words — honest either way.
    }
  }
} else {
  console.warn("CONGRESS_API_KEY not set — titles stay on the chambers' own wording");
}

const snapshot: VotesSnapshot = {
  generatedAt: new Date().toISOString(),
  congress: CONGRESS,
  session: SESSION,
  window: {
    houseRolls,
    senateRolls: senateWindow.map((e) => e.number),
  },
  identifierMatch: { houseMatched, houseTotal, senateMatched, senateTotal },
  votes,
  positions,
};

const attemptedAt = new Date().toISOString();
const candidate = federalRollCallsCandidate({
  acquisitions,
  retrievedAt: attemptedAt,
  expectedCongress: CONGRESS,
  expectedSession: SESSION,
  snapshot,
  billSummaries,
});
const outcome = await processRegisteredManualCandidate(store, "congress-rollcalls", candidate, attemptedAt);
printSourceRunnerReceipt("congress-rollcalls", candidate, outcome);

console.log(
  `house: ${houseRolls.length} rolls (${houseRolls[0]}–${houseRolls[houseRolls.length - 1]}), identifier match ${houseMatched}/${houseTotal}`,
);
console.log(
  `senate: ${senateWindow.length} votes (${senateWindow[0]?.number}–${senateWindow[senateWindow.length - 1]?.number}), identifier match ${senateMatched}/${senateTotal}`,
);
console.log(
  `${votes.length} votes, ${positions.length} member positions, ${titled} title assignments from Congress.gov → ${outcome.candidate.state} ${candidate.id}`,
);

if (houseTotal > 0 && houseMatched / houseTotal < 0.95) {
  console.error("house identifier match below 95% — the join is broken, not clipped");
  process.exit(1);
}
if (senateTotal > 0 && senateMatched / senateTotal < 0.95) {
  console.error("senate identifier match below 95% — the join is broken, not clipped");
  process.exit(1);
}
if (positions.length === 0) {
  console.error("zero positions extracted — that is a finding, not a success");
  process.exit(1);
}
if (outcome.candidate.state !== "PROMOTED") {
  throw new Error(`FEDERAL_ROLLCALL_PROMOTION_REFUSED:${outcome.candidate.failureCode ?? outcome.candidate.state}`);
}
