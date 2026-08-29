import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { test } from "node:test";

import { ROOT, tsFilesUnder } from "./read-code.ts";
import registryFile from "../lib/registry/registry.json" with { type: "json" };
import {
  checkTenantBodyBinding,
  formatBindingTable,
  formatFault,
  servingTenants,
  type RegistryView,
  type ServingTenant,
} from "../lib/ops/tenant-body-binding.ts";

/**
 * **THE BINDING RULE, OVER EVERY ADAPTER RATHER THAN OVER ONE TABLE.**
 *
 * `tests/source-adapters.test.ts` already checks that every `SOURCE_WIRING`
 * row names a real registry body. Mesa still got to production under a body
 * the registry recorded as never looked at, because Mesa is not in
 * `SOURCE_WIRING` — it is in `INSITE_TENANTS`, and `lib/sources/composite/
 * wiring.ts` builds that adapter with no arguments, so the wiring rows it
 * would have been audited by are never handed to it.
 *
 * So the rule needed a bigger denominator, and the denominator needs a guard
 * of its own — which is what the sweep below is. See
 * `lib/ops/tenant-body-binding.ts` for the rule itself.
 */

const REGISTRY: RegistryView = registryFile;

/** The one place a fault set is turned into something a person can act on. */
function report(tenants: ServingTenant[], registry: RegistryView) {
  const faults = checkTenantBodyBinding(tenants, registry);
  return { faults, table: formatBindingTable(tenants, faults) };
}

// ── The rule ──────────────────────────────────────────────────────────────

test("every serving source tenant binds to exactly one registry body", () => {
  const tenants = servingTenants();
  const { faults, table } = report(tenants, REGISTRY);

  // Printed on every run, pass or fail. A guard that speaks only when it
  // fails cannot be told apart from one whose denominator went empty.
  console.log(`\n${table}\n`);

  assert.deepEqual(
    faults.map(formatFault),
    [],
    `\n  ${faults.length} tenant(s) do not bind:\n    ${faults
      .map(formatFault)
      .join("\n    ")}\n`,
  );
});

test("the denominator is not empty, and it covers more than the shared table", () => {
  const tenants = servingTenants();
  const tables = new Set(tenants.map((t) => t.table));

  assert.ok(tenants.length > 0, "the serving-tenant denominator went empty");
  // The whole point: the adapter-owned tables are inside the denominator.
  assert.ok(tables.has("SOURCE_WIRING"));
  assert.ok(tables.has("LEGISTAR_CLIENTS"));
  assert.ok(tables.has("INSITE_TENANTS"));
});

test("Mesa binds — the body the audit questioned, checked rather than assumed", () => {
  const mesa = servingTenants().filter((t) =>
    t.bodyId.includes("state:az/place:mesa"),
  );
  // Two rows now: the InSite tenant that was already serving, and the wiring
  // row that makes the registry able to say so.
  assert.ok(mesa.length >= 2, `expected the tenant and its wiring row, got ${mesa.length}`);
  assert.deepEqual(checkTenantBodyBinding(mesa, REGISTRY).map(formatFault), []);

  const body = REGISTRY.bodies.filter(
    (b) => b.id === "ocd-division/country:us/state:az/place:mesa#governing",
  );
  assert.equal(body.length, 1, "exactly one canonical Mesa governing body");
});

// ── The denominator's own guard ───────────────────────────────────────────

