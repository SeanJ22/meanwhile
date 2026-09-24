import assert from "node:assert/strict";
import test from "node:test";
import { DISALLOWED_LEGISTAR_HOSTS, LEGISTAR_ROUTES, isDisallowedLegistarHost } from "../lib/sources/legistar/routes.ts";
import { agendaRetrievalRefusal } from "../scripts/ingest.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { agendaDocumentStore } from "../lib/meetings/agenda-documents.ts";
import { isLegistarMeetingDetailUrl, isPortalAgendaLinkFor, portalAgendaLinkFrom } from "../lib/sources/legistar/portal-agenda-link.ts";

/**
 * A host the route catalogue records as DISALLOWED is never requested for an
 * agenda (2026-09-24). legistar.granicus.com answers robots.txt with
 * `User-agent: * / Disallow: /`; GRANICUS_AGENDA_PDF said "recorded here, never
 * fetched", yet Pima's agenda PDFs were requested from it on 2026-09-02 because
 * the ingest refused only retired routes' hosts.
 */

test("the refused hosts are derived from the catalogue's own DISALLOWED routes", () => {
  const disallowed = LEGISTAR_ROUTES.filter((route) => route.disposition === "DISALLOWED");
  assert.ok(disallowed.length >= 2);
  assert.deepEqual(DISALLOWED_LEGISTAR_HOSTS, ["legistar.granicus.com"]);
  assert.ok(!DISALLOWED_LEGISTAR_HOSTS.some((host) => host.includes("{")), "a templated host is never a refused host");
});

test("an agenda link on a disallowed host is held as a link, never read; permitted hosts are unaffected", () => {
  const pimaSept22 = "https://legistar.granicus.com/pima/meetings/2026/9/1828_A_Board_of_Supervisors_26-09-22_Online_Agenda.pdf";
  assert.equal(isDisallowedLegistarHost(pimaSept22), true);
  assert.equal(agendaRetrievalRefusal(pimaSept22), "RECORDED_DISALLOWED");
  assert.equal(agendaRetrievalRefusal("https://pima.community.highbond.com/Portal/MeetingInformation.aspx?Id=1"), "RETIRED_ROUTE");
  assert.equal(agendaRetrievalRefusal("https://www.rockawaytownship.org/AgendaCenter/ViewFile/Agenda/_07142026-1020"), null);
  assert.equal(agendaRetrievalRefusal("https://mesa.legistar.com/View.ashx?M=A&ID=1&GUID=x"), null, "a tenant's own InSite host is not the granicus file host");
  assert.equal(agendaRetrievalRefusal("not a url"), null);
});

test("the ingest's agenda retrieval never requests a DISALLOWED host, and still requests a permitted one", async () => {
  const { retrieveAgendas } = await import("../scripts/ingest.ts");
  const requested: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    requested.push(url);
    return new Response("<html><body><h1>Agenda</h1><p>1. Call to order.</p><p>2. Adjourn.</p></body></html>", { status: 200, headers: { "content-type": "text/html" } });
  }) as typeof fetch;
  const meeting = (id: string, agendaUrl: string) => ({
    id, ocdId: "ocd-division/country:us/state:az/county:pima", bodyId: "ocd-division/country:us/state:az/county:pima#governing",
    bodyName: "Board of Supervisors", title: "Board of Supervisors", startsAt: "2026-09-22T17:00:00-07:00", timeZone: "America/Phoenix",
    location: null, agendaUrl, jurisdiction: "Pima County, AZ", status: "CONCLUDED" as const,
    provenance: { sourceUrl: "https://pima.legistar.com/Calendar.aspx", sourceOrg: "Pima County Clerk of the Board", collectedAt: "2026-09-24T09:00:00Z", verifiedAt: null },
  });
  try {
    await retrieveAgendas([
      meeting("legistar:pima:990001", "https://legistar.granicus.com/pima/meetings/2026/9/990001_A_Board_of_Supervisors_26-09-22_Online_Agenda.pdf"),
      meeting("legistar:pima:990002", "https://webapi.legistar.com/v1/pima/events/990002/agenda-test.html"),
    ] as never);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.ok(!requested.some((url) => new URL(url).hostname === "legistar.granicus.com"), `a disallowed host was requested: ${requested.join(", ")}`);
  assert.ok(requested.some((url) => new URL(url).hostname === "webapi.legistar.com"), `the permitted host was not requested: ${requested.join(", ")}`);
});

