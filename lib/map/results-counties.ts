export interface CountyChoice {
  ocdId: string;
  /** "Pima", without the word County. */
  name: string;
  bounds: [[number, number], [number, number]];
}

interface CountyTileFeature { properties?: Record<string, unknown> | null }

/** One entry per county from the boundary tiles already loaded, sorted by name. A county drawn across several tiles counts once. */
export function countyChoices(features: readonly CountyTileFeature[]): CountyChoice[] {
  const byId = new Map<string, CountyChoice>();
  for (const { properties: p } of features) {
    const ocdId = String(p?.ocdId ?? ""), label = String(p?.label ?? "");
    const bounds = [p?.west, p?.south, p?.east, p?.north].map(Number);
    if (!ocdId || !label || !bounds.every(Number.isFinite) || byId.has(ocdId)) continue;
    byId.set(ocdId, { ocdId, name: label.replace(/\s+(County|Parish|Borough|Census Area|city)$/i, ""),
      bounds: [[bounds[0], bounds[1]], [bounds[2], bounds[3]]] });
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** A search box appears only when a state has more than this many counties. */
export const COUNTY_SEARCH_MIN = 10;

export function matchCounties(counties: readonly CountyChoice[], query: string): CountyChoice[] {
  const wanted = query.trim().toLowerCase();
  return wanted ? counties.filter(county => county.name.toLowerCase().includes(wanted)) : [...counties];
}

export const countyLabel = (county: CountyChoice) => `${county.name} County`;

/** The box around a state's outline, for fitting the camera to it. Parts east of the antimeridian (Alaska's Aleutians) count as west of it. */
export function outlineBounds(feature: { geometry: { coordinates: number[][][] } } | null): [[number, number], [number, number]] | null {
  if (!feature) return null;
  const points = feature.geometry.coordinates.flat();
  const lngs = points.map(([x]) => x), span = Math.max(...lngs) - Math.min(...lngs);
  const wrap = span > 180 ? (x: number) => x > 0 ? x - 360 : x : (x: number) => x;
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  for (const [x, y] of points) {
    west = Math.min(west, wrap(x)); east = Math.max(east, wrap(x)); south = Math.min(south, y); north = Math.max(north, y);
  }
  return Number.isFinite(west) && Number.isFinite(north) ? [[west, south], [east, north]] : null;
}
