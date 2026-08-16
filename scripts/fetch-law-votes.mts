/**
 * Resolve the KEY VOTES ON LAWS against congress.gov's own record — B17.
 *
 *   pnpm law-votes:fetch
 *
 * B15 shipped the machinery and all sixteen nominations, and left twenty law
 * rows carrying no roll call. The reason was structural rather than lazy:
 * **the Senate publishes every vote under the bill's OFFICIAL LONG TITLE,
 * never its popular name.** The Inflation Reduction Act appears as "A bill to
 * provide for reconciliation pursuant to title II of S. Con. Res. 14", which
 * names nothing a reader would recognise, so a popular-name search over the
 * Senate's roll-call lists returned zero passage votes for sixteen entries.
 *
 * The route that closes it, and every step of it is the official record:
 *
 *  1. **The public-law lists** — `/v3/law/{congress}/pub` for 116–119. Every
 *     entry but the pending one became law, so this is the bounded universe
 *     the bill must be in.
 *  2. **The titles endpoint** — `/v3/bill/{congress}/{type}/{number}/titles`
 *     carries the POPULAR and short titles ("Popular Titles | Inflation
 *     Reduction Act of 2022"), which is where the reader's name for the law
 *     actually lives. An entry resolves to the law whose titles contain its
 *     curated popular-name phrase, and to nothing otherwise.
 *  3. **The actions endpoint** — that bill's `recordedVotes`, each carrying
 *     the chamber, the session, the roll number, and the chamber's OWN URL
 *     (clerk.house.gov / senate.gov). The id is never constructed here.
 *
 * ## The refusals, which are the point
 *
 * A bill number typed from memory is exactly the assumption the key-votes
 * file refuses, so none is typed: the phrase is searched, and zero or
 * ambiguous matches are recorded as misses with the count and the reason. A
 * chamber with several recorded votes on one bill — cloture, a motion to
 * proceed, a budget waiver, then passage — is narrowed to passage-type
 * questions and then to the LAST of them, which is the vote on the text that
 * became law; anything the chamber's own timestamps cannot decide is a miss
 * rather than a guess. Rendering a cloture vote as "how they voted on the
 * CHIPS Act" is a false claim about a member, not a near-miss.
 *
 * The run prints matched-over-total with denominators and names every miss.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { KEY_VOTES, type KeyVoteEntry, type RollCallRef } from "../lib/votes/key-votes.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SNAPSHOT = join(ROOT, "data", "votes", "key-votes-snapshot.json");
const TITLES_CACHE = join(ROOT, "data", "votes", "law-titles-cache.json");
const TODAY = "2026-08-15";
const CONGRESSES = [116, 117, 118, 119];

const key = process.env.CONGRESS_API_KEY;
if (!key) {
  console.error("CONGRESS_API_KEY is not set — refusing to run rather than write nothing");
  process.exit(1);
}

async function api<T>(path: string): Promise<T | null> {
  const url = `https://api.congress.gov/v3/${path}${path.includes("?") ? "&" : "?"}format=json&api_key=${key}`;
  try {
    const response = await fetch(url, {
      headers: { "user-agent": "we-the-people-civic-app/0.1 (contact: seanj22@gmail.com)" },
    });
    // Serialized and paced, same manners as every other adapter here.
    await new Promise((r) => setTimeout(r, 250));
    if (!response.ok) {
      console.log(`  /${path.split("?")[0]} -> HTTP ${response.status}`);
      return null;
    }
    return (await response.json()) as T;
  } catch (error) {
    console.log(`  /${path.split("?")[0]} -> ${(error as Error).message}`);
    return null;
  }
}

interface LawRow {
  congress: number;
  type: string;
  number: string;
  listTitle: string;
  law: string;
}

async function publicLaws(): Promise<LawRow[]> {
  const out: LawRow[] = [];
  for (const congress of CONGRESSES) {
    let read = 0;
    for (let offset = 0; offset < 2000; offset += 250) {
      const page = await api<{
        bills?: Array<{ congress: number; type: string; number: string; title: string; laws?: Array<{ number: string }> }>;
      }>(`law/${congress}/pub?limit=250&offset=${offset}`);
      const bills = page?.bills ?? [];
      for (const b of bills) {
        out.push({
          congress: b.congress,
          type: b.type.toLowerCase(),
          number: b.number,
          listTitle: b.title,
          law: b.laws?.[0]?.number ?? "",
        });
      }
      read += bills.length;
      if (bills.length < 250) break;
    }
    console.log(`  congress ${congress}: ${read} public laws`);
  }
  return out;
}

/** Every title congress.gov publishes for a bill, cached across runs. */
async function titlesFor(
  law: LawRow,
  cache: Record<string, string[]>,
): Promise<string[]> {
  const cacheKey = `${law.congress}-${law.type}-${law.number}`;
  const hit = cache[cacheKey];
  if (hit) return hit;
  const body = await api<{ titles?: Array<{ title?: string }> }>(
    `bill/${law.congress}/${law.type}/${law.number}/titles?limit=250`,
  );
  const titles = (body?.titles ?? []).map((t) => t.title ?? "").filter(Boolean);
  cache[cacheKey] = titles;
  return titles;
}

