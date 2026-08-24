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
const federal = us.officeholders.filter(
  (o) => renderable.has(o.id) && o.id.startsWith("congress:"),
);

console.log(
  `${federal.length} renderable federal officials (of ${us.officeholders.length} in the roster) — fetching from the pictorial directory`,
);

await mkdir(OUT_DIR, { recursive: true });

// Rows owned by other tiers survive a Tier 1 rerun untouched.
let preservedPhotos: PhotoRecord[] = [];
let preservedMissing: MissingRecord[] = [];
try {
  const existing = (await read("lib/registry/official-photos.json")) as {
    photos: PhotoRecord[];
    missing: MissingRecord[];
  };
  preservedPhotos = existing.photos.filter(
    (p) => !p.officeholderId.startsWith("congress:"),
  );
  preservedMissing = existing.missing.filter(
    (m) => !m.officeholderId.startsWith("congress:"),
  );
} catch {
  // First run: nothing to preserve.
}

const photos: PhotoRecord[] = [];
const missing: MissingRecord[] = [];
const now = new Date().toISOString();
let strippedCount = 0;

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

console.log(
  `federal: ${photos.length} fetched of ${federal.length} attempted; ${missing.length} recorded misses; ` +
    `${strippedCount} carried metadata that was stripped; ` +
    `${preservedPhotos.length} photos + ${preservedMissing.length} misses from other tiers preserved → ${MANIFEST}`,
);
if (photos.length === 0) {
  console.error("zero photos fetched — that is a finding, check the source");
  process.exit(1);
}