test("no adapter carries a body id outside the serving-tenant denominator", () => {
  /**
   * The modules `servingTenants()` reads. A hardcoded body id anywhere else
   * under `lib/sources/` is an adapter minting an identity in a table nothing
   * audits — which is exactly how Mesa arrived, and the reason this sweep
   * exists rather than a comment asking people to remember.
   */
  const DECLARED = new Set([
    join("lib", "sources", "legistar", "clients.ts"),
    join("lib", "sources", "legistar-insite", "tenants.ts"),
  ]);

  // `tsFilesUnder` walks the whole tree, so an adapter directory somebody adds
  // is swept from the moment it exists rather than when this file is extended.
  const offenders: string[] = [];
  for (const absolute of tsFilesUnder("lib", "sources")) {
    const path = relative(ROOT, absolute).split(sep).join(sep);
    const text = readFileSync(absolute, "utf8");
    // A body-id LITERAL assigned to a bodyId field. `bodyId: row.bodyId` and
    // the interface declarations are not literals and are not the concern —
    // the concern is a table stating an identity of its own.
    if (!/bodyId:\s*\n?\s*"/.test(text)) continue;
    if (DECLARED.has(path)) continue;
    offenders.push(path);
  }

  assert.deepEqual(
    offenders,
    [],
    `\n  ${offenders.length} adapter file(s) declare a body id that no serving-tenant table\n` +
      `  exports, so nothing checks them against the registry:\n    ${offenders.join(
        "\n    ",
      )}\n  Add the table to servingTenants() in lib/ops/tenant-body-binding.ts.\n`,
  );
});

test("every adapter the composite builds with no wiring rows owns a checked table", () => {
  /**
   * `make: (rows) => …` adapters serve exactly the `SOURCE_WIRING` rows handed
   * to them, so auditing the rows audits them. `make: () => …` adapters read a
   * table of their own instead — and every one of those tables has to be in
   * the denominator or its bodies are unchecked.
   *
   * Counting them here means a THIRD zero-argument adapter fails this test on
   * the day it is registered, rather than on the day someone audits it.
   */
  const wiring = readFileSync(
    // Rooted at the repo, never at `cwd` — the denominator of a guard must not
    // depend on where the runner was invoked from.
    join(ROOT, "lib", "sources", "composite", "wiring.ts"),
    "utf8",
  );
  const zeroArg = [...wiring.matchAll(/make:\s*\(\)\s*=>/g)];
  const adapterOwned = new Set(
    servingTenants()
      .map((t) => t.table)
      .filter((t) => t !== "SOURCE_WIRING"),
  );

  assert.equal(
    zeroArg.length,
    adapterOwned.size,
    `${zeroArg.length} composite capabilities are built without wiring rows, but ` +
      `${adapterOwned.size} adapter-owned tables (${[...adapterOwned].join(", ")}) are checked. ` +
      `Every zero-argument adapter reads a table of its own; add it to servingTenants().`,
  );
});

// ── The guard can actually fail ───────────────────────────────────────────
// Each fault code is driven from a synthetic tenant against a synthetic
// registry. A guard whose failure path has never run is a guard nobody has
// checked the failure MESSAGE of, and the message is most of the value.

const SYNTHETIC: RegistryView = {
  bodies: [
    { id: "ocd-division/country:us/state:az/place:x#governing", ocdId: "ocd-division/country:us/state:az/place:x" },
    { id: "curated:az/y#governing", ocdId: null },
    { id: "ocd-division/country:us/state:az/place:twice#governing", ocdId: "ocd-division/country:us/state:az/place:twice" },
    { id: "ocd-division/country:us/state:az/place:twice#governing", ocdId: "ocd-division/country:us/state:az/place:twice" },
  ],
  divisions: [
    { ocdId: "ocd-division/country:us/state:az/place:x", state: "AZ" },
    { ocdId: "ocd-division/country:us/state:az/place:twice", state: "AZ" },
  ],
};

const tenant = (over: Partial<ServingTenant>): ServingTenant => ({
  table: "INSITE_TENANTS",
  modulePath: "lib/sources/legistar-insite/tenants.ts",
  tenant: "probe",
  bodyId: "ocd-division/country:us/state:az/place:x#governing",
  ocdId: "ocd-division/country:us/state:az/place:x",
  jurisdiction: "X, AZ",
  ...over,
});

test("a clean synthetic tenant produces no fault", () => {
  assert.deepEqual(checkTenantBodyBinding([tenant({})], SYNTHETIC), []);
  // The division-less shape passes too, on its own rules.
  assert.deepEqual(
    checkTenantBodyBinding(
      [tenant({ bodyId: "curated:az/y#governing", ocdId: null, jurisdiction: "Y, AZ" })],
      SYNTHETIC,
    ),
    [],
  );
});

test("a body id nothing in the registry carries is caught, and the message names the tenant", () => {
  const faults = checkTenantBodyBinding(
    [
      tenant({
        tenant: "ghost",
        bodyId: "ocd-division/country:us/state:az/place:ghost#governing",
        ocdId: "ocd-division/country:us/state:az/place:ghost",
      }),
    ],
    SYNTHETIC,
  );
  assert.deepEqual(faults.map((f) => f.code), ["BODY_NOT_IN_REGISTRY"]);
  const message = formatFault(faults[0]!);
  assert.match(message, /INSITE_TENANTS "ghost"/);
  assert.match(message, /lib\/sources\/legistar-insite\/tenants\.ts/);
  assert.match(message, /place:ghost#governing/);
});

test("an ambiguous body id is caught rather than resolved to whichever came last", () => {
  const faults = checkTenantBodyBinding(
    [
      tenant({
        bodyId: "ocd-division/country:us/state:az/place:twice#governing",
        ocdId: "ocd-division/country:us/state:az/place:twice",
        jurisdiction: "Twice, AZ",
      }),
    ],
    SYNTHETIC,
  );
  assert.ok(faults.some((f) => f.code === "BODY_AMBIGUOUS_IN_REGISTRY"));
  assert.match(formatFault(faults[0]!), /2 registry bodies carry this id/);
});

test("a tenant and the registry disagreeing about the division is caught", () => {
  const faults = checkTenantBodyBinding(
    [tenant({ ocdId: "ocd-division/country:us/state:az/place:twice" })],
    SYNTHETIC,
  );
  const codes = faults.map((f) => f.code);
  assert.ok(codes.includes("OCD_ID_DISAGREES_WITH_REGISTRY"));
  assert.ok(codes.includes("BODY_ID_NOT_ON_ITS_OWN_DIVISION"));
});

test("a division the registry does not have is caught", () => {
  const faults = checkTenantBodyBinding(
    [
      {
        table: "LEGISTAR_CLIENTS",
        modulePath: "lib/sources/legistar/clients.ts",
        tenant: "nowhere",
        bodyId: "ocd-division/country:us/state:az/place:nowhere#governing",
        ocdId: "ocd-division/country:us/state:az/place:nowhere",
        jurisdiction: "Nowhere, AZ",
      },
    ],
    // Body present, division absent — the one arrangement that isolates it.
    {
      bodies: [
        {
          id: "ocd-division/country:us/state:az/place:nowhere#governing",
          ocdId: "ocd-division/country:us/state:az/place:nowhere",
        },
      ],
      divisions: [],
    },
  );
  assert.deepEqual(faults.map((f) => f.code), ["DIVISION_NOT_IN_REGISTRY"]);
});

test("a tenant labelled with the wrong state is caught", () => {
  const faults = checkTenantBodyBinding(
    [tenant({ jurisdiction: "X, TX" })],
    SYNTHETIC,
  );
  assert.deepEqual(faults.map((f) => f.code), [
    "JURISDICTION_STATE_DISAGREES_WITH_DIVISION",
  ]);
  assert.match(formatFault(faults[0]!), /labelled "X, TX" but .* is in AZ/);
});

test("a division-less tenant whose id is not a curated: id is caught", () => {
  const faults = checkTenantBodyBinding(
    [
      tenant({
        bodyId: "ocd-division/country:us/state:az/place:x#governing",
        ocdId: null,
      }),
    ],
    SYNTHETIC,
  );
  const codes = faults.map((f) => f.code);
  assert.ok(codes.includes("OCD_ID_DISAGREES_WITH_REGISTRY"));
  assert.ok(codes.includes("BODY_ID_NOT_ON_ITS_OWN_DIVISION"));
});

test("the printed table lists every tenant, bound or faulted", () => {
  const rows = [tenant({}), tenant({ tenant: "wrong-state", jurisdiction: "X, TX" })];
  const table = formatBindingTable(rows, checkTenantBodyBinding(rows, SYNTHETIC));
  assert.match(table, /probe .* BOUND/);
  assert.match(table, /wrong-state .* JURISDICTION_STATE_DISAGREES_WITH_DIVISION/);
  // `[\s\S]*` rather than `.*` with the `s` flag: the summary sits on its own
  // line, and this tsconfig targets below es2018 where `s` is not available.
  assert.match(table, /2 serving tenant\(s\)[\s\S]*1 bound, 1 faulted/);
});
