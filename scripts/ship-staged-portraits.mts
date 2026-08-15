/**
 * Ship the judged Commons portraits (photo session Tier 2+3, 2026-08-14).
 *
 * Input: the sweep's staged directories (results.json + images), plus the
 * human judgment pass — every staged image was viewed and judged against
 * the 2b rule (clean solo portrait, right person) before this script runs;
 * the judgment strings below are that pass's record. This script:
 *
 * - copies each approved image into public/ (metadata-stripped);
 * - adds a licensed manifest row per official-surface photo
 *   (congress / statewide / roster ids) and clears their missing rows;
 * - regenerates lib/registry/roster-photos.json (the tiny client-safe
 *   derivative body-rosters.ts imports — guarded in sync by test);
 * - sets ballot card photoUrl + photoSource per shipped candidate,
 *   including the lineup-key twin where the lineup lists the same person;
 * - records a hunt entry for EVERY ballot target the sweep missed, and a
 *   manifest missing row for every roster/statewide/congress miss — the
 *   Commons rung is walked either way, and a miss is a recorded state.
 *
 * `pnpm exec tsx scripts/ship-staged-portraits.mts <stagedDir> [stagedDir2...]`
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { stripImageMetadata } from "./strip-image-metadata.mts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TODAY = "2026-08-14";

interface ResultRow {
  key: string;
  name: string;
  outcome: string;
  detail: string;
  attemptedAt: string;
  wikidataId?: string;
  commonsFile?: string;
  commonsFilePage?: string;
  license?: string;
  artist?: string;
  stagedFile?: string;
}

/** The human judgment pass — a photo absent from this map DOES NOT SHIP. */
const JUDGMENTS: Record<string, string> = {
  "ballot-az-pima:governor:hobbs-katie": "solo speaking-event portrait, unambiguous sole subject",
  "ballot-az-pima:secretary-of-state:fontes-adrian": "clean solo portrait",
  "ballot-az-pima:attorney-general:mayes-kris": "clean solo portrait",
  "ballot-az-pima:state-senate-19:griffin-gail": "informal event candid, unambiguous sole subject",
  "ballot-az-pima:state-senate-20:hernandez-alma": "clean solo candid, sole subject",
  "ballot-az-pima:state-house-19:diaz-lupe": "clean solo portrait",
  "ballot-az-pima:state-house-19:gowan-david": "solo event candid, sole subject",
  "ballot-az-pima:state-house-20:gonzales-sally-ann": "solo speaking portrait at committee microphone",
  "ballot-az-pima:state-house-20:villegas-betty": "clean solo portrait (hearing room)",
  "ballot-nh-merrimack:governor:ayotte-kelly": "official U.S. Senate portrait, public domain",
  "roster:pima#5": "professional studio headshot",
  "roster:susd12#4": "solo candid, unambiguous sole subject",
  "roster:tucson-mc#1": "clean solo portrait",
  "congress:B001321": "official congressional portrait",
  "congress:B001323": "official congressional portrait",
  "congress:B001324": "official congressional portrait",
  "congress:F000485": "official congressional portrait",
  "congress:G000606": "official congressional portrait",
  "congress:G000607": "official congressional portrait",
  "congress:M001245": "official congressional portrait",
  "congress:M001246": "official congressional portrait",
  "congress:V000139": "official congressional portrait",
  "congress:W000831": "official congressional portrait",
  "statewide:az/governor": "solo speaking-event portrait, unambiguous sole subject",
  "statewide:nh/governor": "official U.S. Senate portrait, public domain",
  "statewide:nj/governor": "clean solo portrait",
};

const stagedDirs = process.argv.slice(2);
if (stagedDirs.length === 0) {
  console.error("usage: ship-staged-portraits.mts <stagedDir> [more...]");
  process.exit(1);
}

const results: ResultRow[] = [];
for (const dir of stagedDirs) {
  results.push(
    ...(JSON.parse(await readFile(join(dir, "results.json"), "utf8")) as ResultRow[]),
  );
}
// A later run supersedes an earlier one for the same key (the 429 retries).
const byKey = new Map<string, ResultRow>();
for (const row of results) byKey.set(row.key, row);

