import { createHash } from "node:crypto";
import type { ExpansionScopeDecision, ExpansionScopeType } from "../expansion/scopes.ts";
import type { BillingAttribution } from "../provider-billing-attribution.ts";

export const ADMIN_V6_HUNTS_CONTRACT = "admin-v6/hunts@1" as const;

export type V6PlaceScope =
  | { readonly kind: "country" }
  | { readonly kind: "state"; readonly state: string }
  | { readonly kind: "geo"; readonly state: string; readonly type: ExpansionScopeType; readonly geoid: string };

const GEO_TYPES: readonly ExpansionScopeType[] = ["zcta", "county", "congressional_district", "cbsa", "state_leg_upper", "state_leg_lower"];

export function parseV6PlaceKey(key: string): V6PlaceScope | null {
  if (key === "us") return { kind: "country" };
  const st = /^st:([a-z]{2})$/.exec(key);
  if (st) return { kind: "state", state: st[1] };
  const geo = /^geo:([a-z]{2})\.([a-z_]{4,24})\.([0-9A-Za-z]{1,16})$/.exec(key);
  if (geo && (GEO_TYPES as readonly string[]).includes(geo[2])) return { kind: "geo", state: geo[1], type: geo[2] as ExpansionScopeType, geoid: geo[3] };
  return null;
}

export type V6Period =
  | { readonly kind: "native" }
  | { readonly kind: "whole-hunt" }
  | { readonly kind: "last-24h" }
  | { readonly kind: "month"; readonly month: string };

export function parseV6Period(raw: string | null): V6Period | null {
  if (raw === null) return { kind: "native" };
  if (raw === "whole-hunt") return { kind: "whole-hunt" };
  if (raw === "last-24h") return { kind: "last-24h" };
  return /^20[2-9][0-9]-(0[1-9]|1[0-2])$/.test(raw) ? { kind: "month", month: raw } : null;
}

export interface V6Refusal {
  readonly kind: "refused";
  readonly status: 409 | 503;
  readonly code: string;
  readonly says: string;
  readonly dependency?: string;
}

export function validateV6Query(params: URLSearchParams): { readonly ok: true; readonly scopeKey: string; readonly scope: V6PlaceScope | null; readonly period: V6Period } | { readonly ok: false; readonly code: string } {
  const keys = [...params.keys()];
  if (keys.some(key => key !== "scope" && key !== "period")) return { ok: false, code: "UNKNOWN_PARAMETER" };
  if (params.getAll("scope").length !== 1 || params.getAll("period").length > 1) return { ok: false, code: "DUPLICATE_OR_MISSING_PARAMETER" };
  const scopeKey = params.get("scope") ?? "";
  if (scopeKey.length === 0 || scopeKey.length > 64) return { ok: false, code: "INVALID_SCOPE" };
  const periodText = params.get("period");
  if (periodText !== null && periodText.length > 16) return { ok: false, code: "INVALID_PERIOD" };
  const period = parseV6Period(periodText);
  if (period === null) return { ok: false, code: "INVALID_PERIOD" };
  // A body key is a real v6 place kind whose identity is not proven yet: a binding gap, not bad input.
  if (!/^(?:us|st:[a-z]{2}|geo:[a-z0-9_.A-Z]{1,56}|body:[A-Za-z0-9_.:-]{1,58})$/.test(scopeKey)) return { ok: false, code: "INVALID_SCOPE" };
  return { ok: true, scopeKey, scope: parseV6PlaceKey(scopeKey), period };
}

export function huntPlaceKey(decision: Pick<ExpansionScopeDecision, "geography">): string {
  const g = decision.geography;
  if (g.type === "state") return `st:${g.stateAbbr.toLowerCase()}`;
  return `geo:${g.stateAbbr.toLowerCase()}.${g.type}.${g.geoid}`;
}

/** Types whose areas never cross a state line. ZCTAs and metro areas can. */
const WITHIN_ONE_STATE: ReadonlySet<ExpansionScopeType> = new Set(["state", "county", "congressional_district", "state_leg_upper", "state_leg_lower"]);
/** Types with exactly one saved plan version, so two different GEOIDs are two disjoint areas. */
const SINGLE_VERSION_PARTITION: ReadonlySet<ExpansionScopeType> = new Set(["zcta", "county"]);

