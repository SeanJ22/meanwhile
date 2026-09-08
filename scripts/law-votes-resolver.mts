/**
 * Resolve a key-votes LAW entry to its actual roll calls, through the
 * official record — tracker B15/B17, built 2026-08-18 (g19).
 *
 * ## Why this file exists
 *
 * The Senate publishes every vote under the bill's OFFICIAL LONG TITLE,
 * never its popular name: the Inflation Reduction Act appears as "A bill to
 * provide for reconciliation pursuant to title II of S. Con. Res. 14". So
 * searching the Senate's own roll-call index for "Inflation Reduction Act"
 * returns nothing, which is what the first run found — sixteen of eighteen
 * entries came back empty and the seventeenth came back with sixteen
 * candidates.
 *
 * The route that closes it, recorded in `lib/votes/key-votes.ts` and
 * implemented here: **find the law in the official record by its popular
 * name, take the bill number FROM the record, then take that bill's own
 * recorded votes.** A bill number is never typed from memory. That is the
 * same rule as a candidate position — no source, no claim — and it is the
 * reason this is a resolver rather than a lookup table.
 *
 * ## Three refusals
 *
 * 1. **Ambiguity refuses.** Two laws whose titles both contain the phrase
 *    is not a near-miss to be broken by picking the first; it is a miss,
 *    recorded with both candidates named.
 * 2. **A non-passage vote refuses.** A bill carries cloture votes, motions
 *    to proceed, and amendment votes. Rendering a cloture vote as "how they
 *    voted on the CHIPS Act" is a false claim about a named person. Only
 *    actions the chamber itself typed as passage or as resolving
 *    differences are eligible.
 * 3. **A vote whose tally cannot be read refuses.** The tally is parsed out
 *    of the chamber's own action text; an action whose text does not state
 *    one is not accepted with a null tally, because the tally is what the
 *    verification step compares against.
 *
 * Everything refused is written as a MISS with its reason, and the run
 * prints matched-over-total. Nothing is ever filled with a plausible value.
 */

import fs from "node:fs";

const API = "https://api.congress.gov/v3";
const UA = "we-the-people-civic-app/0.1 (contact: seanj22@gmail.com)";

export interface LawRecord {
  congress: number;
  /** "hr" | "s" — the bill type, lowercased for the API path. */
  type: string;
  number: string;
  title: string;
  lawNumber: string | null;
}

export interface ResolvedVote {
  chamber: "House" | "Senate";
  congress: number;
  session: number;
  rollNumber: number;
  /** The chamber's own words for what the vote decided. */
  question: string;
  url: string;
  /** "243-187", parsed from the chamber's own action text. */
  tally: string;
  actionDate: string;
}

/** One page of anything, with the API's error surfaced rather than swallowed. */
async function get<T>(path: string, apiKey: string): Promise<T | null> {
  const sep = path.includes("?") ? "&" : "?";
  const url = `${API}${path}${sep}api_key=${apiKey}&format=json`;
  try {
    const response = await fetch(url, { headers: { "user-agent": UA } });
    if (!response.ok) {
      console.log(`  ${path} -> HTTP ${response.status}`);
      return null;
    }
    return (await response.json()) as T;
  } catch (error) {
    console.log(`  ${path} -> ${(error as Error).message}`);
    return null;
  }
}

/**
 * Every public law of a congress, from the official record.
 *
 * Paged at the API's maximum. The count is returned to the caller and
 * printed by it: a congress that comes back with zero laws is a fetch
 * failure wearing an empty list, and an empty list read as "no law matches"
 * would turn our outage into a claim about Congress.
 */
export async function lawsOfCongress(
  congress: number,
  apiKey: string,
): Promise<LawRecord[]> {
  const out: LawRecord[] = [];
  for (let offset = 0; offset < 2000; offset += 250) {
    const page = await get<{
      bills?: {
        congress: number;
        type: string;
        number: string;
        title: string;
        laws?: { number: string }[];
      }[];
    }>(`/law/${congress}?limit=250&offset=${offset}`, apiKey);
    const bills = page?.bills ?? [];
    for (const bill of bills) {
      out.push({
        congress: bill.congress,
        type: String(bill.type).toLowerCase(),
        number: String(bill.number),
        title: bill.title ?? "",
        lawNumber: bill.laws?.[0]?.number ?? null,
      });
    }
    if (bills.length < 250) break;
    await new Promise((r) => setTimeout(r, 120));
  }
  return out;
}

/**
 * The bill's every title, for the laws whose short title is not the name
 * the country uses (the Inflation Reduction Act is the whole reason this
 * exists — its official title names a budget resolution).
 */
export async function titlesOf(law: LawRecord, apiKey: string): Promise<string[]> {
  const page = await get<{ titles?: { title: string }[] }>(
    `/bill/${law.congress}/${law.type}/${law.number}/titles?limit=250`,
    apiKey,
  );
  return (page?.titles ?? []).map((t) => t.title).filter(Boolean);
}

