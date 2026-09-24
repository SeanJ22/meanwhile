import assert from "node:assert/strict";
import test from "node:test";
import { DISALLOWED_LEGISTAR_HOSTS, LEGISTAR_ROUTES, isDisallowedLegistarHost } from "../lib/sources/legistar/routes.ts";
import { agendaRetrievalRefusal } from "../scripts/ingest.ts";

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
