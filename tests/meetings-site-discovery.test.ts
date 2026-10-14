import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  decideOutcome,
  meetingEndpointCandidates,
  pageLinks,
  recheckAfter,
  siteOrigins,
  verifyEndpointBody,
  type DiscoveryStep,
} from "../lib/hunt/meetings-site-discovery.ts";

const fixture = (name: string) => readFileSync(join(process.cwd(), "tests", "fixtures", name), "utf8");
const PAGE = "https://www.example-town.gov/";

function step(over: Partial<DiscoveryStep>): DiscoveryStep {
  return {
    purpose: "homepage", url: PAGE, permission: "ALLOWED", status: 200, transportError: null,
    bytes: 10, artifactId: null, rung: 2, note: "", ...over,
  };
}

test("ORIGINS: a recorded address becomes its https origin and its www/apex twin; an unusable one becomes nothing", () => {
  assert.deepEqual(siteOrigins("http://www.avondale.org"), ["https://www.avondale.org", "https://avondale.org"]);
  assert.deepEqual(siteOrigins("ajcity.net"), ["https://ajcity.net", "https://www.ajcity.net"]);
  assert.deepEqual(siteOrigins("https://www.Example.GOV/path?x=1"), ["https://www.example.gov", "https://example.gov"]);
  for (const bad of [null, "", "   ", "localhost", "ftp://example.gov", "192.168.1.10", "::::"]) {
    assert.deepEqual(siteOrigins(bad), [], `${String(bad)} is not a walkable site`);
  }
});

test("LINKS: hrefs and srcs resolve against the page; webcal reads as https; mailto, javascript and fragments are dropped", () => {
  const links = pageLinks(
    `<a href="/agendas">A</a> <a href='webcal://example-town.gov/cal.ics'>C</a> <a href="mailto:clerk@x.gov">M</a>
     <a href="javascript:void(0)">J</a> <a href="#top">T</a> <img src=/img/logo.png> <a href="https://x.gov/a?b=1&amp;c=2#frag">Q</a>`,
    PAGE,
  );
  assert.deepEqual(links, [
    "https://www.example-town.gov/agendas",
    "https://example-town.gov/cal.ics",
    "https://www.example-town.gov/img/logo.png",
    "https://x.gov/a?b=1&c=2",
  ]);
});

test("CANDIDATES: a linked vendor, a linked feed, CivicPlus markup and a CivicClerk embed each name a route; verifiable ones first", () => {
  const html = `
    <a href="https://www.novusagenda.com/AgendaPublic/?town=1">Agendas (NovusAgenda)</a>
    <a href="/government/agendas-minutes">Agendas &amp; Minutes</a>
    <img src="/images/agenda-banner.png">
    <a href="https://mesaaz.legistar.com/Calendar.aspx">Council calendar</a>
    <a href="/events/list/?ical=1">Subscribe</a>
    <a href="webcal://www.example-town.gov/meetings.ics">iCal</a>
    <a href="https://meetings.boardbook.org/Public/Organization/2065">School board</a>
    <a href="https://pima.iqm2.com/Citizens/Default.aspx">IQM2</a>
    <script src="/Common/Modules/foo.js"></script>
    <script>window.clerkEmbedProps = {"tenant": "AvondaleAZ", "other": 1};</script>`;
  const candidates = meetingEndpointCandidates(html, PAGE);
  assert.deepEqual(
    candidates.map((c) => [c.vendor, c.url, c.basis, c.verifiable]),
    [
      ["novusagenda", "https://www.novusagenda.com/AgendaPublic/MeetingsResponsive.aspx", "LINKED", true],
      ["legistar-insite", "https://mesaaz.legistar.com/Calendar.aspx", "LINKED", true],
      ["legistar-api", "https://webapi.legistar.com/v1/mesaaz/events?$top=5", "LINKED", true],
      ["ical", "https://www.example-town.gov/events/list/?ical=1", "LINKED", true],
      ["ical", "https://www.example-town.gov/meetings.ics", "LINKED", true],
      ["boardbook", "https://meetings.boardbook.org/Public/Organization/2065", "LINKED", true],
      ["iqm2", "https://pima.iqm2.com/Citizens/Calendar.aspx", "LINKED", true],
      ["civicplus-agendacenter", "https://www.example-town.gov/AgendaCenter", "SERVED_BY", true],
      ["civicclerk-api", "https://avondaleaz.api.civicclerk.com/v1/Events?$top=5", "EMBEDDED", true],
      ["own-site-meetings-page", "https://www.example-town.gov/government/agendas-minutes", "LINKED", false],
    ],
  );
  assert.equal(candidates.some((c) => c.url.endsWith(".png")), false, "an image is never a meetings page");
});

