import assert from "node:assert/strict";
import nodeTest from "node:test";
import { withSourceTransport } from "./helpers/source-fetch.ts";
const test = (name: string, operation: () => void | Promise<void>) => nodeTest(name, () => withSourceTransport(undefined, operation));

import { createMemoryRepositories } from "@/lib/control-plane/repository/memory.ts";
import { listDoors } from "@/lib/doors/registry.ts";
import { memoryWebsitePacing } from "@/lib/control-plane/website-pacing.ts";
import { collectOutboundLinks, readEdgeForSweep, recordSweep, summarizeSweep, sweepLinks, type SweepFetch } from "@/lib/doors/link-sweep.ts";

const edge = {
  sources: [{ sourceUrl: "https://records.example.gov/calendar.ics" }],
  meetings: [
    { id: "m1", officialSite: "https://www.example.gov/", agendaUrl: "https://www.example.gov/files/agenda-1.pdf", joinUrl: "https://example.zoom.us/j/123" },
    { id: "m2", notes: "see http://insecure.example.gov/x and https://www.example.gov/other#frag", link: "https://user:pw@secret.example.gov/x" },
  ],
};

test("links are collected once, https only, with the surface their key names", () => {
  const links = collectOutboundLinks([edge, edge]);
  const by = Object.fromEntries(links.map((l) => [l.url, l.surface]));
  assert.equal(by["https://records.example.gov/calendar.ics"], "sources");
  assert.equal(by["https://www.example.gov/"], "official sites");
  assert.equal(by["https://www.example.gov/files/agenda-1.pdf"], "agenda PDFs");
  assert.equal(by["https://example.zoom.us/j/123"], "join links");
  assert.equal(Object.keys(by).some((u) => u.startsWith("http://") || u.includes("secret")), false);
  assert.equal(links.length, 4);
});

const quiet = () => ({ now: () => 1_000_000, pacing: memoryWebsitePacing() });

test("dead means gone or not found; a slow or refusing publisher is later, never dead; Retry-After stops that host for the pass", async () => {
  const seen: string[] = [];
  const fetchFn: SweepFetch = async (input) => {
    const url = String(input);
    seen.push(url);
    if (url.includes("gone")) return new Response(null, { status: 404 });
    if (url.includes("moved")) return new Response(null, { status: 200 });
    if (url.includes("limited-a")) return new Response(null, { status: 429, headers: { "retry-after": "120" } });
    if (url.includes("boom")) { const e = new Error("dns") as Error & { code: string }; e.code = "ENOTFOUND"; throw e; }
    if (url.includes("slow")) { const e = new Error("timeout") as Error & { code: string }; e.code = "ETIMEDOUT"; throw e; }
    return new Response(null, { status: 200 });
  };
  const links = ["https://a.example.gov/gone", "https://a.example.gov/moved", "https://b.example.gov/limited-a", "https://b.example.gov/limited-b",
    "https://c.example.gov/boom", "https://d.example.gov/slow"].map((url) => ({ url, surface: "other links" as const }));
  const results = await sweepLinks(links, { ...quiet(), fetchFn, concurrency: 1 });
  const verdict = Object.fromEntries(results.map((r) => [r.url, r.verdict]));
  assert.equal(verdict["https://a.example.gov/gone"], "DEAD");
  assert.equal(verdict["https://a.example.gov/moved"], "OK");
  assert.equal(verdict["https://b.example.gov/limited-a"], "LATER");
  assert.equal(verdict["https://b.example.gov/limited-b"], "LATER");
  assert.equal(seen.includes("https://b.example.gov/limited-b"), false, "no request after Retry-After");
  assert.equal(verdict["https://c.example.gov/boom"], "DEAD");
  assert.equal(verdict["https://d.example.gov/slow"], "LATER");
});

test("a small local government gets ten requests in a pass and the rest wait; a large publisher is read in full", async () => {
  let requests = 0;
  const fetchFn: SweepFetch = async () => { requests += 1; return new Response(null, { status: 200 }); };
  const links = Array.from({ length: 25 }, (_, i) => ({ url: `https://town.example.gov/p${i}`, surface: "other links" as const }))
    .concat(Array.from({ length: 25 }, (_, i) => ({ url: `https://state.example.gov/p${i}`, surface: "other links" as const })));
  const sizeFor = (url: string) => new URL(url).hostname === "town.example.gov" ? { kind: "local-government" as const, population: 800 } : { kind: "state" as const };
  const pacing = memoryWebsitePacing();
  const results = await sweepLinks(links, { now: () => 1_000_000, pacing, fetchFn, sizeFor, concurrency: 1 });
  assert.equal(results.filter((r) => r.url.includes("town") && r.verdict === "OK").length, 10);
  assert.equal(results.filter((r) => r.url.includes("town") && r.verdict === "WAITING").length, 15);
  assert.equal(results.filter((r) => r.url.includes("state") && r.verdict === "OK").length, 25);
  assert.equal(requests, 35);
  const sameHour = await sweepLinks(links.filter((l) => l.url.includes("town")), { now: () => 1_000_000 + 60_000, pacing, fetchFn, sizeFor, rotation: 10 });
  assert.equal(sameHour.filter((r) => r.verdict === "WAITING").length, 25, "the website's hour is shared by every pass");
  // The next hour's pass starts elsewhere in the list, so every link is reached over several passes.
  const second = await sweepLinks(links.filter((l) => l.url.includes("town")), { now: () => 1_000_000 + 3_600_000, pacing, fetchFn, sizeFor, rotation: 10 });
  assert.equal(second.find((r) => r.url.endsWith("/p10"))?.verdict, "OK");
  assert.equal(second.find((r) => r.url.endsWith("/p0"))?.verdict, "WAITING");
});