/**
 * Every redirect hop is asked the same question (2026-09-24). `fetch` follows
 * redirects by itself, so the refusal above held only for the first hop: a
 * permitted link redirecting into `legistar.granicus.com` would have been read.
 */
test("a permitted agenda link that redirects into a refused host is held as a link, and the refused host is never requested", async () => {
  const { retrieveAgendas } = await import("../scripts/ingest.ts");
  const requested: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    requested.push(url);
    const host = new URL(url).hostname;
    if (init?.redirect !== "manual") throw new Error(`agenda retrieval asked fetch to follow redirects itself for ${url}`);
    if (host === "redirecting.example.gov") {
      return new Response(null, { status: 302, headers: { location: "https://legistar.granicus.com/pima/meetings/2026/9/990003_A_Agenda.pdf" } });
    }
    if (host === "moved.example.gov" && !url.includes("/agendas/")) {
      return new Response(null, { status: 301, headers: { location: "/agendas/990004.html" } });
    }
    return new Response("<html><body><h1>Agenda</h1><p>1. Call to order.</p><p>2. Adjourn.</p></body></html>", { status: 200, headers: { "content-type": "text/html" } });
  }) as typeof fetch;
  const meeting = (id: string, agendaUrl: string) => ({
    id, ocdId: "ocd-division/country:us/state:az/county:pima", bodyId: "ocd-division/country:us/state:az/county:pima#governing",
    bodyName: "Board of Supervisors", title: "Board of Supervisors", startsAt: "2026-09-22T17:00:00-07:00", timeZone: "America/Phoenix",
    location: null, agendaUrl, jurisdiction: "Pima County, AZ", status: "CONCLUDED" as const,
    provenance: { sourceUrl: "https://pima.legistar.com/Calendar.aspx", sourceOrg: "Pima County Clerk of the Board", collectedAt: "2026-09-24T09:00:00Z", verifiedAt: null },
  });
  const logged: string[] = [];
  const realLog = console.log;
  console.log = (...args: unknown[]) => { logged.push(args.map(String).join(" ")); };
  try {
    await retrieveAgendas([
      meeting("legistar:pima:990003", "https://redirecting.example.gov/View.ashx?M=A&ID=990003"),
      meeting("legistar:pima:990004", "https://moved.example.gov/agenda/990004"),
    ] as never);
  } finally {
    globalThis.fetch = realFetch;
    console.log = realLog;
  }
  assert.ok(!requested.some((url) => new URL(url).hostname === "legistar.granicus.com"), `a refused host was requested through a redirect: ${requested.join(", ")}`);
  assert.ok(requested.includes("https://redirecting.example.gov/View.ashx?M=A&ID=990003"), "the permitted first hop is still requested");
  assert.ok(requested.includes("https://moved.example.gov/agendas/990004.html"), `a permitted redirect is still followed: ${requested.join(", ")}`);
  assert.ok(logged.some((line) => line.includes("agenda link held as a link for legistar:pima:990003") && line.includes("recorded DISALLOWED")), logged.join("\n"));
  assert.ok(logged.some((line) => line.includes("1 redirect(s) into a refused host not followed") && /, 1 stored, .*, 0 failed, /.test(line)), logged.join("\n"));
});

/**
 * A refused API agenda link is read through the portal's own link to the same
 * agenda (2026-09-24). Pima's 22 September sitting: the API's EventAgendaFile
 * is on legistar.granicus.com, and the sitting's detail page (EventInSiteURL,
 * held as provenance.sourceUrl) links the agenda on pima.legistar.com. The
 * excerpt is recorded; the network below is a stub.
 */
const DETAIL_1828 = "https://pima.legistar.com/MeetingDetail.aspx?LEGID=1828&GID=243&G=7B470E9E-E35C-4698-8FA6-D778FB28F394";
const PORTAL_AGENDA_1828 = "https://pima.legistar.com/View.ashx?M=A&ID=1381577&GUID=00EFD752-6A28-42D3-B329-E717E49891D0&G=7B470E9E-E35C-4698-8FA6-D778FB28F394";
const detailExcerpt = readFileSync(join(import.meta.dirname, "fixtures", "legistar-insite-pima-meetingdetail-1828-excerpt.html"), "utf8");

