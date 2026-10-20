import { parseCsv } from "../reference/csv.ts";
import { normalizedGovernmentName } from "./website-corrections.ts";
import { readPromotedCivicData, type CivicDataReadResult, type PromotedCivicDataReadOptions } from "./read-model.ts";
import type { RegistrationGovernmentListing } from "../registration/listings.ts";
import { readPublishedArraySlice } from "./published-array-slice.ts";
import { PostgresRoutineDataStore } from "./store.ts";

export const DOTGOV_SCOPE = "cisa-dotgov-registry:release";
export const LEGACY_DOTGOV_SCOPE = "US:current-full:domains";
export const DOTGOV_PARSER_VERSION = "cisa-dotgov/4";
export function dotGovStateScope(state: string): string {
  if (!/^[A-Z]{2}$/.test(state)) throw new Error("A CISA domain read needs an exact state.");
  return `cisa-dotgov-registry:${state}:domains`;
}
export const dotGovStateOfScope = (scope: string) => /^cisa-dotgov-registry:([A-Z]{2}):domains$/.exec(scope)?.[1];
export interface DotGovCounts { readonly domains: number; readonly electionDomains: number; readonly byType: Readonly<Record<string, number>> }

export interface DotGovDomain {
  readonly domain: string;
  /** CISA's classification, verbatim. */
  readonly type: string;
  readonly organization: string;
  readonly suborganization: string | null;
  readonly city: string | null;
  readonly state: string | null;
}

export interface DotGovSnapshot {
  readonly source: {
    readonly sha: string;
    readonly url: string;
    readonly readAt: string;
    readonly name?: string;
    readonly file?: string;
    readonly licence?: string;
  };
  readonly counts: DotGovCounts;
  /** The full pinned source's counts; each state's records are held on its own pointer. */
  readonly registryCounts?: DotGovCounts;
  readonly state?: string;
  readonly release?: { readonly sha: string; readonly url: string; readonly readAt: string; readonly counts: DotGovCounts };
  /** Every registry row in this state's partition, including unmatched registrants. */
  readonly domains: readonly DotGovDomain[];
  readonly boundary: string;
}

export const DOTGOV_BOUNDARY =
  "A list of DOMAINS, not an enumeration of governments. A government with no .gov domain is absent from it; one government may hold several domains; a domain is not a body. Never use these counts as a coverage denominator — that comes from the Census of Governments and the official rosters.";

/** Empty CISA cells and its literal '(blank)' marker do not name an organization or place. */
const value = (raw: string | undefined): string | null => {
  const trimmed = (raw ?? "").trim();
  return trimmed && trimmed !== "(blank)" ? trimmed : null;
};

export function dotGovColumns(header: readonly string[]): readonly number[] {
  const columns = ["Domain name", "Domain type", "Organization name", "Suborganization name", "City", "State"].map(name => header.indexOf(name));
  if (columns.some(index => index < 0)) throw new Error("The CISA registry does not carry its domain, type and registrant columns.");
  return columns;
}

export function dotGovRow(row: readonly string[], columns: readonly number[]): DotGovDomain {
  const [domain, type, organization, suborganization, city, state] = columns.map(index => value(row[index]));
  if (!domain || !/^[a-z0-9][a-z0-9.-]*\.gov$/i.test(domain) || !type) throw new Error("A CISA registry row omits a .gov domain or its domain type.");
  return { domain: domain.toLowerCase(), type, organization: organization ?? "", suborganization, city, state };
}

export function dotGovCounts(domains: readonly DotGovDomain[]): DotGovCounts {
  const byType: Record<string, number> = {};
  let electionDomains = 0;
  for (const row of domains) { byType[row.type] = (byType[row.type] ?? 0) + 1; if (/election/i.test(row.type)) electionDomains++; }
  return { domains: domains.length, electionDomains, byType };
}

