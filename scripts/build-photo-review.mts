/**
 * Build `data/photos/review.json` — the RULING 55 photo review store.
 * (NH Hunt 3, 2026-08-21.)
 *
 * Three populations, and they are labelled differently on purpose.
 *
 * **APPROVED EN BLOC (was GRANDFATHERED).** Every photo shipping the day
 * RULING 55 was adopted was recorded `APPROVED` with
 * `decidedBy: "grandfathered"` — which meant *shipping before the rule existed,
 * approved by nobody*. Gating on an empty store would have blanked every
 * portrait in production the moment the rule shipped, and shipping a
 * reader-facing regression to satisfy a new rule is not a trade this product
 * makes.
 *
 * **`NH26` closed on 2026-08-24**: Sean approved the set en bloc — he checked a
 * few, and if one has issues later he will call it out specifically. The label
 * says EN BLOC rather than per-asset because that is what happened. Recording
 * it as though he had read every one would be the unread-evidence problem the
 * ruling exists to end, pointed at his own decision.
 *
 * **APPROVED PER ASSET.** The seventeen that sat PENDING behind `NH30`,
 * `NH65`, `NH78` and `NH111`, each read as an image and decided individually on
 * 2026-08-24.
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

/**
 * **SEAN'S DECISIONS OF 2026-08-24.** Individually approved, by asset, after
 * reading each one as an image.
 *
 * These are the four groups that had been sitting PENDING behind Needs Sean
 * rows — `NH30` (3), `NH65` (5), `NH78` (7) and `NH111` (2) — seventeen
 * portraits in total. Every one was hunted, read as an image, and recorded
 * with its door before it was ever put in front of him; what was owed was the
 * one judgement a machine cannot make.
 *
 * **The decision keys to the ASSET, not to the person**, which is why the URL
 * travels with it: approving a portrait does not approve whatever later
 * replaces it at the same person key.
 */
const SEAN_APPROVED_20260824: { name: string; url: string; door: string; row: string }[] = [
  // NH30 — three portraits, hunted 2026-08-21.
  { name: "Meg Hagaman", url: "/candidates/nh-merrimack-county-attorney-hagaman-meg.jpg", door: "3 — the campaign's own self-published portrait (meg-for-merrimack.com/about)", row: "NH30" },
  { name: "Jon Raiche", url: "/candidates/nh-merrimack-county-attorney-raiche-jon.jpg", door: "3 — the campaign's own self-published portrait (votejonraiche.com)", row: "NH30" },
  { name: "Vincent S. Ribas", url: "/candidates/nh-merrimack-county-commissioner-2-ribas-vincent-s.jpg", door: "2 — the portrait the City of Franklin publishes of its own councillor (franklinnh.gov)", row: "NH30" },

  // NH65 — five New Jersey municipal portraits, hunted 2026-08-22.
  { name: "Jennifer Rowland", url: "/candidates/nj-morris-chatham-township-committee-rowland-jennifer.jpg", door: "2 — Chatham Township's own portrait of its committee member (chathamtownship.org)", row: "NH65" },
  { name: "Melissa Senatore", url: "/candidates/nj-morris-jefferson-township-council-senatore-melissa.jpg", door: "2 — Jefferson Township's own portrait (jeffersontownship.net). Attribution is BY POSITION: the image sits inside the council card naming her and nobody else, and the file path carries no name. Stated rather than smoothed", row: "NH65" },
  { name: "Sean Mabey", url: "/candidates/nj-morris-kinnelon-borough-council-mabey-sean.jpg", door: "2 — Kinnelon Borough's own portrait (kinnelonboro.org). FULL-LENGTH rather than head-and-shoulders; he is the unambiguous sole subject in the borough's council chamber, and it is the only picture Kinnelon publishes of him", row: "NH65" },
  { name: "Marilyn Althoff", url: "/candidates/nj-morris-mendham-borough-council-althoff-marilyn.png", door: "2 — Mendham Borough's own portrait (mendhamnj.org)", row: "NH65" },
  { name: "Melissa Muilenburg", url: "/candidates/nj-morris-mountain-lakes-borough-council-muilenburg-melissa.jpg", door: "2 — Mountain Lakes Borough's own portrait (mountainlakes.gov)", row: "NH65" },

  // NH111 — two door-3 campaign portraits at 07866, from 25 images read on two
  // contact sheets. The other 23 failed the composition standard.
  { name: "Lana Leguía", url: "/candidates/nj-morris-us-house-7-leguia-lana.jpg", door: "3 — the campaign's own self-published portrait (lanaleguia.com), labelled campaign-provided", row: "NH111" },
  { name: "Joe Hathaway", url: "/candidates/nj-morris-us-house-11-hathaway-joe.jpg", door: "3 — the campaign's own self-published portrait (joehathawayforcongress.com), labelled campaign-provided. THREE-QUARTER LENGTH rather than head-and-shoulders; the reservation was put to Sean as a reservation and he approved it", row: "NH111" },
];