test("the recorded detail page's agenda link is read, never the accessible copy, and an unposted agenda reads as none", () => {
  assert.equal(isLegistarMeetingDetailUrl(DETAIL_1828), true);
  assert.equal(isLegistarMeetingDetailUrl("https://pima.legistar.com/Calendar.aspx"), false);
  assert.equal(portalAgendaLinkFrom(detailExcerpt, DETAIL_1828), PORTAL_AGENDA_1828);
  const accessibleFirst = '<a id="ctl00_ContentPlaceHolder1_hypAgendaHTML" href="View.ashx?M=AADA&amp;ID=1381577&amp;GUID=00EFD752-6A28-42D3-B329-E717E49891D0">Accessible Agenda</a>' + detailExcerpt;
  assert.equal(portalAgendaLinkFrom(accessibleFirst, DETAIL_1828), PORTAL_AGENDA_1828, "the accessible rendering is never taken for the agenda");
  // The recorded page renders its unposted minutes as an anchor with no href; an unposted agenda has the same shape.
  const unposted = detailExcerpt.replace(/<a id="ctl00_ContentPlaceHolder1_hypAgenda" href="[^"]*"/, '<a id="ctl00_ContentPlaceHolder1_hypAgenda" class="minuteNotAvaliableLink"');
  assert.equal(portalAgendaLinkFrom(unposted, DETAIL_1828), null);
  const offHost = detailExcerpt.replace('href="View.ashx?M=A&amp;ID=1381577', 'href="https://legistar.granicus.com/View.ashx?M=A&amp;ID=1381577');
  assert.equal(portalAgendaLinkFrom(offHost, DETAIL_1828), null, "a link off the portal's own host is never taken");
  assert.equal(isPortalAgendaLinkFor(PORTAL_AGENDA_1828, DETAIL_1828), true);
  assert.equal(isPortalAgendaLinkFor("https://legistar.granicus.com/pima/meetings/2026/9/1828_A_Board_of_Supervisors_26-09-22_Online_Agenda.pdf", DETAIL_1828), false);
});

test("a refused API agenda link is read through the sitting's portal link, stored on the API row, and the page is read once", async () => {
  const { retrieveAgendas } = await import("../scripts/ingest.ts");
  const requested: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    requested.push(url);
    if (url === DETAIL_1828) return new Response(detailExcerpt, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
    if (url === PORTAL_AGENDA_1828) {
      return new Response("<html><body><h1>Board of Supervisors</h1><p>18. Data Center Development Standards. File ID 20801.</p><p>19. Adjourn.</p></body></html>", { status: 200, headers: { "content-type": "text/html" } });
    }
    return new Response("unexpected", { status: 404 });
  }) as typeof fetch;
  const sept22 = {
    id: "legistar:pima:1828", ocdId: "ocd-division/country:us/state:az/county:pima", bodyId: "ocd-division/country:us/state:az/county:pima#governing",
    bodyName: "Board of Supervisors", title: "Board of Supervisors", startsAt: "2026-09-22T17:00:00-07:00", timeZone: "America/Phoenix",
    location: null, agendaUrl: "https://legistar.granicus.com/pima/meetings/2026/9/1828_A_Board_of_Supervisors_26-09-22_Online_Agenda.pdf",
    jurisdiction: "Pima County, AZ", status: "CONCLUDED" as const,
    provenance: { sourceUrl: DETAIL_1828, sourceOrg: "Pima County Clerk of the Board", collectedAt: "2026-09-24T09:00:00Z", verifiedAt: null },
  };
  const logged: string[] = [];
  const realLog = console.log;
  console.log = (...args: unknown[]) => { logged.push(args.map(String).join(" ")); };
  try {
    await retrieveAgendas([sept22] as never);
    await retrieveAgendas([sept22] as never);
  } finally {
    globalThis.fetch = realFetch;
    console.log = realLog;
  }
  assert.ok(!requested.some((url) => new URL(url).hostname === "legistar.granicus.com"), `the refused host was requested: ${requested.join(", ")}`);
  assert.equal(requested.filter((url) => url === DETAIL_1828).length, 1, `the detail page is read once, then its link is reused: ${requested.join(", ")}`);
  assert.equal(requested.filter((url) => url === PORTAL_AGENDA_1828).length, 2, "the portal agenda is read on each pass");
  const held = agendaDocumentStore.latestFor("legistar:pima:1828");
  assert.ok(held, "the agenda is stored on the API row the reader merge keeps");
  assert.equal(held.documentUrl, PORTAL_AGENDA_1828, "and records the permitted link it was actually read from");
  assert.match(held.text ?? "", /Data Center Development Standards/);
  assert.ok(logged.some((line) => /, 1 refused link\(s\) read through the portal, 0 whose portal page links no agenda yet/.test(line)), logged.join("\n"));
});
