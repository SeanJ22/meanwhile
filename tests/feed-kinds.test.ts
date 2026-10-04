import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import { allCapabilities, buildCompositeSource, CAPABILITIES } from "../lib/sources/composite/wiring.ts";
import { feedKindProblem, feedKindWiringType, installFeedKinds, installedFeedKinds, type FeedKindDeclaration } from "../lib/sources/feed-kinds.ts";
import { meetingSourceNamesForWiring, type BodySourceWiring } from "../lib/registry/source-wiring.ts";
import { installFeedKindsFromAdapters } from "../lib/control-plane/scheduler/scout-adapters.ts";

const builtIn = new Set(CAPABILITIES.map((c) => c.name));
afterEach(() => { installFeedKinds([], builtIn); });

const kind: FeedKindDeclaration = {
  kind: "example-portal",
  configKeys: ["pageUrl"],
  async read(door, ctx) {
    const { text } = await ctx.getText(door.config.pageUrl!);
    return text.split("\n").filter(Boolean).map((line) => {
      const [title, when, place] = line.split("|");
      return { id: `${title}-${when}`, title: title!, startsAt: when!, sourceUrl: door.config.pageUrl!, location: place ? { name: place, address: null, lat: 1, lng: 2 } : null, bodyName: "Example Board" };
    });
  },
};

const wiring = (type: string): BodySourceWiring => ({
  bodyId: "body-1", ocdId: "ocd-division/country:us/state:zz/place:example" as BodySourceWiring["ocdId"], agendaSourceType: type as BodySourceWiring["agendaSourceType"],
  jurisdiction: "Example", publishingOrg: "Example", timeZone: "America/Phoenix", config: { slug: "ex", pageUrl: "https://records.example.gov/meetings" }, verifiedAt: "2026-10-04T00:00:00Z",
});

test("a declaration is checked, and a built-in name can never be taken", () => {
  assert.equal(feedKindProblem(kind), null);
  assert.match(feedKindProblem({ ...kind, kind: "Bad Name" }) ?? "", /lower-case/);
  assert.match(feedKindProblem({ ...kind, configKeys: ["ok", "not ok"] }) ?? "", /setting names/);
  assert.match(feedKindProblem({ ...kind, read: undefined }) ?? "", /no read/);
  const result = installFeedKinds([{ ...kind, kind: "ical" }, kind, { ...kind }], builtIn);
  assert.deepEqual(result.installed, ["example-portal"]);
  assert.equal(result.refused.length, 2);
  assert.match(result.refused[0]!, /already taken/);
});

test("with no feed kind installed composite wiring is exactly what it was", () => {
  assert.equal(allCapabilities(), CAPABILITIES);
  assert.deepEqual(meetingSourceNamesForWiring(wiring("EXAMPLE_PORTAL")), []);
});

test("doors of an installed kind are served by its source and publish meetings with the same fields as any other", async () => {
  installFeedKinds([kind], builtIn);
  assert.equal(installedFeedKinds().length, 1);
  const row = wiring(feedKindWiringType("example-portal"));
  assert.deepEqual(meetingSourceNamesForWiring(row), ["example-portal"]);
  const day = (n: number): string => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  const page = `Budget hearing|${day(3)}T18:00|City Hall\nWork session|${day(4)}T09:30\nBroken row|not a time\nBudget hearing|${day(3)}T18:00|dup`;
  const fetchImpl = (async () => new Response(page, { status: 200, headers: { "content-type": "text/plain" } })) as typeof fetch;
  const source = buildCompositeSource({ sourceNames: ["example-portal"], derivedRows: [row], fetchImpl });
  const raw = await source.fetch({ lat: 39.5, lng: -98.35, radiusKm: 5000, startsAfter: "2000-01-01T00:00:00Z", startsBefore: "2100-01-01T00:00:00Z" });
  const meetings = (source as unknown as { normalize(raw: unknown[]): Array<Record<string, unknown>> }).normalize(raw as unknown[]);
  assert.equal(meetings.length, 2);
  const [first] = meetings;
  assert.equal(first!.bodyId, "body-1");
  assert.equal(first!.status, "SCHEDULED");
  assert.equal(first!.startsAt, `${day(3)}T18:00:00-07:00`);
  assert.equal((first!.provenance as { sourceUrl: string }).sourceUrl, "https://records.example.gov/meetings");
  assert.equal(String(first!.id).startsWith("example-portal:ex:"), true);
  assert.equal(meetings[1]!.location, null, "a missing place is kept as our own gap, not dropped");
  assert.deepEqual(meetings[1]!.venueGap, { kind: "NOT_STATED_BY_PUBLISHER", publishedText: null, publisher: "Example" });
});

test("the loader installs nothing when no installed adapter declares a kind, and refuses none", async () => {
  const result = await installFeedKindsFromAdapters();
  assert.deepEqual(result, { installed: [], refused: [] });
});
