import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { planDerivedVersion, type DerivedInputRef } from "../lib/civic-data/derived-authority.ts";
import { bodySourceWiringFor, derivedWiringKey } from "../lib/civic-data/derived-meeting-wiring.ts";
import { categoryFeedIssue, crosswalkRowIssue, type MeetingBodyCrosswalkRow } from "../lib/civic-data/meeting-body-crosswalk.ts";
import { autoCrosswalkReviewerId, reviewDiscoveryWalk, type HeldBytes, type RegisteredGovernment } from "../lib/control-plane/discovery/auto-crosswalk.ts";
import { deriveWiringDecisions, wiringRowFor, type DerivedWiringInputs } from "../lib/control-plane/discovery/derived-wiring.ts";
import { walkMeetingsDiscoveryNeed } from "../lib/control-plane/discovery/meetings-discovery-executor.ts";
import type { MeetingsDiscoveryAttempt } from "../lib/hunt/meetings-site-discovery.ts";
import { makeIcalSource } from "../lib/sources/ical/index.ts";
import { recordedDiscoveryOpen, type RecordedReply } from "./helpers/recorded-discovery-open.ts";

const INDEX = readFileSync("tests/fixtures/civicplus-cochise-icalendar.html", "utf8");
const BOS_ICS = readFileSync("tests/fixtures/civicplus-cochise-board-of-supervisors.ics", "utf8");
const HOST = "www.cochise.az.gov";
const INDEX_URL = `https://${HOST}/iCalendar.aspx`;
const BOS_FEED = `https://${HOST}/common/modules/iCalendar/iCalendar.aspx?catID=31&feed=calendar`;
const COUNTY = "az:county:county-of-cochise";
const OCD = "ocd-division/country:us/state:az/county:cochise";
const T_WALK = "2026-09-26T05:00:00.000Z";
const NOW = "2026-09-26T05:30:00.000Z";
const REGISTRATION: DerivedInputRef = { kind: "PROMOTED_VERSION", recordClass: "REGISTRATION", scope: "US-AZ:registration:v1", versionId: "reg-az-1", readModelSha256: "c".repeat(64), promotedAt: "2026-09-24T00:00:00.000Z" };
const REGISTERED: RegisteredGovernment = { bodyId: `${OCD}#governing`, ocdId: OCD, publishingOrg: "Cochise County", input: REGISTRATION };
const HOME = `<html><head><title>Cochise County, AZ | Official Website</title><script src="/Common/Modules/Calendar/calendar.js"></script></head><body>Cochise County</body></html>`;

const SITE = (index = INDEX): Record<string, RecordedReply> => ({
  [`https://${HOST}/robots.txt`]: { status: 200, body: "User-agent: *\nDisallow: /admin\n", contentType: "text/plain" },
  [`https://${HOST}/`]: { status: 200, body: HOME },
  [`https://${HOST}/AgendaCenter`]: { status: 200, body: `<a href="/AgendaCenter/ViewFile/Agenda/_09292026-2981">Agenda</a>` },
  [INDEX_URL]: { status: 200, body: index },
  [BOS_FEED]: { status: 200, body: BOS_ICS, contentType: "text/calendar; charset=utf-8" },
});

async function walk(replies: Readonly<Record<string, RecordedReply>>) {
  const bodies = new Map<string, HeldBytes>();
  let tick = 0;
  const attempt = await walkMeetingsDiscoveryNeed({
    jurisdictionId: COUNTY, stateCode: "AZ", name: "COUNTY OF COCHISE", govClass: "COUNTY", ownWebAddress: `https://${HOST}`,
    basis: "SOURCE_DISCOVERY_OWED", sources: [], addressSource: { source: "GAP_LEDGER", versionId: "b".repeat(64) },
  }, {
    open: recordedDiscoveryOpen(replies),
    spaceOut: async () => {},
    vault: async (artifact, body) => {
      bodies.set(artifact.id, {
        text: body,
        sha256: artifact.contentHash.slice("sha256-".length),
        evidence: { kind: "VAULTED_EVIDENCE", artifactId: artifact.id, contentHash: artifact.contentHash, tier: "RAW", retrievedAt: artifact.retrievedAt },
      });
      return { stored: true, where: `vault/${artifact.id}`, why: "stored" };
    },
    now: () => new Date(Date.parse(T_WALK) + (tick++) * 1000).toISOString(),
    budget: { spent: () => false },
  });
  return { attempt, bodies };
}

