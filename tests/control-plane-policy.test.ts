import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  ALWAYS_ON_POLICY,
  CAPABILITIES,
  DEFAULT_GRANTS,
  NeutralityDisabled,
  OWNER_GATED_CAPABILITIES,
  PolicyRefusal,
  assertNeutralityEnabled,
  authorize,
  defaultGrant,
  requireCapability,
  rolesWithCapabilityByDefault,
  type CapabilityGrant,
} from "../lib/control-plane/capability.ts";
import {
  backoff,
  clearBackoff,
  createLedger,
  describeBudget,
  release,
  tryAcquire,
  vendorInFlight,
  type BudgetLedger,
  type HostBudget,
} from "../lib/control-plane/budget.ts";
import {
  COST_METRICS,
  CostCapExceeded,
  assertWithinHardCap,
  costEntryFromAttempt,
  rollup,
  shouldScheduleMoreWork,
  withinBudget,
  type CostEntry,
} from "../lib/control-plane/cost.ts";
import { WORKER_ROLES, type AttemptCost, type WorkerRole } from "../lib/control-plane/attempt.ts";

const T0 = "2026-08-28T00:00:00.000Z";
const POLICY = "policy-2026-08-28";

function grantFor(role: WorkerRole): CapabilityGrant {
  return defaultGrant({ role, project: "meanwhile", policyVersion: POLICY, grantedAt: T0 });
}

function caught(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return null;
}

test("SEEDED #7: a PARSER asking for NETWORK_PUBLIC_READ is refused BY NAME", () => {
  const grant = grantFor("PARSER");
  const result = authorize(grant, "NETWORK_PUBLIC_READ");

  assert.equal(result.allowed, false, "a parser must never be authorized for the network");
  assert.equal(result.role, "PARSER");
  assert.equal(result.capability, "NETWORK_PUBLIC_READ");
  assert.match(result.reason, /PARSER/);
  assert.match(result.reason, /NETWORK_PUBLIC_READ/);

  const thrown = caught(() => requireCapability(grant, "NETWORK_PUBLIC_READ"));
  assert.ok(thrown instanceof PolicyRefusal, "the refusal is a typed PolicyRefusal");
  assert.equal(thrown.role, "PARSER");
  assert.equal(thrown.capability, "NETWORK_PUBLIC_READ");
});

test("a PARSER is refused VAULT_READ_RESTRICTED and holds sanitized read only", () => {
  const grant = grantFor("PARSER");
  const restricted = authorize(grant, "VAULT_READ_RESTRICTED");

  assert.equal(restricted.allowed, false);
  assert.match(restricted.reason, /PARSER/);
  assert.match(restricted.reason, /VAULT_READ_RESTRICTED/);

  assert.equal(authorize(grant, "VAULT_READ_SANITIZED").allowed, true);
  assert.deepEqual(
    [...DEFAULT_GRANTS.PARSER],
    ["VAULT_READ_SANITIZED"],
    "the parser default grant is exactly one capability",
  );
  for (const capability of DEFAULT_GRANTS.PARSER) {
    assert.ok(
      !["NETWORK_PUBLIC_READ", "BROWSER_DRIVE"].includes(capability),
      `PARSER must hold no network capability, holds ${capability}`,
    );
  }
});

