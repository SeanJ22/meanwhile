/**
 * Download portraits for every renderable federal official — the photo
 * session's Tier 1 (2026-08-14), widening D20's four-zip pass to the full
 * census universe: every member of Congress attached to a division the
 * registry covers (House via the national cd layer, senators via the
 * local-tier states).
 *
 * `pnpm officials:photos`
 *
 * Federal only, deliberately: the `unitedstates/images` collection republishes
 * the GPO Congressional Pictorial Directory portraits, which are U.S. federal
 * government works in the public domain — a license we can state per image.
 * Congress.gov's `depiction` fallback is NOT used: its attribution reads
 * "Image courtesy of the Member", which is a member-provided image of unknown
 * license, and D20's rule is that unknown is not clearable — such an official
 * renders as initials until the pictorial directory carries them.
 *
 * Images are committed and served from our origin — a hotlink makes the
 * reader's browser announce itself to a third party. Every image is
 * metadata-stripped (EXIF/XMP/comments) before it is written. The manifest
 * records source and license per image; the missing list records who was
 * tried and not shipped, with the reason, so an absence is a documented
 * state. Manifest rows owned by other tiers (`plural:`, `statewide:`) are
 * preserved untouched — this script owns only the `congress:` prefix.
 */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { openCorpus, readBinaryFile, type CorpusHandle } from "../lib/hunt/github-corpus.ts";
import { stripImageMetadata } from "./strip-image-metadata.mts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "public", "officials");
const MANIFEST = join(ROOT, "lib", "registry", "official-photos.json");

const SOURCE_BASE = "https://unitedstates.github.io/images/congress/450x550";

/**
 * **RUNG 2 IS THE PAGES HOST. RUNG 4 IS `git`, AND IT IS THE SAME BYTES.**
 * (Added 2026-08-23, the questionnaire-and-corpora brief item 2. RULING 88 —
 * the route did not exist at session start; the ladder rule — a wall that falls
 * becomes a permanent reusable step rather than a discovery spent and kept.)
 *
 * `unitedstates.github.io` is a GitHub PAGES host and `github.com` is not, and
 * an egress that refuses the first can permit the second — which is exactly the
 * case on the machine this was written on, measured both ways in the same
 * minute:
 *
 * ```
 * curl …/congress/450x550/C000127.jpg          → 000
 * git show HEAD:congress/450x550/C000127.jpg   → 114,839 bytes, JPEG 450x550
 * ```
 *
 * The wall was around a HOST, never around the data (RULING 90's fourth
 * obligation). So an HTTP miss is no longer written down as a miss until the
 * git road has also been walked: `MISS` here used to mean *the pictorial
 * directory does not carry this person*, and on any refusing egress it silently
 * meant *we could not reach the host*. Those are the two things this product
 * exists never to confuse.
 */
const CORPUS_SLUG = "unitedstates/images";
const CORPUS_PREFIX = "congress/450x550";

/** Opened lazily, and only if an HTTP read actually fails — a clone is not free. */
let corpus: CorpusHandle | null = null;
let corpusFailure: string | null = null;

function portraitOverGit(bioguide: string): { bytes: Buffer; sha: string } | null {
  if (corpusFailure !== null) return null;
  try {
    corpus ??= openCorpus({
      slug: CORPUS_SLUG,
      cacheDir: join(process.env.WTP_CORPUS_CACHE ?? tmpdir(), "wtp-github-corpora"),
    });
    const bytes = readBinaryFile(corpus, `${CORPUS_PREFIX}/${bioguide}.jpg`);
    return bytes.length > 0 ? { bytes, sha: corpus.sha } : null;
  } catch (error) {
    /*
     * A failure to CLONE is a fact about the road and is recorded once, so 537
     * members do not each pay for the same refusal. A failure to read one PATH
     * is a fact about that person and is not — the corpus genuinely does not
     * carry everybody.
     */
    const message = (error as Error).message ?? "";
    if (corpus === null) corpusFailure = message.split("\n")[0];
    return null;
  }
}
const LICENSE =
  "Public domain (U.S. federal government work — GPO Congressional Pictorial Directory, via unitedstates/images)";