function review(attempt: MeetingsDiscoveryAttempt, held: (id: string) => HeldBytes | null) {
  return reviewDiscoveryWalk({
    walk: { attempt, recordId: "7", recordedAt: attempt.finishedAt },
    registered: REGISTERED,
    held,
    handWired: () => false,
    reviewer: autoCrosswalkReviewerId("0123456789abcdef"),
    now: NOW,
  });
}

function meetingsOf(row: MeetingBodyCrosswalkRow, text: string) {
  const wiring = bodySourceWiringFor(wiringRowFor(row));
  return makeIcalSource([wiring]).normalizeWithDrops([{ wiring, ics: text, collectedAt: NOW, sourceUrl: row.route }], new Date(NOW)).meetings
    .filter((m) => m.bodyId === row.bodyId);
}

test("COCHISE WIRES: the Board of Supervisors' category feed becomes its whole-feed row, cites the index that names it, and the adapter reads its sittings at their MST times", async () => {
  const walked = await walk(SITE());
  const result = review(walked.attempt, (id) => walked.bodies.get(id) ?? null);
  const accepted = result.accepted.find((a) => a.row.bodyId === `${OCD}#governing`);
  assert.ok(accepted !== undefined, `held: ${JSON.stringify(result.held.map((h) => [h.reason, h.detail]))}`);
  const row = accepted.row;
  assert.equal(row.bodyName, "Board of Supervisors");
  assert.equal(row.route, BOS_FEED);
  assert.deepEqual(row.filter, { feedScope: "category", titleExclude: "Planning and Zoning Commission" }, "the one event naming another body only is excluded by its exact words");
  assert.equal(row.evidence.bodyPage.url, INDEX_URL, "the naming evidence is the county's own index, filing the feed under the board's name");
  assert.match(row.evidence.bodyPage.quote, /Board of Supervisors/);
  assert.deepEqual([row.evidence.calendar.selected, row.evidence.calendar.total], [4, 5]);
  assert.equal(row.timeZone, "America/Phoenix");
  assert.equal(crosswalkRowIssue(row), null, "the row passes every C16 check");

  const meetings = meetingsOf(row, BOS_ICS);
  assert.deepEqual(
    meetings.map((m) => [m.title, m.startsAt]).sort(),
    [
      ["Flood Control District Meeting", "2026-09-29T17:00:00.000Z"],
      ["Jail District Meeting", "2026-09-29T17:00:00.000Z"],
      ["Library District Meeting", "2026-09-29T17:00:00.000Z"],
      ["Special Board Meeting", "2026-09-29T17:00:00.000Z"],
    ],
    "10 AM MST each, the board sitting as itself and as the three district boards",
  );

  const texts = new Map([...walked.bodies].map(([id, b]) => [id, b.text] as const));
  const inputs: DerivedWiringInputs = {
    crosswalk: {
      input: { kind: "PROMOTED_VERSION", recordClass: "CURATED_READER_RECORD", scope: "manual", versionId: "xw-manual", readModelSha256: "d".repeat(64), promotedAt: "2026-09-24T00:00:00.000Z" },
      versionId: "xw-manual",
      rows: [row],
      automatic: { input: { kind: "PROMOTED_VERSION", recordClass: "CURATED_READER_RECORD", scope: "auto", versionId: "xw-auto", readModelSha256: "e".repeat(64), promotedAt: "2026-09-24T00:00:00.000Z" }, versionId: "xw-auto", rowIds: new Set([row.id]) },
    },
    registration: () => ({ input: REGISTRATION }),
    attempts: [{ attempt: walked.attempt, recordId: "7", recordedAt: walked.attempt.finishedAt }],
    handWired: () => false,
    vaulted: (id) => walked.bodies.get(id)?.evidence ?? null,
    vaultedBytes: (hex) => [...walked.bodies.values()].find((b) => b.sha256 === hex)?.evidence ?? null,
    verify: (wiringRow, binding, evidence) => {
      const own = meetingsOf(row, texts.get(evidence.artifactId) ?? "");
      assert.equal(wiringRow.config.feedScope, "category", "the wiring row carries the whole-feed filter to the adapter");
      return own.length === 0
        ? { changed: "selects nothing" }
        : { verified: { adapter: binding.adapter, closureDigest: binding.closureDigest, verifiedAt: NOW, sittings: own.length, evidence }, selected: own.map((m) => `${m.startsAt}|${m.title}`) };
    },
    adapterDigest: () => "ical@0123456789ab",
    previous: [],
    now: NOW,
  };
  const decisions = deriveWiringDecisions(inputs);
  assert.deepEqual(decisions.map((d) => d.disposition), ["PROMOTE"]);
  assert.deepEqual(planDerivedVersion([], decisions).promoted, [derivedWiringKey("ICAL", `${OCD}#governing`, BOS_FEED)]);
});

