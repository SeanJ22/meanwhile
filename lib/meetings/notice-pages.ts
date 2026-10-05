import { activeWiring, type BodySourceWiring } from "../registry/source-wiring.ts";

/**
 * **A NOTICE PAGE IS ITS BODY'S PAGE, NEVER A SITTING'S AGENDA BY DEFAULT.**
 * (2026-09-24, D1.)
 *
 * A wiring row's `noticeUrl` is the page a body posts its meeting notices on:
 * a town calendar, a council's meetings page, a board's front page. The ingest
 * used to read it as the agenda of any scheduled sitting on the division that
 * had no agenda link, and on 2026-09-24 production held 70 such documents, not
 * one of which yields an agenda item. Some were not even the sitting's own
 * body's page: the Central Arizona Water Conservation District's meetings page
 * was held as a Pima Board of Supervisors study session's agenda, and the Town
 * of Bradford's calendar as the agenda of Newbury sittings.
 *
 * A notice page belongs to a sitting when a wiring row that names the page is
 * the sitting's own body (by body id) or its own publisher (by the org the
 * sitting was published under). Both are needed: Tucson Unified's sittings
 * carry the publisher "Tucson Unified School District" while the board's
 * wiring row says "Tucson Unified School District Governing Board", and a town
 * whose boards share one calendar lends it to a board that has no row of its
 * own. The ingest and every reader surface ask this one module.
 */

interface NoticePageOwners {
  readonly bodyIds: ReadonlySet<string>;
  readonly publishers: ReadonlySet<string>;
}

/** Built from the doors in use, and rebuilt when a pass installs a different list (DB-15). */
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

/**
 * Whether a notice page belongs to neither the sitting's body nor its
 * publisher. False for anything that is not a wired notice page, and false
 * when the sitting's body is not known: "another body's" is said on evidence,
 * never on a missing field, because a publisher's name alone differs between
 * a board's wiring row and its own sittings (Tucson Unified's).
 */
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
