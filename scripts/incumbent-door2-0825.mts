#!/usr/bin/env tsx
/**
 * @freshness-reads-here
 *
 * RULING 107 — the clock stamps here are minted by the code path that performs
 * the read: `attemptedAt` is taken in the run that fetched the page it describes.
 */
/**
 * **DOOR 2 FOR EVERY INCUMBENT SEEKING RE-ELECTION.**
 * (The final pass, 2026-08-25, item 6.)
 *
 * ```
 * pnpm door2                 # walk and report, write nothing
 * pnpm door2 --write         # queue the portraits and record the phones
 * ```
 *
 * ## The class, and why it is pre-approved
 *
 * The photo rule's **door 2** is the portrait a government body publishes to
 * identify its own member, with attribution to the publishing body and
 * remove-on-request. The author's ruling of 2026-08-24 pre-approves that class
 * for sitting officials, so a candidate who currently HOLDS the office they are
 * standing for has a door already open — and nobody had walked it for them.
 *
 * The incumbents are found by joining the committed rosters to the ballot rather
 * than by asking who looks like an incumbent: a person is one here exactly when
 * this repo already records them sitting on a governing body.
 *
 * ## THE ROUTE THAT WAS WRONG BEFORE, AND IS NOT REPEATED
 *
 * `NJ13` recorded six of seven Morris County commissioners as having no
 * portrait, on the strength of two identical attempts at the BOARD'S INDEX page.
 * The seventh was walked at his own leaf page and returned a portrait
 * immediately. Every one of their own page URLs was already sitting in the
 * roster as `websiteUrl`.
 *
 * So this walks the MEMBER'S OWN PAGE, and where the roster carries none it says
 * so rather than substituting the index and recording the miss as a finding.
 *
 * ## WHAT SHIPS, AND IT IS NOTHING
 *
 * **Zero candidate photos ship from this script.** It queues them for the
 * author's review, which is the standing rule for candidate portraits and is not
 * negotiable by a hunt that thinks its matches are good. What it writes is a
 * QUEUE: the person, the page, the image, why it was matched, and the door.
 *
 * The picker is `lib/hunt/portrait-pick.ts` — name-matched or nothing, because a
 * page-furniture image is what a largest-image heuristic picks and a wrong face
 * fails at every door. It reads `<img>` elements and never `og:image`: the
 * 2026-08-24 session measured 7 of 7 `og:image` reads returning a share card.
 *
 * ## Phones ride along, because they are on the same page
 *
 * A municipal member page carries a phone far more often than it carries a
 * portrait, and `phone` is the field this ballot is thinnest on. Fetching the
 * page twice to collect them separately would be a second request for a document
 * already in hand.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { decodeEntities, imagesIn, phoneIn, pickPortrait, verifyIsImage } from "../lib/hunt/portrait-pick.ts";
import { politeGetText } from "../lib/sources/http.ts";
import { conserve } from "../lib/sources/normalize-account.ts";
import { today } from "./doc-dates.mjs";

const ROOT = join(import.meta.dirname, "..");
const WRITE = process.argv.includes("--write");
const TODAY = today();

const ballot = JSON.parse(readFileSync(join(ROOT, "data", "states", "nj", "ballot", "nj-morris-2026.json"), "utf8")) as {
  contests: { id: string; title: string }[];
  candidacies: { id: string; contestId: string; givenName: string; familyName: string }[];
};
const contestTitle = new Map(ballot.contests.map((c) => [c.id, c.title]));

const cards = JSON.parse(readFileSync(join(ROOT, "data", "ballot", "candidate-cards-2026.json"), "utf8")) as {
  cards: Record<string, { photoUrl?: string | null; phone?: string | null }>;
};

function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Every roster member this repo holds, from both committed sources. */
interface Member {
  name: string;
  officeTitle?: string;
  phone?: string | null;
  websiteUrl?: string | null;
  bodyName?: string;
}
const members: Member[] = [];

const wired = join(ROOT, "lib", "registry", "rosters-nj-morris.ts");
if (existsSync(wired)) {
  const src = readFileSync(wired, "utf8");
  const bodies = JSON.parse(src.slice(src.indexOf("= ") + 2, src.lastIndexOf(";"))) as {
    bodyName: string;
    members: Member[];
  }[];
  for (const b of bodies) for (const m of b.members) members.push({ ...m, bodyName: b.bodyName });
}

const walkPath = join(ROOT, "data", "states", "nj", "hunt", "roster-pages-muni-sites-nj-morris.json");
if (existsSync(walkPath)) {
  const walk = JSON.parse(readFileSync(walkPath, "utf8")) as {
    sites: { municipality: string; url?: string; rosterUrl?: string; members?: Member[] }[];
  };
  for (const s of walk.sites) {
    for (const m of s.members ?? []) {
      members.push({ ...m, bodyName: s.municipality, websiteUrl: m.websiteUrl ?? s.rosterUrl ?? s.url ?? null });
    }
  }
}