interface PhotoRecord {
  officeholderId: string;
  name: string;
  /** Path on our origin. */
  url: string;
  sourceUrl: string;
  license: string;
  attribution: string | null;
  collectedAt: string;
}

interface MissingRecord {
  officeholderId: string;
  name: string;
  reason: string;
  attemptedAt: string;
}

const read = async (p: string) =>
  JSON.parse(await readFile(join(ROOT, p), "utf8"));

// ── The renderable federal universe — the census script's own logic ──────
const registry = (await read("lib/registry/registry.json")) as {
  divisions: { ocdId: string; tier?: string }[];
};
const covered = new Set(registry.divisions.map((d) => d.ocdId));
const stateOf = (ocdId: string) =>
  (/state:(\w\w)/.exec(ocdId)?.[1] ?? "??").toUpperCase();
const localTierStates = new Set(
  registry.divisions.filter((d) => d.tier === "local").map((d) => stateOf(d.ocdId)),
);

const us = (await read("lib/registry/officeholders-us.json")) as {
  officeholders: { id: string; name: string }[];
  divisions: { officeholderId: string; ocdId: string }[];
};
const renderable = new Set<string>();
for (const d of us.divisions) {
  if (covered.has(d.ocdId)) renderable.add(d.officeholderId);
  const m = /^ocd-division\/country:us\/state:(\w\w)$/.exec(d.ocdId);
  if (m && localTierStates.has(m[1].toUpperCase())) renderable.add(d.officeholderId);
}
/**
 * **EVERY SITTING MEMBER IS WALKED, NOT ONLY THE ONES A ZIP CAN REACH TODAY.**
 * (`NH101`, 2026-08-24.)
 *
 * This used to filter on `renderable` — a member whose seat is wired to a
 * division. That is a MAPPING fact, and it was silently deciding a PHOTO
 * question: 97 sitting members of Congress whose portraits are sitting in a
 * CC0 corpus were never even attempted, because their seat is not wired yet.
 *
 * The two gaps are different and are counted separately below. A portrait held
 * for an unwired seat costs one row and renders the day the seat is wired; a
 * portrait never fetched has to be discovered all over again.
 */
const federal = us.officeholders.filter((o) => o.id.startsWith("congress:"));
const renderableFederal = federal.filter((o) => renderable.has(o.id));

console.log(
  `${federal.length} sitting federal officials (of ${us.officeholders.length} in the roster) — fetching from the pictorial directory`,
);
console.log(
  `  of those, ${renderableFederal.length} are wired to a division a zip reaches; ` +
    `${federal.length - renderableFederal.length} are held for a seat not yet mapped ` +
    "(a MAPPING gap, never a photo gap)",
);

await mkdir(OUT_DIR, { recursive: true });

/**
 * **A ROW IS OWNED BY WHOEVER SUPPLIED IT, NEVER BY ITS ID PREFIX.**
 * (`NH118`, found and fixed 2026-08-24.)
 *
 * This filtered on `officeholderId.startsWith("congress:")` and rebuilt that
 * whole prefix from ONE source. Ten sitting members of Congress —  Barrett,
 * Begich III, Bell, Fuller, Grijalva, Gallagher, Menefee, Mejia, Van Epps and
 * Walkinshaw — carried portraits found on a DIFFERENT branch (Wikimedia
 * Commons, House Creative Services, door 1, public domain, collected
 * 2026-08-15). The pictorial directory does not hold any of the ten, because
 * they are recent arrivals. So every run of this script deleted ten rows whose
 * bytes were still sitting on disk, and reported it as ten clean misses.
 *
 * That is two rules at once. RULING 52: a branch coming back empty is one
 * measurement on one route, and this route's emptiness was being written over
 * another route's finding. And the carry-forward rule: a failed retrieval may
 * never be written into the data as an absence.
 *
 * So ownership is now PROVENANCE. A row this script did not produce is not
 * this script's to delete, whatever its id says.
 */
