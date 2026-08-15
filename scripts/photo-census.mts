/**
 * The photo census (session brief 5, wall clock 2026-08-14): a SCRIPT, not
 * an eyeball pass, that walks every person the product renders — ballot
 * candidates, roster officials, state legislators, curated local rosters —
 * and counts portrait vs initials, by state and by surface. It writes the
 * census into docs/photo-report.md (superseding, keeping the six recorded
 * ballot-candidate hunts and every shipped photo's row), and its named
 * miss list IS the shopping list for the dedicated photo session.
 *
 * `pnpm exec tsx scripts/photo-census.mts`
 *
 * COUNT ONLY. This script fetches nothing, changes no image, and hunts no
 * rung — the author's call: photos get a dedicated session; this session
 * produces that session's brief input.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { BODY_ROSTERS } from "../lib/registry/body-rosters.ts";
import { STATEWIDE_EXECUTIVES } from "../lib/officials/statewide-executives.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));

interface PersonRow {
  surface: string;
  state: string;
  name: string;
  hasPortrait: boolean;
  /** Where the portrait (or its absence) is recorded. */
  note: string | null;
}

const people: PersonRow[] = [];

// ── The photo manifest — the single source for official portraits ───────
// Every surface with a stable officeholder-style id resolves through it,
// so the census reflects whatever actually ships, tier by tier.
const manifest = read("lib/registry/official-photos.json") as {
  photos: {
    officeholderId: string;
    name: string;
    url: string;
    sourceUrl: string;
    license: string | null;
  }[];
  missing: { officeholderId: string; name: string; reason: string }[];
};
const shippedIds = new Set(
  manifest.photos.filter((p) => p.license).map((p) => p.officeholderId),
);

// ── The covered division universe — what can actually render ────────────
const registry = read("lib/registry/registry.json") as {
  divisions: { ocdId: string }[];
};
const coveredOcdIds = new Set(registry.divisions.map((d) => d.ocdId));

function stateOfOcdId(ocdId: string): string {
  const m = /state:(\w\w)/.exec(ocdId);
  return m ? m[1].toUpperCase() : "??";
}

// ── Surface 1: ballot candidates (cards + lineup nominees) ──────────────
const cardsFile = read("data/ballot/candidate-cards-2026.json") as {
  cards: Record<string, { photoUrl: string | null }>;
};

const BALLOT_FILES: { file: string; state: string }[] = [
  { file: "nj-morris-2026.json", state: "NJ" },
  { file: "az-pima-2026.json", state: "AZ" },
  { file: "nh-merrimack-2026.json", state: "NH" },
];
for (const { file, state } of BALLOT_FILES) {
  const data = read(`data/ballot/${file}`) as {
    candidacies: { id: string; familyName: string; givenName: string }[];
  };
  for (const cand of data.candidacies) {
    const card = cardsFile.cards[cand.id];
    people.push({
      surface: "ballot candidates",
      state,
      name: `${cand.givenName} ${cand.familyName}`,
      hasPortrait: Boolean(card?.photoUrl),
      note: card
        ? card.photoUrl
          ? null
          : "curated card, photo fell to initials (recorded hunt)"
        : "no curated card — renders initials",
    });
  }
}
const lineup = read("data/ballot/az-general-lineup-2026.json") as {
  contests: { contestId: string; nominees: { name: string }[] }[];
};
// Lineup nominees render on the AZ ballot surface; a nominee who is also
// a candidacy (the governor's race) must not be double-counted.
const candidacyNames = new Set(
  people.filter((p) => p.surface === "ballot candidates").map((p) => p.name),
);
for (const contest of lineup.contests) {
  for (const nominee of contest.nominees) {
    if (candidacyNames.has(nominee.name)) continue;
    const cardKey = `${contest.contestId}|${nominee.name}`;
    const card = cardsFile.cards[cardKey];
    people.push({
      surface: "ballot candidates",
      state: "AZ",
      name: nominee.name,
      hasPortrait: Boolean(card?.photoUrl),
      note: card?.photoUrl ? null : "lineup nominee — renders initials",
    });
  }
}

