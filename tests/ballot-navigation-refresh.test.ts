import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AUTOMATIC_REFRESH_TASKS } from "../lib/civic-data/automatic-refresh.ts";
import { cadenceMsAt } from "../lib/civic-data/contracts.ts";
import { refreshBallotNavigation, readBallotNavigationReport, type BallotNavigationStateReport, type BallotNavigationSourceConfig } from "../lib/civic-data/ballot-navigation-refresh.ts";
import { readElectionFieldsForDivisions } from "../lib/civic-data/curated-reader-read-model.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import type { Artifact } from "../lib/control-plane/evidence/artifact.ts";
import { MemoryEvidenceStore, putArtifact } from "../lib/control-plane/evidence/store.ts";
import type { ManualProjectionPackage } from "../lib/civic-data/manual-projections.ts";
import { requiredManualProductionContract } from "../lib/civic-data/manual-contracts.ts";

const now = "2026-10-13T19:00:00.000Z";
const division = (state: string) => `ocd-division/country:us/${state === "DC" ? "district" : "state"}:${state.toLowerCase()}`;
const report = (state: string): BallotNavigationStateReport => ({ state, electionDate: "2026-11-03",
  facts: [{ kind: "registration_deadline", value: "Registration deadline October 19, 2026",
    quote: "Registration deadline October 19, 2026", dates: ["2026-10-19"], sourceUrl: `https://elections.example.gov/${state}` },
  { kind: "polling_lookup", value: `https://voter.example.gov/${state}/lookup`, quote: "Find your polling place", dates: [],
    sourceUrl: `https://elections.example.gov/${state}` }],
  sources: [{ requestedUrl: `https://elections.example.gov/${state}`, finalUrl: `https://elections.example.gov/${state}`,
    publisher: `${state} election authority` }], gaps: [] });
const htmlFor = (state: string) => `<h1>Registration deadline October 19, 2026</h1><a href="https://voter.example.gov/${state}/lookup">Find your polling place</a>`;

function context() {
  const saved: { artifact: Artifact; bytes: Uint8Array }[] = [];
  const evidence = new MemoryEvidenceStore();
  return { store: new MemoryRoutineDataStore(), repos: createMemoryRepositories(),
    vault: { putBytes: async (artifact: Artifact, bytes: Uint8Array) => {
      await putArtifact(evidence, "freshness", artifact, bytes);
      saved.push({ artifact, bytes: Uint8Array.from(bytes) }); return { stored: true, where: artifact.id, why: "saved" };
    } }, saved };
}

test("a failed state source retains its source dates while a sibling and DC publish through independent state runner contracts", async () => {
  const ctx = context();
  const fetcher = (async (url: string | URL | Request) => {
    const parsed = new URL(String(url));
    return new Response(parsed.pathname === "/robots.txt" ? "User-agent: *\nDisallow: /" : htmlFor(parsed.pathname.slice(1)),
      { status: 200, headers: { "content-type": "text/html" } });
  }) as typeof fetch;
  const first = await refreshBallotNavigation({ ...ctx, now, state: "OH", report: report("OH"), fetch: fetcher });
  await refreshBallotNavigation({ ...ctx, now, state: "DC", report: report("DC"), fetch: fetcher });
  assert.equal(first.fields.length, 2);
  assert.ok(first.promotedVersionId);
  assert.equal(first.gaps.length, 0);
  assert.ok(ctx.saved.every(row => row.artifact.contentHash === `sha256-${createHash("sha256").update(row.bytes).digest("hex")}`));
  const later = "2026-10-14T19:00:00.000Z";
  const failing = (async (url: string | URL | Request, init?: RequestInit) => {
    if (new URL(String(url)).pathname === "/OH") return new Response("Unavailable", { status: 503 });
    return fetcher(url, init);
  }) as typeof fetch;
  const second = await refreshBallotNavigation({ ...ctx, now: later, state: "OH", report: report("OH"), fetch: failing });
  const sibling = await refreshBallotNavigation({ ...ctx, now: later, state: "MI", report: report("MI"), fetch: failing });
  assert.equal(second.fields.length, 0);
  assert.equal(sibling.fields.length, 2);
  assert.ok(sibling.promotedVersionId);
  assert.ok(second.gaps.some(gap => gap.divisionId === division("OH")));
  const read = await readElectionFieldsForDivisions([division("OH"), division("MI"), division("DC")], {
    store: ctx.store, now: later, bypassCache: true });
  assert.equal(read.fields.length, 6);
  assert.ok(read.fields.filter(field => field.value.state === "OH").every(field => field.value.collectedAt === now));
  assert.ok(read.fields.filter(field => field.value.state === "MI").every(field => field.value.collectedAt === later));
});

