import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  holdersFor,
  indexByDivision,
  type OfficeholderIndex,
  type PhotoIndex,
  type SeatHolder,
} from "../officials/lookup.ts";
import { ROSTER_FILES } from "../coverage/artifacts.ts";
import type { OfficeholderSet } from "../officials/types.ts";
import { collapsePhotoIndexByPerson } from "../photos/person.ts";

import { summarizeCoverage, type CoverageSummary } from "./coverage.ts";
import { divisionsAt as resolveDivisionsAt, type GeoFeature } from "./resolve.ts";
import type { Division, Registry } from "./types.ts";

/**
 * Server-side access to the registry and the geometry it resolves against.
 *
 * Both are read from disk once per process and cached. They are static build
 * outputs — the boundary files and `registry.json` are committed exactly like
 * the ZCTA centroids — so nothing here needs a database, which matters because
 * `lib/db/schema.ts` is still `export {}`.
 *
 * **This does not scale, and it is not meant to.** 1.9 MB of GeoJSON parsed into
 * server memory is fine for three counties and untenable for the 90,837 local
 * governments Phase 4.7 targets. That phase replaces it with PMTiles plus a real
 * table. The seam is deliberately narrow — one `coverageAt()` call — so swapping
 * the backing store does not reach into the route or the UI.
 */

interface Loaded {
  features: GeoFeature[];
  divisionsById: Map<string, Division>;
  registry: Registry;
  officials: OfficeholderIndex;
}

/**
 * The generated officeholder rosters, by scope.
 *
 * The federal roster plus one file per state, named by FIPS. Derived from the
 * coverage manifest since AUD-06 (g18) — it was a hand-kept list, and "adding
 * a state is adding a file and a line here" was true of thirteen other files
 * too, which is exactly the omission the manifest exists to make impossible.
 */
const ROSTERS = ROSTER_FILES;

let cache: Promise<Loaded> | null = null;

async function load(): Promise<Loaded> {
  const root = process.cwd();
  const geoDir = join(root, "public", "geo");

  /*
   * **P-003 · THE RESOLVER READS A MANIFEST, NOT A DIRECTORY.**
   * (Performance audit of `336a3eb`, remediated 2026-08-24.)
   *
   * This used to be `readdir` with one file excluded by name. The exclusion
   * was right and the instrument was wrong: `public/geo` is what the CLIENT
   * downloads, plus the INPUTS to the scripts that build it, and a directory
   * listing cannot tell an input from a product.
   *
   * So the resolver loaded `cd119.geojson` — the 1.63 MB national
   * congressional file, 441 features and 80,115 coordinates — alongside
   * `cd119-04`, `cd119-33` and `cd119-34`, its own per-state derivatives,
   * which `pnpm cd:split` writes and which the map has used since g4 item 3.
   * Every feature in the national file that could match a covered point is
   * byte-identical to one in a per-state file, by construction of the split.
   * The resolver was paying for all 435 other districts on every sweep.
   *
   * Measured: 26 files, 2,291 features, 118,533 coordinates → 25 files,
   * 1,850 features, 38,418 coordinates. 67.6% of the geometry gone with no
   * change to any answer, which `pnpm resolver:identity` proves per zip.
   *
   * The old comment's worry is preserved rather than dropped: an allow-list
   * rots the other way, a new district type silently absent. The manifest is
   * GENERATED, states its rule as SUPERSESSION, and accounts for every
   * `.geojson` in the directory on one list or the other —
   * `tests/resolver-manifest.test.ts` fails the build on a file that is on
   * neither.
   */
  const manifest = JSON.parse(
    await readFile(join(root, "data", "derived", "resolver-geometry.json"), "utf8"),
  ) as { files: string[] };
  const names = manifest.files;
  const features: GeoFeature[] = [];
  for (const name of names) {
    const parsed = JSON.parse(await readFile(join(geoDir, name), "utf8"));
    features.push(...(parsed.features as GeoFeature[]));
  }

  const registry = JSON.parse(
    await readFile(join(root, "lib", "registry", "registry.json"), "utf8"),
  ) as Registry;

  // A missing or unreadable roster degrades to no names rather than failing the
  // whole coverage answer. The pre-roster copy is still true — it just says
  // less — whereas a 500 here would take the map's only data dependency down
  // over a file that is nice to have.
  const sets: OfficeholderSet[] = [];
  for (const name of ROSTERS) {
    try {
      sets.push(
        JSON.parse(
          await readFile(join(root, "lib", "registry", name), "utf8"),
        ) as OfficeholderSet,
      );
    } catch (error) {
      console.error(`officeholder roster ${name} could not be read`, error);
    }
  }

  // The photo manifest (D20): per-image source and license, images served
  // from our origin. Missing or unreadable degrades to initials everywhere.
  const photos: PhotoIndex = new Map();
  try {
    const manifest = JSON.parse(
      await readFile(
        join(root, "lib", "registry", "official-photos.json"),
        "utf8",
      ),
    ) as {
      photos: {
        officeholderId: string;
        name: string;
        url: string;
        license: string | null;
      }[];
    };
    const names = new Map<string, string>();
    for (const photo of manifest.photos) {
      // Unknown license is not clearable — such a photo never ships (D20).
      if (!photo.license) continue;
      photos.set(photo.officeholderId, photo.url);
      names.set(photo.officeholderId, photo.name);
    }
    // One person, one photo (item 6b, 2026-08-15). A person holding two
    // seats has two officeholder ids and had two photo rows, so Consuelo
    // Hernandez's school-board row and her legislative row rendered two
    // different faces of the same woman. Collapsed by person here, once,
    // rather than at each of the surfaces that reads this index.
    const collapsed = collapsePhotoIndexByPerson(photos, names);
    photos.clear();
    for (const [id, url] of collapsed) photos.set(id, url);
  } catch {
    // No manifest is a fine state: initials render instead.
  }

  return {
    features,
    divisionsById: new Map(registry.divisions.map((d) => [d.ocdId, d])),
    registry,
    officials: indexByDivision(sets, photos),
  };
}