/**
 * BOTH FORMS of the same corpus count as ours: the Pages URL when HTTP served
 * it, and the pinned github.com blob URL when the git rung did. A check that
 * knew only one of them would read this script's own git-retrieved rows as
 * somebody else's and preserve them forever, which is a different bug in the
 * safe direction — and it would make the counts below lie.
 */
const OURS = (sourceUrl: string) =>
  sourceUrl.startsWith(SOURCE_BASE) ||
  sourceUrl.startsWith(`https://github.com/${CORPUS_SLUG}/blob/`);

let preservedPhotos: PhotoRecord[] = [];
let preservedMissing: MissingRecord[] = [];
/** Rows we DID supply before and could not re-fetch this run. Carried forward. */
let previouslyOurs: PhotoRecord[] = [];
/** What the registry held before this run, so a shrink cannot pass unremarked. */
let priorTotal: number | null = null;
try {
  const existing = (await read("lib/registry/official-photos.json")) as {
    photos: PhotoRecord[];
    missing: MissingRecord[];
  };
  preservedPhotos = existing.photos.filter(
    (p) => !p.officeholderId.startsWith("congress:") || !OURS(p.sourceUrl),
  );
  previouslyOurs = existing.photos.filter(
    (p) => p.officeholderId.startsWith("congress:") && OURS(p.sourceUrl),
  );
  preservedMissing = existing.missing.filter(
    (m) => !m.officeholderId.startsWith("congress:"),
  );
  priorTotal = existing.photos.length;
} catch {
  // First run: nothing to preserve.
}
const preservedFromOtherBranches = preservedPhotos.filter((p) =>
  p.officeholderId.startsWith("congress:"),
).length;

const photos: PhotoRecord[] = [];
const missing: MissingRecord[] = [];
const now = new Date().toISOString();
let strippedCount = 0;
/** Rows kept alive because neither road answered today. Reported, never silent. */
let carriedForward = 0;