test("a declared native HTML encoding keeps its original bytes and publishes through a bound text derivative", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "ballot-navigation-"));
  try {
    const ctx = context();
    const rawPath = join(scratch, "source.html");
    const bytes = Buffer.from(`<meta http-equiv="Content-Type" content="text/html; charset=windows-1252">${htmlFor("OH")}\u00a0`, "latin1");
    await writeFile(rawPath, bytes);
    const hash = createHash("sha256").update(bytes).digest("hex");
    const saved = { ...report("OH"), sources: report("OH").sources.map(source => ({ ...source, rawPath,
      retrievedAt: now, sha256: hash, httpStatus: 200, contentType: "text/html" })) };
    const result = await refreshBallotNavigation({ ...ctx, now, state: "OH", report: saved });
    assert.equal(result.fields.length, 2);
    assert.equal(result.gaps.length, 0);
    const native = ctx.saved.find(row => row.artifact.tier === "RAW")!;
    const decoded = ctx.saved.find(row => row.artifact.tier === "EXTRACTED_DERIVED")!;
    assert.deepEqual(native.bytes, Uint8Array.from(bytes));
    assert.equal(decoded.artifact.extraction?.kind, "HTML_TEXT");
    assert.equal(decoded.artifact.extraction?.encoding, "windows-1252");
    assert.equal(decoded.artifact.extraction?.parent.contentHash, `sha256-${hash}`);
    const candidate = await ctx.store.readCandidate(result.candidateId!);
    assert.equal(candidate?.candidate.retrieval.manualSourceReceipt?.sources[0].rawHash, hash);
  } finally { await rm(scratch, { recursive: true, force: true }); }
});

test("saved reports publish only values from their hashed native bytes, never a supplied text file", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "ballot-navigation-"));
  try {
    const ctx = context();
    const rawPath = join(scratch, "source.html"), textPath = join(scratch, "claimed.txt");
    const raw = `\ufeff${htmlFor("OH")}`;
    await writeFile(rawPath, raw);
    await writeFile(textPath, "Registration deadline October 20, 2026");
    const saved = { ...report("OH"), sources: report("OH").sources.map(source => ({ ...source, rawPath, textPath,
      retrievedAt: now, sha256: createHash("sha256").update(raw).digest("hex"), httpStatus: 200, contentType: "text/html" })) };
    const outcome = await refreshBallotNavigation({ ...ctx, now, state: "OH", report: saved, fetch: (async () => { throw new Error("Saved reports must not fetch"); }) as typeof fetch });
    assert.equal(outcome.fields.length, 2);
    const invented = { ...saved, facts: [{ ...saved.facts[0], value: "Registration deadline October 20, 2026",
      quote: "Registration deadline October 20, 2026", dates: ["2026-10-20"] }] };
    const held = await refreshBallotNavigation({ ...ctx, now, state: "OH", report: invented });
    assert.equal(held.promotedVersionId, null);
    assert.equal(held.gaps.length, 1);
    const corrupt = { ...saved, sources: saved.sources.map(source => ({ ...source, sha256: "0".repeat(64) })) };
    const mismatch = await refreshBallotNavigation({ ...ctx, now, state: "OH", report: corrupt });
    assert.equal(mismatch.fields.length, 0);
    assert.match(mismatch.gaps[0].detail, /SAVED_SOURCE_PROOF_INVALID/);
  } finally { await rm(scratch, { recursive: true, force: true }); }
});

