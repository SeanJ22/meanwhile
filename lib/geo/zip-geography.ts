/**
 * WHERE A ZIP ACTUALLY IS, ESTABLISHED OUTSIDE ANY ENUMERATION — RULING 67.
 * (The ruling is the author's, NH/NJ Hunt series; this module is NJ Hunt 2
 * item 2, written 2026-08-22.)
 *
 * `pnpm zip:universe 07866` enumerated NEW HAMPSHIRE for a New Jersey zip,
 * reported a Morris County township's official universe as one unit — the
 * Nashua City School District, 350 km away — and **reconciled cleanly while
 * doing it**. `pnpm twig:pair` then printed its pair under it, and every number
 * agreed with every other number.
 *
 * That is the most dangerous shape in this project, because every instrument
 * here is built on reconciliation. An internal consistency check cannot detect
 * an internally consistent wrong answer: the enumeration decided which state to
 * read, then checked its own arithmetic against the rows it had read.
 *
 * So the geography a run measures against is established HERE, from files the
 * enumeration does not read to decide what to enumerate, and the enumeration is
 * required to state what it resolved to and to FAIL when the two disagree.
 *
 * ── THE WITNESSES, AND WHY THEY COUNT AS INDEPENDENT ────────────────────────
 *
 * RULING 52 counts independence over DISTINCT DEPENDENCIES, never over names.
 * Two routes that fail for the same reason are one route wearing two names, and
 * two files published by one office off one source table are one witness
 * wearing two names.
 *
 *  1. **TIGER state outlines** — `public/geo/state-outlines.geojson`, a Census
 *     cartographic boundary product. The ZCTA internal point is tested against
 *     the polygons. This is GEOMETRY and depends on no name matching at all.
 *
 *  2. **The NCES Common Core of Data LEA directory** — a DEPARTMENT OF
 *     EDUCATION publication, not a Census one, carrying `location_state` beside
 *     `location_zip` for every school district in the country. Where a district
 *     sits in the queried zip it is a second publisher saying which state that
 *     zip is in, and it reaches that answer through mailing addresses rather
 *     than through geometry.
 *
 * A witness with nothing to say is reported UNAVAILABLE. It is never counted as
 * agreement and never as disagreement — 03255 (Newbury, NH) has no LEA at all,
 * and reading that silence either way would be inventing a measurement.
 *
 * ── SCOPE IS OURS, NEVER THEIRS ────────────────────────────────────────────
 *
 * `state-outlines.geojson` holds THREE states and `county-us.geojson` THREE
 * counties, because that is what this repo has committed. A zip outside them
 * resolves `out-of-scope`, which says something about our files and nothing
 * whatsoever about the zip. The playbook's own rule: a scope-limited resolver
 * states OUR scope, never THEIR absence.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { lookupZcta } from "./zcta.ts";
import { parseCsv } from "../reference/index.ts";
// NH79: one even-odd implementation for the whole repo. Four copies of this
// arithmetic existed, and a ray-casting bug returns a WRONG answer rather than
// throwing — a confident claim about which government covers a reader's street.
import { containsPoint, type RingGeometry } from "./polygon.ts";

type Geom = RingGeometry;

const contains = (point: [number, number], geom: Geom): boolean =>
  containsPoint(point, geom);

function readJson<T>(rel: string): T {
  return JSON.parse(readFileSync(join(process.cwd(), rel), "utf8")) as T;
}

export type Witness = {
  /** The publisher this witness depends on. Independence is counted over these. */
  through: string;
  file: string;
  /** Two-letter state, or null when this witness has nothing to say about this zip. */
  says: string | null;
  detail: string;
};

export type ZipGeography =
  | {
      ok: true;
      zip: string;
      lat: number;
      lng: number;
      /** Two-digit state FIPS, from geometry. */
      stateFips: string;
      /** Two-letter postal abbreviation, from geometry. */
      stateAbbr: string;
      stateName: string;
      /**
       * Five-digit county FIPS, or null when the committed county layer does
       * not cover this point. Null is a gap in OUR layer, never a fact about
       * the zip.
       */
      countyFips: string | null;
      countyName: string | null;
      witnesses: Witness[];
      /** Witnesses that spoke and agreed with the geometry. */
      agreed: number;
      /** Witnesses with nothing to say. Never counted either way. */
      unavailable: number;
    }
  | { ok: false; zip: string; reason: "malformed" | "unknown-zcta" | "out-of-scope"; detail: string };

