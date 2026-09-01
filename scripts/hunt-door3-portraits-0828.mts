/**
 * **DOOR 3 OVER THE BALLOT COHORT'S REMAINING GAP.** (2026-08-28, BAL-28.)
 *
 * ## The denominator this runs against, stated first
 *
 * Measured 2026-08-28 over the four pilot ballots: **377 filed candidacies,
 * 55 rendering a verified portrait, 7 holding bytes nobody has approved, 2
 * whose only proposals were refused, and 314 with nothing at all.** The mass
 * of the 314 is New Jersey down-ballot — 117 Board of Education, 47 Borough
 * Council, 27 Township Committee.
 *
 * **Door 3 cannot reach most of them, and the reason is not shyness about
 * trying.** The route list is CLOSED (`docs/branch-manifest.md`), door 3 is
 * *the campaign's OWN site*, and of the 314, **46 have any candidate link
 * recorded at all** — of which the labelled ones are a PARTY COMMITTEE's page
 * or a MUNICIPAL directory, and neither is the candidate's own site. A
 * committee's page is not door 3, and calling it one would be widening a
 * closed list by relabelling.
 *
 * So this walks the unlabelled links on the candidate's own domain. It is a
 * small number and it is the honest one.
 *
 * ## The two rules that make this door narrow
 *
 * 1. **`<img>` only. `og:image` is BARRED** — measured, 7 of 7 reads on
 *    candidate sites returned a share card: a banner with a slogan, sometimes
 *    a group shot, occasionally a logo. That is what the format is FOR.
 * 2. **The image must carry the person's own name** in its alt text or its
 *    filename (`pickPortrait`). A largest-image heuristic on a campaign site
 *    picks the hero banner every time.
 *
 * Prohibited at every door and not reachable from here: press photos, wire
 * images, photographer-credited images, social-media images.
 *
 * **Nothing ships.** Rows are staged for the author (RULING 55).
 *
 * Usage:  pnpm exec tsx scripts/hunt-door3-portraits-0828.mts
 */

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { allCandidateLinks } from "../lib/ballot/candidate-sites.ts";
import { PORTRAIT_ACCEPT, decodeImage, decodeRecord } from "../lib/photos/decode.ts";
import { floored } from "../lib/ops/denominator-floor.ts";
import { imagesIn, pickPortraits, decodeEntities } from "../lib/hunt/portrait-pick.ts";
import { officialPhotoForPerson, personKey } from "../lib/photos/person.ts";
import { stagedPortraits } from "../lib/photos/staged.ts";
import { politeGetText, sourceUserAgent } from "../lib/sources/http.ts";
import { today } from "./doc-dates.mjs";

const ROOT = process.cwd();
const STAMP = today();
const OUT = join(ROOT, "data", "photos", "door3-ballot-cohort-2026-08-28.json");
const DOOR = "door 3 — the portrait the campaign publishes of its own candidate, from its own site";

/** Hosts that are somebody ELSE's publication, whatever the link is for. */
const NOT_THE_CANDIDATES_OWN = /\.gov$|\.us$|\.state\.[a-z]{2}\.us$|dems?\b|democrat|republican|gop\b|committee|club/i;

const links = allCandidateLinks();
const cards = JSON.parse(
  readFileSync(join(ROOT, "data", "ballot", "candidate-cards-2026.json"), "utf8"),
) as { cards: Record<string, { photoUrl: string | null }> };
const stagedKeys = new Set(stagedPortraits().map((s) => s.personKey));
const nameFromCandidacyId = (id: string) => (id.split(":").pop() ?? "").split("-").reverse().join(" ");

const BALLOTS = readdirSync(join(ROOT, "data", "ballot")).filter(
  (f) => f.endsWith(".json") && /^(nh|nj|az)-/.test(f) && !f.includes("analyses") && !f.includes("lineup"),
);

