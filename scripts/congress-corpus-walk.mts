/**
 * **WALK THE TWO GITHUB CORPORA OVER `git`, WHERE HTTP IS REFUSED.**
 * (The questionnaire-and-corpora brief, item 2, 2026-08-23. RULING 88.)
 *
 * ```
 * corepack pnpm congress:corpus                 # report only
 * corepack pnpm congress:corpus --write         # write the evidence artifact
 * corepack pnpm congress:corpus --portraits DIR # also materialise the owed
 *                                               # portraits into DIR, stripped
 * ```
 *
 * ## What it walks, and why by `git`
 *
 * `unitedstates/congress-legislators` — the federal directory, which states
 * its own membership by carrying one entry per sitting member.
 * `unitedstates/images` — the GPO pictorial-directory portraits, keyed by
 * bioguide id.
 *
 * Both are read through `lib/hunt/github-corpus.ts`, which clones them
 * bloblessly and reads at a pinned commit. **The HTTP host both corpora are
 * normally read from is refused on this machine and the git host is not**, and
 * a clone is reproducible where a CDN read is not — so this is the better route
 * even where both work.
 *
 * ## The count assertion is mandatory here (RULING 100)
 *
 * The directory states its own membership — one entry per sitting member — and
 * the portrait corpus states its own size through `git ls-tree`, for free,
 * before a byte of image data moves. An extraction yielding fewer than either
 * FAILS. Neither is `NOT_ASSERTABLE`: both sources genuinely state a number.
 *
 * ## What it does NOT do, and that is RULING 20 rather than a shortfall
 *
 * **It does not commit portrait bytes.** RULING 20 keeps portraits and PDF
 * corpora out of git, `tests/asset-store.test.ts` enforces it against
 * `data/assets/manifest.json`, and the content-addressed store that manifest
 * points at is a local path on the author's machine (`R57`). So this retrieves
 * every owed portrait, VERIFIES it — real JPEG, real dimensions, SHA-256, byte
 * count — and records the provenance a later `pnpm assets migrate` needs.
 * Provenance stays in git; bytes do not. Pass `--portraits DIR` to materialise
 * them somewhere outside the repo.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import { assertCount, assertionLine } from "../lib/extract/count-assertion.ts";
import {
  listPaths,
  licenceIdentifier,
  openCorpus,
  readBinaryFile,
  readLicense,
  readTextFile,
} from "../lib/hunt/github-corpus.ts";

const ROOT = join(dirname(new URL(import.meta.url).pathname), "..");
const OUT = join(ROOT, "data/hunt/congress-corpus-walk.json");
const CACHE = join(process.env.WTP_CORPUS_CACHE ?? tmpdir(), "wtp-github-corpora");

const PORTRAIT_PREFIX = "congress/450x550";

interface SnapshotMember {
  bioguide: string;
  name: string;
  chamber: string;
  state: string;
  phone: string | null;
  url: string | null;
  contactForm: string | null;
}

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

/** JPEG SOF dimensions, so "it is a real portrait" is checked rather than assumed. */
function jpegSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = buf[i + 1];
    const length = buf.readUInt16BE(i + 2);
    const isSof =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    i += 2 + length;
  }
  return null;
}