test("generic and partial category names and another host's feed never give a whole-feed row", async () => {
  const walked = await walk(SITE());
  const indexStep = walked.attempt.steps.find((s) => s.url === INDEX_URL)!;
  const named = INDEX.replace(">Board of Supervisors</a>", ">Planning and Zoning Commission</a>");
  const subBody = review(walked.attempt, id => id === indexStep.artifactId ? { ...walked.bodies.get(id)!, text: named } : walked.bodies.get(id) ?? null);
  assert.ok(subBody.accepted.some(a => a.row.bodyRole === "SUB_BODY" && a.row.bodyName === "Planning and Zoning Commission"));
  assert.ok(!subBody.accepted.some(a => a.row.bodyId === `${OCD}#governing`));
  for (const category of ["Meetings", "Main Calendar", "Board of Supervisors Meetings", "Supervisors"]) {
    const renamed = INDEX.replace(">Board of Supervisors</a>", `>${category}</a>`);
    const result = review(walked.attempt, (id) => (id === indexStep.artifactId ? { ...walked.bodies.get(id)!, text: renamed } : walked.bodies.get(id) ?? null));
    assert.ok(!result.accepted.some((a) => a.row.bodyId === `${OCD}#governing`), `${category}: no governing row`);
    assert.ok(result.held.some((h) => h.reason === "NO_EVENT_NAMES_BODY" && h.route === BOS_FEED), `${category}: held NO_EVENT_NAMES_BODY`);
  }
  for (const index of [
    INDEX.replace(`href="${BOS_FEED}"`, `href="https://calendar.example.com/common/modules/iCalendar/iCalendar.aspx?catID=31&feed=calendar"`),
  ]) {
    const other = await walk(SITE(index));
    assert.ok(!other.attempt.found.some((f) => f.vendor === "ical"), "no iCal find");
  }
});

test("THE ROW CHECK: a whole-feed filter stands only as \"category\", alone, on a category-scoped feed", () => {
  assert.equal(categoryFeedIssue(BOS_FEED, { feedScope: "category" }), null);
  assert.equal(categoryFeedIssue(BOS_FEED, { feedScope: "category", titleExclude: "Planning and Zoning Commission" }), null);
  assert.match(categoryFeedIssue(BOS_FEED, { feedScope: "all" }) ?? "", /"category" or absent/);
  assert.match(categoryFeedIssue(BOS_FEED, { feedScope: "category", titleMatch: "Board" }) ?? "", /stands alone/);
  assert.match(categoryFeedIssue(`https://${HOST}/calendar/meetings.ics`, { feedScope: "category" }) ?? "", /category-scoped feed/);
  assert.match(categoryFeedIssue(`https://${HOST}/common/modules/iCalendar/iCalendar.aspx?feed=calendar`, { feedScope: "category" }) ?? "", /category-scoped feed/);
});

test("THE ADAPTER: a title or category filter reads exactly as before; only a whole-feed filter selects every event", () => {
  const base = { id: `${OCD}#governing|ICAL`, jurisdictionId: COUNTY, ocdId: OCD, bodyId: `${OCD}#governing`, bodyRole: "GOVERNING", bodyName: "Board of Supervisors", kind: "ICAL", route: BOS_FEED, officialHost: HOST, publishingOrg: "Cochise County", timeZone: "America/Phoenix", evidence: { readAt: T_WALK }, reviewedAt: NOW } as const;
  const rowWith = (filter: Record<string, string>) => ({ ...base, filter }) as unknown as MeetingBodyCrosswalkRow;
  assert.equal(meetingsOf(rowWith({ titleMatch: "Board of Supervisors" }), BOS_ICS).length, 0, "no title names the board");
  assert.deepEqual(meetingsOf(rowWith({ titleMatch: "Jail District" }), BOS_ICS).map((m) => m.title), ["Jail District Meeting"]);
  assert.equal(meetingsOf(rowWith({ categoryMatch: "Board of Supervisors" }), BOS_ICS).length, 0, "the feed carries no CATEGORIES");
  assert.equal(meetingsOf(rowWith({ feedScope: "category" }), BOS_ICS).length, 5);
});
