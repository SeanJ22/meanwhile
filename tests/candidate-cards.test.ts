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
 * Item 5 of the tester's mobile pass (2026-08-14) — the thin-candidate line,
 * and the equal-effort principle it belongs to.
 *
 * The tester, verbatim: "Karen might be the perfect fit for me, but she has
 * no information here. So I'm only going to look at the folks that do have
 * information... how could using this app actually impact voter outcomes
 * instead of collect information from voters." The app never says a word
 * about anyone and still tilts races, because thin cards track incumbency
 * and campaign professionalism rather than merit. Naming the absence is what
 * makes it a statement about our research instead of about the candidate.
 */
test("the thin-candidate line is one sentence, and it neither apologizes nor explains", async () => {
  const { THIN_CANDIDATE_LINE } = await import(
    "../lib/ballot/candidate-cards.ts"
  );
  assert.equal(
    THIN_CANDIDATE_LINE,
    "We haven't found much about this candidate yet.",
  );
  // Full stop means full stop: exactly one sentence.
  assert.equal(
    THIN_CANDIDATE_LINE.split(".").filter((s) => s.trim()).length,
    1,
    "no second sentence — an apology on the thin cards and silence on the thick ones is the same asymmetry",
  );
  for (const banned of ["sorry", "unfortunately", "apolog", "we tried", "please"]) {
    assert.ok(
      !THIN_CANDIDATE_LINE.toLowerCase().includes(banned),
      `the line must not ${banned}`,
    );
  }
  // And it never characterizes the candidate — the absence is ours.
  for (const banned of ["little-known", "unknown", "minor", "obscure", "fringe"]) {
    assert.ok(
      !THIN_CANDIDATE_LINE.toLowerCase().includes(banned),
      `the line describes our research, never the candidate (${banned})`,
    );
  }
});

test("thinness is decided by what we hold, and any one sourced field is enough to silence the line", async () => {
  const { isThinCandidateCard } = await import(
    "../lib/ballot/candidate-cards.ts"
  );
  const empty = {
    photoUrl: null,
    photoSource: null,
    bio: null,
    bioSourceUrl: null,
    bioSourceLabel: null,
    email: null,
    phone: null,
  };
  assert.equal(isThinCandidateCard(null, false), true, "no card at all is thin");
  assert.equal(isThinCandidateCard(empty, false), true, "an empty card is thin");
  // A link alone is information a reader can act on.
  assert.equal(isThinCandidateCard(null, true), false);
  assert.equal(isThinCandidateCard(empty, true), false);
  for (const field of ["photoUrl", "bio", "email", "phone"] as const) {
    assert.equal(
      isThinCandidateCard({ ...empty, [field]: "x" }, false),
      false,
      `${field} present means the card is not silent`,
    );
  }
});

test("the line renders on the card component itself, so it travels to every surface a thin card reaches", () => {
  const src = readFileSync(
    join(process.cwd(), "components", "ballot", "candidate-card.tsx"),
    "utf8",
  );
  assert.ok(
    /THIN_CANDIDATE_LINE/.test(src),
    "the shared constant renders — not a copy of the sentence",
  );
  assert.ok(
    /isThinCandidateCard/.test(src),
    "the shared predicate decides — not an inline condition that can drift",
  );
});
