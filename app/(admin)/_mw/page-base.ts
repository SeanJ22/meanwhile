import "server-only";

/**
 * What every redesigned page does first: read the scope from the URL, open the
 * control plane, read the owner's policy row (for the selected geographies the
 * scope filter lists), and stamp the one instant the page reads at.
 */
import { openControlPlane, readAdminConfig } from "@/lib/control-plane/admin-data.ts";
import { expansionScopesOf, type ExpansionScopeDecision } from "@/lib/control-plane/expansion/scopes.ts";
import type { AdminConfig } from "@/lib/control-plane/gateway/admin-config.ts";
import type { ControlPlaneRepositories } from "@/lib/control-plane/repository/types.ts";

import { loadContainer } from "./data/geography.ts";
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

/**
 * `nowIso` lets a page start a read that needs only the instant (the body read)
 * before this one, so the policy row's round trip is not added in front of it.
 */
export async function openPage(path: string, sp: SearchParams, nowIso: string = new Date().toISOString()): Promise<PageBase> {
  const scope = parseScope(sp.scope);
  const opened = await openControlPlane();
  let adminConfig: AdminConfig | null = null;
  if (opened.ok) {
    const cfg = await readAdminConfig(opened.repos);
    adminConfig = cfg.kind === "HELD" ? cfg.value : null;
  }
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
    shell: shellScope(scope, scopes, lookedUpLabel),
    adminConfig,
    selected: scopes,
    malformedScopes: malformed,
    here: withScope(q === "" ? path : `${path}?${q}`, scope),
  };
  return opened.ok ? { ...common, repos: opened.repos, controlPlaneGap: null } : { ...common, repos: null, controlPlaneGap: opened.detail };
}