/**
 * Where this zip is, according to files no enumeration in this repo reads in
 * order to decide what to enumerate.
 *
 * Throws only on a witness DISAGREEMENT, because two federal publishers
 * contradicting each other about a zip is a finding and must not be swallowed
 * by a resolver picking a favourite.
 */
export function resolveZipGeography(zipInput: string): ZipGeography {
  const zip = zipInput.trim();
  if (!/^\d{5}$/.test(zip)) {
    return { ok: false, zip, reason: "malformed", detail: "not five digits" };
  }
  const centroid = lookupZcta(zip);
  if (!centroid) {
    return {
      ok: false,
      zip,
      reason: "unknown-zcta",
      detail: "no ZCTA internal point committed for this zip in lib/geo/zcta-centroids.json",
    };
  }
  const point: [number, number] = [centroid.lng, centroid.lat];

  const outlines = readJson<{
    features: { properties: Record<string, string>; geometry: Geom }[];
  }>("public/geo/state-outlines.geojson");
  const stateHit = outlines.features.find((f) => contains(point, f.geometry));
  if (!stateHit) {
    return {
      ok: false,
      zip,
      reason: "out-of-scope",
      detail:
        `(${centroid.lat}, ${centroid.lng}) is inside none of the ${outlines.features.length} state ` +
        "outline(s) committed here — " +
        outlines.features.map((f) => f.properties.name).join(", ") +
        ". That is the scope of OUR committed geometry, and says nothing about the zip.",
    };
  }
  const stateFips = String(stateHit.properties.statefp ?? "");
  const stateName = String(stateHit.properties.name ?? "");
  const stateAbbr = abbrFromOcd(String(stateHit.properties.ocdId ?? ""));

  const counties = readJson<{
    features: { properties: Record<string, string>; geometry: Geom }[];
  }>("public/geo/county-us.geojson");
  const countyHit = counties.features.find((f) => contains(point, f.geometry));
  const countyFips = countyHit ? String(countyHit.properties.geoid ?? "") : null;
  const countyName = countyHit ? String(countyHit.properties.label ?? "") : null;

  const witnesses: Witness[] = [
    {
      through: "U.S. Census Bureau — TIGER cartographic boundaries",
      file: "public/geo/state-outlines.geojson",
      says: stateAbbr,
      detail: `the ZCTA internal point falls inside the ${stateName} polygon`,
    },
    ncesWitness(zip),
  ];

  /*
   * ── A ZIP CAN GENUINELY STRADDLE A STATE LINE ──────────────────────────
   * (found on the first national sweep, 2026-08-22.)
   *
   * ZIP 86044 (Tonalea, Arizona) sits on the Navajo Nation, whose territory
   * crosses into Utah, and the NCES directory records school districts in BOTH
   * states at that zip. The first version of this treated that as a
   * contradiction and refused to enumerate anything.
   *
   * It is not a contradiction. A witness naming several states, one of which is
   * the geometry's answer, CORROBORATES the geometry — it says "yes, Arizona,
   * and also Utah". A witness disagrees only when the geometry's state is
   * ABSENT from what it names. Reading a straddling zip as a conflict would have
   * stopped this project enumerating real places on a real reservation, which is
   * a worse error than the one the check was written to catch.
   */
  const spoke = witnesses.filter((w) => w.says !== null);
  const disagreeing = spoke.filter((w) => !w.says!.split("/").includes(stateAbbr));
  if (disagreeing.length > 0) {
    throw new Error(
      `ZIP ${zip} — the independent witnesses DISAGREE about which state this is, and that is a finding rather ` +
        `than something to settle by preference. Geometry says ${stateAbbr}; ` +
        disagreeing.map((w) => `${w.file} says ${w.says} (${w.detail})`).join("; ") +
        ". Nothing may be enumerated against this zip until a person rules on it.",
    );
  }

  return {
    ok: true,
    zip,
    lat: centroid.lat,
    lng: centroid.lng,
    stateFips,
    stateAbbr,
    stateName,
    countyFips,
    countyName,
    witnesses,
    agreed: spoke.length,
    unavailable: witnesses.length - spoke.length,
  };
}

function abbrFromOcd(ocdId: string): string {
  const m = /state:([a-z]{2})/.exec(ocdId);
  return m ? m[1]!.toUpperCase() : "";
}

let ncesIndex: Map<string, Set<string>> | null = null;

/**
 * The Department of Education's own answer to "which state is this zip in".
 *
 * Both the LOCATION zip and the MAILING zip are read, because a district's
 * mailing address is frequently a PO box in the same town and dropping it loses
 * the witness for a zip that has one. Every state seen for a zip is kept — if a
 * zip genuinely spans a state line the directory will say so, and that is a
 * disagreement a person should see rather than a tie this code breaks.
 */
