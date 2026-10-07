import { getRegistryRuntimeReadModel } from "../registry/runtime-read-model.ts";

/**
 * One person, one photo (item 6b, 2026-08-15, the author's finding).
 *
 * The defect: Katie Hobbs's OFFICIALS row showed her corrected official
 * portrait while her BALLOT-CANDIDATE card still rendered the old event
 * candid. The same human, two photo rows, one stale — and nothing could
 * notice, because the two surfaces keep photos in different files under
 * different ids. Running the audit found she was one of NINE.
 *
 * The fix is structural rather than nine edits: a photo belongs to the
 * PERSON, so every surface asks this module for it and the answer is the
 * same everywhere. Precedence, deterministic and stated:
 *
 *  1. An official government-published portrait wins. It is the portrait a
 *     body publishes to identify its own member, it is the one that gets
 *     corrected when it is wrong, and a candidate card for a sitting
 *     officeholder showing something else is the stale half by definition.
 *  2. Within the officials surface, a `roster:` row wins, then the lowest
 *     key. Both rows are official portraits of the same person — Consuelo
 *     Hernandez holds a school-board seat and a legislative one — so either
 *     is her face from an official source, and what matters is that every
 *     surface shows the SAME one. The roster row wins for a mechanical
 *     reason: `roster-photos.json` is a client-bundled derivative pinned
 *     by test to the manifest, so a roster photo is the one artifact
 *     server-side code cannot talk out of rendering. Following it is how
 *     the two agree.
 *  3. Where the person holds no office, the card's own photo stands.
 *
 * **The source label travels with the URL.** Swapping the image without
 * swapping its attribution would put the government portrait under the
 * Commons photographer's credit — a false statement about provenance, which
 * is worse than the duplicate it fixed.
 *
 * Server-side: reads the already-loaded canonical registry-runtime
 * projection. Both ballot surfaces resolve through
 * `lib/ballot/candidate-cards.ts`, which calls this. Tracked modules are
 * first-seed inputs only; this production resolver never reparses them.
 */

export interface PersonPhoto {
  url: string;
  /** The reader-facing provenance line, matching the URL it describes. */
  source: string;
}

interface OfficialPhotoRow {
  officeholderId: string;
  name: string;
  url: string;
  sourceUrl: string | null;
  license: string | null;
  attribution: string | null;
}

/** Suffixes, accents and punctuation are not identity. */
export function personKey(name: string): string {
  return name
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Z ]/g, " ")
    .replace(/\b(JR|SR|II|III|IV|V)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Does officeholder id `a` win over `b` for the same person? A `roster:`
 * row first (see the note above), then the lowest id — deterministic, and
 * the same answer whatever order the rows are read in.
 */
function beats(a: string, b: string): boolean {
  const aRoster = a.startsWith("roster:");
  const bRoster = b.startsWith("roster:");
  if (aRoster !== bRoster) return aRoster;
  return a < b;
}

let index: Map<string, PersonPhoto> | null = null;

function buildIndex(): Map<string, PersonPhoto> {
  const best = new Map<string, { key: string; photo: PersonPhoto }>();

  const runtime = getRegistryRuntimeReadModel();
  const generated = runtime.officialPhotos as { photos: OfficialPhotoRow[] };

  for (const row of generated.photos) {
    const key = personKey(row.name);
    if (!key) continue;
    const existing = best.get(key);
    if (existing && !beats(row.officeholderId, existing.key)) continue;
    const credit = [row.license, row.attribution].filter(Boolean).join(" — ");
    best.set(key, {
      key: row.officeholderId,
      photo: {
        url: row.url,
        source: credit || "Official portrait published by the office",
      },
    });
  }

  // Some statewide executives carry portraits on their canonical holder row
  // rather than the photo manifest. Read those typed rows from the same
  // promoted registry projection; never parse the retired tracked seed.
  for (const row of runtime.statewideExecutives) {
    if (!row.holder.photoUrl) continue;
    const key = personKey(row.holder.name);
    if (!key) continue;
    const holderId = row.holder.id;
    const existing = best.get(key);
    if (existing && !beats(holderId, existing.key)) continue;
    best.set(key, {
      key: holderId,
      photo: {
        url: row.holder.photoUrl,
        source: row.sourceOrg
          ? `Official portrait published by the ${row.sourceOrg}`
          : "Official portrait published by the office",
      },
    });
  }

  return new Map([...best].map(([key, entry]) => [key, entry.photo]));
}

/**
 * The official portrait for a person, or null when they hold no office we
 * have a portrait for. Callers keep their own photo in that case.
 */
export function officialPhotoForPerson(name: string): PersonPhoto | null {
  if (!index) index = buildIndex();
  return index.get(personKey(name)) ?? null;
}

/**
 * Collapse an officeholderId→url map so every id belonging to one person
 * points at that person's single photo. Applied where the officials photo
 * index is built (lib/registry/server.ts): Consuelo Hernandez holds a
 * school-board seat AND a legislative one, so before this her two rows
 * rendered two different faces of the same woman.
 *
 * `names` maps officeholderId → the person's name, which is what the two
 * ids have in common; ids whose person has no winning photo are left
 * exactly as they were.
 */
export function collapsePhotoIndexByPerson(
  byId: Map<string, string>,
  names: Map<string, string>,
): Map<string, string> {
  const out = new Map(byId);
  for (const [id] of byId) {
    const name = names.get(id);
    if (!name) continue;
    const winner = officialPhotoForPerson(name);
    if (winner) out.set(id, winner.url);
  }
  return out;
}

/** Test seam: drop the memoized index after a fixture change. */
export function resetPersonPhotoIndex(): void {
  index = null;
}