// ── Surface 2: federal roster officials (map popups, official modal) ────
const us = read("lib/registry/officeholders-us.json") as {
  officeholders: { id: string; name: string }[];
  divisions: { officeholderId: string; ocdId: string }[];
};
const usRendered = new Map<string, string>(); // id -> state
// House members render through the NATIONAL congressional-district layer
// (every cd division rides the registry), so all attached House members
// are genuinely renderable via district popups anywhere on the map.
for (const d of us.divisions) {
  if (coveredOcdIds.has(d.ocdId)) {
    usRendered.set(d.officeholderId, stateOfOcdId(d.ocdId));
  }
}
// Senators attach to state-root divisions, which the registry does not
// carry — they render through coverage.senators, resolved for the states
// the registry covers at the local tier. Derive those states from the
// registry itself, never hardcode.
const localTierStates = new Set(
  registry.divisions
    .filter((d) => (d as { tier?: string }).tier === "local")
    .map((d) => stateOfOcdId(d.ocdId)),
);
for (const d of us.divisions) {
  const m = /^ocd-division\/country:us\/state:(\w\w)$/.exec(d.ocdId);
  if (m && localTierStates.has(m[1].toUpperCase())) {
    usRendered.set(d.officeholderId, m[1].toUpperCase());
  }
}
for (const holder of us.officeholders) {
  const state = usRendered.get(holder.id);
  if (!state) continue; // not attached to a covered division — never renders
  people.push({
    surface: "federal officials",
    state,
    name: holder.name,
    hasPortrait: shippedIds.has(holder.id),
    note: shippedIds.has(holder.id)
      ? null
      : "recorded miss in official-photos.json (license or 404)",
  });
}

// ── Surface 3: state legislators (district popups) ──────────────────────
for (const { file, state } of [
  { file: "officeholders-04.json", state: "AZ" },
  { file: "officeholders-33.json", state: "NH" },
  { file: "officeholders-34.json", state: "NJ" },
]) {
  const data = read(`lib/registry/${file}`) as {
    officeholders: { id: string; name: string }[];
    divisions: { officeholderId: string; ocdId: string }[];
  };
  const rendered = new Set<string>();
  for (const d of data.divisions) {
    if (coveredOcdIds.has(d.ocdId)) rendered.add(d.officeholderId);
  }
  for (const holder of data.officeholders) {
    if (!rendered.has(holder.id)) continue;
    people.push({
      surface: "state legislators",
      state,
      name: holder.name,
      // State legislators resolve through the manifest exactly like
      // federal members do (lib/registry/server.ts) — the census reads
      // the same file the render path reads.
      hasPortrait: shippedIds.has(holder.id),
      note: shippedIds.has(holder.id)
        ? null
        : "recorded miss in official-photos.json (terms or absence)",
    });
  }
}

// ── Surface 4: curated local rosters (body popups, who-governs) ─────────
for (const roster of BODY_ROSTERS) {
  const state = stateOfOcdId(roster.bodyId);
  for (const member of roster.members) {
    people.push({
      surface: "curated local rosters",
      state,
      name: member.name,
      hasPortrait: shippedIds.has(member.id),
      note: shippedIds.has(member.id)
        ? null
        : "no shipped photo for this roster member",
    });
  }
}

// ── Surface 5: statewide executives (who-governs card, B11) ─────────────
// Added to the census 2026-08-14 (photo session): the governors render on
// every zip's who-governs card and were people the product shows a reader,
// so leaving them out of the denominator was a census gap. 747 → 750.
for (const executive of STATEWIDE_EXECUTIVES) {
  const holder = executive.holder;
  const shipped = shippedIds.has(holder.id) || Boolean(holder.photoUrl);
  people.push({
    surface: "statewide executives",
    state: stateOfOcdId(executive.stateOcdId),
    name: holder.name,
    hasPortrait: shipped,
    note: shipped ? null : "recorded miss in official-photos.json (terms or absence)",
  });
}

// ── The census — counts with denominators, and the named miss list ──────
function count(rows: PersonRow[]) {
  return { total: rows.length, portraits: rows.filter((r) => r.hasPortrait).length };
}

const surfaces = [...new Set(people.map((p) => p.surface))];
const states = [...new Set(people.map((p) => p.state))].sort();
const all = count(people);

console.log("=== photo census ===");
console.log(`people rendered: ${all.total}; with portrait: ${all.portraits}; initials: ${all.total - all.portraits}`);
for (const surface of surfaces) {
  const rows = people.filter((p) => p.surface === surface);
  const c = count(rows);
  console.log(`  ${surface}: ${c.portraits}/${c.total} portraits`);
}
for (const state of states) {
  const rows = people.filter((p) => p.state === state);
  const c = count(rows);
  console.log(`  ${state}: ${c.portraits}/${c.total} portraits`);
}

// ── Write the report section ────────────────────────────────────────────
const misses = people.filter((p) => !p.hasPortrait);
const missLines = surfaces
  .map((surface) => {
    const rows = misses.filter((m) => m.surface === surface);
    if (rows.length === 0) return "";
    const bySt = states
      .map((st) => {
        const stRows = rows.filter((r) => r.state === st);
        if (stRows.length === 0) return "";
        return (
          `**${surface} — ${st} (${stRows.length}):** ` +
          stRows.map((r) => r.name).join("; ")
        );
      })
      .filter(Boolean)
      .join("\n\n");
    return bySt;
  })
  .filter(Boolean)
  .join("\n\n");

