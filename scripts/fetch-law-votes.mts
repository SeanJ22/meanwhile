/**
 * `pnpm law-votes:fetch` — resolve the LAWS half of the key-votes list
 * against the official record, and write what it found.
 *
 * Tracker B15 (votes on laws) and B17 (the congress.gov route). Votes on
 * PEOPLE shipped 2026-08-15 through `pnpm key-votes:fetch`; this is the
 * named remainder, and the author's list in `lib/votes/key-votes.ts` is the
 * spec — closed, not to be extended, curated or reordered.
 *
 * The route, and every refusal in it, is documented in
 * `scripts/law-votes-resolver.mts`. What this file adds is the sweep, the
 * merge into the existing snapshot, and the counting.
 *
 * ## It merges, it does not overwrite
 *
 * The snapshot already holds sixteen verified nominations. A run of this
 * script that rewrote the file from scratch would delete them on any day
 * the Senate's own site was down, which is the failed-fetch-empties-a-full-
 * surface defect one layer up. So it reads the existing snapshot, replaces
 * only the LAWS entries it actually resolved, and leaves everything else
 * exactly as it found it — including LAWS entries an earlier run resolved
 * and this one could not.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadEnv } from "dotenv";

import {
  KEY_VOTES_LAWS,
  type KeyVoteEntry,
  type RollCallRef,
} from "../lib/votes/key-votes.ts";
import {
  decidingVotes,
  lawsOfCongress,
  matchByTitle,
  measuresVotedInHouse,
  relatedBillsOf,
  titlesOf,
  type LawRecord,
} from "./law-votes-resolver.mts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data", "votes", "key-votes-snapshot.json");

// The key reads from .env.local into THIS script only. It is never wired
// into the deploy environment and never reaches the client.
loadEnv({ path: join(ROOT, ".env.local") });

const apiKey = process.env.CONGRESS_API_KEY;
if (!apiKey) {
  console.error("CONGRESS_API_KEY missing from .env.local — cannot resolve");
  process.exit(1);
}

/**
 * Today, passed in rather than computed, because an agent does not know the
 * date and a plausible one is a fabrication (CLAUDE.md). `pnpm stamp`
 * prints it; the workflow passes it.
 */
const TODAY = process.argv.find((a) => a.startsWith("--today="))?.slice(8);
if (!TODAY || !/^\d{4}-\d{2}-\d{2}$/.test(TODAY)) {
  console.error("pass --today=YYYY-MM-DD (from `pnpm stamp`) — never a guessed date");
  process.exit(1);
}

/** The congresses the author's list spans. */
const CONGRESSES = [116, 117, 118, 119];

interface Miss {
  id: string;
  reason: string;
}
const misses: Miss[] = [];

console.log("=== law votes: resolving against the official record ===");

// ── Pass 0: the official law list, per congress ─────────────────────────
const byCongress = new Map<number, LawRecord[]>();
for (const congress of CONGRESSES) {
  const laws = await lawsOfCongress(congress, apiKey);
  byCongress.set(congress, laws);
  // Stated count, always: a congress returning zero is a fetch failure
  // wearing an empty list, and reading it as "no law matches" would turn
  // our outage into a claim about Congress.
  console.log(`  congress ${congress}: ${laws.length} public laws listed`);
  if (laws.length === 0) {
    console.log(
      `  WARNING congress ${congress} listed nothing — treating as UNREACHABLE, not as empty`,
    );
  }
}
const allLaws = CONGRESSES.flatMap((c) => byCongress.get(c) ?? []);
console.log(`  ${allLaws.length} public laws across ${CONGRESSES.length} congresses`);

// ── Pass 1: match each entry's popular name against the listed titles ────
const entriesWithSearch = KEY_VOTES_LAWS.filter((e) => e.lawSearch);
console.log(
  `\n${entriesWithSearch.length} of ${KEY_VOTES_LAWS.length} law entries carry a popular name to search`,
);

const resolvedLaw = new Map<string, LawRecord>();
const unresolved: KeyVoteEntry[] = [];

