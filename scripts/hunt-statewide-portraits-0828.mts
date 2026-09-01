/**
 * `pnpm statewide:portraits` — **DOOR 2 OVER THE STATEWIDE EXECUTIVES.**
 * (2026-08-28, the statewide-executive acquisition. BAL-28.)
 *
 * ## Why this cohort, and why now
 *
 * `lib/officials/statewide-executives.ts` grew from three governors to fifteen
 * officeholders on 2026-08-28 — Arizona's Secretary of State, Attorney
 * General, Treasurer, Superintendent, Mine Inspector and five Corporation
 * Commissioners, plus New Jersey's Lieutenant Governor. Every one of those
 * rows shipped with `photoUrl: null`, which renders honest initials and blocks
 * nothing (RULING 55). **But an acquisition that leaves twelve new faces with
 * no route to the author is an acquisition that has quietly created a gap.**
 *
 * The route is DOOR 2, unchanged and already on the closed list: *the portrait
 * a government body publishes of its own member*, on that body's own page.
 * Every page walked here is the page the officeholder row already cites as its
 * source, so no new permission question arises — the host was swept before the
 * row was written.
 *
 * ## What it does NOT do
 *
 * **It ships nothing.** A row here is a PROPOSAL, and only the author approves
 * (RULING 55). The artifact is registered in `lib/photos/staged.ts` so
 * `pnpm photo:sheet` puts the picture in front of him; until he says yes, the
 * card shows initials.
 *
 * It also never picks "the largest image": `pickPortrait` requires the
 * person's own name in the alt text or the filename, because a largest-image
 * heuristic picks the state seal. A page with no name-bearing image is
 * recorded as **no candidate image**, never as the best of a bad set.
 *
 * ## And it decodes before it queues
 *
 * `MIN_PORTRAIT_EDGE` is 96. The Department of Education publishes its
 * Superintendent at a file literally named `Tom Headshot 60px_0.jpg`; a
 * queue that took it on the name match alone would put a thumbnail in front
 * of the author as a portrait. `decodeImage` reads the bytes and the row
 * carries the verdict either way — TOO_SMALL is a MEASUREMENT, and it is a
 * different fact from "this office publishes no portrait".
 *
 * Usage:  pnpm exec tsx scripts/hunt-statewide-portraits-0828.mts
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { PORTRAIT_ACCEPT, decodeImage, decodeRecord } from "../lib/photos/decode.ts";
import { floored } from "../lib/ops/denominator-floor.ts";
import { imagesIn, pickPortraits, decodeEntities } from "../lib/hunt/portrait-pick.ts";
import { officialPhotoForPerson } from "../lib/photos/person.ts";
import { STATEWIDE_EXECUTIVES } from "../lib/officials/statewide-executives.ts";
import { politeGetText, sourceUserAgent } from "../lib/sources/http.ts";
import { today } from "./doc-dates.mjs";

const ROOT = process.cwd();
const STAMP = today();
const OUT = join(ROOT, "data", "photos", "door2-statewide-executives-2026-08-28.json");

interface Row {
  subject: string;
  officeTitle: string;
  stateOcdId: string;
  page: string;
  status: number | null;
  bytes: number;
  imagesOnPage: number;
  nameMatchingImages?: number;
  attempts?: { src: string; decode: ReturnType<typeof decodeRecord> }[];
  photoAlreadyHeld: boolean;
  portrait: { src: string; alt: string; why: string } | null;
  imageRefusal: string | null;
  decode?: ReturnType<typeof decodeRecord>;
  door: string;
  attemptedAt: string;
  note: string;
}

const DOOR = "door 2 — the portrait a government body publishes of its own member";
const rows: Row[] = [];

let walked = 0;
let refusedPage = 0;
let alreadyHeld = 0;
let noNamedImage = 0;
let queued = 0;
let decodeRefused = 0;

for (const executive of STATEWIDE_EXECUTIVES) {
  const { name, officeTitle } = executive.holder;
  const page = executive.sourceUrl;

  /*
   * A person whose portrait this repository already ships does not go back in
   * the queue. Listing them again would put one face in front of the author
   * under two numbers, which is the same duplication `photoAlreadyHeld`
   * guards in the door-2 municipal walk.
   */
  if (officialPhotoForPerson(name) || executive.holder.photoUrl) {
    alreadyHeld += 1;
    rows.push({
      subject: name,
      officeTitle,
      stateOcdId: executive.stateOcdId,
      page,
      status: null,
      bytes: 0,
      imagesOnPage: 0,
      photoAlreadyHeld: true,
      portrait: null,
      imageRefusal: null,
      door: DOOR,
      attemptedAt: STAMP,
      note: "a portrait for this person already ships — not re-queued",
    });
    continue;
  }

  let html = "";
  let status: number | null = null;
  try {
    const res = await politeGetText(page, { profile: "browser" });
    html = res.text;
    status = res.status;
    walked += 1;
  } catch (error) {
    refusedPage += 1;
    rows.push({
      subject: name,
      officeTitle,
      stateOcdId: executive.stateOcdId,
      page,
      status: null,
      bytes: 0,
      imagesOnPage: 0,
      photoAlreadyHeld: false,
      portrait: null,
      imageRefusal: (error as Error).message.slice(0, 400),
      door: DOOR,
      attemptedAt: STAMP,
      note:
        "the office's own page could not be retrieved on this client. A WALL, recorded as one — " +
        "never a finding that the office publishes no portrait.",
    });
    continue;
  }

  const images = imagesIn(html, page);
  const candidates = pickPortraits(name, images);
  const picked = candidates[0] ?? null;
  if (!picked) {
    noNamedImage += 1;
    rows.push({
      subject: name,
      officeTitle,
      stateOcdId: executive.stateOcdId,
      page,
      status,
      bytes: html.length,
      imagesOnPage: images.length,
      photoAlreadyHeld: false,
      portrait: null,
      imageRefusal: null,
      door: DOOR,
      attemptedAt: STAMP,
      note:
        `${images.length} image(s) on the page and none carries this person's name in its alt text ` +
        "or its filename — reported as no candidate image rather than as the best of a bad set",
    });
    continue;
  }

  /*
   * **A LADDER INSIDE THE DOOR.** A page publishes several renditions of the
   * same official photo — the Arizona Treasurer's own page carries hers at
   * 85×120 AND at 326×468 — and `MIN_PORTRAIT_EDGE` is 96. Taking only the
   * first name-match would record TOO_SMALL for a person whose office
   * publishes a perfectly usable portrait one tag further down. Every attempt
   * is kept, so a refusal names what was actually tried.
   */
  const attempts: { src: string; decode: ReturnType<typeof decodeRecord> }[] = [];
  let chosen: { src: string; alt: string; why: string } | null = null;
  let chosenDecode: ReturnType<typeof decodeRecord> | null = null;

  for (const candidate of candidates) {
    let decode: ReturnType<typeof decodeRecord>;
    try {
      const res = await fetch(decodeEntities(candidate.src), {
        headers: { "user-agent": sourceUserAgent(), accept: PORTRAIT_ACCEPT },
        redirect: "follow",
      });
      const buf = new Uint8Array(await res.arrayBuffer());
      decode = decodeRecord(decodeImage(buf), STAMP);
    } catch (error) {
      decode = decodeRecord(
        { ok: false, reason: "NOT_AN_IMAGE", detail: `fetch failed: ${(error as Error).message}`, bytes: 0 },
        STAMP,
      );
    }
    attempts.push({ src: candidate.src, decode });
    if (decode.ok) {
      chosen = candidate;
      chosenDecode = decode;
      break;
    }
  }

  const finalPortrait = chosen ?? picked;
  const finalDecode = chosenDecode ?? attempts[0].decode;
  if (finalDecode.ok) queued += 1;
  else decodeRefused += 1;

  rows.push({
    subject: name,
    officeTitle,
    stateOcdId: executive.stateOcdId,
    page,
    status,
    bytes: html.length,
    imagesOnPage: images.length,
    nameMatchingImages: candidates.length,
    attempts,
    photoAlreadyHeld: false,
    portrait: finalPortrait,
    imageRefusal: null,
    decode: finalDecode,
    door: DOOR,
    attemptedAt: STAMP,
    note: finalDecode.ok
      ? "name-matched on the office's own page and decoded as a real image — QUEUED for the author, shipped by nobody"
      : `every name-matching image on this page was REFUSED at the decode; the last said ${finalDecode.reason} — ${finalDecode.detail ?? "no detail"}`,
  });
}

