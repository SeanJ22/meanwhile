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
 * rung — photos get a dedicated session; this session
 * produces that session's brief input.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// F01-continued item 1: this file used to date its own section with
// `new Date().toISOString().slice(0, 10)`, which is UTC and therefore
// TOMORROW for the seven hours after 5pm Phoenix. It wrote "2026-08-20" at
// 18:19 on 2026-08-19 — the smaller sibling of the fabricated-date defect
// `pnpm stamp` exists to stop. The day comes from the one module that knows
// the zone, exactly as `pnpm stamp` does.
import { today } from "./doc-dates.mjs";
import { photoSlots, type PhotoSlot } from "../lib/coverage/photo-slots.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));

// The manifest itself is still read here: the sections below tabulate every
// shipped row and every recorded absence, which is a MANIFEST question and
// not a slot one.
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

// F01-continued session 2, item 0B: the five-surface walk this file used to
// carry verbatim now lives in `lib/coverage/photo-slots.ts`, because
// `photo-review.mts` and `photo-reconcile.mts` need exactly the same walk
// and three copies of it is three ways for the portrait figures to disagree
// — which is precisely what left 37 portraits unaccounted for.
type PersonRow = PhotoSlot & { surface: string };

const people: PersonRow[] = photoSlots(ROOT);

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
${today()} against the committed data. "Portrait"
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