for (const entry of entriesWithSearch) {
  const hits = matchByTitle(allLaws, entry.lawSearch!);
  if (hits.length === 1) {
    resolvedLaw.set(entry.id, hits[0]);
  } else if (hits.length === 0) {
    unresolved.push(entry);
  } else {
    // Ambiguity refuses. Two laws whose titles both contain the phrase is
    // a miss with both named, never a coin toss.
    misses.push({
      id: entry.id,
      reason: `${hits.length} public laws' titles contain "${entry.lawSearch}" (${hits
        .map((h) => `${h.type.toUpperCase()}${h.number} ${h.lawNumber ?? "?"}`)
        .join("; ")}) — refusing to guess which`,
    });
  }
}
console.log(
  `  pass 1 (short titles): ${resolvedLaw.size} resolved, ${unresolved.length} need the full title sweep, ${misses.length} ambiguous`,
);

// ── Pass 1.5: siblings, through the vehicle's own related-bills record ───
//
// A bill folded into another one appears in no public-law list under any
// title, so the law-list route structurally cannot reach it. Reporting that
// as "no such law" would describe our route rather than the record. The
// vehicle names its siblings itself.
//
// Runs before the full-title sweep because a sibling resolved here never
// needs to be swept for — and the sweep is hundreds of requests.
{
  const stillUnresolved: KeyVoteEntry[] = [];
  for (const entry of unresolved) {
    if (!entry.siblingGroup) {
      stillUnresolved.push(entry);
      continue;
    }
    // A sibling in the same group that DID resolve to a law is the vehicle.
    const vehicleEntry = KEY_VOTES_LAWS.find(
      (e) => e.siblingGroup === entry.siblingGroup && resolvedLaw.has(e.id),
    );
    const vehicle = vehicleEntry ? resolvedLaw.get(vehicleEntry.id) : undefined;
    if (!vehicle) {
      stillUnresolved.push(entry);
      continue;
    }
    const related = await relatedBillsOf(vehicle, apiKey);
    const hits = matchByTitle(related, entry.lawSearch!);
    if (hits.length === 1) {
      resolvedLaw.set(entry.id, hits[0]);
      console.log(
        `    ${entry.id} -> ${hits[0].type.toUpperCase()}${hits[0].number} via ${vehicle.type.toUpperCase()}${vehicle.number}'s related bills (${related.length} listed)`,
      );
    } else if (hits.length > 1) {
      misses.push({
        id: entry.id,
        reason: `${hits.length} bills related to ${vehicle.type.toUpperCase()}${vehicle.number} carry the title "${entry.lawSearch}" — refusing to guess which`,
      });
    } else {
      stillUnresolved.push(entry);
    }
  }
  unresolved.length = 0;
  unresolved.push(...stillUnresolved);
  console.log(
    `  pass 1.5 (sibling vehicles): ${resolvedLaw.size} resolved in total, ${unresolved.length} still unplaced`,
  );
}

// ── Pass 2: the full title sweep, only for what pass 1 could not place ───
//
// Hundreds of requests, so it runs only over the entries that genuinely
// need it. The Inflation Reduction Act is the case: its official title
// names a budget resolution and no reader would recognise it.
if (unresolved.length > 0) {
  console.log(`\n  pass 2: sweeping full titles for ${unresolved.length} entries`);
  for (const entry of unresolved) {
    const needle = entry.lawSearch!.toLowerCase();
    const found: LawRecord[] = [];
    for (const law of allLaws) {
      // Skip laws already claimed by another entry — cheap, and it keeps
      // the sweep from re-reading the ones pass 1 placed.
      if ([...resolvedLaw.values()].includes(law)) continue;
      const titles = await titlesOf(law, apiKey);
      if (titles.some((t) => t.toLowerCase().includes(needle))) {
        found.push(law);
        break; // first exact title match is enough; ambiguity is caught below
      }
      await new Promise((r) => setTimeout(r, 60));
    }
    if (found.length === 1) {
      resolvedLaw.set(entry.id, found[0]);
      console.log(
        `    ${entry.id} -> ${found[0].type.toUpperCase()}${found[0].number} (${found[0].lawNumber ?? "?"}) via full titles`,
      );
    } else {
      misses.push({
        id: entry.id,
        reason: `no public law in congresses ${CONGRESSES.join("/")} carries the title "${entry.lawSearch}", in either the short title or the full title list`,
      });
    }
  }
}

