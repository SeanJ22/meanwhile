/**
 * The state-legislature voting record — tracker **D49**.
 *
 *   pnpm legiscan:fetch
 *
 * Bulk first, and only when something changed. LegiScan publishes each
 * session as one ZIP, refreshed Sunday mornings; `dataset_hash` is stored in
 * the snapshot and compared before every download. **An unchanged hash is
 * never re-downloaded** — that is both the polite thing and the condition of
 * keeping the key. The legiscan.com front end is never touched.
 *
 * `--force` re-downloads regardless, for when the parse changed rather than
 * the data.
 *
 * The join is stated, never assumed: every LegiScan `people_id` seen in a
 * roll call is matched to a roster seat by **district AND surname**, and the
 * run prints matched-over-seen per state plus the number of DISTINCT roster
 * ids the matches resolved to. A 100% rate pointing at one row is the D40
 * failure; a 0% rate is the cd:0 failure; both are visible here.
 *
 * The thin-snapshot guard, inherited from FEC: a refresh producing fewer
 * roll calls than the committed snapshot, for a session that has not ended,
 * FAILS and keeps the old file.
 */

import { config as loadEnv } from "dotenv";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { politeGetJson } from "../lib/sources/http.ts";
import {
  districtKeyFor,
  surname,
} from "../lib/sources/legiscan/districts.ts";
import type {
  LegiscanDatasetRecord,
  StateMemberVote,
  StateRollCall,
  StateVotePosition,
  StateVotesSnapshot,
} from "../lib/sources/legiscan/types.ts";
import { readZip } from "../lib/sources/legiscan/zip.ts";

import { COVERED_USPS, ROSTER_BY_USPS } from "../lib/coverage/artifacts.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
loadEnv({ path: join(ROOT, ".env.local") });

const STATES = COVERED_USPS;

/** Roster file per state. The coverage manifest, not a copy of it (AUD-06). */
const ROSTERS: Record<string, string> = ROSTER_BY_USPS;

const SNAPSHOT = join(ROOT, "data", "votes", "state-votes-snapshot.json");

/**
 * How many roll calls per MEMBER reach the snapshot.
 *
 * Arizona alone published 7,283 in one session; committing them all would be
 * tens of megabytes of file nobody renders. The clip has to be driven by the
 * surface, which shows one member's recent votes — so it is per member, not
 * per state. Taking the 60 most recent roll calls per state instead was
 * tried first and was wrong in a way worth recording: Arizona votes in
 * bursts, so 60 roll calls covered **two days**, and a member absent those
 * two days would have rendered an empty record that reads as "never votes".
 *
 * Every matched member contributes their own most recent N, and the union is
 * what ships. The number is stated here, in the run's own output, and in the
 * snapshot — a deliberate clip must not read as a failure.
 */
const ROLL_CALLS_PER_MEMBER = 12;

interface LegiscanPerson {
  people_id: number;
  name: string;
  role: string;
  district: string;
  party: string;
}

interface LegiscanRollCall {
  roll_call_id: number;
  bill_id: number;
  date: string;
  desc: string;
  yea: number;
  nay: number;
  nv: number;
  absent: number;
  passed: number;
  chamber: string;
  votes: Array<{ people_id: number; vote_id: number; vote_text: string }>;
}

interface LegiscanBill {
  bill_id: number;
  bill_number: string;
  title: string;
  url: string;
  state_link: string;
}

function positionOf(voteText: string): StateVotePosition {
  const t = voteText.trim().toLowerCase();
  if (t === "yea" || t === "yes") return "YES";
  if (t === "nay" || t === "no") return "NO";
  if (t === "absent") return "NOT_VOTING";
  if (t === "nv" || t === "not voting") return "NOT_VOTING";
  // LegiScan records exactly these four; anything else is a new state and
  // must be seen rather than folded into one of ours.
  throw new Error(`unmapped LegiScan vote text: "${voteText}"`);
}

async function readPreviousSnapshot(): Promise<StateVotesSnapshot | null> {
  try {
    return JSON.parse(await readFile(SNAPSHOT, "utf8")) as StateVotesSnapshot;
  } catch {
    return null;
  }
}

