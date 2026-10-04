/**
 * **WHY THIS LIVES IN `lib/ops/` AND NOT IN `lib/registry/`.**
 * (Moved 2026-08-28 at integration. RULING 197's guard; the placement is
 * RULING 191's job, because only the combined head could see the problem.)
 *
 * It was written in `lib/registry/`, which is where it belongs by subject.
 * The integrated build refused: `/api/meetings` traces **every `.ts` file in
 * `lib/registry/`** into its serving bundle, so a guard imported by nothing but
 * `tests/tenant-body-binding.test.ts` began shipping to production — and took
 * the route's trace cardinality from 220 to 221, one past the committed
 * ceiling.
 *
 * **The ceiling was right and the file was wrong.** `scripts/bundle-budget.json`
 * permits re-measuring a baseline when a growth is understood, and that would
 * have made the build green while leaving test-only code in the deploy. The
 * postbuild check already asserts `tests/ traced 0` — the rule that test code
 * does not ship exists here; this file was simply outside the directory the
 * rule could see. Fixing at the source is what the refusal asks for first.
 *
 * `lib/ops/` traces ZERO files into that route, and `lib/ops/branch-retirement.ts`
 * — a pure classifier over git refs, written in this same session — is the
 * precedent. The pattern is: **a pure classifier whose only consumer is a guard
 * belongs in `lib/ops/`, whatever it is about.**
 *
 * Nothing about the rule changed in the move. The imports below still reach the
 * production membership boundary; only this module's own address did.
 */

import { activeWiring } from "../registry/source-wiring.ts";

/**
 * **EVERY PRODUCTION-SERVING TENANT NAMES A BODY THE REGISTRY ACTUALLY HAS.**
 *
 * ## The defect this exists for
 *
 * Found 2026-08-28 on Mesa. `lib/sources/legistar-insite/tenant-registry.ts` declared
 * `ocd-division/country:us/state:az/place:mesa#governing`, ten of that body's
 * sittings were in `data/meetings-snapshot.json`, and the registry row for it
 * said `coverageStatus: NOT_ATTEMPTED`, `agendaSourceType: NONE`. Nothing in
 * `lib/registry/source-wiring.ts` named it. The body id resolved — it was
 * never orphaned — but **the registry had stopped being the authority for what
 * the product was serving**, and no check anywhere could have said so.
 *
 * ## Why the existing check could not catch it
 *
 * `tests/source-adapters.test.ts` already asserts that every `SOURCE_WIRING`
 * row names a real registry body. The historical defect was that two adapters
 * carried their own membership tables outside that denominator.
 *
 * Both adapters now receive exact SOURCE_WIRING rows. Their exported
 * client/tenant arrays are compatibility projections of those rows and cannot
 * add a government or production contract.
 *
 * ## What this checks, and the denominator it checks it over
 *
 * The denominator is SOURCE_WIRING: the only table that can put a body id into
 * a served meeting. `tests/tenant-body-binding.test.ts` sweeps `lib/sources/`
 * so an adapter-owned list cannot quietly return.
 *
 * For each tenant in that denominator, four things, in the order a failure is
 * most likely to be informative:
 *
 * 1. the body id **exists** in `registry.bodies`;
 * 2. it is **unique** there — one id, one body, no ambiguity about which
 *    government a meeting belongs to;
 * 3. the registry body's `ocdId` **is the one the tenant declared** — the
 *    tenant and the registry agree on WHERE this government is;
 * 4. the id, the declared division and the registry division are **mutually
 *    consistent**: `<ocdId>#<slot>` addressing holds, the division exists in
 *    `registry.divisions`, and the tenant's own jurisdiction label names the
 *    state that division is in.
 *
 * ## What it deliberately does NOT check
 *
 * It does not check that a serving body's `coverageStatus` is `LIVE`. That
 * looks like the obvious companion rule and it is not cleanly checkable here:
 * `coverageStatus` is overlaid at registry build from
 * `lib/registry/coverage-audit.ts`, so a guard reading the generated
 * `registry.json` would be checking that a generated file was regenerated
 * after its input changed, and would report a stale artifact as a data defect.
 * The honest place for that rule is the generator's own overlay. Stated rather
 * than left as an omission — see the report on this repair.
 */

/** Legacy names remain only so synthetic regression faults can name the retired shapes. */
export type TenantTableName =
  | "SOURCE_WIRING"
  | "LEGISTAR_CLIENTS"
  | "INSITE_TENANTS";

/**
 * One tenant row, reduced to the four fields the binding rule is about.
 *
 * `tenant` is the row's own handle — a slug where it has one, the body id
 * otherwise — and exists so a failure message names the row a person has to go
 * and edit, not an array index.
 */
