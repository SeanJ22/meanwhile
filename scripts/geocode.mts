/**
 * **TWO INDEPENDENT GEOCODERS, RECONCILED** (built 2026-08-21, NH Hunt 6 item 4
 * — RULING 52, and the pair rule).
 *
 * ```
 * pnpm geocode "93 Main Street, Sutton, NH 03221" [--json]
 * ```
 *
 * ## The wall this brings down
 *
 * Sutton's eighteen bodies have sat dark since NH Hunt 4. The retrieval was
 * never the problem: the CivicPlus calendar exports 1,312 events naming all
 * eighteen, and NH Hunt 5 found the venue in prose on the board's own page —
 * *"The Sutton Planning Board meets at the Pillsbury Memorial Hall, 93 Main
 * Street, Sutton Mills, NH."* What stopped the wiring was a COORDINATE. The
 * Census geocoder was asked four ways and answered Bradford NH twice, Sutton
 * **Massachusetts** once, and no match once, and a venue cache row needs a
 * citable coordinate because a pin is a claim.
 *
 * One geocoder is one branch. RULING 52: a branch coming back wrong is one
 * measurement, never a verdict. So this walks a SECOND, genuinely independent
 * one — different operator, different data, different host — and reconciles.
 *
 * ## What the reconciliation actually found, and why it matters
 *
 * On 2026-08-21 the Census returned `43.334241, -71.953514` labelled **BRADFORD
 * NH**, and OpenStreetMap returned `43.334070, -71.953113` labelled **Sutton
 * Town Hall, 93 Main Street, Sutton, Merrimack County NH**. Those two points
 * are **twenty-three metres apart.** The Census coordinate was RIGHT the whole
 * time; only its CITY LABEL was wrong, because the TIGER address range 89–99
 * MAIN ST is attributed to Bradford. A session reading the label and discarding
 * the point threw away a correct answer — which is the shape this whole project
 * keeps finding, one layer down.
 *
 * So the output is a PAIR and never a single figure: both providers, both
 * labels, and the distance between them. Where they agree the point is
 * established twice over; where they disagree that is the finding and it
 * renders as one rather than being quietly resolved by preferring a provider.
 *
 * ## What it never does
 *
 * It never returns a coordinate without the URL that produced it — `VenueEntry`
 * requires `coordinateSourceUrl` because a pin is a claim about where a reader
 * should physically go. It never averages two disagreeing points into a third
 * that neither provider ever returned. And a zero-match from both is reported
 * as a failed geocode naming both providers, never as an empty answer.
 */
import { writeFileSync } from "node:fs";

const UA = "we-the-people civic data (contact: seanj22@gmail.com)";

export interface GeocodeHit {
  provider: "census" | "openstreetmap";
  lat: number;
  lng: number;
  /** What the provider says it matched — the label that can be wrong. */
  matched: string;
  /** The exact request URL. Citable, and what goes in `coordinateSourceUrl`. */
  url: string;
}

export interface GeocodeReport {
  address: string;
  hits: GeocodeHit[];
  /** Metres between the two providers, when both answered. */
  metresApart: number | null;
  verdict: "AGREED" | "DIVERGENT" | "ONE_PROVIDER_ONLY" | "NO_MATCH";
  note: string;
}

/** Great-circle metres. Two providers ten metres apart are the same door. */
export function metresBetween(a: GeocodeHit, b: GeocodeHit): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(s)));
}