// Serialized, identified — the public-records fetch discipline.
for (const { id, name } of federal) {
  const bioguide = id.slice("congress:".length);
  const sourceUrl = `${SOURCE_BASE}/${bioguide}.jpg`;
  const response = await fetch(sourceUrl, {
    headers: {
      "user-agent": "we-the-people-civic-app/0.1 (contact: seanj22@gmail.com)",
    },
  });

  /*
   * THE SECOND ROAD, walked before an absence is recorded. See CORPUS_SLUG
   * above: an HTTP refusal is a fact about a host and was being written into
   * the manifest as a fact about a person.
   */
  let raw: Buffer;
  let viaGit: string | null = null;
  if (response.ok) {
    raw = Buffer.from(await response.arrayBuffer());
  } else {
    const fromGit = portraitOverGit(bioguide);
    if (!fromGit) {
      /*
       * **CARRY FORWARD BEFORE RECORDING AN ABSENCE.** A row this script
       * supplied on an earlier run, whose bytes are still on disk, is not
       * unmade by today's fetch failing — that would be a retrieval failure
       * written into the data as an absence, which is the one thing the
       * refresh corollary forbids. The row keeps its ORIGINAL `collectedAt`,
       * never restamped as fresh (RULING 107).
       */
      const carried = previouslyOurs.find((p) => p.officeholderId === id);
      if (carried) {
        photos.push(carried);
        carriedForward += 1;
        console.log(
          `  CARRY ${bioguide} ${name} — neither road answered today; keeping the row collected ${carried.collectedAt.slice(0, 10)}`,
        );
        continue;
      }
      missing.push({
        officeholderId: id,
        name,
        reason:
          `pictorial-directory image HTTP ${response.status} at ${SOURCE_BASE}, ` +
          `and ${CORPUS_SLUG} at ${CORPUS_PREFIX}/${bioguide}.jpg over git ` +
          `${corpusFailure === null ? "does not carry this bioguide" : `could not be cloned: ${corpusFailure}`}; ` +
          `Congress.gov depiction exists but is "Image courtesy of the Member" ` +
          `(unknown license — not shippable per D20)`,
        attemptedAt: now,
      });
      console.log(`  MISS ${bioguide} ${name} — HTTP ${response.status}, and git found nothing`);
      continue;
    }
    raw = fromGit.bytes;
    viaGit = fromGit.sha;
    console.log(`  GIT  ${bioguide} ${name} — HTTP ${response.status}, retrieved at ${fromGit.sha.slice(0, 8)}`);
  }

  const { bytes, stripped, removed } = stripImageMetadata(raw);
  if (!stripped) {
    // An unrecognized container cannot be certified metadata-free — that
    // is a miss, not a shrug.
    missing.push({
      officeholderId: id,
      name,
      reason: "image fetched but not a recognized JPEG/PNG — cannot strip metadata, not shipped",
      attemptedAt: now,
    });
    console.log(`  MISS ${bioguide} ${name} — unrecognized format`);
    continue;
  }
  if (removed.length > 0) strippedCount++;
  await writeFile(join(OUT_DIR, `${bioguide}.jpg`), bytes);
  photos.push({
    officeholderId: id,
    name,
    url: `/officials/${bioguide}.jpg`,
    /*
     * **THE ROAD ACTUALLY WALKED, not the road we meant to walk.** A row that
     * cited the Pages URL for bytes that arrived over git would be provenance
     * naming a source nobody read — the same class of defect as a freshness
     * stamp written by something that did not perform the read (RULING 107).
     * The git form is also the stronger citation: it is pinned to a commit, so
     * it is reproducible where a CDN read is not.
     */
    sourceUrl:
      viaGit === null
        ? sourceUrl
        : `https://github.com/${CORPUS_SLUG}/blob/${viaGit}/${CORPUS_PREFIX}/${bioguide}.jpg`,
    license: LICENSE,
    attribution: null,
    collectedAt: now,
  });
}

await writeFile(
  MANIFEST,
  JSON.stringify(
    {
      generatedAt: now,
      photos: [...photos, ...preservedPhotos],
      missing: [...missing, ...preservedMissing],
    },
    null,
    2,
  ) + "\n",
);

const wroteTotal = photos.length + preservedPhotos.length;

console.log(
  `federal: ${photos.length} rows of ${federal.length} attempted ` +
    `(${photos.length - carriedForward} fetched this run, ${carriedForward} carried forward); ` +
    `${missing.length} recorded misses; ` +
    `${strippedCount} carried metadata that was stripped`,
);
console.log(
  `  preserved untouched: ${preservedPhotos.length} photo row(s), of which ` +
    `${preservedFromOtherBranches} are congress: rows THIS SCRIPT DID NOT SUPPLY ` +
    "(a different branch found them; they are not this route's to delete)",
);
console.log(`  registry total: ${wroteTotal} photo row(s) + ${missing.length + preservedMissing.length} miss row(s) → ${MANIFEST}`);

if (photos.length === 0) {
  console.error("zero photos fetched — that is a finding, check the source");
  process.exit(1);
}

/*
 * **A RUN MAY NOT SHRINK THE REGISTRY WITHOUT SAYING SO.** This is the guard
 * that would have caught `NH118` on the day it was introduced instead of nine
 * days later: ten rows vanished under a run that reported itself healthy,
 * because "427 fetched of 437 attempted" is a true sentence about a run that
 * had just deleted somebody's face.
 */
if (priorTotal !== null && wroteTotal < priorTotal) {
  console.error(
    `REFUSED: the registry went from ${priorTotal} photo row(s) to ${wroteTotal}. ` +
      "A retrieval failure may never be written into the data as an absence. " +
      "If rows genuinely retired, say which and why.",
  );
  process.exit(1);
}
console.log(
  `  row count: ${priorTotal ?? "—"} → ${wroteTotal} (never allowed to fall silently)`,
);
