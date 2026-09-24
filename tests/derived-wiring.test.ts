/**
 * **A DISCOVERED ROUTE BECOMES A WIRING ROW ONLY WHEN EVERY CHECK HOLDS.**
 * (NH330 Stage 2, piece 2. 2026-09-24.)
 *
 * `lib/control-plane/discovery/derived-wiring.ts` decides each row of the
 * derived wiring store from the latest walks. Real walks, run against a
 * recorded fake transport, supply the provenance; every lookup the writer
 * needs is a stub, so each check can be failed on its own. The decisions are
 * then planned by the interface's own rule (`planDerivedVersion`), which
 * must refuse none of them.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { planDerivedVersion, type DerivedInputRef } from "../lib/civic-data/derived-authority.ts";
import {
  attestationFor,
  deriveWiringDecisions,
  derivedWiringKey,
  wiringShapeFor,
  type DerivedWiringInputs,
} from "../lib/control-plane/discovery/derived-wiring.ts";
import { walkMeetingsDiscoveryNeed, type DiscoveryOpen } from "../lib/control-plane/discovery/meetings-discovery-executor.ts";
import type { MeetingsDiscoveryNeed } from "../lib/hunt/meetings-discovery.ts";
import type { MeetingsDiscoveryAttempt } from "../lib/hunt/meetings-site-discovery.ts";

const ICS = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nSUMMARY:Town Council\r\nDTSTART:20261001T180000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
const ALLOW = { status: 200, body: "User-agent: *\nAllow: /\n", contentType: "text/plain" };
const LEDGER = { source: "GAP_LEDGER" as const, versionId: "b".repeat(64) };

type Reply = { status: number; body?: string; contentType?: string; location?: string };

async function walk(map: Record<string, Reply>, address: string): Promise<MeetingsDiscoveryAttempt> {
  const open: DiscoveryOpen = async ({ url }) => {
    const r = map[url] ?? { status: 404, body: "not found" };
    return { status: r.status, body: r.body ?? "", bytes: (r.body ?? "").length, contentType: r.contentType ?? "text/html", location: r.location ?? null, transportError: null };
  };
  let tick = 0;
  const need: MeetingsDiscoveryNeed = {
    jurisdictionId: "az:city:town-of-example", stateCode: "AZ", name: "TOWN OF EXAMPLE", govClass: "CITY_OR_TOWN",
    ownWebAddress: address, basis: "SOURCE_DISCOVERY_OWED", sources: [], addressSource: LEDGER,
  };
  return walkMeetingsDiscoveryNeed(need, {
    open,
    spaceOut: async () => {},
    vault: async (artifact) => ({ stored: true, where: `vault/${artifact.id}`, why: "stored" }),
    now: () => new Date(Date.parse("2026-09-24T21:00:00.000Z") + (tick++) * 1000).toISOString(),
    budget: { spent: () => false },
  });
}

const SITE = {
  "https://example.gov/robots.txt": ALLOW,
  "https://example.gov/": { status: 301, location: "https://www.example.gov/" },
  "https://www.example.gov/robots.txt": ALLOW,
  "https://www.example.gov/": { status: 200, body: `<a href="/council.ics">Council calendar</a>` },
  "https://www.example.gov/council.ics": { status: 200, body: ICS, contentType: "text/calendar" },
};

const BODY = "ocd-division/country:us/state:az/place:example#governing";
const identityInput: DerivedInputRef = { kind: "PROMOTED_VERSION", recordClass: "REGISTRATION", scope: "US-AZ:registration:v1", versionId: "reg-1", readModelSha256: "c".repeat(64), promotedAt: "2026-09-24T20:00:00.000Z" };
const reviewedInput: DerivedInputRef = { kind: "PROMOTED_VERSION", recordClass: "CURATED_READER_RECORD", scope: "US:meeting-source-crosswalk", versionId: "xw-1", readModelSha256: "d".repeat(64), promotedAt: "2026-09-24T20:30:00.000Z" };

function inputs(attempt: MeetingsDiscoveryAttempt, over: Partial<DerivedWiringInputs> = {}): DerivedWiringInputs {
  return {
    attempts: [{ attempt, recordId: attempt.attemptId, recordedAt: attempt.finishedAt }],
    identity: () => ({ bodyId: BODY, ocdId: "ocd-division/country:us/state:az/place:example", input: identityInput }),
    registered: () => true,
    handWired: () => false,
    reviewed: () => ({ publishingOrg: "Town of Example", timeZone: "America/Phoenix", config: { slug: "example-council", titleMatch: "Town Council" }, input: reviewedInput }),
    vaulted: (artifactId) => ({ kind: "VAULTED_EVIDENCE", artifactId, contentHash: `sha256-${"e".repeat(64)}`, tier: "RAW", retrievedAt: attempt.finishedAt }),
    verify: (_row, binding, evidence) => ({ adapter: binding.adapter, closureDigest: binding.closureDigest, verifiedAt: attempt.finishedAt, sittings: 1, evidence }),
    adapterDigest: () => "ical@0123456789ab",
    previous: [],
    ...over,
  };
}

test("THE SHAPE: a confirmed route maps to the wiring kind the reader runs, and a route the reader cannot be configured from is held by name", () => {
  assert.deepEqual(wiringShapeFor({ vendor: "ical", url: "https://t.gov/c.ics" }), { kind: "ICAL", endpoint: { feedUrl: "https://t.gov/c.ics" } });
  assert.deepEqual(wiringShapeFor({ vendor: "civicclerk-api", url: "https://tn.api.civicclerk.com/v1/Events?$top=5" }), { kind: "CIVICCLERK", endpoint: { apiBase: "https://tn.api.civicclerk.com" } });
  assert.deepEqual(wiringShapeFor({ vendor: "legistar-api", url: "https://webapi.legistar.com/v1/chandler/events?$top=5" }), { kind: "LEGISTAR", endpoint: { slug: "chandler", sourceRoutes: "legistar" } });
  assert.deepEqual(wiringShapeFor({ vendor: "boardbook", url: "https://meetings.boardbook.org/Public/Organization/1234" }), { kind: "BOARDBOOK", endpoint: { orgId: "1234" } });
  const agenda = wiringShapeFor({ vendor: "civicplus-agendacenter", url: "https://t.gov/AgendaCenter" });
  assert.ok("held" in agenda && agenda.held === "ADAPTER_CONFIG_INCOMPLETE" && /icalUrl/.test(agenda.detail));
  assert.ok("held" in wiringShapeFor({ vendor: "novusagenda", url: "https://x.novusagenda.com/agendapublic" }));
});

test("THE ATTESTATION: the recorded address, each redirect, and the homepage that linked the route, each with its vaulted artifact", async () => {
  const attempt = await walk(SITE, "example.gov");
  assert.equal(attempt.outcome, "FOUND");
  const attested = attestationFor(attempt, attempt.found[0]);
  assert.ok("attestation" in attested, JSON.stringify(attested));
  assert.deepEqual(attested.attestation, {
    kind: "LINKED_FROM_ATTESTED_PAGE",
    pageArtifactId: attempt.site!.homepage!.artifactId,
    page: { kind: "REDIRECT_FROM_ATTESTED", fromUrl: "https://example.gov/", from: { kind: "RECORDED_ADDRESS", source: "GAP_LEDGER", versionId: LEDGER.versionId } },
  });
  const { site: _site, ...older } = attempt;
  assert.deepEqual(attestationFor(older, attempt.found[0]), { held: "HOST_NOT_ATTESTED", detail: "the walk predates recorded provenance; the government is walked again" });
  const unlinked = { ...attempt.found[0], via: null, basis: "SEARCH" as const };
  assert.deepEqual(attestationFor(attempt, unlinked), { held: "HOST_NOT_ATTESTED", detail: "a search result is attested only when an attested page links it" });
});

test("PROMOTE only when every check holds, and the interface's own rule refuses none of the decisions", async () => {
  const attempt = await walk(SITE, "example.gov");
  const decisions = deriveWiringDecisions(inputs(attempt));
  assert.equal(decisions.length, 1);
  const [d] = decisions;
  assert.equal(d.disposition, "PROMOTE");
  if (d.disposition !== "PROMOTE") return;
  assert.equal(d.key, derivedWiringKey("ICAL", BODY));
  assert.deepEqual(d.row.config, { feedUrl: "https://www.example.gov/council.ics", slug: "example-council", titleMatch: "Town Council" });
  assert.equal(d.row.agendaSourceType, "ICAL");
  assert.ok(d.inputs.some((i) => i.kind === "VAULTED_EVIDENCE") && d.inputs.some((i) => i.kind === "DISCOVERY_ATTEMPT"));
  const plan = planDerivedVersion([], decisions);
  assert.deepEqual(plan.refusals, []);
  assert.deepEqual(plan.promoted, [derivedWiringKey("ICAL", BODY)]);
});

test("HOLD BY NAME, at the first check that fails: identity, registration, attestation, a hand-wired body, the reviewed filter, the vault, the reader adapter", async () => {
  const attempt = await walk(SITE, "example.gov");
  const reasonOf = (over: Partial<DerivedWiringInputs>): string => {
    const [d] = deriveWiringDecisions(inputs(attempt, over));
    return d.disposition === "HOLD" ? d.reason : d.disposition;
  };
  assert.equal(reasonOf({ identity: () => null }), "NO_REVIEWED_BODY_IDENTITY");
  assert.equal(reasonOf({ registered: () => false }), "BODY_NOT_REGISTERED");
  assert.equal(reasonOf({ handWired: () => true }), "ALREADY_WIRED");
  assert.equal(reasonOf({ reviewed: () => null }), "BODY_FILTER_NOT_ESTABLISHED", "a body filter is never derived from a name");
  assert.equal(reasonOf({ vaulted: () => null }), "EVIDENCE_NOT_VAULTED");
  assert.equal(reasonOf({ verify: () => ({ refused: "no event names the Town Council" }) }), "ADAPTER_REFUSED");
  const { site: _site, ...older } = attempt;
  const [held] = deriveWiringDecisions(inputs(older));
  assert.equal(held.disposition === "HOLD" ? held.reason : held.disposition, "HOST_NOT_ATTESTED");
  const agendaOnly = { ...attempt, found: [{ ...attempt.found[0], vendor: "civicplus-agendacenter", url: "https://www.example.gov/AgendaCenter" }] };
  const [incomplete] = deriveWiringDecisions(inputs(agendaOnly));
  assert.equal(incomplete.disposition === "HOLD" ? incomplete.reason : incomplete.disposition, "ADAPTER_CONFIG_INCOMPLETE");
  assert.deepEqual(planDerivedVersion([], deriveWiringDecisions(inputs(attempt, { reviewed: () => null }))).refusals, []);
});

test("A PROMOTED ROW IS REMOVED ONLY ON ITS PUBLISHER'S OWN 404 OR 410; a walk that did not reach it holds it, carried", async () => {
  const promoted = deriveWiringDecisions(inputs(await walk(SITE, "example.gov")))[0];
  assert.equal(promoted.disposition, "PROMOTE");
  if (promoted.disposition !== "PROMOTE") return;
  const previous = [{ key: promoted.key, row: promoted.row }];

  const gone = await walk({ ...SITE, "https://www.example.gov/council.ics": { status: 404, body: "<html>Not Found</html>" } }, "example.gov");
  const [removal] = deriveWiringDecisions(inputs(gone, { previous }));
  assert.equal(removal.disposition, "REMOVE");
  const removedPlan = planDerivedVersion(previous, [removal]);
  assert.deepEqual(removedPlan.refusals, []);
  assert.deepEqual(removedPlan.rows, []);

  const walled = await walk({ ...SITE, "https://www.example.gov/council.ics": { status: 403, body: "Forbidden" } }, "example.gov");
  const [held] = deriveWiringDecisions(inputs(walled, { previous }));
  assert.equal(held.disposition === "HOLD" ? held.reason : held.disposition, "CHALLENGED");
  const heldPlan = planDerivedVersion(previous, [held]);
  assert.deepEqual(heldPlan.rows.map((r) => r.key), [promoted.key], "a held row that was promoted is carried, never dropped");
  assert.equal(heldPlan.held[0]?.carried, true);
});