test("least privilege: the absences in DEFAULT_GRANTS are the point", () => {
  // The acquirer fetches and stores evidence, but does not get to declare it
  // canonical. The role that obtains a document is not the role that blesses it.
  assert.ok(DEFAULT_GRANTS.ACQUIRER.includes("NETWORK_PUBLIC_READ"));
  assert.ok(DEFAULT_GRANTS.ACQUIRER.includes("VAULT_WRITE"));
  assert.ok(!DEFAULT_GRANTS.ACQUIRER.includes("CANONICAL_PROMOTE"));

  assert.deepEqual(rolesWithCapabilityByDefault("MERGE_TO_MAIN"), ["RELEASE_ORCHESTRATOR"]);
  assert.deepEqual(rolesWithCapabilityByDefault("PRODUCTION_DB_WRITE"), []);
  assert.deepEqual(rolesWithCapabilityByDefault("EXTERNAL_COMMUNICATION"), []);
  assert.deepEqual(rolesWithCapabilityByDefault("RECORDS_REQUEST_SEND"), []);

  for (const capability of OWNER_GATED_CAPABILITIES) {
    assert.deepEqual(
      rolesWithCapabilityByDefault(capability),
      [],
      `${capability} is owner-gated and may not sit in any role default`,
    );
  }

  // The auditor keeps the network on purpose: an auditor limited to the
  // artifacts the acquirer chose to keep can only ever confirm the acquirer.
  assert.ok(
    DEFAULT_GRANTS.ADVERSARIAL_AUDITOR.includes("NETWORK_PUBLIC_READ"),
    "the auditor must be able to independently acquire first-party evidence",
  );
  for (const write of ["VAULT_WRITE", "CANONICAL_PROMOTE", "CODE_BRANCH_WRITE"] as const) {
    assert.ok(
      !DEFAULT_GRANTS.ADVERSARIAL_AUDITOR.includes(write),
      `the auditor holds no write capability, holds ${write}`,
    );
  }
});

test("DEFAULT DENY: unknown capability, unknown role and absent grant are all refused", () => {
  const grant = grantFor("ACQUIRER");

  const unknown = authorize(grant, "DELETE_THE_INTERNET");
  assert.equal(unknown.allowed, false, "an unrecognised capability is refused, never passed");
  assert.match(unknown.reason, /not a known capability/);

  const bogusRole = authorize(
    { ...grant, role: "SUPERUSER" as WorkerRole, capabilities: [...CAPABILITIES] },
    "MERGE_TO_MAIN",
  );
  assert.equal(bogusRole.allowed, false, "an unrecognised role holds nothing");
  assert.match(bogusRole.reason, /not a known worker role/);

  assert.equal(authorize(null, "NETWORK_PUBLIC_READ").allowed, false);
  assert.equal(authorize(undefined, "NETWORK_PUBLIC_READ").allowed, false);

  const empty = authorize({ ...grant, capabilities: [] }, "NETWORK_PUBLIC_READ");
  assert.equal(empty.allowed, false);
  assert.match(empty.reason, /\(nothing\)/);

  for (const role of WORKER_ROLES) {
    const roleGrant = grantFor(role);
    for (const capability of CAPABILITIES) {
      assert.equal(
        authorize(roleGrant, capability).allowed,
        DEFAULT_GRANTS[role].includes(capability),
        `${role} / ${capability}`,
      );
    }
  }
});

test("widening a grant beyond the role default requires stated notes", () => {
  assert.throws(
    () =>
      defaultGrant({
        role: "PARSER",
        project: "meanwhile",
        policyVersion: POLICY,
        grantedAt: T0,
        extraCapabilities: ["NETWORK_PUBLIC_READ"],
      }),
    /must carry notes/,
  );

  const widened = defaultGrant({
    role: "PARSER",
    project: "meanwhile",
    policyVersion: POLICY,
    grantedAt: T0,
    extraCapabilities: ["NETWORK_PUBLIC_READ"],
    notes: "One-off: author approved a re-fetch of a truncated PDF on 2026-08-28.",
  });
  assert.equal(authorize(widened, "NETWORK_PUBLIC_READ").allowed, true);
  assert.ok(widened.notes);
});

test("neutrality is an invariant, not a flag: disabling it throws", () => {
  assert.doesNotThrow(() => assertNeutralityEnabled(ALWAYS_ON_POLICY));

  const thrown = caught(() =>
    assertNeutralityEnabled({ ...ALWAYS_ON_POLICY, politicalNeutrality: false }),
  );
  assert.ok(thrown instanceof NeutralityDisabled);
  assert.equal(thrown.invariant, "POLITICAL_NEUTRALITY");
  assert.match(thrown.message, /cannot be disabled/);

  const symmetry = caught(() =>
    assertNeutralityEnabled({ ...ALWAYS_ON_POLICY, coverageSymmetry: false }),
  );
  assert.ok(symmetry instanceof NeutralityDisabled);
  assert.equal(symmetry.invariant, "COVERAGE_SYMMETRY");

  assert.equal(
    CAPABILITIES.filter((c) => /NEUTRAL|SYMMETR|RANK|SCORE/i.test(c)).length,
    0,
    "neutrality must not be representable as a capability",
  );
});

