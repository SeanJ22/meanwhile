import { withSourceTransport } from "./helpers/source-fetch.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { LEGISTAR_DOCUMENT_HOSTS, LEGISTAR_ROUTES, findRoute, isLegistarDocumentHost } from "../lib/sources/legistar/routes.ts";
import { agendaRetrievalRefusal } from "../scripts/ingest.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { agendaDocumentStore } from "../lib/meetings/agenda-documents.ts";
import { isLegistarMeetingDetailUrl, isPortalAgendaLinkFor, portalAgendaLinkFrom } from "../lib/sources/legistar/portal-agenda-link.ts";

const AGENDA_HTML = "<html><body><h1>Agenda</h1><p>1. Call to order.</p><p>2. Adjourn.</p></body></html>";
const DEAD_RETIRED_HOST_URL = "https://newburynh.civicweb.net/Portal/MeetingInformation.aspx?Id=3370";
/** A real agenda PDF with a text layer, standing in for the vendor's file. */
const AGENDA_PDF = readFileSync(join(import.meta.dirname, "fixtures", "pima-edu", "agenda-2026-08-10.pdf"));
const vendorPdf = () => new Response(new Uint8Array(AGENDA_PDF), { status: 200, headers: { "content-type": "application/pdf" } });

test("the vendor's document hosts are derived from the catalogue, and no route carries a robots disposition", () => {
  assert.deepEqual(LEGISTAR_DOCUMENT_HOSTS, ["legistar.granicus.com"]);
  assert.ok(!LEGISTAR_DOCUMENT_HOSTS.some((host) => host.includes("{")), "a templated host is a tenant portal, never a document host");
  assert.ok(
    LEGISTAR_ROUTES.every((route) => route.disposition === "WALKED" || route.disposition === "REQUIRES_NEW_ADAPTER"),
    "a route is walked or not built yet; robots.txt is never its disposition",
  );
  assert.equal(findRoute("GRANICUS_AGENDA_PDF")?.disposition, "WALKED", "the agenda file is read (the portal link first, this file as the fallback)");
  assert.equal(findRoute("GRANICUS_MINUTES_PDF")?.disposition, "REQUIRES_NEW_ADAPTER", "the minutes file waits on a reader, not on permission");
  for (const id of ["GRANICUS_AGENDA_PDF", "GRANICUS_MINUTES_PDF"]) {
    const note = findRoute(id)!.note;
    assert.match(note, /Disallow: \//, `${id} keeps the robots.txt reading as evidence`);
    assert.match(note, /owner decision of 2026-09-25/, `${id} says the reading no longer blocks`);
  }
});

test("a robots-disallowed agenda host is read; only a dead retired route's host is held as a link", () => {
  const pimaSept22 = "https://legistar.granicus.com/pima/meetings/2026/9/1828_A_Board_of_Supervisors_26-09-22_Online_Agenda.pdf";
  assert.equal(isLegistarDocumentHost(pimaSept22), true);
  assert.equal(agendaRetrievalRefusal(pimaSept22), null, "robots.txt alone never refuses an agenda read");
  assert.equal(
    agendaRetrievalRefusal("https://pima.community.highbond.com/Portal/MeetingInformation.aspx?Org=Cal&Id=698"),
    null,
    "a route retired for robots.txt alone keeps its host readable",
  );
  assert.equal(agendaRetrievalRefusal(DEAD_RETIRED_HOST_URL), "RETIRED_ROUTE", "a retired route whose host is gone is held as a link");
  assert.equal(agendaRetrievalRefusal("https://www.rockawaytownship.org/AgendaCenter/ViewFile/Agenda/_07142026-1020"), null);
  assert.equal(agendaRetrievalRefusal("https://mesa.legistar.com/View.ashx?M=A&ID=1&GUID=x"), null);
  assert.equal(isLegistarDocumentHost("https://mesa.legistar.com/View.ashx?M=A&ID=1&GUID=x"), false, "a tenant's own InSite host is not the vendor's document host");
  assert.equal(agendaRetrievalRefusal("not a url"), null);
});

const pimaMeeting = (id: string, agendaUrl: string, sourceUrl = "https://pima.legistar.com/Calendar.aspx") => ({
  id, ocdId: "ocd-division/country:us/state:az/county:pima", bodyId: "ocd-division/country:us/state:az/county:pima#governing",
  bodyName: "Board of Supervisors", title: "Board of Supervisors", startsAt: "2026-09-22T17:00:00-07:00", timeZone: "America/Phoenix",
  location: null, agendaUrl, jurisdiction: "Pima County, AZ", status: "CONCLUDED" as const,
  provenance: { sourceUrl, sourceOrg: "Pima County Clerk of the Board", collectedAt: "2026-09-24T09:00:00Z", verifiedAt: null },
});

async function run(meetings: unknown[], respond: (url: string, init?: RequestInit) => Response): Promise<{ requested: string[]; logged: string[] }> {
  const { retrieveMeetingDocuments } = await import("../scripts/ingest.ts");
  const requested: string[] = [];
  const logged: string[] = [];
  const realLog = console.log;
  const transport = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    requested.push(url);
    return respond(url, init);
  }) as typeof fetch;
  console.log = (...args: unknown[]) => { logged.push(args.map(String).join(" ")); };
  try {
    await withSourceTransport(transport, () => retrieveMeetingDocuments(meetings as never));
  } finally {
    console.log = realLog;
  }
  return { requested, logged };
}

