import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { MEETING_PARTITION_CONTRACTS, meetingPartitionId } from "../lib/civic-data/meeting-partitions.ts";
import { authorityFor } from "../lib/civic-data/source-authority.ts";
import { evaluatePermission } from "../lib/control-plane/scheduler/robots.ts";
import {
  RETIRED_MEETING_ROUTES,
  SOURCE_WIRING,
  isRetiredMeetingHost,
  meetingSourceNamesForWiring,
  type BodySourceWiring,
} from "../lib/registry/source-wiring.ts";

/**
 * RULING 283: a proved source cutover disables its old writer in the same
 * transaction; neither two authoritative clocks nor none is lawful. These hold
 * that mechanically for every route retired because its host refuses this
 * client (2026-09-23: Pima Community College's Diligent tenant).
 */

const ROOT = join(import.meta.dirname, "..");

test("every retired route has exactly one wired successor for the same body, and no clock of its own", () => {
  assert.ok(RETIRED_MEETING_ROUTES.length >= 1);
  for (const retired of RETIRED_MEETING_ROUTES) {
    const rows = SOURCE_WIRING.filter((row) => row.bodyId === retired.bodyId);
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
    assert.ok(retired.reason.includes("robots.txt"), "the reason names the permission document");
    assert.ok(retired.held.length > 0, "what the retired route holds is stated");
  }
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
      for (const row of SOURCE_WIRING) {
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

test("the retired tenant's recorded robots.txt refuses this client and admits named search crawlers", () => {
  // Recorded 2026-09-23T20:02Z; the SUSD and TUSD tenants served byte-identical files.
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
  }
});

test("a link into a retired host is recognised as held-as-link, and nothing else is", () => {
  assert.equal(isRetiredMeetingHost("https://pima.community.highbond.com/Portal/MeetingInformation.aspx?Org=Cal&Id=705"), true);
  assert.equal(isRetiredMeetingHost("https://www.pima.edu/about-pima/leadership-policies/governing-board/board-meetings/agendas-docs-2026/0810.pdf"), false);
  // Sibling tenants that were NOT cut over are untouched by this list.
  assert.equal(isRetiredMeetingHost("https://susd-12.community.highbond.com/Portal/"), false);
  assert.equal(isRetiredMeetingHost("not a url"), false);
});

test("agenda retrieval consults the retired-host rule before any request", () => {
  const ingest = readFileSync(join(ROOT, "scripts", "ingest.ts"), "utf8");
  // 2026-09-24: one refusal helper holds both rules — a retired route's host,
  // and a host a route catalogue records DISALLOWED (legistar.granicus.com).
  const helper = ingest.slice(ingest.indexOf("export function agendaRetrievalRefusal"), ingest.indexOf("export async function retrieveAgendas"));
  assert.match(helper, /isRetiredMeetingHost\(url\)/, "the refusal consults the retired-host rule");
  assert.match(helper, /isDisallowedLegistarHost\(url\)/, "and the recorded-DISALLOWED rule");
  const body = ingest.slice(ingest.indexOf("async function retrieveAgendas"), ingest.indexOf("async function main"));
  assert.match(body, /agendaRetrievalRefusal\(url\)/, "retrieveAgendas must filter refused hosts");
  assert.ok(
    body.indexOf("agendaRetrievalRefusal") < body.indexOf("retrieveAgendaDocument("),
    "the filter must run before the fetch",
  );
});