interface RecordedVote {
  chamber: string;
  rollNumber: number;
  sessionNumber: number;
  congress: number;
  url: string;
  actionText: string;
  /** The chamber's own timestamp — how "the last vote" is decided. */
  date: string;
}

async function recordedVotes(law: LawRow): Promise<RecordedVote[]> {
  const body = await api<{
    actions?: Array<{
      text?: string;
      recordedVotes?: Array<{ chamber: string; rollNumber: number; sessionNumber: number; congress: number; url: string; date?: string }>;
    }>;
  }>(`bill/${law.congress}/${law.type}/${law.number}/actions?limit=250`);
  const seen = new Set<string>();
  const out: RecordedVote[] = [];
  for (const action of body?.actions ?? []) {
    for (const v of action.recordedVotes ?? []) {
      const id = `${v.chamber}:${v.congress}:${v.sessionNumber}:${v.rollNumber}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({
        chamber: v.chamber,
        rollNumber: v.rollNumber,
        sessionNumber: v.sessionNumber,
        congress: v.congress,
        url: v.url,
        actionText: (action.text ?? "").replace(/\s+/g, " ").trim(),
        date: v.date ?? "",
      });
    }
  }
  return out;
}

/**
 * Which of a chamber's recorded votes is THIS entry's vote.
 *
 * A big bill collects cloture motions, motions to proceed, budget waivers and
 * motions to table, all of them recorded votes on the same bill. Only passage
 * and concurrence answer the question "how did they vote on this law".
 */
// No trailing word boundary on `concur`: the Senate's own final action on a
// bill it amends reads "Senate CONCURRED in the House amendment … by Yea-Nay
// Vote", and `\bconcur\b` misses every one of them — which is how BSCA and
// CHIPS came back as "no passage or concurrence question" on a bill whose
// concurrence vote is right there.
const PASSAGE =
  /\b(passed|on passage|suspend the rules and pass|agreed to the senate amendment|agree to the senate amendment|agreed to the house amendment|concur)/i;
const NOT_PASSAGE =
  /\b(cloture|motion to proceed|motion to table|budgetary discipline|reconsider|recommit|committee|motion by senator)\b/i;

function pickVote(
  votes: RecordedVote[],
  chamber: "House" | "Senate",
  /** Kept in the signature: the entry states which vote counts, and the
   * rule below honours its INTENT rather than its words — see the note. */
  _whichVote: string | undefined,
): { vote: RecordedVote | null; why: string } {
  const mine = votes.filter((v) => v.chamber === chamber);
  if (mine.length === 0) return { vote: null, why: `no ${chamber} recorded vote on this bill` };

  const pool = mine.filter((v) => PASSAGE.test(v.actionText) && !NOT_PASSAGE.test(v.actionText));
  if (pool.length === 0) {
    return {
      vote: null,
      why: `${mine.length} ${chamber} recorded vote(s), none a passage or concurrence question`,
    };
  }
  if (pool.length === 1) return { vote: pool[0], why: "" };

  /*
   * `whichVote` is NOT matched on its literal words, and the reason is a bug
   * this run caught before it shipped.
   *
   * BSCA's entry says `house: "final passage"`. Matching that against the
   * action text picked House roll 212 — "On passage Passed 230-190" — which
   * is the House passing its OWN, unrelated version of S. 2938 in May, a
   * Byrne-grant bill. The vote on the gun law is roll 299 in June, when the
   * House agreed to the Senate's amendments 234-193. Reading "final passage"
   * as the words "on passage" would have put every House member against a
   * vote on a different bill, under the name of the law that made news —
   * exactly the false claim this file exists to refuse.
   *
   * "Final passage" means the vote that finally passed it, and for a bill
   * the other chamber amended that is the concurrence. So the rule below is
   * the rule for every entry.
   */

  /*
   * THE RULE FOR THE REST, stated rather than guessed (B17, 2026-08-15).
   *
   * A chamber usually votes twice on a big bill: once on its own text, and
   * again to agree to the other chamber's amendment. Both are passage-type
   * questions, so `whichVote` was written for exactly this — but the
   * author's list names it on two entries out of twenty.
   *
   * The default applied here is the LAST passage-type vote in that chamber,
   * because that is the vote on the text that BECAME LAW. It is a rule, not
   * a preference: applied uniformly, decided by the chamber's own
   * timestamps, and stated here and in `docs/state.md` so a reader of the
   * code knows which of a member's two votes their card shows. The rejected
   * alternative was refusing all eight of these entries, which would have
   * left the group emptier than the record actually is while the answer sat
   * in the chamber's own timeline.
   *
   * It is still a refusal where the timestamps cannot decide.
   */
  const sorted = [...pool].sort((a, b) => a.date.localeCompare(b.date));
  const last = sorted[sorted.length - 1];
  const tied = sorted.filter((v) => v.date === last.date);
  if (last.date && tied.length === 1) return { vote: last, why: "" };
  return {
    vote: null,
    why: `${pool.length} ${chamber} passage-type votes and no last one (${pool
      .map((v) => `#${v.rollNumber} "${v.actionText.slice(0, 60)}"`)
      .join("; ")}) — refusing to guess which one the entry means`,
  };
}

function tallyFrom(text: string): string | null {
  const m = /(\d{1,3})\s*-\s*(\d{1,3})/.exec(text);
  return m ? `${m[1]}-${m[2]}` : null;
}

function toRef(v: RecordedVote): RollCallRef {
  return {
    congress: v.congress,
    session: v.sessionNumber,
    rollNumber: v.rollNumber,
    question: v.actionText || null,
    url: v.url,
    tally: tallyFrom(v.actionText),
    verifiedAt: TODAY,
  };
}

/* ------------------------------------------------------------------ run --- */

console.log("reading the public-law lists…");
const laws = await publicLaws();
console.log(`public laws available: ${laws.length}\n`);

let cache: Record<string, string[]> = {};
try {
  cache = JSON.parse(await readFile(TITLES_CACHE, "utf8")) as Record<string, string[]>;
  console.log(`titles cache: ${Object.keys(cache).length} bills already read\n`);
} catch {
  console.log("titles cache: none yet\n");
}

const prior = JSON.parse(await readFile(SNAPSHOT, "utf8")) as {
  entries: KeyVoteEntry[];
  misses: Array<{ id: string; chamber: string; reason: string }>;
  [k: string]: unknown;
};
const byId = new Map(prior.entries.map((e) => [e.id, e]));

const misses = prior.misses.filter((m) => {
  const entry = KEY_VOTES.find((e) => e.id === m.id);
  // Drop the LAWS misses this run re-decides; the nominations' stand.
  return entry?.group !== "LAWS";
});

let resolvedLaws = 0;
const lawEntries = KEY_VOTES.filter((e) => e.group === "LAWS");

for (const entry of lawEntries) {
  const target = byId.get(entry.id);
  if (!target) continue;
  if (!entry.lawSearch) {
    misses.push({
      id: entry.id,
      chamber: "both",
      reason: entry.pending
        ? "the measure has not become law — there is no enacted bill to resolve, and the entry's own note says so on the card"
        : "no unambiguous popular name: this entry names a shutdown-ending appropriations fight, and the congress carries several 'Continuing'/'Consolidated Appropriations' laws — refusing to pick one rather than putting members against a vote on a different bill",
    });
    continue;
  }

  // Stage 1: the list title, which already carries most popular names.
  // An EXACT list title wins outright — "Autism CARES Act of 2019" contains
  // "CARES Act" and is a different law, so a substring hit alone is not a
  // match when the exact name is sitting right there.
  const needle = entry.lawSearch.toLowerCase();
  const exact = laws.filter(
    (l) => l.listTitle.toLowerCase().replace(/\s+of\s+\d{4}\.?$/, "") === needle,
  );
  let candidates =
    exact.length === 1
      ? exact
      : laws.filter((l) => l.listTitle.toLowerCase().includes(needle));

  // Stage 2: the titles endpoint, where the rest of them live. Only for the
  // entries stage 1 could not place — the sweep is the expensive rung and it
  // is walked only when the cheap one came back empty.
  if (candidates.length === 0) {
    console.log(`  sweeping titles for "${entry.lawSearch}"…`);
    for (const law of laws) {
      const titles = await titlesFor(law, cache);
      if (titles.some((t) => t.toLowerCase().includes(needle))) {
        candidates.push(law);
        break;
      }
    }
  } else {
    // Verify the stage-1 match against the bill's own title list, so a
    // substring coincidence in a list title cannot stand alone.
    const verified: LawRow[] = [];
    for (const law of candidates) {
      const titles = await titlesFor(law, cache);
      if (titles.some((t) => t.toLowerCase().includes(needle))) verified.push(law);
    }
    candidates = verified;
  }

  if (candidates.length !== 1) {
    misses.push({
      id: entry.id,
      chamber: "both",
      reason:
        candidates.length === 0
          ? `no public law in ${CONGRESSES.join("/")} carries the title "${entry.lawSearch}"`
          : `${candidates.length} public laws carry "${entry.lawSearch}" (${candidates
              .map((c) => `${c.congress} ${c.type}${c.number}`)
              .join(", ")}) — refusing to guess`,
    });
    continue;
  }

  const law = candidates[0];
  const votes = await recordedVotes(law);
  console.log(
    `  ${entry.id} -> ${law.congress} ${law.type.toUpperCase()}${law.number} (PL ${law.law}), ${votes.length} recorded votes`,
  );

  let house = pickVote(votes, "House", entry.whichVote?.house);
  const senate = pickVote(votes, "Senate", entry.whichVote?.senate);

  /*
   * THE APRIL 2024 SHAPE, and why the four siblings exist at all.
   *
   * The House voted on FOUR separate bills — Ukraine, Israel, Indo-Pacific,
   * and the TikTok/sanctions package — and the Senate voted the four as one
   * vehicle, H.R. 815. So the enacted law carries the Senate's single vote
   * and NO House recorded vote at all: a House member's four votes live on
   * four bills that never individually became law.
   *
   * Resolved mechanically rather than by typing four bill numbers: the
   * enacted law's own `relatedbills` list names them, and each sibling is
   * matched to the related bill whose title carries its popular name — the
   * same phrase, against the same official record, one endpoint further.
   */
  if (!house.vote) {
    const related = await api<{
      relatedBills?: Array<{ congress: number; type: string; number: number; title?: string }>;
    }>(`bill/${law.congress}/${law.type}/${law.number}/relatedbills?limit=250`);
    const sibling = (related?.relatedBills ?? []).filter((b) =>
      (b.title ?? "").toLowerCase().includes(needle),
    );
    if (sibling.length === 1) {
      const b = sibling[0];
      const siblingVotes = await recordedVotes({
        congress: b.congress,
        type: b.type.toLowerCase(),
        number: String(b.number),
        listTitle: b.title ?? "",
        law: "",
      });
      const picked = pickVote(siblingVotes, "House", entry.whichVote?.house);
      if (picked.vote) {
        console.log(
          `    house via related bill ${b.type}${b.number} — the chamber voted on its own bill`,
        );
        house = picked;
      }
    }
  }
  target.house = house.vote ? [toRef(house.vote)] : [];
  target.senate = senate.vote ? [toRef(senate.vote)] : [];
  if (!house.vote) misses.push({ id: entry.id, chamber: "house", reason: house.why });
  if (!senate.vote) misses.push({ id: entry.id, chamber: "senate", reason: senate.why });
  if (house.vote || senate.vote) resolvedLaws += 1;
}

await mkdir(dirname(TITLES_CACHE), { recursive: true });
await writeFile(TITLES_CACHE, `${JSON.stringify(cache, null, 1)}\n`, "utf8");
await writeFile(
  SNAPSHOT,
  `${JSON.stringify({ ...prior, fetchedAt: new Date().toISOString(), entries: [...byId.values()], misses }, null, 1)}\n`,
  "utf8",
);

console.log("\n=== key votes on laws, resolved against congress.gov ===");
console.log(`LAWS with at least one verified roll call: ${resolvedLaws}/${lawEntries.length}`);
console.log(`misses recorded: ${misses.length}`);
for (const m of misses) console.log(`  MISS ${m.id} (${m.chamber}): ${m.reason}`);
console.log(SNAPSHOT);
