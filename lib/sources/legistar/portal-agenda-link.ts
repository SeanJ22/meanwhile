/**
 * The portal's own link to a sitting's agenda, read before the vendor's file. The Web API's
 * `EventAgendaFile` names a PDF on `legistar.granicus.com`; the tenant publishes the same agenda on its
 * own portal host. The sitting's MeetingDetail page (`EventInSiteURL`, already the API row's
 * `provenance.sourceUrl`) links it as `…_hypAgenda` → `View.ashx?M=A&ID={portal id}&GUID=…`, answering
 * 200 `application/pdf` directly. The vendor's file is the fallback when the page links no agenda or
 * cannot be read (`scripts/ingest.ts`).
 *
 * Without this, the reader merge keeps the API row for a sitting both routes carry and drops the portal
 * row with its document, so the sitting shows an agenda link and no agenda text.
 *
 * The portal numbers sittings in its own id space (a `View.ashx` built from the API's ids answers 302 →
 * `Confirmation.aspx?M1=Gone`), so the link is read off the sitting's own page, never constructed.
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