interface Row {
  subject: string;
  candidacyId: string;
  page: string | null;
  status: number | null;
  imagesOnPage: number;
  nameMatchingImages: number;
  photoAlreadyHeld: boolean;
  portrait: { src: string; alt: string; why: string } | null;
  decode?: ReturnType<typeof decodeRecord>;
  door: string;
  attemptedAt: string;
  note: string;
}

const rows: Row[] = [];
let cohort = 0;
let held = 0;
let noLink = 0;
let notOwnSite = 0;
let walked = 0;
let refusedPage = 0;
let noNamedImage = 0;
let queued = 0;
let decodeRefused = 0;

for (const file of BALLOTS) {
  const data = JSON.parse(readFileSync(join(ROOT, "data", "ballot", file), "utf8")) as {
    candidacies?: { id: string; contestId: string; givenName: string; familyName: string }[];
  };
  for (const c of data.candidacies ?? []) {
    cohort += 1;
    const filed = `${c.givenName} ${c.familyName}`.trim();
    const byId = cards.cards[c.id];
    const appName = byId ? nameFromCandidacyId(c.id) : filed;
    const card = byId ?? cards.cards[`${c.contestId}|${filed}`];
    if (
      officialPhotoForPerson(appName)?.url ||
      card?.photoUrl ||
      stagedKeys.has(personKey(filed)) ||
      stagedKeys.has(personKey(appName))
    ) {
      held += 1;
      continue;
    }

    const link = links.links[c.id] ?? links.links[`${c.contestId}|${filed}`] ?? null;
    const chosen = link?.campaign ?? link?.official ?? null;
    /*
     * WHICH DOOR THIS ROW ACTUALLY CAME THROUGH. A link recorded in the
     * `official` slot is the person's page in the office they HOLD — that is
     * door 2, the body publishing its own member, and calling it door 3 would
     * misstate the provenance of the face on a card. The row carries the door
     * it was actually opened by.
     */
    const rowDoor = link?.campaign
      ? DOOR
      : 'door 2 — the portrait a government body publishes of its own member';
    if (!chosen) {
      noLink += 1;
      continue;
    }
    /*
     * A LABEL means the link is somebody else's page — a party committee, a
     * platform, a municipal directory — and RULING 122/145 exist because
     * rendering those as the candidate's own would misstate whose words they
     * are. The same reasoning governs whose FACE this is: a committee's page
     * is not the campaign's own site, and door 3 says own site.
     */
    if (chosen.label || NOT_THE_CANDIDATES_OWN.test(new URL(chosen.url).hostname)) {
      notOwnSite += 1;
      continue;
    }

    let html = "";
    let status: number | null = null;
    try {
      const res = await politeGetText(chosen.url, { profile: "browser" });
      html = res.text;
      status = res.status;
      walked += 1;
    } catch (error) {
      refusedPage += 1;
      rows.push({
        subject: filed,
        candidacyId: c.id,
        page: chosen.url,
        status: null,
        imagesOnPage: 0,
        nameMatchingImages: 0,
        photoAlreadyHeld: false,
        portrait: null,
        door: rowDoor,
        attemptedAt: STAMP,
        note: `the campaign's own site could not be retrieved on this client: ${(error as Error).message.slice(0, 200)}. A WALL, never a finding that no portrait exists.`,
      });
      continue;
    }

    const images = imagesIn(html, chosen.url);
    const candidates = pickPortraits(filed, images);
    if (candidates.length === 0) {
      noNamedImage += 1;
      rows.push({
        subject: filed,
        candidacyId: c.id,
        page: chosen.url,
        status,
        imagesOnPage: images.length,
        nameMatchingImages: 0,
        photoAlreadyHeld: false,
        portrait: null,
        door: rowDoor,
        attemptedAt: STAMP,
        note: `${images.length} <img> on the page and none carries this person's name in its alt text or filename. og:image was NOT read — it is a share card by design and is barred at this door.`,
      });
      continue;
    }

    let chosenImg: { src: string; alt: string; why: string } | null = null;
    let chosenDecode: ReturnType<typeof decodeRecord> | null = null;
    let lastDecode: ReturnType<typeof decodeRecord> | null = null;
    for (const candidate of candidates) {
      let decode: ReturnType<typeof decodeRecord>;
      try {
        const res = await fetch(decodeEntities(candidate.src), {
          headers: { "user-agent": sourceUserAgent(), accept: PORTRAIT_ACCEPT },
          redirect: "follow",
        });
        decode = decodeRecord(decodeImage(new Uint8Array(await res.arrayBuffer())), STAMP);
      } catch (error) {
        decode = decodeRecord(
          { ok: false, reason: "NOT_AN_IMAGE", detail: `fetch failed: ${(error as Error).message}`, bytes: 0 },
          STAMP,
        );
      }
      lastDecode = decode;
      if (decode.ok) {
        chosenImg = candidate;
        chosenDecode = decode;
        break;
      }
    }

    if (chosenDecode?.ok) queued += 1;
    else decodeRefused += 1;

    rows.push({
      subject: filed,
      candidacyId: c.id,
      page: chosen.url,
      status,
      imagesOnPage: images.length,
      nameMatchingImages: candidates.length,
      photoAlreadyHeld: false,
      portrait: chosenImg ?? candidates[0],
      decode: chosenDecode ?? lastDecode ?? undefined,
      door: rowDoor,
      attemptedAt: STAMP,
      note: chosenDecode?.ok
        ? "name-matched on the campaign's own site and decoded as a real image — QUEUED for the author, shipped by nobody"
        : `every name-matching <img> was refused at the decode: ${lastDecode?.reason ?? "unknown"} — ${lastDecode?.detail ?? ""}`,
    });
  }
}