export function parseDotGovRegistry(csv: string): DotGovDomain[] {
  const [header = [], ...rows] = parseCsv(csv);
  const columns = dotGovColumns(header);
  const domains = rows.filter(row => row.some(cell => cell.trim())).map(row => dotGovRow(row, columns));
  if (new Set(domains.map(row => row.domain)).size !== domains.length) throw new Error("The CISA registry repeats a domain identifier.");
  return domains.sort((a, b) => a.domain.localeCompare(b.domain));
}

export function dotGovSnapshotIssues(snapshot: unknown): readonly string[] {
  if (!snapshot || typeof snapshot !== "object") return ["The CISA projection is not an object."];
  const root = snapshot as Partial<DotGovSnapshot>;
  if (!root.source || !/^[a-f0-9]{40}$/i.test(root.source.sha ?? "") || !root.source.url || !Number.isFinite(Date.parse(root.source.readAt ?? "")) ||
    !root.counts || !Array.isArray(root.domains) || !Number.isInteger(root.counts.domains) || !Number.isInteger(root.counts.electionDomains) ||
    root.counts.domains !== root.domains.length || !root.counts.byType || typeof root.counts.byType !== "object") {
    return ["The CISA projection does not reconcile its source revision and full registry count."];
  }
  const rows = root.domains;
  if (rows.some(row => !row || typeof row.domain !== "string" || !/^[a-z0-9][a-z0-9.-]*\.gov$/i.test(row.domain) ||
    typeof row.type !== "string" || !row.type || typeof row.organization !== "string" ||
    [row.suborganization, row.city, row.state].some(field => field !== null && typeof field !== "string"))) {
    return ["A CISA projection row omits its domain, type or registrant fields."];
  }
  if (root.state !== undefined && (!/^[A-Z]{2}$/.test(root.state) || rows.some(row =>
    (/^[A-Z]{2}$/.test(row.state ?? "") ? row.state : "US") !== root.state))) return ["A CISA state partition contains another state's registrants."];
  if (root.registryCounts && (!Number.isInteger(root.registryCounts.domains) || !Number.isInteger(root.registryCounts.electionDomains) ||
    root.registryCounts.domains < rows.length || root.registryCounts.electionDomains < root.counts.electionDomains)) return ["The CISA source totals do not cover this state partition."];
  if (root.release && (root.state !== undefined || rows.length !== 0 || root.release.sha !== root.source.sha ||
    root.release.url !== root.source.url || root.release.readAt !== root.source.readAt ||
    !root.registryCounts || root.release.counts.domains !== root.registryCounts.domains ||
    root.release.counts.electionDomains !== root.registryCounts.electionDomains)) return ["The CISA source release does not reconcile its source and counts."];
  const byType: Record<string, number> = {};
  for (const row of rows) byType[row.type] = (byType[row.type] ?? 0) + 1;
  if (new Set(rows.map(row => row.domain)).size !== rows.length ||
    rows.filter(row => /election/i.test(row.type)).length !== root.counts.electionDomains ||
    Object.keys(byType).length !== Object.keys(root.counts.byType).length ||
    Object.entries(byType).some(([type, count]) => root.counts!.byType[type] !== count)) {
    return ["The CISA domain identifiers or classification counts do not reconcile."];
  }
  return [];
}

