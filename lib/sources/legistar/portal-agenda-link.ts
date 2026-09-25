/**
 * **THE PORTAL'S OWN LINK TO A SITTING'S AGENDA, READ BEFORE THE VENDOR'S
 * FILE.** (2026-09-24, RULING 248 / RULING 263; the vendor file is the
 * fallback since 2026-09-25.)
 *
 * The Web API's `EventAgendaFile` names the agenda PDF on
 * `legistar.granicus.com`, whose robots.txt reads `Disallow: /`. From
 * 2026-09-24 the ingest refused that host and read the agenda here instead.
 * Since the owner decision of 2026-09-25 robots.txt blocks nothing, and this
 * link is still read first — every such sitting read since 2026-09-24 holds its
 * versions under it — with the vendor's file as the fallback when the page
 * links no agenda or cannot be read (`scripts/ingest.ts`). The tenant publishes
 * the same agenda on its own portal host, which publishes no robots.txt (404,
 * docs/sources.md). The sitting's MeetingDetail page is `EventInSiteURL`, which
 * the API row already holds as its `provenance.sourceUrl`. That page links the
 * agenda as `…_hypAgenda` → `View.ashx?M=A&ID={portal id}&GUID=…`. The link
 * answers 200 `application/pdf` directly, with no redirect (measured
 * 2026-09-24 on Pima's 22 September sitting: API event 1828 → portal id
 * 1381577).
 *
 * Without this, the reader merge keeps the API row for a sitting both routes
 * carry, and it drops the portal row together with the document the portal
 * route read. The sitting then shows an agenda link and no agenda text.
 *
 * The portal numbers sittings in its own id space: `View.ashx` built from the
 * API's EventId and EventGuid answers 302 → `Confirmation.aspx?M1=Gone`
 * (measured the same day). So the link is read off the sitting's own page and
 * is never constructed.
 *
 * Reached only by the ingest, never by a reader surface.
 */

const MEETING_DETAIL_PAGE = /^https:\/\/[a-z0-9-]+\.legistar\.com\/MeetingDetail\.aspx\?/i;

/** A Legistar InSite MeetingDetail page for one sitting. */
export function isLegistarMeetingDetailUrl(url: string | null | undefined): url is string {
  return typeof url === "string" && MEETING_DETAIL_PAGE.test(url);
}

/**
 * Whether `url` is an agenda link on the same portal host as the sitting's
 * detail page, and so one this module could have read off that page.
 */
export function isPortalAgendaLinkFor(url: string, detailPageUrl: string): boolean {
  try {
    const link = new URL(url);
    return (
      link.host === new URL(detailPageUrl).host &&
      /\/View\.ashx$/i.test(link.pathname) &&
      link.searchParams.get("M") === "A"
    );
  } catch {
    return false;
  }
}

/**
 * The sitting's agenda link as its detail page publishes it (`…_hypAgenda`,
 * never the accessible `…_hypAgendaHTML` or the packet). It is resolved against
 * the page and kept only when it is a `View.ashx?M=A` link on the page's own
 * host. Null when the page publishes no agenda link: a document not yet posted
 * renders its anchor with no href, as the recorded page's minutes link does.
 */
export function portalAgendaLinkFrom(html: string, detailPageUrl: string): string | null {
  for (const tag of html.matchAll(/<a\b[^>]*>/gi)) {
    const id = /\bid\s*=\s*"([^"]*)"/i.exec(tag[0])?.[1] ?? "";
    if (!/_hypAgenda$/.test(id)) continue;
    const href = /\bhref\s*=\s*"([^"]*)"/i.exec(tag[0])?.[1];
    if (!href) return null;
    let resolved: string;
    try {
      resolved = new URL(href.replace(/&amp;/g, "&"), detailPageUrl).toString();
    } catch {
      return null;
    }
    return isPortalAgendaLinkFor(resolved, detailPageUrl) ? resolved : null;
  }
  return null;
}