test("the runner archives government DNS authority and publishes the actual delivery URL and native hash", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "ballot-navigation-"));
  try {
    const ctx = context(), governmentUrl = "https://elections.example.gov/OH", deliveryUrl = "https://delivery.example.net/OH";
    const raw = `<link rel="canonical" href="${governmentUrl}">${htmlFor("OH")}`;
    const dns = JSON.stringify({ Status: 0, Question: [{ name: "elections.example.gov.", type: 5 }],
      Answer: [{ name: "elections.example.gov.", type: 5, data: "delivery.example.net." }] });
    const rawPath = join(scratch, "source.html"), dnsPath = join(scratch, "dns.json");
    await writeFile(rawPath, raw); await writeFile(dnsPath, dns);
    const rawHash = createHash("sha256").update(raw).digest("hex"), dnsHash = createHash("sha256").update(dns).digest("hex");
    const saved: BallotNavigationStateReport = { ...report("OH"),
      facts: report("OH").facts.map(fact => ({ ...fact, sourceUrl: deliveryUrl })),
      sources: [{ requestedUrl: deliveryUrl, finalUrl: deliveryUrl, publisher: "Official election authority", rawPath,
        retrievedAt: now, sha256: rawHash, httpStatus: 200, contentType: "text/html",
        websiteDelegation: { governmentUrl, dnsSource: { requestedUrl: "https://dns.google/resolve?name=elections.example.gov&type=CNAME",
          finalUrl: "https://dns.google/resolve?name=elections.example.gov&type=CNAME", publisher: "Google Public DNS",
          rawPath: dnsPath, retrievedAt: now, sha256: dnsHash, httpStatus: 200, contentType: "application/json" } } }] };
    const result = await refreshBallotNavigation({ ...ctx, now, state: "OH", report: saved,
      fetch: (async () => { throw new Error("Saved native evidence must not fetch"); }) as typeof fetch });
    assert.equal(result.fields.length, 2, JSON.stringify(result.gaps));
    assert.equal(result.gaps.length, 0);
    const archivedDns = ctx.saved.find(row => row.artifact.methodRouteId === "ballot-navigation:government-dns")!;
    assert.equal(archivedDns.artifact.contentHash, `sha256-${dnsHash}`);
    assert.equal(archivedDns.artifact.retrievalUrl, saved.sources[0].websiteDelegation!.dnsSource.finalUrl);
    assert.deepEqual(archivedDns.bytes, Uint8Array.from(Buffer.from(dns)));
    const candidate = await ctx.store.readCandidate(result.candidateId!);
    const receipt = candidate!.candidate.retrieval.manualSourceReceipt!.sources[0];
    assert.equal(receipt.finalUrl, deliveryUrl);
    assert.equal(receipt.httpStatus, 200);
    assert.equal(receipt.rawHash, rawHash);
    const rows = await readElectionFieldsForDivisions([division("OH")], { store: ctx.store, now });
    assert.ok(rows.fields.every(field => field.value.url === deliveryUrl));
    for (const replacement of [raw.replace(governmentUrl, "https://other.example.gov/OH"), raw.replace(/<link[^>]+>/, "")]) {
      await writeFile(rawPath, replacement);
      const held = await refreshBallotNavigation({ ...ctx, now, state: "OH", report: { ...saved,
        sources: saved.sources.map(source => ({ ...source, sha256: createHash("sha256").update(replacement).digest("hex") })) } });
      assert.equal(held.fields.length, 0);
      assert.ok(held.gaps.some(gap => /SOURCE_NOT_OFFICIAL/.test(gap.detail)));
    }
  } finally { await rm(scratch, { recursive: true, force: true }); }
});

