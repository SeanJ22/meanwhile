import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  PROVIDER_DEFINITIONS,
  billingFactId,
  billingFactsOf,
  factAmountWords,
  factPeriodWords,
  validateBillingFact,
  withFactRecorded,
  type BillingFact,
} from "@/lib/control-plane/billing-facts.ts";
import { receiptIdFor, type ActionRequest } from "@/lib/control-plane/gateway/contract.ts";
import { submit } from "@/lib/control-plane/gateway/gateway.ts";
import type { GatewayDeps } from "@/lib/control-plane/gateway/registry.ts";
import { ADMIN_CONFIG_ID, defaultAdminConfig, withFleetSpendCeiling } from "@/lib/control-plane/gateway/admin-config.ts";
import { createMemoryRepositories } from "@/lib/control-plane/repository/memory.ts";
import type { ControlPlaneRepositories } from "@/lib/control-plane/repository/types.ts";

/** Billing figures read by hand where the system cannot look: each carries its kind, period, read day and place; the same slot entered twice is a correction; the spending policy row is untouched. */

const NOW = "2026-09-23T04:00:00.000Z";
const TODAY = "2026-09-23";

function tickingClock(from = NOW): () => string {
  let ms = Date.parse(from);
  return () => {
    const at = new Date(ms).toISOString();
    ms += 1000;
    return at;
  };
}

function deps(repos: ControlPlaneRepositories): GatewayDeps {
  return { repos, now: tickingClock(), currentStateVersion: "world-1", codeSha: null };
}

function record(input: Record<string, unknown>, key: string): ActionRequest {
  return {
    type: "billing.fact.record",
    subject: "a billing figure",
    input,
    stateVersion: null,
    idempotencyKey: key,
    caller: "OWNER_SESSION",
    actorRef: "adm_test-session",
  };
}

const ANTHROPIC_MTD = {
  provider: "anthropic-api",
  kind: "MONTH_TO_DATE",
  amountUsd: "173.10",
  periodStart: "2026-09-01",
  periodEnd: "2026-09-30",
  asOf: "2026-09-22",
  source: "Anthropic Console, Cost page",
};

test("every provider offers at least one kind, and the entry form's first kind is one it accepts", () => {
  assert.ok(PROVIDER_DEFINITIONS.length >= 10);
  for (const p of PROVIDER_DEFINITIONS) {
    assert.ok(p.kinds.length > 0, `${p.key} offers no kind of figure`);
    assert.ok(p.fallback.trim().length > 0, `${p.key} names no manual path`);
  }
});

test("validation: each kind requires what makes it a distinct fact, and says what is missing", () => {
  const ok = validateBillingFact(ANTHROPIC_MTD, TODAY);
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.value.amountUsd, 173.1);
    assert.equal(ok.value.cadence, null);
  }
  const cases: [Record<string, unknown>, RegExp][] = [
    [{ ...ANTHROPIC_MTD, provider: "aws" }, /which provider/],
    [{ ...ANTHROPIC_MTD, kind: "SUBSCRIPTION" }, /what kind of figure/],
    [{ ...ANTHROPIC_MTD, amountUsd: "lots" }, /amount in dollars/],
    [{ ...ANTHROPIC_MTD, amountUsd: -3 }, /cannot be negative/],
    [{ ...ANTHROPIC_MTD, asOf: "2026-09-24" }, /cannot be after today/],
    [{ ...ANTHROPIC_MTD, asOf: "2026-02-30" }, /day you read/],
    [{ ...ANTHROPIC_MTD, source: "  " }, /where you read it/],
    [{ ...ANTHROPIC_MTD, periodEnd: null }, /billing period/],
    [{ ...ANTHROPIC_MTD, periodStart: "2026-09-30", periodEnd: "2026-09-01" }, /ends before it starts/],
    [{ provider: "openai-subscription", kind: "SUBSCRIPTION", amountUsd: 200, asOf: TODAY, source: "invoice" }, /monthly or yearly/],
    [{ provider: "dev-tools", kind: "SUBSCRIPTION", cadence: "MONTHLY", amountUsd: 20, asOf: TODAY, source: "invoice" }, /name the product/],
  ];
  for (const [input, why] of cases) {
    const checked = validateBillingFact(input, TODAY);
    assert.equal(checked.ok, false, `accepted ${JSON.stringify(input)}`);
    if (!checked.ok) assert.match(checked.why, why);
  }
});