test("the ingest's agenda retrieval reads a robots-disallowed vendor host, and holds only a dead retired host's link", async () => {
  const vendor = "https://legistar.granicus.com/pima/meetings/2026/9/990001_A_Board_of_Supervisors_26-09-22_Online_Agenda.pdf";
  const { requested } = await run(
    [
      // No detail page on the row, so there is no portal route: the vendor file is the route.
      pimaMeeting("legistar:pima:990001", vendor),
      pimaMeeting("legistar:pima:990002", "https://webapi.legistar.com/v1/pima/events/990002/agenda-test.html"),
      pimaMeeting("legistar:pima:990006", DEAD_RETIRED_HOST_URL),
    ],
    (url) => new URL(url).hostname === "legistar.granicus.com"
      ? vendorPdf()
      : new Response(AGENDA_HTML, { status: 200, headers: { "content-type": "text/html" } }),
  );
  assert.ok(requested.includes(vendor), `the vendor host was not read: ${requested.join(", ")}`);
  assert.equal(agendaDocumentStore.latestFor("legistar:pima:990001")?.extraction, "pdf", "and its text layer is read");
  assert.ok(requested.some((url) => new URL(url).hostname === "webapi.legistar.com"), `the API host was not read: ${requested.join(", ")}`);
  assert.ok(!requested.some((url) => new URL(url).hostname === "newburynh.civicweb.net"), "a host that no longer resolves is never requested");
  assert.equal(agendaDocumentStore.latestFor("legistar:pima:990001")?.documentUrl, vendor, "the vendor's agenda is stored");
  assert.equal(agendaDocumentStore.latestFor("legistar:pima:990006"), null);
});