async function main() {
  const force = process.argv.includes("--force");
  const key = process.env.LEGISCAN_API_KEY?.trim();
  if (!key) throw new Error("LEGISCAN_API_KEY is not set");
  const api = `https://api.legiscan.com/?key=${key}`;

  const previous = await readPreviousSnapshot();
  const previousByState = new Map(
    (previous?.datasets ?? []).map((d) => [d.state, d]),
  );

  const datasets: LegiscanDatasetRecord[] = [];
  const rollCalls: StateRollCall[] = [];
  const positions: StateMemberVote[] = [];
  const byState: StateVotesSnapshot["identifierMatch"]["byState"] = {};
  const matchedRosterIds = new Set<string>();
  let peopleSeen = 0;
  let peopleMatched = 0;
  const retrievedAt = new Date().toISOString();

  for (const state of STATES) {
    const list = await politeGetJson<{
      status: string;
      datasetlist: Array<{
        session_id: number;
        session_name: string;
        year_start: number;
        special: number;
        dataset_hash: string;
        dataset_date: string;
        access_key: string;
      }>;
    }>(`${api}&op=getDatasetList&state=${state}`);
    if (list.status !== "OK") throw new Error(`${state}: getDatasetList ${list.status}`);

    // The current regular session: newest start year, never a special.
    const current = list.datasetlist
      .filter((d) => !d.special)
      .sort((a, b) => b.year_start - a.year_start)[0];
    if (!current) throw new Error(`${state}: no regular session in the dataset list`);

    const prior = previousByState.get(state);
    const unchanged =
      !force &&
      prior?.sessionId === current.session_id &&
      prior?.datasetHash === current.dataset_hash;

    if (unchanged && previous) {
      // Carry the previous rows forward verbatim. Never re-download.
      console.log(
        `${state}: dataset_hash unchanged (${current.dataset_hash}) — not re-downloaded`,
      );
      datasets.push({ ...prior, downloadedAt: prior.downloadedAt });
      const kept = previous.rollCalls.filter((r) => r.state === state);
      const keptIds = new Set(kept.map((r) => r.id));
      rollCalls.push(...kept);
      positions.push(
        ...previous.positions.filter((p) => keptIds.has(p.rollCallId)),
      );
      byState[state] = previous.identifierMatch.byState[state] ?? {
        peopleSeen: 0,
        peopleMatched: 0,
        rollCalls: kept.length,
      };
      for (const p of previous.positions) {
        if (keptIds.has(p.rollCallId)) matchedRosterIds.add(p.officeholderId);
      }
      peopleSeen += byState[state].peopleSeen;
      peopleMatched += byState[state].peopleMatched;
      continue;
    }

    const payload = await politeGetJson<{
      status: string;
      dataset: { zip: string };
    }>(`${api}&op=getDataset&id=${current.session_id}&access_key=${current.access_key}`);
    if (payload.status !== "OK") throw new Error(`${state}: getDataset ${payload.status}`);

    const entries = readZip(Buffer.from(payload.dataset.zip, "base64"));
    const people = new Map<number, LegiscanPerson>();
    const bills = new Map<number, LegiscanBill>();
    const raw: LegiscanRollCall[] = [];
    for (const entry of entries) {
      // The archive's root also carries a README and a hash manifest, which
      // are not JSON. Route on the directory the dataset itself uses rather
      // than trying to parse everything and swallowing what fails.
      if (!/\/(people|bill|vote)\/[^/]+\.json$/.test(entry.name)) continue;
      const parsed = JSON.parse(entry.data.toString("utf8"));
      if (parsed.person) people.set(parsed.person.people_id, parsed.person);
      else if (parsed.bill) bills.set(parsed.bill.bill_id, parsed.bill);
      else if (parsed.roll_call) raw.push(parsed.roll_call);
    }
    if (people.size === 0 || raw.length === 0) {
      throw new Error(
        `${state}: dataset unpacked to ${people.size} people and ${raw.length} roll calls — a zero is never a clean run`,
      );
    }

    // ── The join, stated ────────────────────────────────────────────────────
    const roster = JSON.parse(
      await readFile(join(ROOT, "lib", "registry", ROSTERS[state]), "utf8"),
    ) as {
      officeholders: Array<{ id: string; name: string }>;
      divisions: Record<string, { officeholderId: string; ocdId: string }>;
    };
    const holderById = new Map(roster.officeholders.map((h) => [h.id, h]));
    const seatsByDistrict = new Map<string, Array<{ id: string; name: string }>>();
    for (const link of Object.values(roster.divisions)) {
      const m = /\/(sldl|sldu):(\d+)$/.exec(link.ocdId);
      if (!m) continue;
      const holder = holderById.get(link.officeholderId);
      if (!holder) continue;
      const k = `${m[1]}:${Number(m[2])}`;
      const list = seatsByDistrict.get(k) ?? [];
      list.push(holder);
      seatsByDistrict.set(k, list);
    }

    const peopleIdToOfficeholder = new Map<number, string>();
    let seen = 0;
    let matched = 0;
    for (const person of people.values()) {
      seen++;
      const key = districtKeyFor(state, person.district);
      if (!key) continue;
      const seats = seatsByDistrict.get(key);
      if (!seats?.length) continue;
      // District AND surname. Never the name alone.
      const hit = seats.find((s) => surname(s.name) === surname(person.name));
      if (!hit) continue;
      matched++;
      peopleIdToOfficeholder.set(person.people_id, hit.id);
      matchedRosterIds.add(hit.id);
    }

    // ── The rows ────────────────────────────────────────────────────────────
    // Newest first, then each matched member claims their own most recent N.
    // The union is the clip: it guarantees every member with a record has a
    // record to render, which a per-state cut does not.
    const dated = raw
      .filter((r) => r.date)
      .sort((a, b) => b.date.localeCompare(a.date));
    const claimed = new Set<number>();
    const takenPerMember = new Map<string, number>();
    for (const r of dated) {
      for (const v of r.votes) {
        const officeholderId = peopleIdToOfficeholder.get(v.people_id);
        if (!officeholderId) continue;
        const taken = takenPerMember.get(officeholderId) ?? 0;
        if (taken >= ROLL_CALLS_PER_MEMBER) continue;
        takenPerMember.set(officeholderId, taken + 1);
        claimed.add(r.roll_call_id);
      }
    }
    const recent = dated.filter((r) => claimed.has(r.roll_call_id));

    for (const r of recent) {
      const bill = bills.get(r.bill_id);
      const id = `legiscan:${r.roll_call_id}`;
      rollCalls.push({
        id,
        state,
        sessionId: current.session_id,
        billNumber: bill?.bill_number ?? "",
        billTitle: bill?.title ?? "",
        motion: r.desc,
        date: r.date,
        yea: r.yea,
        nay: r.nay,
        absent: r.absent,
        nv: r.nv,
        result: `${r.passed ? "Passed" : "Failed"} ${r.yea}-${r.nay}`,
        billUrl: bill?.state_link || null,
        rollCallUrl: `https://legiscan.com/${state}/rollcall/${r.roll_call_id}`,
        retrievedAt,
      });
      for (const v of r.votes) {
        const officeholderId = peopleIdToOfficeholder.get(v.people_id);
        // No join, no render. An unmatched member's vote is not stored
        // against a guess at who they are.
        if (!officeholderId) continue;
        positions.push({
          officeholderId,
          legiscanPeopleId: v.people_id,
          rollCallId: id,
          position: positionOf(v.vote_text),
        });
      }
    }

    datasets.push({
      state,
      sessionId: current.session_id,
      sessionName: current.session_name,
      datasetHash: current.dataset_hash,
      datasetDate: current.dataset_date,
      downloadedAt: retrievedAt,
    });
    byState[state] = { peopleSeen: seen, peopleMatched: matched, rollCalls: recent.length };
    peopleSeen += seen;
    peopleMatched += matched;

    console.log(
      `${state}: ${people.size} people, ${raw.length} roll calls published, ` +
        `${recent.length} kept (the union of each member's ${ROLL_CALLS_PER_MEMBER} most recent — a stated clip); ` +
        `join ${matched}/${seen} people matched to ${new Set([...peopleIdToOfficeholder.values()]).size} distinct roster seats`,
    );
  }

  // ── The thin-snapshot guard ─────────────────────────────────────────────
  if (previous) {
    for (const state of STATES) {
      const before = previous.rollCalls.filter((r) => r.state === state).length;
      const after = rollCalls.filter((r) => r.state === state).length;
      const sessionChanged =
        previous.datasets.find((d) => d.state === state)?.sessionId !==
        datasets.find((d) => d.state === state)?.sessionId;
      if (after < before && !sessionChanged) {
        throw new Error(
          `${state}: refresh produced ${after} roll calls against ${before} committed, ` +
            `with no session boundary to explain it — keeping the old snapshot`,
        );
      }
    }
  }

  const snapshot: StateVotesSnapshot = {
    generatedAt: retrievedAt,
    datasets,
    identifierMatch: {
      peopleSeen,
      peopleMatched,
      distinctOfficeholders: matchedRosterIds.size,
      byState,
    },
    rollCalls,
    positions,
  };

  await writeFile(SNAPSHOT, `${JSON.stringify(snapshot, null, 1)}\n`, "utf8");
  console.log(
    `\nwrote ${SNAPSHOT}\n  ${rollCalls.length} roll calls, ${positions.length} recorded positions, ` +
      `${matchedRosterIds.size} officeholders with a voting record`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