// minIntervalMs is 0 so the second same-instant acquire reaches the concurrency check rather than the interval.
function pimaHost(over: Partial<HostBudget> = {}): HostBudget {
  return {
    host: "pima.legistar.com",
    maxConcurrent: 3,
    minIntervalMs: 0,
    dailyRequestCap: null,
    backoffUntil: null,
    observedCrawlDelayMs: null,
    vendor: "legistar",
    ...over,
  };
}

test("SEEDED #9: twelve workers on one publisher contend on ONE shared HostBudget", () => {
  let ledger: BudgetLedger = createLedger({ hosts: [pimaHost()] });

  const results = [];
  for (let worker = 0; worker < 12; worker += 1) {
    const result = tryAcquire(ledger, "pima.legistar.com", T0);
    ledger = result.ledger;
    results.push(result);
  }

  const granted = results.filter((r) => r.granted);
  const refused = results.filter((r) => !r.granted);
  assert.equal(granted.length, 3, "exactly the shared maxConcurrent is granted");
  assert.equal(refused.length, 9, "the other nine wait");

  for (const r of refused) {
    assert.equal(r.refusal, "HOST_CONCURRENCY");
    assert.ok(r.waitMs > 0, "a refusal states a wait rather than just failing");
    assert.match(r.reason, /pima\.legistar\.com/);
    assert.match(r.reason, /3/);
  }

  ledger = release(ledger, "pima.legistar.com");
  ledger = release(ledger, "pima.legistar.com");

  const first = tryAcquire(ledger, "pima.legistar.com", T0);
  assert.equal(first.granted, true);
  const second = tryAcquire(first.ledger, "pima.legistar.com", T0);
  assert.equal(second.granted, true);
  const third = tryAcquire(second.ledger, "pima.legistar.com", T0);
  assert.equal(third.granted, false, "back at the shared limit");
  assert.equal(third.refusal, "HOST_CONCURRENCY");

  assert.match(describeBudget(second.ledger, "pima.legistar.com"), /3\/3 in flight/);
});

test("per-worker politeness MULTIPLIES: twelve private ledgers allow twelve", () => {
  let privateGrants = 0;
  for (let worker = 0; worker < 12; worker += 1) {
    const own = createLedger({ hosts: [pimaHost()] });
    if (tryAcquire(own, "pima.legistar.com", T0).granted) privateGrants += 1;
  }
  assert.equal(privateGrants, 12, "twelve private budgets are twelve budgets");

  let shared: BudgetLedger = createLedger({ hosts: [pimaHost()] });
  let sharedGrants = 0;
  for (let worker = 0; worker < 12; worker += 1) {
    const result = tryAcquire(shared, "pima.legistar.com", T0);
    shared = result.ledger;
    if (result.granted) sharedGrants += 1;
  }
  assert.equal(sharedGrants, 3, "one shared budget is one budget");
  assert.ok(sharedGrants < privateGrants, "sharing is the entire mechanism");
});

test("a vendor budget caps the SUM across hosts each individually under its own cap", () => {
  let ledger: BudgetLedger = createLedger({
    hosts: [
      pimaHost({ host: "a.legistar.com", maxConcurrent: 3 }),
      pimaHost({ host: "b.legistar.com", maxConcurrent: 3 }),
    ],
    vendors: [
      { vendor: "legistar", maxConcurrent: 4, dailyRequestCap: null, backoffUntil: null },
    ],
  });

  for (let i = 0; i < 3; i += 1) {
    const r = tryAcquire(ledger, "a.legistar.com", T0);
    assert.equal(r.granted, true, `host a acquire ${i}`);
    ledger = r.ledger;
  }
  const firstB = tryAcquire(ledger, "b.legistar.com", T0);
  assert.equal(firstB.granted, true, "vendor sum is 3 of 4 — still room");
  ledger = firstB.ledger;

  assert.equal(vendorInFlight(ledger, "legistar"), 4);

  const secondB = tryAcquire(ledger, "b.legistar.com", T0);
  assert.equal(
    secondB.granted,
    false,
    "host b is at 1 of its own 3, but the vendor sum is at 4 of 4",
  );
  assert.equal(secondB.refusal, "VENDOR_CONCURRENCY");
  assert.match(secondB.reason, /legistar/);
  assert.match(secondB.reason, /SUM/);
});

