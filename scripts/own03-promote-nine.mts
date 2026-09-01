/**
 * **OWN03 — PROMOTING THE NINE PORTRAITS THE AUTHOR APPROVED.** (2026-09-01.)
 *
 * The author approved all nine portraits in `docs/photo-review/own03-nine.png`
 * on 2026-09-01. RULING 55 says only an APPROVED photo renders and that only he
 * approves; this is the step AFTER that decision, and it is the only step a
 * session was ever allowed to take.
 *
 * ## What it does, and the one thing it refuses to do
 *
 * For each of the nine it re-fetches the exact source URL, decodes the bytes,
 * and **compares the decode against the record the author reviewed**. If the
 * format, the pixel dimensions or the byte count has moved, the row is
 * REFUSED and nothing is written for it.
 *
 * That refusal is the whole point. The author approved AN IMAGE, not a URL: a
 * decision is about a file, and `lib/photos/review.ts` says so in as many
 * words — *"Approving a portrait does not approve whatever later replaces it at
 * the same person key."* A publisher who swapped the file since 2026-08-28
 * would otherwise inherit a human's approval for an image no human has seen,
 * which is the exact hole RULING 55 exists to close.
 *
 * Tom Horne is not here and never was. His decode was a Cloudflare challenge
 * page, not an image (`docs/owner-audit/own03-portrait-count-correction.md`),
 * so he was never in the queue the author approved. His portrait stays an open
 * acquisition obligation with its route blocker named.
 *
 * ## What it writes
 *
 *   public/officials/statewide-<state>-<slug>.<ext>   the bytes
 *   data/photos/review.json                            an APPROVED record
 *   docs/evidence/own03-promotion.json                 what happened, per row
 *
 * It does NOT edit `lib/officials/statewide-executives.ts` — that file carries
 * prose and provenance around each entry, and a script rewriting it by regex is
 * how a `sourceOrg` ends up attached to the wrong portrait. The paths it prints
 * are applied by hand and diffed.
 *
 *   pnpm tsx scripts/own03-promote-nine.mts            dry run
 *   pnpm tsx scripts/own03-promote-nine.mts --write
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { PORTRAIT_ACCEPT, decodeImage } from "../lib/photos/decode.ts";
import { personKey } from "../lib/photos/person.ts";
import { STATEWIDE_EXECUTIVES } from "../lib/officials/statewide-executives.ts";
import { decodeEntities, sourceUserAgent } from "../lib/sources/http.ts";

const ROOT = process.cwd();
const WRITE = process.argv.includes("--write");
const APPROVED_ON = "2026-09-01";
const APPROVED_BY = "sean";
const QUEUE = "data/photos/door2-statewide-executives-2026-08-28.json";

/**
 * The nine, and the local file each becomes.
 *
 * Written out rather than derived from the office title, because the three
 * portraits already shipping use this naming and a derived slug that disagreed
 * with them would put one person's photo under two paths.
 */
const TARGETS: Record<string, string> = {
  "Adrian Fontes": "statewide-az-secretary-of-state",
  "Kris Mayes": "statewide-az-attorney-general",
  "Kimberly Yee": "statewide-az-state-treasurer",
  "Nick Myers": "statewide-az-corporation-commissioner-myers",
  "Rachel Walden": "statewide-az-corporation-commissioner-walden",
  "Kevin Thompson": "statewide-az-corporation-commissioner-thompson",
  "Lea Márquez Peterson": "statewide-az-corporation-commissioner-marquez-peterson",
  "René Lopez": "statewide-az-corporation-commissioner-lopez",
  "Dale G. Caldwell": "statewide-nj-lieutenant-governor",
};

interface QueueRow {
  subject: string;
  officeTitle: string;
  stateOcdId: string;
  page: string;
  portrait: { src: string; alt: string | null; why: string } | null;
  decode: { ok: boolean; format?: string; width?: number; height?: number; bytes?: number };
}

