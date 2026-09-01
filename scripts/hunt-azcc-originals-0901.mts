/**
 * **THE THUMBNAIL WAS NOT THE RECORD.** (2026-09-01. RULING 206.)
 *
 * The author approved four Arizona Corporation Commissioner portraits on
 * 2026-09-01 (OWN03), and all four are under the large card's 184px floor:
 *
 * ```
 *   Nick Myers            133x200        Lea Márquez Peterson  165x206
 *   Rachel Walden         133x200        René Lopez            137x206
 * ```
 *
 * They are under it because the URLs the original pick took are RENDITIONS, not
 * files: `…2025-nick-myers.tmb-thumb200.jpg`, `…peterson-photo.jpg?…
 * MaxWidth=165…`. `azcc.gov` is a Sitefinity site and those parameters are the
 * CMS's image pipeline, so the pick recorded a size the pipeline produced rather
 * than the portrait the Commission publishes.
 *
 * **The record is the portrait; the rendition is one representation of it.**
 * Dropping the rendition parameters on the same host returns the same
 * photographs at ~2500–3300px wide. Nothing was blocked, nothing needed a new
 * permission, and no wall fell — one path segment was the whole distance.
 *
 * ## What this script does, and the line it does not cross
 *
 * It walks the four, decodes each, and writes a STAGING ARTIFACT. It ships
 * nothing. **A decision is about an IMAGE** (RULING 55), and a 3275px original
 * is a different image from the 133px crop the author approved — so these go in
 * front of him rather than onto a card. The approved thumbnails keep rendering
 * meanwhile, because a reader seeing a face today is better than a reader
 * seeing initials while a better file waits for a decision.
 *
 *   pnpm tsx scripts/hunt-azcc-originals-0901.mts
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { floorLine, floored } from "../lib/ops/denominator-floor.ts";
import { PORTRAIT_ACCEPT, decodeImage, decodeRecord } from "../lib/photos/decode.ts";
import { sourceUserAgent } from "../lib/sources/http.ts";

const ROOT = process.cwd();
const WALKED_AT = "2026-09-01";
const OUT = "data/photos/door2-azcc-originals-2026-09-01.json";

/**
 * The four, with the rendition we hold and the unrendered path beside it.
 *
 * Written out rather than derived by stripping a pattern: the two AZCC URL
 * shapes are different (`.tmb-thumb200.jpg` versus a `MaxWidth`/`Method` query),
 * and a regex that handled both would also happily "strip" a parameter on some
 * future third shape it had never seen.
 */
const SUBJECTS = [
  {
    subject: "Nick Myers",
    officeTitle: "Corporation Commissioner",
    page: "https://www.azcc.gov/nick-myers/biography",
    held: "https://www.azcc.gov/images/default-source/commissioners/2025-nick-myers.tmb-thumb200.jpg?Culture=en&sfvrsn=7963c1fe_1",
    original:
      "https://www.azcc.gov/images/default-source/commissioners/2025-nick-myers.jpg?Culture=en&sfvrsn=7963c1fe_1",
  },
  {
    subject: "Rachel Walden",
    officeTitle: "Corporation Commissioner",
    page: "https://www.azcc.gov/Rachel-Walden/biography",
    held: "https://www.azcc.gov/images/default-source/commissioners/2025-rachel-walden.tmb-thumb200.jpg?Culture=en&sfvrsn=fbe9096a_1",
    original:
      "https://www.azcc.gov/images/default-source/commissioners/2025-rachel-walden.jpg?Culture=en&sfvrsn=fbe9096a_1",
  },
  {
    subject: "Lea Márquez Peterson",
    officeTitle: "Corporation Commissioner",
    page: "https://www.azcc.gov/lmarquezpeterson/biography",
    held: "https://www.azcc.gov/images/default-source/commissioners/peterson-photo.jpg?sfvrsn=99511a81_9&Width=165&Height=206&ScaleUp=false&Quality=High&Method=CropCropArguments",
    original: "https://www.azcc.gov/images/default-source/commissioners/peterson-photo.jpg?sfvrsn=99511a81_9",
  },
  {
    subject: "René Lopez",
    officeTitle: "Corporation Commissioner",
    page: "https://www.azcc.gov/Rene-Lopez/biography",
    held: "https://www.azcc.gov/images/default-source/commissioners/lopez-headshota40372b9-eb5d-4c79-83b5-a3f7800dbe90.jpg?sfvrsn=a6346954_2&MaxWidth=165&MaxHeight=206&ScaleUp=false&Quality=High&Method=ResizeFitToAreaArguments",
    original:
      "https://www.azcc.gov/images/default-source/commissioners/lopez-headshota40372b9-eb5d-4c79-83b5-a3f7800dbe90.jpg?sfvrsn=a6346954_2",
  },
] as const;

