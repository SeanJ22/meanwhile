import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { resolveZipPlanGaps, type ZipGapResolutionInput } from "../lib/control-plane/zip-gap-resolution.ts";
import { buildRegistry } from "../lib/control-plane/scheduler/registry.ts";
import { candidateEnrichmentProvider } from "../lib/control-plane/scheduler/providers/candidate-enrichment.ts";
import { localJurisdictionsProvider } from "../lib/control-plane/scheduler/providers/local-jurisdictions.ts";
import { meetingsProvider } from "../lib/control-plane/scheduler/providers/meetings.ts";
import { campaignFinanceProvider } from "../lib/control-plane/scheduler/providers/campaign-finance.ts";
import { trackerIntakeProvider } from "../lib/control-plane/scheduler/providers/tracker-intake.ts";
const root = fileURLToPath(new URL("../", import.meta.url));
const read = (path: string) => JSON.parse(readFileSync(`${root}/${path}`, "utf8"));
const historicalSource = "data/control-plane/freshness-shadow/aggregates";
function latest<T>(directory: string): T[] {
  const rows = new Map<string, { id: string; revision: number; value: T }>();
  for (const name of readdirSync(`${root}/${historicalSource}/${directory}`).filter(name => name.endsWith(".json"))) {
    const row = read(`${historicalSource}/${directory}/${name}`);
    if (!rows.has(row.id) || rows.get(row.id)!.revision < row.revision) rows.set(row.id, row);
  }
  return [...rows.values()].sort((a,b) => a.id.localeCompare(b.id)).map(row => row.value);
}
function input(): ZipGapResolutionInput {
  const previous = read("docs/evidence/fleet-zip-acquisition-plan.example.json").plan;
  const registry = buildRegistry([candidateEnrichmentProvider(), localJurisdictionsProvider(), meetingsProvider(), campaignFinanceProvider(), trackerIntakeProvider()], { root, nowIso: "2026-09-01T00:00:00.000Z" });
  const queues = read("docs/evidence/fleet-zip-queue.example.json").queues;
  return { previous, registry: read("lib/registry/registry.json"), units: registry.units, providers: registry.byProvider,
    zipStates: Object.fromEntries([...queues.existingCompletion, ...queues.newExpansion].map(row => [row.zip, row.stateCode])),
    historical: { source: historicalSource, workItems: latest("work-items"), routeTasks: latest("route-tasks"), occurrences: latest("occurrences") },
    jurisdictionRegistries: ["az", "nh", "nj"].map(state => read(`data/states/${state}/jurisdictions/${state}.json`)),
    stamps: read("data/derived/zip-coverage-tiers.json").zips,
    sourceDocuments: previous.bindings.filter((row: { kind: string }) => row.kind === "source-corpus").map((row: { ref: string }) => {
      const path = row.ref.slice("source-corpus:".length); const document = read(path);
      const urls: { field: string; url: string }[] = [];
      for (const [field, value] of [["retrieval.url", document.retrieval?.url], ["authority.landingUrl", document.authority?.landingUrl], ["authority.supersededLandingUrl.url", document.authority?.supersededLandingUrl?.url]]) {
        if (typeof value === "string") urls.push({ field, url: value });
      }
      for (const collection of ["contests", "candidacies", "measures", "absences"]) for (const [index, value] of (document[collection] ?? []).entries()) {
        if (typeof value.provenance?.sourceUrl === "string") urls.push({ field: `${collection}[${index}].provenance.sourceUrl`, url: value.provenance.sourceUrl });
      }
      return { path, urls };
    }) };
}

test("real canonical registry rechecks all previously named gaps without modifying old evidence or making requests", () => {
  const oldFetch = globalThis.fetch; globalThis.fetch = (() => { throw new Error("NETWORK_FORBIDDEN"); }) as typeof fetch;
  try {
    const fixture = input(); const before = JSON.stringify(fixture);
    const result = resolveZipPlanGaps(fixture);
    assert.deepEqual(result, read("docs/evidence/fleet-zip-gap-resolution.example.json").resolution);
    assert.equal(JSON.stringify(fixture), before);
    assert.equal(result.rows.length, fixture.previous.bindings.filter(row => row.assignment === "MISSING_ASSIGNMENT").length);
    const ids = new Set(fixture.units.map(unit => unit.obligation.id));
    assert.ok(result.rows.flatMap(row => row.existingObligationIds).every(id => ids.has(id)));
    assert.ok(result.rows.some(row => row.status === "NO_OWN_GOVERNMENT"));
    assert.ok(result.rows.some(row => row.status === "PARTIAL_EXISTING_PORTFOLIO"));
    assert.ok(result.rows.filter(row => row.status !== "NO_OWN_GOVERNMENT").every(row => row.pendingReads.length > 0));
    assert.ok(result.coverage.every(row => row.existingObligationIds.length === 0 && row.stampExceedsEvidence === false));
  } finally { globalThis.fetch = oldFetch; }
});