async function census(address: string): Promise<GeocodeHit | null> {
  const url = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(address)}&benchmark=Public_AR_Current&format=json`;
  const res = await fetch(url, { headers: { "user-agent": UA } });
  if (!res.ok) return null;
  const body = (await res.json()) as {
    result?: { addressMatches?: { coordinates?: { x: number; y: number }; matchedAddress?: string }[] };
  };
  const m = body.result?.addressMatches?.[0];
  if (!m?.coordinates) return null;
  return {
    provider: "census",
    lat: m.coordinates.y,
    lng: m.coordinates.x,
    matched: m.matchedAddress ?? "(unlabelled)",
    url,
  };
}

/*
 * Nominatim answers a STRUCTURED query where the same address as free text
 * returns nothing. "Pillsbury Memorial Hall, Sutton Mills, New Hampshire" came
 * back empty as free text; `street=93 Main Street&city=Sutton&state=New
 * Hampshire` returned Sutton Town Hall. So both forms are walked, free text
 * first, and an empty free-text result is a FALSE MISS rather than an absence —
 * the same lesson rung 6 teaches one layer up.
 */
async function openstreetmap(address: string): Promise<GeocodeHit | null> {
  const forms = [`q=${encodeURIComponent(address)}`];
  const structured = /^\s*([^,]+),\s*([^,]+),\s*([A-Za-z. ]+?)\s*(\d{5}(-\d{4})?)?\s*$/.exec(
    address,
  );
  if (structured) {
    forms.push(
      `street=${encodeURIComponent(structured[1]!.trim())}&city=${encodeURIComponent(structured[2]!.trim())}&state=${encodeURIComponent(structured[3]!.trim())}&country=USA`,
    );
  }
  let url = "";
  let r: { lat: string; lon: string; display_name: string } | undefined;
  for (const form of forms) {
    url = `https://nominatim.openstreetmap.org/search?${form}&format=jsonv2&limit=1&addressdetails=1`;
    const probe = await fetch(url, { headers: { "user-agent": UA } });
    if (!probe.ok) continue;
    const rows = (await probe.json()) as { lat: string; lon: string; display_name: string }[];
    if (rows[0]) {
      r = rows[0];
      break;
    }
  }
  if (!r) return null;
  return {
    provider: "openstreetmap",
    lat: Number(r.lat),
    lng: Number(r.lon),
    matched: r.display_name,
    url,
  };
}

/**
 * Both providers, always. Neither short-circuits the other.
 *
 * Stopping at the first hit is what made this a one-branch problem: the Census
 * answered, its answer was believed, and its label sent a session away from a
 * correct point.
 */
export async function geocode(address: string): Promise<GeocodeReport> {
  const [c, o] = await Promise.all([
    census(address).catch(() => null),
    openstreetmap(address).catch(() => null),
  ]);
  const hits = [c, o].filter((h): h is GeocodeHit => h !== null);

  if (hits.length === 0) {
    return {
      address,
      hits,
      metresApart: null,
      verdict: "NO_MATCH",
      note: "both providers returned no match — a failed geocode, named, not an empty answer. Try a variant spelling, the building name, or the body's own map link.",
    };
  }
  if (hits.length === 1) {
    return {
      address,
      hits,
      metresApart: null,
      verdict: "ONE_PROVIDER_ONLY",
      note: `only ${hits[0]!.provider} answered. One provider is one branch, and one branch is a measurement — corroborate before shipping a pin.`,
    };
  }
  const apart = metresBetween(hits[0]!, hits[1]!);
  /*
   * 150 m is a building, a car park and a driveway. Beyond that the two
   * providers are describing different places and a session must look rather
   * than pick.
   */
  const agreed = apart <= 150;
  return {
    address,
    hits,
    metresApart: apart,
    verdict: agreed ? "AGREED" : "DIVERGENT",
    note: agreed
      ? `two independent providers agree to ${apart} m. Note the LABELS may still differ — a wrong city on a right point is the Sutton case, and the point is what a pin uses.`
      : `two independent providers are ${apart} m apart. That is the FINDING, and it is never resolved by preferring one. Open both and decide with the body's own published address in hand.`,
  };
}

/* ─────────────────────────────────── CLI ─────────────────────────────────── */

const invoked = process.argv[1]?.replace(/\\/g, "/").endsWith("geocode.mts");
if (invoked) {
  /* The value that follows a flag is NOT part of the address. */
  const argv = process.argv.slice(2);
  const words: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i]!.startsWith("--")) {
      i += 1;
      continue;
    }
    words.push(argv[i]!);
  }
  const address = words.join(" ");
  if (!address) {
    console.error('usage: pnpm geocode "<address>" [--json <file>]');
    process.exit(2);
  }
  const report = await geocode(address);
  console.log(`\nGEOCODE — ${address}\n`);
  for (const h of report.hits) {
    console.log(`  ${h.provider.padEnd(14)} ${h.lat.toFixed(6)}, ${h.lng.toFixed(6)}`);
    console.log(`  ${"".padEnd(14)} matched: ${h.matched}`);
    console.log(`  ${"".padEnd(14)} cite:    ${h.url}`);
  }
  console.log(
    `\n  ${report.verdict}${report.metresApart !== null ? ` — ${report.metresApart} m apart` : ""}`,
  );
  console.log(`  ${report.note}\n`);

  const jsonIdx = process.argv.indexOf("--json");
  if (jsonIdx >= 0 && process.argv[jsonIdx + 1]) {
    writeFileSync(process.argv[jsonIdx + 1]!, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  if (report.verdict === "NO_MATCH") process.exit(1);
}