test("the minimum interval and a published crawl-delay are both honoured", () => {
  const host = pimaHost({ maxConcurrent: 10, minIntervalMs: 1000, observedCrawlDelayMs: 5000 });
  let ledger: BudgetLedger = createLedger({ hosts: [host] });

  const first = tryAcquire(ledger, "pima.legistar.com", T0);
  assert.equal(first.granted, true);
  ledger = release(first.ledger, "pima.legistar.com");

  const tooSoon = tryAcquire(ledger, "pima.legistar.com", "2026-08-28T00:00:02.000Z");
  assert.equal(tooSoon.granted, false, "the host's OWN stated delay outranks our shorter floor");
  assert.equal(tooSoon.refusal, "HOST_MIN_INTERVAL");
  assert.equal(tooSoon.waitMs, 3000);

  const later = tryAcquire(ledger, "pima.legistar.com", "2026-08-28T00:00:06.000Z");
  assert.equal(later.granted, true);
});

test("a 429 backs the host off for everyone, and the backoff cannot be lifted early", () => {
  let ledger: BudgetLedger = createLedger({ hosts: [pimaHost()] });
  ledger = backoff(ledger, "pima.legistar.com", "2026-08-28T01:00:00.000Z", "HTTP 429 Retry-After");

  const refused = tryAcquire(ledger, "pima.legistar.com", T0);
  assert.equal(refused.granted, false);
  assert.equal(refused.refusal, "HOST_BACKOFF");
  assert.equal(refused.waitMs, 60 * 60 * 1000);
  assert.match(refused.reason, /HTTP 429/);

  const shortened = backoff(ledger, "pima.legistar.com", "2026-08-28T00:10:00.000Z", "guess");
  assert.equal(
    shortened.hostState["pima.legistar.com"].backoffUntil,
    "2026-08-28T01:00:00.000Z",
  );

  assert.equal(clearBackoff(ledger, "pima.legistar.com", T0), ledger, "not cleared early");
  const cleared = clearBackoff(ledger, "pima.legistar.com", "2026-08-28T02:00:00.000Z");
  assert.equal(tryAcquire(cleared, "pima.legistar.com", "2026-08-28T02:00:00.000Z").granted, true);
});

test("an unregistered host is refused, not assumed polite", () => {
  const ledger = createLedger({ hosts: [pimaHost()] });
  const result = tryAcquire(ledger, "unknown.example.gov", T0);
  assert.equal(result.granted, false);
  assert.equal(result.refusal, "UNREGISTERED_HOST");
  assert.match(result.reason, /unknown\.example\.gov/);
});

test("a daily cap is shared too, and a credential quota follows the key", () => {
  let ledger: BudgetLedger = createLedger({
    hosts: [pimaHost({ maxConcurrent: 10, dailyRequestCap: 2 })],
    credentials: [
      { credentialId: "key-1", vendor: "legistar", dailyRequestCap: 1, maxConcurrent: null, backoffUntil: null },
    ],
  });

  const a = tryAcquire(ledger, "pima.legistar.com", T0, { credentialId: "key-1" });
  assert.equal(a.granted, true);
  const b = tryAcquire(a.ledger, "pima.legistar.com", T0, { credentialId: "key-1" });
  assert.equal(b.granted, false);
  assert.equal(b.refusal, "CREDENTIAL_DAILY_CAP");

  const c = tryAcquire(a.ledger, "pima.legistar.com", T0);
  assert.equal(c.granted, true);
  const d = tryAcquire(c.ledger, "pima.legistar.com", T0);
  assert.equal(d.granted, false);
  assert.equal(d.refusal, "HOST_DAILY_CAP");

  ledger = c.ledger;
  const nextDay = tryAcquire(ledger, "pima.legistar.com", "2026-08-29T00:00:00.000Z");
  assert.equal(nextDay.granted, true);

  const unknownKey = tryAcquire(a.ledger, "pima.legistar.com", T0, { credentialId: "key-9" });
  assert.equal(unknownKey.granted, false);
  assert.equal(unknownKey.refusal, "CREDENTIAL_UNKNOWN");
});

