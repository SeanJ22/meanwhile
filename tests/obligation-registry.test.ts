/**
 * **THE OBLIGATION-PROVIDER REGISTRY, ITS PROVIDERS, AND THE PROMOTION TAIL.**
 * (Session C, PART D, 2026-08-31.)
 *
 * Every test here is written against a defect that was live on `main` at
 * ac3cfced, or against a way the new code could be wrong that the live proof
 * cannot show. The live half — an unattended Postgres cycle that acquired
 * Arizona's 370-row filer index and New Hampshire's 5,738-row one and staged
 * both — is `data/health/autonomous-advancement/`, because a network walk
 * cannot honestly happen inside a test.
 *
 * The defects, restated as things that must now be false:
 *
 * ```
 *   the scheduler's corpus can only be meetings
 *   one 200 marks a whole record's route portfolio worked
 *   a 200 with two bytes writes a terminal INGESTED
 *   a zero-row response becomes WALKED_NO_YIELD
 *   a route with no client reads as an absent record
 *   an obligation nobody has ever worked is not due for a month
 *   a failing route is re-dispatched every cycle regardless of its backoff
 *   a partial index is staged under the index's name
 *   the promotion tail writes into a reader-content path
 *   an absent tracker handoff is indistinguishable from an empty one
 * ```
 *
 * NO LIVE CALLS. Every fetch seam is replaced, and the tracker fixture is a
 * committed file.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildRegistry,
  ObligationIdCollision,
  registryLines,
  type ObligationProvider,
  type RouteDescriptor,
} from "../lib/control-plane/scheduler/registry.ts";
import {
  campaignFinanceProvider,
  readDescriptorFiles,
} from "../lib/control-plane/scheduler/providers/campaign-finance.ts";
import {
  readTrackerHandoff,
  trackerIntakeProvider,
} from "../lib/control-plane/scheduler/providers/tracker-intake.ts";
import { localJurisdictionsProvider } from "../lib/control-plane/scheduler/providers/local-jurisdictions.ts";
import { meetingsDiscoveryProvider } from "../lib/control-plane/scheduler/providers/meetings-discovery.ts";
import { checkYield, routeExecutor, type OpenOne, type VaultPut } from "../lib/control-plane/scheduler/route-executor.ts";
import { cycleVault } from "../lib/control-plane/scheduler/vault.ts";
import { classifyAcquisition } from "../lib/control-plane/evidence/artifact.ts";
import { contentHash } from "../lib/control-plane/ids.ts";
import {
  NORMALIZERS,
  promotionLines,
  readStagingManifest,
  stageOne,
  writeStagingManifest,
  type StagedEntry,
} from "../lib/control-plane/scheduler/promotion-tail.ts";
import { scheduleObligation, isScheduled } from "../lib/control-plane/scheduler/obligation.ts";
import { runCycle } from "../lib/control-plane/scheduler/shadow-loop.ts";
import { recordFailure } from "../lib/control-plane/scheduler/debt.ts";
import {
  retireObligationsByPrefix,
  syncObligations,
} from "../lib/control-plane/scheduler/durable.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import type { FreshnessObligation, ScheduledObligation } from "../lib/control-plane/scheduler/obligation.ts";
import type { WorkOutcome } from "../lib/control-plane/scheduler/dispatch.ts";
import {
  installOperationalReferenceBundle,
  operationalReferenceBundle,
} from "../lib/civic-data/operational-references.ts";

const ROOT = process.cwd();
const NOW = "2026-08-31T12:00:00.000Z";
const NOW_MS = Date.parse(NOW);

installOperationalReferenceBundle(operationalReferenceBundle({
  az: JSON.parse(readFileSync(join(ROOT, "data/states/az/jurisdictions/az.json"), "utf8")),
  nh: JSON.parse(readFileSync(join(ROOT, "data/states/nh/jurisdictions/nh.json"), "utf8")),
  nj: JSON.parse(readFileSync(join(ROOT, "data/states/nj/jurisdictions/nj.json"), "utf8")),
}));

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "wtp-registry-"));
}

function scheduled(obligation: FreshnessObligation): ScheduledObligation {
  const row = scheduleObligation(obligation, NOW_MS);
  assert.ok(isScheduled(row), "the fixture obligation must schedule");
  return row;
}

/* ------------------------------------------------------------ the registry */

