import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  allCandidateCards,
  cardForCandidacy,
  cardForNominee,
} from "../lib/ballot/candidate-cards.ts";
import {
  grandfathered,
  photoMayRender,
  rejections,
  reviewFor,
} from "../lib/photos/review.ts";
import { personKey } from "../lib/photos/person.ts";

/**
 * **RULING 55 — a photo never blocks anything, and every photo is reviewed by
 * Sean.** (Adopted 2026-08-21, the author's ruling, NH Hunt 3.)
 *
 * Three false portraits shipped past every mechanical check the repo had in a
 * single session, and every one was caught by a human READING THE IMAGE:
 * a stock photograph of the United States flag alt-texted with a candidate's
 * name and served from `/images/headshots/`; a scanned cover of a 1978 New
 * Hampshire Grand Jury manual served as a campaign's own `og:image`; and a
 * name-and-office banner. A fourth was refused on a photographer's credit in
 * its filename.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const resolve = (key: string) =>
  key.includes("|")
    ? cardForNominee(key.slice(0, key.indexOf("|")), key.slice(key.indexOf("|") + 1))
    : cardForCandidacy(key);

/* ────────────────────── it is not a suppression path ───────────────────── */

test("a person renders FULLY with a photo pending — every other field survives", () => {
  /*
   * THE claim that keeps this from becoming a suppression path by drift.
   *
   * RULING 26 and RULING 27 forbid withholding what the product holds about a
   * person because something ELSE about them is missing. This is a correctness
   * gate on ONE field about that field's own truth, and the difference has to
   * be checkable rather than asserted in a comment.
   */
  const file = allCandidateCards();
  const key = Object.keys(file.cards).find((k) => {
    const c = file.cards[k];
    return c?.photoUrl && c.bio && (c.email || c.phone || c.filedAddress);
  });
  assert.ok(key, "no card with a photo and other fields to test against");

  const before = resolve(key)!;
  // Ask the gate about an image nobody has decided on, for this same person.
  const unreviewed = "https://example.test/never-reviewed-by-anyone.jpg";
  const personKeyish = key.split(":").pop()!.split("-").reverse().join(" ");
  assert.equal(
    photoMayRender(personKeyish.toUpperCase(), unreviewed),
    false,
    "an image nobody has looked at may not render — a file existing is not a photograph",
  );

  // And everything else is untouched by the photo's state.
  for (const field of ["bio", "bioSourceUrl", "bioSourceLabel", "email", "phone", "filedAddress"] as const) {
    assert.equal(
      before[field],
      file.cards[key]![field],
      `${field} must not be affected by the photo's review state`,
    );
  }
});

test("PENDING is the default — nothing is approved by not being looked at", () => {
  const r = reviewFor("NOBODY AT ALL", "https://example.test/x.jpg");
  assert.equal(r.state, "PENDING");
  assert.equal(photoMayRender("NOBODY AT ALL", "https://example.test/x.jpg"), false);
});

test("a decision is about an IMAGE, so refusing one file does not withhold the next", () => {
  /*
   * The first version of the store held one record per PERSON, which meant
   * recording that Kelly Ayotte's WinRed campaign banner was refused ALSO
   * withheld her official U.S. Senate portrait — a public-domain federal work
   * already shipping. Refusing one file is not a finding about another.
   */
  const rejected = rejections();
  assert.ok(rejected.length >= 4, `expected the backfilled refusals, found ${rejected.length}`);
  for (const r of rejected) {
    assert.ok(
      r.reason && r.reason.trim() !== "",
      `${r.personKey} was refused with no reason recorded — a rejection is a branch ` +
        "result under RULING 52 and must say what was wrong",
    );
    assert.match(r.decidedAt ?? "", /^\d{4}-\d{2}-\d{2}$/, `${r.personKey} has no decision date`);
  }
});

/* ───────────────────────── no reader-facing regression ─────────────────── */