/** The same typed Reader verifies source projections and selects one state's records. */
export async function readDotGovProjection(options: PromotedCivicDataReadOptions & { readonly state?: string } = {}): Promise<CivicDataReadResult<DotGovSnapshot>> {
  const scope = options.state === undefined ? DOTGOV_SCOPE : dotGovStateScope(options.state);
  const sqlStore = !options.edge && (!options.store || options.store instanceof PostgresRoutineDataStore);
  // The old national pointer remains valid until source publication reaches every state.
  // Its complete record array never crosses the database connection.
  const scoped = await readPromotedCivicData<DotGovSnapshot>("DOTGOV_REFERENCE", scope, {
    ...options, maxAgeMs: options.maxAgeMs ?? 60 * 24 * 60 * 60 * 1000,
  });
  let read = scoped;
  if (sqlStore && (scoped === null || scoped.kind === "NOT_RECORDED")) {
    const slice = await readPublishedArraySlice<DotGovDomain>({ recordClass: "DOTGOV_REFERENCE", scope: LEGACY_DOTGOV_SCOPE,
      path: ["domains"], statePath: ["state"], statePattern: options.state === undefined ? "(?!)" : `^${options.state}$` });
    if (slice) {
      if (!slice.sourceVersion || !/^[a-f0-9]{40}$/.test(slice.sourceVersion) || !slice.finalUrl) throw new Error("CISA source attribution is incomplete.");
      const value: DotGovSnapshot = { source: { sha: slice.sourceVersion, url: slice.finalUrl, readAt: slice.retrievedAt },
        counts: dotGovCounts(slice.records), domains: slice.records, ...(options.state === undefined ? {} : { state: options.state }), boundary: DOTGOV_BOUNDARY };
      const ref = slice.input;
      read = { kind: "PROMOTED", value,
        projection: { key: `DOTGOV_REFERENCE:${LEGACY_DOTGOV_SCOPE}`, sourceId: slice.sourceId, recordClass: "DOTGOV_REFERENCE", scope: LEGACY_DOTGOV_SCOPE,
          versionId: ref.versionId, lastKnownGoodVersionId: ref.versionId, promotedAt: ref.promotedAt, payload: value, receipt: slice.receipt },
        metadata: { recordClass: "DOTGOV_REFERENCE", scope: LEGACY_DOTGOV_SCOPE, sourceId: slice.sourceId, version: slice.sourceVersion,
          versionId: ref.versionId, lastKnownGoodVersionId: ref.versionId, retrievedAt: slice.retrievedAt, promotedAt: ref.promotedAt,
          sourceThrough: slice.retrievedAt, stale: "UNKNOWN", staleAt: null } };
    }
  }
  read ??= await readPromotedCivicData<DotGovSnapshot>("DOTGOV_REFERENCE", DOTGOV_SCOPE, { ...options, edge: { kind: "NOT_RECORDED", recordClass: "DOTGOV_REFERENCE", scope: DOTGOV_SCOPE } });
  if (read.kind === "PROMOTED") {
    const issues = dotGovSnapshotIssues(read.value);
    if (issues.length) return { kind: "STORE_UNREACHABLE", value: null, metadata: read.metadata, code: "PROMOTION_PROOF_INVALID", detail: issues.join(" ") };
  }
  return read;
}

/** Match only a unique government's established name and state. City is a registrant's mailing location. */
export function attachGovernmentDomains(listings: readonly RegistrationGovernmentListing[], snapshot: DotGovSnapshot): RegistrationGovernmentListing[] {
  const governments = new Map<string, RegistrationGovernmentListing[]>();
  const key = (state: string, name: string) => `${state.trim().toUpperCase()}:${normalizedGovernmentName(name)}`;
  for (const government of listings) {
    const identity = key(government.state, government.name);
    governments.set(identity, [...(governments.get(identity) ?? []), government]);
  }
  const matches = new Map<string, NonNullable<RegistrationGovernmentListing["govDomains"]>[number][]>();
  for (const domain of snapshot.domains) {
    if (!domain.state || !normalizedGovernmentName(domain.organization)) continue;
    const matched = governments.get(key(domain.state, domain.organization));
    if (matched?.length !== 1) continue;
    const government = matched[0]!;
    matches.set(government.id, [...(matches.get(government.id) ?? []), {
      domain: domain.domain, website: `https://${domain.domain}`, sourceUrl: snapshot.source.url, checkedAt: snapshot.source.readAt,
    }]);
  }
  return listings.map(government => ({ ...government, govDomains: matches.get(government.id) ?? [] }));
}
