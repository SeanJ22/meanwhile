import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  MAPTILER_ANALYTICS_BASE,
  fetchTimeline,
  scrubToken,
  serviceTokenFromEnv,
  timelineUrl,
  type MapTilerTimeline,
} from "../lib/control-plane/maptiler/client.ts";
import { collectMapTilerUsage } from "../lib/control-plane/maptiler/collector.ts";
import { readMapTilerUsageDigests } from "../lib/control-plane/admin-data.ts";
import {
  appendMapTilerUsageCollectionDigest,
  mapTilerUsageCollectionOutcome,
  mapTilerUsageCollectionOutcomes,
} from "../lib/control-plane/freshness-cycle-outcome.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import {
  allowanceFrom,
  maptilerHistoryNumbers,
  maptilerSectionNumbers,
  burnFrom,
  classifyKeyLabel,
  normalizeTimeline,
  projectMapTilerAttemptHistory,
  projectPanel,
  retainMapTilerLastKnownGood,
} from "../lib/control-plane/maptiler/usage.ts";
import {
  DEFAULT_MAPTILER_ALLOWANCE,
  MAPTILER_SERVICE_TOKEN_VAR,
  MAPTILER_USAGE_FORMAT_VERSION,
  type MapTilerUsageDay,
  type MapTilerUsageSnapshot,
} from "../lib/control-plane/maptiler/types.ts";
import {
  assertAggregateOnly,
  auditRenderedNumbers,
  ownerDigestAttention,
} from "../lib/control-plane/owner-surface.ts";

/** The fixtures are shaped from MapTiler's published schema, not recorded; each says so in its first field. */
const FIXTURES = join(process.cwd(), "tests", "fixtures");

async function fixture(name: string): Promise<MapTilerTimeline> {
  return JSON.parse(await readFile(join(FIXTURES, name), "utf8")) as MapTilerTimeline;
}

async function daysFromFixtures(): Promise<readonly MapTilerUsageDay[]> {
  return [
    ...normalizeTimeline({
      timeline: await fixture("maptiler-timeline-api-keys.json"),
      classifier: "api_keys",
      group: "request",
    }),
    ...normalizeTimeline({
      timeline: await fixture("maptiler-timeline-services.json"),
      classifier: "services",
      group: "request",
    }),
  ];
}

async function snapshot(
  overrides: Partial<MapTilerUsageSnapshot> = {},
): Promise<MapTilerUsageSnapshot> {
  return {
    formatVersion: MAPTILER_USAGE_FORMAT_VERSION,
    collectedAt: "2026-09-07T12:00:00.000Z",
    publisher: "pnpm maptiler:usage",
    connection: "CONNECTED",
    detail: null,
    period: "current_billing_period",
    since: "2026-09-01",
    until: "2026-09-30",
    allowance: DEFAULT_MAPTILER_ALLOWANCE,
    allowanceIsAssumed: true,
    days: await daysFromFixtures(),
    provenance: [],
    actors: null,
    ...overrides,
  };
}

test("the analytics URL asks by api_keys and by services, and carries no credential", () => {
  const keys = timelineUrl({ period: "current_billing_period", classifier: "api_keys", group: "request" });
  assert.ok(keys.startsWith(`${MAPTILER_ANALYTICS_BASE}/timeline?`), keys);
  assert.match(keys, /classifier=api_keys/, "attribution needs the api_keys classifier");
  assert.match(keys, /period=current_billing_period/);
  assert.match(keys, /group=request/);
  assert.doesNotMatch(keys, /key=|token=|Token/i, "the credential travels in a header, never a URL");

  const services = timelineUrl({ period: "current_billing_period", classifier: "services", group: "request" });
  assert.match(services, /classifier=services/, "Tiles and Rendered maps must stay separable");
});