/** The incumbents: a candidacy whose person this repo already records sitting. */
const byName = new Map<string, Member[]>();
for (const m of members) {
  const k = fold(m.name);
  byName.set(k, [...(byName.get(k) ?? []), m]);
}

interface Row {
  candidacyId: string;
  subject: string;
  contestTitle: string;
  bodyName: string;
  page: string | null;
  status: number;
  bytes: number;
  photoAlreadyHeld: boolean;
  phoneAlreadyHeld: boolean;
  portrait: { src: string; alt: string; why: string } | null;
  /** The page named an image for this person and the URL did not serve one. */
  imageRefusal: { src: string; why: string } | null;
  phone: string | null;
  door: "door 2 — the portrait a government body publishes of its own member";
  attemptedAt: string;
  note: string;
}

const rows: Row[] = [];
const incumbents = ballot.candidacies.filter((c) => byName.has(fold(`${c.givenName} ${c.familyName}`)));

console.log(`\nDOOR 2 FOR SITTING OFFICIALS ON THE BALLOT — ${TODAY}\n`);
console.log(`  candidacies on the ballot            ${ballot.candidacies.length}`);
console.log(`  roster members this repo holds       ${members.length}`);
console.log(`  candidacies who ARE sitting members  ${incumbents.length}`);
console.log(`  ZERO photos ship from here — they queue for review\n`);

let attempted = 0;
let noPage = 0;
let refused = 0;

for (const c of incumbents) {
  const subject = `${c.givenName} ${c.familyName}`;
  const held = byName.get(fold(subject))!;
  /*
   * THE MEMBER'S OWN PAGE, never the body's index — NJ13's defect. Where several
   * roster rows carry the person, the most specific URL wins: a leaf page is
   * longer than the index it hangs off.
   */
  const page =
    held
      .map((m) => m.websiteUrl)
      .filter((u): u is string => Boolean(u))
      .sort((a, b) => b.length - a.length)[0] ?? null;
  const rosterPhone = held.map((m) => m.phone).find((p) => Boolean(p)) ?? null;
  const bodyName = held[0]?.bodyName ?? "";

  const photoHeld = Boolean(cards.cards[c.id]?.photoUrl);
  const phoneHeld = Boolean(cards.cards[c.id]?.phone);

  if (!page) {
    noPage += 1;
    rows.push({
      candidacyId: c.id,
      subject,
      contestTitle: contestTitle.get(c.contestId) ?? "",
      bodyName,
      page: null,
      status: 0,
      bytes: 0,
      photoAlreadyHeld: photoHeld,
      phoneAlreadyHeld: phoneHeld,
      portrait: null,
      imageRefusal: null,
      phone: rosterPhone,
      door: "door 2 — the portrait a government body publishes of its own member",
      attemptedAt: TODAY,
      note:
        "The roster carries no page of their own for this person, so there is no leaf to walk. " +
        "Substituting the body's index is the NJ13 defect and is not done here.",
    });
    console.log(`  ${subject.padEnd(26)} — no page of their own in the roster`);
    continue;
  }

  attempted += 1;
  let status = 0;
  let text = "";
  try {
    const r = await politeGetText(page, {});
    status = r.status;
    text = r.text;
  } catch {
    status = 0;
  }
  if (status !== 200 || text.length === 0) {
    refused += 1;
    rows.push({
      candidacyId: c.id,
      subject,
      contestTitle: contestTitle.get(c.contestId) ?? "",
      bodyName,
      page,
      status,
      bytes: text.length,
      photoAlreadyHeld: photoHeld,
      phoneAlreadyHeld: phoneHeld,
      portrait: null,
      imageRefusal: null,
      phone: rosterPhone,
      door: "door 2 — the portrait a government body publishes of its own member",
      attemptedAt: TODAY,
      note: `HTTP ${status || "network"} — a wall on ${TODAY}, never an absence`,
    });
    console.log(`  ${subject.padEnd(26)} HTTP ${status || "network"}  ${page}`);
    continue;
  }

  const picked = pickPortrait(subject, imagesIn(text, page));
  /*
   * THE MARKUP SAID IMAGE; THE URL HAS TO AGREE.
   *
   * `pickPortrait` finds a name-matched `<img src>`, which is a claim about the
   * PAGE and not about what the URL serves. Measured on this walk's first run:
   * `chesterborough.org//images/...` — the double slash is the site's own
   * template — answers HTTP 200 with `text/html` and 12 KB. Two soft-404 pages
   * were queued as named people's faces, and the only reason it was caught is
   * that RULING 2 made somebody open the review sheet AS AN IMAGE and see two
   * broken tiles.
   *
   * A portrait that does not verify is a REFUSAL with its reason recorded, never
   * a silent drop: the page really does name an image for this person and
   * something is wrong at the other end, which is a finding a later session can
   * act on.
   */
  const verdict = picked ? await verifyIsImage(picked.src) : null;
  const portrait = picked && verdict?.ok ? { ...picked, src: decodeEntities(picked.src) } : null;
  const imageRefusal = picked && verdict && !verdict.ok ? { src: picked.src, why: verdict.why } : null;
  /*
   * The phone is read from the passage AROUND the person's name, never from the
   * whole page: a municipal page carries the clerk's number, the police
   * number and the tax office's, and the first digit run on it belongs to none
   * of the people listed.
   */
  const at = text.toLowerCase().indexOf(fold(c.familyName));
  const near = at >= 0 ? text.slice(Math.max(0, at - 400), at + 700) : "";
  const phone = rosterPhone ?? (near ? phoneIn(near) : null);

  rows.push({
    candidacyId: c.id,
    subject,
    contestTitle: contestTitle.get(c.contestId) ?? "",
    bodyName,
    page,
    status,
    bytes: text.length,
    photoAlreadyHeld: photoHeld,
    phoneAlreadyHeld: phoneHeld,
    portrait,
    imageRefusal,
    phone,
    door: "door 2 — the portrait a government body publishes of its own member",
    attemptedAt: TODAY,
    note: portrait
      ? `name-matched portrait on their own page (${portrait.why}); the URL serves ${verdict?.why}`
      : imageRefusal
        ? `the page names an image for this person and the URL does not serve one — ${imageRefusal.why}`
        : "the page carries no image bearing this person's name — reported as no candidate image rather than as the best of a bad set",
  });
  console.log(
    `  ${subject.padEnd(26)} ${portrait ? "PORTRAIT" : imageRefusal ? "NOT-IMAGE" : "no image "} ${phone ? phone.padEnd(22) : "no phone".padEnd(22)} ${page.slice(0, 56)}`,
  );
}

