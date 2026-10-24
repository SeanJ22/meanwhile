import {
  wiringForMeetingSource,
  type BodySourceWiring,
} from "../../registry/source-wiring.ts";
import type { OcdId } from "../types.ts";

export interface InSiteTenant {
  readonly slug: string;
  readonly host: string;
  readonly ocdId: OcdId | null;
  readonly bodyId: string;
  /** Exact department labels that the portal uses for this wired body. */
  readonly bodyNames: string[];
  readonly bodyName: string;
  readonly jurisdiction: string;
  readonly publishingOrg: string;
  readonly timeZone: string;
  /** First-party corroborating schedule, not an independent producer. */
  readonly clerkScheduleUrl: string | null;
}

/**
 * Project InSite adapter configuration from the one production membership
 * table. An adapter cannot acquire a tenant merely by adding code here.
 */
export function inSiteTenantsFromWiring(
  rows: readonly BodySourceWiring[] = wiringForMeetingSource("legistar-insite"),
): InSiteTenant[] {
  return rows.map((row) => {
    const slug = row.config.slug?.trim();
    const host = row.config.insiteHost?.trim();
    const bodyNames = row.config.insiteBodyNames
      ?.split("|")
      .map((name) => name.trim())
      .filter(Boolean) ?? [];
    const bodyName = row.config.insiteBodyName?.trim();
    if (!slug || !host || bodyNames.length === 0 || !bodyName) {
      throw new Error(`LEGISTAR_INSITE_SOURCE_WIRING_INVALID:${row.bodyId}`);
    }
    const ocdId = row.ocdId;
    return {
      slug,
      host,
      ocdId,
      bodyId: row.bodyId,
      bodyNames,
      bodyName,
      jurisdiction: row.jurisdiction,
      publishingOrg: row.publishingOrg,
      timeZone: row.timeZone,
      clerkScheduleUrl: row.config.insiteClerkScheduleUrl?.trim() || null,
    };
  });
}

/** The InSite tenants the installed meeting doors name; replaced in place whenever doors are installed. */
export const INSITE_TENANTS: InSiteTenant[] = [];

export function refreshInSiteTenants(): void {
  INSITE_TENANTS.splice(0, INSITE_TENANTS.length, ...inSiteTenantsFromWiring());
}

export function findTenant(slug: string): InSiteTenant | undefined {
  return INSITE_TENANTS.find((tenant) => tenant.slug === slug);
}

export function isWiredBody(tenant: InSiteTenant, bodyName: string): boolean {
  const wanted = bodyName.trim().toLowerCase();
  return tenant.bodyNames.some((name) => name.trim().toLowerCase() === wanted);
}
