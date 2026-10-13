import { createHash } from "node:crypto";
import { httpsHost } from "./derived-door.ts";

import { DATA_DOOR_KINDS, DOOR_KIND_SPECS, isDataDoorKind, type DataDoorKind } from "./derived-door-kinds.ts";

/** Byte-identical to the citation already stored on existing rows. */
export const CROSSWALK_CITATION =
  "C16: owner decision recorded 2026-09-24T22:43Z (agents may review and promote the records connecting a calendar to its governing body, on saved official evidence)" as const;

export const CROSSWALK_KINDS = ["ICAL", "OFFICIAL_PAGE_EVENTS", "DILIGENT", "LEGISTAR", ...DATA_DOOR_KINDS] as const;
export type CrosswalkKind = (typeof CROSSWALK_KINDS)[number];

/** Filter keys each kind reads, and the selecting ones (at least one is required). */
const FILTER_KEYS: Readonly<Record<CrosswalkKind, { readonly allowed: readonly string[]; readonly selecting: readonly string[] }>> = {
  ICAL: { allowed: ["titleMatch", "categoryMatch", "titleExclude", "feedScope"], selecting: ["titleMatch", "categoryMatch", "feedScope"] },
  OFFICIAL_PAGE_EVENTS: { allowed: ["nameTerms"], selecting: ["nameTerms"] },
  DILIGENT: { allowed: ["titleMatch", "titleExclude"], selecting: ["titleMatch"] },
  LEGISTAR: { allowed: ["eventBodyId"], selecting: ["eventBodyId"] },
  ...(Object.fromEntries(DATA_DOOR_KINDS.map((kind) => {
    const spec = DOOR_KIND_SPECS[kind];
    return [kind, { allowed: spec.allowed, selecting: spec.required }];
  })) as Record<DataDoorKind, { readonly allowed: readonly string[]; readonly selecting: readonly string[] }>),
};

export interface MeetingBodyCrosswalkRow {
  readonly id: string;
  readonly jurisdictionId: string;
  readonly ocdId: string;
  readonly bodyId: string;
  readonly bodyRole: "GOVERNING" | "BOARD" | "SUB_BODY";
  readonly bodyName: string;
  readonly kind: CrosswalkKind;
  readonly route: string;
  readonly officialHost: string;
  readonly filter: Readonly<Record<string, string>>;
  readonly publishingOrg: string;
  readonly timeZone: string;
  readonly evidence: {
    readonly bodyPage: { readonly url: string; readonly sha256: string; readonly quote: string };
    readonly calendar: { readonly url: string; readonly sha256: string; readonly selected: number; readonly total: number };
    readonly readAt: string;
  };
  readonly status: "ACTIVE" | "WITHDRAWN";
  readonly withdrawal?: { readonly reason: string };
  readonly reviewedBy: string;
  readonly reviewedAt: string;
  readonly authorization: typeof CROSSWALK_CITATION;
}

const SHA256 = /^[0-9a-f]{64}$/;
const flat = (text: string): string => text.replace(/\s+/g, " ").trim().toLowerCase();
const bareHost = (host: string): string => host.toLowerCase().replace(/^www\./, "");

