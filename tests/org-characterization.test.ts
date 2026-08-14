import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/**
 * The two standing rules adopted 2026-08-14 (second session), guarded
 * where a guard can reach:
 *
 * 1. **Organizations render as filed, never characterized.** The funding
 *    surfaces may never carry an affiliation/alignment label for a
 *    contributor org. The guard scans the funding components and lib for
 *    characterization strings. It is a tripwire, not the rule — the rule
 *    is CLAUDE.md law regardless.
 *
 * 2. **Every blurb carries its source class.** Every curated bio in the
 *    candidate-cards data names where it came from, in the shipped
 *    register ("In the campaign's words — domain, read date").
 */

const ROOT = join(import.meta.dirname, "..");

const CHARACTERIZATIONS = [
  "affiliate of",
  "-aligned",
  "aligned with",
  "progressive group",
  "conservative group",
  "liberal group",
  "right-wing",
  "left-wing",
  "dark money",
  "front group",
  "special interest",
];

test("funding surfaces never characterize an organization", () => {
  const files: string[] = [];
  for (const dir of [
    join(ROOT, "components", "funding"),
    join(ROOT, "lib", "funding"),
  ]) {
    for (const name of readdirSync(dir)) {
      if (/\.(ts|tsx)$/.test(name)) files.push(join(dir, name));
    }
  }
  assert.ok(files.length >= 3, "the funding surfaces exist and were scanned");
  for (const file of files) {
    const source = readFileSync(file, "utf8").toLowerCase();
    for (const banned of CHARACTERIZATIONS) {
      assert.ok(
        !source.includes(banned),
        `${file}: contains "${banned}" — organizations render as filed, never characterized`,
      );
    }
  }
});

test("every curated bio names its source class", () => {
  const data = JSON.parse(
    readFileSync(join(ROOT, "data", "ballot", "candidate-cards-2026.json"), "utf8"),
  ) as {
    cards: Record<
      string,
      { bio: string | null; bioSourceUrl: string | null; bioSourceLabel: string | null }
    >;
  };
  const cards = Object.entries(data.cards);
  assert.ok(cards.length > 0, "cards exist");
  let withBio = 0;
  for (const [key, card] of cards) {
    if (!card.bio) continue;
    withBio++;
    assert.ok(
      card.bioSourceLabel && card.bioSourceLabel.length > 0,
      `${key}: bio without a source label — an unlabeled description of a real person`,
    );
    assert.ok(
      /read \d{4}-\d{2}-\d{2}/.test(card.bioSourceLabel),
      `${key}: the source label must carry its read date`,
    );
    assert.ok(
      card.bioSourceUrl,
      `${key}: the bio must link where it was read`,
    );
  }
  assert.ok(withBio > 0, "at least one bio was actually checked");
});
