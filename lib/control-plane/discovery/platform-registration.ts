import type { RegistrationGovernmentListing } from "../../registration/listings.ts";
import type { MeetingsDiscoveryNeed } from "../../hunt/meetings-discovery.ts";
import type { RegisteredGovernment } from "./auto-crosswalk.ts";
import type { PlatformTenant } from "./platform-enumeration.ts";

export type PlatformQuery = (sql: string, parameters: readonly unknown[]) => Promise<readonly Record<string, unknown>[]>;
export interface PlatformRegistrationPage {
  readonly government: RegistrationGovernmentListing;
  readonly versionId: string;
  readonly promotedAt: string;
  readonly readModelHash: string;
}

/** PostgreSQL selects one inventory member; no worker downloads a state or national registration payload. */
export const PLATFORM_REGISTRATION_PAGE_SQL = `SELECT
  g AS government,
  p.current_version_id AS "versionId", p.promoted_at AS "promotedAt", c.normalized_hash AS "readModelHash"
  FROM civic_data_promotions p JOIN civic_data_candidates c ON c.id=p.current_version_id,
    LATERAL (SELECT p.payload->'governments'->$2::int AS g) one
  WHERE p.key='REGISTRATION:US-'||$1||':registration:v1' AND p.record_class='REGISTRATION'
    AND jsonb_typeof(p.payload->'governments'->$2::int)='object'`;

export async function readPlatformRegistrationPage(query: PlatformQuery, state: string, index: number): Promise<PlatformRegistrationPage | null> {
  if (!/^[A-Z]{2}$/i.test(state) || !Number.isSafeInteger(index) || index < 0) throw new Error("Invalid platform registration position");
  const rows = await query(PLATFORM_REGISTRATION_PAGE_SQL, [state.toUpperCase(), index]);
  return rows[0] as unknown as PlatformRegistrationPage ?? null;
}

export function platformRegistrationNeed(page: PlatformRegistrationPage): MeetingsDiscoveryNeed | null {
  const g = page.government;
  return { jurisdictionId: g.jurisdictionId ?? g.id, stateCode: g.state.toUpperCase(), name: g.name, govClass: g.governmentClass,
    countyFips: g.countyFips, bodyIds: g.bodyIds, ownWebAddress: g.website,
    basis: "SOURCE_DISCOVERY_OWED", sources: [], addressSource: { source: "REGISTRATION", versionId: page.versionId } };
}

/** A new body's name and type must still be found on the platform. The identity stays on its native government. */
export function platformRegistrationBinding(page: PlatformRegistrationPage): RegisteredGovernment | { notRegistered: string } {
  const g = page.government;
  const divisions = [...new Set(g.associations.filter(a => ["SOURCE_CODE", "GOVERNING_FUNCSTAT", "SOURCE_BOUNDARY", "COUNTY_IN_NAME"].includes(a.basis))
    .map(a => a.divisionId))];
  // A Census county is an administrative address, not a district's service area.
  // Its native bodies can publish at their registered state while finer place associations remain open.
  if (!divisions.length) divisions.push(`ocd-division/country:us/${g.state === "DC" ? "district" : ["AS", "GU", "MP", "PR", "VI"].includes(g.state) ? "territory" : "state"}:${g.state.toLowerCase()}`);
  if (divisions.length !== 1) return { notRegistered: `${g.name}: the registered government has several place associations; its calendar remains open work.` };
  if (!new RegExp(`/(?:state|district|territory):${g.state.toLowerCase()}(?:/|$)`).test(divisions[0])) return { notRegistered: `${g.name}: the place association is outside its registered state.` };
  if (g.bodyIds.length > 1) return { notRegistered: `${g.name}: the registered government has several bodies; the native platform body must distinguish them.` };
  const aliases = g.aliases.filter(id => id.startsWith(`${divisions[0]}#`) && /#(?:governing|board)$/.test(id));
  return { governmentId: g.id, governmentClass: g.governmentClass, website: g.website,
    bodyId: g.bodyIds[0] ?? (aliases.length === 1 ? aliases[0] : `${g.id}#${/SCHOOL|EDUCATION/i.test(g.governmentClass) ? "board" : "governing"}`), ocdId: divisions[0], publishingOrg: g.name, countyFips: g.countyFips,
    input: { kind: "PROMOTED_VERSION", recordClass: "REGISTRATION", scope: `US-${g.state.toUpperCase()}:registration:v1`,
      versionId: page.versionId, readModelSha256: page.readModelHash, promotedAt: page.promotedAt } };
}

const websiteHostSql = (value: string) => `lower(split_part(regexp_replace(${value}, '^https?://(www\\.)?', '', 'i'), '/', 1))`;
const directoryNameSql = (value: string) => `(SELECT string_agg(word,' ' ORDER BY word) FROM regexp_split_to_table(
  btrim(regexp_replace(regexp_replace(lower(${value}), '^(the )?(city|town|village|borough) of ', ''), '[^a-z0-9]+', ' ', 'g')), ' +') word
  WHERE word NOT IN ('of','the'))`;

/** A directory name selects governments whose own sites must still be checked; it establishes no portal authority. */
export async function platformGovernmentCandidates(query: PlatformQuery, tenant: PlatformTenant): Promise<PlatformRegistrationPage[]> {
  if (!tenant.name || !tenant.state) return [];
  return await query(`SELECT g AS government,p.current_version_id AS "versionId", p.promoted_at AS "promotedAt", c.normalized_hash AS "readModelHash"
    FROM civic_data_promotions p JOIN civic_data_candidates c ON c.id=p.current_version_id,
      LATERAL jsonb_array_elements(p.payload->'governments') g
    WHERE p.record_class='REGISTRATION' AND p.scope='US-'||$1||':registration:v1'
      AND ${directoryNameSql("g->>'name'")}=${directoryNameSql("$2::text")}
    LIMIT 2`, [tenant.state, tenant.name]) as unknown as PlatformRegistrationPage[];
}

/** Website or observed link evidence selects at most two records; a printed directory name alone never matches a portal. */
export async function matchRegisteredPlatformTenant(query: PlatformQuery, tenant: PlatformTenant, governmentWebsites: readonly string[] = []): Promise<PlatformRegistrationPage[]> {
  const hosts = [tenant.url, ...governmentWebsites].flatMap(value => { try { return [new URL(value).hostname.replace(/^www\./i, "").toLowerCase()]; } catch { return []; } });
  const rows = await query(`SELECT g AS government,p.current_version_id AS "versionId", p.promoted_at AS "promotedAt", c.normalized_hash AS "readModelHash"
    FROM civic_data_promotions p JOIN civic_data_candidates c ON c.id=p.current_version_id,
      LATERAL jsonb_array_elements(p.payload->'governments') g
    WHERE p.record_class='REGISTRATION' AND ($1::text IS NULL OR p.scope='US-'||$1||':registration:v1')
      AND (${websiteHostSql("g->>'website'")}=ANY($2::text[])
        OR (${websiteHostSql("g->>'website'")} LIKE '%.gov' AND EXISTS (
          SELECT 1 FROM unnest($2::text[]) h WHERE h LIKE '%.'||${websiteHostSql("g->>'website'")})))
      AND ($3::text IS NULL OR ${directoryNameSql("g->>'name'")}=${directoryNameSql("$3::text")})
    LIMIT 2`, [tenant.state, hosts, tenant.name]);
  return rows as unknown as PlatformRegistrationPage[];
}
