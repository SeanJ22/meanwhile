/**
 * Fetch the recent-roll-call window into the votes snapshot (5).
 *
 * `pnpm votes:fetch [--window 20]`
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
 * PRINTS the identifier match rates with denominators (the standing rule:
 * compare identifier sets before trusting an adapter; a zero-match join must
 * be loud).
 *
 * Serialized requests, identified User-Agent, bounded window. The snapshot
 * is committed; nothing fetches live per page load.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  MemberVote,
  RollCallVote,
  VotePosition,
  VotesSnapshot,
} from "../lib/votes/types.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data", "votes", "votes-snapshot.json");

const CONGRESS = 119;
const SESSION = 2;
const YEAR = 2026;
const UA = "we-the-people-civic-app/0.1 (contact: seanj22@gmail.com)";

const windowArg = process.argv.indexOf("--window");
const WINDOW = windowArg === -1 ? 20 : Number(process.argv[windowArg + 1]);

async function get(url: string): Promise<string> {
  const response = await fetch(url, { headers: { "user-agent": UA } });
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
  return response.text();
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
    const response = await fetch(
      `https://clerk.house.gov/evs/${YEAR}/roll${String(mid).padStart(3, "0")}.xml`,
      { method: "HEAD", headers: { "user-agent": UA } },
    );
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

const latestHouse = await latestHouseRoll();
const houseRolls: number[] = [];
for (let n = Math.max(1, latestHouse - WINDOW + 1); n <= latestHouse; n++) {
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
  // subtotals first and <totals-by-vote> last. The first pair is one party's
  // count — shipping it as the result was caught in this session's first run
  // (roll 264: "76–136" is the Republican subtotal; the House total is
  // 76–350).
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
const senateWindow = menuEntries.slice(-WINDOW);

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
      const response = await fetch(
        `https://api.congress.gov/v3/bill/${CONGRESS}/${parsed.type}/${parsed.num}?api_key=${apiKey}&format=json`,
        { headers: { "user-agent": UA } },
      );
      if (!response.ok) continue;
      const data = (await response.json()) as {
        bill?: { title?: string };
      };
      const title = data.bill?.title;
      if (!title) continue;
      const billUrl = `https://www.congress.gov/bill/${CONGRESS}th-congress/${
        parsed.type.startsWith("h") ? "house" : "senate"
      }-bill/${parsed.num}`;
      for (const vote of votes) {
        if (vote.legisNum === legis) {
          vote.title = title;
          vote.titleSource = "BILL_TITLE";
          vote.billUrl = billUrl;
          titled++;
        }
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

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(snapshot, null, 1) + "\n");

console.log(
  `house: ${houseRolls.length} rolls (${houseRolls[0]}–${houseRolls[houseRolls.length - 1]}), identifier match ${houseMatched}/${houseTotal}`,
);
console.log(
  `senate: ${senateWindow.length} votes (${senateWindow[0]?.number}–${senateWindow[senateWindow.length - 1]?.number}), identifier match ${senateMatched}/${senateTotal}`,
);
console.log(
  `${votes.length} votes, ${positions.length} member positions, ${titled} title assignments from Congress.gov → ${OUT}`,
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
