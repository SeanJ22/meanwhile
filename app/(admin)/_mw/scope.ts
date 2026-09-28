/**
 * **THE ONE SCOPE BOTH AREAS OBEY.** (Admin redesign, 2026-09-23.)
 *
 * The design has a single scope filter in the header, shared by Fleet and
 * Readiness: change it in one area, switch areas, and the scope holds. It
 * travels in the URL (`?scope=`) so every link, tab and area switch carries it,
 * a page can be bookmarked at a scope, and the server renders the scoped
 * reading directly (no client-side re-derivation of a number).
 *
 * Three kinds of scope, in the order the header lists them:
 *
 * ```
 *   all        everywhere the product has registered coverage
 *   state      one state or territory (lower-case USPS code, e.g. "az")
 *   geography  one selected Census geography, including a five-digit ZCTA,
 *              carried as its exact lookup address
 * ```
 *
 * PURE: no I/O, no clock. The pages decide what each panel can narrow to and
 * say so in words when a panel cannot.
 */

export type MwArea = "fleet" | "readiness";

export type MwFleetTab = "now" | "work" | "money" | "learning" | "fix";
export type MwReadinessTab = "readiness" | "work" | "cost" | "done" | "fix";
export type MwTab = MwFleetTab | MwReadinessTab;

/** A Census container type the scope filter can carry. */
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

/** The URL value for a scope. `all` is the absence of the parameter. */
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

/**
 * Read a scope from the URL. Anything unreadable is `all` — never a guess at
 * what the owner meant — and the page's strip then says it is showing
 * everywhere.
 */
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

/** The state a scope sits inside, or null for everywhere. */
export function scopeState(scope: MwScope): string | null {
  return scope.kind === "all" ? null : scope.state;
}

/** Append the scope to a path, keeping any other query the link already has. */
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

/** The tabs each area shows, in the design's order and with its words. */
export const FLEET_TABS: readonly { readonly id: MwFleetTab; readonly label: string; readonly path: string }[] = [
  { id: "now", label: "Now", path: "/admin" },
  { id: "work", label: "Work", path: "/admin/work" },
  { id: "money", label: "Money", path: "/admin/money" },
  { id: "learning", label: "Is it learning", path: "/admin/learning" },
  { id: "fix", label: "Fix list", path: "/admin/fix" },
];

export const READINESS_TABS: readonly { readonly id: MwReadinessTab; readonly label: string; readonly path: string }[] = [
  { id: "readiness", label: "Readiness", path: "/readiness" },
  { id: "work", label: "Work and instructions", path: "/readiness/work" },
  { id: "cost", label: "Cost", path: "/readiness/cost" },
  { id: "done", label: "What counts as done", path: "/readiness/done" },
  { id: "fix", label: "Fix list", path: "/readiness/fix" },
];

/**
 * Where each area's toggle lands. Switching areas keeps the scope; Readiness
 * opens on the state the scope sits in, or on all states.
 */
export function areaHome(area: MwArea, scope: MwScope): string {
  if (area === "fleet") return withScope("/admin", scope);
  const st = scopeState(scope);
  return withScope(st ? `/readiness/${st}` : "/readiness", scope);
}

export const GEO_TYPE_WORDS: Readonly<Record<MwGeoType, string>> = {
  zcta: "ZIP (Census ZCTA)",
  county: "County",
  congressional_district: "Congressional district",
  cbsa: "Metropolitan area",
  state_leg_upper: "State senate district",
  state_leg_lower: "State house district",
};

/** A Census container's label as the owner reads it: "Pima County", "CD 6". */
export function geographyShortLabel(label: string): string {
  return label
    .replace(/^Arizona |^New Hampshire |^New Jersey |^[A-Z]{2} /, "")
    .replace(/ \(119th Congress\)$/, "")
    .replace(/Congressional District (\d+)/, "CD $1");
}
