import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { MEETING_PARTITION_CONTRACTS, meetingPartitionId } from "../lib/civic-data/meeting-partitions.ts";
import { authorityFor } from "../lib/civic-data/source-authority.ts";
import { ROBOTS_BLOCKS_ACQUISITION, evaluatePermission } from "../lib/control-plane/scheduler/robots.ts";
import { RETIRED_MEETING_ROUTES, isUnreadableRetiredMeetingHost, meetingSourceNamesForWiring, type BodySourceWiring } from "../lib/registry/source-wiring.ts";
import { FIXTURE_DOOR_ROWS } from "./helpers/meeting-doors-fixture.ts";
import { agendaRetrievalRefusal } from "../scripts/ingest.ts";
import { agendaDocumentStore } from "../lib/meetings/agenda-documents.ts";

/**
 * A proved source cutover disables its old writer in the same transaction: never two authoritative clocks,
 * never none. A retirement closes a route's clock, and closes its host only when there is nothing there to
 * read; robots.txt alone closes nothing.
 */
const PCC = "curated:az/pima-community-college#governing";

const ROOT = join(import.meta.dirname, "..");

test("every retired route has exactly one wired successor for the same body, and no clock of its own", () => {
  assert.ok(RETIRED_MEETING_ROUTES.length >= 1);
  for (const retired of RETIRED_MEETING_ROUTES) {
    const rows = FIXTURE_DOOR_ROWS.filter((row) => row.bodyId === retired.bodyId);
    assert.equal(rows.length, 1, `${retired.bodyId} should have exactly one wiring row`);
    const routes = meetingSourceNamesForWiring(rows[0]);
    assert.deepEqual(routes, [retired.replacedBy], "the successor is the body's only route — one clock, never two, never none");
    assert.ok(
      !MEETING_PARTITION_CONTRACTS.some((p) => p.id === meetingPartitionId(retired.meetingSource, retired.bodyId)),
      "the retired partition must not be registered, so nothing schedules or acquires it",
    );
    assert.ok(
      MEETING_PARTITION_CONTRACTS.some((p) => p.id === meetingPartitionId(retired.replacedBy, retired.bodyId)),
      "the successor partition must be registered",
    );
    assert.match(retired.retiredOn, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(retired.reason.length > 0, "the reason names its evidence");
    if (!retired.hostsReadable) {
      // A closed host must be unreadable for a reason other than robots.txt.
      assert.match(retired.reason, /NXDOMAIN|ENOTFOUND/, `${retired.bodyId}: a closed host names its failed resolution`);
    } else {
      assert.match(retired.reason, /owner decision of 2026-09-25/, `${retired.bodyId}: a robots-only retirement says robots.txt no longer blocks`);
    }
    assert.ok(retired.held.length > 0, "what the retired route holds is stated");
  }
});

/*
 * A portal host that answers NXDOMAIN is retired beside the town's already-wired calendar feed, and nothing
 * is held.
 */
const NEWBURY_SELECTBOARD = "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town#governing";

test("Newbury's dead CivicWeb route is retired, and its already-wired calendar feed is the Selectboard's one clock", () => {
  const retired = RETIRED_MEETING_ROUTES.find((route) => route.bodyId === NEWBURY_SELECTBOARD);
  assert.ok(retired, "the CivicWeb route is named as retired");
  assert.equal(retired.meetingSource, "diligent");
  assert.deepEqual(retired.hosts, ["newburynh.civicweb.net"]);
  assert.equal(retired.replacedBy, "ical");
  assert.equal(retired.successorAlreadyWired, true);
  const rows = FIXTURE_DOOR_ROWS.filter((row) => row.bodyId === NEWBURY_SELECTBOARD);
  assert.deepEqual(rows.map((row) => row.config.slug), ["newbury-ical-governing"]);
  assert.equal(
    MEETING_PARTITION_CONTRACTS.some((p) => p.id === meetingPartitionId("diligent", NEWBURY_SELECTBOARD)),
    false,
    "no clock, acquisition or SOURCE_BLOCKED row can be written for the dead host again",
  );
  assert.equal(retired.hostsReadable, undefined, "a host that no longer resolves is not readable");
  assert.equal(isUnreadableRetiredMeetingHost("https://newburynh.civicweb.net/Portal/MeetingInformation.aspx?Id=3370"), true);
  assert.throws(
    () => meetingSourceNamesForWiring({
      bodyId: NEWBURY_SELECTBOARD,
      ocdId: "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town",
      agendaSourceType: "CIVICWEB",
      jurisdiction: "Newbury, NH",
      publishingOrg: "Town of Newbury",
      timeZone: "America/New_York",
      config: { slug: "newburynh", serviceBase: "https://newburynh.civicweb.net" },
      verifiedAt: "2026-08-13",
    }),
    /MEETING_ROUTE_RETIRED:diligent:ocd-division\/country:us\/state:nh\/county:merrimack\/place:newbury_town#governing/,
  );
});

test("re-opening a retired (route, body) pair fails at registration, loudly", () => {
  const retired = RETIRED_MEETING_ROUTES[0];
  const reopened: BodySourceWiring = {
    bodyId: retired.bodyId,
    ocdId: null,
    agendaSourceType: "DILIGENT",
    jurisdiction: "Pima Community College District, AZ",
    publishingOrg: "Pima Community College Governing Board",
    timeZone: "America/Phoenix",
    config: { slug: "pcc", serviceBase: "https://pima.community.highbond.com" },
    verifiedAt: "2026-09-23",
  };
  assert.throws(() => meetingSourceNamesForWiring(reopened), /MEETING_ROUTE_RETIRED:diligent:curated:az\/pima-community-college#governing/);
});

test("no wiring row names a retired host, and meetings authority no longer reaches it", () => {
  for (const retired of RETIRED_MEETING_ROUTES) {
    for (const host of retired.hosts) {
      for (const row of FIXTURE_DOOR_ROWS) {
        for (const value of Object.values(row.config)) {
          assert.ok(!value.includes(host), `${row.bodyId} config still names ${host}`);
        }
        assert.ok(!(row.noticeUrl ?? "").includes(host), `${row.bodyId} notice URL names ${host}`);
      }
      const verdict = authorityFor("meetings-public-bodies", "MEETING", `https://${host}/Services/MeetingsService.svc/meetings`);
      assert.equal(verdict.ok, false, `${host} still inherits meetings authority`);
    }
  }
});

test("the retired tenant's recorded robots.txt reads DISALLOWED for this client and ALLOWED for named search crawlers, and blocks nothing", () => {
  const text = readFileSync(join(ROOT, "tests", "fixtures", "pima-edu", "robots-pima.community.highbond.com.txt"), "utf8");
  const read = { robotsText: text, status: 200, transportError: null, contentType: "text/plain" };
  for (const path of [
    "/Services/MeetingsService.svc/meetings?from=2026-06-25&to=2027-01-21",
    "/Portal/MeetingInformation.aspx?Org=Cal&Id=705",
    "/document/a4cc523a-2adb-4870-b379-01f05df0d63a",
  ]) {
    const url = `https://pima.community.highbond.com${path}`;
    assert.equal(evaluatePermission(read, url, "we-the-people").verdict, "DISALLOWED", path);
    assert.equal(evaluatePermission(read, url, "googlebot").verdict, "ALLOWED", `${path} for googlebot`);
    // The verdict is evidence; it does not refuse the read.
    assert.equal(agendaRetrievalRefusal(url), null, `${path} is readable for agenda retrieval`);
  }
  assert.equal(ROBOTS_BLOCKS_ACQUISITION, false);
});

test("only a dead retired route's host is held as a link; the robots-retired college tenant is readable, and nothing else is refused", () => {
  assert.equal(isUnreadableRetiredMeetingHost("https://pima.community.highbond.com/Portal/MeetingInformation.aspx?Org=Cal&Id=705"), false);
  assert.equal(isUnreadableRetiredMeetingHost("https://newburynh.civicweb.net/Portal/MeetingInformation.aspx?Id=3370"), true);
  assert.equal(isUnreadableRetiredMeetingHost("https://www.pima.edu/about-pima/leadership-policies/governing-board/board-meetings/agendas-docs-2026/0810.pdf"), false);
  // Sibling tenants that were NOT cut over are untouched by this list.
  assert.equal(isUnreadableRetiredMeetingHost("https://susd-12.community.highbond.com/Portal/"), false);
  assert.equal(isUnreadableRetiredMeetingHost("not a url"), false);
});

/*
 * A route retired for robots.txt alone stays retired when its successor carries every sitting, but its host
 * is read again when the body links into it.
 */
test("a superseded retired route's host is readable for agenda retrieval while its clock stays off", async () => {
  const retired = RETIRED_MEETING_ROUTES.find((route) => route.bodyId === PCC && route.meetingSource === "diligent");
  assert.ok(retired, "the college's Diligent route is named as retired");
  assert.equal(retired.hostsReadable, true, "its host is readable again");
  assert.deepEqual(retired.hosts, ["pima.community.highbond.com"]);
  assert.equal(retired.replacedBy, "pima-edu");
  assert.match(retired.reason, /robots\.txt alone/);
  assert.match(retired.reason, /7 the same, 5 added, none removed/);

  // The clock stays off: no partition for the retired pair, one route for the body, re-wiring refused.
  assert.equal(MEETING_PARTITION_CONTRACTS.some((p) => p.id === meetingPartitionId("diligent", PCC)), false);
  assert.deepEqual(FIXTURE_DOOR_ROWS.filter((row) => row.bodyId === PCC).flatMap(meetingSourceNamesForWiring), ["pima-edu"]);

  // The host is read: the college's own link into the tenant is requested like any public agenda link.
  const tenantLink = "https://pima.community.highbond.com/Portal/MeetingInformation.aspx?Org=Cal&Id=698";
  assert.equal(agendaRetrievalRefusal(tenantLink), null);
  const { retrieveAgendas } = await import("../scripts/ingest.ts");
  const requested: string[] = [];
  const realFetch = globalThis.fetch;
  const realLog = console.log;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    requested.push(url);
    return new Response(
      "<html><body><h1>Finance and Audit Committee Meeting - Aug 28 2026</h1><p>1. General Matters 1.01 Call to Order</p><p>2. Action Items 2.01 Approval of Minutes</p></body></html>",
      { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
    );
  }) as typeof fetch;
  console.log = () => undefined;
  try {
    await retrieveAgendas([{
      id: "pima-edu:pcc:2026-08-28-committee", ocdId: null, bodyId: PCC, bodyName: "Finance and Audit Committee",
      title: "Finance and Audit Committee", startsAt: "2026-08-28T09:00:00-07:00", timeZone: "America/Phoenix",
      location: null, agendaUrl: tenantLink, jurisdiction: "Pima Community College District, AZ", status: "CONCLUDED",
      provenance: { sourceUrl: "https://www.pima.edu/about-pima/leadership-policies/governing-board/finance-advisory-committee/agendas-minutes.html", sourceOrg: "Pima Community College Governing Board", collectedAt: "2026-09-25T20:00:00Z", verifiedAt: null },
    }] as never);
  } finally {
    globalThis.fetch = realFetch;
    console.log = realLog;
  }
  assert.deepEqual(requested, [tenantLink], "the college's link into its tenant is read");
  assert.equal(agendaDocumentStore.latestFor("pima-edu:pcc:2026-08-28-committee")?.documentUrl, tenantLink);
});

test("agenda retrieval consults the retired-host rule before any request", () => {
  const ingest = readFileSync(join(ROOT, "scripts", "ingest.ts"), "utf8");
  // One refusal rule: a retired route's host that nothing may fetch. No robots.txt rule.
  const helper = ingest.slice(ingest.indexOf("export function agendaRetrievalRefusal"), ingest.indexOf("export async function retrieveAgendas"));
  assert.match(helper, /isUnreadableRetiredMeetingHost\(url\)/, "the refusal consults the retired-host rule");
  assert.doesNotMatch(helper, /isDisallowedLegistarHost|"RECORDED_DISALLOWED"/, "and no robots.txt rule");
  const body = ingest.slice(ingest.indexOf("async function retrieveAgendas"), ingest.indexOf("async function main"));
  assert.match(body, /agendaRetrievalRefusal\(url\)/, "retrieveAgendas must filter refused hosts");
  assert.ok(
    body.indexOf("agendaRetrievalRefusal") < body.indexOf("retrieveAgendaDocument("),
    "the filter must run before the fetch",
  );
});
