import "server-only";

/**
 * What every redesigned page does first: read the scope from the URL, open the
 * control plane, read the owner's policy row (for the selected geographies the
 * scope filter lists) and which states have a promoted registration (for what
 * the filter calls each state), name the readiness standard in force (for the
 * strip), and stamp the one instant the page reads at.
 */
import { openControlPlane, readAdminConfig } from "@/lib/control-plane/admin-data.ts";
import type { RegistrationPointers } from "@/lib/control-plane/admin-view/promoted-slices.ts";
import { expansionScopesOf, type ExpansionScopeDecision } from "@/lib/control-plane/expansion/scopes.ts";
import type { AdminConfig } from "@/lib/control-plane/gateway/admin-config.ts";
import { standardInForce } from "@/lib/control-plane/readiness/standard.ts";
import type { ControlPlaneRepositories } from "@/lib/control-plane/repository/types.ts";

import { loadContainer } from "./data/geography.ts";
import { loadRegistrationPointers } from "./data/registration.ts";
import { shellScope, type ShellScope } from "./load-shell.ts";
import { geographyShortLabel, parseScope, withScope, type MwScope } from "./scope.ts";

export type SearchParams = Record<string, string | string[] | undefined>;

interface PageBaseCommon {
  readonly nowIso: string;
  readonly scope: MwScope;
  readonly shell: ShellScope;
  readonly adminConfig: AdminConfig | null;
  readonly selected: readonly ExpansionScopeDecision[];
  /** Entries on the policy row that are not readable scopes (paid work is held while any exist). */
  readonly malformedScopes: number;
  /** Which states have a promoted registration, as this page read it. */
  readonly registration: RegistrationPointers;
  /**
   * The readiness standard in force, from its versioned manifest — what every
   * page's strip names, unless a page says what its own readings were measured
   * under. Null only when the manifest names no version in force.
   */
  readonly standard: string | null;
  /** The page's own path with its query, for the scope select. */
  readonly here: string;
}

/**
 * Either the control plane opened, or it did not and the reason is carried —
 * never an unopened store with no reason, so a page's refusal always says why.
 */
export type PageBase = PageBaseCommon &
  (
    | { readonly repos: ControlPlaneRepositories; readonly controlPlaneGap: null }
    | { readonly repos: null; readonly controlPlaneGap: string }
  );

export function param(sp: SearchParams, key: string): string | null {
  const v = sp[key];
  const one = Array.isArray(v) ? v[0] : v;
  return typeof one === "string" && one.trim() !== "" ? one.trim() : null;
}

async function openWithConfig(): Promise<{ readonly opened: Awaited<ReturnType<typeof openControlPlane>>; readonly adminConfig: AdminConfig | null }> {
  const opened = await openControlPlane();
  if (!opened.ok) return { opened, adminConfig: null };
  const cfg = await readAdminConfig(opened.repos);
  return { opened, adminConfig: cfg.kind === "HELD" ? cfg.value : null };
}

/**
 * `nowIso` lets a page start a read that needs only the instant (the body read)
 * before this one, so the policy row's round trip is not added in front of it.
 */
export async function openPage(path: string, sp: SearchParams, nowIso: string = new Date().toISOString()): Promise<PageBase> {
  const scope = parseScope(sp.scope);
  // The registration pointers are read beside the control plane, never after it: one small read the page does not wait on twice.
  const [{ opened, adminConfig }, registration] = await Promise.all([openWithConfig(), loadRegistrationPointers()]);
  const { scopes, malformed } = expansionScopesOf(adminConfig);
  // A geography reached by link that is not on the selected list is named from the Census lookup, never shown as a bare code.
  let lookedUpLabel: string | null = null;
  if (scope.kind === "geo" && !scopes.some((d) => d.geography.type === scope.type && d.geography.geoid === scope.geoid)) {
    const found = await loadContainer(scope.type, scope.geoid);
    if (found.kind === "HELD") lookedUpLabel = geographyShortLabel(found.value.geography.label);
  }
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    const one = Array.isArray(v) ? v[0] : v;
    if (typeof one === "string" && k !== "scope") query.set(k, one);
  }
  const q = query.toString();
  const common: PageBaseCommon = {
    nowIso,
    scope,
    shell: shellScope(scope, scopes, registration, lookedUpLabel),
    adminConfig,
    selected: scopes,
    malformedScopes: malformed,
    registration,
    standard: standardInForce(),
    here: withScope(q === "" ? path : `${path}?${q}`, scope),
  };
  return opened.ok ? { ...common, repos: opened.repos, controlPlaneGap: null } : { ...common, repos: null, controlPlaneGap: opened.detail };
}
