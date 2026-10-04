/**
 * DB-17: every adapter kind can be added as a data row.
 *
 * Each kind below is one adapter in `lib/sources/composite/wiring.ts` that a
 * reviewed calendar can be wired to as data. A kind declares, in one place,
 * the adapter configuration its reader needs: which key the reviewed route
 * fills, which settings the reviewer's filter may carry, which of them are
 * required, and how the adapter's own source name is spelled. The derived
 * wiring, the crosswalk filter and the adapter digest all read this table, so
 * a new kind is one entry here and never a branch in code.
 *
 * Nothing here names a place.
 */

import type { AgendaSourceType } from "../registry/types.ts";

export const DATA_DOOR_KINDS = [
  "CIVICPLUS",
  "BOARDBOOK",
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
  /** The composite adapter's source name; its meetings carry it. */
  readonly sourceName: string;
  /** The wiring row's agenda source type the adapter is registered under. */
  readonly agendaSourceType: AgendaSourceType;
  /** The adapter's entry file, whose runtime closure keys its saved methods. */
  readonly entry: string;
  /** What the reviewed route becomes in the adapter's settings. */
  readonly route: { readonly key: string; readonly as: "url" | "origin" | "lastPathSegment" };
  /** Settings the reviewer may add to the row; anything else is refused. */
  readonly allowed: readonly string[];
  /** Settings the adapter cannot read without. */
  readonly required: readonly string[];
  /** Fixed settings the kind always carries. */
  readonly fixed?: Readonly<Record<string, string>>;
}

export const DOOR_KIND_SPECS: Readonly<Record<DataDoorKind, DoorKindSpec>> = {
  CIVICPLUS: {
    sourceName: "civicplus", agendaSourceType: "CIVICPLUS", entry: "lib/sources/civicplus/index.ts",
    route: { key: "icalUrl", as: "url" },
    allowed: ["summaryMatch", "agendaCenterUrl", "agendaCenterCategoryId", "rssUrl"],
    required: ["summaryMatch", "agendaCenterUrl", "agendaCenterCategoryId"],
  },
  BOARDBOOK: {
    sourceName: "boardbook", agendaSourceType: "BOARDBOOK", entry: "lib/sources/boardbook/index.ts",
    // The organization's own page ends in its id; one organization is one body, so the route alone selects.
    route: { key: "orgId", as: "lastPathSegment" },
    allowed: [], required: [],
  },
  CIVICCLERK: {
    sourceName: "civicclerk", agendaSourceType: "CIVICCLERK", entry: "lib/sources/civicclerk/index.ts",
    route: { key: "apiBase", as: "origin" },
    allowed: ["portalBase"], required: ["portalBase"],
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

/**
 * The adapter settings a reviewed route and filter give a data-door row, or
 * the reason they cannot: a missing required setting, or one the kind does not
 * declare, is refused by name rather than guessed.
 */
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
    : spec.route.as === "lastPathSegment" ? url.pathname.split("/").filter(Boolean).at(-1) ?? "" : url.toString();
  if (route === "") throw new Error(`DOOR_KIND_SETTING_MISSING:${input.kind}:${spec.route.key}`);
  const given = Object.fromEntries(spec.allowed.filter((key) => typeof input.filter[key] === "string" && input.filter[key]!.trim() !== "").map((key) => [key, input.filter[key]!]));
  const missing = spec.required.filter((key) => given[key] === undefined);
  if (missing.length > 0) throw new Error(`DOOR_KIND_SETTING_MISSING:${input.kind}:${missing.join(",")}`);
  return { slug: input.slug, bodyName: input.bodyName, [spec.route.key]: route, ...given, ...(spec.fixed ?? {}) };
}