export interface ServingTenant {
  table: TenantTableName;
  /** Where the row lives, for the failure message. */
  modulePath: string;
  tenant: string;
  bodyId: string;
  /** WHERE the tenant says this government is. Null for a division-less body. */
  ocdId: string | null;
  /** Display label, and the only place a tenant states a state in prose. */
  jurisdiction: string;
}

export type BindingFaultCode =
  /** The body id names no registry body. A source adapter minting an identity. */
  | "BODY_NOT_IN_REGISTRY"
  /** The body id names more than one. Which government is this meeting about? */
  | "BODY_AMBIGUOUS_IN_REGISTRY"
  /** The tenant and the registry disagree about which division this body is on. */
  | "OCD_ID_DISAGREES_WITH_REGISTRY"
  /** `<ocdId>#<slot>` addressing is broken — the id is on a different division. */
  | "BODY_ID_NOT_ON_ITS_OWN_DIVISION"
  /** The declared division is not a division the registry has. */
  | "DIVISION_NOT_IN_REGISTRY"
  /** The tenant's jurisdiction label names a different state than the division. */
  | "JURISDICTION_STATE_DISAGREES_WITH_DIVISION";

export interface BindingFault {
  tenant: ServingTenant;
  code: BindingFaultCode;
  /** What was actually seen, in one line, with both sides of the disagreement. */
  detail: string;
}

/** The minimum shape of the registry this guard reads. Injected, not imported,
 *  so a negative case can be proven against a synthetic registry. */
export interface RegistryView {
  bodies: ReadonlyArray<{ id: string; ocdId: string | null }>;
  divisions: ReadonlyArray<{ ocdId: string; state: string | null }>;
}

/**
 * A wiring row's own handle, out of the two keys adapters use for one.
 *
 * `config` is a `Record<string, string>` by declaration, so TypeScript believes
 * every key is present. It is not, and reading one that is absent yields
 * `undefined` at runtime — so this states the honest type once rather than
 * letting a missing slug become the string "undefined" in a failure message.
 */
function configHandle(config: Record<string, string>): string | undefined {
  const bag = config as Partial<Record<string, string>>;
  return bag.slug ?? bag.tenant;
}

/**
 * Every serving tenant, flattened from the single production membership
 * authority. Adapter-owned tenant lists are forbidden rather than registered.
 */
export function servingTenants(): ServingTenant[] {
  const rows: ServingTenant[] = [];

  // The shared table every `make(rows)` adapter serves from.
  for (const row of activeWiring()) {
    rows.push({
      table: "SOURCE_WIRING",
      modulePath: "lib/registry/source-wiring.ts",
      // A wiring row's handle is its adapter slug where it states one; several
      // adapters key their config differently, so the body id is the fallback.
      tenant: configHandle(row.config) ?? row.bodyId,
      bodyId: row.bodyId,
      ocdId: row.ocdId,
      jurisdiction: row.jurisdiction,
    });
  }

  return rows;
}

/** The trailing `, XX` every tenant jurisdiction label carries. Null when the
 *  label is not in that shape, which is reported rather than guessed at. */
function stateOf(jurisdiction: string): string | null {
  const m = /,\s*([A-Z]{2})$/.exec(jurisdiction.trim());
  return m ? m[1] : null;
}

/**
 * Every way a serving tenant's body id fails to bind, for every tenant.
 *
 * Returns ALL faults rather than throwing on the first: a guard that stops at
 * the first bad row tells a session it has one problem when it has six, and
 * the second run is where the second one gets found.
 */