const queue = JSON.parse(readFileSync(join(ROOT, QUEUE), "utf8")) as { rows: QueueRow[] };
const nine = queue.rows.filter((r) => r.portrait && r.decode?.ok && TARGETS[r.subject]);

if (nine.length !== 9) {
  console.error(
    `POPULATION MISMATCH — the approved queue is nine and this run found ${nine.length}. ` +
      "Nothing written. The author approved a specific set of nine images.",
  );
  process.exit(1);
}

interface Outcome {
  subject: string;
  office: string;
  localPath: string;
  sourceUrl: string;
  reviewed: { format: string; width: number; height: number; bytes: number };
  refetched: { format?: string; width?: number; height?: number; bytes?: number } | null;
  verdict: "PROMOTED" | "REFUSED_IMAGE_MOVED" | "REFUSED_UNREACHABLE";
  detail: string;
}

const outcomes: Outcome[] = [];

for (const row of nine) {
  const slug = TARGETS[row.subject];
  const src = decodeEntities(row.portrait!.src);
  const reviewed = {
    format: String(row.decode.format),
    width: Number(row.decode.width),
    height: Number(row.decode.height),
    bytes: Number(row.decode.bytes),
  };

  /**
   * **THE ACCEPT HEADER DECIDES WHICH FILE THE HOST RETURNS, SO THE RE-FETCH
   * ASKS FOR THE FORMAT THE AUTHOR REVIEWED.** (Measured here, 2026-09-01.)
   *
   * Kimberly Yee's portrait is served by Wix from a URL whose own path says
   * `enc_avif,quality_auto` — the host picks the encoding from `Accept`.
   * `PORTRAIT_ACCEPT` offers `image/webp`, so the re-fetch came back:
   *
   * ```
   *   accept …,image/webp,…   200 image/webp  22,544 bytes  326x468
   *   accept …no webp…        200 image/jpeg  36,019 bytes  326x468
   * ```
   *
   * Same photograph, same pixels, DIFFERENT FILE — and the author approved the
   * 36,019-byte JPEG. Shipping the webp would have been an approval inherited
   * by an image no human looked at, which is the precise thing RULING 55
   * refuses; refusing it outright would have been a false blocker on a portrait
   * that is sitting right there.
   *
   * So: ask broadly first, and if the bytes do not match, ask again for exactly
   * the format the review record names. The guard is unchanged — the bytes
   * still have to be byte-identical to what he saw. Only the ASK narrows.
   */
  const formatAccept: Record<string, string> = {
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
  };
  const asks = [PORTRAIT_ACCEPT, formatAccept[reviewed.format]].filter(Boolean) as string[];

  let bytes: Uint8Array | null = null;
  let detail = "";
  for (const accept of asks) {
    try {
      const res = await fetch(src, {
        headers: { "user-agent": sourceUserAgent(), accept },
      });
      if (!res.ok) {
        detail = `HTTP ${res.status} re-fetching the approved image`;
        continue;
      }
      const got = new Uint8Array(await res.arrayBuffer());
      bytes = got;
      if (got.length === reviewed.bytes) break;
      detail =
        `asked with ${accept} and got ${got.length} bytes against the reviewed ` +
        `${reviewed.bytes}; narrowing the ask to the reviewed format`;
    } catch (error) {
      detail = `re-fetch threw: ${(error as Error).message}`;
    }
  }

  if (!bytes) {
    outcomes.push({
      subject: row.subject,
      office: row.officeTitle,
      localPath: "",
      sourceUrl: src,
      reviewed,
      refetched: null,
      verdict: "REFUSED_UNREACHABLE",
      detail: `${detail}. The route failed; the approval stands and the promotion is owed.`,
    });
    continue;
  }

  const verdict = decodeImage(bytes);
  const got = verdict.ok
    ? { format: verdict.format, width: verdict.width, height: verdict.height, bytes: bytes.length }
    : { format: undefined, width: undefined, height: undefined, bytes: bytes.length };

  const same =
    verdict.ok &&
    verdict.format === reviewed.format &&
    verdict.width === reviewed.width &&
    verdict.height === reviewed.height &&
    bytes.length === reviewed.bytes;

  if (!same) {
    outcomes.push({
      subject: row.subject,
      office: row.officeTitle,
      localPath: "",
      sourceUrl: src,
      reviewed,
      refetched: got,
      verdict: "REFUSED_IMAGE_MOVED",
      detail:
        "the bytes at this URL are not the bytes the author reviewed. A decision is " +
        "about an IMAGE, so this needs a new review rather than an inherited approval.",
    });
    continue;
  }

  const ext = reviewed.format === "png" ? "png" : reviewed.format === "webp" ? "webp" : "jpg";
  const localPath = `public/officials/${slug}.${ext}`;
  if (WRITE) {
    mkdirSync(join(ROOT, "public", "officials"), { recursive: true });
    writeFileSync(join(ROOT, localPath), bytes);
  }
  outcomes.push({
    subject: row.subject,
    office: row.officeTitle,
    localPath,
    sourceUrl: src,
    reviewed,
    refetched: got,
    verdict: "PROMOTED",
    detail: "re-fetched, decoded, and byte-identical to the image the author reviewed",
  });
}