/*
 * RULING 159 — the floor is asserted BEFORE the split is reported. A walk of
 * zero statewide executives is a broken read of the store, not an empty store,
 * and "0 portraits queued" from an empty cohort must never print like a clean
 * board. `floored` throws on a zero denominator, which is the point.
 */
const floor = floored(
  "statewide:portraits",
  "statewide executives in lib/officials/statewide-executives.ts",
  STATEWIDE_EXECUTIVES.length,
  rows.length,
);
void floor;

const artifact = {
  note:
    "Door 2 walked for every statewide executive in lib/officials/statewide-executives.ts, on the " +
    "office's own page — the same page the officeholder row cites, so no new permission question " +
    "arises. Portraits are QUEUED for the author's review and NONE SHIPS FROM HERE (RULING 55). " +
    "Written by scripts/hunt-statewide-portraits-0828.mts.",
  walkedAt: STAMP,
  door: DOOR,
  shipped: 0,
  totals: {
    statewideExecutives: STATEWIDE_EXECUTIVES.length,
    pagesWalked: walked,
    alreadyHeld,
    pageRefused: refusedPage,
    noNamedImageOnPage: noNamedImage,
    portraitsQueued: queued,
    refusedAtDecode: decodeRefused,
  },
  accounting: {
    logicalInput: STATEWIDE_EXECUTIVES.length,
    produced: rows.length,
    outcome: rows.length === STATEWIDE_EXECUTIVES.length ? "CONSERVED" : "LOST_ROWS",
  },
  rows,
};

writeFileSync(OUT, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");

console.log(`door 2 · statewide executives · ${STATEWIDE_EXECUTIVES.length} in the store`);
console.log(`  already shipping a portrait   ${alreadyHeld}`);
console.log(`  pages walked                  ${walked}`);
console.log(`  page could not be retrieved   ${refusedPage}`);
console.log(`  no name-bearing image on it   ${noNamedImage}`);
console.log(`  REFUSED at the decode         ${decodeRefused}`);
console.log(`  QUEUED for the author         ${queued}`);
console.log(`  wrote ${OUT}`);
for (const r of rows) {
  if (r.portrait) console.log(`    ${r.decode?.ok ? "QUEUED " : "REFUSED"} ${r.subject} — ${r.portrait.src}`);
}
