import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { MEASURE_SUMMARIES } from "../lib/ballot/measure-summary.ts";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

test("BAL-41/MTG-15: the level tag is ONE component, tier-derived, colour from the accent token", () => {
  const src = read("components/ui/level-tag.tsx");
  assert.match(src, /var\(--accent-\$\{tier\}\)/, "the tag colours from --accent-<tier>");
  assert.match(src, /if \(tier === null\) return null/, "a null tier renders no tag");
  assert.match(src, /TIER_LABEL\[tier\]/, "the tag word is the shared TIER_LABEL");
});

test("BAL-41: the ballot wires the tag onto every race, every measure, and the section headers, from office and OCD identity (FE-44)", () => {
  const page = read("app/ballot/page.tsx");
  assert.match(page, /import \{[^}]*tierForOcdId[^}]*tierForOffice[^}]*\} from "@\/lib\/ocd\/tiers"/);
  assert.match(page, /<LevelTag tier=\{tierForOffice\(contest\.title, contest\.ocdId\)\} \/>/);
  assert.match(page, /data-level-heading=\{group\.tier\}/);
  assert.match(page, /--level-heading-color/);
  assert.match(page, /heading: "Statewide measures", list: statewideMeasures, tier: "state"/);
  assert.match(page, /heading: "Local measures", list: localMeasures, tier: "local"/);
});

test("MTG-15: the meeting surfaces carry the tag from the meeting's OCD identity", () => {
  const panel = read("components/map/meeting-panel.tsx");
  assert.match(panel, /import \{ tierForMeeting \} from "@\/lib\/state\/derive"/);
  assert.match(panel, /<LevelTag tier=\{first \? tierForMeeting\(first\) : null\} \/>/);
  const shared = read("components/ui/meeting-card.tsx");
  assert.match(shared, /titleAfter=\{<LevelTag tier=\{tierForMeeting\(meeting\)\}/, "the shared card derives the level from OCD identity and places it after its title");
});

test("BAL-40: on every wordmark-above-headline page the logo is larger than the headline", () => {
  const TEXT_PX: Record<string, number> = { "text-lg": 18, "text-xl": 20, "text-2xl": 24, "text-3xl": 30 };
  const pages = [
    "app/ballot/page.tsx",
    "app/ballot/loading.tsx",
    "app/feedback/page.tsx",
    "app/transparency/page.tsx",
    "app/about-area/page.tsx",
    "app/about-area/compare/page.tsx",
  ];
  for (const rel of pages) {
    const src = read(rel);
    const logo = src.match(/variant="wordmark" size=\{(\d+)\}/);
    assert.ok(logo, `${rel}: expected a wordmark with an explicit size`);
    const logoPx = Number(logo[1]);
    const h1 = src.match(/<h1 className="[^"]*\b(text-(?:lg|xl|2xl|3xl))\b/);
    assert.ok(h1, `${rel}: expected a sized <h1> headline`);
    const headlinePx = TEXT_PX[h1[1]];
    assert.ok(
      logoPx > headlinePx,
      `${rel}: logo ${logoPx}px must be larger than the ${headlinePx}px headline`,
    );
    assert.ok(logoPx >= 18, `${rel}: logo ${logoPx}px must respect the 18px wordmark floor`);
  }
});

test("BAL-46: every local measure carries a plain-language summary, cited to its own source, never advocacy", () => {
  const local = MEASURE_SUMMARIES.filter((s) => s.citation === "measure-source");
  assert.ok(local.length >= 4, `expected the four local-measure summaries, found ${local.length}`);
  const forbidden = /\b(should|vote yes|vote no|good|bad|dangerous|we recommend|we support|we oppose)\b/i;
  for (const s of local) {
    assert.ok(s.summary.length >= 100, `${s.contestId}: summary too thin`);
    assert.equal(s.summary.match(forbidden), null, `${s.contestId}: advocacy vocabulary in a summary`);
    assert.ok(s.summarizesUrl.length > 0, `${s.contestId}: a local summary must cite its measure source`);
  }
});

test("BAL-45/46/47: the summary leads on the face; the verbatim serif ballot text is collapsed below", () => {
  const page = read("app/ballot/page.tsx");
  assert.match(page, /data-measure-summary="PRESENT"/);
  assert.match(page, /\{summary \? \(/, "the summary renders on the summary alone");
  const disclosure = page.indexOf("data-measure-official-text");
  assert.ok(disclosure > 0, "the official-text disclosure exists");
  const block = page.slice(disclosure - 80, disclosure + 1400);
  assert.match(block, /<details/, "the verbatim ballot text is behind a <details>");
  assert.match(block, /t-record[^"]*"\s*\n?\s*data-measure-question/, "the question renders in the serif record register inside the disclosure");
  assert.match(block, /What the authority published with it/, "the authority statement moved into the disclosure (BAL-47)");
});

test("BAL-48: extended election-mechanics text collapses behind a disclosure by default", () => {
  const page = read("app/ballot/page.tsx");
  assert.match(page, /const EXTENDED_MECHANICS_CHARS = \d+/);
  assert.match(page, /const scope = readerContestScope\(contest,/);
  assert.match(page, /\(readerScopeNotes\.get\(contest\.id\)\?\.length \?\? 0\) > EXTENDED_MECHANICS_CHARS \? \(/);
  const idx = page.indexOf("data-scope-note-collapsed");
  assert.ok(idx > 0, "the collapsed mechanics note is addressable");
  const block = page.slice(idx - 120, idx + 200);
  assert.match(block, /<details/, "the mechanics note is a <details> — collapsed by default, no `open`");
  assert.ok(!/data-scope-note-collapsed[^>]*\bopen\b/.test(page), "the mechanics disclosure is not open by default");
});

test("POS-5: the statewide measure treatment the owner praised is intact — summary, part-by-part, collapsed analysis", () => {
  const ids = ["ballot-az-pima:prop-319", "ballot-az-pima:prop-320"];
  for (const id of ids) {
    const s = MEASURE_SUMMARIES.find((x) => x.contestId === id);
    assert.ok(s, `${id}: the statewide summary is gone`);
    assert.notEqual(s.citation, "measure-source", `${id}: a statewide measure must cite its Legislative Council analysis`);
  }
  const page = read("app/ballot/page.tsx");
  assert.match(page, /What&apos;s in it, part by part/, "the part-by-part pill is gone");
  assert.match(page, /provisionsForContest\(contest\.id, measureRecords\)\.length > 0/);
  assert.match(page, /Official analysis — \{analysis\.sourceOrg\}/, "the collapsed official analysis is gone");
  assert.ok(!/t-record[^"]*"[^>]*>\s*\{summary\.summary\}/.test(page), "the plain-language summary must not wear the serif record face");
});

test("POS-4: the desktop map still renders the Who Governs Here panel and the district card — untouched by this session", () => {
  const mapEntry = read("components/map/map-entry.tsx");
  assert.match(mapEntry, /import \{ CoverageNotice \} from "\.\/coverage-notice"/, "the Who Governs Here panel is still mounted");
  assert.match(mapEntry, /import \{ DistrictPicker \} from "\.\/district-picker"/, "the district card is still mounted");
  assert.match(mapEntry, /<CoverageNotice/, "the Who Governs Here panel still renders");
});