const manifest = JSON.parse(
  await readFile(join(ROOT, "lib", "registry", "official-photos.json"), "utf8"),
);
const cardsFile = JSON.parse(
  await readFile(join(ROOT, "data", "ballot", "candidate-cards-2026.json"), "utf8"),
);
const lineup = JSON.parse(
  await readFile(join(ROOT, "data", "ballot", "az-general-lineup-2026.json"), "utf8"),
) as { contests: { contestId: string; nominees: { name: string }[] }[] };

/** contestId|name key when the lineup lists this person, else null. */
function lineupTwin(candidacyKey: string, name: string): string | null {
  const contestId = candidacyKey.split(":").slice(0, 2).join(":");
  const contest = lineup.contests.find((c) => c.contestId === contestId);
  return contest?.nominees.some((n) => n.name === name)
    ? `${contestId}|${name}`
    : null;
}

async function commitImage(stagedFile: string, outRel: string) {
  await mkdir(dirname(join(ROOT, "public", outRel)), { recursive: true });
  const raw = await readFile(stagedFile);
  const { bytes, stripped } = stripImageMetadata(raw);
  if (!stripped) throw new Error(`${stagedFile}: unrecognized format, cannot strip`);
  await writeFile(join(ROOT, "public", outRel), bytes);
  return `/${outRel.replace(/\\/g, "/")}`;
}

let shipped = 0;
let missesRecorded = 0;

for (const row of byKey.values()) {
  const judgment = JUDGMENTS[row.key];

  // ── Misses (and anything staged but not judged clean) ─────────────────
  if (row.outcome !== "STAGED" || !judgment) {
    const rung = `Wikimedia Commons rung (photo session ${TODAY}): ${row.outcome}${
      judgment === undefined && row.outcome === "STAGED"
        ? " but FAILED the human portrait judgment"
        : ""
    } — ${row.detail}`;
    if (row.key.startsWith("ballot-")) {
      const hunt = cardsFile.hunts.find((h: { key: string }) => h.key === row.key);
      if (hunt) hunt.note = `${hunt.note} ${rung}`;
      else
        cardsFile.hunts.push({ key: row.key, name: row.name, note: rung, attemptedAt: TODAY });
    } else {
      manifest.missing = manifest.missing.filter(
        (m: { officeholderId: string }) => m.officeholderId !== row.key,
      );
      manifest.missing.push({
        officeholderId: row.key,
        name: row.name,
        reason: rung,
        attemptedAt: TODAY,
      });
    }
    missesRecorded++;
    continue;
  }

  // ── Ships ─────────────────────────────────────────────────────────────
  const licenseLabel = `${row.license}${row.artist ? ` — ${row.artist}` : ""} (Wikimedia Commons, ${row.commonsFilePage})`;

  if (row.key.startsWith("congress:")) {
    const bioguide = row.key.slice("congress:".length);
    const url = await commitImage(row.stagedFile!, join("officials", `${bioguide}.jpg`));
    manifest.missing = manifest.missing.filter(
      (m: { officeholderId: string }) => m.officeholderId !== row.key,
    );
    manifest.photos.push({
      officeholderId: row.key,
      name: row.name,
      url,
      sourceUrl: row.commonsFilePage,
      license: licenseLabel,
      attribution: row.artist || null,
      collectedAt: new Date().toISOString(),
    });
  } else if (row.key.startsWith("statewide:") || row.key.startsWith("roster:")) {
    const safe = row.key
      .replace(/^statewide:/, "statewide-")
      .replace(/^roster:/, "roster-")
      .replace(/[^a-zA-Z0-9-]+/g, "-");
    const url = await commitImage(row.stagedFile!, join("officials", `${safe}.jpg`));
    manifest.missing = manifest.missing.filter(
      (m: { officeholderId: string }) => m.officeholderId !== row.key,
    );
    manifest.photos.push({
      officeholderId: row.key,
      name: row.name,
      url,
      sourceUrl: row.commonsFilePage,
      license: licenseLabel,
      attribution: row.artist || null,
      collectedAt: new Date().toISOString(),
    });
  } else if (row.key.startsWith("ballot-")) {
    const slug = row.key.replace(/^ballot-/, "").replace(/[^a-zA-Z0-9-]+/g, "-");
    const url = await commitImage(row.stagedFile!, join("candidates", `${slug}.jpg`));
    const photoSource = `${judgment} — Wikimedia Commons, ${row.license}${
      row.artist ? `, photo: ${row.artist}` : ""
    }; file page read ${TODAY}, committed copy served from our origin`;
    const keys = [row.key];
    const twin = lineupTwin(row.key, row.name);
    if (twin) keys.push(twin);
    for (const key of keys) {
      const card = cardsFile.cards[key] ?? {
        photoUrl: null,
        photoSource: null,
        bio: null,
        bioSourceUrl: null,
        bioSourceLabel: null,
        email: null,
        phone: null,
      };
      card.photoUrl = url;
      card.photoSource = photoSource;
      cardsFile.cards[key] = card;
    }
    const note = `PHOTO RESOLVED ${TODAY} (photo session, Commons rung): ${row.wikidataId} matched by attributes, license ${row.license}, judged "${judgment}"; committed at ${url}.`;
    const hunt = cardsFile.hunts.find((h: { key: string }) => h.key === row.key);
    if (hunt) hunt.note = `${hunt.note} ${note}`;
    else cardsFile.hunts.push({ key: row.key, name: row.name, note, attemptedAt: TODAY });
  }
  shipped++;
}