test("CANDIDATES: a page that evidences nothing names nothing, and no tenant is ever derived from a name", () => {
  const plain = meetingEndpointCandidates(`<h1>Town of Nowhere</h1><a href="/parks">Parks</a><a href="https://facebook.com/nowhere">f</a>`, PAGE);
  assert.deepEqual(plain, []);
  const named = meetingEndpointCandidates(`<p>Nowhere Township publishes on Legistar.</p>`, "https://nowhere.gov/");
  assert.deepEqual(named, [], "a vendor named in prose is not a link to a tenant");
});

test("VERIFY: an iCal route yields only with a VEVENT; an empty calendar is EMPTY, and an HTML shell at a feed URL is not a calendar", () => {
  const feed = { vendor: "ical", url: "https://x.gov/cal.ics" };
  const ics = fixture("civicplus-rockaway.ics");
  const yielded = verifyEndpointBody(feed, { status: 200, body: ics, finalUrl: feed.url });
  assert.equal(yielded.verdict, "YIELDED");
  assert.equal(yielded.count, (ics.match(/^BEGIN:VEVENT/gm) ?? []).length);
  assert.equal(verifyEndpointBody(feed, { status: 200, body: "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR", finalUrl: feed.url }).verdict, "EMPTY");
  assert.equal(verifyEndpointBody(feed, { status: 200, body: "<!DOCTYPE html><html>Invalid feed</html>", finalUrl: feed.url }).verdict, "NOT_CONFIRMED");
  assert.equal(verifyEndpointBody(feed, { status: 500, body: ics, finalUrl: feed.url }).verdict, "NOT_CONFIRMED", "only a 2xx carries a route");
  assert.equal(verifyEndpointBody(feed, { status: null, body: ics, finalUrl: feed.url }).verdict, "NOT_CONFIRMED");
});

test("VERIFY: Legistar, CivicPlus, IQM2 and CivicClerk yield only by their own content", () => {
  const insite = verifyEndpointBody(
    { vendor: "legistar-insite", url: "https://mesaaz.legistar.com/Calendar.aspx" },
    { status: 200, body: fixture("legistar-insite-mesa-calendar-next-month.html"), finalUrl: "https://mesaaz.legistar.com/Calendar.aspx" },
  );
  assert.equal(insite.verdict, "YIELDED");
  assert.match(insite.detail, /Feed\.ashx\?M=Calendar/);

  const api = { vendor: "legistar-api", url: "https://webapi.legistar.com/v1/mesaaz/events?$top=5" };
  assert.deepEqual(verifyEndpointBody(api, { status: 200, body: JSON.stringify([{ EventId: 1 }, { EventId: 2 }]), finalUrl: api.url }).count, 2);
  assert.equal(verifyEndpointBody(api, { status: 200, body: "[]", finalUrl: api.url }).verdict, "EMPTY");
  assert.equal(verifyEndpointBody(api, { status: 200, body: JSON.stringify([{ Name: "x" }]), finalUrl: api.url }).verdict, "NOT_CONFIRMED");
  assert.equal(verifyEndpointBody(api, { status: 200, body: "{}", finalUrl: api.url }).verdict, "NOT_CONFIRMED");

  const agenda = verifyEndpointBody(
    { vendor: "civicplus-agendacenter", url: "https://www.rockawaytownship.org/AgendaCenter" },
    { status: 200, body: fixture("civicplus-rockaway-agendacenter.html"), finalUrl: "https://www.rockawaytownship.org/AgendaCenter" },
  );
  assert.equal(agenda.verdict, "YIELDED");
  assert.ok((agenda.count ?? 0) > 0);
  assert.equal(
    verifyEndpointBody({ vendor: "civicplus-agendacenter", url: "https://x.gov/AgendaCenter" }, { status: 200, body: "<html>Welcome</html>", finalUrl: "https://x.gov/AgendaCenter" }).verdict,
    "NOT_CONFIRMED",
  );

  const iqm2 = verifyEndpointBody(
    { vendor: "iqm2", url: "https://morris.iqm2.com/Citizens/Calendar.aspx" },
    { status: 200, body: fixture("iqm2/morris-calendar.html"), finalUrl: "https://morris.iqm2.com/Citizens/Calendar.aspx" },
  );
  assert.equal(iqm2.verdict, "YIELDED");

  const clerk = { vendor: "civicclerk-api", url: "https://t.api.civicclerk.com/v1/Events?$top=5" };
  assert.equal(verifyEndpointBody(clerk, { status: 200, body: JSON.stringify({ value: [{ id: 7 }] }), finalUrl: clerk.url }).verdict, "YIELDED");
  assert.equal(verifyEndpointBody(clerk, { status: 200, body: JSON.stringify({ value: [] }), finalUrl: clerk.url }).verdict, "EMPTY");
  assert.equal(verifyEndpointBody({ vendor: "novusagenda", url: "https://x.novusagenda.com/" }, { status: 200, body: "<html/>", finalUrl: "https://x.novusagenda.com/" }).verdict, "NOT_CONFIRMED");
});

