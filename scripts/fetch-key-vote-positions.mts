/**
 * How each SITTING member voted on each key-vote roll call (item 6b,
 * 2026-08-15).
 *
 *   pnpm key-votes:positions
 *
 * ## Why this run has to exist
 *
 * B15 resolved WHICH roll call answers each of the author's questions, and
 * B17 verified 18 of the 20 law entries against the chambers' own records.
 * Neither fetched how anybody VOTED. The card component was already written
 * to render a position per member per roll call, and with nothing to render
 * it fell through to its default — `"Did not vote"` — which is a specific,
 * false, checkable claim about a named member of Congress. It was never
 * visible because the section had not been wired to a surface yet. That is
 * the whole class of defect this repo keeps naming: the empty answer and the
 * confident wrong answer wearing the same clothes.
 *
 * So: this fetches every key-vote roll call the snapshot already cites — the
 * URLs are recorded per ref and were verified by B17 — and extracts the
 * per-member position for every member of the CURRENT roster.
 *
 * ## What it deliberately does not do
 *
 * It does not re-resolve which roll call an entry points at. That question is
 * B15/B17's and is answered in the committed snapshot; re-deciding it here
 * would give one product two opinions about what "the vote on the gun law"
 * means. This run reads the refs and asks one question of each: who voted
 * how.
 *
 * ## The identifier match, with denominators
 *
 * The House keys members by bioguide in `name-id`; the Senate keys them by
 * LIS id, bridged through the public-domain legislators-current file. Both
 * rates print with their denominators, per the standing rule — a zero-match
 * join looks exactly like a thin roster and must be loud. A LOW rate here is
 * EXPECTED and is not a failure: these roll calls run back to the 116th
 * Congress, and most of the people who voted in them are no longer in office.
 * The number that matters is how many CURRENT members were matched.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import type { KeyVoteEntry } from "../lib/votes/key-votes.ts";
import type { VotePosition } from "../lib/votes/types.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SNAPSHOT = join(ROOT, "data", "votes", "key-votes-snapshot.json");
const OUT = join(ROOT, "data", "votes", "key-vote-positions.json");
const UA = "we-the-people-civic-app/0.1 (contact: seanj22@gmail.com)";

/** One serialized request at a time, spaced. Same manners as every retrieval. */
const SPACING_MS = 350;

async function get(url: string): Promise<string> {
  await new Promise((r) => setTimeout(r, SPACING_MS));
  const response = await fetch(url, { headers: { "user-agent": UA } });
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
  return response.text();
}

function mapPosition(raw: string): VotePosition | null {
  const v = raw.trim().toLowerCase();
  if (v === "yea" || v === "aye" || v === "yes" || v === "guilty") return "YES";
  if (v === "nay" || v === "no" || v === "not guilty") return "NO";
  if (v === "present") return "PRESENT";
  if (v === "not voting" || v === "absent") return "NOT_VOTING";
  return null;
}

interface Snapshot {
  entries: KeyVoteEntry[];
}

const snapshot = JSON.parse(await readFile(SNAPSHOT, "utf8")) as Snapshot;

const legislators = JSON.parse(
  await get(
    "https://unitedstates.github.io/congress-legislators/legislators-current.json",
  ),
) as { id: { bioguide: string; lis?: string } }[];

const currentBioguides = new Set<string>();
const lisToBioguide = new Map<string, string>();
for (const person of legislators) {
  currentBioguides.add(person.id.bioguide);
  if (person.id.lis) lisToBioguide.set(person.id.lis, person.id.bioguide);
}

/** `<entryId>|<chamber>|<congress>-<session>:<roll>` → officeholderId → position. */
const byRef = new Map<string, Record<string, VotePosition>>();

let refsSeen = 0;
let refsFetched = 0;
const failures: string[] = [];
let houseSeen = 0;
let houseCurrent = 0;
let senateSeen = 0;
let senateCurrent = 0;

