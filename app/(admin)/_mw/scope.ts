/**
 * The scope travels in the URL (`?scope=`):
 *
 *   all        everywhere (the absence of the parameter)
 *   state      one state or territory, lower-case USPS code
 *   geography  one Census geography, including a five-digit ZCTA, carried as its exact lookup address
 */

export type MwGeoType = "zcta" | "county" | "congressional_district" | "cbsa" | "state_leg_upper" | "state_leg_lower";

const GEO_SHORT: Readonly<Record<MwGeoType, string>> = {
  zcta: "zcta",
  county: "county",
  congressional_district: "cd",
  cbsa: "cbsa",
  state_leg_upper: "sldu",
  state_leg_lower: "sldl",
};
const GEO_FROM_SHORT: Readonly<Record<string, MwGeoType>> = Object.fromEntries(
  Object.entries(GEO_SHORT).map(([type, short]) => [short, type as MwGeoType]),
);

export type MwScope =
  | { readonly kind: "all" }
  | { readonly kind: "state"; readonly state: string }
  | { readonly kind: "geo"; readonly type: MwGeoType; readonly geoid: string; readonly state: string };

export const SCOPE_ALL: MwScope = { kind: "all" };

export function scopeParam(scope: MwScope): string | null {
  switch (scope.kind) {
    case "all":
      return null;
    case "state":
      return scope.state;
    case "geo":
      return `${scope.state}.${GEO_SHORT[scope.type]}.${scope.geoid}`;
  }
}

/** Anything unreadable is `all`, never a guess. */
export function parseScope(raw: string | string[] | undefined | null): MwScope {
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim().toLowerCase() ?? "";
  if (value === "" || value === "all") return SCOPE_ALL;
  if (/^[a-z]{2}$/.test(value)) return { kind: "state", state: value };
  const m = /^([a-z]{2})\.([a-z]+)\.([0-9a-z]{1,16})$/.exec(value);
  if (m) {
    const type = GEO_FROM_SHORT[m[2]];
    if (type && (type !== "zcta" || /^\d{5}$/.test(m[3]))) return { kind: "geo", type, geoid: m[3], state: m[1] };
  }
  return SCOPE_ALL;
}