const rows: Record<string, unknown>[] = [];
let queued = 0;
let refused = 0;

for (const s of SUBJECTS) {
  let bytes: Uint8Array | null = null;
  let transport = "";
  try {
    const res = await fetch(s.original, {
      headers: { "user-agent": sourceUserAgent(), accept: PORTRAIT_ACCEPT },
    });
    transport = `HTTP ${res.status}`;
    if (res.ok) bytes = new Uint8Array(await res.arrayBuffer());
  } catch (error) {
    transport = `threw: ${(error as Error).message}`;
  }

  const verdict = bytes
    ? decodeImage(bytes)
    : ({ ok: false as const, reason: "ROUTE_UNREAD", detail: transport });
  const decode = decodeRecord(verdict as never, WALKED_AT);
  if (decode.ok) queued++;
  else refused++;

  rows.push({
    subject: s.subject,
    officeTitle: s.officeTitle,
    stateOcdId: "ocd-division/country:us/state:az",
    page: s.page,
    status: transport,
    /*
     * FALSE on purpose. A portrait for this person IS held and IS rendering —
     * the thumbnail the author approved — but `photoAlreadyHeld` is the flag
     * that keeps a row OUT of the review sheet, and keeping this one out is
     * exactly what would leave the better representation unseen.
     */
    photoAlreadyHeld: false,
    heldRendition: s.held,
    portrait: decode.ok
      ? {
          src: s.original,
          alt: null,
          why:
            "the same file the biography page serves, with the CMS rendition parameters " +
            "removed — same path, same host, same photograph at its published size",
        }
      : null,
    decode,
    door: "door 2 — the portrait a government body publishes of its own member",
    attemptedAt: WALKED_AT,
    note:
      "RULING 206: the rendition we hold is one representation; this is another of the " +
      "SAME record. Staged for the author, shipped by nobody (RULING 55).",
  });
}

const artifact = {
  note:
    "AZCC full-resolution originals, walked 2026-09-01 after the OWN03 promotion found four " +
    "approved portraits under the large card's 184px floor. The URLs already held are CMS " +
    "renditions; these are the same files without the rendition parameters. Nothing ships " +
    "from here — RULING 55, and a decision is about an IMAGE.",
  walkedAt: WALKED_AT,
  door: "door 2 — the portrait a government body publishes of its own member",
  shipped: 0,
  totals: { subjects: SUBJECTS.length, portraitsQueued: queued, refused },
  accounting: { logicalInput: SUBJECTS.length, produced: rows.length, outcome: "CONSERVED" },
  rows,
};

writeFileSync(join(ROOT, OUT), `${JSON.stringify(artifact, null, 2)}\n`, "utf8");

/*
 * RULING 159. "4 queued" and "4 queued of 4 walked" are different claims, and
 * the first is also what a run that reached nothing would print.
 */
const queuedCount = floored("AZCC originals queued for review", OUT, SUBJECTS.length, queued);
const refusedCount = floored("AZCC originals refused", OUT, SUBJECTS.length, refused);

console.log(`\nAZCC originals — ${OUT}`);
console.log(`  ${floorLine(queuedCount)}`);
console.log(`  ${floorLine(refusedCount)}`);
console.log(`  shipped             0  (RULING 55 — the author decides)\n`);
for (const r of rows) {
  const d = r.decode as { ok: boolean; width?: number; height?: number; bytes?: number; reason?: string };
  console.log(
    `  ${String(r.subject).padEnd(22)} ${d.ok ? `${d.width}x${d.height} ${d.bytes}b` : `REFUSED ${d.reason}`}`,
  );
}