function loaded(): Promise<Loaded> {
  // Cache the promise, not the result: two concurrent requests during a cold
  // start would otherwise both parse 1.9 MB of GeoJSON.
  cache ??= load().catch((error) => {
    // A failed load must not poison the cache — the next request should retry
    // rather than inherit the failure for the life of the process.
    cache = null;
    throw error;
  });
  return cache;
}

/**
 * Who governs this point, and how much of their calendar we actually have.
 *
 * `meetingCount` is the cascade's answer for the same point. It is what
 * separates "nothing is scheduled" from "we cannot see what is scheduled", and
 * those must never render the same way.
 */
/** The divisions containing a point, from the committed geometry. */
export async function divisionsAt(lat: number, lng: number): Promise<Division[]> {
  const { features, divisionsById } = await loaded();
  return resolveDivisionsAt([lng, lat], features, divisionsById);
}

/**
 * Divisions by OCD id, for a caller that has resolved an AREA rather than a
 * point. (NJ Hunt 3 item 3.1, 2026-08-22.)
 *
 * `NJ01` fixed the ballot page, which resolved a zip to its ZCTA centroid and
 * asked which divisions contain that ONE point. The map's **"Who governs
 * here"** card was the second instance of the same defect and it was still
 * live: production at 07866 read *"4 bodies govern the area around 07866"* and
 * listed Rockaway TOWNSHIP, with Rockaway BOROUGH — a separate municipality
 * inside the same zip, running a four-candidate council race — absent from a
 * card whose heading is the exact question it was getting wrong.
 *
 * The ballot's widening goes through `lib/ballot/zip-divisions.ts`, which
 * yields OCD ids. This turns those back into `Division` records so the coverage
 * summary can be built from the same area answer.
 *
 * **An id the registry does not hold is DROPPED, not invented.** The zip-area
 * index is built from TIGER polygons and the registry is built from its own
 * sources; the two are allowed to disagree, and a synthesised division would be
 * a government this product asserts exists on the strength of nothing.
 */
export async function divisionsByOcdIds(ocdIds: readonly string[]): Promise<Division[]> {
  const { divisionsById } = await loaded();
  const out: Division[] = [];
  for (const id of ocdIds) {
    const division = divisionsById.get(id);
    if (division) out.push(division);
  }
  return out;
}

