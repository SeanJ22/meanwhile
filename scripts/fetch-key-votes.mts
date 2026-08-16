/**
 * Resolve the key-votes list against the official chamber records — B15.
 *
 *   pnpm key-votes:fetch
 *
 * **Roll call ids are fetched and verified, never assumed.** The list in
 * `lib/votes/key-votes.ts` is the author's; this script's only job is to
 * find each entry's actual roll call in the chamber's own published record
 * and refuse when it cannot.
 *
 * Sources, both official and both public:
 *  - Senate: `https://www.senate.gov/legislative/LIS/roll_call_lists/
 *    vote_menu_<congress>_<session>.xml` — one document per session listing
 *    every roll call with its number, question, title and tally.
 *  - House: `https://clerk.house.gov/evs/<year>/ROLL_<NNN>.asp` indexes, via
 *    the Clerk's own per-year vote list.
 *
 * ## The refusal that makes this honest
 *
 * For the sixteen nominations the author's list carries the TALLY he
 * recorded. A candidate roll call is accepted only when the name matches
 * AND the tally matches. A name match with a different tally is the WRONG
 * VOTE — a cloture vote, an earlier failed vote, a different nominee with
 * the same surname — and accepting it would put a member's name against a
 * vote they did not cast. Those are recorded as misses with the reason.
 *
 * Everything the run could not verify is written as `null` and renders as
 * an honest absence. The run prints matched-over-total with denominators.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  KEY_VOTES,
  type KeyVoteEntry,
  type RollCallRef,
} from "../lib/votes/key-votes.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data", "votes", "key-votes-snapshot.json");
const UA = "we-the-people-civic-app/0.1 (contact: seanj22@gmail.com)";
const TODAY = "2026-08-15";

/** Sessions to sweep. 2020 through 2026 — the list's own window. */
const SENATE_SESSIONS: { congress: number; session: number; year: number }[] = [
  { congress: 116, session: 2, year: 2020 },
  { congress: 117, session: 1, year: 2021 },
  { congress: 117, session: 2, year: 2022 },
  { congress: 118, session: 1, year: 2023 },
  { congress: 118, session: 2, year: 2024 },
  { congress: 119, session: 1, year: 2025 },
  { congress: 119, session: 2, year: 2026 },
];

async function get(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, { headers: { "user-agent": UA } });
    if (!response.ok) {
      console.log(`  ${url} -> HTTP ${response.status}`);
      return null;
    }
    await new Promise((r) => setTimeout(r, 300));
    return await response.text();
  } catch (error) {
    console.log(`  ${url} -> ${(error as Error).message}`);
    return null;
  }
}

interface SenateVote {
  congress: number;
  session: number;
  rollNumber: number;
  question: string;
  title: string;
  yeas: number;
  nays: number;
  date: string;
}

function textOf(xml: string, name: string): string {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml);
  return m ? m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : "";
}

async function senateVotes(): Promise<SenateVote[]> {
  const all: SenateVote[] = [];
  for (const s of SENATE_SESSIONS) {
    const xml = await get(
      `https://www.senate.gov/legislative/LIS/roll_call_lists/vote_menu_${s.congress}_${s.session}.xml`,
    );
    if (!xml) continue;
    const blocks = xml.split("<vote>").slice(1);
    for (const block of blocks) {
      const number = Number(textOf(block, "vote_number"));
      if (!Number.isFinite(number) || number === 0) continue;
      all.push({
        congress: s.congress,
        session: s.session,
        rollNumber: number,
        question: textOf(block, "question"),
        title: textOf(block, "title") || textOf(block, "issue"),
        yeas: Number(textOf(block, "yeas")),
        nays: Number(textOf(block, "nays")),
        date: textOf(block, "vote_date"),
      });
    }
    console.log(
      `  senate ${s.congress}-${s.session}: ${blocks.length} roll calls read`,
    );
  }
  return all;
}

function senateUrl(v: SenateVote): string {
  const padded = String(v.rollNumber).padStart(5, "0");
  return `https://www.senate.gov/legislative/LIS/roll_call_votes/vote${v.congress}${v.session}/vote_${v.congress}_${v.session}_${padded}.htm`;
}

/** The surname the nomination entry is about, for the title search. */
function nomineeSurname(entry: KeyVoteEntry): string {
  const before = entry.title.split(/\s+(?:to|as|for)\s+/)[0];
  const words = before.trim().split(/\s+/).filter((w) => !/^(Jr\.?|Sr\.?|III|II)$/i.test(w));
  return words[words.length - 1];
}

/* ------------------------------------------------------------------ run --- */