export type HuntRelation = "member" | "outside" | "unresolved";

/** A relation the saved geography cannot settle is `unresolved`, never guessed from breadcrumbs or a state prefix. */
export function huntRelation(scope: V6PlaceScope, decision: ExpansionScopeDecision, areaZips: ReadonlySet<string> | null = null): HuntRelation {
  const g = decision.geography;
  if (scope.kind === "country") return "member";
  if (scope.kind === "state") return g.stateAbbr.toLowerCase() === scope.state ? "member" : "outside";
  if (g.type === scope.type && g.geoid === scope.geoid && g.stateAbbr.toLowerCase() === scope.state) return "member";
  if (g.type === scope.type && g.geoid !== scope.geoid && SINGLE_VERSION_PARTITION.has(g.type)) return "outside";
  if (g.type === "zcta" && scope.type !== "zcta" && areaZips !== null) return areaZips.has(g.geoid) ? "member" : "outside";
  if (g.stateAbbr.toLowerCase() !== scope.state && WITHIN_ONE_STATE.has(g.type) && WITHIN_ONE_STATE.has(scope.type)) return "outside";
  return "unresolved";
}

export interface AdminV6HuntView {
  readonly id: string;
  readonly placeKey: string;
  readonly name: string;
  readonly startedAt: string;
  readonly limitUsd: number;
  readonly limitSource: string;
  readonly spentUsd: number;
  readonly heldUsd: number;
  /** Anthropic requests charged to this allowance with no price. Unknown, never zero dollars. */
  readonly unpricedEntries: number;
  /** "paused" when the hunt's budget is $0 or the owner has paused paid work or the runner; otherwise not reported. */
  readonly status: "unreported" | "paused";
  /** Why a paused hunt is paused, and since when: the owner's own pause wins over a $0 budget. Null when not paused. */
  readonly pause: HuntPause | null;
  readonly researchWorkers: null;
  readonly basis: "lifetime";
  readonly availableUsd: number | null;
}

/** A pause the owner set: all paid work, the whole runner, or this hunt's own budget set to $0. */
interface HuntPause {
  readonly kind: "paid-work" | "runner" | "budget";
  readonly since: string | null;
  /** The owner's own words with the pause, when they gave any. */
  readonly note: string | null;
}

/** The latest owner record for each pause action in the research intent log, as read. */
export interface OwnerPauseRecords {
  readonly PAUSE: OwnerPauseRecord | null;
  readonly RESUME: OwnerPauseRecord | null;
  readonly PAUSE_RUNNER: OwnerPauseRecord | null;
  readonly RESUME_RUNNER: OwnerPauseRecord | null;
}
export interface OwnerPauseRecord { readonly requestedAt: string; readonly note: string | null }

/** The pause in force over every hunt: the runner pause first (it stops everything), then the paid-work pause. */
export function ownerPauseOf(records: OwnerPauseRecords | null): HuntPause | null {
  if (!records) return null;
  const inForce = (pause: OwnerPauseRecord | null, resume: OwnerPauseRecord | null) =>
    pause !== null && (resume === null || resume.requestedAt < pause.requestedAt);
  if (inForce(records.PAUSE_RUNNER, records.RESUME_RUNNER)) return { kind: "runner", since: records.PAUSE_RUNNER!.requestedAt, note: records.PAUSE_RUNNER!.note };
  if (inForce(records.PAUSE, records.RESUME)) return { kind: "paid-work", since: records.PAUSE!.requestedAt, note: records.PAUSE!.note };
  return null;
}

export interface AdminV6SectionEnvelope<T> {
  readonly contract: string;
  readonly scope: string;
  readonly revision: string;
  readonly asOf: string;
  readonly data: T;
  readonly missingParts: readonly string[];
}

export interface V6MoneySources {
  readonly scopeZips?: ReadonlySet<string> | null;
  readonly scopes: readonly ExpansionScopeDecision[] | null;
  readonly malformedScopes: number;
  readonly configGap: string | null;
  readonly attribution: BillingAttribution | null | undefined;
  readonly snapshotGap: string | null;
  readonly readAt: string;
  /** The owner's paid-work and runner pauses as last recorded; null when the log was not read. */
  readonly pauses?: OwnerPauseRecords | null;
}