test("OUTCOME: found beats lead beats a read homepage; walled everywhere (an access control) is BLOCKED, a robots.txt verdict never is; a redirect is a hop, not an answer", () => {
  assert.equal(decideOutcome({ found: [1], leads: [1], steps: [] }), "FOUND");
  assert.equal(decideOutcome({ found: [], leads: [1], steps: [] }), "LEAD");
  assert.equal(decideOutcome({ found: [], leads: [], steps: [step({})] }), "NOTHING_DETECTED");
  assert.equal(
    decideOutcome({ found: [], leads: [], steps: [step({ permission: "DISALLOWED" })] }),
    "NOTHING_DETECTED",
    "a homepage read over a Disallow is a read (owner decision 2026-09-25)",
  );
  const walled = step({ status: null, permission: "RECORDED_WALL", rung: null });
  /* An unrequested DISALLOWED step from an older walk is not a wall. */
  const skippedForRobots = { ...walled, url: "https://www.example.gov/", permission: "DISALLOWED" as const };
  const robotsOf = (over: Partial<DiscoveryStep>) => step({ purpose: "robots", url: "https://www.example.gov/robots.txt", permission: "CANNOT_TELL", ...over });
  assert.equal(
    decideOutcome({ found: [], leads: [], steps: [walled, robotsOf({ status: 403 }), step({ url: "https://www.example.gov/", status: 403 })] }),
    "BLOCKED",
    "a recorded wall on one origin and the site's own 403 on the other: every origin is walled by an access control",
  );
  assert.equal(
    decideOutcome({ found: [], leads: [], steps: [walled, skippedForRobots] }),
    "COULD_NOT_READ",
    "a step skipped for robots.txt alone is not a wall",
  );
  assert.equal(
    decideOutcome({ found: [], leads: [], steps: [walled, robotsOf({ status: null, transportError: "getaddrinfo ENOTFOUND" }), step({ url: "https://www.example.gov/", status: null, transportError: "getaddrinfo ENOTFOUND" })] }),
    "COULD_NOT_READ",
    "an origin that could not be reached refused nothing",
  );
  assert.equal(
    decideOutcome({ found: [], leads: [], steps: [step({ status: 403 }), walled] }),
    "BLOCKED",
    "a homepage that answers this client 403 is the host walling it, as much as a recorded wall is",
  );
  assert.equal(decideOutcome({ found: [], leads: [], steps: [step({ status: 404 }), walled] }), "COULD_NOT_READ", "a 404 homepage is not a wall");
  assert.equal(
    decideOutcome({ found: [], leads: [], steps: [step({ status: 301, note: "redirected" }), walled] }),
    "BLOCKED",
    "a homepage that redirects onto a recorded wall is a wall, not an unreadable site",
  );
  assert.equal(decideOutcome({ found: [], leads: [], steps: [step({ status: 503 })] }), "COULD_NOT_READ");
  assert.equal(decideOutcome({ found: [], leads: [], steps: [step({ status: null, transportError: "ETIMEDOUT" })] }), "COULD_NOT_READ");
  assert.equal(decideOutcome({ found: [], leads: [], steps: [] }), "COULD_NOT_READ");
  assert.equal(recheckAfter("2026-09-23T00:00:00.000Z"), "2026-09-23T12:00:00.000Z");
  assert.equal(recheckAfter("2026-09-23T00:00:00.000Z", ["2026-09-22T12:00:00.000Z"]), "2026-09-23T01:00:00.000Z");
});
