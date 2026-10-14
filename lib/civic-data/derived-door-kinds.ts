import type { AgendaSourceType } from "../registry/types.ts";

export const DATA_DOOR_KINDS = [
  "CIVICPLUS",
  "BOARDBOOK",
  "BOARDDOCS",
  "GRANICUS",
  "NOVUSAGENDA",
  "SWAGIT",
  "ESCRIBE",
  "CIVICCLERK",
  "IQM2",
  "REVIZE",
  "APPTEGY",
  "ONBASE",
  "SUITEONE",
  "SCHEDULEPAGE",
  "DOCUMENT_LISTING",
  "LEGISTAR_INSITE",
] as const;
export type DataDoorKind = (typeof DATA_DOOR_KINDS)[number];

export interface DoorKindSpec {
  readonly sourceName: string;
  readonly agendaSourceType: AgendaSourceType;
  /** The adapter's entry file, whose runtime closure keys its saved methods. */
  readonly entry: string;
  readonly route: { readonly key: string; readonly as: "url" | "origin" | "lastPathSegment" };
  /** Settings the reviewer may add to the row; anything else is refused. */
  readonly allowed: readonly string[];
  readonly required: readonly string[];
  readonly fixed?: Readonly<Record<string, string>>;
}

export const DOOR_KIND_SPECS: Readonly<Record<DataDoorKind, DoorKindSpec>> = {
  CIVICPLUS: {
    sourceName: "civicplus", agendaSourceType: "CIVICPLUS", entry: "lib/sources/civicplus/index.ts",
    route: { key: "agendaCenterUrl", as: "url" },
    allowed: ["summaryMatch", "agendaCenterCategoryId", "rssUrl", "icalUrl"],
    required: ["agendaCenterCategoryId"],
  },
  BOARDBOOK: {
    sourceName: "boardbook", agendaSourceType: "BOARDBOOK", entry: "lib/sources/boardbook/index.ts",
    // The organization's own page ends in its id; one organization is one body, so the route alone selects.
    route: { key: "orgId", as: "lastPathSegment" },
    allowed: [], required: [],
  },
  GRANICUS: {
    sourceName: "granicus", agendaSourceType: "GRANICUS", entry: "lib/sources/granicus/index.ts",
    route: { key: "publisherUrl", as: "url" },
    allowed: ["bodyMatch"], required: ["bodyMatch"],
  },
  ESCRIBE: {
    sourceName: "escribe", agendaSourceType: "ESCRIBE", entry: "lib/sources/escribe/index.ts",
    route: { key: "portalUrl", as: "origin" },
    allowed: ["meetingTypes"], required: ["meetingTypes"],
  },
  BOARDDOCS: {
    sourceName: "boarddocs", agendaSourceType: "BOARDDOCS", entry: "lib/sources/boarddocs/index.ts",
    route: { key: "portalUrl", as: "url" },
    allowed: ["committeeId"], required: ["committeeId"],
  },
  NOVUSAGENDA: {
    sourceName: "novusagenda", agendaSourceType: "NOVUSAGENDA", entry: "lib/sources/novusagenda/index.ts",
    route: { key: "portalUrl", as: "url" },
    allowed: ["bodyMatch"], required: ["bodyMatch"],
  },
  SWAGIT: {
    sourceName: "swagit", agendaSourceType: "SWAGIT", entry: "lib/sources/swagit/index.ts",
    route: { key: "portalUrl", as: "url" },
    allowed: ["bodyMatch"], required: ["bodyMatch"],
  },
  CIVICCLERK: {
    sourceName: "civicclerk", agendaSourceType: "CIVICCLERK", entry: "lib/sources/civicclerk/index.ts",
    route: { key: "apiBase", as: "origin" },
    allowed: ["portalBase", "bodyMatch", "categoryId", "titleMatch"], required: ["portalBase", "categoryId"],
  },
  IQM2: {
    sourceName: "iqm2", agendaSourceType: "IQM2", entry: "lib/sources/iqm2/index.ts",
    route: { key: "base", as: "origin" },
    allowed: ["boardMatch"], required: ["boardMatch"],
  },
  REVIZE: {
    sourceName: "revize", agendaSourceType: "REVIZE", entry: "lib/sources/revize/index.ts",
    route: { key: "base", as: "origin" },
    allowed: ["agendaPage", "documentsFolder", "titleMatch"], required: ["agendaPage", "documentsFolder", "titleMatch"],
  },
  APPTEGY: {
    sourceName: "apptegy", agendaSourceType: "APPTEGY", entry: "lib/sources/apptegy/index.ts",
    route: { key: "apiBase", as: "url" },
    allowed: ["titleMatch"], required: ["titleMatch"],
  },
  ONBASE: {
    sourceName: "onbase", agendaSourceType: "ONBASE", entry: "lib/sources/onbase/index.ts",
    route: { key: "baseUrl", as: "url" },
    allowed: [], required: [],
  },
  SUITEONE: {
    sourceName: "suiteone", agendaSourceType: "SUITEONE", entry: "lib/sources/suiteone/index.ts",
    route: { key: "portalUrl", as: "url" },
    allowed: ["groupName", "titleMatch"], required: ["groupName"],
  },
  SCHEDULEPAGE: {
    sourceName: "schedulepage", agendaSourceType: "SCHEDULEPAGE", entry: "lib/sources/schedulepage/index.ts",
    route: { key: "schedulePage", as: "url" },
    allowed: ["documentsPage", "venueMatch", "shapes", "sectionMatch", "titleMatch", "otherVenueMarkers", "pathPrefix", "monthPagePath", "monthPageQuery", "monthsAhead"],
    required: ["venueMatch"],
  },
  DOCUMENT_LISTING: {
    sourceName: "document-listing", agendaSourceType: "DOCUMENT_LISTING", entry: "lib/sources/document-listing/index.ts",
    route: { key: "pageTemplate", as: "url" },
    allowed: ["sittingKinds", "agendaHeading", "minutesHeading"], required: ["sittingKinds", "agendaHeading", "minutesHeading"],
  },
  LEGISTAR_INSITE: {
    sourceName: "legistar-insite", agendaSourceType: "LEGISTAR", entry: "lib/sources/legistar-insite/index.ts",
    route: { key: "insiteHost", as: "origin" },
    allowed: ["insiteBodyNames", "insiteBodyName", "insiteClerkScheduleUrl", "venueSourceId"],
    required: ["insiteBodyNames", "insiteBodyName"],
    fixed: { sourceRoutes: "legistar-insite" },
  },
};

