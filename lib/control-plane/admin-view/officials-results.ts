import { isPeopleDoor, peopleDoorCovers } from "../../doors/mission-refresh.ts";
import { listDoors, type DoorRecord } from "../../doors/registry.ts";
import type { RoutineDataStore } from "../../civic-data/store.ts";
import { OFFICIAL_ROSTER_TARGETS } from "../../sources/official-rosters/targets.ts";
import { ADMIN_RECEIPT_LOG_KEY, type ActionReceipt } from "../gateway/contract.ts";
import { OFFICIALS_CHECK_ACTION, peopleSourceUrl } from "../gateway/officials-action.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";
import { officialsLeadStatus } from "../officials-leads.ts";
import { resolveOfficialsScope, type OfficialsScope } from "./officials-scope.ts";

export const OFFICIALS_RESULTS_CONTRACT = "admin-v6/officials@1";
export interface OfficialsChange {
  readonly kind: "appointed" | "departed" | "vacant" | "changed";
  readonly name: string | null;
  readonly officeTitle: string;
  readonly divisionId: string;
  readonly sourceUrl: string | null;
  readonly since?: string | null;
}
export interface OfficialsFeedResult {
  readonly id: string;
  readonly name: string;
  readonly sourceUrl: string | null;
  readonly state: "waiting" | "checked" | "changed" | "failed" | "paused";
  readonly checkedAt: string | null;
}
export interface OfficialsResults {
  readonly placeKey: string;
  readonly requestedAt: string | null;
  readonly status: "waiting" | "working" | "done" | "failed" | "not-requested";
  readonly feeds: readonly OfficialsFeedResult[];
  readonly changes: readonly OfficialsChange[];
  readonly lead: { readonly state: "waiting" | "working" | "checked"; readonly checkedAt: string | null } | null;
}

const since = (at: string | null | undefined, start: string | null): boolean => !!at && Number.isFinite(Date.parse(at)) && (start === null || Date.parse(at) >= Date.parse(start));

/** Outcome clocks are advanced only by the runner; a requested mark or an Admin heartbeat cannot count as a check. */
export function officialsFeedResult(door: DoorRecord, requestedAt: string | null): OfficialsFeedResult {
  const success = since(door.lastSuccessAt, requestedAt);
  const failure = since(door.lastFailureAt, requestedAt);
  const failed = failure && (!success || Date.parse(door.lastFailureAt!) > Date.parse(door.lastSuccessAt!));
  const checkedAt = failed ? door.lastFailureAt : success ? door.lastSuccessAt : null;
  const state = failed ? "failed" : success ? (since(door.lastChangedAt, requestedAt) ? "changed" : "checked") : door.status !== "OPEN" ? "paused" : "waiting";
  const target = OFFICIAL_ROSTER_TARGETS.find(target => `feed:${target.id}` === door.doorId);
  const name = target?.publisher ?? (typeof door.config.publisher === "string" ? door.config.publisher :
    /openstates/.test(door.doorId) ? "Open States people mirror" : /congress-bulk/.test(door.doorId) ? "Congress people mirror" :
      door.doorId === "feed:nh-members" ? "New Hampshire General Court" : door.hosts[0] ?? "People source");
  return { id: door.doorId, name, sourceUrl: target?.routes[0] ?? peopleSourceUrl(door), state, checkedAt };
}

export async function officialsReceiptFeeds(repos: ControlPlaneRepositories, receipt: ActionReceipt): Promise<readonly OfficialsFeedResult[]> {
  const ids = receipt.openedWork.filter(work => work.kind === "people-feed").map(work => work.id);
  const rows = repos.doors.readMany ? await repos.doors.readMany(ids) : (await Promise.all(ids.map(id => repos.doors.read(id)))).filter(row => row !== null);
  const byId = new Map(rows.map(row => [row.id, row.value]));
  return ids.map(id => {
    const door = byId.get(id);
    return door ? officialsFeedResult(door, receipt.startedAt) : { id, name: "People source", sourceUrl: null, state: "waiting", checkedAt: null };
  });
}

function readChanges(payload: unknown): readonly OfficialsChange[] {
  const changes = (payload as { changes?: unknown } | null)?.changes;
  if (!Array.isArray(changes)) return [];
  return changes.filter((raw): raw is OfficialsChange => {
    const row = raw as Partial<OfficialsChange> | null;
    return row !== null && ["appointed", "departed", "vacant", "changed"].includes(String(row.kind)) &&
      (row.name === null || typeof row.name === "string") && typeof row.officeTitle === "string" && typeof row.divisionId === "string" &&
      (row.sourceUrl === null || typeof row.sourceUrl === "string");
  });
}

export async function readOfficialsResults(input: {
  readonly repos: ControlPlaneRepositories;
  readonly store: Pick<RoutineDataStore, "readPromotion" | "readCandidate">;
  readonly placeKey: string;
  readonly resolve?: (placeKey: string) => Promise<OfficialsScope>;
}): Promise<OfficialsResults | { readonly says: string }> {
  const scope = await (input.resolve ?? resolveOfficialsScope)(input.placeKey);
  if (!scope.ok) return { says: scope.says };
  const receipts = await input.repos.adminReceipts.readWhere(ADMIN_RECEIPT_LOG_KEY, ["subject"], scope.placeKey);
  const receipt = receipts.filter(row => row.type === OFFICIALS_CHECK_ACTION && row.outcome !== "REFUSED")
    .sort((a,b) => b.startedAt.localeCompare(a.startedAt))[0] ?? null;
  const doors = (await listDoors(input.repos.doors)).doors.filter(door => isPeopleDoor(door) && peopleDoorCovers(door, scope.divisions));
  const feeds = receipt === null ? doors.map(door => officialsFeedResult(door, null)) : await officialsReceiptFeeds(input.repos, receipt);
  const changes: OfficialsChange[] = [];
  if (receipt !== null) {
    const targets = OFFICIAL_ROSTER_TARGETS.filter(target => feeds.some(feed => feed.id === `feed:${target.id}`));
    const sourceScopes = [...targets.map(target => target.scope),
      ...(feeds.some(feed => feed.id === "feed:nh-members") ? ["US-NH"] : [])];
    const records = await Promise.all(sourceScopes.map(async scope => {
      const pointer = await input.store.readPromotion("STATE_LEGISLATOR", scope);
      if (pointer === null || !since(pointer.promotedAt, receipt.startedAt)) return [];
      const record = await input.store.readCandidate(pointer.versionId);
      return readChanges(record?.candidate.normalizedPayload);
    }));
    const states = scope.divisions.filter(id => /^ocd-division\/country:us\/(?:state|district|territory):[a-z]{2}$/.test(id));
    for (const rows of records) changes.push(...rows.filter(change => states.some(state => change.divisionId === state || change.divisionId.startsWith(`${state}/`))));
  }
  const leadRef = receipt?.openedWork.find(work => work.kind === "officials-lead");
  let lead: OfficialsResults["lead"] = null;
  if (leadRef) {
    lead = await officialsLeadStatus(input.repos, leadRef.id);
  }
  const waiting = feeds.filter(feed => feed.state === "waiting").length;
  const failed = feeds.some(feed => feed.state === "failed" || feed.state === "paused");
  const status = receipt === null ? "not-requested" : waiting === feeds.length ? "waiting" : waiting > 0 ? "working" : failed ? "failed" : "done";
  return { placeKey: scope.placeKey, requestedAt: receipt?.startedAt ?? null, status, feeds, changes, lead };
}