test("an agenda link that redirects into a dead retired host is held as a link; a redirect into a robots-disallowed host is followed", async () => {
  const vendor = "https://legistar.granicus.com/pima/meetings/2026/9/990003_A_Agenda.pdf";
  const { requested } = await run(
    [
      pimaMeeting("legistar:pima:990003", "https://redirecting.example.gov/View.ashx?M=A&ID=990003"),
      pimaMeeting("legistar:pima:990004", "https://moved.example.gov/agenda/990004"),
      pimaMeeting("legistar:pima:990007", "https://to-dead.example.gov/agenda/990007"),
    ],
    (url, init) => {
      if (init?.redirect !== "manual") throw new Error(`agenda retrieval asked fetch to follow redirects itself for ${url}`);
      const parsed = new URL(url);
      if (parsed.hostname === "redirecting.example.gov") return new Response(null, { status: 302, headers: { location: vendor } });
      if (parsed.hostname === "moved.example.gov" && !url.includes("/agendas/")) return new Response(null, { status: 301, headers: { location: "/agendas/990004.html" } });
      if (parsed.hostname === "to-dead.example.gov") return new Response(null, { status: 302, headers: { location: DEAD_RETIRED_HOST_URL } });
      if (parsed.hostname === "legistar.granicus.com") return vendorPdf();
      return new Response(AGENDA_HTML, { status: 200, headers: { "content-type": "text/html" } });
    },
  );
  assert.ok(requested.includes(vendor), `a redirect into the robots-disallowed vendor host was not followed: ${requested.join(", ")}`);
  assert.ok(requested.includes("https://moved.example.gov/agendas/990004.html"), `a redirect is still followed: ${requested.join(", ")}`);
  assert.ok(!requested.some((url) => new URL(url).hostname === "newburynh.civicweb.net"), `a dead retired host was requested through a redirect: ${requested.join(", ")}`);
  assert.ok(requested.includes("https://to-dead.example.gov/agenda/990007"), "the first hop is still requested");
});

const DETAIL_1828 = "https://pima.legistar.com/MeetingDetail.aspx?LEGID=1828&GID=243&G=7B470E9E-E35C-4698-8FA6-D778FB28F394";
const PORTAL_AGENDA_1828 = "https://pima.legistar.com/View.ashx?M=A&ID=1381577&GUID=00EFD752-6A28-42D3-B329-E717E49891D0&G=7B470E9E-E35C-4698-8FA6-D778FB28F394";
const detailExcerpt = readFileSync(join(import.meta.dirname, "fixtures", "legistar-insite-pima-meetingdetail-1828-excerpt.html"), "utf8");
const unpostedExcerpt = detailExcerpt.replace(/<a id="ctl00_ContentPlaceHolder1_hypAgenda" href="[^"]*"/, '<a id="ctl00_ContentPlaceHolder1_hypAgenda" class="minuteNotAvaliableLink"');

test("the recorded detail page's agenda link is read, never the accessible copy, and an unposted agenda reads as none", () => {
  assert.equal(isLegistarMeetingDetailUrl(DETAIL_1828), true);
  assert.equal(isLegistarMeetingDetailUrl("https://pima.legistar.com/Calendar.aspx"), false);
  assert.equal(portalAgendaLinkFrom(detailExcerpt, DETAIL_1828), PORTAL_AGENDA_1828);
  const accessibleFirst = '<a id="ctl00_ContentPlaceHolder1_hypAgendaHTML" href="View.ashx?M=AADA&amp;ID=1381577&amp;GUID=00EFD752-6A28-42D3-B329-E717E49891D0">Accessible Agenda</a>' + detailExcerpt;
  assert.equal(portalAgendaLinkFrom(accessibleFirst, DETAIL_1828), PORTAL_AGENDA_1828, "the accessible rendering is never taken for the agenda");
  // The recorded page renders its unposted minutes as an anchor with no href; an unposted agenda has the same shape.
  assert.equal(portalAgendaLinkFrom(unpostedExcerpt, DETAIL_1828), null);
  const offHost = detailExcerpt.replace('href="View.ashx?M=A&amp;ID=1381577', 'href="https://legistar.granicus.com/View.ashx?M=A&amp;ID=1381577');
  assert.equal(portalAgendaLinkFrom(offHost, DETAIL_1828), null, "a link off the portal's own host is never taken");
  assert.equal(isPortalAgendaLinkFor(PORTAL_AGENDA_1828, DETAIL_1828), true);
  assert.equal(isPortalAgendaLinkFor("https://legistar.granicus.com/pima/meetings/2026/9/1828_A_Board_of_Supervisors_26-09-22_Online_Agenda.pdf", DETAIL_1828), false);
});