const queued = rows.filter((r) => r.portrait && !r.photoAlreadyHeld);
/**
 * A page that NAMES an image for this person where the URL serves something
 * else. Refused with the reason and never queued — a soft 404 offered as a
 * named person's face is the wrong-face failure in a different costume.
 */
const notImages = rows.filter((r) => r.imageRefusal);
const phonesNew = rows.filter((r) => r.phone && !r.phoneAlreadyHeld);
const accounting = conserve("incumbent-door2", {
  logicalInput: incumbents.length,
  produced: rows.filter((r) => r.status === 200).length,
  dropped: noPage + refused,
  outOfWindow: 0,
  duplicates: 0,
  unretrieved: 0,
});

console.log(`\n  pages walked            ${attempted}`);
console.log(`  no page of their own    ${noPage}`);
console.log(`  refused                 ${refused} — walls on this date, never absences`);
console.log(`  accounting              ${accounting.outcome}, ${accounting.accountedFor} of ${incumbents.length}`);
console.log(`\n  PORTRAITS QUEUED FOR REVIEW  ${queued.length}   (shipped: 0, and that is the rule)`);
console.log(`  named an image that is NOT one ${notImages.length} — refused with the reason, never queued`);
for (const r of notImages) console.log(`    ${r.subject.padEnd(26)} ${r.imageRefusal?.why.slice(0, 96)}`);
console.log(`  PHONES newly found           ${phonesNew.length}`);
for (const r of phonesNew) console.log(`    ${r.subject.padEnd(26)} ${r.phone}`);

if (accounting.outcome !== "CONSERVED") {
  console.error(`\n  ${accounting.outcome}: ${JSON.stringify(accounting)}`);
  process.exit(1);
}

if (WRITE) {
  const out = join(ROOT, "data", "photos", `door2-incumbents-${TODAY}.json`);
  writeFileSync(
    out,
    `${JSON.stringify(
      {
        note:
          "Door 2 walked for every candidate this repo already records sitting on a governing body — " +
          "the pre-approved class. THE MEMBER'S OWN PAGE, never the body's index, which is the NJ13 " +
          "defect. Portraits are QUEUED for the author's review and none ships from here. Phones ride " +
          "along because they are on the same document, and are read from the passage around the " +
          "person's name rather than from the whole page. Written by " +
          "scripts/incumbent-door2-0825.mts.",
        walkedAt: TODAY,
        door: "door 2",
        shipped: 0,
        totals: {
          ballotCandidacies: ballot.candidacies.length,
          rosterMembers: members.length,
          incumbentsOnTheBallot: incumbents.length,
          pagesWalked: attempted,
          noPageOfTheirOwn: noPage,
          refused,
          portraitsQueued: queued.length,
          namedAnImageThatIsNotOne: notImages.length,
          phonesFound: phonesNew.length,
        },
        accounting,
        rows,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  console.log(`\n  written ${out}`);
} else {
  console.log("\n  report only — pass --write to record the queue");
}