export type HuntAttributionRow = NonNullable<BillingAttribution["hunts"]>[number];

export function exactHuntAccounting(attribution: BillingAttribution | null | undefined, decision: ExpansionScopeDecision): HuntAttributionRow | null {
  if (!decision.budgetStartedAt) return null;
  return attribution?.hunts?.find(row => row.key === decision.key && row.receiptId === decision.receiptId &&
    row.startedAt === decision.budgetStartedAt) ?? null;
}

type CompleteRow = HuntAttributionRow & { readonly budgetConsumedKnownUsd: number; readonly budgetUnpriced: number; readonly reservedUsd: number };

function complete(row: HuntAttributionRow | null): row is CompleteRow {
  return row !== null && typeof row.budgetConsumedKnownUsd === "number" && Number.isFinite(row.budgetConsumedKnownUsd) &&
    typeof row.budgetUnpriced === "number" && typeof row.reservedUsd === "number" && Number.isFinite(row.reservedUsd);
}

const cents6 = (n: number) => Math.round(n * 1e6) / 1e6;
export const dollars = (n: number) => `$${n.toFixed(2)}`;

export function huntName(decision: Pick<ExpansionScopeDecision, "geography">): string {
  return `${decision.geography.label} hunt`;
}

function huntView(decision: ExpansionScopeDecision & { readonly budgetStartedAt: string }, row: CompleteRow, owner: HuntPause | null): AdminV6HuntView {
  const spent = cents6(row.budgetConsumedKnownUsd), held = cents6(row.reservedUsd);
  return {
    id: `${decision.key}#${decision.receiptId}`,
    placeKey: huntPlaceKey(decision),
    name: huntName(decision),
    startedAt: decision.budgetStartedAt,
    limitUsd: decision.budgetUsd,
    limitSource: decision.latestDecisionReceiptId && decision.latestDecisionReceiptId !== decision.receiptId
      ? "your latest limit change to this hunt" : "your hunt instruction",
    spentUsd: spent,
    heldUsd: held,
    unpricedEntries: row.budgetUnpriced,
    status: owner !== null || decision.budgetUsd === 0 ? "paused" : "unreported",
    pause: owner ?? (decision.budgetUsd === 0 ? { kind: "budget", since: decision.decidedAt, note: decision.note } : null),
    researchWorkers: null,
    basis: "lifetime",
    availableUsd: row.budgetUnpriced > 0 ? null : cents6(Math.max(0, decision.budgetUsd - spent - held)),
  };
}

export function sectionRevision(prefix: string, content: unknown): string {
  return `${prefix}:${createHash("sha256").update(JSON.stringify(content)).digest("hex").slice(0, 24)}`;
}

export interface ScopedHunts {
  readonly lifetime: readonly (ExpansionScopeDecision & { readonly budgetStartedAt: string })[];
  readonly rolling: readonly ExpansionScopeDecision[];
}

export function scopedHunts(scope: V6PlaceScope | null, scopeKey: string, sources: V6MoneySources): ScopedHunts | V6Refusal {
  if (scope === null) return { kind: "refused", status: 409, code: "SCOPE_BINDING_NOT_CONNECTED",
    says: `${scopeKey} is not a place this section can bind yet; governing-body identities and overlaps are not proven.`,
    dependency: "DEP-SCOPE-IDENTITIES" };
  if (sources.scopes === null) return { kind: "refused", status: 503, code: "HUNT_LIST_UNREAD",
    says: sources.configGap ?? "The saved hunt list could not be read, so hunts here are unknown." };
  if (sources.malformedScopes > 0) return { kind: "refused", status: 503, code: "HUNT_LIST_INCOMPLETE",
    says: `${sources.malformedScopes} saved scope entr${sources.malformedScopes === 1 ? "y" : "ies"} could not be read, so the hunt list is incomplete. Paid work stays refused until it is repaired.` };
  const unresolved = sources.scopes.filter(decision => huntRelation(scope, decision, sources.scopeZips ?? null) === "unresolved");
  if (unresolved.length > 0) return { kind: "refused", status: 409, code: "SCOPE_BINDING_NOT_CONNECTED",
    says: `Whether ${unresolved.map(huntName).join(", ")} reaches ${scopeKey} is not settled by saved geography. The published Census ZCTA overlap lookup is not joined to hunts yet.`,
    dependency: "DEP-SCOPE-IDENTITIES" };
  const members = sources.scopes.filter(decision => huntRelation(scope, decision, sources.scopeZips ?? null) === "member");
  return {
    lifetime: members.filter((d): d is ExpansionScopeDecision & { readonly budgetStartedAt: string } => typeof d.budgetStartedAt === "string"),
    rolling: members.filter(d => typeof d.budgetStartedAt !== "string"),
  };
}