/*
 * RULING 159 — the floor before the split. A cohort of zero is a broken read
 * of the ballot files, never a ballot with nobody on it, and "0 queued" from
 * an empty cohort must not print like a clean board.
 */
const floor = floored("door3:portraits", "filed candidacies across the pilot ballot files", cohort, held + noLink + notOwnSite + walked + refusedPage);
void floor;

const artifact = {
  note:
    "Door 3 walked for every filed candidate this repository holds no portrait bytes for AND records " +
    "a link on the candidate's OWN domain. <img> only — og:image is barred on measured evidence " +
    "(7 of 7 reads returned a share card). Portraits are QUEUED for the author's review and NONE " +
    "SHIPS FROM HERE (RULING 55). Written by scripts/hunt-door3-portraits-0828.mts.",
  walkedAt: STAMP,
  door: DOOR,
  shipped: 0,
  totals: {
    cohort,
    alreadyHoldsBytes: held,
    noCandidateLinkRecorded: noLink,
    linkIsNotTheCandidatesOwnSite: notOwnSite,
    pagesWalked: walked,
    pageRefused: refusedPage,
    noNamedImageOnPage: noNamedImage,
    refusedAtDecode: decodeRefused,
    portraitsQueued: queued,
  },
  accounting: {
    logicalInput: cohort,
    accountedFor: held + noLink + notOwnSite + walked + refusedPage,
    outcome: held + noLink + notOwnSite + walked + refusedPage === cohort ? "CONSERVED" : "UNACCOUNTED",
  },
  rows,
};
writeFileSync(OUT, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");

console.log(`door 3 · ballot cohort ${cohort}`);
console.log(`  already holds bytes             ${held}`);
console.log(`  no candidate link recorded      ${noLink}`);
console.log(`  link is NOT the candidate's own ${notOwnSite}`);
console.log(`  campaign sites walked           ${walked}`);
console.log(`  page could not be retrieved     ${refusedPage}`);
console.log(`  no name-bearing <img> on it     ${noNamedImage}`);
console.log(`  REFUSED at the decode           ${decodeRefused}`);
console.log(`  QUEUED for the author           ${queued}`);
console.log(`  accounting: ${artifact.accounting.outcome} (${artifact.accounting.accountedFor}/${cohort})`);
console.log(`  wrote ${OUT}`);
for (const r of rows) {
  if (r.portrait) console.log(`    ${r.decode?.ok ? "QUEUED " : "REFUSED"} ${r.subject} — ${r.portrait.src}`);
}
