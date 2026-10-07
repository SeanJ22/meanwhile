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

export function scopeState(scope: MwScope): string | null {
  return scope.kind === "all" ? null : scope.state;
}

export function withScope(path: string, scope: MwScope, extra?: Readonly<Record<string, string | null | undefined>>): string {
  // A fragment belongs after the query, where the browser reads it: split it off first and put it back last.
  const hashAt = path.indexOf("#");
  const fragment = hashAt < 0 ? "" : path.slice(hashAt);
  const beforeHash = hashAt < 0 ? path : path.slice(0, hashAt);
  const [base, query = ""] = beforeHash.split("?");
  const params = new URLSearchParams(query);
  const s = scopeParam(scope);
  if (s !== null) params.set("scope", s);
  else params.delete("scope");
  for (const [k, v] of Object.entries(extra ?? {})) {
    if (v === null || v === undefined || v === "") params.delete(k);
    else params.set(k, v);
  }
  const q = params.toString();
  return `${q === "" ? base : `${base}?${q}`}${fragment}`;
}

export const GEO_TYPE_WORDS: Readonly<Record<MwGeoType, string>> = {
  zcta: "ZIP (Census ZCTA)",
  county: "County",
  congressional_district: "Congressional district",
  cbsa: "Metropolitan area",
  state_leg_upper: "State senate district",
  state_leg_lower: "State house district",
};

/** A Census container's label as the owner reads it, e.g. "<Name> County", "CD 6". */
export function geographyShortLabel(label: string): string {
  return label
    .replace(/^Arizona |^New Hampshire |^New Jersey |^[A-Z]{2} /, "")
    .replace(/ \(119th Congress\)$/, "")
    .replace(/Congressional District (\d+)/, "CD $1");
}
