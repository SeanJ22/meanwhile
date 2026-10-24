import {
  wiringForMeetingSource,
  type BodySourceWiring,
} from "../../registry/source-wiring.ts";
import type { OcdId } from "../types.ts";
import { fetchBodies } from "./client.ts";
import type { LegistarBody } from "./types.ts";

/** Official calendar doors bind a tenant to its body and division. Publication places the source address. */
export interface LegistarClient {
  /** Exact vendor body identity for a runtime-added calendar. */
  eventBodyId?: number;
  /** Exact body label already bound by the official calendar door; used only to resolve its native key. */
  eventBodyName?: string;
  /** The `{client}` path segment at webapi.legistar.com. */
  slug: string;
  /** Set when the platform census opened this calendar's door; absent for a hand-wired door. */
  censusRoute?: string;
  /** The division whose government this is. WHERE, not WHO. */
  ocdId: OcdId;
  /**
   * The registry body whose sittings this client serves. `ocdId` answers where, and several bodies can share
   * one division, so the body id is stated here.
   */
  bodyId: string;
  /** Display only — never joined on. */
  jurisdiction: string;
  /** Who published the record: the public body, not Granicus. */
  publishingOrg: string;
  /** IANA zone the body meets in. Legistar sends wall-clock times with no zone. */
  timeZone: string;
  /**
   * The tenant's own InSite portal host. `webapi.legistar.com/v1/{slug}/events` returns only sittings whose
   * InSite detail page is publicly viewable; the portal's own `Calendar.aspx` grid returns all of them. Optional:
   * `lib/sources/legistar-insite/` reads only the clients that state one.
   */
  insiteHost?: string;
  /**
   * The calendar RSS pair observed on this tenant's portal, and the range it was observed for. `Feed.ashx` is
   * keyed per tenant and per date range, so the adapter reads the link off the page it just fetched and uses
   * this only as the record of what was seen, never to construct a URL. The feed's `pubDate` states when
   * InSite first published each sitting, which the grid does not.
   */
  insiteFeed?: {
    id: string;
    guid: string;
    /** The dropdown selection this pair was read under. */
    range: string;
    /** When it was read. `pnpm stamp`, never a plausible date. */
    observedAt: string;
  };
}

export function legistarClientsFromWiring(
  rows: readonly BodySourceWiring[] = wiringForMeetingSource("legistar"),
): LegistarClient[] {
  return rows.map((row) => {
    const slug = row.config.slug?.trim();
    if (!slug || row.ocdId === null) {
      throw new Error(`LEGISTAR_SOURCE_WIRING_INVALID:${row.bodyId}`);
    }
    const insiteFeed = row.config.insiteFeedId && row.config.insiteFeedGuid &&
        row.config.insiteFeedRange && row.config.insiteFeedObservedAt
      ? {
          id: row.config.insiteFeedId,
          guid: row.config.insiteFeedGuid,
          range: row.config.insiteFeedRange,
          observedAt: row.config.insiteFeedObservedAt,
        }
      : undefined;
    const ocdId = row.ocdId;
    return {
      slug,
      ...(row.config.eventBodyId ? { eventBodyId: Number(row.config.eventBodyId) } : {}),
      ...(row.config.eventBodyName || row.config.insiteBodyName ? { eventBodyName: row.config.eventBodyName || row.config.insiteBodyName } : {}),
      ocdId,
      bodyId: row.bodyId,
      jurisdiction: row.jurisdiction,
      publishingOrg: row.publishingOrg,
      timeZone: row.timeZone,
      ...(row.config.insiteHost ? { insiteHost: row.config.insiteHost } : {}),
      ...(insiteFeed ? { insiteFeed } : {}),
      ...(row.config.crosswalkRowId ? { censusRoute: row.config.partitionRoute ?? row.config.crosswalkRowId } : {}),
    };
  });
}

/** The Legistar tenants the installed meeting doors name; replaced in place whenever doors are installed. */
export const LEGISTAR_CLIENTS: LegistarClient[] = [];

export function refreshLegistarClients(): void {
  LEGISTAR_CLIENTS.splice(0, LEGISTAR_CLIENTS.length, ...legistarClientsFromWiring());
}

/** The one client for a tenant (and body). A census door copying a hand-wired door never makes the hand-wired one ambiguous. */
export function findClient(slug: string, bodyId?: string): LegistarClient | undefined {
  const matches = LEGISTAR_CLIENTS.filter(client => client.slug === slug && (bodyId === undefined || client.bodyId === bodyId));
  const handWired = matches.filter(client => client.censusRoute === undefined);
  const chosen = handWired.length > 0 ? handWired : matches;
  return chosen.length === 1 ? chosen[0] : undefined;
}

/** A known door's exact official name can recover its native body key; a tenant is never a body. */
export async function resolveNativeBody(client: LegistarClient, options: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {}): Promise<number> {
  if (client.eventBodyId !== undefined) {
    if (!Number.isSafeInteger(client.eventBodyId) || client.eventBodyId <= 0) throw new Error("LEGISTAR_NATIVE_BODY_INVALID");
    return client.eventBodyId;
  }
  if (!client.eventBodyName?.trim()) throw new Error(`LEGISTAR_NATIVE_BODY_UNRESOLVED:${client.bodyId}`);
  const bodies = await fetchBodies<LegistarBody>(client.slug, options);
  const matches = bodies.filter(body => body.BodyName.trim() === client.eventBodyName!.trim());
  if (matches.length !== 1) throw new Error(`LEGISTAR_NATIVE_BODY_AMBIGUOUS:${client.bodyId}`);
  client.eventBodyId = matches[0].BodyId;
  return client.eventBodyId;
}