// ── Pass 2.5: pending measures, through the House's own roll-call index ──
//
// A bill that has not become law is in no public-law list, so every pass
// above misses it structurally. The House's index of its own roll calls
// carries the bill numbers and NO titles — so searching that index's text
// is the false-miss shape, and the titles have to be resolved behind it.
for (const entry of KEY_VOTES_LAWS) {
  if (!entry.pendingSearch || resolvedLaw.has(entry.id)) continue;
  console.log(`\n  pass 2.5: pending measure ${entry.id}`);
  let found: LawRecord[] = [];
  for (const congress of [...CONGRESSES].reverse()) {
    const measures = await measuresVotedInHouse(
      congress,
      apiKey,
      join(ROOT, "data", "votes", "house-measure-titles-cache.json"),
    );
    found = matchByTitle(measures, entry.pendingSearch);
    if (found.length > 0) break;
  }
  if (found.length === 1) {
    resolvedLaw.set(entry.id, found[0]);
    console.log(
      `    ${entry.id} -> ${found[0].type.toUpperCase()}${found[0].number} via the House's own roll-call index`,
    );
  } else {
    misses.push({
      id: entry.id,
      reason:
        found.length === 0
          ? `no measure the House recorded a vote on carries the title "${entry.pendingSearch}"`
          : `${found.length} measures the House voted on carry the title "${entry.pendingSearch}" — refusing to guess which`,
    });
  }
}

// ── Pass 3: the bill's own recorded votes ───────────────────────────────
console.log(`\n  pass 3: reading recorded votes for ${resolvedLaw.size} bills`);

const rollsById = new Map<string, { house: RollCallRef[]; senate: RollCallRef[] }>();

for (const [id, law] of resolvedLaw) {
  const { votes, considered } = await decidingVotes(law, apiKey);
  const house = votes.filter((v) => v.chamber === "House");
  const senate = votes.filter((v) => v.chamber === "Senate");
  console.log(
    `    ${id} (${law.type.toUpperCase()}${law.number}): ${considered} actions, ${house.length} House, ${senate.length} Senate`,
  );
  if (votes.length === 0) {
    misses.push({
      id,
      reason: `${law.type.toUpperCase()}${law.number} carries ${considered} actions and none of them is a recorded passage vote this resolver accepts`,
    });
    continue;
  }
  const toRef = (v: (typeof votes)[number]): RollCallRef => ({
    congress: v.congress,
    session: v.session,
    rollNumber: v.rollNumber,
    question: v.question,
    url: v.url,
    tally: v.tally,
    verifiedAt: TODAY,
  });
  rollsById.set(id, { house: house.map(toRef), senate: senate.map(toRef) });
}

// ── Merge into the existing snapshot ─────────────────────────────────────
let existing: {
  formatVersion?: number;
  fetchedAt?: string;
  criteria?: string;
  entries?: (KeyVoteEntry & { house: RollCallRef[]; senate: RollCallRef[] })[];
  misses?: unknown[];
} = {};
try {
  existing = JSON.parse(await readFile(OUT, "utf8"));
} catch {
  console.log("  no existing snapshot — writing a fresh one");
}

const priorEntries = existing.entries ?? [];
let replaced = 0;
let keptPrior = 0;
let refusedShrink = 0;