test("refresh never reads the growing evidence history", async () => {
  const ctx = context();
  ctx.repos.artifacts.read = async () => { throw new Error("History must not be loaded"); };
  const result = await refreshBallotNavigation({ ...ctx, now, state: "OH", report: report("OH"),
    fetch: (async () => new Response(htmlFor("OH"), { status: 200, headers: { "content-type": "text/html" } })) as typeof fetch });
  assert.equal(result.fields.length, 2);
  assert.ok(result.promotedVersionId);
});

test("state report corruption is isolated and an input directory inside the repository is refused", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "ballot-navigation-"));
  try {
    await mkdir(join(scratch, "states"));
    await writeFile(join(scratch, "states/oh.json"), JSON.stringify(report("OH")));
    await writeFile(join(scratch, "states/mi.json"), "{");
    const read = await readBallotNavigationReport(join(scratch, "states"), "OH");
    assert.equal(read.state, "OH");
    await assert.rejects(readBallotNavigationReport(join(scratch, "states"), "MI"));
    await assert.rejects(readBallotNavigationReport("data/reference", "OH"), /OUTSIDE_REPOSITORY/);
  } finally { await rm(scratch, { recursive: true, force: true }); }
});


test("reviewed runner input publishes its original source dates before refresh, and never replaces a newer held field", async () => {
  const collected = context();
  const capture = await refreshBallotNavigation({ ...collected, now, state: "OH", report: report("OH"),
    fetch: (async () => new Response(htmlFor("OH"), { headers: { "content-type": "text/html" } })) as typeof fetch });
  const candidate = (await collected.store.readCandidate(capture.candidateId!))!.candidate;
  const source: ManualProjectionPackage = { contractId: "ballot-navigation", version: candidate.temporal.version,
    sourceThrough: candidate.temporal.sourceThrough!, sourceReceipt: candidate.retrieval.manualSourceReceipt!,
    payload: candidate.readModel as ManualProjectionPackage["payload"] };
  const state = { state: "OH", electionDate: "2026-11-03", sources: report("OH").sources, gaps: [] };
  const config: BallotNavigationSourceConfig = { ...state, package: source };
  const ctx = context(), later = "2026-10-14T19:00:00.000Z";
  const failed = (async () => new Response("Unavailable", { status: 503 })) as typeof fetch;
  const first = await refreshBallotNavigation({ ...ctx, now: later, state: "OH", config, fetch: failed });
  assert.equal(first.fields.length, 2);
  assert.ok(first.promotedVersionId);
  assert.ok(first.gaps.length > 0);
  const read = await readElectionFieldsForDivisions([division("OH")], { store: ctx.store, now: later, bypassCache: true });
  assert.ok(read.fields.every(field => field.value.collectedAt === now));
  assert.equal((await ctx.store.readCandidate(first.candidateId!))!.candidate.retrieval.manualSourceReceipt!.sources[0].retrievedAt, now);
  const updated = { ...report("OH"), facts: report("OH").facts.map(field => ({ ...field,
    value: field.value.replace("19, 2026", "20, 2026"), quote: field.quote.replace("19, 2026", "20, 2026"),
    dates: field.dates.length ? ["2026-10-20"] : [] })) };
  const fresh = await refreshBallotNavigation({ ...ctx, now: later, state: "OH", report: updated,
    fetch: (async () => new Response(htmlFor("OH").replace("19, 2026", "20, 2026"),
      { headers: { "content-type": "text/html" } })) as typeof fetch });
  assert.ok(fresh.promotedVersionId);
  const replay = await refreshBallotNavigation({ ...ctx, now: later, state: "OH", config, fetch: failed });
  assert.equal(replay.fields.length, 0);
  assert.equal(replay.promotedVersionId, null);
  const final = await readElectionFieldsForDivisions([division("OH")], { store: ctx.store, now: later, bypassCache: true });
  assert.equal(final.fields.find(field => field.value.fieldKind === "registration_deadline")?.value.text,
    "Registration deadline October 20, 2026");
});