test("a slot is provider, product, kind and period: a balance is a slot per day read, a subscription one slot", () => {
  const base = { label: null, periodStart: null, asOf: "2026-09-20" } as const;
  assert.equal(billingFactId({ ...base, provider: "brave", kind: "BALANCE" }), "brave:BALANCE:2026-09-20");
  assert.equal(billingFactId({ ...base, provider: "openai-subscription", kind: "SUBSCRIPTION" }), "openai-subscription:SUBSCRIPTION:current");
  assert.equal(
    billingFactId({ provider: "anthropic-api", label: null, kind: "BILLED", periodStart: "2026-08-01", asOf: TODAY }),
    "anthropic-api:BILLED:2026-08-01",
  );
  assert.equal(
    billingFactId({ provider: "dev-tools", label: "Claude Max", kind: "SUBSCRIPTION", periodStart: null, asOf: TODAY }),
    "dev-tools/claude-max:SUBSCRIPTION:current",
  );
});

test("the words say what kind of amount it is: a balance is left, a purchase bought, a console figure so far", () => {
  assert.equal(factAmountWords({ kind: "BALANCE", amountUsd: 28.28, cadence: null }), "$28.28 left");
  assert.equal(factAmountWords({ kind: "PURCHASE", amountUsd: 50, cadence: null }), "$50.00 bought");
  assert.equal(factAmountWords({ kind: "MONTH_TO_DATE", amountUsd: 1234.5, cadence: null }), "$1,234.50 so far");
  assert.equal(factAmountWords({ kind: "SUBSCRIPTION", amountUsd: 200, cadence: "ANNUAL" }), "$200.00 a year");
  assert.equal(
    factPeriodWords({ kind: "BALANCE", periodStart: null, periodEnd: null, cadence: null, renewsOn: null, asOf: "2026-09-20" }),
    "Balance on 2026-09-20, not a period",
  );
});

test("recording through the gateway: provenance kept, the same slot corrects, and no spending decision moves", async () => {
  const repos = createMemoryRepositories();
  await repos.adminConfig.put(
    ADMIN_CONFIG_ID,
    withFleetSpendCeiling(defaultAdminConfig(NOW), { rollingCeilingUsd: 105, previousUsd: 100, decidedAt: NOW, decidedBy: "adm_x", receiptId: "r0" }),
    NOW,
  );
  const first = await submit(record(ANTHROPIC_MTD, "billing-key-0001"), deps(repos));
  assert.equal(first.ok, true, first.receipt.says);
  assert.equal(first.receipt.subject, "anthropic-api:MONTH_TO_DATE:2026-09-01");
  assert.match(first.receipt.says, /\$173\.10 so far/);
  assert.match(first.receipt.says, /never added to them/);
  assert.equal(first.receipt.readBackAt, "/admin/money");

  const row = await repos.adminConfig.read(ADMIN_CONFIG_ID, { billingFacts: true });
  const held = billingFactsOf(row?.value ?? null);
  assert.equal(held.malformed, 0);
  assert.equal(held.facts.length, 1);
  const [fact] = held.facts;
  assert.equal(fact.decidedBy, "adm_test-session", "who, as a session reference, never a name");
  assert.equal(fact.receiptId, receiptIdFor("billing.fact.record", "billing-key-0001"));
  assert.equal(fact.source, "Anthropic Console, Cost page");
  assert.equal(row?.value.fleetSpendCeiling?.rollingCeilingUsd, 105, "the spend dial is untouched");
  assert.equal(row?.value.apiFallback.enabled, false, "paid API fallback stays off");

  const corrected = await submit(record({ ...ANTHROPIC_MTD, amountUsd: 180, asOf: TODAY }, "billing-key-0002"), deps(repos));
  assert.equal(corrected.ok, true, corrected.receipt.says);
  assert.match(corrected.receipt.says, /correcting the \$173\.10 so far/);
  const after = billingFactsOf((await repos.adminConfig.read(ADMIN_CONFIG_ID, { billingFacts: true }))?.value ?? null).facts;
  assert.equal(after.length, 1, "the same slot is corrected, never counted twice");
  assert.equal(after[0].amountUsd, 180);

  const removed = await submit(
    { type: "billing.fact.remove", subject: "a billing figure", input: { id: after[0].id }, stateVersion: null, idempotencyKey: "billing-key-0003", caller: "OWNER_SESSION", actorRef: "adm_test-session" },
    deps(repos),
  );
  assert.equal(removed.ok, true, removed.receipt.says);
  assert.match(removed.receipt.says, /no reading/);
  assert.equal(billingFactsOf((await repos.adminConfig.read(ADMIN_CONFIG_ID, { billingFacts: true }))?.value ?? null).facts.length, 0);
  assert.equal((await repos.adminConfig.read(ADMIN_CONFIG_ID, { billingFacts: true }))?.value.fleetSpendCeiling?.rollingCeilingUsd, 105);
});

