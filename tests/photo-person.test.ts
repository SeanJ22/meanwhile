import assert from "node:assert/strict";
import test from "node:test";

import {
  cardForCandidacy,
  cardForNominee,
} from "../lib/ballot/candidate-cards.ts";
import { officialPhotoForPerson, personKey } from "../lib/photos/person.ts";
import {
  collectPhotoRows,
  findPersonPhotoClashes,
} from "../scripts/photo-person-audit.mts";

/**
 * One person, one photo (item 6b, 2026-08-15).
 *
 * The author reported Katie Hobbs wearing her official portrait on the
 * officials row and a stale event candid on her ballot card. The audit
 * found she was one of nine. This file is the guard that keeps the number
 * at zero: it walks every surface that can put a face on a screen, groups
 * by person, and fails when one human carries two different images.
 */

test("no person renders two different photos, on any surface", () => {
  const rows = collectPhotoRows();
  assert.ok(rows.length > 500, `only ${rows.length} photo rows walked`);

  // The audit reads the RAW files, where a person legitimately has more
  // than one row: Consuelo Hernandez holds two seats, and each row records
  // its own source. What must never differ is what a READER sees, and every
  // surface now resolves through lib/photos/person.ts — the ballot cards
  // via candidate-cards.ts, the officials index via registry/server.ts. So
  // a raw clash is only a reader-visible clash when the resolver has no
  // answer for that person and the differing rows are left to themselves.
  const clashes = findPersonPhotoClashes(rows).filter(
    (clash) => officialPhotoForPerson(clash.person) === null,
  );

  assert.deepEqual(
    clashes.map((c) => `${c.person}: ${c.urls.map((u) => u.url).join(" vs ")}`),
    [],
    "a person is wearing more than one face",
  );
});

test("the author's case: Hobbs's ballot card renders her official portrait, with its own credit", () => {
  const official = officialPhotoForPerson("Katie Hobbs");
  assert.ok(official, "no official portrait for Hobbs — retarget this check");
  assert.equal(official.url, "/officials/statewide-az-governor.jpg");

  for (const card of [
    cardForCandidacy("ballot-az-pima:governor:hobbs-katie"),
    cardForNominee("ballot-az-pima:governor", "Katie Hobbs"),
  ]) {
    assert.ok(card, "Hobbs's card vanished — retarget this check");
    assert.equal(card.photoUrl, official.url, "the stale candid is still rendering");
    // The credit travels with the image. The Commons photographer's name
    // must not survive onto a government portrait.
    assert.ok(
      !/Gage Skidmore|Wikimedia|CC BY/i.test(card.photoSource ?? ""),
      `the old attribution rode along: "${card.photoSource}"`,
    );
    assert.match(card.photoSource ?? "", /Official portrait/);
  }
});

test("a candidate who holds no office keeps their own card photo", () => {
  // Nobody's photo is replaced by a lookup that missed — the resolver
  // returns null and the card stands, which is what keeps challengers'
  // campaign-provided portraits intact (the equal-effort rule).
  assert.equal(officialPhotoForPerson("Zzz Nobodyhere"), null);
  const unchanged = cardForCandidacy("ballot-az-pima:governor:hourihan-teri-ann");
  if (unchanged?.photoUrl) {
    assert.match(unchanged.photoUrl, /^\/candidates\//);
  }
});

test("person keys ignore suffixes, accents and punctuation, and nothing else", () => {
  assert.equal(personKey("Katie Hobbs"), "KATIE HOBBS");
  assert.equal(personKey("Daniel Butierez Sr."), "DANIEL BUTIEREZ");
  assert.equal(personKey("José D. García-López"), "JOSE D GARCIA LOPEZ");
  // Distinct people stay distinct — the resolver must never merge two
  // humans into one face.
  assert.notEqual(personKey("Alma Hernandez"), personKey("Consuelo Hernandez"));
});