/**
 * Actions the chamber itself typed as deciding the bill, rather than as a
 * step along the way.
 *
 * `Floor` covers passage in either chamber; `ResolvingDifferences` covers a
 * concurrence vote, which is the FINAL vote on a bill that went to the
 * other chamber and came back — the CHIPS Act's real House vote is a
 * concurrence, and treating it as ineligible would leave a law the House
 * plainly voted on rendering as a gap.
 */
const DECIDING_TYPES = new Set(["Floor", "ResolvingDifferences"]);

/**
 * The text patterns that mark a vote as deciding the measure.
 *
 * Deliberately narrow, and the exclusions matter more than the inclusions:
 * cloture, a motion to proceed, an amendment, and a motion to table are all
 * roll calls on this bill that are NOT votes on the bill.
 */
const PASSAGE_TEXT =
  /(on passage|passed senate|passed house|agreed to the senate amendment|agree to the senate amendment|concurred in the house amendment|concurring in the senate amendment|on motion to concur|motion to concur)/i;
const NOT_PASSAGE = /(cloture|motion to proceed|motion to table|amendment (no|sa)\b|on the amendment)/i;

/** "243 - 187" or "243-187, 1 Present" out of the chamber's own words. */
function tallyIn(text: string): string | null {
  const m = /(\d{1,3})\s*-\s*(\d{1,3})/.exec(text);
  return m ? `${m[1]}-${m[2]}` : null;
}

/**
 * The deciding roll call per chamber, from the bill's own action record.
 *
 * When a chamber has more than one eligible action, the LAST one wins —
 * a bill that passes, goes to the other chamber, and comes back for
 * concurrence has its final say last, and that is the vote a reader means.
 * The choice is stated here rather than left to array order.
 */
export interface BillAction {
  readonly actionDate: string;
  readonly text: string;
  readonly type?: string;
  readonly recordedVotes?: readonly {
    readonly chamber: string;
    readonly congress: number;
    readonly sessionNumber: number;
    readonly rollNumber: number;
    readonly url: string;
  }[];
}

function actionChambers(action: BillAction): readonly ("House" | "Senate")[] {
  const recorded = new Set<"House" | "Senate">();
  for (const vote of action.recordedVotes ?? []) recorded.add(vote.chamber === "House" ? "House" : "Senate");
  if (recorded.size > 0) return [...recorded];
  const chambers: ("House" | "Senate")[] = [];
  if (/\b(?:passed house|house (?:agreed|concurred|passed))\b/i.test(action.text)) chambers.push("House");
  if (/\b(?:passed senate|senate (?:agreed|concurred|passed))\b/i.test(action.text)) chambers.push("Senate");
  return chambers;
}

/**
 * Resolve from a complete action list, including voice/unanimous-consent
 * decisions. The final deciding action wins even when it has no roll number:
 * an older recorded vote on earlier text must never stand in for that action.
 */
export function decidingVotesFromActions(actions: readonly BillAction[]): ResolvedVote[] {
  const eligible = actions.filter(
    (a) =>
      DECIDING_TYPES.has(a.type ?? "") &&
      PASSAGE_TEXT.test(a.text ?? "") &&
      !NOT_PASSAGE.test(a.text ?? "") &&
      actionChambers(a).length > 0,
  );

  const finalByChamber = new Map<"House" | "Senate", BillAction>();
  // Oldest first, so the last deciding action per chamber wins whether that
  // action was recorded, voice, or unanimous consent.
  const ordered = [...eligible].sort((a, b) =>
    a.actionDate < b.actionDate ? -1 : a.actionDate > b.actionDate ? 1 : 0,
  );
  for (const action of ordered) {
    for (const chamber of actionChambers(action)) finalByChamber.set(chamber, action);
  }

  const byChamber = new Map<"House" | "Senate", ResolvedVote>();
  for (const [expectedChamber, action] of finalByChamber) {
    for (const vote of action.recordedVotes ?? []) {
      const chamber = vote.chamber === "House" ? "House" : "Senate";
      if (chamber !== expectedChamber) continue;
      const tally = tallyIn(action.text);
      // No tally in the chamber's own words means nothing to verify
      // against, so the vote is not accepted at all.
      if (!tally) continue;
      byChamber.set(chamber, {
        chamber,
        congress: vote.congress,
        session: vote.sessionNumber,
        rollNumber: vote.rollNumber,
        question: action.text.replace(/\s+/g, " ").trim(),
        url: vote.url,
        tally,
        actionDate: action.actionDate,
      });
    }
  }
  return [...byChamber.values()];
}

export async function decidingVotes(
  law: LawRecord,
  apiKey: string,
): Promise<{ votes: ResolvedVote[]; considered: number }> {
  const page = await get<{ actions?: BillAction[] }>(
    `/bill/${law.congress}/${law.type}/${law.number}/actions?limit=250`,
    apiKey,
  );
  const actions = page?.actions ?? [];
  return { votes: decidingVotesFromActions(actions), considered: actions.length };
}