for (const entry of snapshot.entries) {
  for (const chamber of ["house", "senate"] as const) {
    for (const ref of entry[chamber]) {
      refsSeen += 1;
      if (!ref.url) {
        failures.push(`${entry.id}/${chamber}/${ref.rollNumber}: no url recorded`);
        continue;
      }
      /*
       * The Senate publishes each roll call at two paths: `.htm` for people
       * and `.xml` for machines, at otherwise identical URLs. B15/B17 cited
       * the `.htm` for the nomination entries because that is the page a
       * reader should be sent to — which is right, and which is why the
       * first run of THIS script parsed zero positions from all sixteen of
       * them and said so instead of writing sixteen empty maps. The cited
       * URL stays the reader's; the machine-readable sibling is what gets
       * parsed.
       */
      const machineUrl = ref.url.endsWith(".htm")
        ? `${ref.url.slice(0, -4)}.xml`
        : ref.url;

      let xml: string;
      try {
        xml = await get(machineUrl);
      } catch (error) {
        failures.push(
          `${entry.id}/${chamber}/${ref.rollNumber}: ${(error as Error).message}`,
        );
        continue;
      }
      refsFetched += 1;

      const positions: Record<string, VotePosition> = {};

      if (chamber === "house") {
        for (const m of xml.matchAll(
          /<recorded-vote>\s*<legislator name-id="([^"]+)"[^>]*>[\s\S]*?<\/legislator>\s*<vote>([^<]+)<\/vote>\s*<\/recorded-vote>/g,
        )) {
          houseSeen += 1;
          if (!currentBioguides.has(m[1])) continue;
          houseCurrent += 1;
          const position = mapPosition(m[2]);
          if (position) positions[`congress:${m[1]}`] = position;
        }
      } else {
        for (const m of xml.matchAll(
          /<member>[\s\S]*?<vote_cast>([^<]+)<\/vote_cast>[\s\S]*?<lis_member_id>([^<]+)<\/lis_member_id>[\s\S]*?<\/member>/g,
        )) {
          senateSeen += 1;
          const bioguide = lisToBioguide.get(m[2]);
          if (!bioguide) continue;
          senateCurrent += 1;
          const position = mapPosition(m[1]);
          if (position) positions[`congress:${bioguide}`] = position;
        }
      }

      const key = `${entry.id}|${chamber}|${ref.congress}-${ref.session}:${ref.rollNumber}`;
      // A roll call that parsed to ZERO positions is reported, never written
      // as an empty object that a card would read as "nobody voted".
      if (Object.keys(positions).length === 0) {
        failures.push(
          `${entry.id}/${chamber}/${ref.rollNumber}: parsed 0 positions from ${machineUrl}`,
        );
        continue;
      }
      byRef.set(key, positions);
    }
  }
}

const payload = {
  formatVersion: 1 as const,
  fetchedAt: new Date().toISOString(),
  note:
    "Per-roll-call positions for the SITTING members only, keyed <entryId>|<chamber>|<congress>-<session>:<roll>. Members who have left office are deliberately absent: their cards do not exist. An officeholder missing from a ref's map means we hold no position for them on that roll call — which the card must say as OUR gap, never as 'did not vote'.",
  positions: Object.fromEntries(byRef),
};

await writeFile(OUT, `${JSON.stringify(payload, null, 1)}\n`, "utf8");

console.log(
  [
    `refs: ${refsFetched} fetched of ${refsSeen} cited`,
    `house: ${houseCurrent} current of ${houseSeen} recorded votes`,
    `senate: ${senateCurrent} current of ${senateSeen} recorded votes`,
    `roll calls with positions: ${byRef.size}`,
    `wrote ${OUT}`,
  ].join("\n"),
);
if (failures.length) {
  console.log(`\n${failures.length} ref(s) produced nothing:`);
  for (const f of failures) console.log(`  ${f}`);
}