test("a figure read tomorrow is refused by the gateway's own clock, and nothing is written", async () => {
  const repos = createMemoryRepositories();
  const outcome = await submit(record({ ...ANTHROPIC_MTD, asOf: "2026-09-24" }, "billing-key-0004"), deps(repos));
  assert.equal(outcome.ok, false);
  assert.match(outcome.receipt.says, /cannot be after today/);
  assert.equal(await repos.adminConfig.read(ADMIN_CONFIG_ID, { billingFacts: true }), null);
});

test("an unreadable billing slot refuses a write to that slot", async () => {
  const repos = createMemoryRepositories();
  await repos.adminConfig.put(ADMIN_CONFIG_ID, { ...defaultAdminConfig(NOW), billingFacts: [{ id: "anthropic-api:MONTH_TO_DATE:2026-09-01" } as unknown as BillingFact] }, NOW);
  const outcome = await submit(record(ANTHROPIC_MTD, "billing-key-0005"), deps(repos));
  assert.equal(outcome.ok, false);
  assert.match(outcome.receipt.says, /could not be read, so nothing was changed/);
});

/** Nothing decides anything from a billing figure: only its own module, the policy row's shape, the gateway that writes it and the Admin render path may touch it. */
test("billing figures are read only by the gateway that writes them and the Admin render path — never by the runner, the scheduler or a ceiling", () => {
  const ROOT = join(import.meta.dirname, "..");
  const allowed = new Set([
    "lib/control-plane/billing-facts.ts",
    "lib/control-plane/gateway/admin-config.ts",
    "lib/control-plane/repository/admin-config.ts",
    "lib/control-plane/gateway/registry.ts",
    "lib/control-plane/gateway/write-readback.ts",
  ]);
  const allowedPrefixes = ["app/(admin)/"];
  const scanned: string[] = [];
  const offenders: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        walk(rel);
      } else if (/\.(ts|tsx|mts|mjs|js)$/.test(entry.name)) {
        scanned.push(rel);
        const text = readFileSync(join(ROOT, rel), "utf8");
        if (/billingFacts|billing-facts/.test(text) && !allowed.has(rel) && !allowedPrefixes.some((p) => rel.startsWith(p))) offenders.push(rel);
      }
    }
  };
  for (const dir of ["lib", "scripts", "app", "components"]) walk(dir);
  assert.ok(scanned.length > 500, `the scan read only ${scanned.length} files — it did not really look`);
  assert.ok(scanned.includes("scripts/freshness-shadow.mts"), "the runner's own script was scanned");
  assert.ok(scanned.includes("lib/control-plane/fleet-safety.ts"), "the ceiling module was scanned");
  assert.ok(scanned.some((f) => f.startsWith("lib/control-plane/scheduler/")), "the scheduler was scanned");
  assert.deepEqual(offenders, [], `billing figures are read outside the gateway and the Admin render path: ${offenders.join(", ")}`);
});

test("billing history retains older figures after the displayed window grows", () => {
  let facts: readonly BillingFact[] = [];
  for (let i = 0; i < 125; i++) {
    const day = new Date(Date.parse("2026-01-01T00:00:00Z") + i * 86_400_000).toISOString().slice(0, 10);
    const fact: BillingFact = {
      id: `brave:BALANCE:${day}`,
      provider: "brave",
      label: null,
      kind: "BALANCE",
      amountUsd: 10,
      periodStart: null,
      periodEnd: null,
      cadence: null,
      renewsOn: null,
      asOf: day,
      source: "account page",
      imported: null,
      decidedAt: NOW,
      decidedBy: "adm_x",
      receiptId: `r${i}`,
    };
    facts = withFactRecorded(facts, fact).facts;
  }
  assert.equal(facts.length, 125);
  assert.equal(facts[0].asOf, "2026-01-01");
});

test("recording one billing slot preserves an unreadable entry in another slot", async () => {
  const repos = createMemoryRepositories();
  const unreadable = { id: "unrelated" } as BillingFact;
  await repos.adminConfig.put(ADMIN_CONFIG_ID, { ...defaultAdminConfig(NOW), billingFacts: [unreadable] }, NOW);
  assert.equal((await submit(record(ANTHROPIC_MTD, "billing-isolated"), deps(repos))).ok, true);
  const held = await repos.adminConfig.mustRead(ADMIN_CONFIG_ID, { billingFacts: true });
  assert.deepEqual(held.value.billingFacts?.find(fact => fact.id === unreadable.id), unreadable);
  assert.equal(billingFactsOf(held.value).facts.length, 1);
  assert.equal(billingFactsOf(held.value).malformed, 1);
});