test("the standing research registry is not a parallel tracked-meetings authority", () => {
  const pass = buildRegistry([campaignFinanceProvider(), trackerIntakeProvider()], {
    root: ROOT,
    nowIso: NOW,
  });

  const ids = pass.byProvider.map((p) => p.providerId);
  assert.deepEqual([...ids].sort(), ["campaign-finance", "tracker-intake"]);

  const finance = pass.byProvider.find((p) => p.providerId === "campaign-finance");
  assert.ok(finance, "the campaign-finance provider must be reported");
  assert.ok(
    finance.units > 0,
    "campaign finance must produce scheduled units. Zero here is the defect this whole part " +
      "exists to close: a domain reachable only from tests.",
  );
  assert.equal(finance.readFailure, null);

  assert.equal(
    pass.units.some((unit) => unit.obligation.id.startsWith("freshness:meetings:")),
    false,
    "the superseded tracked-snapshot clock must not enter the standing registry",
  );
  assert.equal(
    pass.units.some((unit) => unit.record.subjectId === "ballot-az-pima:us-house-6"),
    false,
    "the permanent FEC contract owns federal acquisition; the research registry may not add a second clock",
  );

  const local = buildRegistry([localJurisdictionsProvider()], { root: ROOT, nowIso: NOW });
  assert.ok(local.units.length > 0, "the local filing/custodian research registry still has a real non-meeting denominator");
  assert.equal(
    local.units.some((unit) => unit.record.routes.some((route) => /meeting/i.test(route.routeId)) || /meeting/i.test(unit.record.recordClass)),
    false,
    "tracked jurisdiction meeting inventory must never produce a second standing meeting acquisition clock",
  );

  /*
   * MW-028 (2026-09-23): the meetings-DISCOVERY provider's ids and record class
   * carry the word "meetings" on purpose, and the guard above deliberately does
   * not cover it. The reason: it is discovery, not a second meetings clock.
   * Every route it emits is not machine-executable — no client can fetch a
   * meeting through it — so the one production meetings clock stays the
   * source/body meeting partitions (RULING 282/283). This is what makes that so.
   */
  const discovery = buildRegistry(
    [meetingsDiscoveryProvider({ materialized: () => ({ ids: new Set(["freshness:meetings-discovery:az:county:county-of-pima#own-site-meetings"]) }) })],
    { root: ROOT, nowIso: NOW },
  );
  assert.equal(discovery.units.length, 1, "a materialized meetings-discovery need is scheduled");
  for (const unit of discovery.units) {
    assert.equal(unit.route.open.kind, "NOT_MACHINE_EXECUTABLE", "a discovery route can never open a meeting source: it is not an acquisition clock");
    assert.equal(unit.route.executorClass, "BOUNDED_MODEL_WORKER");
    assert.ok(unit.obligation.id.startsWith("freshness:meetings-discovery:"), "discovery owns its own namespace, never the retired meetings clocks'");
  }

  const standing = readFileSync(join(ROOT, "scripts", "freshness-shadow.mts"), "utf8");
  const denominator = readFileSync(join(ROOT, "scripts", "scout-denominator.mts"), "utf8");
  assert.doesNotMatch(standing, /meetingsProvider\s*\(/);
  assert.doesNotMatch(denominator, /meetingsProvider\s*\(/);
  assert.match(standing, /retireObligationsByPrefix\s*\(/);
  assert.match(standing, /freshness:campaign-finance:ballot-az-pima:us-house-6#/);
  assert.equal(
    existsSync(join(ROOT, "lib", "control-plane", "scheduler", "providers", "meetings.ts")),
    false,
    "the old executable provider must be deleted, not left callable as a backup",
  );
  assert.equal(
    existsSync(join(ROOT, "lib", "control-plane", "scheduler", "providers", "promoted-facts.ts")),
    false,
    "the per-fact meeting/agenda acquisition provider must be deleted, not retained as a callable fallback",
  );
});

test("a record's route PORTFOLIO becomes several scheduled units, not one", () => {
  const pass = buildRegistry([campaignFinanceProvider()], { root: ROOT, nowIso: NOW });
  const az = pass.units.filter((u) => u.record.subjectId === "az-sos-cfs-2026");

  assert.ok(
    az.length > 1,
    "Arizona's record carries several materially distinct representations and every one must be " +
      "scheduled independently — RULING 207 as state, not as a sentence in a report",
  );
  const routeIds = new Set(az.map((u) => u.obligation.routeId));
  assert.equal(routeIds.size, az.length, "each unit must carry its OWN route id");
  const obligationIds = new Set(az.map((u) => u.obligation.id));
  assert.equal(obligationIds.size, az.length, "each unit must carry its OWN durable obligation id");
});

test("PDC retires every durable tracked-meetings clock without deleting its history", async () => {
  const repos = createMemoryRepositories();
  const id = "freshness:meetings:ocd-division/country:us/state:az/place:tucson#governing";
  const legacy: FreshnessObligation = {
    id,
    recordClass: "meetings",
    subjectId: "ocd-division/country:us/state:az/place:tucson#governing",
    routeId: "City of Tucson Clerk",
    active: true,
    readerImpactAt: null,
    observedChangeRateHours: null,
    lastWorkedAt: "2026-08-30T12:00:00.000Z",
  };
  await syncObligations(repos, [legacy], NOW);
  const before = await repos.obligations.mustRead(id);
  await repos.obligations.compareAndSet(
    id,
    before.revision,
    { ...before.value, nextDueAt: "2026-09-01T13:00:00.000Z", occurrenceCount: 4 },
    NOW,
  );

  const reason = "PDC authority transferred to the production civic-data contract";
  const first = await retireObligationsByPrefix(repos, ["freshness:meetings:"], NOW, reason);
  assert.deepEqual(first.retired, [id]);
  const retired = (await repos.obligations.mustRead(id)).value;
  assert.equal(retired.active, false);
  assert.equal(retired.nextDueAt, null, "a retired row has no runnable clock");
  assert.equal(retired.occurrenceCount, 4, "historical runtime evidence is retained");
  assert.equal(retired.retirementReason, reason);

  const second = await retireObligationsByPrefix(repos, ["freshness:meetings:"], NOW, reason);
  assert.deepEqual(second, { retired: [], alreadyRetired: [id] }, "retirement is idempotent");
});

test("two providers claiming one obligation id is REFUSED, never reconciled", () => {
  const route: RouteDescriptor = {
    routeId: "r",
    label: "l",
    executorClass: "DETERMINISTIC",
    executorReason: "test",
    open: { kind: "HTTP_GET", url: "https://example.gov/" },
    citation: "test",
  };
  const make = (id: string): ObligationProvider => ({
    id,
    describe: id,
    scheduledId: () => "freshness:collision",
    enumerate: () => ({
      obligations: [
        {
          recordClass: "test",
          subjectId: "s",
          readerImpactAt: null,
          observedChangeRateHours: null,
          lastWorkedAt: null,
          routes: [route],
        },
      ],
      readFailure: null,
      emptyReason: null,
    }),
  });

  assert.throws(
    () => buildRegistry([make("a"), make("b")], { root: ROOT, nowIso: NOW }),
    ObligationIdCollision,
  );
});

test("a provider that THROWS does not freeze the rest of the hunt", () => {
  const exploding: ObligationProvider = {
    id: "exploding",
    describe: "throws on enumerate",
    scheduledId: () => "x",
    enumerate: () => {
      throw new Error("its input is gone");
    },
  };
  const pass = buildRegistry([exploding, campaignFinanceProvider()], { root: ROOT, nowIso: NOW });

  const bad = pass.byProvider.find((p) => p.providerId === "exploding");
  assert.ok(bad?.readFailure?.includes("its input is gone"));
  assert.ok(
    (pass.byProvider.find((p) => p.providerId === "campaign-finance")?.units ?? 0) > 0,
    "one blocked provider never freezes the others",
  );
});

test("a READ FAILURE prints as a failure and never as an empty domain", () => {
  const broken: ObligationProvider = {
    id: "broken",
    describe: "cannot read its input",
    scheduledId: () => "x",
    enumerate: () => ({ obligations: [], readFailure: "the snapshot is not present", emptyReason: null }),
  };
  const lines = registryLines(buildRegistry([broken], { root: ROOT, nowIso: NOW })).join("\n");
  assert.match(lines, /READ FAILURE/);
  assert.match(lines, /not evidence that the domain is empty/);
});

/* --------------------------------------------------------- the yield contract */

test("a 200 carrying the wrong shape is a FAILED extraction, not an INGESTED record", () => {
  const reading = checkYield(
    { describe: "a DataTables response", requireAll: ["recordsTotal", "data"] },
    '""',
  );
  assert.equal(reading.satisfied, false);
  assert.match(reading.detail, /FAILED extraction/);
});

test("a response with the right shape and ZERO rows is refused, not WALKED_NO_YIELD", () => {
  const reading = checkYield(
    { describe: "a DataTables response", requireAll: ["recordsTotal", "data"], countAt: "recordsTotal" },
    JSON.stringify({ data: [], recordsTotal: 0 }),
  );
  assert.equal(reading.satisfied, false);
  assert.equal(reading.rows, 0);
  assert.match(reading.detail, /may not become WALKED_NO_YIELD/);
});

test("an UNREADABLE row count is not a row count of zero", () => {
  const reading = checkYield(
    { describe: "a DataTables response", requireAll: ["recordsTotal"], countAt: "recordsTotal" },
    JSON.stringify({ recordsTotal: "many" }),
  );
  assert.equal(reading.satisfied, false);
  assert.match(reading.detail, /not a count of zero/);
});

test("the real shape with real rows is satisfied and states the count", () => {
  const reading = checkYield(
    { describe: "a DataTables response", requireAll: ["recordsTotal", "data"], countAt: "recordsTotal" },
    JSON.stringify({ data: [{ EntityID: 1 }], recordsTotal: 370 }),
  );
  assert.equal(reading.satisfied, true);
  assert.equal(reading.rows, 370);
});

/* -------------------------------------------------------- the route executor */

const AZ_ROUTE: RouteDescriptor = {
  routeId: "az-sos-seethemoney-datatables",
  label: "the Arizona filer index",
  executorClass: "DETERMINISTIC",
  executorReason: "the shape is written down",
  open: {
    kind: "HTTP_POST",
    url: "https://seethemoney.az.gov/Reporting/GetNEWTableData/?x=1",
    contentType: "application/x-www-form-urlencoded",
    body: "draw=1",
  },
  yieldContract: {
    describe: "a DataTables response",
    requireAll: ["recordsTotal", "data"],
    countAt: "recordsTotal",
  },
  citation: "test",
};

function fakeOpen(body: string, status = 200, contentType = "application/json"): OpenOne {
  return async () => ({
    status,
    bytes: Buffer.byteLength(body, "utf8"),
    contentType,
    body,
    durationMs: 1,
    transportError: null,
  });
}

async function run(route: RouteDescriptor | null, open: OpenOne, vault: VaultPut | null = cycleVault(tmp()).put): Promise<WorkOutcome> {
  const executor = routeExecutor({
    routeFor: () => route,
    openOne: open,
    ...(vault ? { vault } : {}),
    now: () => NOW,
  });
  return executor({
    obligation: scheduled({
      id: "freshness:test:subject#route",
      recordClass: "campaign-finance",
      subjectId: "subject",
      routeId: "az-sos-seethemoney-datatables",
      active: true,
      readerImpactAt: null,
      observedChangeRateHours: null,
      lastWorkedAt: null,
    }),
    routeTaskId: "rt-testtesttest",
    workItemId: "wi-testtesttest",
    attemptId: "at-testtesttest",
    executor: "DETERMINISTIC",
    bound: { maxAttempts: 1, maxWallMs: 1, maxCostUnits: 1 },
    holder: "test",
  });
}

test("the two-byte 200 that would have become Arizona's filer index is ABORTED", async () => {
  const outcome = await run(AZ_ROUTE, fakeOpen('""'));
  assert.equal(outcome.kind, "ABORTED");
  assert.equal(outcome.disposition, undefined);
  assert.match(outcome.detail, /yield contract/);
});

test("partial and malformed provider bodies fail before yield or vault ingestion", async () => {
  for (const [url, body, status] of [
    ['https://api.wikimedia.org/core/v1/wikipedia/en/search/page?q=first', '{"pages":[]}', 206],
    ['https://api.wikimedia.org/core/v1/wikipedia/en/search/page?q=second', '{"pages":[', 200],
    ['https://api.marginalia.nu/public/search/first', '<html>Gateway timeout</html>', 200],
    ['https://api.marginalia.nu/public/search/second', 'gateway timeout', 504],
  ] as const) {
    const route: RouteDescriptor = { ...AZ_ROUTE, open: { kind: 'HTTP_GET', url } };
    const outcome = await run(route, fakeOpen(body, status));
    assert.equal(outcome.kind, 'ABORTED');
    assert.equal(outcome.disposition, undefined);
    assert.equal(outcome.artifacts, undefined);
    assert.match(outcome.detail, /Provider failure/);
    assert.doesNotMatch(outcome.detail, /yield contract/);
  }
});

test("a deferred provider request has zero request cost", async () => {
  const outcome = await run(AZ_ROUTE, async () => ({ status: null, bytes: 0, contentType: '', body: '',
    durationMs: 0, transportError: 'provider backoff', requestCount: 0 }));
  assert.equal(outcome.kind, 'ABORTED');
  assert.equal(outcome.cost?.requestCount, 0);
});

test("rate limits keep the existing blocked-route disposition while the provider backs off", async () => {
  const outcome = await run(AZ_ROUTE, fakeOpen('rate limited', 429));
  assert.equal(outcome.kind, 'DISPOSED');
  assert.equal(outcome.disposition?.disposition, 'BLOCKED_CURRENTLY');
});

test("a satisfied response is DISPOSED INGESTED with the tier decided by SCANNING", async () => {
  const body = JSON.stringify({ data: [{ EntityID: 1 }], recordsTotal: 1 });
  const outcome = await run(AZ_ROUTE, fakeOpen(body));
  assert.equal(outcome.kind, "DISPOSED");
  assert.equal(outcome.disposition?.disposition, "INGESTED");
  assert.equal(outcome.artifacts?.length, 1);
  assert.equal(
    outcome.artifacts?.[0].tier,
    "RAW",
    "a public state record carrying no credential is RAW. The previous executor hard-coded " +
      "RESTRICTED_RAW for everything, which the durable vault refuses — so those bytes could " +
      "never have been stored at all",
  );
  assert.equal(
    outcome.disposition?.observation?.normalizedCount,
    0,
    "normalization is a later stage; claiming it here would report parsing that did not happen",
  );
});


test("public source credentials leave a readable saved page for the roster and directory readers", async () => {
  const key = ["AI", "za"].join("") + "SyD4mQ8vX1nR7pLbT2wCzE0jHfGuY5aKs_-3xNp".slice(0, 35);
  const page = '<h1>Village Council</h1><p>Jane Smith — Mayor</p><a href="/boards">Boards and Commissions</a>' +
    '<script src="https://maps.googleapis.com/maps/api/js?key=' + key + '"></script>';
  assert.equal(classifyAcquisition(page).tier, "RESTRICTED_RAW");
  const vault = cycleVault(tmp());
  const route: RouteDescriptor = { ...AZ_ROUTE, open: { kind: "HTTP_GET", url: "https://city.example.gov/council" }, yieldContract: undefined };
  const outcome = await run(route, fakeOpen(page, 200, "text/html"), vault.put);
  assert.equal(outcome.disposition?.disposition, "INGESTED");
  assert.equal(outcome.artifacts?.length, 1);
  const artifact = outcome.artifacts![0];
  assert.equal(artifact.tier, "SANITIZED_DERIVED");
  const held = vault.ledger.get(artifact.artifactId);
  assert.ok(held);
  const text = await vault.readBack(held.key);
  assert.ok(text);
  assert.ok(text.includes("Jane Smith — Mayor"));
  assert.ok(text.includes('<a href="/boards">Boards and Commissions</a>'));
  assert.ok(!text.includes(key));
  assert.equal(contentHash(text), artifact.contentHash);
  assert.equal(Buffer.byteLength(text), artifact.byteLength);
  assert.equal(artifact.recordedAt, NOW);
  assert.equal(artifact.canonicalUrl, "https://city.example.gov/council");
  assert.equal(outcome.cost?.bytesFetched, Buffer.byteLength(page));
  assert.equal(outcome.disposition?.observation?.normalizedCount, 0);
});

test("missing or failed vault storage never reports unsaved page bytes as INGESTED", async () => {
  const key = ["AI", "za"].join("") + "SyD4mQ8vX1nR7pLbT2wCzE0jHfGuY5aKs_-3xNp".slice(0, 35);
  const route: RouteDescriptor = { ...AZ_ROUTE, open: { kind: "HTTP_GET", url: "https://city.example.gov/boards" }, yieldContract: undefined };
  for (const body of ["<h1>Boards</h1>", '<h1>Boards</h1><script src="https://maps.googleapis.com/maps/api/js?key=' + key + '"></script>']) {
    const failed: (VaultPut | null)[] = [null,
      async () => ({ stored: false, where: "", why: "storage unavailable" }),
      async () => { throw new Error("storage unavailable"); }];
    for (const vault of failed) {
      const outcome = await run(route, fakeOpen(body, 200, "text/html"), vault);
      assert.equal(outcome.kind, "ABORTED");
      assert.equal(outcome.disposition, undefined);
      assert.equal(outcome.artifacts, undefined);
      assert.match(outcome.detail, /SOURCE_PAGE_NOT_SAVED/);
      assert.equal(outcome.cost?.requestCount, 1);
      assert.equal(outcome.cost?.bytesFetched, Buffer.byteLength(body));
    }
  }
});

test("a route with no client disposes REQUIRES_NEW_ADAPTER and stays owed", async () => {
  const ftp: RouteDescriptor = {
    routeId: "az-sos-cfs-bulk-ftp",
    label: "the bulk FTP drop",
    executorClass: "DETERMINISTIC",
    executorReason: "an FTP LIST is deterministic once a client exists",
    open: {
      kind: "NOT_MACHINE_EXECUTABLE",
      target: "ftp://ftp.azsos.gov/cfsdata2/",
      reason: "this process holds no FTP client",
    },
    citation: "test",
    awaitingAdapter: "an FTP client",
  };
  const outcome = await run(ftp, fakeOpen("unused"));
  assert.equal(outcome.kind, "DISPOSED");
  assert.equal(outcome.disposition?.disposition, "REQUIRES_NEW_ADAPTER");
  assert.match(outcome.disposition?.note ?? "", /no FTP client/);
  assert.match(outcome.disposition?.note ?? "", /NEXT MOVE/);
});

test("a wall is a wall: permission stays CANNOT_TELL and never becomes DISALLOWED", async () => {
  const outcome = await run(AZ_ROUTE, fakeOpen("challenge", 403, "text/html"));
  assert.equal(outcome.disposition?.disposition, "BLOCKED_CURRENTLY");
  assert.equal(outcome.disposition?.permission, "CANNOT_TELL");
});

test("an obligation with no registered descriptor names OUR gap, not a publisher's", async () => {
  const outcome = await run(null, fakeOpen("unused"));
  assert.equal(outcome.kind, "ABORTED");
  assert.match(outcome.detail, /gap in OUR registry/);
});

/* ----------------------------------------------------- scheduling the first read */

test("a record NOBODY HAS EVER WORKED is due NOW, not one interval from registration", () => {
  const row = scheduleObligation(
    {
      id: "freshness:campaign-finance:az#r",
      recordClass: "campaign-finance",
      subjectId: "az",
      routeId: "r",
      active: true,
      /* The only signal is a distant election, so the derived cadence is weeks.
         Anchoring the FIRST read on it means registering a record and walking
         nothing for a month while reporting a healthy schedule. */
      readerImpactAt: "2026-11-03T07:00:00.000Z",
      observedChangeRateHours: null,
      lastWorkedAt: null,
    },
    NOW_MS,
  );
  assert.ok(isScheduled(row));
  assert.equal(Date.parse(row.nextDueAt), NOW_MS);
  assert.match(row.basis, /NEVER been worked/);
});

test("a record that HAS been worked still schedules from its last work", () => {
  const lastWorkedAt = "2026-08-30T12:00:00.000Z";
  const row = scheduleObligation(
    {
      id: "freshness:meetings:body",
      recordClass: "meetings",
      subjectId: "body",
      routeId: "r",
      active: true,
      readerImpactAt: null,
      observedChangeRateHours: null,
      lastWorkedAt,
    },
    NOW_MS,
  );
  assert.ok(isScheduled(row));
  assert.equal(
    Date.parse(row.nextDueAt),
    Date.parse(lastWorkedAt) + 12 * 3_600_000,
    "scheduling from `now` on every pass means a row examined often is never due",
  );
});

/* ------------------------------------------------------------ backoff gating */

test("a failing obligation is NOT re-dispatched before its backoff elapses", async () => {
  const repos = createMemoryRepositories();
  const obligation: FreshnessObligation = {
    id: "freshness:campaign-finance:az#ftp",
    recordClass: "campaign-finance",
    subjectId: "az",
    routeId: "az-sos-cfs-bulk-ftp",
    active: true,
    readerImpactAt: null,
    observedChangeRateHours: null,
    /* Never discharged, so its next-due is permanently in the past. Without the
       backoff gate this is dispatched on every cycle forever. */
    lastWorkedAt: null,
  };
  const debt = recordFailure(null, {
    obligationId: obligation.id,
    cause: "REFUSED_BY_HOST",
    detail: "no FTP client",
    target: "ftp.azsos.gov",
    dueAt: NOW,
    now: NOW,
  });

  let ran = 0;
  const cycle = await runCycle({
    repos,
    obligations: [obligation],
    debts: [debt],
    routeTaskFor: () => "rt-neverclaimed",
    maturity: () => "GRADUATED",
    executor: {
      lane: "DETERMINISTIC",
      run: async () => {
        ran += 1;
        return { ranAs: "DETERMINISTIC", kind: "ABORTED", detail: "should not run" };
      },
    },
    holder: "test",
    now: NOW,
    leaseTtlMs: 1000,
    reader: { contract: "READER", state: "NOT_READY", reason: "test" },
    truth: { contract: "TRUTH", state: "NOT_READY", reason: "test" },
  });

  assert.equal(ran, 0, "the backed-off obligation must not be dispatched");
  assert.equal(cycle.dispatched.length, 0);
  assert.equal(cycle.deferred.length, 1, "and it must be COUNTED, never silently dropped");
  assert.match(cycle.deferred[0].why, /backoff/);
});

/* ------------------------------------------------- provider signals refresh */

test("a CORRECTED provider signal reaches a row that is already durable", async () => {
  const repos = createMemoryRepositories();
  const base: FreshnessObligation = {
    id: "freshness:campaign-finance:az#r",
    recordClass: "campaign-finance",
    subjectId: "az",
    routeId: "r",
    active: true,
    /* The signal as it was first written: the election date, which says
       staleness is free until November. */
    readerImpactAt: "2026-11-03T07:00:00.000Z",
    meetingStartsAt: ["2026-11-03T07:00:00.000Z"],
    scopeDivisions: ["ocd-division/country:us/state:az"],
    observedChangeRateHours: null,
    lastWorkedAt: null,
  };

  const first = await syncObligations(repos, [base], NOW);
  assert.equal(first.registered.length, 1);
  assert.equal(first.refreshed.length, 0);

  /* The row is then WORKED, so runtime state exists that no corpus produced. */
  const held = await repos.obligations.mustRead(base.id);
  await repos.obligations.compareAndSet(
    held.id,
    held.revision,
    { ...held.value, lastWorkedAt: NOW, occurrenceCount: 3, nextDueAt: "2026-09-30T00:00:00.000Z" },
    NOW,
  );

  /* The provider corrects the signal. */
  const second = await syncObligations(repos, [{ ...base, readerImpactAt: null }], NOW);

  assert.deepEqual(second.refreshed, [{ id: base.id, changed: ["readerImpactAt"] }]);
  const after = (await repos.obligations.mustRead(base.id)).value;
  assert.equal(after.readerImpactAt, null, "the correction must take effect");
  assert.equal(after.lastWorkedAt, NOW, "and the runtime state it did not produce must survive");
  assert.equal(after.occurrenceCount, 3);
  assert.equal(after.nextDueAt, "2026-09-30T00:00:00.000Z");

  /* An unchanged pass writes nothing and reports nothing. */
  const beforeIdle = await repos.obligations.mustRead(base.id);
  const later = "2026-09-01T12:00:00.000Z";
  const third = await syncObligations(repos, [JSON.parse(JSON.stringify({ ...base, readerImpactAt: null }))], later);
  assert.equal(third.refreshed.length, 0);
  assert.deepEqual(await repos.obligations.mustRead(base.id), beforeIdle,
    "equal provider arrays retain the revision, updated-at and runtime-owned state");

  const corrected = await syncObligations(repos, [{ ...base, readerImpactAt: null,
    meetingStartsAt: ["2026-11-04T07:00:00.000Z"] }], later);
  assert.deepEqual(corrected.refreshed, [{ id: base.id, changed: ["meetingStartsAt"] }]);
  const final = await repos.obligations.mustRead(base.id);
  assert.equal(final.revision, beforeIdle.revision + 1);
  assert.equal(final.value.lastWorkedAt, NOW);
  assert.equal(final.value.occurrenceCount, 3);
  assert.equal(final.value.nextDueAt, "2026-09-30T00:00:00.000Z");
});

/* ----------------------------------------------------------- the promotion tail */

const AZ_BODY = JSON.stringify({
  draw: 1,
  recordsTotal: 2,
  recordsFiltered: 2,
  data: [
    { EntityID: 1, EntityLastName: "Accalia, Jayme <br>(102162)", Income: 1, Expense: 0, CashBalance: 1 },
    { EntityID: 2, EntityLastName: "Someone Else <br>(2)", Income: 2, Expense: 1, CashBalance: 1 },
  ],
});

function stageInput(root: string, body: string | null, disposition: string | null) {
  return {
    root,
    obligationId: "freshness:campaign-finance:az-sos-cfs-2026#az-sos-seethemoney-datatables",
    providerId: "campaign-finance",
    recordClass: "campaign-finance",
    subjectId: "az-sos-cfs-2026",
    route: AZ_ROUTE,
    disposition,
    artifactIds: ["ar-abc"],
    body,
    nextDueAt: "2026-09-01T12:00:00.000Z",
    detail: "detail",
    stagedOn: "2026-08-31",
  };
}

test("the tail runs to a STAGED FILE a later session can point at", () => {
  const root = tmp();
  const entry = stageOne(stageInput(root, AZ_BODY, "INGESTED"));

  assert.equal(entry.state, "STAGED_PROMOTION_READY");
  assert.equal(entry.rowCount, 2);
  assert.equal(entry.declaredTotal, 2);
  assert.equal(entry.complete, true);
  assert.ok(entry.snapshotPath !== null);
  assert.ok(existsSync(join(root, entry.snapshotPath)), "the staged state must be a real file");

  const snapshot = JSON.parse(readFileSync(join(root, entry.snapshotPath), "utf8"));
  assert.equal(snapshot.promotedToReaderTruth, false);
  assert.equal(snapshot.rows.length, 2);
  assert.equal(
    snapshot.rows[0].entityLastNameRaw,
    "Accalia, Jayme <br>(102162)",
    "the publisher's own markup is carried VERBATIM; stripping it edits a government's record",
  );
  assert.ok(
    snapshot.unresolved.some((u: string) => u.includes("NO PER-ENTITY CYCLE TOTAL")),
    "the undetermined row semantics must travel with the data",
  );
});

test("a PARTIAL index is labelled PARTIAL and never staged under the index's name", () => {
  const root = tmp();
  const partial = JSON.stringify({ recordsTotal: 370, data: [{ EntityID: 1 }] });
  const entry = stageOne(stageInput(root, partial, "INGESTED"));

  assert.equal(entry.complete, false);
  assert.equal(entry.rowCount, 1);
  assert.equal(entry.declaredTotal, 370);
  assert.match(entry.readerSentence, /1 of the 370 row\(s\)/);
  /*
   * And the sentence must say WHICH whole it is claiming. `complete` means the
   * response we asked for arrived entire; it never means the index is entire.
   * Arizona's `GetNEWTableData` declared 370 and returned 370, and Kevin Volk —
   * on the 85701 ballot with $173,742 filed — is not among them. RULING 207.
   */
  assert.match(entry.readerSentence, /not a claim that the index is whole/);
  assert.ok(entry.unresolved.some((u) => u.startsWith("PARTIAL:")));
});

test("a WALL STAGES TOO, as a named gap with the obligation still live", () => {
  const root = tmp();
  const ftp: RouteDescriptor = {
    ...AZ_ROUTE,
    routeId: "az-sos-cfs-bulk-ftp",
    label: "the bulk FTP drop",
    open: {
      kind: "NOT_MACHINE_EXECUTABLE",
      target: "ftp://ftp.azsos.gov/cfsdata2/",
      reason: "this process holds no FTP client",
    },
    awaitingAdapter: "an FTP client",
  };
  const entry = stageOne({
    ...stageInput(root, null, "REQUIRES_NEW_ADAPTER"),
    route: ftp,
  });

  assert.equal(entry.state, "STAGED_GAP");
  assert.match(entry.readerSentence, /no FTP client/);
  assert.equal(entry.nextDueAt, "2026-09-01T12:00:00.000Z");
  assert.ok(
    entry.unresolved.some((u) => u.includes("still owed")),
    "RULING 224's honest gap state names the wall AND says the obligation is still worked",
  );
});

test("an acquired record with NO NORMALIZER stages a gap, never an empty snapshot", () => {
  const root = tmp();
  const unknown: RouteDescriptor = { ...AZ_ROUTE, routeId: "no-normalizer-exists", yieldContract: undefined };
  const entry = stageOne({ ...stageInput(root, "<html></html>", "INGESTED"), route: unknown });

  assert.equal(entry.state, "STAGED_GAP");
  assert.ok(entry.unresolved.some((u) => u.includes("NORMALIZER MISSING")));
  assert.equal(entry.snapshotPath, null, "nothing is written for a record nothing could read");
});

test("a zero-row normalization is a FAILED normalization, never an empty document", () => {
  const root = tmp();
  const empty = JSON.stringify({ recordsTotal: 370, data: [] });
  const entry = stageOne(stageInput(root, empty, "INGESTED"));

  assert.equal(entry.state, "STAGED_GAP");
  assert.ok(entry.unresolved.some((u) => u.includes("NORMALIZATION FAILED")));
  assert.ok(entry.unresolved.some((u) => u.includes("ZERO rows")));
});

test("THE PROMOTION BOUNDARY: the tail writes under staging and nowhere else", () => {
  const root = tmp();
  stageOne(stageInput(root, AZ_BODY, "INGESTED"));
  writeStagingManifest(root, [stageOne(stageInput(root, AZ_BODY, "INGESTED"))], "2026-08-31");

  for (const readerPath of ["data/funding", "data/ballot", "data/meetings-snapshot.json", "app", "public"]) {
    assert.equal(
      existsSync(join(root, readerPath)),
      false,
      `the tail must never write ${readerPath}. Promotion is a session's last mile, not a cycle's.`,
    );
  }
});

test("the manifest MERGES, so a cycle cannot erase what it did not touch", () => {
  const root = tmp();
  const first: StagedEntry = {
    obligationId: "a",
    providerId: "campaign-finance",
    recordClass: "campaign-finance",
    subjectId: "s",
    routeId: "r",
    state: "STAGED_GAP",
    stagedOn: "2026-08-30",
    nextDueAt: null,
    disposition: null,
    rowCount: 0,
    declaredTotal: null,
    complete: false,
    snapshotPath: null,
    readerSentence: "first",
    unresolved: [],
  };
  writeStagingManifest(root, [first], "2026-08-30");
  const result = writeStagingManifest(root, [{ ...first, obligationId: "b" }], "2026-08-31");

  assert.equal(result.total, 2, "a manifest that shrank every cycle would report lost work");
  const manifest = readStagingManifest(root);
  assert.equal(manifest?.promotionEnabled, true, "research promotion is on (§3)");
  assert.deepEqual(manifest?.entries.map((e) => e.obligationId), ["a", "b"]);
});

test("the digest counts BOTH staged states, always", () => {
  const lines = promotionLines([]).join("\n");
  assert.match(lines, /0 entry\(ies\) staged/);
  assert.match(lines, /Promotion is ON/);
});

test("both registered normalizers exist for the routes that acquire", () => {
  assert.ok(NORMALIZERS["az-sos-seethemoney-datatables"]);
  assert.ok(NORMALIZERS["nh-cfs-filing-entity-details"]);
});

test("the NH normalizer reads the publisher's OWN declared total", () => {
  const body = JSON.stringify({
    data: { items: [{ filerEntityId: 1, filerName: "x" }], totalItems: 5738 },
  });
  const normalized = NORMALIZERS["nh-cfs-filing-entity-details"](body);
  assert.equal(normalized.declaredTotal, 5738);
  assert.equal(normalized.rows.length, 1);
  assert.ok(
    normalized.unresolved.some((u) => u.includes("FILER-LEVEL TOTALS ONLY")),
    "filer totals are what the filer reported and are not an itemized record of their money",
  );
});

/* ------------------------------------------------------------ tracker intake */

test("ABSENT, UNREADABLE and PRESENT_EMPTY are three different answers", () => {
  const root = tmp();
  assert.equal(readTrackerHandoff(join(root, "nope.json")).state, "ABSENT");

  const broken = join(root, "broken.json");
  writeFileSync(broken, "{not json", "utf8");
  const unreadable = readTrackerHandoff(broken);
  assert.equal(unreadable.state, "UNREADABLE");
  assert.match(unreadable.detail, /FAILED read/);

  const empty = join(root, "empty.json");
  writeFileSync(empty, JSON.stringify({ rows: [] }), "utf8");
  const zero = readTrackerHandoff(empty);
  assert.equal(zero.state, "PRESENT_EMPTY");
  assert.match(zero.detail, /FAILED extraction/);
});

test("the ingestion path turns a converted tracker row into a scheduled unit", () => {
  const fixture = join(ROOT, "tests", "fixtures", "tracker-obligation-handoff.json");
  const read = readTrackerHandoff(fixture);

  /* RULING 228 renamed these: the state vocabulary is the shared contract's, and
     `rejected` became `deferred` because a row that is not yet schedulable has
     not been refused - it is waiting on something its producer named. */
  assert.equal(read.state, "PARTIALLY_REGISTERED");
  assert.equal(read.rows.length, 1, "one usable row of the two the fixture carries");
  assert.equal(read.deferred.length, 1, "and the unusable one is NAMED, never silently dropped");
  assert.equal(read.deferred[0].trackerId, "AZ-NO-ROUTES");

  const pass = buildRegistry([trackerIntakeProvider(fixture)], { root: ROOT, nowIso: NOW });
  assert.equal(pass.units.length, 1);
  assert.equal(pass.units[0].obligation.id, "freshness:tracker:az-easyvote-tenant-list#easyvote-tenant-list");
  assert.equal(pass.units[0].obligation.routeId, "easyvote-tenant-list");
  /* A DEFERRED row is not a read FAILURE. The producer said why it is not
     ready, which is an answer rather than a breakage - so it travels as the
     reason, and readFailure stays null. */
  assert.equal(pass.byProvider[0].readFailure, null);
  assert.match(
    pass.byProvider[0].emptyReason ?? "",
    /DEFERRED/,
    "the deferred row is NAMED, not hidden behind a count",
  );
});

test("the tracker provider reports ABSENT as an absence, not as an empty domain", () => {
  const pass = buildRegistry([trackerIntakeProvider(join(tmp(), "nothing.json"))], {
    root: ROOT,
    nowIso: NOW,
  });
  assert.equal(pass.byProvider[0].readFailure, null);
  assert.match(pass.byProvider[0].emptyReason ?? "", /ABSENCE of input/);
});

/* ------------------------------------------- the lane descriptor drop-in path */

test("a lane descriptor file REPLACES the built-in record for its subject", () => {
  const root = tmp();
  mkdirSync(join(root, "data", "campaign-finance", "route-descriptors"), { recursive: true });
  writeFileSync(
    join(root, "data", "campaign-finance", "route-descriptors", "az.json"),
    JSON.stringify({
      records: [
        {
          recordClass: "campaign-finance",
          subjectId: "az-sos-cfs-2026",
          readerImpactAt: null,
          observedChangeRateHours: null,
          lastWorkedAt: null,
          routes: [
            {
              routeId: "lane-az-confirmed",
              label: "the route LANE AZ confirmed",
              executorClass: "DETERMINISTIC",
              executorReason: "confirmed live",
              open: { kind: "HTTP_GET", url: "https://seethemoney.az.gov/" },
              citation: "LANE AZ",
            },
          ],
        },
      ],
    }),
    "utf8",
  );

  const pass = buildRegistry([campaignFinanceProvider()], { root, nowIso: NOW });
  const az = pass.units.filter((u) => u.record.subjectId === "az-sos-cfs-2026");
  assert.equal(az.length, 1, "the dropped file replaces the built-in record wholesale");
  assert.equal(az[0].obligation.routeId, "lane-az-confirmed");

  const nh = pass.units.filter((u) => u.record.subjectId === "nh-sos-cfs-2026");
  assert.ok(nh.length > 0, "and it leaves every other subject's built-ins alone");
});

test("a descriptor file that declares ZERO records is a FAILED read of that file", () => {
  const root = tmp();
  mkdirSync(join(root, "data", "campaign-finance", "route-descriptors"), { recursive: true });
  writeFileSync(
    join(root, "data", "campaign-finance", "route-descriptors", "empty.json"),
    JSON.stringify({ records: [] }),
    "utf8",
  );
  const read = readDescriptorFiles(root);
  assert.equal(read.bySubject.size, 0);
  assert.equal(read.failures.length, 1);
  assert.match(read.failures[0], /failed read of that file/);
});