export function crosswalkSlug(text: string): string {
  return text.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function subBodyId(ocdId: string, bodyName: string): string {
  return `${ocdId}#body:${crosswalkSlug(bodyName)}`;
}

export function crosswalkRowId(bodyId: string, kind: CrosswalkKind, route?: string): string {
  return `${bodyId}|${kind}${typeof route === "string" && route ? `|${createHash("sha256").update(route).digest("hex").slice(0, 16)}` : ""}`;
}

/** A `feedScope: "category"` filter stands only on a CivicPlus category feed, and never beside another filter. */
export function categoryFeedIssue(route: string, filter: Readonly<Record<string, string>>): string | null {
  if (filter.feedScope !== "category") return `feedScope is "category" or absent, never "${filter.feedScope}"`;
  if ("titleMatch" in filter || "categoryMatch" in filter) return "a whole-feed filter stands alone: no titleMatch or categoryMatch beside it";
  let url: URL;
  try {
    url = new URL(route);
  } catch {
    return "a whole-feed filter needs a category feed URL";
  }
  const params = new Map([...url.searchParams].map(([k, v]) => [k.toLowerCase(), v]));
  if (!/\/iCalendar\.aspx$/i.test(url.pathname) || !/^\d+$/.test(params.get("catid") ?? "") || (params.get("feed") ?? "").toLowerCase() !== "calendar") {
    return `a whole-feed filter stands only on a category-scoped feed (/iCalendar.aspx?catID=<n>&feed=calendar), not ${route}`;
  }
  return null;
}

export function crosswalkRowIssue(value: unknown): string | null {
  const row = value as Partial<MeetingBodyCrosswalkRow> | null;
  if (typeof row !== "object" || row === null) return "a crosswalk row is not an object";
  const who = typeof row.id === "string" && row.id !== "" ? row.id : "a crosswalk row";
  const text = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
  if (!text(row.jurisdictionId) || !/^[a-z]{2}:[a-z]+:[a-z0-9-]+$/.test(row.jurisdictionId)) return `${who} names no jurisdiction`;
  if (!text(row.ocdId) || !/^ocd-division\/country:us\/(?:state|district|territory):[a-z]{2}(\/[a-z_]+:[a-z0-9_~.-]+)+$/.test(row.ocdId)) return `${who} names no registered division`;
  if (!text(row.bodyName) || row.bodyName.length > 160) return `${who} has no body name as the government prints it`;
  const expectedBody = row.bodyRole === "GOVERNING" ? `${row.ocdId}#governing`
    : row.bodyRole === "BOARD" ? `${row.ocdId}#board`
      : row.bodyRole === "SUB_BODY" ? subBodyId(row.ocdId, row.bodyName)
        : null;
  if (expectedBody === null) return `${who} names no body role`;
  if (row.bodyId !== expectedBody) return `${who}: a ${row.bodyRole} body's id is ${expectedBody}, derived from its division${row.bodyRole === "SUB_BODY" ? " and its printed name" : ""}`;
  if (!CROSSWALK_KINDS.includes(row.kind as CrosswalkKind)) return `${who}: no reviewed filter is defined for a ${String(row.kind)} calendar`;
  const kind = row.kind as CrosswalkKind;
  if (row.id !== crosswalkRowId(row.bodyId, kind) && row.id !== crosswalkRowId(row.bodyId, kind, row.route)) {
    return `${who}: the id must name its own body, kind and calendar route`;
  }
  const routeHost = text(row.route) ? httpsHost(row.route) : null;
  if (routeHost === null) return `${who}: the calendar is not an https URL`;
  if (row.officialHost !== routeHost) return `${who}: the calendar's host is ${routeHost}, not ${String(row.officialHost)}`;

  const filter = row.filter ?? {};
  const keys = Object.keys(filter);
  const rule = FILTER_KEYS[kind];
  const stray = keys.find((key) => !rule.allowed.includes(key));
  if (stray !== undefined) return `${who}: a ${kind} filter has no ${stray}`;
  // A data-door kind needs every setting its adapter requires; one with none serves a single body by route alone.
  const dataKind = isDataDoorKind(kind);
  const selects = dataKind ? rule.selecting.every((key) => text(filter[key])) : rule.selecting.some((key) => text(filter[key]));
  if (!selects) {
    return `${who}: a ${kind} calendar is this body's only through a filter naming it (${rule.selecting.join(dataKind ? " and " : " or ")})`;
  }
  if (keys.some((key) => typeof filter[key] !== "string")) return `${who}: a filter value is not text`;
  if (kind === "LEGISTAR" && !/^\d+$/.test(filter.eventBodyId)) return `${who}: no numeric Legistar body id`;
  if ("feedScope" in filter) {
    const issue = categoryFeedIssue(row.route ?? "", filter);
    if (issue !== null) return `${who}: ${issue}`;
  }
  if (!text(row.publishingOrg) || !text(row.timeZone) || !/^[A-Za-z_]+\/[A-Za-z_]+/.test(row.timeZone)) return `${who} has no publisher or time zone`;

  const evidence = row.evidence;
  const page = evidence?.bodyPage;
  const calendar = evidence?.calendar;
  if (!page || !calendar || !text(evidence?.readAt) || !Number.isFinite(Date.parse(evidence.readAt))) return `${who} carries no dated evidence`;
  const pageHost = httpsHost(page.url);
  if (pageHost === null || (bareHost(pageHost) !== bareHost(routeHost) && !["LEGISTAR", "DILIGENT", "BOARDBOOK", "CIVICCLERK", "IQM2", "CIVICPLUS", "BOARDDOCS"].includes(kind))) {
    return `${who}: the page naming the body is not on the government's own host ${routeHost}`;
  }
  if (!SHA256.test(page.sha256) || !SHA256.test(calendar.sha256)) return `${who}: evidence is cited by its sha256, bare hex`;
  if (!text(page.quote) || !flat(page.quote).includes(flat(row.bodyName))) return `${who}: the quoted page does not print "${row.bodyName}"`;
  if (calendar.url !== row.route) return `${who}: the calendar evidence is not the calendar`;
  if (!Number.isInteger(calendar.selected) || !Number.isInteger(calendar.total) || calendar.selected < 1 || calendar.total < calendar.selected) {
    return `${who}: the reviewed filter selected no meeting from the calendar`;
  }
  if (row.status !== "ACTIVE" && row.status !== "WITHDRAWN") return `${who} has no status`;
  if (row.status === "WITHDRAWN" ? !text(row.withdrawal?.reason) : row.withdrawal !== undefined) {
    return `${who}: a withdrawn row states why, and only a withdrawn row does`;
  }
  if (!text(row.reviewedBy) || /\bsean\b/i.test(row.reviewedBy)) return `${who}: the reviewer is the agent session that checked it`;
  if (!text(row.reviewedAt) || !Number.isFinite(Date.parse(row.reviewedAt)) || Date.parse(row.reviewedAt) < Date.parse(evidence.readAt)) {
    return `${who}: reviewed before its evidence was read`;
  }
  if (row.authorization !== CROSSWALK_CITATION) return `${who} does not carry the crosswalk citation (rulings §3)`;
  return null;
}

export function crosswalkListIssues(rows: readonly unknown[]): readonly string[] {
  const issues = rows.map(crosswalkRowIssue).filter((issue): issue is string => issue !== null);
  const valid = rows.filter((row) => crosswalkRowIssue(row) === null) as MeetingBodyCrosswalkRow[];
  const ids = new Set<string>();
  const claims = new Map<string, string>();
  for (const row of valid) {
    if (ids.has(row.id)) issues.push(`${row.id} is reviewed twice`);
    ids.add(row.id);
    if (row.status !== "ACTIVE") continue;
    const claim = `${row.route}\n${JSON.stringify(Object.entries(row.filter).sort())}`;
    const other = claims.get(claim);
    if (other !== undefined && other !== row.bodyId) {
      issues.push(`CONFLICTING_EVIDENCE: ${row.bodyId} and ${other} claim the same meetings of ${row.route}`);
    }
    claims.set(claim, row.bodyId);
  }
  return issues;
}

export function crosswalkReceiptIssue(
  row: MeetingBodyCrosswalkRow,
  sources: readonly { readonly requestedUrl: string; readonly finalUrl: string; readonly rawHash: string; readonly reviewOutcome?: "SUPPORTED" | "BLOCKED" }[],
): string | null {
  const bytes = (url: string, sha256: string): boolean =>
    sources.some((s) => (s.reviewOutcome ?? "SUPPORTED") === "SUPPORTED" && (s.requestedUrl === url || s.finalUrl === url) && s.rawHash === sha256);
  if (!bytes(row.evidence.bodyPage.url, row.evidence.bodyPage.sha256)) return `${row.id}: the page naming the body is not the receipted bytes`;
  if (!bytes(row.evidence.calendar.url, row.evidence.calendar.sha256)) return `${row.id}: the calendar is not the receipted bytes`;
  return null;
}
