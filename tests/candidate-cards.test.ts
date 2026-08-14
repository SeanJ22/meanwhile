import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { allCandidateCards } from "../lib/ballot/candidate-cards.ts";

/**
 * 2b (2026-08-17): the Kelly-standard candidate cards. Every card's claims
 * are sourced: a photo carries its labeled source, a bio carries the site it
 * quotes and a read date, and every key resolves to a real candidacy or
 * nominee. Absences are recorded hunts, never blanks.
 */

test("every card key resolves against the ballot data or lineup keys", () => {
  const { cards } = allCandidateCards();
  const candidacyIds = new Set<string>();
  for (const file of [
    "nj-morris-2026.json",
    "nh-merrimack-2026.json",
    "az-pima-2026.json",
  ]) {
    const set = JSON.parse(
      readFileSync(join(process.cwd(), "data", "ballot", file), "utf8"),
    ) as { candidacies: { id: string }[]; contests: { id: string }[] };
    for (const c of set.candidacies) candidacyIds.add(c.id);
    for (const c of set.contests) candidacyIds.add(c.id);
  }
  for (const key of Object.keys(cards)) {
    const base = key.includes("|") ? key.split("|")[0]! : key;
    assert.ok(
      candidacyIds.has(base),
      `card key "${key}" resolves to no candidacy or contest`,
    );
  }
  assert.ok(Object.keys(cards).length >= 16, "expected ≥16 curated cards");
});

test("every photo carries a labeled source and https URL; every bio its citation", () => {
  const { cards } = allCandidateCards();
  for (const [key, card] of Object.entries(cards)) {
    if (card.photoUrl !== null) {
      // https for external photos; a site-local `/officials/…` path serves
      // a COMMITTED public-domain portrait (license recorded in
      // lib/registry/official-photos.json) and must resolve on disk.
      if (card.photoUrl.startsWith("/officials/")) {
        assert.ok(
          existsSync(join(process.cwd(), "public", card.photoUrl.slice(1))),
          `${key}: local portrait ${card.photoUrl} not committed`,
        );
      } else {
        assert.match(card.photoUrl, /^https:\/\//, `${key}: photo not https`);
      }
      assert.ok(card.photoSource, `${key}: photo without a labeled source`);
    }
    if (card.bio !== null) {
      assert.ok(card.bioSourceUrl, `${key}: bio without a source URL`);
      assert.ok(
        card.bioSourceLabel?.includes("read 2026"),
        `${key}: bio source label missing its read date`,
      );
    }
  }
});

test("2b: every shipped photo appears in docs/photo-report.md with its judgment", () => {
  // The human-verifiable check: the report is where a person eyeballs what
  // ships. A photo missing from it is a photo nobody judged.
  const report = readFileSync(join(process.cwd(), "docs", "photo-report.md"), "utf8");
  const { cards } = allCandidateCards();
  for (const [key, card] of Object.entries(cards)) {
    if (card.photoUrl !== null) {
      assert.ok(
        report.includes(card.photoUrl),
        `${key}: shipped photo ${card.photoUrl} is not listed in docs/photo-report.md`,
      );
    }
  }
  const manifest = JSON.parse(
    readFileSync(join(process.cwd(), "lib", "registry", "official-photos.json"), "utf8"),
  ) as { photos: { url: string; sourceUrl: string }[] };
  for (const photo of manifest.photos) {
    assert.ok(
      report.includes(photo.url),
      `official photo ${photo.url} is not listed in docs/photo-report.md`,
    );
    assert.ok(
      report.includes(photo.sourceUrl),
      `official photo source ${photo.sourceUrl} is not listed in docs/photo-report.md`,
    );
  }
});

test("2b: a card photo is a portrait judgment, never a banner/logo file left behind", () => {
  // The two classes the audit caught mechanically: campaign banner/logo
  // filenames. Belt to the eyeball's braces — a re-added banner fails here
  // even before a human looks.
  const { cards } = allCandidateCards();
  const bannerShaped = /(banner|logo|wordmark|sharegraph|pullt(h?)rough|winred)/i;
  for (const [key, card] of Object.entries(cards)) {
    if (card.photoUrl !== null) {
      assert.ok(
        !bannerShaped.test(card.photoUrl),
        `${key}: photo URL looks like a banner/logo file (${card.photoUrl}) — the 2b rule bans these`,
      );
    }
  }
});

test("no ranking vocabulary anywhere in the cards file", () => {
  const raw = readFileSync(
    join(process.cwd(), "data", "ballot", "candidate-cards-2026.json"),
    "utf8",
  );
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const bannedKey = /(score|rank|rating|match|fit|grade|alignment|recommendation)/i;
  const walk = (value: unknown, path: string) => {
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, `${path}[${i}]`));
    } else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) {
        // Keys inside `cards`/`links` records are candidate ids, not schema.
        if (!path.endsWith(".cards") && !path.endsWith(".hunts")) {
          assert.ok(!bannedKey.test(k), `ranking-shaped key "${k}" at ${path}`);
        }
        walk(v, `${path}.${k}`);
      }
    }
  };
  walk(parsed, "$");
});