/*
 * A RUN MAY ADD REFS. IT MAY NEVER TAKE ONE AWAY.
 *
 * This rule was written after the first run of this script did exactly
 * that. The committed snapshot already carried 18 of 20 law entries with
 * both chambers resolved — earlier work this session had not checked, since
 * the docblock in lib/votes/key-votes.ts still said the LAWS entries
 * carried none. The run then "resolved" the four April 2024 siblings to
 * their Senate VEHICLE, which has no House vote of its own, and wrote that
 * over four correct House roll calls. House coverage went 18 to 16.
 *
 * The general shape is the refresh corollary one layer along: a retrieval
 * that finds less must not be written into the data as an absence. So a
 * per-chamber replacement happens only when the new result is not smaller
 * than what is already there, and a refusal is COUNTED and PRINTED rather
 * than passed over — a run that silently declined to improve anything and a
 * run that improved everything must not print the same.
 *
 * A genuine correction that legitimately reduces a chamber's refs is
 * therefore not this script's job. It is a deliberate edit, made by someone
 * who has looked at both.
 */
const keepBigger = (
  next: RollCallRef[],
  prior: RollCallRef[],
): { refs: RollCallRef[]; refused: boolean } =>
  next.length >= prior.length
    ? { refs: next, refused: false }
    : { refs: prior, refused: true };

const merged = priorEntries.map((entry) => {
  if (entry.group !== "LAWS") return entry;
  const rolls = rollsById.get(entry.id);
  if (!rolls) {
    // A law this run could not resolve keeps whatever an earlier run
    // verified. A failed retrieval never empties a previously-full row.
    if (entry.house.length > 0 || entry.senate.length > 0) keptPrior++;
    return entry;
  }
  const house = keepBigger(rolls.house, entry.house);
  const senate = keepBigger(rolls.senate, entry.senate);
  if (house.refused || senate.refused) {
    refusedShrink++;
    console.log(
      `    KEPT PRIOR ${entry.id}: this run found ${rolls.house.length}H/${rolls.senate.length}S against ${entry.house.length}H/${entry.senate.length}S already recorded — a run never removes a ref`,
    );
  }
  if (
    house.refs !== entry.house ||
    senate.refs !== entry.senate ||
    rolls.house.length > entry.house.length ||
    rolls.senate.length > entry.senate.length
  ) {
    replaced++;
  }
  return { ...entry, house: house.refs, senate: senate.refs };
});

// An entry the prior snapshot never carried at all still has to appear.
for (const entry of KEY_VOTES_LAWS) {
  if (merged.some((e) => e.id === entry.id)) continue;
  const rolls = rollsById.get(entry.id);
  merged.push({ ...entry, house: rolls?.house ?? [], senate: rolls?.senate ?? [] });
  if (rolls) replaced++;
}

await mkdir(dirname(OUT), { recursive: true });
await writeFile(
  OUT,
  `${JSON.stringify(
    {
      ...existing,
      formatVersion: existing.formatVersion ?? 1,
      lawVotesFetchedAt: new Date().toISOString(),
      entries: merged,
      lawMisses: misses,
    },
    null,
    1,
  )}\n`,
);

// ── The counts, with denominators ───────────────────────────────────────
const lawsTotal = KEY_VOTES_LAWS.length;
const lawsWithVotes = merged.filter(
  (e) => e.group === "LAWS" && (e.house.length > 0 || e.senate.length > 0),
).length;
const pendingCount = KEY_VOTES_LAWS.filter((e) => e.pending).length;

console.log("\n=== law votes resolved ===");
console.log(`  bills identified in the official record: ${resolvedLaw.size}/${entriesWithSearch.length} searchable entries`);
console.log(`  entries whose roll calls this run replaced: ${replaced}`);
console.log(`  entries keeping an earlier run's verified rolls: ${keptPrior}`);
console.log(`  entries where this run found FEWER refs and was refused: ${refusedShrink}`);
console.log(`  LAWS carrying at least one roll call: ${lawsWithVotes}/${lawsTotal}`);
console.log(`  of the ${lawsTotal}, ${pendingCount} is pending and has no law to resolve`);
console.log(`  misses recorded: ${misses.length}`);
for (const m of misses) console.log(`    MISS ${m.id}: ${m.reason}`);
console.log(OUT);
