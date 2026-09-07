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
import {
  allowanceFrom,
  burnFrom,
  classifyKeyLabel,
  normalizeTimeline,
  projectPanel,
} from "../lib/control-plane/maptiler/usage.ts";
import {
  DEFAULT_MAPTILER_ALLOWANCE,
  MAPTILER_SERVICE_TOKEN_VAR,
  MAPTILER_USAGE_FORMAT_VERSION,
  type MapTilerUsageDay,
  type MapTilerUsageSnapshot,
} from "../lib/control-plane/maptiler/types.ts";
import { assertAggregateOnly } from "../lib/control-plane/owner-surface.ts";

/**
 * **THE BILL, READ BACK** (MAPQ-5 through MAPQ-7, 2026-09-07).
 *
 * No live calls: the fixtures are SHAPED from MapTiler's published schema
 * rather than recorded, because this repository holds no service token and a
 * fabricated "recording" would be a lie about provenance. Both fixture files
 * say so in their own first field, and the day a real response is recorded the
 * note goes with it.
 */

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

/* ---------------------------------------------------------------- client */

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
  assert.match(panel.needsOwner.join(" "), new RegExp(MAPTILER_SERVICE_TOKEN_VAR));
  assert.match(panel.needsOwner.join(" "), /NOT a reading of zero/);
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

test("a token never survives a message", () => {
  assert.equal(scrubToken("failed with abc123 in it", "abc123"), "failed with <redacted> in it");
  assert.equal(scrubToken("nothing to hide", null), "nothing to hide");
});

/* ------------------------------------------------------------- normalize */

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

/* -------------------------------------------------------------- classify */

test("a key label is matched exactly, and anything else is UNCLASSIFIED", () => {
  assert.equal(classifyKeyLabel("meanwhile-prod-browser").identity, "meanwhile-prod-browser");
  assert.equal(classifyKeyLabel("  MEANWHILE-PROD-BROWSER ").identity, "meanwhile-prod-browser");
  assert.equal(classifyKeyLabel("meanwhile-staging-browser").expectation, "OWNER_MANUAL_STAGING");
  assert.equal(
    classifyKeyLabel("meanwhile-synthetic-provider-smoke").expectation,
    "BOUNDED_SMOKE",
  );

  /* Deliberately NOT fuzzy: a near-miss is a different key, and folding it into
   * production's number is how the first bill became unreadable. */
  assert.equal(classifyKeyLabel("meanwhile-prod-browser-old").identity, "UNCLASSIFIED");
  assert.equal(classifyKeyLabel("old-shared-key").identity, "UNCLASSIFIED");
  assert.equal(classifyKeyLabel("none").identity, "UNCLASSIFIED", "the no-key identity is not a key");
});

/* ---------------------------------------------------------------- panel */

test("the panel answers each of MAPQ-6's questions with a number or a named gap", async () => {
  const panel = projectPanel({ snapshot: await snapshot() });

  assert.equal(panel.connection, "CONNECTED");
  /*
   * 9,541 is the api_keys view (9,400 + 58 + 6 + 77) and 9,289 is the services
   * view. Two views of one population that disagree are two views of one
   * population that disagree, and the panel takes the LARGER — understating a
   * bill is the dangerous direction, and the gap between them is itself
   * something the owner can see in the two tables.
   */
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

/* ------------------------------------------------------- the boundary */

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

  /*
   * "People" is allowed in exactly one construction — the DENIAL. Forbidding
   * the word outright would forbid the sentence that states the boundary,
   * which is the sentence the owner actually needs, so every occurrence is
   * checked to be a denial rather than the word being banned.
   */
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