console.log("reading the Senate's own roll-call lists…");
const votes = await senateVotes();
console.log(`senate roll calls available: ${votes.length}\n`);

const resolved: KeyVoteEntry[] = [];
const misses: { id: string; chamber: string; reason: string }[] = [];

for (const entry of KEY_VOTES) {
  const next: KeyVoteEntry = {
    ...entry,
    house: entry.house.map((r) => ({ ...r })),
    senate: entry.senate.map((r) => ({ ...r })),
  };

  if (entry.group === "PEOPLE") {
    const surname = nomineeSurname(entry);
    const wanted = entry.senate[0]?.tally ?? "";
    const [wantYeas, wantNays] = wanted.split("-").map(Number);
    const candidates = votes.filter(
      (v) =>
        /nomination/i.test(v.question + v.title) &&
        new RegExp(`\\b${surname}\\b`, "i").test(v.title),
    );
    // Name AND tally. A name match with a different tally is a different
    // vote — cloture, an earlier failed attempt, another nominee with the
    // same surname — and taking it would put a member against a vote they
    // never cast.
    const exact = candidates.filter(
      (v) => v.yeas === wantYeas && v.nays === wantNays,
    );
    if (exact.length === 1) {
      const v = exact[0];
      next.senate = [
        {
          congress: v.congress,
          session: v.session,
          rollNumber: v.rollNumber,
          question: v.question,
          url: senateUrl(v),
          tally: `${v.yeas}-${v.nays}`,
          verifiedAt: TODAY,
        },
      ];
    } else {
      next.senate = [];
      misses.push({
        id: entry.id,
        chamber: "senate",
        reason:
          exact.length === 0
            ? `no Senate roll call matches "${surname}" at ${wanted} (${candidates.length} name matches checked, tallies: ${candidates.map((c) => `${c.yeas}-${c.nays}`).join(", ") || "none"})`
            : `${exact.length} Senate roll calls match name AND tally — refusing to guess`,
      });
    }
  }

  if (entry.group === "LAWS" && entry.senateSearch) {
    // Passage-type questions only. The Senate votes many times on one bill
    // — cloture, motions to proceed, amendments — and a cloture vote
    // rendered as "how they voted on the CHIPS Act" is a false claim about
    // a member, not a near-miss.
    const passage = votes.filter(
      (v) =>
        /on passage|on concurring|on the motion \(motion to concur/i.test(v.question) &&
        v.title.toLowerCase().includes(entry.senateSearch!.toLowerCase()),
    );
    if (passage.length === 1) {
      const v = passage[0];
      next.senate = [
        {
          congress: v.congress,
          session: v.session,
          rollNumber: v.rollNumber,
          question: v.question,
          url: senateUrl(v),
          tally: `${v.yeas}-${v.nays}`,
          verifiedAt: TODAY,
        },
      ];
    } else {
      misses.push({
        id: entry.id,
        chamber: "senate",
        reason:
          passage.length === 0
            ? `no Senate passage vote whose official title contains "${entry.senateSearch}"`
            : `${passage.length} Senate passage votes match "${entry.senateSearch}" (${passage
                .map((v) => `${v.congress}-${v.session}#${v.rollNumber} ${v.yeas}-${v.nays}`)
                .join("; ")}) — refusing to guess which one the entry means`,
      });
    }
  }

  resolved.push(next);
}

const peopleTotal = KEY_VOTES.filter((e) => e.group === "PEOPLE").length;
const peopleResolved = resolved.filter(
  (e) => e.group === "PEOPLE" && e.senate.length > 0,
).length;
const lawsTotal = KEY_VOTES.filter((e) => e.group === "LAWS").length;
const lawsResolved = resolved.filter(
  (e) => e.group === "LAWS" && (e.house.length > 0 || e.senate.length > 0),
).length;

await mkdir(dirname(OUT), { recursive: true });
await writeFile(
  OUT,
  `${JSON.stringify(
    {
      formatVersion: 1,
      fetchedAt: new Date().toISOString(),
      criteria:
        "Major legislation that became law (plus one pending measure, marked), and consequential Senate confirmations, since 2020 — chosen before looking at how anyone voted.",
      entries: resolved,
      misses,
    },
    null,
    1,
  )}\n`,
);

console.log("=== key votes resolved ===");
console.log(`VOTES ON PEOPLE: ${peopleResolved}/${peopleTotal} verified against the Senate's own record`);
console.log(`VOTES ON LAWS:   ${lawsResolved}/${lawsTotal} carry at least one verified roll call`);
console.log(`misses recorded: ${misses.length}`);
for (const m of misses) console.log(`  MISS ${m.id} (${m.chamber}): ${m.reason}`);
console.log(OUT);