test("unknown functional status cannot be converted to no government, and duplicate layers retain counterpart work", () => {
  const fixture = input(); const baseline = resolveZipPlanGaps(fixture);
  const statistical = baseline.rows.find(row => row.status === "NO_OWN_GOVERNMENT")!;
  const id = statistical.ref.slice("jurisdiction:".length);
  const changed = resolveZipPlanGaps({ ...fixture, registry: { ...fixture.registry, divisions: fixture.registry.divisions.map(division => division.ocdId === id ? { ...division, funcstat: "UNKNOWN" } : division) } });
  assert.equal(changed.rows.find(row => row.ref === statistical.ref)!.status, "IDENTITY_UNRESOLVED");
  const duplicate = baseline.rows.find(row => row.status === "DUPLICATE_LAYER")!;
  assert.ok(duplicate.pendingReads.some(read => read.required.includes("counterpart")));
  assert.deepEqual(duplicate.existingObligationIds, []);
});

test("ambiguous method routes and duplicated canonical state identities cannot select an arbitrary obligation", () => {
  const fixture = input(); const unit = fixture.units.find(unit => unit.route.routeId === "nh-cfs-filing-entity-details")!;
  assert.ok(unit);
  const result = resolveZipPlanGaps({ ...fixture, units: [...fixture.units, unit] });
  const state = result.rows.find(row => row.ref === "jurisdiction:ocd-division/country:us/state:nh")!;
  assert.equal(state.status, "AMBIGUOUS"); assert.deepEqual(state.existingObligationIds, []);
  const duplicated = resolveZipPlanGaps({ ...fixture, jurisdictionRegistries: [...fixture.jurisdictionRegistries, fixture.jurisdictionRegistries[0]] });
  assert.equal(duplicated.rows.find(row => row.ref === "jurisdiction:ocd-division/country:us/state:az")!.status, "AMBIGUOUS");
});

test("source URLs and held body identities cannot manufacture source-refresh or coverage tasks", () => {
  const fixture = input(); const result = resolveZipPlanGaps(fixture);
  assert.ok(result.rows.filter(row => row.ref.startsWith("source-corpus:")).every(row => row.status === "SOURCE_REFRESH_UNASSIGNED" && row.existingObligationIds.length === 0));
  const body = result.rows.find(row => row.status === "EXISTING_BODY_UNASSIGNED")!;
  assert.ok(body.bodyIds.length > 0); assert.deepEqual(body.existingObligationIds, []);
  for (const bodyId of body.bodyIds) assert.ok(fixture.registry.bodies.some(row => row.id === bodyId));
  assert.ok(result.coverage.every(row => row.status === "COVERAGE_ASSIGNMENT_UNRESOLVED"));
  const nj = result.rows.find(row => row.ref === "jurisdiction:ocd-division/country:us/state:nj")!;
  assert.equal(nj.status, "STATE_PORTFOLIO_UNASSIGNED");
  assert.equal(nj.jurisdictionId, fixture.jurisdictionRegistries.find(registry => registry.stateCode.toLowerCase() === "nj")!.jurisdictions.find(jurisdiction => jurisdiction.govClass === "STATE")!.id);
  assert.ok(result.rows.flatMap(row => row.historical.routeTaskIds).every(id => fixture.historical.routeTasks.some(task => task.id === id)));
});

test("historical task links reject broken occurrence ownership and remain historical only", () => {
  const fixture = input(); const result = resolveZipPlanGaps(fixture);
  const matched = result.rows.find(row => row.historical.routeTaskIds.length > 0)!;
  assert.ok(matched, "The recheck must exercise actual held task identities");
  const routeTaskId = matched.historical.routeTaskIds[0];
  const broken = resolveZipPlanGaps({ ...fixture, historical: { ...fixture.historical, routeTasks: fixture.historical.routeTasks.filter(task => task.id !== routeTaskId) } });
  const reread = broken.rows.find(row => row.ref === matched.ref)!;
  assert.ok(!reread.historical.routeTaskIds.includes(routeTaskId));
  assert.ok(reread.historical.unresolvedOccurrenceIds.length > 0);
  assert.equal(reread.historical.basis, "COMMITTED_HISTORY_ONLY");
});