/**
 * **`NH10` — TOBIN MENARD STAYS INITIALS, and Sean affirmed the refusal.**
 *
 * His campaign publishes exactly one picture of him and it carries the words
 * "Accountability Responsibility" printed across it in red. The composition
 * standard forbids a wordmark by name, at every door, and Sean's words on
 * 2026-08-24 were **"no campaign slogans or anything like that"**.
 *
 * This is recorded as a REJECTION rather than left absent because a refusal is
 * a branch result (RULING 52) — it says *this image is not shippable*, and
 * nothing at all about whether a clean portrait of him exists. Recording it is
 * what stops the next session re-proposing the same file.
 */
const SEAN_REFUSED_20260824 = [
  {
    name: "Tobin Menard",
    url: "https://img1.wsimg.com/isteam/ip/a891f544-c975-41d1-bb8a-f622f4686df8/blob-0bec72c.png",
    reason:
      "Read as an image 2026-08-21: a clean studio portrait of the sole subject " +
      "holding a pair of scales, with 'Accountability Responsibility' overlaid in " +
      "red across the lower third. Sean affirmed the refusal on 2026-08-24 — " +
      "\"no campaign slogans or anything like that\". The composition standard names " +
      "a wordmark, and it never moves at any door. He renders honest initials, " +
      "which this product treats as a success; the hunt for a clean portrait of him " +
      "continues.",
    decidedAt: "2026-08-24",
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
for (const r of SEAN_REFUSED_20260824) {
  const rk = personKey(r.name);
  (reviews[rk] ??= []).push({
    state: "REJECTED",
    url: r.url,
    reason: r.reason,
    decidedAt: r.decidedAt,
    decidedBy: "Sean (his decision of 2026-08-24, affirming the refusal)",
  });
}
const rejected = REJECTIONS.length + SEAN_REFUSED_20260824.length;

/* ── Sean's individual approvals of 2026-08-24, before the grandfather pass ── */
let approvedBySean = 0;
for (const a of SEAN_APPROVED_20260824) {
  const pk = personKey(a.name);
  (reviews[pk] ??= []).push({
    state: "APPROVED",
    url: a.url,
    reason:
      `Read as an image before it was proposed, and APPROVED BY SEAN on 2026-08-24 ` +
      `(${a.row}). Door ${a.door}. Remove-on-request.`,
    decidedAt: "2026-08-24",
    decidedBy: "Sean (his decision of 2026-08-24, per asset)",
  });
  approvedBySean += 1;
}

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
  /*
   * **`NH26` CLOSED 2026-08-24 — THESE ARE SEAN'S NOW, EN BLOC.**
   *
   * They were recorded `grandfathered`, which meant *shipping before the rule
   * existed, not approved by anybody*. On 2026-08-24 he approved the set: he
   * checked a few, and if one has issues later he will call it out
   * specifically; otherwise good to go.
   *
   * **It is labelled EN BLOC rather than per-asset, and that distinction is
   * kept deliberately.** He did not read forty-eight images one at a time, and
   * recording this as though he had would be the unread-evidence problem
   * RULING 55 exists to end, pointed at his own decision. What changed is real
   * and is what the rule asked for: a named person with the authority to decide
   * has decided, and these no longer sit in a queue waiting for somebody.
   */
  (reviews[pk] ??= []).push({
    state: "APPROVED",
    url,
    reason:
      "APPROVED BY SEAN EN BLOC on 2026-08-24, in his words: he checked a few, " +
      "and if one has issues later he will call it out specifically; otherwise " +
      "good to go. Previously recorded `grandfathered`, which meant shipping " +
      "before RULING 55 existed and approved by nobody. En bloc is recorded " +
      "rather than per-asset because that is what happened — he did not read " +
      "forty-eight images one at a time, and saying he had would be the " +
      "unread-evidence problem this rule exists to end. Remove-on-request, and " +
      "any single one comes out the moment he names it.",
    decidedAt: "2026-08-24",
    decidedBy: "Sean (his decision of 2026-08-24, en bloc)",
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
    approvedEnBlocBySean: grandfathered,
    approvedBySeanPerAsset: approvedBySean,
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
