import { activeWiring, type BodySourceWiring } from "../registry/source-wiring.ts";

/**
 * A notice page is its body's page, never a sitting's agenda by default. It belongs to a sitting only when a wiring row
 * naming it is the sitting's own body (by body id) or its own publisher (by org): both are needed, since a publisher's
 * name can differ between a body's wiring row and its sittings.
 */

interface NoticePageOwners {
  readonly bodyIds: ReadonlySet<string>;
  readonly publishers: ReadonlySet<string>;
}

/** Built from the doors in use, and rebuilt when a pass installs a different list. */
let ownersFor: { readonly wiring: readonly BodySourceWiring[]; readonly owners: ReadonlyMap<string, NoticePageOwners> } | null = null;

function owners(): ReadonlyMap<string, NoticePageOwners> {
  const wiring = activeWiring();
  if (ownersFor?.wiring !== wiring) ownersFor = { wiring, owners: buildOwners(wiring) };
  return ownersFor.owners;
}

function buildOwners(wiring: readonly BodySourceWiring[]): ReadonlyMap<string, NoticePageOwners> {
  const owners = new Map<string, { bodyIds: Set<string>; publishers: Set<string> }>();
  for (const row of wiring) {
    if (!row.noticeUrl) continue;
    const entry = owners.get(row.noticeUrl) ?? { bodyIds: new Set<string>(), publishers: new Set<string>() };
    entry.bodyIds.add(row.bodyId);
    entry.publishers.add(row.publishingOrg);
    owners.set(row.noticeUrl, entry);
  }
  return owners;
}

/** Whether a URL is a body's notice page, as the wiring names it. */
export function isWiredNoticePage(url: string): boolean {
  return owners().has(url);
}

/** Whether a notice page belongs to neither the sitting's body nor its publisher; false when the body is not known. */
export function isAnotherBodysNoticePage(
  url: string,
  sitting: { readonly bodyId?: string | null; readonly publisher?: string | null },
): boolean {
  const pageOwners = owners().get(url);
  if (!pageOwners || !sitting.bodyId) return false;
  if (pageOwners.bodyIds.has(sitting.bodyId)) return false;
  if (sitting.publisher && pageOwners.publishers.has(sitting.publisher)) return false;
  return true;
}
