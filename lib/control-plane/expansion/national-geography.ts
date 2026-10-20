import { FIPS_TO_STATE, districtIdentity } from "../../ocd/fips.ts";
import { countyIdentity, legislativeIdentity, placeIdentity, schoolIdentity, stateBase, subdivisionIdentity } from "../../ocd/divisions.ts";
import { loadPublishedAreaLookupState } from "../../census-geography/area-lookup.ts";
import type { PublishedLookupState } from "../../census-geography/reader.ts";
import { censusWorkDivision } from "../../census-geography/division-id.ts";
import { US_STATES } from "../readiness/catalog.ts";
import { politeGetText } from "../../sources/http.ts";
import { currentRepresentationSelection, selectGeographyVersion, type GeographySelection } from "../../census-geography/selection.ts";

const TIGER = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb";
type Polygon = { rings: number[][][]; spatialReference?: { wkid: number } };
type Feature = { attributes: Record<string, string | number>; geometry?: Polygon; sourceUrl?: string };
type Layer = { id: number; name: string; type: string };

/** Let admitted requests finish saving their responses before the caller
 * closes its Attempt, including when another request reaches a host bound. */
async function savedResponses<T>(requests: Promise<T>[]): Promise<T[]> {
  const results = await Promise.allSettled(requests);
  const failed = results.find(result => result.status === "rejected");
  if (failed?.status === "rejected") throw failed.reason;
  return results.map(result => (result as PromiseFulfilledResult<T>).value);
}
export interface GeographyReadOptions {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  /** The acquisition caller saves source bytes in its ordinary evidence store. */
  capture?: (sourceUrl: string, text: string) => Promise<void>;
  /** Reuse the same saved response without advancing its observation time. */
  readHeld?: (sourceUrl: string) => Promise<string | null>;
  congress?: number;
  legislativeYear?: number;
  selection?: GeographySelection;
  /** Promoted geography is read before any national API request. */
  readPublished?: (zip: string) => Promise<readonly PlaceDivision[]>;
}

export async function heldDivisionsForZip(zip: string, published?: PublishedLookupState, selection: GeographySelection = currentRepresentationSelection()): Promise<PlaceDivision[]> {
  if (!published && !process.env.DATABASE_URL) return [];
  const state = published ?? await loadPublishedAreaLookupState([zip]);
  if (state.source !== "published") return [];
  const result = await state.lookup.groupingsForZcta(zip);
  if (result.status.kind !== "OK") return [];
  const out: PlaceDivision[] = [];
  const types: Record<string, string> = { congressional_district: "cd", state_leg_upper: "sldu", state_leg_lower: "sldl", county: "county", place: "place", county_subdivision: "cousub" };
  const versions = await state.lookup.listVersions();
  for (const membership of result.memberships) {
    const type = types[membership.geography.type];
    if (["cd", "sldu", "sldl"].includes(type)) {
      const selected = selectGeographyVersion(versions, membership.geography.type, selection, membership.geography.stateAbbr);
      if (!selected || membership.geography.version !== selected.key) continue;
    }
    const base = stateBase(membership.geography.stateFips);
    // The held Census builder prepends the postal abbreviation for display.
    // It is not part of the source county name or the division's identity.
    const countyLabel = membership.geography.label.split(",")[0];
    const countyName = base && countyLabel.startsWith(`${base.postal} `)
      ? countyLabel.slice(base.postal.length + 1) : countyLabel;
    const id = censusWorkDivision(membership.geography) ?? (type === "county"
      ? countyIdentity(membership.geography.stateFips, countyName.replace(/\s+(County|Parish|Borough|Census Area)$/i, ""))?.ocdId : null);
    if (!type || !id) continue;
    const version = versions.find(v => v.key === membership.geography.version);
    // Local memberships locate work; current source rows still supply their
    // governing functional status before the place hunt publishes bodies.
    out.push({ id, label: membership.geography.label, divisionType: type, geoid: membership.geography.geoid,
      ...(!["place", "cousub"].includes(type) && version?.retrievalComplete === true ? { completeForZip: zip } : {}),
      zctaOverlap: { whole: membership.whole, fraction: membership.fraction, fractionBasis: membership.fractionBasis },
      sourceUrl: version?.provenance.sourceUrls[0] ?? "https://www2.census.gov/geo/docs/maps-data/data/rel2020/" });
    if (base) out.push({ id: base.base, label: US_STATES.find(s => s.code === base.postal.toLowerCase())?.name ?? base.postal, divisionType: "state", geoid: membership.geography.stateFips, completeForZip: zip,
      sourceUrl: out.at(-1)!.sourceUrl });
  }
  if (out.length) out.push({ id: "ocd-division/country:us", label: "United States", divisionType: "country", geoid: "US", sourceUrl: out[0].sourceUrl });
  return [...new Map(out.map(d => [d.id, d])).values()];
}
export interface PlaceDivision {
  id: string;
  label: string;
  divisionType: string;
  geoid: string;
  sourceUrl: string;
  sourceDataset?: "TIGERWEB_CURRENT";
  zctaOverlap?: { whole: boolean; fraction: number | null; fractionBasis: string };
  boundary?: Polygon;
  /** The published lookup or a complete polygon query supplied this ZIP's layer.
   * A held member alone never establishes that every split district is held. */
  completeForZip?: string;
  /** Preserve the three independent Census school layers behind the reader's school type. */
  censusLayer?: string;
  lsad?: string;
  funcstat?: string;
  classfp?: string;
}