function entry(over: Partial<CostEntry> & { cost: AttemptCost }): CostEntry {
  return {
    attemptId: "att-1",
    workItemId: "wi-1",
    routeTaskId: "rt-1",
    routeId: "INSITE_CALENDAR_GRID",
    source: "legistar-insite",
    jurisdiction: "ocd-division/country:us/state:az/county:pima",
    project: "meanwhile",
    role: "ACQUIRER",
    recordedAt: T0,
    ...over,
  };
}

const NO_COST: AttemptCost = {
  inputTokens: null,
  outputTokens: null,
  usd: null,
  durationMs: null,
  bytesFetched: null,
  requestCount: null,
  cacheReadInputTokens: null,
  cacheCreationInputTokens: null,
  cacheCreation5mInputTokens: null,
  cacheCreation1hInputTokens: null,
  uncachedInputTokens: null,
  batch: false,
};

test("an UNMEASURED token count is reported as unmeasured, never as zero", () => {
  const entries = [
    entry({ attemptId: "att-1", cost: { ...NO_COST, inputTokens: null } }),
    entry({ attemptId: "att-2", cost: { ...NO_COST, inputTokens: 5 } }),
  ];

  const [bucket] = rollup(entries, "project");
  assert.equal(bucket.key, "meanwhile");
  assert.equal(bucket.entryCount, 2);

  const tokens = bucket.totals.inputTokens;
  assert.equal(tokens.total, 5);
  assert.equal(tokens.measured, 1, "one entry reported input tokens");
  assert.equal(tokens.unmeasured, 1, "the null is COUNTED, not coerced to 0");
  assert.equal(tokens.complete, false);
  assert.notEqual(tokens.measured, 2);

  // A metric nothing reported totals to null, because the sum of no
  // measurements is nothing, not zero.
  assert.equal(bucket.totals.usd.total, null);
  assert.equal(bucket.totals.usd.measured, 0);
  assert.equal(bucket.totals.usd.unmeasured, 2);
});

test("rollups group by every dimension and name the unattributed bucket", () => {
  const entries = [
    entry({ attemptId: "att-1", source: "legistar-insite", cost: { ...NO_COST, usd: 1 } }),
    entry({ attemptId: "att-2", source: null, cost: { ...NO_COST, usd: 2 } }),
    entry({ attemptId: "att-3", source: "granicus", cost: { ...NO_COST, usd: 4 } }),
  ];

  const bySource = rollup(entries, "source");
  assert.deepEqual(
    bySource.map((b) => b.key),
    ["(unattributed)", "granicus", "legistar-insite"],
    "sorted, and the null source is a NAMED bucket rather than a dropped row",
  );
  assert.equal(bySource.find((b) => b.key === "(unattributed)")?.totals.usd.total, 2);

  const byRole = rollup(entries, "role");
  assert.deepEqual(byRole.map((b) => b.key), ["ACQUIRER"]);
  assert.equal(byRole[0].totals.usd.total, 7);
  assert.equal(byRole[0].totals.usd.complete, true);

  for (const metric of COST_METRICS) {
    assert.ok(metric in byRole[0].totals, `${metric} is reported in every rollup`);
  }
});

test("costEntryFromAttempt copies nulls through unchanged", () => {
  const attempt = {
    id: "att-7",
    routeTaskId: "rt-7",
    workItemId: "wi-7",
    worker: { role: "PARSER" as WorkerRole, provider: "test", version: "v1", instance: "i-1" },
    leaseId: "lease-7",
    startedAt: T0,
    endedAt: T0,
    outcome: "COMPLETED" as const,
    abortReason: null,
    artifactIds: [],
    cost: { ...NO_COST, outputTokens: 12 },
    methodVersion: 27,
    policyVersion: POLICY,
  };

  const record = costEntryFromAttempt(attempt, { project: "meanwhile", recordedAt: T0 });
  assert.equal(record.cost.outputTokens, 12);
  assert.equal(record.cost.inputTokens, null, "an unmeasured field is not defaulted");
  assert.equal(record.source, null);
  assert.equal(record.role, "PARSER");
});