test("literal embedded source HTML is bound through sanitization to its protected native original before field verification", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "ballot-navigation-"));
  try {
    const ctx = context(), rawPath = join(scratch, "source.html");
    const raw = `<script>const page=JSON.parse(${JSON.stringify(JSON.stringify({ body: htmlFor("OH") }))});
      const browserKey="${"AIza" + "a".repeat(35)}";</script>`;
    await writeFile(rawPath, raw);
    const hash = createHash("sha256").update(raw).digest("hex");
    const saved = { ...report("OH"), sources: report("OH").sources.map(source => ({ ...source, rawPath,
      retrievedAt: now, sha256: hash, httpStatus: 200, contentType: "text/html" })) };
    const result = await refreshBallotNavigation({ ...ctx, now, state: "OH", report: saved });
    assert.equal(result.fields.length, 2, JSON.stringify(result.gaps));
    const native = ctx.saved.find(row => row.artifact.tier === "RESTRICTED_RAW")!;
    const sanitized = ctx.saved.find(row => row.artifact.tier === "SANITIZED_DERIVED")!;
    const derivative = ctx.saved.find(row => row.artifact.extraction?.version === "html-json/1")!;
    assert.ok(native); assert.ok(sanitized); assert.ok(derivative);
    assert.equal(derivative.artifact.extraction?.parent.id, sanitized.artifact.id);
    assert.equal(sanitized.artifact.derivation?.rawHash, `sha256-${hash}`);
    assert.equal(derivative.artifact.extraction?.encoding, "utf-8");
    assert.equal((await ctx.store.readCandidate(result.candidateId!))!.candidate.retrieval.manualSourceReceipt!.sources[0].rawHash, hash);
  } finally { await rm(scratch, { recursive: true, force: true }); }
});

test("ballot navigation refresh has one state publisher daily and hourly before Election Day", () => {
  const task = AUTOMATIC_REFRESH_TASKS.find(row => row.id === "ballot-navigation-oh")!;
  assert.ok(task);
  assert.equal(task.scope, "US-OH:official-ballot-navigation");
  assert.deepEqual(task.command, [...requiredManualProductionContract("ballot-navigation").command, "--state=OH"]);
  assert.equal(AUTOMATIC_REFRESH_TASKS.filter(task => task.id.startsWith("ballot-navigation-")).length, 51);
  assert.equal(task.ownerInvocation, undefined);
  assert.equal(cadenceMsAt(task.contract, Date.parse("2026-10-14T19:00:00Z")), 86_400_000);
  assert.equal(cadenceMsAt(task.contract, Date.parse("2026-10-27T19:00:00Z")), 3_600_000);
});

test("one saved state directory proves many delegated county sites without retaining the directory text", async () => {
  const ctx = context(), directory = "https://elections.example.gov/counties";
  const sources = Array.from({ length: 250 }, (_, index) => `https://county-${index}.example.org/voting`);
  const stateReport: BallotNavigationStateReport = { state: "OH", electionDate: "2026-11-03",
    sources: [directory, ...sources].map(url => ({ requestedUrl: url, finalUrl: url, publisher: "Election office" })),
    facts: sources.map((url, index) => ({ divisionId: `${division("OH")}/county:fixture-${index}`, kind: "registration_lookup",
      value: `${url}/registration`, quote: "Check registration", dates: [], sourceUrl: url })) };
  const result = await refreshBallotNavigation({ ...ctx, now, state: "OH", report: stateReport, fetch: (async url => {
    const address = String(url);
    return new Response(address.endsWith("/robots.txt") ? "User-agent: *\nAllow: /" : address === directory
      ? sources.map(source => `<a href="${source}">Official election office</a>`).join("\n")
      : `<a href="${address}/registration">Check registration</a>`, { headers: { "content-type": "text/html" } });
  }) as typeof fetch });
  assert.equal(result.fields.length, sources.length, JSON.stringify(result.gaps));
  assert.deepEqual(result.gaps, []);
  const read = await readElectionFieldsForDivisions([`${division("OH")}/county:fixture-249`], { store: ctx.store, now });
  assert.equal(read.fields.length, 1);
  assert.equal(read.fields[0].value.navigationUrl, `${sources[249]}/registration`);
});