export function rollingWords(rolling: readonly ExpansionScopeDecision[]): string | null {
  return rolling.length === 0 ? null
    : `${rolling.map(d => `${d.geography.label} (${dollars(d.budgetUsd)} per rolling 24 hours)`).join("; ")} ${rolling.length === 1 ? "has" : "have"} an older rolling 24-hour limit, not a lifetime hunt, so ${rolling.length === 1 ? "it is" : "they are"} not shown as a hunt. See Money for the limit.`;
}

/** A hunt whose accounting is not published makes the section unavailable, so an empty list always means no saved hunt here. */
export function v6HuntsSection(input: { readonly scopeKey: string; readonly scope: V6PlaceScope | null; readonly period: V6Period;
  readonly sources: V6MoneySources }): AdminV6SectionEnvelope<readonly AdminV6HuntView[]> | V6Refusal {
  if (input.period.kind === "last-24h" || input.period.kind === "month") return { kind: "refused", status: 409, code: "PERIOD_NOT_AVAILABLE",
    says: "Hunt accounting is published only as lifetime totals since each hunt started. A per-period split needs the cost ledger read by time window for each exact receipt.",
    dependency: "DEP-PERIOD" };
  const scoped = scopedHunts(input.scope, input.scopeKey, input.sources);
  if ("kind" in scoped) return scoped;
  const rows = scoped.lifetime.map(decision => ({ decision, row: exactHuntAccounting(input.sources.attribution, decision) }));
  const ready = rows.flatMap(({ decision, row }) => complete(row) ? [{ decision, row }] : []);
  const missing = rows.filter(({ row }) => !complete(row));
  if (missing.length > 0) return { kind: "refused", status: 503, code: "HUNT_ACCOUNTING_UNAVAILABLE",
    says: `${input.sources.snapshotGap ?? "The published billing attribution has no complete receipt-linked row"} for ${missing.map(({ decision }) => huntName(decision)).join(", ")}. Spent and set-aside money are unknown, not zero.`,
    dependency: "DEP-HUNTS" };
  const owner = ownerPauseOf(input.sources.pauses ?? null);
  const data = ready.map(({ decision, row }) => huntView(decision, row, owner));
  const missingParts = [
    ...(data.length > 0 && owner === null ? ["Whether paid work is running for each hunt right now, and how many research workers it has, is not published to this section."] : []),
    ...(data.length > 0 && input.sources.pauses === null ? ["Whether you have paused paid work or the runner could not be read, so a pause would not show here."] : []),
    ...data.filter(h => h.unpricedEntries > 0).map(h =>
      `${h.unpricedEntries} Anthropic request${h.unpricedEntries === 1 ? "" : "s"} charged to the ${h.name} ${h.unpricedEntries === 1 ? "has" : "have"} no price yet, so its spent amount is a lower bound and the amount left is unknown.`),
    ...(data.length > 1 ? ["A request shared by overlapping hunts counts against each hunt's own limit. Hunt figures are never added together."] : []),
    ...(rollingWords(scoped.rolling) === null ? [] : [rollingWords(scoped.rolling)!]),
    ...(input.scope?.kind === "state" ? ["Hunts are listed under the state their saved Census lookup files them in. A ZIP or metro area that crosses a state line is listed only there."] : []),
  ];
  const attribution = input.sources.attribution;
  const asOf = data.length > 0 && attribution ? attribution.readAt : input.sources.readAt;
  return { contract: ADMIN_V6_HUNTS_CONTRACT, scope: input.scopeKey,
    revision: sectionRevision("hunts", { data, missingParts, asOf: data.length > 0 ? asOf : null }),
    asOf, data, missingParts };
}