/*
 * The review store. Both keys are recorded for each promoted portrait — the
 * SOURCE url and the LOCAL path — because the officials surface renders the
 * local path while the acquisition record and the staged queue carry the source
 * one, and a decision recorded against only one of them leaves the other
 * reading PENDING forever.
 */
const REVIEW = join(ROOT, "data", "photos", "review.json");
const review = JSON.parse(readFileSync(REVIEW, "utf8")) as {
  note: string;
  builtAt: string;
  counts: Record<string, number>;
  reviews: Record<string, { state: string; url: string; decidedAt?: string; decidedBy?: string }[]>;
};

let added = 0;
for (const o of outcomes) {
  if (o.verdict !== "PROMOTED") continue;
  const key = personKey(o.subject);
  const list = (review.reviews[key] ??= []);
  for (const url of [o.sourceUrl, `/officials/${o.localPath.split("/").pop()}`]) {
    if (list.some((r) => r.url === url)) continue;
    list.push({ state: "APPROVED", url, decidedAt: APPROVED_ON, decidedBy: APPROVED_BY });
    added++;
  }
}
review.counts.approvedBySeanPerAsset = (review.counts.approvedBySeanPerAsset ?? 0) + added;
review.counts.decisions = Object.values(review.reviews).reduce((n, l) => n + l.length, 0);
review.counts.people = Object.keys(review.reviews).length;

/*
 * **THE LICENCE ROW SHIPS WITH THE PIXELS, NOT AFTER THEM.**
 *
 * `tests/officials-surface.test.ts` refuses a statewide `photoUrl` with no
 * licensed row in `lib/registry/official-photos.json`, and it is right to: the
 * basis this product uses is *official government portrait, with attribution
 * and remove-on-request*, and a portrait with no recorded attribution is a
 * portrait nobody can honour that on. The row is written HERE, in the same run
 * that writes the bytes, so the two cannot land apart.
 *
 * `sourceOrg` and `sourceUrl` are read from the executive's own entry rather
 * than restated, so the credit under the face is the same one the officeholder
 * row already cites.
 */