test("no photo that was rendering stopped rendering when the gate shipped", () => {
  /*
   * The pair, stated. Gating on an empty store would have blanked every
   * portrait in the product the moment the rule shipped, and shipping a
   * reader-facing regression to satisfy a new rule is not a trade this product
   * makes — the same decision RULING 20's asset guard made, for the same
   * reason.
   *
   * **AMENDED 2026-08-21 (NH Hunt 4), and the amendment is the rule working.**
   * The first form of this test asserted that EVERY photo the store holds
   * renders. That made RULING 55's own PENDING state impossible: the first
   * three portraits hunted after the gate shipped — Meg Hagaman's, Jon
   * Raiche's and Vincent Ribas's — failed it, for being exactly what the
   * ruling says a newly found photo is. A test that forbids a new photo from
   * awaiting review has stopped guarding the ruling and started contradicting
   * it.
   *
   * So the claim is stated as what it always meant: **a photo is dropped only
   * by a DECISION about that photo.** Every drop must be either a REJECTED
   * image or one the author has not looked at yet, and a portrait carrying an
   * APPROVED record — which includes every one grandfathered on ship day — may
   * never stop rendering. Both numbers print, because a growing pending queue
   * is a fact somebody should be able to see.
   */
  const file = allCandidateCards();
  let raw = 0;
  let rendered = 0;
  const droppedApproved: string[] = [];
  const pending: string[] = [];
  const refused: string[] = [];
  for (const [key, card] of Object.entries(file.cards)) {
    if (!card?.photoUrl) continue;
    raw += 1;
    if (resolve(key)?.photoUrl) {
      rendered += 1;
      continue;
    }
    const state = reviewFor(personNameOf(key), card.photoUrl).state;
    if (state === "APPROVED") droppedApproved.push(key);
    else if (state === "REJECTED") refused.push(key);
    else pending.push(key);
  }
  assert.ok(raw > 50, `expected the portrait set, counted ${raw}`);
  assert.deepEqual(
    droppedApproved,
    [],
    `${droppedApproved.length} of ${raw} APPROVED portraits stopped rendering: ` +
      droppedApproved.join(", "),
  );
  assert.equal(
    rendered + pending.length + refused.length,
    raw,
    `the pair must reconcile: ${rendered} rendered + ${pending.length} pending + ` +
      `${refused.length} refused should equal ${raw} held`,
  );
});

/**
 * The person key a photo decision is filed under, derived the same way
 * `candidate-cards.ts` derives it — from the candidacy id's tail, or from the
 * nominee name after the pipe.
 */
function personNameOf(key: string): string {
  const raw = key.includes("|")
    ? key.slice(key.indexOf("|") + 1)
    : (key.split(":").pop() ?? key).split("-").reverse().join(" ");
  return personKey(raw);
}

/* ─────────────────────────── the store's honesty ───────────────────────── */

test("grandfathered is labelled as what it is, and is not counted as reviewed", () => {
  /*
   * `grandfathered` means SHIPPING BEFORE THE RULE EXISTED, NOT INDIVIDUALLY
   * APPROVED BY THE AUTHOR. Reporting these as reviewed would be exactly the
   * unread-evidence problem RULING 2 and RULING 55 both exist to end.
   */
  const g = grandfathered();
  assert.ok(g.length > 20, `expected the grandfathered set, found ${g.length}`);
  for (const r of g) {
    assert.equal(r.decidedBy, "grandfathered");
    assert.match(r.reason ?? "", /NOT individually/i, `${r.personKey} does not say it is unreviewed`);
    // On RULING 53's clock, so `pnpm stale` surfaces it rather than it sitting
    // approved forever on nobody's decision.
    assert.match(r.decidedAt ?? "", /^\d{4}-\d{2}-\d{2}$/);
  }
});

test("the store records the four NH Hunt 2 refusals by their reasons", () => {
  const reasons = rejections().map((r) => r.reason ?? "").join(" ");
  assert.match(reasons, /flag/i, "the flag stock photo");
  assert.match(reasons, /1978/, "the scanned Grand Jury manual");
  assert.match(reasons, /wordmark/i, "the name-and-office banner");
  assert.match(reasons, /PHOTOGRAPHER/i, "the photographer-credited file");
});

test("RULING 55 is written down where the gate lives", () => {
  // A stripped rule reads as guidance, and this one looks like a suppression
  // path to anyone who does not know why it is not.
  const src = readFileSync(join(ROOT, "lib", "ballot", "candidate-cards.ts"), "utf8");
  assert.match(src, /RULING 55/);
  assert.match(src, /never a completeness gate/i);
  const review = readFileSync(join(ROOT, "lib", "photos", "review.ts"), "utf8");
  assert.match(review, /NOT A SUPPRESSION PATH/i);
  assert.match(review, /branch result/i, "a rejection is a branch result under RULING 52");
});