async function readJson<T>(url: string, options: GeographyReadOptions, body?: URLSearchParams, captureUrl = url): Promise<T> {
  const held = await options.readHeld?.(captureUrl);
  if (held !== null && held !== undefined) return JSON.parse(held) as T;
  const response = await politeGetText(url, { accept: "application/json", signal: options.signal ?? AbortSignal.timeout(60_000),
    fetchImpl: (address, init) => (options.fetchImpl ?? fetch)(address, { ...init, ...(body ? { method: "POST", body } : {}) }) });
  const text = response.text;
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
  const selection = options.selection ?? currentRepresentationSelection();
  const available = [
    { key: "cd:119", type: "congressional_district" as const },
    { key: "cd:120", type: "congressional_district" as const },
    { key: "sldu:2024", type: "state_leg_upper" as const },
    { key: "sldl:2024", type: "state_leg_lower" as const },
  ];
  const congressional = selectGeographyVersion(available, "congressional_district", selection);
  const upper = selectGeographyVersion(available, "state_leg_upper", selection);
  const congress = options.congress ?? (congressional ? Number(congressional.key.split(":")[1]) : null);
  const vintage = options.legislativeYear ?? (upper ? Number(upper.key.split(":")[1]) : null);
  const selected: { type: string; name: RegExp }[] = [];
  if (congress !== null) selected.push({ type: "cd", name: new RegExp(`^${congress}(?:th|st|nd|rd) Congressional Districts$`) });
  if (vintage !== null) selected.push(
    { type: "sldu", name: new RegExp(`^${vintage} State Legislative Districts - Upper$`) },
    { type: "sldl", name: new RegExp(`^${vintage} State Legislative Districts - Lower$`) });
  return savedResponses(selected.map(async row => ({ type: row.type, url: await layer("Legislative", row.name, options) })));

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
  const school = ["unsd", "elsd", "scsd"].includes(type);
  const id = school ? `${stateBase(state)!.base}/school_district:${type}_${String(a.GEOID)}` : identity.ocdId;
  return { id, label: String(a.NAME ?? name), divisionType: school ? "school" : type, geoid: String(a.GEOID ?? ""), sourceUrl, sourceDataset: "TIGERWEB_CURRENT", boundary: feature.geometry, lsad, funcstat, classfp };
}

/** Download any state's serving legislative boundaries without a state dossier. */
export async function loadStateDistrictBoundaries(state: string, options: GeographyReadOptions = {}): Promise<PlaceDivision[]> {
  const fips = stateFips(state);
  if (!fips) throw new Error("Unknown US state or territory");
  const layers = await legislativeLayers(options);
  return (await savedResponses(layers.map(async l => (await query(l.url, { where: `STATE='${fips}'` }, options))
    .flatMap(f => division(f, l.type, l.url) ?? [])))).flat();
}

