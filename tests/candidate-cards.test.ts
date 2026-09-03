import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { test } from "node:test";

import { allCandidateCards } from "../lib/ballot/candidate-cards.ts";
import { ballotPath } from "../lib/holdings/files.ts";

/** Every .ts/.tsx file under a directory, so a class sweep cannot miss a file by naming it. */
function* walkFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walkFiles(full);
    else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) yield full;
  }
}

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
      readFileSync(join(process.cwd(), ballotPath(file)), "utf8"),
    ) as {
      candidacies: { id: string }[];
      contests: { id: string }[];
      removals?: { id: string; status: string }[];
    };
    for (const c of set.candidacies) candidacyIds.add(c.id);
    for (const c of set.contests) candidacyIds.add(c.id);
    /*
     * A candidacy the clerk has since removed keeps its id in `removals`, with
     * the evidence of the change (2026-09-02, Lana Leguía). The card hunted
     * for that person is not dangling — it resolves to the retained record —
     * and it is not rendered as a running candidate either, because the card
     * layer keys off `candidacies` and the removal is not one.
     */
    for (const r of set.removals ?? []) {
      assert.equal(r.status, "REMOVED_FROM_FILING", `${file}: ${r.id} carries an unknown removal status`);
      candidacyIds.add(r.id);
    }
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
    /*
     * `!= null`, LOOSE, AND DELIBERATELY.
     *
     * This read `!== null` until 2026-08-25, which is TRUE for `undefined` —
     * so the first card row written that carried a phone and no photo key at
     * all walked into this branch and asserted about a portrait nobody had
     * claimed. The message it produced named the defect precisely and pointed
     * at the wrong thing: *shipped photo undefined is not listed*.
     *
     * The same distinction bit `candidate-links-2026.json` in the same hour.
     * `null` means we looked and there is none; MISSING means nobody has said.
     * A guard that cannot tell them apart reports on data that does not exist.
     */
    if (card.photoUrl != null) {
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
    if (card.bio != null) {
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
    if (card.photoUrl != null) {
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

test("RULING 42 and RULING 51: the disclosure is declared once and renders once per surface", () => {
  /*
   * RULING 51 (2026-08-21) gave this sentence a SECOND surface — his note on
   * `PE04`: *"That one line should be listed once in the ballot section and
   * once again on their battlecard."* So the declaration moved out of the page
   * and into `lib/ballot/collection-note.ts`, and this guard moved with it.
   *
   * The invariant that matters is unchanged and is now checkable on both
   * surfaces at once: ONE declaration, and exactly ONE render per surface.
   * Two literals would let a sentence he has already rewritten once drift into
   * two sentences, and two renders on one surface is the per-card repetition
   * RULING 28 ended, wearing a page-level costume.
   */
  const declaration = readFileSync(
    join(process.cwd(), "lib", "ballot", "collection-note.ts"),
    "utf8",
  );
  const declared = /export const COLLECTION_NOTE =\s*\n?\s*"([^"]+)";/.exec(declaration);
  assert.ok(declared, "the disclosure sentence is declared in one place");
  const note = declared![1]!;

  /*
   * In substance, what RULING 42 requires it to say — in the AUTHOR'S wording
   * since 2026-08-20, when he read the first version live and cut it from two
   * sentences to one. The assertion is on the SUBSTANCE and not the sentence,
   * because the sentence is his to rewrite and has been rewritten once already.
   */
  assert.match(note, /what we have found/i);
  assert.match(note, /displaying here/i);
  assert.equal(
    note.split(".").filter((s) => s.trim()).length,
    1,
    "one sentence — 'That's it' is half the instruction",
  );

  // Unhedged. An apology about our own coverage is the editorial F01 struck.
  for (const hedge of ["sorry", "unfortunately", "apolog", "we tried", "may not"]) {
    assert.ok(
      !note.toLowerCase().includes(hedge),
      `the disclosure states a fact and does not ${hedge}`,
    );
  }

  /*
   * The two surfaces RULING 51 names, and NOTHING else may render it. A third
   * importer is a third instance nobody ruled on, so the sweep is over the
   * whole reader tree rather than over the two files we expect.
   */
  const surfaces: [string, string[]][] = [
    ["the ballot section", ["app", "ballot", "page.tsx"]],
    ["the battlecard", ["components", "ballot", "candidate-battlecard.tsx"]],
  ];
  for (const [label, parts] of surfaces) {
    const src = readFileSync(join(process.cwd(), ...parts), "utf8");
    assert.equal(
      [...src.matchAll(/\{COLLECTION_NOTE\}/g)].length,
      1,
      `once on ${label} — not once per contest, and never per card`,
    );
    assert.equal(
      [...src.matchAll(/data-collection-note/g)].length,
      1,
      `one marked instance on ${label}, so a DOM walk can count it`,
    );
  }

  const allowed = new Set(
    surfaces.map(([, parts]) => parts.join("/")).concat("lib/ballot/collection-note.ts"),
  );
  const importers: string[] = [];
  for (const dir of ["app", "components", "lib"]) {
    for (const file of walkFiles(join(process.cwd(), dir))) {
      const rel = relative(process.cwd(), file).split(sep).join("/");
      if (allowed.has(rel)) continue;
      // Comments stripped first: three files EXPLAIN this constant and none
      // renders it, and a guard that cannot tell prose from code is a guard
      // that gets deleted the first time somebody writes a note about it.
      const code = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^[ \t]*\/\/.*$/gm, "");
      if (code.includes("COLLECTION_NOTE")) importers.push(rel);
    }
  }
  assert.deepEqual(
    importers,
    [],
    "RULING 51 names two surfaces; a third would be an instance nobody ruled on",
  );

  // RULING 42 replaces nothing else: the contest footnote and the marker
  // convention RULING 28 fixed are both still exactly where D left them.
  const page = readFileSync(join(process.cwd(), "app", "ballot", "page.tsx"), "utf8");
  assert.equal(
    [...page.matchAll(/<IncumbencyFootnote \/>/g)].length,
    2,
    "the contest-level incumbency footnote is untouched — one per branch",
  );
  assert.equal(
    [...page.matchAll(/<IncumbencyMarker \/>/g)].length,
    1,
    "the `*` marker construction is untouched",
  );
});
