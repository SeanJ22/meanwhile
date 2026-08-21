/**
 * Build `data/photos/review.json` — the RULING 55 photo review store.
 * (NH Hunt 3, 2026-08-21.)
 *
 * Two populations, and they are labelled differently on purpose.
 *
 * **GRANDFATHERED.** Every photo shipping the day RULING 55 was adopted is
 * recorded `APPROVED` with `decidedBy: "grandfathered"`. This is the same
 * decision RULING 20's asset guard made and for the same reason, recorded in
 * `tests/asset-store.test.ts`: gating on an empty store would blank every
 * candidate and official portrait in production the moment the rule shipped,
 * and *shipping a reader-facing regression to satisfy a new rule is not a trade
 * this product makes.*
 *
 * It is labelled honestly rather than dressed as review: `grandfathered` means
 * **shipping before the rule existed, not individually approved by the
 * author**. Every one carries `decidedAt`, so RULING 53's clock runs on it and
 * `pnpm stale` will surface it. The Needs Sean row names the count.
 *
 * **REJECTED.** The four images NH Hunt 2 refused, plus one from 2026-08-14 of
 * the same class, each with the reason in the words of the session that caught
 * it. A rejection is a BRANCH RESULT under RULING 52 — it says *this image,
 * from this source, is not this person*, and nothing at all about whether a
 * correct portrait exists. The hunt continues.
 *
 * Run:
 *   node scripts/build-photo-review.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { officialPhotoForPerson } from "../lib/photos/person.ts";
import { today } from "./doc-dates.mjs";

const TODAY = today();
const ROOT = process.cwd();
const OUT_DIR = join(ROOT, "data", "photos");
const OUT = join(OUT_DIR, "review.json");

const cards = JSON.parse(
  readFileSync(join(ROOT, "data", "ballot", "candidate-cards-2026.json"), "utf8"),
) as { cards: Record<string, { photoUrl: string | null }> };

/** Same normalisation `lib/photos/person.ts` uses, so the keys meet. */
const personKey = (name: string): string =>
  name
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\b(JR|SR|II|III|IV)\b\.?/g, "")
    .replace(/[^A-Z ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * The refusals, in the words of the sessions that caught them. Every one was
 * found by a human READING THE IMAGE; every one passed every mechanical check
 * the repo had.
 */
const REJECTIONS = [
  {
    name: "Victor Orlando",
    url: "https://victororlando.com/images/headshots/victor-formal.jpg",
    reason:
      "Read as an image 2026-08-21: a stock photograph of the United States flag " +
      "against a blue sky. There is no person in it. The filename, the path " +
      "(/images/headshots/) and the alt text ('Victor Orlando') all say formal " +
      "headshot. A hunt that trusted any of the three would have shipped a flag " +
      "as this man's face.",
    decidedAt: "2026-08-21",
  },
  {
    name: "Jason Gerhard",
    url: "og:image and twitter:image on the candidate's own site (same file)",
    reason:
      "Read as an image 2026-08-21: a scanned cover of a 1978 New Hampshire Grand " +
      "Jury manual, not a portrait. A hunt that trusted og:image would have " +
      "shipped a library document as this man's face.",
    decidedAt: "2026-08-21",
  },
  {
    name: "Karishma Manzur",
    url: "og:image on karishmaforsenate.com",
    reason:
      "Read as an image 2026-08-21: her photograph beside a wordmark reading " +
      "'KARISHMA MANZUR / US SENATE' over a state outline. The composition " +
      "standard forbids a banner and a wordmark by name, and this is both. The " +
      "standards never move, at any door.",
    decidedAt: "2026-08-21",
  },
  {
    name: "Karishma Manzur (second image)",
    url: "https://karishmaforsenate.com/Monkman_Manzur_Campaign_022.jpg",
    reason:
      "The filename carries a PHOTOGRAPHER'S credit. Photographer-credited images " +
      "are prohibited at EVERY door — that is the demand-letter class and no door " +
      "reaches it. A working photographer's copyright is not narrowed by where " +
      "the image was reposted.",
    decidedAt: "2026-08-21",
  },
  {
    name: "Kelly Ayotte",
    url: "KellyAyotteForNH_WinRed_WebsitePullTrough_v2-1.jpg",
    reason:
      "A campaign graphic with logo text, not a portrait. Refused 2026-08-14 when " +
      "the composition standard was tightened; recorded here because it is the " +
      "same class as the three NH Hunt 2 caught and the store is the record.",
    decidedAt: "2026-08-14",
  },
];

interface Decision { state: string; url: string; reason: string; decidedAt: string; decidedBy: string }
const reviews: Record<string, Decision[]> = {};

/* ── The refusals first, so a grandfather pass can never overwrite one ────── */
for (const r of REJECTIONS) {
  const rk = personKey(r.name);
  (reviews[rk] ??= []).push({
    state: "REJECTED",
    url: r.url,
    reason: r.reason,
    decidedAt: r.decidedAt,
    decidedBy: "Sean (the author's standing composition and licence rules)",
  });
}
const rejected = REJECTIONS.length;

/* ── Then everything currently shipping ──────────────────────────────────── */
let grandfathered = 0;
for (const [key, card] of Object.entries(cards.cards)) {
  /*
   * **THE SAME DERIVATION THE CODE USES, not a plausible one.**
   *
   * `lib/ballot/candidate-cards.ts` recovers the person's name from a candidacy
   * id with `tail.split("-").reverse().join(" ")` — the id ends `surname-given`
   * and the reverse puts it back in reading order. The first version of this
   * script wrote `.replace(/-/g, " ")` instead, producing `HOBBS KATIE` where
   * the lookup asks for `KATIE HOBBS`, so almost every grandfathered record
   * missed its key and portraits dropped across the product. Caught by the
   * standing test on the author's own Hobbs card.
   *
   * A `contestId|Name` key has no dash form and is used as written.
   */
  const tail = key.split(":").pop() ?? "";
  const name =
    (key.includes("|") ? key.split("|").pop() : tail.split("-").reverse().join(" ")) ?? "";
  /*
   * **GRANDFATHER THE URL THE RENDER PATH ACTUALLY RESOLVES**, which is not
   * always `card.photoUrl`. `withPersonPhoto` prefers a sitting officeholder's
   * OFFICIAL portrait over the card's own — that is the one-person-one-photo
   * rule, and for the statewide executives the portrait is carried inline in
   * `statewide-executives.ts` rather than in the cards file at all. A grandfather
   * pass reading only the cards missed every one of them, and Katie Hobbs's
   * portrait — the author's own flagged card — dropped out of the product. The
   * standing test caught it.
   *
   * So this asks the same resolver the page asks, and records the answer.
   */
  const official = officialPhotoForPerson(name);
  const url = official?.url ?? card.photoUrl;
  if (!url) continue;
  const pk = personKey(name);
  // A refusal of a DIFFERENT image never blocks this one — see the store’s
  // own note. Only an existing decision for THIS url is left alone.
  if ((reviews[pk] ?? []).some((r) => r.url === url)) continue;
  (reviews[pk] ??= []).push({
    state: "APPROVED",
    url,
    reason:
      "GRANDFATHERED — shipping before RULING 55 existed, NOT individually " +
      "approved by the author. On RULING 53's clock from this date and surfaced " +
      "by `pnpm stale`; the Needs Sean row names the count.",
    decidedAt: TODAY,
    decidedBy: "grandfathered",
  });
  grandfathered += 1;
}

const file = {
  note:
    "RULING 55 (2026-08-21) — a photo never blocks anything, and every photo is " +
    "reviewed by Sean. Only an APPROVED photo renders; a PENDING one renders " +
    "initials, which this product treats as a success. Nothing else on the card " +
    "is affected by any of this: name, party, blurb, contacts, filed address, " +
    "funding and votes render exactly as they would if no photo had ever been " +
    "found. This is a CORRECTNESS gate on one field, never a completeness gate " +
    "on a card — see lib/photos/review.ts for why the distinction is the rule. " +
    "A REJECTED photo is a branch result under RULING 52: this image is not this " +
    "person, and nothing about whether a correct portrait exists.",
  builtAt: TODAY,
  counts: {
    rejected,
    grandfathered,
    people: Object.keys(reviews).length,
    decisions: Object.values(reviews).flat().length,
  },
  reviews,
};

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, `${JSON.stringify(file, null, 2)}\n`, "utf8");

console.log("photo review store:");
console.log(`  rejected (backfilled)   ${rejected}`);
console.log(`  grandfathered APPROVED  ${grandfathered}`);
console.log(`  people                  ${Object.keys(reviews).length}`);
console.log(`  decisions               ${Object.values(reviews).flat().length}`);

// An operation that can return nothing must be asked what it returned.
if (grandfathered === 0) {
  console.error("REFUSED: zero photos grandfathered. Every portrait would blank.");
  process.exit(1);
}

const back = JSON.parse(readFileSync(OUT, "utf8"));
console.log(`  re-read                 ${Object.keys(back.reviews).length} people`);
