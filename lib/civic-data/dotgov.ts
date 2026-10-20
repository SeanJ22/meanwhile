import { parseCsv } from "../reference/csv.ts";
import { normalizedGovernmentName } from "./website-corrections.ts";
import { readPromotedCivicData, type CivicDataReadResult, type PromotedCivicDataReadOptions } from "./read-model.ts";
import type { RegistrationGovernmentListing } from "../registration/listings.ts";

export const DOTGOV_SCOPE = "US:current-full:domains";
export const DOTGOV_PARSER_VERSION = "cisa-dotgov/3";

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
  readonly counts: { readonly domains: number; readonly electionDomains: number; readonly byType: Readonly<Record<string, number>> };
  /** Every registry row, including registrants with no matching government. */
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

export function parseDotGovRegistry(csv: string): DotGovDomain[] {
  const [header = [], ...rows] = parseCsv(csv);
  const columns = ["Domain name", "Domain type", "Organization name", "Suborganization name", "City", "State"].map(name => header.indexOf(name));
  if (columns.some(index => index < 0)) throw new Error("The CISA registry does not carry its domain, type and registrant columns.");
  const domains = rows.filter(row => row.some(cell => cell.trim())).map(row => {
    const [domain, type, organization, suborganization, city, state] = columns.map(index => value(row[index]));
    if (!domain || !/^[a-z0-9][a-z0-9.-]*\.gov$/i.test(domain) || !type) throw new Error("A CISA registry row omits a .gov domain or its domain type.");
    return { domain: domain.toLowerCase(), type, organization: organization ?? "", suborganization, city, state };
  });
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

/** The same typed Reader verifies the proposed source projection and serves readers. */
export async function readDotGovProjection(options: PromotedCivicDataReadOptions = {}): Promise<CivicDataReadResult<DotGovSnapshot>> {
  const read = await readPromotedCivicData<DotGovSnapshot>("DOTGOV_REFERENCE", DOTGOV_SCOPE, {
    ...options, maxAgeMs: options.maxAgeMs ?? 60 * 24 * 60 * 60 * 1000,
  });
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