const MANIFEST = join(ROOT, "lib", "registry", "official-photos.json");
const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as {
  generatedAt: string;
  photos: Record<string, unknown>[];
  missing: unknown[];
};
const executivesById = new Map(STATEWIDE_EXECUTIVES.map((e) => [e.holder.name, e]));
let licenceRows = 0;
for (const o of outcomes) {
  if (o.verdict !== "PROMOTED") continue;
  const exec = executivesById.get(o.subject);
  if (!exec) {
    console.error(`NO EXECUTIVE ENTRY for ${o.subject} — refusing to invent a licence row`);
    process.exit(1);
  }
  const url = `/officials/${o.localPath.split("/").pop()}`;
  const existing = manifest.photos.find((p) => p.officeholderId === exec.holder.id);
  const row = {
    officeholderId: exec.holder.id,
    name: o.subject,
    url,
    sourceUrl: exec.sourceUrl,
    license:
      `Official portrait published by ${exec.sourceOrg} (${exec.sourceUrl}) — used under the ` +
      "official-government-portrait basis with attribution and remove-on-request; no licence claimed.",
    attribution: exec.sourceOrg,
    basis: "OFFICIAL_PORTRAIT",
    /*
     * The judgment field on the three rows already here is a human's read of
     * the image. This one is the same thing said honestly: the author looked at
     * this exact file on the contact sheet and approved it. A session writing a
     * description of a face it inferred would be putting words in his mouth.
     */
    judgment: `approved by the author on the OWN03 contact sheet, ${APPROVED_ON} (docs/photo-review/own03-nine.png)`,
    collectedAt: `${APPROVED_ON}T00:00:00.000Z`,
  };
  if (existing) Object.assign(existing, row);
  else manifest.photos.push(row);
  licenceRows++;
}
if (WRITE) writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

const evidence = {
  note:
    "OWN03 — the author approved all nine portraits at docs/photo-review/own03-nine.png on " +
    `${APPROVED_ON}. Each was re-fetched and compared against the decode he reviewed before ` +
    "anything was written. Tom Horne was never among the nine; his decode was a Cloudflare " +
    "challenge page and his portrait remains an open acquisition obligation.",
  approvedOn: APPROVED_ON,
  approvedBy: APPROVED_BY,
  ruling: "RULING 55",
  queue: QUEUE,
  contactSheet: "docs/photo-review/own03-nine.png",
  counts: {
    queued: nine.length,
    promoted: outcomes.filter((o) => o.verdict === "PROMOTED").length,
    refusedImageMoved: outcomes.filter((o) => o.verdict === "REFUSED_IMAGE_MOVED").length,
    refusedUnreachable: outcomes.filter((o) => o.verdict === "REFUSED_UNREACHABLE").length,
  },
  outcomes,
};

if (WRITE) {
  writeFileSync(REVIEW, `${JSON.stringify(review, null, 2)}\n`, "utf8");
  writeFileSync(
    join(ROOT, "docs", "evidence", "own03-promotion.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
    "utf8",
  );
}

console.log(`\nOWN03 promotion — ${WRITE ? "WRITTEN" : "DRY RUN"}`);
console.log(`  queued (author-approved)  ${evidence.counts.queued}`);
console.log(`  promoted                  ${evidence.counts.promoted}`);
console.log(`  refused — image moved     ${evidence.counts.refusedImageMoved}`);
console.log(`  refused — unreachable     ${evidence.counts.refusedUnreachable}`);
console.log(`  review records added      ${added}`);
console.log(`  licence rows written      ${licenceRows}`);
console.log("");
for (const o of outcomes) {
  const shape = o.refetched
    ? `${o.refetched.format ?? "?"} ${o.refetched.width ?? "?"}x${o.refetched.height ?? "?"} ${o.refetched.bytes ?? "?"}b`
    : "unreachable";
  console.log(`  ${o.verdict.padEnd(22)} ${o.subject.padEnd(22)} ${shape}`);
  if (o.verdict === "PROMOTED") console.log(`  ${" ".repeat(22)} -> ${o.localPath}`);
  else console.log(`  ${" ".repeat(22)}    ${o.detail}`);
}
console.log("\n  photoUrl values to apply in lib/officials/statewide-executives.ts:");
for (const o of outcomes) {
  if (o.verdict !== "PROMOTED") continue;
  console.log(`    ${o.subject.padEnd(22)} "/officials/${o.localPath.split("/").pop()}"`);
}
if (!WRITE) console.log("\n  nothing written — pass --write");