test("a hard cap fires AT the cap, and an unmeasured spend is unenforceable", () => {
  assert.equal(withinBudget(99, 100).within, true);
  assert.equal(withinBudget(100, 100).within, false, "spending exactly the cap is spent");
  assert.equal(withinBudget(100, 100).enforceable, true);

  assert.doesNotThrow(() => assertWithinHardCap(99, 100, "usd"));
  const thrown = caught(() => assertWithinHardCap(100, 100, "usd"));
  assert.ok(thrown instanceof CostCapExceeded);
  assert.equal(thrown.spent, 100);
  assert.equal(thrown.cap, 100);
  assert.match(thrown.message, /HARD CAP/);

  const unmeasured = withinBudget(null, 100, "usd");
  assert.equal(unmeasured.enforceable, false, "we cannot claim to have enforced what we cannot see");
  assert.match(unmeasured.reason, /UNMEASURED/);
  assert.doesNotThrow(() => assertWithinHardCap(null, 100, "usd"));

  const noCap = withinBudget(5, null, "usd");
  assert.equal(noCap.enforceable, false);
});

test("cost answers ONLY whether to schedule more work, and says what it could not enforce", () => {
  const refused = shouldScheduleMoreWork({
    spent: { usd: 100, inputTokens: 10 },
    caps: { usd: 100, inputTokens: 1_000_000 },
  });
  assert.equal(refused.schedule, false);
  assert.deepEqual(refused.refusedBy, ["usd (100 of 100)"]);

  const permitted = shouldScheduleMoreWork({
    spent: { usd: 5 },
    caps: { usd: 100 },
  });
  assert.equal(permitted.schedule, true);
  assert.deepEqual(permitted.unenforceable, []);

  const blind = shouldScheduleMoreWork({
    spent: { usd: null },
    caps: { usd: 100 },
  });
  assert.equal(blind.schedule, true);
  assert.deepEqual(blind.unenforceable, ["usd"], "an unenforceable cap is surfaced, not hidden");
  assert.match(blind.reason, /unmeasured/i);
});

const EXPORTED_FUNCTION =
  /export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)|export\s+const\s+([A-Za-z0-9_]+)\s*(?::[^=]+)?=\s*(?:async\s*)?\(/g;

const TRUTH_SHAPED = /truth|correct|verif|valid|accura|believ|dispute|retract|refut|confiden/i;

function exportedFunctionNames(source: string): string[] {
  const names: string[] = [];
  for (const match of source.matchAll(EXPORTED_FUNCTION)) {
    const name = match[1] ?? match[2];
    if (name) names.push(name);
  }
  return names;
}

test("no exported function in cost.ts is shaped like a claim about truth", () => {
  const path = fileURLToPath(new URL("../lib/control-plane/cost.ts", import.meta.url));
  const source = readFileSync(path, "utf8");

  const names = exportedFunctionNames(source);
  assert.ok(
    names.length >= 5,
    `the detector must actually find exports; found ${names.length}: ${names.join(", ")}`,
  );
  assert.ok(names.includes("rollup") && names.includes("withinBudget"), "known exports are seen");

  const offenders = names.filter((name) => TRUTH_SHAPED.test(name));
  assert.deepEqual(
    offenders,
    [],
    "cost informs scheduling, never truth; these exports read as truth judgements",
  );

  const CONTROL = [
    "export function shouldCorrectFactBasedOnCost(spent: number): boolean { return spent < 5; }",
    "export const isClaimValidForItsPrice = (usd: number) => usd > 1;",
    "export async function verifyRecordIfCheap(): Promise<boolean> { return true; }",
    "export function rollup() {}",
  ].join("\n");
  const controlNames = exportedFunctionNames(CONTROL);
  assert.deepEqual(
    controlNames,
    [
      "shouldCorrectFactBasedOnCost",
      "isClaimValidForItsPrice",
      "verifyRecordIfCheap",
      "rollup",
    ],
    "the detector sees plain, arrow and async exported forms alike",
  );
  assert.deepEqual(
    controlNames.filter((n) => TRUTH_SHAPED.test(n)).sort(),
    ["isClaimValidForItsPrice", "shouldCorrectFactBasedOnCost", "verifyRecordIfCheap"],
    "the detector fires on all three forbidden shapes and spares the innocent one",
  );
});