export function isDataDoorKind(kind: string): kind is DataDoorKind {
  return (DATA_DOOR_KINDS as readonly string[]).includes(kind);
}

export function dataDoorConfig(input: {
  readonly kind: DataDoorKind;
  readonly route: string;
  readonly slug: string;
  readonly bodyName: string;
  readonly filter: Readonly<Record<string, string>>;
}): Readonly<Record<string, string>> {
  const spec = DOOR_KIND_SPECS[input.kind];
  const extra = Object.keys(input.filter).filter((key) => !spec.allowed.includes(key));
  if (extra.length > 0) throw new Error(`DOOR_KIND_SETTING_NOT_DECLARED:${input.kind}:${extra.join(",")}`);
  const url = new URL(input.route);
  const route = spec.route.as === "origin"
    ? (input.kind === "LEGISTAR_INSITE" ? url.host : url.origin)
    : spec.route.as === "lastPathSegment" ? url.pathname.split("/").filter(Boolean).at(-1) ?? ""
    : input.kind === "BOARDDOCS" ? `${url.origin}${url.pathname.replace(/(\/Board\.nsf)(?:\/.*)?$/i, "$1/Public")}` : url.toString();
  if (route === "") throw new Error(`DOOR_KIND_SETTING_MISSING:${input.kind}:${spec.route.key}`);
  const given = Object.fromEntries(spec.allowed.filter((key) => typeof input.filter[key] === "string" && input.filter[key]!.trim() !== "").map((key) => [key, input.filter[key]!]));
  const missing = spec.required.filter((key) => given[key] === undefined);
  if (missing.length > 0) throw new Error(`DOOR_KIND_SETTING_MISSING:${input.kind}:${missing.join(",")}`);
  if (input.kind === "CIVICPLUS" && !/^\d+(?:\s*,\s*\d+)*$/.test(given.agendaCenterCategoryId)) {
    throw new Error("DOOR_KIND_CATEGORY_INVALID:CIVICPLUS");
  }
  return { slug: input.slug, bodyName: input.bodyName, [spec.route.key]: route, ...given, ...(spec.fixed ?? {}) };
}
