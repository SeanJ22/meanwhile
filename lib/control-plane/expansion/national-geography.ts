import { FIPS_TO_STATE, districtIdentity } from "../../ocd/fips.ts";
import { countyIdentity, legislativeIdentity, placeIdentity, schoolIdentity, stateBase, subdivisionIdentity } from "../../ocd/divisions.ts";

const TIGER = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb";
type Polygon = { rings: number[][][]; spatialReference?: { wkid: number } };
type Feature = { attributes: Record<string, string | number>; geometry?: Polygon; sourceUrl?: string };
type Layer = { id: number; name: string; type: string };
export interface GeographyReadOptions {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  /** The acquisition caller saves source bytes in its ordinary evidence store. */
  capture?: (sourceUrl: string, text: string) => Promise<void>;
  congress?: number;
  legislativeYear?: number;
}
export interface PlaceDivision {
  id: string;
  label: string;
  divisionType: string;
  geoid: string;
  sourceUrl: string;
  sourceDataset?: "TIGERWEB_CURRENT";
  boundary?: Polygon;
  lsad?: string;
  funcstat?: string;
  classfp?: string;
}

async function readJson<T>(url: string, options: GeographyReadOptions, body?: URLSearchParams, captureUrl = url): Promise<T> {
  const response = await (options.fetchImpl ?? fetch)(url, {
    ...(body ? { method: "POST", body } : {}),
    signal: options.signal ?? AbortSignal.timeout(60_000),
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Geography source returned HTTP ${response.status}`);
  const text = await response.text();
  const value = JSON.parse(text);
  if (value.error) throw new Error(`Geography source: ${value.error.message ?? value.error.code}`);
  await options.capture?.(captureUrl, text);
  return value as T;
}

async function layer(service: string, pattern: RegExp, options: GeographyReadOptions): Promise<string> {
  const root = `${TIGER}/${service}/MapServer`;
  const metadata = await readJson<{ layers: Layer[] }>(`${root}?f=json`, options);
  const found = metadata.layers.find(l => l.type === "Feature Layer" && pattern.test(l.name));
  if (!found) throw new Error(`Census has no ${pattern.source} layer in ${service}`);
  return `${root}/${found.id}`;
}

async function query(endpoint: string, params: Record<string, string>, options: GeographyReadOptions): Promise<Feature[]> {
  const out: Feature[] = [];
  for (let offset = 0; ; offset += 1000) {
    const body = new URLSearchParams({ f: "json", outFields: "*", outSR: "4326", returnGeometry: "true",
      resultRecordCount: "1000", resultOffset: String(offset), ...params });
    const sourceUrl = `${endpoint}/query?${body}`;
    const page = await readJson<{ features: Feature[]; exceededTransferLimit?: boolean }>(`${endpoint}/query`, options, body, sourceUrl);
    if (!Array.isArray(page.features)) throw new Error("Census returned no feature collection");
    out.push(...page.features.map(feature => ({ ...feature, sourceUrl })));
    if (!page.exceededTransferLimit) return out;
    if (!page.features.length) throw new Error("Census paging stopped before the collection ended");
  }
}

const spatial = (boundary: Polygon) => ({ geometry: JSON.stringify(boundary), geometryType: "esriGeometryPolygon", inSR: "4326", spatialRel: "esriSpatialRelIntersects" });
const stateFips = (state: string) => Object.entries(FIPS_TO_STATE).find(([, entry]) => entry.postal === state.toUpperCase())?.[0];

async function legislativeLayers(options: GeographyReadOptions): Promise<{ type: string; url: string }[]> {
  const year = new Date().getUTCFullYear();
  const congress = options.congress ?? Math.floor((year - 1789) / 2) + 1;
  const vintage = options.legislativeYear ?? Math.floor((year - 1) / 2) * 2;
  return Promise.all([
    { type: "cd", name: new RegExp(`^${congress}(?:th|st|nd|rd) Congressional Districts$`) },
    { type: "sldu", name: new RegExp(`^${vintage} State Legislative Districts - Upper$`) },
    { type: "sldl", name: new RegExp(`^${vintage} State Legislative Districts - Lower$`) },
  ].map(async row => ({ type: row.type, url: await layer("Legislative", row.name, options) })));
}

function division(feature: Feature, type: string, sourceUrl: string, counties: ReadonlyMap<string, string> = new Map()): PlaceDivision | null {
  sourceUrl = feature.sourceUrl ?? sourceUrl;
  const a = feature.attributes;
  const state = String(a.STATE ?? a.STATEFP ?? "");
  const name = String(a.BASENAME ?? a.NAME ?? "");
  if (type === "state") {
    const identity = stateBase(state);
    return identity ? { id: identity.base, label: name, divisionType: type, geoid: String(a.GEOID ?? state), sourceUrl, sourceDataset: "TIGERWEB_CURRENT", boundary: feature.geometry } : null;
  }
  const lsad = String(a.LSAD ?? a.LSADC ?? ""), funcstat = String(a.FUNCSTAT ?? ""), classfp = String(a.CLASSFP ?? a.COUSUBCC ?? a.PLACECC ?? "");
  const countyName = type === "cousub" ? counties.get(`${state}${a.COUNTY}`) : undefined;
  if (type === "cousub" && !countyName) throw new Error(`Census subdivision ${a.GEOID} has no resolved parent county`);
  const identity = type === "cd" ? districtIdentity(state, String(a.CD ?? String(a.GEOID).slice(2)))
    : type === "sldu" || type === "sldl" ? legislativeIdentity(state, type, String(a[type.toUpperCase()] ?? String(a.GEOID).slice(2)), name)
    : type === "county" ? countyIdentity(state, name)
    : type === "place" ? placeIdentity(state, name, lsad, funcstat, classfp)
    : type === "cousub" ? subdivisionIdentity(state, countyName!, String(a.NAME ?? name), lsad, funcstat, classfp)
    : schoolIdentity(state, name);
  if (!identity) return null;
  return { id: identity.ocdId, label: String(a.NAME ?? name), divisionType: type, geoid: String(a.GEOID ?? ""), sourceUrl, sourceDataset: "TIGERWEB_CURRENT", boundary: feature.geometry, lsad, funcstat, classfp };
}

/** Download any state's serving legislative boundaries without a state dossier. */
export async function loadStateDistrictBoundaries(state: string, options: GeographyReadOptions = {}): Promise<PlaceDivision[]> {
  const fips = stateFips(state);
  if (!fips) throw new Error("Unknown US state or territory");
  const layers = await legislativeLayers(options);
  return (await Promise.all(layers.map(async l => (await query(l.url, { where: `STATE='${fips}'` }, options))
    .flatMap(f => division(f, l.type, l.url) ?? [])))).flat();
}

/** Every polygon intersecting a ZCTA, never a centroid's one district. */
export async function divisionsForZip(zip: string, options: GeographyReadOptions = {}): Promise<PlaceDivision[]> {
  if (!/^\d{5}$/.test(zip)) throw new Error("A five-digit ZIP is required");
  const zipLayer = await layer("PUMA_TAD_TAZ_UGA_ZCTA", /^2020 Census ZIP Code Tabulation Areas$/, options);
  const [area] = await query(zipLayer, { where: `ZCTA5='${zip}'` }, options);
  if (!area?.geometry) throw new Error("This ZIP has no Census ZCTA boundary; an address is needed");
  const layers = await legislativeLayers(options);
  const additional = [
    { type: "state", service: "State_County", name: /^States$/ },
    { type: "county", service: "State_County", name: /^Counties$/ },
    { type: "place", service: "Places_CouSub_ConCity_SubMCD", name: /^Incorporated Places$/ },
    { type: "cousub", service: "Places_CouSub_ConCity_SubMCD", name: /^County Subdivisions$/ },
    { type: "school", service: "School", name: /^Unified School Districts$/ },
    { type: "school", service: "School", name: /^Elementary School Districts$/ },
    { type: "school", service: "School", name: /^Secondary School Districts$/ },
  ];
  layers.push(...await Promise.all(additional.map(async l => ({ type: l.type, url: await layer(l.service, l.name, options) }))));
  const readings = await Promise.all(layers.map(async l => ({ ...l, features: await query(l.url, spatial(area.geometry!), options) })));
  const counties = new Map(readings.filter(l => l.type === "county").flatMap(l => l.features.map(f =>
    [String(f.attributes.GEOID), String(f.attributes.NAME ?? f.attributes.BASENAME)] as const)));
  const divisions = readings.flatMap(l => l.features.flatMap(f => division(f, l.type, l.url, counties) ?? []));
  return [...new Map([
    { id: "ocd-division/country:us", label: "United States", divisionType: "country", geoid: "US", sourceUrl: zipLayer },
    ...divisions,
  ].map(d => [d.id, d])).values()];
}

/** Google resolves an address; ZIP-only callers still need the polygon union above.
 * Submitted addresses and API keys are never included in returned provenance. */
export async function divisionsForAddress(address: string, apiKey: string, options: GeographyReadOptions = {}): Promise<{ id: string; label: string }[]> {
  const endpoint = "https://www.googleapis.com/civicinfo/v2/divisionsByAddress";
  const value = await readJson<{ divisions?: Record<string, { name: string }> }>(`${endpoint}?${new URLSearchParams({ address, key: apiKey })}`,
    { ...options, capture: undefined });
  return Object.entries(value.divisions ?? {}).map(([id, d]) => ({ id, label: d.name }));
}

/** S11 lookup: all ZIP areas a congressional district, county or state touches. */
export async function zipsForPlace(place: { type: "congressional_district" | "county" | "state"; state: string; geoid: string }, options: GeographyReadOptions = {}): Promise<string[]> {
  const fips = stateFips(place.state);
  if (!fips || !/^\d+$/.test(place.geoid)) throw new Error("A Census state and GEOID are required");
  const source = place.type === "congressional_district" ? (await legislativeLayers(options)).find(l => l.type === "cd")!.url
    : await layer("State_County", place.type === "state" ? /^States$/ : /^Counties$/, options);
  const areas = await query(source, { where: place.type === "state" ? `STATE='${fips}'` : `GEOID='${place.geoid}' AND STATE='${fips}'` }, options);
  if (!areas.length) throw new Error("Census did not resolve the requested place");
  const zipLayer = await layer("PUMA_TAD_TAZ_UGA_ZCTA", /^2020 Census ZIP Code Tabulation Areas$/, options);
  const zips = (await Promise.all(areas.map(async area => {
    if (!area.geometry) throw new Error("Census returned a place without its boundary");
    return (await query(zipLayer, { ...spatial(area.geometry), returnGeometry: "false" }, options)).map(f => String(f.attributes.ZCTA5 ?? f.attributes.GEOID));
  }))).flat();
  return [...new Set(zips)].sort();
}