/**
 * One officeholder by roster id, in the render shape (4, 2026-08-19).
 * Serves the ballot page's incumbent-record link: the id arrives from an
 * exact-key join (never a name match), and an id the roster doesn't hold
 * returns null — no link rather than a wrong one.
 */
export async function seatHolderById(id: string): Promise<SeatHolder | null> {
  const { officials } = await loaded();
  for (const holders of officials.values()) {
    for (const holder of holders) {
      if (holder.id === id) return holder;
    }
  }
  return null;
}

/**
 * officeholder id → partyLabel, across every loaded roster (item 3,
 * 2026-08-14 second session). Serves the party-breakdown join in
 * /api/votes — display data only; nothing downstream infers a position
 * from it.
 */
export async function partyByOfficeholderId(): Promise<
  Map<string, string | null>
> {
  const { officials } = await loaded();
  const map = new Map<string, string | null>();
  for (const holders of officials.values()) {
    for (const holder of holders) {
      if (!map.has(holder.id)) map.set(holder.id, holder.partyLabel);
    }
  }
  return map;
}

/**
 * Which chamber a federal member sits in (item 6b, 2026-08-15).
 *
 * Read off the roster's own `officeTitle`, which the congress-legislators
 * bulk file sets from the term's `type` — so it is the source's answer, not a
 * pattern match on a name. Null for anyone who is not a federal legislator,
 * and the key-votes column simply does not render for them: an entry is a
 * question each CHAMBER answered, and a mayor has no chamber.
 *
 * This exists so the chamber rule ("a House card shows House roll calls
 * only") has exactly one place it can be got wrong.
 */
export async function chamberForOfficeholder(
  id: string,
): Promise<"house" | "senate" | null> {
  const { officials } = await loaded();
  for (const holders of officials.values()) {
    for (const holder of holders) {
      if (holder.id !== id) continue;
      if (holder.officeTitle === "U.S. Senator") return "senate";
      if (holder.officeTitle === "U.S. Representative") return "house";
      return null;
    }
  }
  return null;
}

/**
 * **Who holds this division's seats — keyed by the DIVISION, not by the
 * reader** (M112, 2026-08-16).
 *
 * `coverageAt` answers "who represents this point", and its `seats` array is
 * point-scoped by construction: it carries only the divisions containing the
 * reader. The district battlecard resolved against that array, so opening any
 * OTHER drawn district on the map produced an empty list — and the empty list
 * rendered as OUR gap. State House District 21 told a reader in District 20
 * that we hold no officeholder for it, over Consuelo Hernandez and Stephanie
 * Stahl Hamilton, both in the index the same page had already loaded.
 *
 * The scope limit was real; the sentence about it was false. This function is
 * the resolution the sentence was standing in for: the index is keyed by
 * OCD-ID, so a division is answerable whether or not the reader is in it.
 * Same store, same rows, same sourcing — no new data.
 *
 * An empty return here is a REAL absence: we asked the store by the
 * division's own key and it holds nobody.
 */
export async function seatHoldersForDivision(
  ocdId: string,
): Promise<SeatHolder[]> {
  const { officials } = await loaded();
  return holdersFor(officials, ocdId);
}

export async function coverageAt(
  lat: number,
  lng: number,
  meetingCount: number,
  /**
   * The divisions covering this same point, when the caller already has them
   * (AUD-04, 2026-08-18) — `/api/meetings` resolves them for its online-meeting
   * filter and used to pay for the identical sweep a second time here.
   *
   * MUST be the result of resolving THIS lat/lng and nothing else: handing in
   * another point's divisions would answer confidently about somewhere the
   * reader is not. Omitted, this resolves them itself as it always did, which
   * is also what a caller whose own resolution FAILED must do — passing an
   * empty set from a failed lookup would turn a retrieval failure into a
   * coverage answer of "nothing governs here", and a failed fetch may never be
   * written into the data as an absence.
   */
  resolvedDivisions?: Division[],
): Promise<CoverageSummary> {
  const { features, divisionsById, registry, officials } = await loaded();
  return summarizeCoverage(
    [lng, lat],
    features,
    divisionsById,
    registry.bodies,
    meetingCount,
    officials,
    resolvedDivisions,
  );
}