test("no service token is NOT CONNECTED, and it is never zero usage", async () => {
  assert.equal(serviceTokenFromEnv({}), null);
  assert.equal(serviceTokenFromEnv({ [MAPTILER_SERVICE_TOKEN_VAR]: "   " }), null);
  assert.equal(serviceTokenFromEnv({ [MAPTILER_SERVICE_TOKEN_VAR]: "abc" }), "abc");

  const panel = projectPanel({ snapshot: await snapshot({ connection: "NOT_CONNECTED", detail: null }) });
  assert.equal(panel.used, null, "an unasked question must never render as a measured zero");
  assert.match(panel.says, /NOT CONNECTED/);
  assert.match(
    panel.needsOwner.join(" "),
    /not a reading of zero/i,
    "the owner must be told the difference between an unasked question and a measured zero",
  );
  assert.match(panel.needsOwner.join(" "), /credential/i, "and what is missing, in plain words");
});

test("the panel's face-rendered prose carries no machine constant, command or code path", async () => {
  for (const snap of [await snapshot(), await snapshot({ connection: "NOT_CONNECTED", days: [] })]) {
    const panel = projectPanel({ snapshot: snap });
    /* Every string the component renders OUTSIDE its <details> block. */
    const face = [
      panel.says,
      panel.automationSays,
      panel.actors?.says ?? "",
      ...panel.actors?.defects ?? [],
      ...panel.byKey.map((r) => `${r.label} ${r.says}`),
      ...panel.byService.map((r) => r.service),
      ...panel.needsOwner,
      panel.burn?.says ?? "",
    ].join("  ");

    // The first three patterns match `scripts/admin-plain-sweep.mts` OFFENCES; the fourth widens the source-path rule to tests.
    assert.doesNotMatch(
      face,
      /[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+/,
      "ADM-25: an underscore standing for a space is not English — move it into Technical details",
    );
    assert.doesNotMatch(face, /pnpm [a-z]/, "ADM-37: the owner is not a coder and cannot run one");
    assert.doesNotMatch(
      face,
      /lib[/][a-z0-9-]+[/][a-z0-9-]+/,
      "ADM-46: a code path is not an explanation",
    );
    assert.doesNotMatch(
      face,
      /tests[/][a-z0-9-]+[.]test[.]ts/,
      "a test file is not an explanation either",
    );
  }
});

test("a non-200 is a failed read with its provenance, never an empty timeline", async () => {
  const result = await fetchTimeline({
    period: "current_billing_period",
    classifier: "api_keys",
    group: "request",
    token: "SECRET-TOKEN-VALUE",
    nowIso: "2026-09-07T12:00:00.000Z",
    fetcher: async () => ({ status: 403, text: async () => "forbidden: SECRET-TOKEN-VALUE" }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.timeline, null, "a refusal must not become an empty reading");
  assert.equal(result.provenance.status, 403);
  assert.equal(result.provenance.responseSha256.length, 64, "the body must be auditable by digest");
  assert.match(result.provenance.error ?? "", new RegExp(MAPTILER_SERVICE_TOKEN_VAR));
  assert.doesNotMatch(
    JSON.stringify(result.provenance),
    /SECRET-TOKEN-VALUE/,
    "a credential must never reach a provenance record",
  );
});

test("a 200 records enough provenance to audit the number back to the bytes", async () => {
  const body = JSON.stringify(await fixture("maptiler-timeline-api-keys.json"));
  const result = await fetchTimeline({
    period: "current_billing_period",
    classifier: "api_keys",
    group: "request",
    token: "T",
    nowIso: "2026-09-07T12:00:00.000Z",
    fetcher: async (_url, init) => {
      assert.equal(init.headers.Authorization, "Token T", "the service token travels in the header");
      return { status: 200, text: async () => body };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.provenance.status, 200);
  assert.equal(result.provenance.responseBytes, Buffer.byteLength(body, "utf8"));
  assert.equal(result.provenance.datasets, 4);
  assert.ok(result.provenance.points > 0);
  assert.equal(result.provenance.error, null);
});

test("a 200 with no measured rows is a failed extraction, never measured zero", async () => {
  const body = JSON.stringify({ since: "2026-09-01", until: "2026-09-30", datasets: [] });
  const result = await fetchTimeline({
    period: "current_billing_period",
    classifier: "api_keys",
    group: "request",
    token: "T",
    nowIso: "2026-09-07T12:00:00.000Z",
    fetcher: async () => ({ status: 200, text: async () => body }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.timeline, null);
  assert.match(result.provenance.error ?? "", /zero-row extraction/i);
});

test("a token never survives a message", () => {
  assert.equal(scrubToken("failed with abc123 in it", "abc123"), "failed with <redacted> in it");
  assert.equal(scrubToken("nothing to hide", null), "nothing to hide");
});

test("the provider's own vocabulary survives normalization", async () => {
  const days = normalizeTimeline({
    timeline: await fixture("maptiler-timeline-api-keys.json"),
    classifier: "api_keys",
    group: "request",
  });
  assert.ok(days.length >= 11, `expected the fixture's points, got ${days.length}`);
  for (const day of days) {
    assert.match(day.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(day.classifier, "api_keys");
    assert.equal(day.group, "request");
    assert.ok(day.label.length > 0, "every row must carry the provider's own label");
    assert.ok(Number.isFinite(day.count));
  }
  /* A projection is marked, never merged into a measurement. */
  const estimated = days.filter((d) => d.estimated);
  assert.equal(estimated.length, 1, "the fixture's projected tail must survive as an estimate");
  assert.equal(estimated[0].date, "2026-09-30");
});

test("services stay separable — Tiles and Rendered maps never collapse", async () => {
  const panel = projectPanel({ snapshot: await snapshot() });
  const services = panel.byService.map((s) => s.service).sort();
  assert.deepEqual(services, ["Rendered maps", "Tiles"]);
  assert.ok(
    panel.byService.every((s) => s.requests > 0),
    "a service row with no number explains nothing",
  );
});

test("normalization refuses omitted identities, dates, and counts instead of manufacturing zero", () => {
  const timeline = (dataset: object): MapTilerTimeline => ({
    since: "2026-09-01",
    until: "2026-09-30",
    datasets: [dataset],
  });
  assert.throws(
    () => normalizeTimeline({ timeline: timeline({ data: [{ date: "2026-09-01", value: 1 }] }), classifier: "api_keys", group: "request" }),
    /ITEM_ID_MISSING/,
  );
  assert.throws(
    () => normalizeTimeline({ timeline: timeline({ item_id: "key", data: [{ value: 1 }] }), classifier: "api_keys", group: "request" }),
    /DATE_INVALID/,
  );
  assert.throws(
    () => normalizeTimeline({ timeline: timeline({ item_id: "key", data: [{ date: "2026-09-01" }] }), classifier: "api_keys", group: "request" }),
    /COUNT_INVALID/,
  );
  assert.throws(
    () => normalizeTimeline({ timeline: timeline({ item_id: "key", data: [{ date: "2026-09-01", value: -1 }] }), classifier: "api_keys", group: "request" }),
    /COUNT_INVALID/,
  );
});

test("the standing collector refuses a partial classifier answer", async () => {
  const keys = JSON.stringify(await fixture("maptiler-timeline-api-keys.json"));
  const candidate = await collectMapTilerUsage({
    nowIso: "2026-09-08T12:00:00.000Z",
    token: "T",
    fetcher: async (url) => url.includes("classifier=api_keys")
      ? { status: 200, text: async () => keys }
      : { status: 503, text: async () => "unavailable" },
  });
  assert.equal(candidate.connection, "COULD_NOT_ASK");
  assert.equal(candidate.days.length, 0, "partial rows must never become the current measurement");
  assert.equal(candidate.provenance.length, 2);
  assert.match(candidate.detail ?? "", /partial result was refused/i);
});

test("the standing collector requires both classifiers to describe one billing window", async () => {
  const keys = await fixture("maptiler-timeline-api-keys.json");
  const services = await fixture("maptiler-timeline-services.json");
  const candidate = await collectMapTilerUsage({
    nowIso: "2026-09-08T12:00:00.000Z",
    token: "T",
    fetcher: async (url) => ({
      status: 200,
      text: async () => JSON.stringify(
        url.includes("classifier=api_keys") ? keys : { ...services, until: "2026-10-01" },
      ),
    }),
  });
  assert.equal(candidate.connection, "COULD_NOT_ASK");
  assert.match(candidate.detail ?? "", /different billing windows/i);
});

test("failed collection retains the prior measured snapshot and exposes LKG in Admin", async () => {
  const previous = await snapshot({
    collectedAt: "2026-09-07T12:00:00.000Z",
    publisher: "standing-runtime/maptiler-observer",
  });
  const candidate = await collectMapTilerUsage({
    nowIso: "2026-09-08T12:00:00.000Z",
    token: "T",
    fetcher: async () => ({ status: 503, text: async () => "unavailable" }),
  });
  const retained = retainMapTilerLastKnownGood({ candidate, previous });
  assert.equal(retained.connection, "CONNECTED");
  assert.equal(retained.collectedAt, previous.collectedAt, "failed refresh must not erase the measured instant");
  assert.deepEqual(retained.days, previous.days, "failed refresh must not erase or partially replace LKG rows");
  assert.equal(retained.latestAttempt?.connection, "COULD_NOT_ASK");
  assert.equal(retained.latestAttempt?.attemptedAt, candidate.collectedAt);

  const panel = projectPanel({ snapshot: retained });
  assert.equal(panel.readingState, "MEASURED_LKG");
  assert.match(panel.says, /last-known-good/i);
  assert.match(panel.latestAttemptSays ?? "", /standing runner will retry/i);
  assert.ok(panel.used !== null, "LKG remains a measured value, not an unknown or zero");
});

test("every MapTiler attempt is append-only history before the replaceable current/LKG projection", async () => {
  const repos = createMemoryRepositories();
  const previous = await snapshot({ publisher: "standing-runtime/maptiler-observer" });
  const failed = await collectMapTilerUsage({
    nowIso: "2026-09-08T12:00:00.000Z",
    token: "T",
    fetcher: async () => ({ status: 503, text: async () => "unavailable" }),
  });
  const visible = retainMapTilerLastKnownGood({ candidate: failed, previous });
  const outcome = mapTilerUsageCollectionOutcome({
    candidate: failed,
    visible,
    finishedAt: "2026-09-08T12:00:02.000Z",
    testedSha: "a".repeat(40),
    host: "test-host",
    provider: repos.describe(),
    durable: repos.durable,
  });
  const receipt = await appendMapTilerUsageCollectionDigest(repos, {
    outcome,
    lines: ["Map provider automatic collection: RETAINED_LKG."],
  });
  assert.equal(outcome.disposition, "RETAINED_LKG");
  assert.equal(outcome.authorityBoundary.gitWrites, 0);
  assert.equal(outcome.authorityBoundary.softwareReleaseEvents, 0);
  assert.equal(ownerDigestAttention(receipt).level, "AMBER");

  const keys = JSON.stringify(await fixture("maptiler-timeline-api-keys.json"));
  const services = JSON.stringify(await fixture("maptiler-timeline-services.json"));
  const succeeded = await collectMapTilerUsage({
    nowIso: "2026-09-08T13:00:00.000Z",
    token: "T",
    actorCounter: async () => null,
    fetcher: async (url) => ({
      status: 200,
      text: async () => url.includes("classifier=api_keys") ? keys : services,
    }),
  });
  const current = retainMapTilerLastKnownGood({ candidate: succeeded, previous: visible });
  const succeededOutcome = mapTilerUsageCollectionOutcome({
    candidate: succeeded,
    visible: current,
    finishedAt: "2026-09-08T13:00:02.000Z",
    testedSha: "a".repeat(40),
    host: "test-host",
    provider: repos.describe(),
    durable: repos.durable,
  });
  await appendMapTilerUsageCollectionDigest(repos, {
    outcome: succeededOutcome,
    lines: ["Map provider automatic collection: PROMOTED_CURRENT."],
  });

  const stored = await repos.ownerDigests.read("owner-digest");
  assert.equal(stored.length, 2);
  assert.deepEqual(mapTilerUsageCollectionOutcomes(stored), [outcome, succeededOutcome]);
  assert.equal(
    stored[0]?.runtimeOutcome?.kind,
    "MAPTILER_USAGE_COLLECTION",
    "a failed attempt must not exist only on the replaceable owner snapshot",
  );

  const adminRead = await readMapTilerUsageDigests(repos);
  assert.equal(adminRead.kind, "HELD");
  if (adminRead.kind !== "HELD") throw new Error("map-provider history was not held");
  assert.deepEqual(
    adminRead.value.map((row) => row.digestId),
    [succeededOutcome.cycleId, outcome.cycleId],
    "Admin must read the dedicated append-only map history newest first, not filter the bounded latest-digest list",
  );
  const history = projectMapTilerAttemptHistory(
    adminRead.value,
    "2026-09-09T12:30:00.000Z",
  );
  assert.deepEqual(
    history.windows.map((window) => ({
      id: window.id,
      attempts: window.attempts,
      promoted: window.promotedCurrent,
      lkg: window.retainedLkg,
    })),
    [
      { id: "24h", attempts: 1, promoted: 1, lkg: 0 },
      { id: "7d", attempts: 2, promoted: 1, lkg: 1 },
      { id: "30d", attempts: 2, promoted: 1, lkg: 1 },
    ],
  );
  assert.equal(history.attempts.length, 2, "the exact 30-day drilldown must retain both receipts");
  assert.equal(auditRenderedNumbers(maptilerHistoryNumbers(history)).ok, true);
});

test("a missing actor aggregate is an explicit UNKNOWN beside a valid provider measurement", async () => {
  const keys = JSON.stringify(await fixture("maptiler-timeline-api-keys.json"));
  const services = JSON.stringify(await fixture("maptiler-timeline-services.json"));
  const candidate = await collectMapTilerUsage({
    nowIso: "2026-09-08T12:00:00.000Z",
    token: "T",
    actorCounter: async () => null,
    fetcher: async (url) => ({
      status: 200,
      text: async () => url.includes("classifier=api_keys") ? keys : services,
    }),
  });
  assert.equal(candidate.connection, "CONNECTED");
  const panel = projectPanel({ snapshot: candidate });
  assert.equal(panel.readingState, "MEASURED_CURRENT");
  assert.equal(panel.actors?.state, "UNKNOWN");
  assert.match(panel.actors?.says ?? "", /unknown, not zero/i);
});

test("a key label is matched exactly, and anything else is UNCLASSIFIED", () => {
  assert.equal(classifyKeyLabel("meanwhile-prod-browser").identity, "meanwhile-prod-browser");
  assert.equal(classifyKeyLabel("  MEANWHILE-PROD-BROWSER ").identity, "meanwhile-prod-browser");
  assert.equal(classifyKeyLabel("meanwhile-staging-browser").expectation, "OWNER_MANUAL_STAGING");
  assert.equal(
    classifyKeyLabel("meanwhile-synthetic-provider-smoke").expectation,
    "BOUNDED_SMOKE",
  );

  /* Deliberately not fuzzy: a near-miss is a different key. */
  assert.equal(classifyKeyLabel("meanwhile-prod-browser-old").identity, "UNCLASSIFIED");
  assert.equal(classifyKeyLabel("old-shared-key").identity, "UNCLASSIFIED");
  assert.equal(classifyKeyLabel("none").identity, "UNCLASSIFIED", "the no-key identity is not a key");
});

test("the panel answers each of MAPQ-6's questions with a number or a named gap", async () => {
  const panel = projectPanel({ snapshot: await snapshot() });

  assert.equal(panel.connection, "CONNECTED");
  // The api_keys view and the services view disagree; the panel takes the larger, since understating a bill is the dangerous direction.
  assert.equal(panel.used, 9541, "the period total must be the measured request rows");
  assert.equal(panel.allowance, DEFAULT_MAPTILER_ALLOWANCE);
  assert.equal(panel.remaining, DEFAULT_MAPTILER_ALLOWANCE - 9541);
  assert.ok(panel.estimatedIncluded > 0, "the provider's projection is reported, not summed in");

  const byLabel = new Map(panel.byKey.map((r) => [r.label, r]));
  assert.equal(byLabel.get("meanwhile-prod-browser")?.requests, 9400);
  assert.equal(byLabel.get("meanwhile-staging-browser")?.requests, 58);
  assert.equal(byLabel.get("meanwhile-synthetic-provider-smoke")?.requests, 6);

  /* The row that is meant to be visually obvious. */
  const unclassified = byLabel.get("old-shared-key");
  assert.ok(unclassified, "an undeclared key must get its own row, never be folded away");
  assert.equal(unclassified?.expectedZero, true);
  assert.equal(unclassified?.requests, 77);
  assert.match(
    panel.needsOwner.join(" "),
    /old-shared-key/,
    "an undeclared key with traffic must reach the owner",
  );

  assert.ok(panel.burn, "average daily burn must be measured");
  assert.equal(panel.burn?.windowDays, 7);
  assert.match(panel.burn?.says ?? "", /allowance runs out on \d{4}-\d{2}-\d{2}/);
  assert.equal(panel.automationBlocked, true);
});

test("every declared key gets a row even at zero — that is how a stopped spend is visible", async () => {
  const quiet = await snapshot({
    days: (await daysFromFixtures()).filter((d) => d.label === "meanwhile-prod-browser"),
  });
  const panel = projectPanel({ snapshot: quiet });
  const labels = panel.byKey.map((r) => r.label).sort();
  assert.deepEqual(labels, [
    "meanwhile-prod-browser",
    "meanwhile-staging-browser",
    "meanwhile-synthetic-provider-smoke",
  ]);
  assert.equal(panel.byKey.find((r) => r.identity === "meanwhile-synthetic-provider-smoke")?.requests, 0);
});

test("burn is measured over a stated window and never over the provider's own projection", () => {
  const days: MapTilerUsageDay[] = [
    { date: "2026-09-01", classifier: "api_keys", itemId: "k", label: "meanwhile-prod-browser", group: "request", count: 100, estimated: false },
    { date: "2026-09-02", classifier: "api_keys", itemId: "k", label: "meanwhile-prod-browser", group: "request", count: 300, estimated: false },
    { date: "2026-09-30", classifier: "api_keys", itemId: "k", label: "meanwhile-prod-browser", group: "request", count: 99_999, estimated: true },
  ];
  const burn = burnFrom({ days, remaining: 800, windowDays: 7 });
  assert.equal(burn?.perDay, 200, "the projection must not be an input to the projection");
  assert.equal(burn?.windowSince, "2026-09-01");
  assert.equal(burn?.windowUntil, "2026-09-02");
  assert.equal(burn?.exhaustionDate, "2026-09-06");

  assert.equal(burnFrom({ days: [], remaining: 10, windowDays: 7 }), null, "no days is no reading");
});

test("the allowance is stated as assumed until somebody confirms it", () => {
  assert.deepEqual(allowanceFrom(undefined), { allowance: DEFAULT_MAPTILER_ALLOWANCE, assumed: true });
  assert.deepEqual(allowanceFrom("nonsense"), { allowance: DEFAULT_MAPTILER_ALLOWANCE, assumed: true });
  assert.deepEqual(allowanceFrom("250000"), { allowance: 250_000, assumed: false });
});

test("the panel never calls production-key usage a count of people", async () => {
  const panel = projectPanel({
    snapshot: await snapshot({
      actors: {
        since: "2026-09-01",
        until: "2026-09-07",
        declaredSynthetic: 412,
        undeclaredPublic: 96,
        unattributed: 537,
        author: 20,
      },
    }),
  });

  const prose = [
    panel.says,
    panel.automationSays,
    panel.actors?.says ?? "",
    ...panel.byKey.map((r) => r.says),
    ...panel.needsOwner,
  ].join(" ");

  /* Words that can only ever be a claim about who sent a request. */
  for (const forbidden of [/\bhumans?\b/i, /\bpersons?\b/i, /\borganic\b/i, /\breal (users|visitors)\b/i]) {
    assert.doesNotMatch(
      prose,
      forbidden,
      `the panel must not claim ${forbidden} — production-key usage is public-origin usage, ` +
        "and an outside crawler that runs the site is part of it",
    );
  }

  // "People" is allowed only in the sentence that denies it.
  const mentions = prose.match(/.{0,24}\bpeople\b/gi) ?? [];
  assert.ok(mentions.length > 0, "the boundary must be stated, not merely obeyed");
  for (const mention of mentions) {
    assert.match(
      mention,
      /not a count of people/i,
      `"${mention.trim()}" reads as a claim about people rather than a denial of one`,
    );
  }
  assert.match(prose, /app events, not map sessions/, "an event count is not a session count");
});

test("a synthetic run that reached the provider is a defect, not a ratio", async () => {
  const panel = projectPanel({
    snapshot: await snapshot({
      actors: { since: "2026-09-01", until: "2026-09-07", declaredSynthetic: 1, undeclaredPublic: 1, unattributed: 0, author: 0 },
    }),
  });
  assert.ok(panel.actors);
  assert.equal(panel.actors?.defects.length, 1, "the undeclared key must surface as a defect");
  assert.match(panel.actors?.defects[0] ?? "", /old-shared-key/);
  /* And it must not have been normalized into an expected proportion. */
  assert.doesNotMatch(panel.actors?.says ?? "", /ratio|expected proportion|%/);
});

test("a published snapshot carries no reader-level field", async () => {
  const snap = await snapshot({
    actors: { since: "2026-09-01", until: "2026-09-07", declaredSynthetic: 1, undeclaredPublic: 2, unattributed: 3, author: 4 },
  });
  assertAggregateOnly(snap, "maptiler usage snapshot");
  assertAggregateOnly(projectPanel({ snapshot: snap }), "maptiler panel");
});

test("every number the panel renders carries a denominator and a contract", async () => {
  const panel = projectPanel({ snapshot: await snapshot() });
  const numbers = maptilerSectionNumbers(panel);

  /* An empty array would pass auditRenderedNumbers vacuously. */
  assert.ok(
    numbers.length >= 8,
    `the panel declared only ${numbers.length} number(s) — the fixture has one total, ` +
      "three key rows, two service rows and a burn window, so a smaller count means " +
      "figures are reaching the owner outside the audit again",
  );

  const verdict = auditRenderedNumbers([...numbers]);
  assert.equal(verdict.ok, true, verdict.detail);
  assert.equal(verdict.checked, numbers.length);

  for (const number of numbers) {
    assert.ok(number.denominator !== null && number.denominator !== undefined, `${number.label} has no denominator`);
    assert.ok((number.contract ?? "").trim().length > 20, `${number.label} has no real contract`);
  }

  /* Every key row is represented, including the undeclared one. */
  for (const row of panel.byKey) {
    assert.ok(
      numbers.some((num) => num.label.includes(row.label)),
      `key row ${row.label} renders a number that never reaches the audit`,
    );
  }
});

test("an unasked question declares no numbers at all", async () => {
  const panel = projectPanel({ snapshot: await snapshot({ connection: "NOT_CONNECTED", days: [] }) });
  assert.deepEqual(
    maptilerSectionNumbers(panel),
    [],
    "NOT CONNECTED renders no figures, so it must declare none — a declared zero here would be " +
      "the measured-zero lie this whole panel exists to avoid",
  );
});
