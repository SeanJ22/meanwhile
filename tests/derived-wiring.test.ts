/**
 * A reviewed calendar becomes a wiring row only when every check holds, and a promoted one is suspended on a review
 * trigger (wrong attribution, conflicting evidence, a changed calendar), never on an outage.
 *
 * Real walks, run against a recorded fake transport, supply the provenance; every lookup the writer needs is a stub,
 * so each check can be failed on its own. The decisions are then planned by `planDerivedVersion`, which must refuse
 * none of them.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { planDerivedVersion, type DerivedInputRef, type DerivedVersionEntry } from "../lib/civic-data/derived-authority.ts";
import type { DerivedWiringRow } from "../lib/civic-data/derived-meeting-wiring.ts";
import { CROSSWALK_CITATION, crosswalkRowId, subBodyId, type MeetingBodyCrosswalkRow } from "../lib/civic-data/meeting-body-crosswalk.ts";
import {
  attestationFor,
  deriveWiringDecisions,
  derivedWiringKey,
  wiringShapeFor,
  type DerivedWiringInputs,
  type WiringVerification,
} from "../lib/control-plane/discovery/derived-wiring.ts";
import { walkMeetingsDiscoveryNeed } from "../lib/control-plane/discovery/meetings-discovery-executor.ts";
import { recordedDiscoveryOpen, type RecordedReply } from "./helpers/recorded-discovery-open.ts";
import type { MeetingsDiscoveryNeed } from "../lib/hunt/meetings-discovery.ts";
import type { MeetingsDiscoveryAttempt } from "../lib/hunt/meetings-site-discovery.ts";

const ICS = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nSUMMARY:Town Council\r\nDTSTART:20261001T180000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
const ALLOW = { status: 200, body: "User-agent: *\nAllow: /\n", contentType: "text/plain" };
const LEDGER = { source: "GAP_LEDGER" as const, versionId: "b".repeat(64) };
const JURISDICTION = "az:city:town-of-example";
const OCD = "ocd-division/country:us/state:az/place:example";
const ROUTE = "https://www.example.gov/council.ics";
const NOW = "2026-09-25T02:00:00.000Z";

type Reply = RecordedReply;

async function walk(map: Record<string, Reply>, address: string): Promise<MeetingsDiscoveryAttempt> {
  const open = recordedDiscoveryOpen(map);
  let tick = 0;
  const need: MeetingsDiscoveryNeed = {
    jurisdictionId: JURISDICTION, stateCode: "AZ", name: "TOWN OF EXAMPLE", govClass: "CITY_OR_TOWN",
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

const SITE: Record<string, Reply> = {
  "https://example.gov/robots.txt": ALLOW,
  "https://example.gov/": { status: 301, location: "https://www.example.gov/" },
  "https://www.example.gov/robots.txt": ALLOW,
  "https://www.example.gov/": { status: 200, body: `<a href="/council.ics">Council calendar</a>` },
  [ROUTE]: { status: 200, body: ICS, contentType: "text/calendar" },
};

function crosswalkRow(patch: Partial<MeetingBodyCrosswalkRow> = {}): MeetingBodyCrosswalkRow {
  const bodyId = patch.bodyId ?? `${OCD}#governing`;
  const kind = patch.kind ?? "ICAL";
  return {
    id: `${bodyId}|${kind}`,
    jurisdictionId: JURISDICTION,
    ocdId: OCD,
    bodyId,
    bodyRole: "GOVERNING",
    bodyName: "Town Council",
    kind,
    route: ROUTE,
    officialHost: "www.example.gov",
    filter: { titleMatch: "Town Council" },
    publishingOrg: "Town of Example",
    timeZone: "America/Phoenix",
    evidence: {
      bodyPage: { url: "https://www.example.gov/council", sha256: "1".repeat(64), quote: "The Town Council meets monthly" },
      calendar: { url: ROUTE, sha256: "2".repeat(64), selected: 1, total: 1 },
      readAt: "2026-09-24T20:00:00.000Z",
    },
    status: "ACTIVE",
    reviewedBy: "a reviewing agent session",
    reviewedAt: "2026-09-24T20:10:00.000Z",
    authorization: CROSSWALK_CITATION,
    ...patch,
  };
}

const crosswalkInput: DerivedInputRef = { kind: "PROMOTED_VERSION", recordClass: "CURATED_READER_RECORD", scope: "US-AZ+US-NH+US-NJ:meeting-body-crosswalk", versionId: "xw-1", readModelSha256: "d".repeat(64), promotedAt: "2026-09-24T20:30:00.000Z" };
const registrationInput: DerivedInputRef = { kind: "PROMOTED_VERSION", recordClass: "REGISTRATION", scope: "US-AZ:registration:v1", versionId: "reg-1", readModelSha256: "c".repeat(64), promotedAt: "2026-09-24T20:00:00.000Z" };
const vaulted = (artifactId: string, retrievedAt = "2026-09-24T21:00:05.000Z") =>
  ({ kind: "VAULTED_EVIDENCE" as const, artifactId, contentHash: `sha256-${"e".repeat(64)}`, tier: "RAW" as const, retrievedAt });
const verified = (sittings = ["2026-10-01T18:00:00Z|Town Council"]): WiringVerification => ({
  verified: { adapter: "ical", closureDigest: "ical@0123456789ab", verifiedAt: NOW, sittings: sittings.length, evidence: vaulted("ar-calendar") },
  selected: sittings,
});

function inputs(attempt: MeetingsDiscoveryAttempt, over: Partial<DerivedWiringInputs> = {}, rows = [crosswalkRow()]): DerivedWiringInputs {
  return {
    crosswalk: { input: crosswalkInput, versionId: "xw-1", rows },
    registration: () => ({ input: registrationInput }),
    attempts: [{ attempt, recordId: attempt.attemptId, recordedAt: attempt.finishedAt }],
    handWired: () => false,
    vaulted: (artifactId) => vaulted(artifactId),
    vaultedBytes: (sha) => vaulted(`ar-bytes-${sha.slice(0, 6)}`),
    verify: () => verified(),
    adapterDigest: () => "ical@0123456789ab",
    previous: [],
    now: NOW,
    ...over,
  };
}

const KEY = derivedWiringKey("ICAL", `${OCD}#governing`, ROUTE);

test("distinct routes for one body both wire; a held legacy route keeps its original identity", async () => {
  const route = "https://www.example.gov/second.ics";
  const site = { ...SITE, "https://www.example.gov/": { status: 200, body: '<a href="/council.ics">Council calendar</a><a href="/second.ics">Council meetings</a>' },
    [route]: { status: 200, body: ICS, contentType: "text/calendar" } };
  const attempt = await walk(site, "example.gov");
  const first = crosswalkRow();
  const second = crosswalkRow({ id: crosswalkRowId(first.bodyId, first.kind, route), route,
    evidence: { ...first.evidence, calendar: { ...first.evidence.calendar, url: route } } });
  const decisions = deriveWiringDecisions(inputs(attempt, {}, [first, second]));
  assert.deepEqual(decisions.map(decision => decision.disposition), ["PROMOTE", "PROMOTE"]);
  assert.equal(new Set(decisions.map(decision => decision.key)).size, 2);
  const legacy = { ...await promotedEntry(), key: derivedWiringKey("ICAL", first.bodyId) };
  const renewed = deriveWiringDecisions(inputs(attempt, { previous: [legacy] }, [first, second]));
  assert.deepEqual(renewed.map(decision => decision.key), [legacy.key, derivedWiringKey("ICAL", first.bodyId, route)]);
});

test("a later walk of other categories does not hide this calendar's saved source reading", async () => {
  const original = await walk(SITE, "example.gov");
  const later = { ...original, attemptId: "later-category-walk", finishedAt: "2026-09-25T01:00:00.000Z",
    found: [], steps: original.steps.filter(step => step.url !== ROUTE) };
  const [decision] = deriveWiringDecisions(inputs(original, { attempts: [
    { attempt: original, recordId: "original-record", recordedAt: original.finishedAt },
    { attempt: later, recordId: "later-record", recordedAt: later.finishedAt },
  ] }));
  assert.equal(decision.disposition, "PROMOTE");
  assert.ok(decision.inputs.some(ref => ref.kind === "DISCOVERY_ATTEMPT" && ref.recordId === "original-record"));
});

test("a newer actual failed calendar read stays visible instead of being replaced by old success", async () => {
  const original = await walk(SITE, "example.gov");
  const later = { ...original, attemptId: "later-failed-walk", finishedAt: "2026-09-25T01:00:00.000Z", found: [],
    steps: original.steps.map(step => step.url === ROUTE ? { ...step, status: 503, artifactId: null, note: "source unavailable" } : step) };
  const [decision] = deriveWiringDecisions(inputs(original, { attempts: [
    { attempt: later, recordId: "later-record", recordedAt: later.finishedAt },
    { attempt: original, recordId: "original-record", recordedAt: original.finishedAt },
  ] }));
  assert.equal(decision.disposition, "HOLD");
  assert.ok(decision.inputs.some(ref => ref.kind === "DISCOVERY_ATTEMPT" && ref.recordId === "later-record"));
});
const reasonOf = (d: ReturnType<typeof deriveWiringDecisions>[number] | undefined): string =>
  d === undefined ? "none" : d.disposition === "HOLD" ? d.reason : d.disposition === "SUSPEND" ? `SUSPEND:${d.trigger}` : d.disposition;

async function promotedEntry(): Promise<DerivedVersionEntry<DerivedWiringRow>> {
  const [d] = deriveWiringDecisions(inputs(await walk(SITE, "example.gov")));
  assert.equal(d?.disposition, "PROMOTE");
  if (d?.disposition !== "PROMOTE") throw new Error("not promoted");
  return { key: d.key, row: d.row };
}

test("THE SHAPE: a confirmed route maps to a kind the reviewed filter is defined for, and anything else is held by name", () => {
  assert.deepEqual(wiringShapeFor({ vendor: "ical", url: "https://t.gov/c.ics" }), { kind: "ICAL", endpoint: { feedUrl: "https://t.gov/c.ics" } });
  assert.deepEqual(wiringShapeFor({ vendor: "official-page-events", url: "https://t.gov/Calendar.aspx?EID=1" }), { kind: "OFFICIAL_PAGE_EVENTS", endpoint: { pageUrl: "https://t.gov/Calendar.aspx?EID=1", officialHost: "t.gov" } });
  const agenda = wiringShapeFor({ vendor: "civicplus-agendacenter", url: "https://t.gov/AgendaCenter" });
  assert.deepEqual(agenda, { kind: "CIVICPLUS", endpoint: { agendaCenterUrl: "https://t.gov/AgendaCenter" } });
  assert.deepEqual(wiringShapeFor({ vendor: "legistar-api", url: "https://webapi.legistar.com/v1/x/events" }), { kind: "LEGISTAR", endpoint: { slug: "x" } });
});

test("THE ATTESTATION: the recorded address, each redirect, and the homepage that linked the route, each with its vaulted artifact", async () => {
  const attempt = await walk(SITE, "example.gov");
  assert.equal(attempt.outcome, "FOUND");
  const attested = attestationFor(attempt, attempt.found[0]!);
  assert.ok("attestation" in attested, JSON.stringify(attested));
  assert.deepEqual(attested.attestation, {
    kind: "LINKED_FROM_ATTESTED_PAGE",
    pageArtifactId: attempt.site!.homepage!.artifactId,
    page: { kind: "REDIRECT_FROM_ATTESTED", fromUrl: "https://example.gov/", from: { kind: "RECORDED_ADDRESS", source: "GAP_LEDGER", versionId: LEDGER.versionId } },
  });
  const { site: _site, ...older } = attempt;
  assert.deepEqual(attestationFor(older, attempt.found[0]!), { held: "HOST_NOT_ATTESTED", detail: "the walk predates recorded provenance; the government is walked again" });
});

test("PROMOTE only when every check holds, from a reviewed crosswalk row, never from a find alone", async () => {
  const attempt = await walk(SITE, "example.gov");
  const decisions = deriveWiringDecisions(inputs(attempt));
  assert.equal(decisions.length, 1);
  const [d] = decisions;
  assert.equal(d?.disposition, "PROMOTE");
  if (d?.disposition !== "PROMOTE") return;
  assert.equal(d.key, KEY);
  assert.equal(d.row.kind, "ICAL");
  assert.equal(d.row.bodyName, "Town Council");
  assert.equal(d.row.state, "US-AZ");
  assert.equal(d.row.config.feedUrl, ROUTE);
  assert.equal(d.row.config.titleMatch, "Town Council");
  assert.equal(d.reviewedAt, "2026-09-24T20:10:00.000Z");
  assert.ok(d.inputs.some((i) => i.kind === "DISCOVERY_ATTEMPT") && d.inputs.filter((i) => i.kind === "VAULTED_EVIDENCE").length === 2, "the calendar's bytes and the page naming the body");
  assert.deepEqual(planDerivedVersion([], decisions).refusals, []);

  assert.deepEqual(deriveWiringDecisions(inputs(attempt, {}, [])), [], "a find with no reviewed crosswalk row is never a row");
});

test("a reviewed-registry body used to fill a registration gap remains in each wiring row's provenance", async () => {
  const attempt = await walk(SITE, "example.gov");
  const reviewedInput: DerivedInputRef = { kind: "PROMOTED_VERSION", recordClass: "REGISTRY_RUNTIME_BINDING",
    scope: "US:registry-runtime", versionId: "reviewed-1", readModelSha256: "f".repeat(64), promotedAt: NOW };
  const [decision] = deriveWiringDecisions(inputs(attempt, {
    registration: () => ({ input: registrationInput, identityInput: reviewedInput }),
  }));
  assert.equal(decision?.disposition, "PROMOTE");
  if (decision?.disposition !== "PROMOTE") return;
  assert.ok(decision.inputs.includes(registrationInput));
  assert.ok(decision.inputs.includes(reviewedInput));
});

test("HOLD BY NAME at the first check that fails: registration, walk, attestation, a hand-wired body, the vault, the reader adapter", async () => {
  const attempt = await walk(SITE, "example.gov");
  const reason = (over: Partial<DerivedWiringInputs>, target = attempt) => reasonOf(deriveWiringDecisions(inputs(target, over))[0]);
  assert.equal(reason({ registration: () => ({ notRegistered: "no such division" }) }), "BODY_NOT_REGISTERED");
  assert.equal(reason({ attempts: [] }), "WALK_ABSENT");
  const { site: _site, ...older } = attempt;
  assert.equal(reason({}, older), "HOST_NOT_ATTESTED");
  assert.equal(reason({ handWired: () => true }), "ALREADY_WIRED");
  assert.equal(reason({ vaulted: () => null }), "EVIDENCE_NOT_VAULTED");
  assert.equal(reason({ vaultedBytes: () => null }), "EVIDENCE_NOT_VAULTED", "the government's page naming the body must be held too");
  assert.equal(reason({ verify: () => ({ refused: "the adapter could not run" }) }), "ADAPTER_REFUSED");
  assert.equal(reason({ verify: () => ({ changed: "the filter selects nothing" }) }), "REVIEW_TRIGGERED", "a row never promoted waits for review, unpromoted");
  for (const over of [{ registration: () => ({ notRegistered: "x" }) }, { vaulted: () => null }] as Partial<DerivedWiringInputs>[]) {
    assert.deepEqual(planDerivedVersion([], deriveWiringDecisions(inputs(attempt, over))).refusals, []);
  }
});

test("C16 TRIGGERS SUSPEND A PROMOTED ROW; OUTAGES HOLD IT, CARRIED", async () => {
  const previous = [await promotedEntry()];
  const cases: [Record<string, Reply>, Partial<DerivedWiringInputs>, string][] = [
    [{ ...SITE, [ROUTE]: { status: 404, body: "<html>Not Found</html>" } }, {}, "SUSPEND:ROUTE_GONE"],
    [{ ...SITE, [ROUTE]: { status: 410, body: "Gone" } }, {}, "SUSPEND:ROUTE_GONE"],
    [SITE, { verify: () => ({ changed: "the reviewed filter selects none of the feed's 12 events" }) }, "SUSPEND:CALENDAR_CHANGED"],
    [SITE, { verify: () => ({ wrongAttribution: "\"Planning Board\" is another reviewed body" }) }, "SUSPEND:WRONG_ATTRIBUTION"],
    [{ ...SITE, [ROUTE]: { status: 403, body: "Forbidden" } }, {}, "CHALLENGED"],
    [{ ...SITE, [ROUTE]: { status: 503, body: "Service Unavailable" } }, {}, "TRANSPORT_FAILED"],
  ];
  for (const [site, over, expected] of cases) {
    const [d] = deriveWiringDecisions(inputs(await walk(site, "example.gov"), { previous, ...over }));
    assert.equal(reasonOf(d), expected);
    const plan = planDerivedVersion(previous, [d!]);
    assert.deepEqual(plan.refusals, [], expected);
    assert.deepEqual(plan.rows.map((r) => r.key), [KEY], `${expected}: the row and its verified records are kept`);
    assert.equal(plan.rows[0]!.suspension !== undefined, expected.startsWith("SUSPEND:"), `${expected}: only a trigger suspends`);
  }
});

test("ROBOTS IS RECORDED, NOT BLOCKING: a walk over a disallowing robots.txt promotes the row; a recorded wall holds it as CHALLENGED; a pre-2026-09-25 robots skip holds it until the next walk", async () => {
  const disallow: Reply = { status: 200, body: "User-agent: *\nDisallow: /\n", contentType: "text/plain" };
  const overRobots = await walk({ ...SITE, "https://example.gov/robots.txt": disallow, "https://www.example.gov/robots.txt": disallow }, "example.gov");
  assert.equal(overRobots.outcome, "FOUND", "the public calendar is read over the robots.txt (owner decision 2026-09-25)");
  assert.ok(overRobots.steps.some((s) => s.url === ROUTE && s.status === 200 && s.permission === "DISALLOWED"), "the verdict is recorded on the read");
  assert.equal(reasonOf(deriveWiringDecisions(inputs(overRobots))[0]), "PROMOTE");

  const previous = [await promotedEntry()];
  const read = await walk(SITE, "example.gov");
  const unrequested = (permission: "RECORDED_WALL" | "DISALLOWED"): MeetingsDiscoveryAttempt => ({
    ...read,
    found: [],
    steps: [
      ...read.steps.filter((s) => s.url !== ROUTE),
      { purpose: "endpoint", url: ROUTE, permission, status: null, transportError: null, bytes: 0, artifactId: null, rung: null, note: `not requested: ${permission}` },
    ],
  });
  for (const [permission, expected] of [["RECORDED_WALL", "CHALLENGED"], ["DISALLOWED", "ROBOTS_REFUSED"]] as const) {
    const [d] = deriveWiringDecisions(inputs(unrequested(permission), { previous }));
    assert.equal(reasonOf(d), expected, permission);
    if (permission === "DISALLOWED") assert.match(d?.disposition === "HOLD" ? d.detail : "", /before 2026-09-25; the next walk reads it/);
    const plan = planDerivedVersion(previous, [d!]);
    assert.deepEqual(plan.rows.map((r) => r.key), [KEY], `${expected}: held, carried, never removed`);
    assert.equal(plan.rows[0]!.suspension, undefined, `${expected}: never a suspension`);
  }
});

test("A BOT CHALLENGE AT 200 ON A REVIEWED CALENDAR HOLDS THE ROW AS CHALLENGED — never read as the calendar, never a suspension", async () => {
  const challenge: Reply = { status: 200, body: "<html><head><title>Just a moment...</title></head></html>", contentType: "text/html" };
  const previous = [await promotedEntry()];
  const walled = await walk({ ...SITE, [ROUTE]: challenge }, "example.gov");
  const step = walled.steps.find((s) => s.url === ROUTE);
  assert.match(step?.accessControl ?? "", /challenge/, "the walk records the access control on the route's step");
  const [d] = deriveWiringDecisions(inputs(walled, { previous }));
  assert.equal(reasonOf(d), "CHALLENGED");
  const plan = planDerivedVersion(previous, [d!]);
  assert.deepEqual(plan.rows.map((r) => r.key), [KEY], "held, carried, never removed");
  assert.equal(plan.rows[0]!.suspension, undefined, "an access control never suspends a connection");
});

test("C16: two reviewed bodies selecting the same sitting is conflicting evidence, and neither is published", async () => {
  const attempt = await walk(SITE, "example.gov");
  const board = crosswalkRow({ bodyId: subBodyId(OCD, "Planning Board"), bodyRole: "SUB_BODY", bodyName: "Planning Board", filter: { titleMatch: "Council" },
    evidence: { ...crosswalkRow().evidence, bodyPage: { url: "https://www.example.gov/planning", sha256: "3".repeat(64), quote: "the Planning Board" } } });
  const decisions = deriveWiringDecisions(inputs(attempt, {}, [crosswalkRow(), board]));
  assert.deepEqual(decisions.map(reasonOf).sort(), ["REVIEW_TRIGGERED", "REVIEW_TRIGGERED"]);
  assert.ok(decisions.every((d) => d.disposition === "HOLD" && /CONFLICTING_EVIDENCE/.test(d.detail)));

  const previous = [await promotedEntry()];
  const withPrior = deriveWiringDecisions(inputs(attempt, { previous }, [crosswalkRow(), board]));
  assert.equal(reasonOf(withPrior.find((d) => d.key === KEY)), "SUSPEND:CONFLICTING_EVIDENCE");
});

test("C16: a withdrawn or vanished crosswalk row suspends its promoted row; only a review after the suspension restores it", async () => {
  const attempt = await walk(SITE, "example.gov");
  const previous = [await promotedEntry()];
  const withdrawn = deriveWiringDecisions(inputs(attempt, { previous }, [crosswalkRow({ status: "WITHDRAWN", withdrawal: { reason: "the calendar is the library's" } })]));
  assert.equal(reasonOf(withdrawn[0]), "SUSPEND:CROSSWALK_WITHDRAWN");
  assert.equal(reasonOf(deriveWiringDecisions(inputs(attempt, { previous }, []))[0]), "SUSPEND:CROSSWALK_WITHDRAWN");

  const suspended = planDerivedVersion(previous, withdrawn).rows;
  assert.equal(suspended[0]!.suspension?.trigger, "CROSSWALK_WITHDRAWN");
  const stale = deriveWiringDecisions(inputs(attempt, { previous: suspended }));
  assert.equal(reasonOf(stale[0]), "REVIEW_OWED", "the old review does not restore it");
  const reviewed = deriveWiringDecisions(inputs(attempt, { previous: suspended }, [crosswalkRow({ reviewedAt: "2026-09-25T03:00:00.000Z" })]));
  assert.equal(reasonOf(reviewed[0]), "PROMOTE");
  const restored = planDerivedVersion(suspended, reviewed);
  assert.deepEqual(restored.refusals, []);
  assert.equal(restored.rows[0]!.suspension, undefined);
});