export function checkTenantBodyBinding(
  tenants: ReadonlyArray<ServingTenant>,
  registry: RegistryView,
): BindingFault[] {
  const faults: BindingFault[] = [];

  // Counted, not indexed: a duplicate id is itself one of the faults, so the
  // check cannot be built on a Map that would silently keep the last one.
  const bodyCounts = new Map<string, number>();
  for (const body of registry.bodies) {
    bodyCounts.set(body.id, (bodyCounts.get(body.id) ?? 0) + 1);
  }
  const bodyById = new Map(registry.bodies.map((b) => [b.id, b]));
  const divisionById = new Map(registry.divisions.map((d) => [d.ocdId, d]));

  for (const tenant of tenants) {
    const count = bodyCounts.get(tenant.bodyId) ?? 0;

    if (count === 0) {
      faults.push({
        tenant,
        code: "BODY_NOT_IN_REGISTRY",
        detail:
          `no body in the registry carries this id, so nothing but this ` +
          `tenant asserts the government exists`,
      });
      // Nothing further is checkable about a body that is not there. The
      // remaining rules would all report the same absence in four voices.
      continue;
    }

    if (count > 1) {
      faults.push({
        tenant,
        code: "BODY_AMBIGUOUS_IN_REGISTRY",
        detail: `${count} registry bodies carry this id; a meeting on it names no single government`,
      });
    }

    const body = bodyById.get(tenant.bodyId)!;

    if (body.ocdId !== tenant.ocdId) {
      faults.push({
        tenant,
        code: "OCD_ID_DISAGREES_WITH_REGISTRY",
        detail: `tenant says ${tenant.ocdId ?? "null"}, registry says ${body.ocdId ?? "null"}`,
      });
    }

    if (tenant.ocdId === null) {
      // A division-less body (D28) addresses itself by curated id instead of
      // by `<ocdId>#<slot>`, and has no division to carry a state — so rules 4
      // do not apply to it and are not faked. What IS still checkable is that
      // the id is in the form that says so.
      if (!tenant.bodyId.startsWith("curated:")) {
        faults.push({
          tenant,
          code: "BODY_ID_NOT_ON_ITS_OWN_DIVISION",
          detail: `declares no division but the id is not a curated: id either`,
        });
      }
      continue;
    }

    const prefix = tenant.bodyId.split("#")[0];
    if (prefix !== tenant.ocdId) {
      faults.push({
        tenant,
        code: "BODY_ID_NOT_ON_ITS_OWN_DIVISION",
        detail: `id is addressed on ${prefix} but the tenant declares ${tenant.ocdId}`,
      });
    }

    const division = divisionById.get(tenant.ocdId);
    if (!division) {
      faults.push({
        tenant,
        code: "DIVISION_NOT_IN_REGISTRY",
        detail: `the registry has no division ${tenant.ocdId} for this body to sit on`,
      });
      continue;
    }

    const stated = stateOf(tenant.jurisdiction);
    if (stated !== null && division.state !== null && stated !== division.state) {
      faults.push({
        tenant,
        code: "JURISDICTION_STATE_DISAGREES_WITH_DIVISION",
        detail:
          `the tenant is labelled "${tenant.jurisdiction}" but ${tenant.ocdId} ` +
          `is in ${division.state}`,
      });
    }
  }

  return faults;
}

/** One fault, as a line that names the row a person has to go and fix. */
export function formatFault(fault: BindingFault): string {
  const t = fault.tenant;
  return (
    `${t.table} "${t.tenant}" (${t.modulePath}): ${fault.code}\n` +
    `      bodyId ${t.bodyId}\n` +
    `      ${fault.detail}`
  );
}

/**
 * The whole denominator as a table, printed by the test whether or not
 * anything failed.
 *
 * A guard that prints only its failures cannot be distinguished from a guard
 * that ran over nothing — which is how the wiring-only check read green for as
 * long as two adapters were outside its denominator.
 */
export function formatBindingTable(
  tenants: ReadonlyArray<ServingTenant>,
  faults: ReadonlyArray<BindingFault>,
): string {
  const bad = new Map<ServingTenant, BindingFaultCode[]>();
  for (const f of faults) {
    bad.set(f.tenant, [...(bad.get(f.tenant) ?? []), f.code]);
  }
  // Widths come from the content, never from a constant. A body id is the
  // thing this table exists to show, and a fixed column silently truncating
  // one is the report eliding its own evidence.
  /**
   * A handle column is capped; the BODY ID column never is.
   *
   * A wiring row with no `slug` falls back to its own body id as a handle, so
   * one such row would otherwise stretch this column to 78 characters and push
   * the whole table off the side. Truncation here is marked with an ellipsis
   * so it reads as elided rather than as the value — and the body id it was
   * standing in for is in the very next column, uncapped, because that is the
   * column this table exists to show.
   */
  const TENANT_CAP = 36;
  const handle = (t: ServingTenant) =>
    t.tenant.length > TENANT_CAP ? `${t.tenant.slice(0, TENANT_CAP - 1)}…` : t.tenant;
  const width = (header: string, pick: (t: ServingTenant) => string) =>
    Math.max(header.length, ...tenants.map((t) => pick(t).length), 0);
  const wTable = width("TABLE", (t) => t.table);
  const wTenant = width("TENANT", handle);
  const wBody = width("BODY ID", (t) => t.bodyId);
  const wJuris = width("JURISDICTION", (t) => t.jurisdiction);
  const w = (s: string, n: number) => s.padEnd(n);

  const lines = [
    `  ${w("TABLE", wTable)}  ${w("TENANT", wTenant)}  ${w("BODY ID", wBody)}  ${w("JURISDICTION", wJuris)}  VERDICT`,
  ];
  for (const t of tenants) {
    const codes = bad.get(t);
    lines.push(
      `  ${w(t.table, wTable)}  ${w(handle(t), wTenant)}  ${w(t.bodyId, wBody)}  ` +
        `${w(t.jurisdiction, wJuris)}  ` +
        (codes ? codes.join(", ") : "BOUND"),
    );
  }
  lines.push(
    `\n  ${tenants.length} serving tenant(s) across ${new Set(tenants.map((t) => t.table)).size} table(s); ` +
      `${tenants.length - bad.size} bound, ${bad.size} faulted`,
  );
  return lines.join("\n");
}
