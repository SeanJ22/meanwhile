import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { allCandidateLinks } from "../lib/ballot/candidate-sites.ts";

/**
 * The hunted candidate links (2b, session 2026-08-16).
 *
 * The dangerous failure here is the silent no-op: a key that matches no
 * candidacy id and no lineup nominee renders nothing anywhere, and the link
 * someone verified quietly never ships. Every `links` key must therefore
 * resolve to a real rendered candidate. The other rules: every link carries
 * its verification sentence and date (a URL cited must have been fetched),
 * and no ranking vocabulary anywhere in the file.
 */

function loadJson(rel: string): unknown {
  return JSON.parse(readFileSync(join(process.cwd(), rel), "utf8"));
}

interface BallotFile {
  candidacies: { id: string }[];
  /** Candidacies the clerk's current filing no longer lists — id retained with its evidence. */
  removals?: { id: string; status: string }[];
}

interface LineupFile {
  contests: { contestId: string; nominees: { name: string }[] }[];
}

test("every candidate-links key resolves to a real candidacy or lineup nominee", () => {
  const { links } = allCandidateLinks();

  const candidacyIds = new Set<string>();
  for (const file of [
    "data/states/nj/ballot/nj-morris-2026.json",
    "data/states/az/ballot/az-pima-2026.json",
    "data/states/nh/ballot/nh-merrimack-2026.json",
  ]) {
    const ballot = loadJson(file) as BallotFile;
    for (const c of ballot.candidacies) {
      candidacyIds.add(c.id);
    }
    // A link verified for a person the clerk later removed resolves to the
    // retained removal record rather than dangling (2026-09-02); the removal
    // is not a candidacy, so nothing renders it as one.
    for (const r of ballot.removals ?? []) {
      assert.equal(r.status, "REMOVED_FROM_FILING", `${file}: ${r.id} carries an unknown removal status`);
      candidacyIds.add(r.id);
    }
  }

  const lineup = loadJson("data/states/az/ballot/az-general-lineup-2026.json") as LineupFile;
  const nomineeKeys = new Set<string>();
  for (const contest of lineup.contests) {
    for (const nominee of contest.nominees) {
      nomineeKeys.add(`${contest.contestId}|${nominee.name}`);
    }
  }

  const keys = Object.keys(links);
  assert.ok(keys.length >= 40, `expected a substantive link set, got ${keys.length}`);
  for (const key of keys) {
    assert.ok(
      candidacyIds.has(key) || nomineeKeys.has(key),
      `links key "${key}" matches no candidacy id and no lineup nominee — it renders nowhere`,
    );
  }
});

test("every link was fetch-verified: url, verification sentence, and date present", () => {
  const { links, hunts } = allCandidateLinks();
  for (const [key, entry] of Object.entries(links)) {
    for (const side of ["official", "campaign"] as const) {
      const link = entry[side];
      if (link === null) continue;
      /*
       * HTTPS, unless the site does not answer over it AND the verification
       * sentence records that measurement.
       *
       * **The carve-out is DECLARED and evidenced rather than the rule being
       * loosened**, which is the same mechanism `tests/guard-census.json` uses
       * to let a guard leave: it costs a diff, and a diff is a thing somebody
       * can read.
       *
       * It exists because `garykapner.com` refuses HTTPS and serves 533 KB of
       * a real campaign site — *Gary Kapner for Mendham Township Committee* —
       * over plain HTTP. A blanket HTTPS requirement does not make that site
       * secure; it makes the site INVISIBLE, and the sites without a
       * certificate are the small self-hosted ones, which is the equal-effort
       * rule's concern arriving as a transport detail. Hiding the least
       * resourced candidate's only web presence is the worse failure.
       *
       * The bar is that somebody MEASURED it. An http link may not simply
       * appear; the row has to say that https was tried and refused, and on
       * what date.
       */
      if (link.url.startsWith("http://")) {
        assert.match(
          link.verification,
          /https refused|refuses https|no https|https did not answer/i,
          `${key} ${side}: an http:// link must record that https was measured and refused`,
        );
      } else {
        assert.match(link.url, /^https:\/\//, `${key} ${side}`);
      }
      assert.ok(link.verification.length > 20, `${key} ${side}: verification sentence required`);
      assert.match(link.attemptedAt, /^\d{4}-\d{2}-\d{2}$/, `${key} ${side}`);
    }
  }
  // Recorded hunts distinguish MISS from NOT_ATTEMPTED — never a bare blank.
  assert.ok(hunts.length > 0);
  for (const hunt of hunts) {
    assert.match(hunt.note, /^(MISS|NOT_ATTEMPTED)/, `${hunt.key}: hunt note must state which kind of absence it is`);
  }
});

test("no ranking vocabulary anywhere in the links file", () => {
  const raw = JSON.stringify(allCandidateLinks()).toLowerCase();
  for (const banned of ['"score"', '"rank"', '"rating"', '"match"', '"fit"', '"grade"', '"alignment"', '"recommendation"']) {
    assert.ok(!raw.includes(banned), `banned key ${banned} in candidate-links`);
  }
});