// ── Cross-surface reuse: a person shipped once serves every surface ─────
// Grijalva and Mejia sit on ballots as sitting members — their committed
// congressional photos serve the cards (the Goodlander precedent).
const REUSE: [string, string, string][] = [
  ["ballot-az-pima:us-house-7:grijalva-adelita", "congress:G000606", "Adelita Grijalva"],
  ["ballot-az-pima:us-house-7|Adelita Grijalva", "congress:G000606", "Adelita Grijalva"],
  ["ballot-nj-morris:us-house-11:mejia", "congress:M001246", "Analilia Mejia"],
];
// The governors' statewide photos serve their ballot cards where the
// ballot copy is not already shipped from the same Commons file.
for (const [cardKey, officeholderId, name] of REUSE) {
  const photo = manifest.photos.find(
    (p: { officeholderId: string }) => p.officeholderId === officeholderId,
  );
  if (!photo) continue;
  const card = cardsFile.cards[cardKey] ?? {
    photoUrl: null,
    photoSource: null,
    bio: null,
    bioSourceUrl: null,
    bioSourceLabel: null,
    email: null,
    phone: null,
  };
  if (card.photoUrl) continue;
  card.photoUrl = photo.url;
  card.photoSource = `Committed portrait of the sitting member (license recorded in lib/registry/official-photos.json: ${photo.license})`;
  cardsFile.cards[cardKey] = card;
  const note = `PHOTO RESOLVED ${TODAY} (photo session): reuses the committed portrait ${photo.url} — ${photo.license}.`;
  const hunt = cardsFile.hunts.find((h: { key: string }) => h.key === cardKey);
  if (hunt) hunt.note = `${hunt.note} ${note}`;
  else cardsFile.hunts.push({ key: cardKey, name, note, attemptedAt: TODAY });
  shipped++;
}

// ── The client-safe roster derivative ───────────────────────────────────
const rosterPhotos: Record<string, string> = {};
for (const p of manifest.photos) {
  if (p.officeholderId.startsWith("roster:") && p.license) {
    rosterPhotos[p.officeholderId] = p.url;
  }
}
await writeFile(
  join(ROOT, "lib", "registry", "roster-photos.json"),
  JSON.stringify(rosterPhotos, null, 2) + "\n",
);

manifest.generatedAt = new Date().toISOString();
await writeFile(
  join(ROOT, "lib", "registry", "official-photos.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
await writeFile(
  join(ROOT, "data", "ballot", "candidate-cards-2026.json"),
  JSON.stringify(cardsFile, null, 2) + "\n",
);

console.log(
  `shipped ${shipped} portraits; recorded ${missesRecorded} misses; ` +
    `manifest now ${manifest.photos.length} photos / ${manifest.missing.length} missing; ` +
    `roster-photos.json has ${Object.keys(rosterPhotos).length} entries`,
);
