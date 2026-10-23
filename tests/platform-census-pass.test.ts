import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { runPlatformCensusPass } from "../lib/control-plane/discovery/platform-census-pass.ts";
import type { PlatformRegistrationPage } from "../lib/control-plane/discovery/platform-registration.ts";
import { fieldManualEntryId } from "../lib/control-plane/field-manual.ts";

const NOW = "2026-10-20T00:00:00.000Z";
function government(state: string, index: number): PlatformRegistrationPage {
  const id = `government:US-${state}:cog:${index}`;
  return { versionId: `version-${state}`, promotedAt: NOW, readModelHash: "c".repeat(64), government: {
    id, aliases: [], jurisdictionId: `${state.toLowerCase()}:city:example-${index}`, state, name: `Example ${index}`, kind: "GOVERNMENT",
    governmentClass: "CITY_OR_TOWN", nativeIds: { census_pid6: String(index) }, status: "Y", sourceVintage: "2022", website: null,
    officePhone: null, officeAddress: null, countyFips: null, associations: [{ divisionId: `ocd-division/country:us/state:${state.toLowerCase()}/place:example_${index}`,
      layer: "place", geoid: String(index), basis: "SOURCE_CODE" }], bodyIds: [], provenance: { sourceUrl: "https://census.gov/", sourceOrg: "Census", collectedAt: NOW, verifiedAt: null },
  } };
}

test("background enumeration takes turns across states and resumes the next government after a runner drain", async () => {
  const repos = createMemoryRepositories(), seen: string[] = [];
  const pages = { AL: [government("AL", 1), government("AL", 2)], AK: [government("AK", 1), government("AK", 2)] };
  const input = { repos, concurrency: 1, states: ["AL", "AK"], ownerSubjects: async () => [], now: () => NOW, reviewer: "auto-crosswalk-reviewer@0123456789ab",
    query: async (_sql: string, params: readonly unknown[]) => {
      const page = pages[params[0] as keyof typeof pages]?.[Number(params[1])];
      return page ? [page as unknown as Record<string, unknown>] : [];
    },
    runtimeFor: () => ({ open: async () => { throw new Error("A government without a website must not send a request"); },
      spaceOut: async () => {}, now: () => NOW, budget: { spent: () => false }, vault: async () => ({ stored: true, where: "fixture", why: "saved" }) }),
    onGovernment: (report: { government: string }) => { seen.push(report.government); },
  };
  await runPlatformCensusPass({ ...input, stopped: () => seen.length >= 2 });
  assert.deepEqual(seen, ["al:city:example-1", "ak:city:example-1"]);
  await runPlatformCensusPass({ ...input, stopped: () => seen.length >= 4 });
  assert.deepEqual(seen.slice(2), ["al:city:example-2", "ak:city:example-2"]);
});

test("an exact Admin subject goes ahead of background work without loading a state's inventory", async () => {
  const repos = createMemoryRepositories(), seen: string[] = [];
  const focus = government("AK", 2);
  await runPlatformCensusPass({ repos, concurrency: 1, states: ["AL", "AK"], ownerSubjects: async () => [focus.government.id], now: () => NOW,
    reviewer: "auto-crosswalk-reviewer@0123456789ab", stopped: () => seen.length > 0,
    query: async (sql, params) => {
      assert.match(sql, /LIMIT 1/);
      assert.equal(params[0], focus.government.id);
      return params[1] === "" ? [focus as unknown as Record<string, unknown>] : [];
    },
    runtimeFor: () => ({ open: async () => { throw new Error("No website"); }, spaceOut: async () => {}, now: () => NOW,
      budget: { spent: () => false }, vault: async () => ({ stored: true, where: "fixture", why: "saved" }) }),
    onGovernment: report => { seen.push(report.government); },
  });
  assert.deepEqual(seen, ["ak:city:example-2"]);
});