/** Every polygon intersecting a ZCTA, never a centroid's one district. */
export async function divisionsForZip(zip: string, options: GeographyReadOptions = {}): Promise<PlaceDivision[]> {
  if (!/^\d{5}$/.test(zip)) throw new Error("A five-digit ZIP is required");
  const held = await (options.readPublished ? options.readPublished(zip) : heldDivisionsForZip(zip, undefined, options.selection));
  const heldTypes = new Set(held.filter(d => d.completeForZip === zip).map(d => d.censusLayer ?? d.divisionType));
  const zipLayer = await layer("PUMA_TAD_TAZ_UGA_ZCTA", /^2020 Census ZIP Code Tabulation Areas$/, options);
  const [area] = await query(zipLayer, { where: `ZCTA5='${zip}'` }, options);
  if (!area?.geometry) throw new Error("This ZIP has no Census ZCTA boundary; an address is needed");
  const layers = heldTypes.has("cd") && heldTypes.has("sldu") && heldTypes.has("sldl") ? [] :
    (await legislativeLayers(options)).filter(l => !heldTypes.has(l.type));
  const additional = [
    { type: "state", service: "State_County", name: /^States$/ },
    { type: "county", service: "State_County", name: /^Counties$/ },
    { type: "place", service: "Places_CouSub_ConCity_SubMCD", name: /^Incorporated Places$/ },
    { type: "cousub", service: "Places_CouSub_ConCity_SubMCD", name: /^County Subdivisions$/ },
    { type: "unsd", service: "School", name: /^Unified School Districts$/ },
    { type: "elsd", service: "School", name: /^Elementary School Districts$/ },
    { type: "scsd", service: "School", name: /^Secondary School Districts$/ },
  ];
  layers.push(...await savedResponses(additional.filter(l => !heldTypes.has(l.type)).map(async l => ({ type: l.type, url: await layer(l.service, l.name, options) }))));
  const states = [...new Set(held.filter(d => d.divisionType === "state" && d.completeForZip === zip).map(d => d.geoid).filter(id => /^\d{2}$/.test(id)))];
  const stateLayer = layers.find(l => l.type === "state");
  const stateFeatures = stateLayer ? await query(stateLayer.url, spatial(area.geometry), options) : [];
  for (const feature of stateFeatures) {
    const state = String(feature.attributes.STATE ?? feature.attributes.STATEFP ?? feature.attributes.GEOID);
    if (/^\d{2}$/.test(state) && !states.includes(state)) states.push(state);
  }
  if (!states.length) throw new Error("Census returned no state for this ZIP boundary");
  const withinState: Record<string, string> = states.length ? { where: `STATE IN (${states.map(id => `'${id}'`).join(",")})` } : {};
  const readings = await savedResponses(layers.filter(l => l.type !== "state").map(async l => ({ ...l, features: (await query(l.url,
    { ...spatial(area.geometry!), ...withinState }, options)).filter(feature => !states.length ||
      states.includes(String(feature.attributes.STATE ?? feature.attributes.STATEFP))) })));
  if (stateLayer) readings.push({ ...stateLayer, features: stateFeatures });
  const counties = new Map([...held.filter(d => d.divisionType === "county").map(d => [d.geoid, d.label] as const),
    ...readings.filter(l => l.type === "county").flatMap(l => l.features.map(f =>
    [String(f.attributes.GEOID), String(f.attributes.NAME ?? f.attributes.BASENAME)] as const))]);
  // Current subdivision boundaries can touch a county absent from the older
  // held ZIP relationship. Ask only for those missing parent identities.
  const missingCounties = [...new Set(readings.filter(l => l.type === "cousub").flatMap(l => l.features.map(f =>
    `${f.attributes.STATE ?? f.attributes.STATEFP}${f.attributes.COUNTY ?? f.attributes.COUNTYFP}`)))].filter(id => /^\d{5}$/.test(id) && !counties.has(id));
  if (missingCounties.length) {
    const endpoint = await layer("State_County", /^Counties$/, options);
    const features = await query(endpoint, { where: `GEOID IN (${missingCounties.map(id => `'${id}'`).join(",")})`, returnGeometry: "false" }, options);
    for (const feature of features) {
      counties.set(String(feature.attributes.GEOID), String(feature.attributes.NAME ?? feature.attributes.BASENAME));
      const row = division(feature, "county", endpoint);
      if (row) readings.push({ type: "county", url: endpoint, features: [feature] });
    }
  }
  const divisions = readings.flatMap(l => l.features.flatMap(f => {
    const row = division(f, l.type, l.url, counties);
    return row ? [{ ...row, censusLayer: l.type,
      ...(new URL(row.sourceUrl).searchParams.has("geometry") ? { completeForZip: zip } : {}) }] : [];
  }));
  return [...new Map([
    { id: "ocd-division/country:us", label: "United States", divisionType: "country", geoid: "US", sourceUrl: zipLayer },
    ...held.filter(row => !layers.some(layer => layer.type === (row.censusLayer ?? row.divisionType))), ...divisions,
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

/** All ZIP areas a congressional district, county or state touches. */
export async function zipsForPlace(place: { type: "congressional_district" | "county" | "state"; state: string; geoid: string }, options: GeographyReadOptions = {}): Promise<string[]> {
  const fips = stateFips(place.state);
  if (!fips || !/^\d+$/.test(place.geoid)) throw new Error("A Census state and GEOID are required");
  const source = place.type === "congressional_district" ? (await legislativeLayers(options)).find(l => l.type === "cd")?.url
    : await layer("State_County", place.type === "state" ? /^States$/ : /^Counties$/, options);
  if (!source) throw new Error("No source-qualified congressional plan for this purpose and date");
  const areas = await query(source, { where: place.type === "state" ? `STATE='${fips}'` : `GEOID='${place.geoid}' AND STATE='${fips}'` }, options);
  if (!areas.length) throw new Error("Census did not resolve the requested place");
  const zipLayer = await layer("PUMA_TAD_TAZ_UGA_ZCTA", /^2020 Census ZIP Code Tabulation Areas$/, options);
  const zips = (await savedResponses(areas.map(async area => {
    if (!area.geometry) throw new Error("Census returned a place without its boundary");
    return (await query(zipLayer, { ...spatial(area.geometry), returnGeometry: "false" }, options)).map(f => String(f.attributes.ZCTA5 ?? f.attributes.GEOID));
  }))).flat();
  return [...new Set(zips)].sort();
}