const surfaceTable = surfaces
  .map((surface) => {
    const c = count(people.filter((p) => p.surface === surface));
    return `| ${surface} | ${c.portraits} | ${c.total - c.portraits} | ${c.total} |`;
  })
  .join("\n");
const stateTable = states
  .map((st) => {
    const c = count(people.filter((p) => p.state === st));
    return `| ${st} | ${c.portraits} | ${c.total - c.portraits} | ${c.total} |`;
  })
  .join("\n");

const censusSection = `## The census — every rendered person, counted by script

Run \`pnpm exec tsx scripts/photo-census.mts\` to regenerate. Counted
${new Date().toISOString().slice(0, 10)} against the committed data. "Portrait"
means the surface serves an actual judged photo; everything else renders
honest initials. The universe is people the product can actually render:
ballot candidacies and lineup nominees, federal officials attached to
covered divisions, state legislators attached to covered divisions, and
every curated local roster member.

**${all.portraits} of ${all.total} rendered people have a portrait; ${all.total - all.portraits} render initials.**

| Surface | Portraits | Initials | Total |
|---|---|---|---|
${surfaceTable}

| State | Portraits | Initials | Total |
|---|---|---|---|
${stateTable}

### The named misses — the dedicated photo session's shopping list

${missLines}
`;

// ── The official-portraits section, generated from the manifest ─────────
// The guard test (tests/candidate-cards.test.ts, 2b) requires every
// manifest photo's served URL AND source URL to appear in this report —
// the report is where a human eyeballs what ships, so the table is
// generated, never hand-maintained, and cannot drift from the manifest.
const officialRows = [...manifest.photos]
  .sort((a, b) => a.officeholderId.localeCompare(b.officeholderId))
  .map((p) => `| ${p.name} | ${p.url} | ${p.sourceUrl} | ${p.license} |`)
  .join("\n");
const officialMissRows = [...manifest.missing]
  .sort((a, b) => a.officeholderId.localeCompare(b.officeholderId))
  .map((m) => `| ${m.name} | \`${m.officeholderId}\` | ${m.reason} |`)
  .join("\n");
const officialsSection = `## Official portraits — the manifest, \`lib/registry/official-photos.json\`

Generated from the manifest by \`scripts/photo-census.mts\` — the table
cannot drift from what ships. All images are served from our origin
(\`public/officials/\`), metadata-stripped before commit
(\`scripts/strip-image-metadata.mts\`), and matched by stable id (bioguide
for Congress), never by name search.

${manifest.photos.length} shipped portraits:

| Person | Served file | Source URL | License |
|---|---|---|---|
${officialRows}

${manifest.missing.length} recorded absences (every one carries its reason and date in the manifest):

| Person | Id | Reason |
|---|---|---|
${officialMissRows}
`;

const reportPath = join(ROOT, "docs", "photo-report.md");
const existing = readFileSync(reportPath, "utf8");

// The candidate-cards section, generated from the cards file — every
// shipped card photo with its judgment/source string, so the 2b guard
// (photoUrl present in this report) can never drift from the data.
const fullCards = read("data/ballot/candidate-cards-2026.json") as {
  cards: Record<string, { photoUrl: string | null; photoSource: string | null }>;
  hunts: { key: string }[];
};
const shippedCardRows = Object.entries(fullCards.cards)
  .filter(([, c]) => c.photoUrl)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([key, c]) => `| \`${key}\` | ${c.photoUrl} | ${c.photoSource} |`)
  .join("\n");
const shippedCount = Object.values(fullCards.cards).filter((c) => c.photoUrl).length;
const cardsSection = `## Candidate cards — \`data/ballot/candidate-cards-2026.json\`

Generated from the cards file by \`scripts/photo-census.mts\`. Each row is
a shipped photo with the judgment and source recorded on the card itself
(\`photoSource\` renders as the image's title/alt). External photos were
localized 2026-08-14: committed copies under \`public/candidates/\`,
metadata-stripped, served from our origin. A candidate not listed renders
initials, and every absence is a recorded hunt in the file's \`hunts\`
array (${fullCards.hunts.length} recorded hunts, rung-by-rung with dates).

${shippedCount} shipped card photos:

| Card key | Served file | Judgment and source |
|---|---|---|
${shippedCardRows}
`;

// Header: everything before the first generated section.
const officialsMarker = "## Official portraits — the manifest";
const legacyOfficialsMarker = "## Roster officials";
const headerEnd = [officialsMarker, legacyOfficialsMarker, "## Candidate cards"]
  .map((m) => existing.indexOf(m))
  .filter((i) => i >= 0)
  .reduce((a, b) => Math.min(a, b), existing.length);
const header = existing.slice(0, headerEnd).trimEnd();

writeFileSync(
  reportPath,
  `${header}\n\n${officialsSection}\n${cardsSection}\n\n${censusSection}`,
);
console.log(`\nwritten: docs/photo-report.md (${misses.length} named misses)`);
