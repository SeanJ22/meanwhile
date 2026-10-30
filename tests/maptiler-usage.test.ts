import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { MAPTILER_ANALYTICS_BASE, fetchTimeline, scrubToken, timelineUrl, type MapTilerTimeline } from "../lib/control-plane/maptiler/client.ts";
import { collectMapTilerUsage } from "../lib/control-plane/maptiler/collector.ts";
import { allowanceFrom, normalizeTimeline } from "../lib/control-plane/maptiler/usage.ts";
import { DEFAULT_MAPTILER_ALLOWANCE, MAPTILER_SERVICE_TOKEN_VAR } from "../lib/control-plane/maptiler/types.ts";

/** The fixtures are shaped from MapTiler's published schema, not recorded; each says so in its first field. */
const FIXTURES = join(process.cwd(), "tests", "fixtures");

async function fixture(name: string): Promise<MapTilerTimeline> {
  return JSON.parse(await readFile(join(FIXTURES, name), "utf8")) as MapTilerTimeline;
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

test("the allowance is stated as assumed until somebody confirms it", () => {
  assert.deepEqual(allowanceFrom(undefined), { allowance: DEFAULT_MAPTILER_ALLOWANCE, assumed: true });
  assert.deepEqual(allowanceFrom("nonsense"), { allowance: DEFAULT_MAPTILER_ALLOWANCE, assumed: true });
  assert.deepEqual(allowanceFrom("250000"), { allowance: 250_000, assumed: false });
});