function ncesWitness(zip: string): Witness {
  const file = "data/reference/nces_ccd_lea_directory_2025_26.csv";
  const through = "U.S. Department of Education — NCES Common Core of Data";
  if (!ncesIndex) {
    const index = new Map<string, Set<string>>();
    const rows = parseCsv(readFileSync(join(process.cwd(), file), "utf8"));
    const header = rows[0] ?? [];
    const pairs: Array<readonly [number, number]> = [
      [header.indexOf("location_zip"), header.indexOf("location_state")],
      [header.indexOf("mailing_zip"), header.indexOf("mailing_state")],
    ];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i]!;
      for (const [iz, is] of pairs) {
        if (iz < 0 || is < 0) continue;
        const z = String(r[iz] ?? "").trim().slice(0, 5);
        const s = String(r[is] ?? "").trim().toUpperCase();
        if (!/^\d{5}$/.test(z) || !/^[A-Z]{2}$/.test(s)) continue;
        const set = index.get(z) ?? new Set<string>();
        set.add(s);
        index.set(z, set);
      }
    }
    if (index.size === 0) {
      throw new Error(
        `${file} yielded NO zip-to-state rows. A parser that returns nothing has told you about itself, not ` +
          "about the document — this is a failed read, not a directory without addresses.",
      );
    }
    ncesIndex = index;
  }
  const seen = ncesIndex.get(zip);
  if (!seen || seen.size === 0) {
    return {
      through,
      file,
      says: null,
      detail:
        "no school district in the directory records an address in this zip — UNAVAILABLE, which is neither " +
        "agreement nor disagreement",
    };
  }
  const states = [...seen].sort();
  return {
    through,
    file,
    says: states.length > 1 ? states.join("/") : states[0]!,
    detail:
      states.length > 1
        ? `the directory records districts in ${states.join(" and ")} at this zip`
        : "a school district in the directory records an address in this zip",
  };
}

export type EnumerationClaim = {
  /** What the enumeration says it read. */
  stateFips: string;
  countyFips?: string | null;
  /** The tool making the claim, named so a failure says who was wrong. */
  by: string;
};

/**
 * RULING 67, made executable.
 *
 * An enumeration passes the geography it resolved and this compares it with the
 * witnesses above. Disagreement THROWS: a run that has read the wrong state's
 * file must stop rather than print a caveat, because everything downstream of
 * it will reconcile.
 */
export function assertEnumerationGeography(zip: string, claim: EnumerationClaim): ZipGeography {
  const truth = resolveZipGeography(zip);
  if (!truth.ok) {
    throw new Error(
      `${claim.by} cannot be geography-checked for ${zip}: ${truth.reason} — ${truth.detail}. ` +
        "RULING 67 requires an external check before an enumeration is trusted, so this run is stopping.",
    );
  }
  if (claim.stateFips !== truth.stateFips) {
    throw new Error(
      `${claim.by} enumerated state FIPS ${claim.stateFips} for ${zip}, and ${zip} is in ` +
        `${truth.stateName} (FIPS ${truth.stateFips}). ` +
        truth.witnesses
          .filter((w) => w.says !== null)
          .map((w) => `${w.through} says ${w.says}`)
          .join("; ") +
        ". This is the self-reconciling wrong answer RULING 67 was adopted over: the arithmetic would have " +
        "agreed with itself about the wrong state.",
    );
  }
  if (claim.countyFips && truth.countyFips && claim.countyFips !== truth.countyFips) {
    throw new Error(
      `${claim.by} enumerated county FIPS ${claim.countyFips} for ${zip}, and the committed county layer ` +
        `places ${zip} in ${truth.countyName} County (${truth.countyFips}).`,
    );
  }
  return truth;
}

/** One line a tool prints so a reader of its output can see what was checked. */
export function geographyLine(truth: ZipGeography): string {
  if (!truth.ok) return `geography for ${truth.zip}: ${truth.reason} — ${truth.detail}`;
  return (
    `geography for ${truth.zip}, established OUTSIDE this enumeration (RULING 67): ` +
    `${truth.stateName} (FIPS ${truth.stateFips})` +
    (truth.countyFips
      ? `, ${truth.countyName} County (${truth.countyFips})`
      : ", county not in the committed layer") +
    ` · ${truth.agreed} independent witness(es) agreed, ${truth.unavailable} had nothing to say`
  );
}
