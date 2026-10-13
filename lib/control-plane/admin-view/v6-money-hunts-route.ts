import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE } from "../admin-auth.ts";
import { openControlPlane, readAdminConfig, readFleetSafety } from "../admin-data.ts";
import { expansionScopesOf } from "../expansion/scopes.ts";
import { guardAdminRequest } from "../gateway/admin-guard.ts";
import type { OwnerSnapshot } from "../owner-surface.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";
import { RESEARCH_INTENT_LOG_KEY } from "../scheduler/research-policy.ts";
import type { AdminV6SectionEnvelope, OwnerPauseRecord, OwnerPauseRecords, V6MoneySources, V6Period, V6PlaceScope, V6Refusal } from "./v6-hunts-read.ts";
import { validateV6Query } from "./v6-hunts-read.ts";
import { readAreaZips } from "./v6-national-geography.ts";

const NO_STORE = { "cache-control": "private, no-store, no-cache, must-revalidate" };

export type V6MoneySnapshotFields = Pick<OwnerSnapshot, "publishedAt" | "billingAttribution" | "providerBilling">;

export interface V6ReadSources extends V6MoneySources {
  readonly providerBilling: OwnerSnapshot["providerBilling"] | undefined;
  readonly fleetSafety: { readonly rolling24Hours: { readonly modelUsd: number | null; readonly asOf: string; readonly worstCaseCharges?: number };
    readonly bounds: { readonly rolling24HourModelUsd: number } } | null;
  readonly fleetSafetyGap: string | null;
  readonly adminConfig: Parameters<typeof expansionScopesOf>[0] & { readonly fleetSpendCeiling?: unknown } | null;
}

const PAUSE_ACTIONS = ["PAUSE", "RESUME", "PAUSE_RUNNER", "RESUME_RUNNER"] as const;

/** The latest owner intent for each pause action: four one-row reads, never the whole log. Null when unreadable. */
export async function readOwnerPauses(repos: Pick<ControlPlaneRepositories, "researchIntents">): Promise<OwnerPauseRecords | null> {
  try {
    const latest = await Promise.all(PAUSE_ACTIONS.map(async (action) => {
      // The runner's HONORED record repeats the action; only the owner's INTENT says when and why.
      const rows = await repos.researchIntents.readRecentWhere(RESEARCH_INTENT_LOG_KEY, ["action"], action, 4, { kind: true, requestedAt: true, note: true });
      const intent = rows.find((row): row is { kind: "INTENT"; requestedAt: string; note?: unknown } =>
        typeof row === "object" && row !== null && (row as { kind?: unknown }).kind === "INTENT" && typeof (row as { requestedAt?: unknown }).requestedAt === "string");
      return intent ? { requestedAt: intent.requestedAt, note: typeof intent.note === "string" && intent.note.trim() ? intent.note.trim() : null } satisfies OwnerPauseRecord : null;
    }));
    return { PAUSE: latest[0], RESUME: latest[1], PAUSE_RUNNER: latest[2], RESUME_RUNNER: latest[3] };
  } catch {
    return null;
  }
}

export async function readV6Sources(repos: ControlPlaneRepositories, readAt: string, withSafety: boolean, scope: V6PlaceScope | null = null): Promise<V6ReadSources> {
  const [config, snapshot, safety, scopeZips, pauses] = await Promise.all([
    readAdminConfig(repos),
    repos.ownerSnapshots.readNarrowed("current", { publishedAt: true, billingAttribution: true, providerBilling: true })
      .then(row => ({ ok: true as const, value: (row?.value ?? null) as V6MoneySnapshotFields | null }), () => ({ ok: false as const, value: null })),
    withSafety ? readFleetSafety(repos) : Promise.resolve(null),
    readAreaZips(scope),
    readOwnerPauses(repos),
  ]);
  const parsed = config.kind === "STORE_UNREACHABLE" ? null : expansionScopesOf(config.kind === "HELD" ? config.value : null);
  const fleet = safety?.kind === "HELD" ? safety.value.fleetSafety ?? null : null;
  return {
    scopeZips,
    scopes: parsed?.scopes ?? null,
    malformedScopes: parsed?.malformed ?? 0,
    configGap: config.kind === "STORE_UNREACHABLE" ? config.detail : null,
    adminConfig: config.kind === "HELD" ? config.value : null,
    attribution: snapshot.value?.billingAttribution,
    providerBilling: snapshot.value?.providerBilling,
    snapshotGap: !snapshot.ok ? "The published owner snapshot could not be read"
      : snapshot.value === null ? "No owner snapshot has been published"
        : snapshot.value.billingAttribution == null ? "The published owner snapshot carries no billing attribution" : null,
    fleetSafety: fleet ? { rolling24Hours: fleet.rolling24Hours, bounds: { rolling24HourModelUsd: fleet.bounds.rolling24HourModelUsd } } : null,
    fleetSafetyGap: !withSafety ? null : safety?.kind === "HELD" ? (fleet ? null : "The fleet safety state carries no rolling spend reading.")
      : safety?.detail ?? "The fleet safety state was not read.",
    readAt,
    pauses,
  };
}

export async function v6MoneyHuntsGet(request: NextRequest, options: {
  readonly withSafety: boolean;
  readonly project: (input: { readonly scopeKey: string; readonly scope: V6PlaceScope | null; readonly period: V6Period; readonly sources: V6ReadSources }) => AdminV6SectionEnvelope<unknown> | V6Refusal;
  /** Test seam: the control plane. Production opens it from the environment. */
  readonly open?: () => ReturnType<typeof openControlPlane>;
}): Promise<NextResponse> {
  const guard = await guardAdminRequest({ headers: request.headers,
    cookie: request.cookies.get(ADMIN_SESSION_COOKIE)?.value, checkOrigin: false,
    nowSeconds: Math.floor(Date.now() / 1000) });
  if (!guard.ok) return guard.status === 404 ? new NextResponse(null, { status: 404, headers: NO_STORE })
    : NextResponse.json({ says: guard.says }, { status: guard.status, headers: NO_STORE });
  const query = validateV6Query(request.nextUrl.searchParams);
  if (!query.ok) return NextResponse.json({ code: query.code }, { status: 400, headers: NO_STORE });
  const opened = await (options.open ?? openControlPlane)();
  if (!opened.ok) return NextResponse.json({ state: "UNREAD", code: "CONTROL_PLANE_UNREAD", says: opened.detail },
    { status: 503, headers: NO_STORE });
  const readAt = new Date().toISOString();
  const sources = await readV6Sources(opened.repos, readAt, options.withSafety, query.scope);
  const out = options.project({ scopeKey: query.scopeKey, scope: query.scope, period: query.period, sources });
  if ("kind" in out) return NextResponse.json({ code: out.code, says: out.says, ...(out.dependency ? { dependency: out.dependency } : {}) },
    { status: out.status, headers: NO_STORE });
  return NextResponse.json(out, { headers: NO_STORE });
}
