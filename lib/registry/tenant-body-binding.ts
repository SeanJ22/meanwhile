import { LEGISTAR_CLIENTS } from "../sources/legistar/clients.ts";
import { INSITE_TENANTS } from "../sources/legistar-insite/tenants.ts";
import { SOURCE_WIRING } from "./source-wiring.ts";

/**
 * **EVERY PRODUCTION-SERVING TENANT NAMES A BODY THE REGISTRY ACTUALLY HAS.**
 *
 * ## The defect this exists for
 *
 * Found 2026-08-28 on Mesa. `lib/sources/legistar-insite/tenants.ts` declared
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
 * row names a real registry body. That is the right rule applied to the wrong
 * denominator: it audits the shared wiring table, and **two adapters do not
 * read the shared wiring table at all.**
 *
 * `lib/sources/composite/wiring.ts` builds most adapters as `make(rows)` —
 * they serve exactly the bodies the wiring rows hand them, so auditing the
 * rows audits them. But it builds two with no arguments:
 *
 * ```
 * make: () => legistarReporting                   // reads LEGISTAR_CLIENTS
 * make: () => makeLegistarInSiteSource()          // reads INSITE_TENANTS
 * ```
 *
 * Both predate `SOURCE_WIRING` and keep their own tables. The capability is
 * switched on by `wiringForTypes(["LEGISTAR"]).length === 0` being false —
 * which one row satisfies for the whole type — and after that the adapter's
 * own table decides which governments the product publishes. A row added to
 * either table is a government added to the product, with nothing in between.
 *
 * ## What this checks, and the denominator it checks it over
 *
 * The denominator is `SERVING_TENANT_TABLES`: **every table anywhere in the
 * repo that can put a body id into a served meeting**, the shared one and the
 * adapter-owned ones alike. `tests/tenant-body-binding.test.ts` sweeps
 * `lib/sources/` for hardcoded body-id literals and fails if a table appears
 * that is not listed here, so the guard cannot quietly go stale the way the
 * wiring-only check did.
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

/** A table that can put a body id into a meeting the product serves. */
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
 * Every serving tenant table, flattened.
 *
 * **Adding an adapter that keeps its own tenant list means adding a row
 * here.** The sweep in `tests/tenant-body-binding.test.ts` is what makes that
 * an obligation rather than a hope.
 */
export function servingTenants(): ServingTenant[] {
  const rows: ServingTenant[] = [];

  // The shared table every `make(rows)` adapter serves from.
  for (const row of SOURCE_WIRING) {
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

  // Legistar's WebAPI clients. Built as `() => legistarReporting`, so these
  // rows reach production without passing through SOURCE_WIRING.
  for (const client of LEGISTAR_CLIENTS) {
    rows.push({
      table: "LEGISTAR_CLIENTS",
      modulePath: "lib/sources/legistar/clients.ts",
      tenant: client.slug,
      bodyId: client.bodyId,
      ocdId: client.ocdId,
      jurisdiction: client.jurisdiction,
    });
  }

  // The InSite portal tenants. Built as `() => makeLegistarInSiteSource()`,
  // same story — and the table Mesa arrived through.
  for (const tenant of INSITE_TENANTS) {
    rows.push({
      table: "INSITE_TENANTS",
      modulePath: "lib/sources/legistar-insite/tenants.ts",
      tenant: tenant.slug,
      bodyId: tenant.bodyId,
      ocdId: tenant.ocdId,
      jurisdiction: tenant.jurisdiction,
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
