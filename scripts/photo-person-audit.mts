/**
 * `pnpm photos:person-audit` — one person, one photo (item 6b, 2026-08-15).
 *
 * The author's finding: Katie Hobbs's OFFICIALS row shows her corrected
 * official portrait while her BALLOT-CANDIDATE card still renders the old
 * event candid. The same human, two photo rows, one of them stale — and
 * nothing in the codebase could notice, because the two surfaces keep their
 * photos in different files keyed by different ids.
 *
 * This walks every surface that can put a face on the screen, groups the
 * rows by PERSON (normalized name, suffixes and accents stripped), and
 * reports every person carrying more than one distinct image URL. It writes
 * nothing and decides nothing: the resolver in lib/photos/person.ts is what
 * fixes the render, and tests/photo-person.test.ts is what keeps it fixed.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

interface PhotoRow {
  person: string;
  url: string;
  surface: string;
  key: string;
}

/*
 * **ONE implementation of person identity** (RULING 103, 2026-08-23).
 *
 * This script carried a byte-identical copy of `personKey` under a different
 * name. Two normalisers for the same question is the shape that let three
 * copies of an initials function render Thomas J. Haynes III as "TI" — and
 * here it is worse, because the audit that CHECKS one-person-one-photo would
 * have been checking with a different definition of a person than the resolver
 * it audits.
 */
import { personKey } from "../lib/photos/person.ts";

export { personKey as normalizePersonName };

export function collectPhotoRows(root = ROOT): PhotoRow[] {
  const rows: PhotoRow[] = [];

  const officialPhotos = JSON.parse(
    readFileSync(join(root, "lib", "registry", "official-photos.json"), "utf8"),
  ) as { photos: { officeholderId: string; name: string; url: string }[] };
  for (const photo of officialPhotos.photos) {
    rows.push({
      person: photo.name,
      url: photo.url,
      surface: "officials",
      key: photo.officeholderId,
    });
  }

  // The statewide executives carry their portraits inline rather than in
  // the generated file — Hobbs is one of them, which is half of why the
  // clash was invisible.
  const statewide = readFileSync(
    join(root, "lib", "officials", "statewide-executives.ts"),
    "utf8",
  );
  const blocks = statewide.split(/\n    \{\n/);
  for (const block of blocks) {
    const name = /name:\s*"([^"]+)"/.exec(block);
    const url = /photoUrl:\s*"([^"]+)"/.exec(block);
    const id = /id:\s*"([^"]+)"/.exec(block);
    if (name && url) {
      rows.push({
        person: name[1],
        url: url[1],
        surface: "statewide",
        key: id?.[1] ?? name[1],
      });
    }
  }

  const cards = JSON.parse(
    readFileSync(join(root, "data", "ballot", "candidate-cards-2026.json"), "utf8"),
  ) as { cards: Record<string, { photoUrl: string | null }> };
  for (const [key, card] of Object.entries(cards.cards)) {
    if (!card.photoUrl) continue;
    // Candidacy ids are `<prefix>:<contest>:<family>-<given>`; lineup keys
    // are `<contestId>|<Full Name>`. Both carry the name, in different
    // shapes, which is exactly why nothing joined them before.
    const name = key.includes("|")
      ? key.split("|")[1]
      : key.split(":").pop()!.split("-").reverse().join(" ");
    rows.push({ person: name, url: card.photoUrl, surface: "ballot-card", key });
  }

  return rows;
}

export interface PersonPhotoClash {
  person: string;
  urls: { url: string; surfaces: string[] }[];
}

export function findPersonPhotoClashes(rows: PhotoRow[]): PersonPhotoClash[] {
  const byPerson = new Map<string, PhotoRow[]>();
  for (const row of rows) {
    const key = personKey(row.person);
    if (!key) continue;
    const list = byPerson.get(key);
    if (list) list.push(row);
    else byPerson.set(key, [row]);
  }

  const clashes: PersonPhotoClash[] = [];
  for (const [person, group] of byPerson) {
    const urls = new Map<string, string[]>();
    for (const row of group) {
      const list = urls.get(row.url);
      if (list) list.push(`${row.surface}:${row.key}`);
      else urls.set(row.url, [`${row.surface}:${row.key}`]);
    }
    if (urls.size > 1) {
      clashes.push({
        person,
        urls: [...urls.entries()].map(([url, surfaces]) => ({ url, surfaces })),
      });
    }
  }
  return clashes.sort((a, b) => a.person.localeCompare(b.person));
}

if (process.argv[1] && process.argv[1].endsWith("photo-person-audit.mts")) {
  const rows = collectPhotoRows();
  const clashes = findPersonPhotoClashes(rows);
  console.log("");
  console.log(`photo rows walked: ${rows.length}`);
  const people = new Set(rows.map((r) => personKey(r.person)));
  console.log(`distinct people: ${people.size}`);
  console.log(`people wearing more than one photo: ${clashes.length}`);
  console.log("");
  for (const clash of clashes) {
    console.log(`  ${clash.person}`);
    for (const entry of clash.urls) {
      console.log(`    ${entry.url}  ←  ${entry.surfaces.join(", ")}`);
    }
  }
  console.log("");
}