/**
 * The bills FOLDED INTO a law, from the vehicle's own related-bills record.
 *
 * The April 2024 package is why this exists, and the shape is general. The
 * House passed four separate bills; the Senate took one of them as the
 * vehicle and passed the package; only the vehicle became a public law. So
 * three of the four siblings appear in NO public-law list, in any congress,
 * under any title — the law-list route structurally cannot reach them, and
 * a run that reported that as "no such law" would be describing our route
 * rather than the record.
 *
 * The record names them itself: `/bill/{congress}/{type}/{number}/relatedbills`
 * on the vehicle returns "Ukraine Security Supplemental Appropriations Act,
 * 2024", "Israel Security…", "Indo-Pacific Security…" and "21st Century
 * Peace through Strength Act" with their bill numbers. Read from the
 * official record, exactly like everything else here, and never typed.
 *
 * These bills are NOT public laws, so they carry no law number — which is
 * correct and is stated on the record rather than filled in.
 */
export async function relatedBillsOf(
  law: LawRecord,
  apiKey: string,
): Promise<LawRecord[]> {
  const page = await get<{
    relatedBills?: { congress: number; type: string; number: string | number; title: string }[];
  }>(
    `/bill/${law.congress}/${law.type}/${law.number}/relatedbills?limit=250`,
    apiKey,
  );
  return (page?.relatedBills ?? []).map((bill) => ({
    congress: bill.congress,
    type: String(bill.type).toLowerCase(),
    number: String(bill.number),
    title: bill.title ?? "",
    lawNumber: null,
  }));
}


/**
 * A measure that has NOT become law, resolved through the chamber's own
 * roll-call index — B15's pending entry.
 *
 * A pending bill appears in no public-law list, so every route above misses
 * it structurally. The House publishes an index of every roll call it took,
 * carrying the bill number it was on — and **carrying no bill titles at
 * all**. So searching that index's text for "stock" returns nothing, and
 * reporting that as "the House has not voted on this" would be a claim
 * about the House built out of a fact about the index. It is the false-miss
 * shape: the answer is there and we asked the wrong question of it.
 *
 * The route: take every DISTINCT measure the chamber actually voted on,
 * resolve each to its official title, and look in the titles. Titles are
 * cached to disk, because that is 397 requests for one congress and a
 * second run should cost nothing.
 *
 * Returns every match. One is a resolution; zero or several is a miss.
 */
export async function measuresVotedInHouse(
  congress: number,
  apiKey: string,
  cachePath: string,
): Promise<LawRecord[]> {
  // Every roll call the House took, from its own index.
  const measures = new Set<string>();
  for (const session of [1, 2]) {
    for (let offset = 0; offset < 1500; offset += 250) {
      const page = await get<{
        houseRollCallVotes?: { legislationType?: string; legislationNumber?: string }[];
      }>(`/house-vote/${congress}/${session}?limit=250&offset=${offset}`, apiKey);
      const votes = page?.houseRollCallVotes ?? [];
      for (const vote of votes) {
        if (vote.legislationType && vote.legislationNumber) {
          measures.add(`${vote.legislationType.toLowerCase()}|${vote.legislationNumber}`);
        }
      }
      if (votes.length < 250) break;
    }
  }

  // Titles, cached — 397 requests for one congress otherwise.
  let cache: Record<string, string> = {};
  try {
    cache = JSON.parse(fs.readFileSync(cachePath, "utf8"));
  } catch {
    // No cache is a state, not an error.
  }
  let fetched = 0;
  for (const key of measures) {
    const cacheKey = `${congress}|${key}`;
    if (cacheKey in cache) continue;
    const [type, number] = key.split("|");
    const page = await get<{ bill?: { title?: string } }>(
      `/bill/${congress}/${type}/${number}`,
      apiKey,
    );
    cache[cacheKey] = page?.bill?.title ?? "";
    fetched++;
    await new Promise((r) => setTimeout(r, 40));
  }
  if (fetched > 0) fs.writeFileSync(cachePath, JSON.stringify(cache, null, 1), "utf8");
  console.log(
    `    house-vote index: ${measures.size} distinct measures in congress ${congress}, ${fetched} titles newly fetched`,
  );

  return [...measures].map((key) => {
    const [type, number] = key.split("|");
    return {
      congress,
      type,
      number,
      title: cache[`${congress}|${key}`] ?? "",
      lawNumber: null,
    };
  });
}

/**
 * Find the one law whose titles contain `phrase`.
 *
 * Pass 1 is the law list's own short title, which covers most of them for
 * the cost of four requests. Pass 2 fetches every title of every law in the
 * congresses still unresolved, which is what the Inflation Reduction Act
 * needs — and it is the caller's job to only ask for that when pass 1 has
 * genuinely failed, because it is hundreds of requests.
 *
 * Returns every match. **One is a resolution; zero or several is a miss**,
 * and the caller records which with the candidates named.
 */
export function matchByTitle(laws: LawRecord[], phrase: string): LawRecord[] {
  const needle = phrase.toLowerCase();
  return laws.filter((law) => law.title.toLowerCase().includes(needle));
}
