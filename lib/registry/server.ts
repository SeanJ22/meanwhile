import { readFile, readdir } from "node:fs/promises";
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
   * Every district file in `public/geo`, and nothing else.
   *
   * The directory grew a non-district member in g3: `state-outlines.geojson`,
   * a GENERALIZED state boundary that exists only to decide which pixels the
   * state-focus effect mutes. A blanket `*.geojson` sweep would have loaded
   * it into the resolver alongside the cartographic boundaries and let a
   * half-kilometre-accurate outline answer a question about who governs a
   * point — which is precisely what its own header says it must never do.
   *
   * An allow-list would rot the other way (a new district type silently
   * absent). So the rule is stated as an exclusion, named, with the reason
   * attached to the name.
   */
  const NOT_DISTRICT_GEOMETRY = new Set(["state-outlines.geojson"]);
  const names = (await readdir(geoDir)).filter(
    (n) => n.endsWith(".geojson") && !NOT_DISTRICT_GEOMETRY.has(n),
  );
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