test("a drain cannot checkpoint past an unfinished earlier catalogue government", async () => {
  const repos = createMemoryRepositories();
  const pages = [government("AL", 1), government("AK", 2), government("AZ", 3)];
  let release!: () => void, completed!: () => void, draining = false;
  const first = new Promise<void>(resolve => { release = resolve; });
  const others = new Promise<void>(resolve => { completed = resolve; });
  const seen: string[] = [];
  const runtime = { open: async () => { throw new Error("No website"); }, spaceOut: async () => {}, now: () => NOW,
    vault: async () => ({ stored: true, where: "fixture", why: "saved" }), budget: { spent: () => draining } };
  const input = { repos, concurrency: 3, states: [], ownerSubjects: async () => [], now: () => NOW, reviewer: "auto-crosswalk-reviewer@0123456789ab",
    query: async (_sql: string, params: readonly unknown[]) => {
      const page = pages.find(page => page.government.name === params.at(-1)); return page ? [page as unknown as Record<string, unknown>] : [];
    }, catalog: { version: "directory-version", runtime, tenants: async function* (after: number) {
      for (const page of pages.slice(after)) yield { platform: "fixture", url: `https://example.gov/${page.government.id}`, name: page.government.name, state: page.government.state, source: "public directory" };
    } },
    runtimeFor: async (page: PlatformRegistrationPage) => { if (page === pages[0]) await first; return runtime; },
    onGovernment: (report: { government: string }) => { seen.push(report.government); if (seen.length === 2) completed(); },
  };
  const running = runPlatformCensusPass({ ...input, stopped: () => draining });
  await others;
  draining = true; release(); await running;
  const position = await repos.fieldManual.read(fieldManualEntryId("platform-catalog-position", "national"));
  assert.equal((position?.value.payload as { index: number }).index, 0);
  draining = false;
  await runPlatformCensusPass({ ...input, runtimeFor: async () => runtime, stopped: () => false });
  assert.ok(seen.filter(id => id === pages[0].government.jurisdictionId).length >= 2, "the unfinished first government is retried on the next child pass");
});

test("the scheduled next-day pass checks the government's own site again and cannot revive a directory-only portal", async () => {
  const repos = createMemoryRepositories(), base = government("OR", 1), requests: string[] = [];
  const website = "https://oregonmetro.gov/", portal = "https://metro.legistar.com/";
  const page = { ...base, government: { ...base.government, website, name: "Metro" } };
  let instant = NOW;
  const runtime = { open: async (request: { url: string }) => {
    requests.push(request.url);
    const body = request.url === website ? '<title>Metro</title>' : request.url === portal
      ? `<title>Metro - Calendar</title><a href="${website}">Official site</a>` : "";
    return { status: body ? 200 : 404, body, bytes: body.length, contentType: "text/html", location: null,
      transportError: null, retrievedAt: instant };
  }, spaceOut: async () => {}, now: () => instant, budget: { spent: () => false },
    vault: async () => ({ stored: true, where: "fixture", why: "saved" }) };
  const input = { repos, concurrency: 1, states: [], ownerSubjects: async () => [], now: () => instant,
    reviewer: "auto-crosswalk-reviewer@0123456789ab", stopped: () => false,
    query: async () => [page as unknown as Record<string, unknown>], runtimeFor: () => runtime,
    catalog: { version: "directory", runtime, tenants: async function* (after: number) {
      if (after === 0) yield { platform: "legistar", url: portal, name: "Metro", state: "OR", source: "directory" };
    } },
  };
  await runPlatformCensusPass(input);
  const today = requests.filter(url => url === website).length;
  assert.ok(today > 0);
  assert.deepEqual(await repos.doors.list(), []);
  instant = new Date(Date.parse(NOW) + 86_400_000).toISOString();
  await runPlatformCensusPass(input);
  assert.ok(requests.filter(url => url === website).length > today, "the twelve-hour marker expires before tomorrow's automatic pass");
  assert.deepEqual(await repos.doors.list(), []);
  assert.ok(requests.every(url => !url.includes("webapi.legistar.com")));
});