function main(): void {
  const write = process.argv.includes("--write");
  const portraitsAt = process.argv.includes("--portraits")
    ? process.argv[process.argv.indexOf("--portraits") + 1]
    : null;

  /* ------------------------------------------------------- the two clones --- */
  const directory = openCorpus({ slug: "unitedstates/congress-legislators", cacheDir: CACHE });
  const images = openCorpus({ slug: "unitedstates/images", cacheDir: CACHE });

  const licences = [directory, images].map((handle) => {
    const licence = readLicense(handle);
    return {
      slug: handle.slug,
      sha: handle.sha,
      treeUrl: handle.treeUrl,
      licenceFile: licence?.path ?? null,
      licenceIdentifier: licence ? licenceIdentifier(licence.text) : null,
      licenceBytes: licence ? Buffer.byteLength(licence.text, "utf8") : 0,
      licenceSha256: licence ? sha256(Buffer.from(licence.text, "utf8")) : null,
    };
  });

  console.log("congress corpora — walked over git, not over HTTP");
  for (const l of licences) {
    console.log(`  ${l.slug}`);
    console.log(`    commit   ${l.sha}`);
    console.log(`    licence  ${l.licenceIdentifier ?? "UNREADABLE"} (from its own ${l.licenceFile})`);
  }

  /* ------------------------- the directory, and its own membership count --- */
  const yaml = readTextFile(directory, "legislators-current.yaml");
  /*
   * One top-level list entry per sitting member. Counted from the document's
   * own structure rather than from a sentence, which is what `statedBy`
   * records — the directory states its membership by BEING one entry per
   * member, and that is a stated count, not an absent one.
   */
  const statedMembers = (yaml.match(/^- id:$/gm) ?? []).length;

  const snapshot = JSON.parse(
    readFileSync(join(ROOT, "data/congress-legislators/snapshot.json"), "utf8"),
  ) as { source: { collectedAt: string; sha: string }; members: SnapshotMember[] };

  const held = new Map(snapshot.members.map((m) => [m.bioguide, m]));
  const bioguides = [...yaml.matchAll(/^\s{4}bioguide:\s*(\S+)\s*$/gm)].map((m) => m[1]);
  const directoryAssertion = assertCount(
    bioguides.length,
    statedMembers,
    "one top-level entry per sitting member in legislators-current.yaml",
  );

  console.log("\n  DIRECTORY");
  console.log(`    ${assertionLine(directoryAssertion)}`);
  const matched = bioguides.filter((b) => held.has(b)).length;
  console.log(`    matched to members we hold      ${matched} of ${bioguides.length}`);
  console.log(`    in the corpus but not held      ${bioguides.length - matched}`);
  console.log(
    `    held but no longer current      ${snapshot.members.filter((m) => !bioguides.includes(m.bioguide)).length}`,
  );
  console.log(`    our snapshot's commit           ${snapshot.source.sha}`);
  console.log(`    the corpus's commit today       ${directory.sha}`);

  /* --------------------------------------- fields, by type, against ours --- */
  const FIELDS: ReadonlyArray<[keyof SnapshotMember, RegExp]> = [
    ["phone", /^\s{4}phone:\s*["']?([^"'\n]+)["']?\s*$/],
    ["url", /^\s{4}url:\s*["']?([^"'\n]+)["']?\s*$/],
    ["contactForm", /^\s{4}contact_form:\s*["']?([^"'\n]+)["']?\s*$/],
  ];
  const fieldRows = FIELDS.map(([field]) => {
    let heldCount = 0;
    for (const b of bioguides) {
      const m = held.get(b);
      if (m && m[field]) heldCount += 1;
    }
    return { field, held: heldCount, of: bioguides.length, closedByThisWalk: 0 };
  });
  console.log("\n  FIELDS BY TYPE (against the corpus at this commit)");
  for (const row of fieldRows) {
    console.log(
      `    ${String(row.field).padEnd(14)} held ${row.held} of ${row.of} · closed by this walk ${row.closedByThisWalk}`,
    );
  }

  /* ------------------------------------------ portraits, and the real gap --- */
  const portraitPaths = listPaths(images, PORTRAIT_PREFIX);
  const portraitIds = new Set(
    portraitPaths.map((p) => p.replace(/^.*\//, "").replace(/\.jpg$/i, "")),
  );
  const portraitAssertion = assertCount(
    portraitIds.size,
    portraitPaths.length,
    `git ls-tree of ${PORTRAIT_PREFIX} at ${images.sha}`,
  );

  const manifest = JSON.parse(
    readFileSync(join(ROOT, "lib/registry/official-photos.json"), "utf8"),
  ) as { photos: Record<string, { officeholderId: string }> };
  const havePhoto = new Set(Object.values(manifest.photos).map((p) => p.officeholderId));

  const owed = bioguides.filter((b) => !havePhoto.has(`congress:${b}`) && portraitIds.has(b));
  const owedNoPortrait = bioguides.filter(
    (b) => !havePhoto.has(`congress:${b}`) && !portraitIds.has(b),
  );

  console.log("\n  PORTRAITS");
  console.log(`    ${assertionLine(portraitAssertion)}`);
  console.log(`    portraits in the corpus          ${portraitIds.size}`);
  console.log(
    `    sitting members we already hold  ${bioguides.length - owed.length - owedNoPortrait.length} of ${bioguides.length}`,
  );
  console.log(`    OWED and the corpus has it       ${owed.length}`);
  console.log(`    OWED and the corpus does NOT     ${owedNoPortrait.length}`);
  for (const b of owedNoPortrait) {
    const name = yaml.match(new RegExp(`bioguide: ${b}[\\s\\S]{0,600}?official_full: ["']?([^"'\\n]+)`))?.[1];
    console.log(`      ${b}  ${name ?? "(name not read)"}`);
  }

  /* ---------------------------------- retrieve and VERIFY every owed blob --- */
  const verified: Array<{
    bioguide: string;
    path: string;
    bytes: number;
    sha256: string;
    width: number;
    height: number;
  }> = [];
  const unreadable: string[] = [];

  for (const b of owed) {
    const path = `${PORTRAIT_PREFIX}/${b}.jpg`;
    try {
      const buf = readBinaryFile(images, path);
      const size = jpegSize(buf);
      if (!size || buf.length === 0) {
        unreadable.push(`${b}: retrieved ${buf.length} bytes but it is not a readable JPEG`);
        continue;
      }
      verified.push({
        bioguide: b,
        path,
        bytes: buf.length,
        sha256: sha256(buf),
        width: size.width,
        height: size.height,
      });
      if (portraitsAt) {
        mkdirSync(portraitsAt, { recursive: true });
        writeFileSync(join(portraitsAt, `${b}.jpg`), buf);
      }
    } catch (error) {
      unreadable.push(`${b}: ${(error as Error).message.split("\n")[0]}`);
    }
  }

  console.log(
    `    retrieved and verified           ${verified.length} of ${owed.length}` +
      (unreadable.length > 0 ? `  ·  UNREADABLE ${unreadable.length}` : ""),
  );
  for (const line of unreadable) console.log(`      ${line}`);
  const wrongSize = verified.filter((v) => v.width !== 450 || v.height !== 550);
  console.log(
    `    at the expected 450x550          ${verified.length - wrongSize.length} of ${verified.length}`,
  );
  console.log(
    `    committed into the repo          0 of ${verified.length}  ` +
      `(RULING 20 — portraits do not go in git; the store is R57)`,
  );
  if (portraitsAt) console.log(`    materialised into                ${portraitsAt}`);

  /* --------------------------------------------------------- the verdicts --- */
  let failed = false;
  if (directoryAssertion.verdict === "SHORT") {
    console.error(`\nFAIL (RULING 100): ${directoryAssertion.reason}`);
    failed = true;
  }
  if (portraitAssertion.verdict === "SHORT") {
    console.error(`\nFAIL (RULING 100): ${portraitAssertion.reason}`);
    failed = true;
  }
  if (verified.length !== owed.length) {
    console.error(
      `\nFAIL (RULING 100): ${owed.length} portraits are owed and ${verified.length} were retrieved.`,
    );
    failed = true;
  }
  if (failed) {
    process.exitCode = 1;
    return;
  }

  if (!write) {
    console.log("\n(report only — pass --write to write the evidence artifact)");
    return;
  }

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(
    OUT,
    `${JSON.stringify(
      {
        formatVersion: 1,
        generatedBy: "scripts/congress-corpus-walk.mts",
        note:
          "Walked over git rather than HTTP: the GitHub Pages host both corpora are normally " +
          "read from is refused by this machine's egress and github.com is not. Every read is " +
          "pinned to the commit named per corpus. PORTRAIT BYTES ARE NOT COMMITTED (RULING 20); " +
          "what is committed is the provenance a later `pnpm assets migrate` needs — path, size, " +
          "SHA-256 and dimensions, each verified by retrieving the blob.",
        corpora: licences,
        directory: {
          assertion: directoryAssertion,
          membersInCorpus: bioguides.length,
          matchedToHeld: matched,
          heldNoLongerCurrent: snapshot.members.filter((m) => !bioguides.includes(m.bioguide)).length,
          ourSnapshotSha: snapshot.source.sha,
          ourSnapshotCollectedAt: snapshot.source.collectedAt,
          fields: fieldRows,
        },
        portraits: {
          assertion: portraitAssertion,
          inCorpus: portraitIds.size,
          owedAndInCorpus: owed.length,
          owedAndNotInCorpus: owedNoPortrait,
          retrievedAndVerified: verified.length,
          committedIntoRepo: 0,
          committedIntoRepoReason:
            "RULING 20 — portraits and PDF corpora do not go in git. The content-addressed " +
            "store `data/assets/manifest.json` points at is a local path on the author's " +
            "machine, which is R57.",
          license:
            "Public domain (U.S. federal government work — GPO Congressional Pictorial " +
            "Directory, via unitedstates/images)",
          rows: verified,
        },
      },
      null,
      2,
    )}\n`,
  );
  console.log(`\nwrote ${OUT}`);
}

main();