test("a vendor-host API agenda link is read through the sitting's portal link first, stored on the API row, and the page is read once", async () => {
  const vendor = "https://legistar.granicus.com/pima/meetings/2026/9/1828_A_Board_of_Supervisors_26-09-22_Online_Agenda.pdf";
  const sept22 = pimaMeeting("legistar:pima:1828", vendor, DETAIL_1828);
  const respond = (url: string) => {
    if (url === DETAIL_1828) return new Response(detailExcerpt, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
    if (url === PORTAL_AGENDA_1828) {
      return new Response("<html><body><h1>Board of Supervisors</h1><p>18. Data Center Development Standards. File ID 20801.</p><p>19. Adjourn.</p></body></html>", { status: 200, headers: { "content-type": "text/html" } });
    }
    return new Response("unexpected", { status: 404 });
  };
  const first = await run([sept22], respond);
  const second = await run([sept22], respond);
  const requested = [...first.requested, ...second.requested];
  assert.ok(!requested.includes(vendor), `the vendor file is the fallback, and the portal linked the agenda: ${requested.join(", ")}`);
  assert.equal(requested.filter((url) => url === DETAIL_1828).length, 1, `the detail page is read once, then its link is reused: ${requested.join(", ")}`);
  assert.equal(requested.filter((url) => url === PORTAL_AGENDA_1828).length, 2, "the portal agenda is read on each pass");
  const held = agendaDocumentStore.latestFor("legistar:pima:1828");
  assert.ok(held, "the agenda is stored on the API row the reader merge keeps");
  assert.equal(held.documentUrl, PORTAL_AGENDA_1828, "and records the link it was actually read from");
  assert.equal(held.sourceUrl, PORTAL_AGENDA_1828, "its provenance is the portal URL it was read from");
  assert.match(held.text ?? "", /Data Center Development Standards/);

});

test("when the portal page links no agenda, or cannot be read, the vendor's file is read instead", async () => {
  const detail = (n: number) => `https://pima.legistar.com/MeetingDetail.aspx?LEGID=${n}&GID=243&G=00000000-0000-0000-0000-00000000000${n % 10}`;
  const vendor = (n: number) => `https://legistar.granicus.com/pima/meetings/2026/10/${n}_A_Board_of_Supervisors_26-10-13_Online_Agenda.pdf`;
  const rows = [
    pimaMeeting("legistar:pima:990005", vendor(990005), detail(990005)),
    pimaMeeting("legistar:pima:990008", vendor(990008), detail(990008)),
    pimaMeeting("legistar:pima:990009", vendor(990009), detail(990009)),
  ];
  const { requested } = await run(rows, (url, init) => {
    if (init?.redirect !== "manual") throw new Error(`requested with redirects left to fetch: ${url}`);
    // Posted on the vendor's host, not yet linked from the portal page.
    if (url === detail(990005)) return new Response(unpostedExcerpt, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
    // The portal page is down.
    if (url === detail(990008)) return new Response("unavailable", { status: 503 });
    // The portal page redirects into a host that no longer resolves: never followed.
    if (url === detail(990009)) return new Response(null, { status: 302, headers: { location: DEAD_RETIRED_HOST_URL } });
    if (new URL(url).hostname === "legistar.granicus.com") return vendorPdf();
    return new Response("unexpected", { status: 404 });
  });
  for (const n of [990005, 990008, 990009]) {
    if (n === 990009) assert.ok(!requested.includes(detail(n)), "the publisher remains on hold after its 503");
    else assert.ok(requested.indexOf(detail(n)) >= 0 && requested.indexOf(detail(n)) < requested.indexOf(vendor(n)), `the portal page first, then the vendor file, for ${n}: ${requested.join(", ")}`);
    const held = agendaDocumentStore.latestFor(`legistar:pima:${n}`);
    assert.equal(held?.documentUrl, vendor(n), `the vendor's agenda is stored for ${n}`);
    assert.equal(held?.extraction, "pdf", `and read for ${n}`);
  }
  assert.ok(!requested.some((url) => new URL(url).hostname === "newburynh.civicweb.net"), "a dead retired host is never requested");
});
