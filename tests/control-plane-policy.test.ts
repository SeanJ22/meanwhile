import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { CAPABILITIES, DEFAULT_GRANTS, PolicyRefusal, authorize, defaultGrant, requireCapability, type CapabilityGrant } from "../lib/control-plane/capability.ts";
import { createLedger, release, tryAcquire, vendorInFlight, type BudgetLedger, type HostBudget } from "../lib/control-plane/budget.ts";
import { WORKER_ROLES, type WorkerRole } from "../lib/control-plane/attempt.ts";

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
  assert.ok(names.includes("spendByTier") && names.includes("withinBudget"), "known exports are seen");

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