test("the sweep shares each website's hour and its holds with every other reader", async () => {
  const pacing = memoryWebsitePacing();
  for (let i = 0; i < 6; i += 1) await pacing.take("town.example.gov", 10, 1_000_000);
  await pacing.hold("busy.example.gov", 1_000_000 + 1_800_000, 1_000_000);
  const links = Array.from({ length: 8 }, (_, i) => ({ url: `https://www.town.example.gov/p${i}`, surface: "other links" as const }))
    .concat([{ url: "https://busy.example.gov/a", surface: "other links" as const }]);
  const sizeFor = (url: string) => url.includes("town") ? { kind: "local-government" as const, population: 800 } : { kind: "state" as const };
  const seen: string[] = [];
  const results = await sweepLinks(links, { now: () => 1_000_000, pacing, sizeFor, fetchFn: async (input) => {
    const url = String(input); seen.push(url); return new Response(null, { status: 200 }); } });
  assert.equal(results.filter((r) => r.url.includes("town") && r.verdict === "OK").length, 4, "another reader's six requests leave four");
  assert.equal(results.find((r) => r.url.includes("busy"))!.verdict, "LATER");
  assert.equal(seen.some((u) => u.includes("busy")), false, "a website another reader was asked to leave alone is not asked");
});

test("a server that refuses HEAD gets one GET before the link is judged", async () => {
  const methods: string[] = [];
  const fetchFn: SweepFetch = async (_url, init) => { const method = init?.method ?? "GET"; methods.push(method); return new Response(null, { status: method === "HEAD" ? 405 : 200 }); };
  const [r] = await sweepLinks([{ url: "https://x.example.gov/a", surface: "other links" }], { ...quiet(), fetchFn });
  assert.equal(r!.verdict, "OK");
  assert.deepEqual(methods, ["HEAD", "GET"]);
});

test("the sweep is kept beside door health, one record per surface, zero where nothing was found", async () => {
  const repos = createMemoryRepositories();
  const results = await sweepLinks(collectOutboundLinks([edge]), { ...quiet(), fetchFn: async (u) => new Response(null, { status: String(u).endsWith(".pdf") ? 404 : 200 }) });
  const summaries = await recordSweep(repos.doors, results, "2026-10-04T12:00:00.000Z");
  assert.equal(summaries.find((s) => s.surface === "agenda PDFs")!.dead, 1);
  const doors = (await listDoors(repos.doors)).doors.filter((d) => d.kind === "link-sweep");
  assert.equal(doors.length, 5);
  const pdfs = doors.find((d) => d.doorId === "links:agenda-PDFs")!;
  assert.equal(pdfs.config.dead, 1);
  assert.deepEqual(pdfs.config.deadAddresses, ["https://www.example.gov/files/agenda-1.pdf"]);
  assert.equal(doors.find((d) => d.config.surface === "other links")!.config.links, 0);
  await recordSweep(repos.doors, results, "2026-10-04T13:00:00.000Z");
  assert.equal((await listDoors(repos.doors)).doors.filter((d) => d.kind === "link-sweep").length, 5, "again, not twice");
  assert.equal(summarizeSweep(results).reduce((n, s) => n + s.links, 0), results.length);
});

test("the edge is read from the manifest and every scope it lists", async () => {
  const store = {
    readManifest: async () => ({ etag: null, manifest: { sources: [{ url: "https://m.example.gov/a" }], scopes: [{ key: "k1" }, { key: "gone" }] } as never }),
    readArtifact: async (key: string) => key === "k1" ? ({ meetings: [{ agendaUrl: "https://m.example.gov/b.pdf" }] } as never) : null,
  };
  const links = collectOutboundLinks(await readEdgeForSweep(store));
  assert.deepEqual(links.map((l) => l.url), ["https://m.example.gov/a", "https://m.example.gov/b.pdf"]);
  assert.deepEqual(await readEdgeForSweep({ readManifest: async () => null, readArtifact: async () => null }), []);
});
