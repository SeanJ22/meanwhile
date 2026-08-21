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
      // https for external photos; a site-local path serves a COMMITTED
      // portrait — `/officials/…` licensed in official-photos.json,
      // `/candidates/…` judged and sourced on the card itself (photo
      // session 2026-08-14) — and must resolve on disk.
      if (
        card.photoUrl.startsWith("/officials/") ||
        card.photoUrl.startsWith("/candidates/")
      ) {
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

/**
 * **RULING 42 (Prompt E item 3, 2026-08-20) — the three tests that used to
 * guard `THIN_CANDIDATE_LINE` now guard its absence.**
 *
 * They were written for item 5 of the tester's mobile pass (2026-08-14), whose
 * finding is still true and still governs this product: "Karen might be the
 * perfect fit for me, but she has no information here. So I'm only going to
 * look at the folks that do have information." The app never says a word about
 * anyone and still tilts races.
 *
 * What changed is the instrument, not the finding. The per-card line printed
 * on exactly one kind of card — the shortest one in the race — so it told a
 * reader which named person we know least about, on that person's card. The
 * disclosure now happens once, at the foot of the page, about every card
 * equally. The hunt discipline that answers the finding properly is unchanged
 * and lives where `CLAUDE.md` and RULING 26 both put it: in the hunt.
 */
test("RULING 42: no per-card completeness marker survives in the card library", async () => {
  const mod = (await import("../lib/ballot/candidate-cards.ts")) as Record<
    string,
    unknown
  >;
  for (const dead of ["THIN_CANDIDATE_LINE", "isThinCandidateCard"]) {
    assert.equal(
      dead in mod,
      false,
      `${dead} is deleted by RULING 42 — a card may not be labelled by how ` +
        "much of it we managed to fill",
    );
  }
});

test("RULING 42: the card component renders no completeness marker", () => {
  /*
   * Comments stripped first, then NOTHING may name either symbol. The note
   * left in the file records why they went, and a note is not a render — but
   * outside a comment there is no innocent reason to write either word, so the
   * assertion is the strongest one available: total absence in live code.
   */
  const live = readFileSync(
    join(process.cwd(), "components", "ballot", "candidate-card.tsx"),
    "utf8",
  )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
  for (const dead of ["THIN_CANDIDATE_LINE", "isThinCandidateCard"]) {
    assert.ok(
      !live.includes(dead),
      `${dead} appears in live code on the card — RULING 42 deleted it`,
    );
  }
  // And the sentence itself, in case somebody inlines it without the constant.
  assert.ok(
    !/found much about this candidate/i.test(live),
    "the deleted sentence is not inlined back onto the card",
  );
});

test("RULING 42: the page-level disclosure is declared once and rendered once", () => {
  const src = readFileSync(join(process.cwd(), "app", "ballot", "page.tsx"), "utf8");
  const declared = /const COLLECTION_NOTE =\s*\n?\s*"([^"]+)";/.exec(src);
  assert.ok(declared, "the disclosure sentence is declared in one place");
  const note = declared![1]!;

  // In substance, the two things RULING 42 requires it to say.
  assert.match(note, /we show what we have collected/i);
  assert.match(note, /every detail we could find/i);

  // Unhedged. An apology about our own coverage is the editorial F01 struck.
  for (const hedge of ["sorry", "unfortunately", "apolog", "we tried", "may not"]) {
    assert.ok(
      !note.toLowerCase().includes(hedge),
      `the disclosure states a fact and does not ${hedge}`,
    );
  }

  assert.equal(
    [...src.matchAll(/\{COLLECTION_NOTE\}/g)].length,
    1,
    "once per page — not once per contest, and never per card",
  );

  // RULING 42 replaces nothing else: the contest footnote and the marker
  // convention RULING 28 fixed are both still exactly where D left them.
  assert.equal(
    [...src.matchAll(/<IncumbencyFootnote \/>/g)].length,
    2,
    "the contest-level incumbency footnote is untouched — one per branch",
  );
  assert.equal(
    [...src.matchAll(/<IncumbencyMarker \/>/g)].length,
    1,
    "the `*` marker construction is untouched",
  );
});
