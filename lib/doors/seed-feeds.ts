/**
 * The non-meeting feeds as registry records: the daily automatic refresh tasks
 * and every routine source contract each get a door with a kind, a key
 * reference where the feed needs one, what it holds, and how often it is
 * checked. Pure mapping.
 */

import { AUTOMATIC_REFRESH_CONTRACT_IDS } from "../civic-data/automatic-refresh.ts";
import { ROUTINE_SOURCE_CONTRACTS } from "../civic-data/contracts.ts";
import { requiredManualProductionContract } from "../civic-data/manual-contracts.ts";
import { sourceAuthority } from "../civic-data/source-authority.ts";
import { FIPS_TO_STATE } from "../ocd/fips.ts";
import { OFFICIAL_ROSTER_TARGETS } from "../sources/official-rosters/targets.ts";
import { applyDerivedRow, checkDoorDraft, feedDoorId, isDoorRecord, normalizeHost, upsertDerivedDoor, type DoorDraft, type DoorRepository } from "./registry.ts";

const MINUTE = 60_000;

/** The environment key name a feed reads, where it needs one. Names only, never values. */
const KEY_REFS: ReadonlyArray<readonly [RegExp, string]> = [
  [/fec/i, "FEC_API_KEY"],
  [/congress|federal-legislative/i, "CONGRESS_API_KEY"],
];

export function keyRefFor(...ids: readonly string[]): string | null {
  for (const [pattern, ref] of KEY_REFS) if (ids.some((id) => pattern.test(id))) return ref;
  return null;
}

function hostsFor(sourceId: string, requestedUrl: string | null): string[] {
  const urls: string[] = [];
  if (requestedUrl) urls.push(requestedUrl);
  for (const prefix of sourceAuthority(sourceId)?.routePrefixes ?? []) urls.push(prefix);
  const hosts = new Set<string>();
  for (const url of urls) {
    const host = normalizeHost(url);
    if (host !== null) hosts.add(host);
  }
  return [...hosts].sort();
}

const holdsOf = (recordClass: string): string => recordClass.toLowerCase().replace(/_/g, "-");

interface FeedInput {
  readonly id: string;
  readonly sourceId: string;
  readonly recordClass: string;
  readonly scope: string;
  readonly requestedUrl: string | null;
  readonly command: readonly string[];
  readonly everyMs: number | null;
  readonly refresh: "automatic" | "routine";
  readonly authorityMode: string;
}

function draftFor(feed: FeedInput): DoorDraft {
  const keyRef = feed.id === "congress-bulk-roster" ? null : keyRefFor(feed.id, feed.sourceId);
  const official = OFFICIAL_ROSTER_TARGETS.find(target => target.id === feed.id);
  return {
    doorId: feedDoorId(feed.id),
    kind: feed.authorityMode === "DERIVED" ? "derived-feed" : "source-feed",
    ocdId: peopleFeedDivision(feed.recordClass, feed.scope),
    bodyIds: [],
    hosts: official ? [...new Set(official.routes.flatMap(url => normalizeHost(url) ?? []))].sort() : hostsFor(feed.sourceId, feed.requestedUrl),
    config: {
      contractId: feed.id,
      sourceId: feed.sourceId,
      scope: feed.scope,
      refresh: feed.refresh,
      command: feed.command.join(" "),
      ...(feed.requestedUrl ? {sourceUrl: feed.requestedUrl} : {}),
      ...(keyRef === null ? {} : { keyRef }),
    },
    holds: [holdsOf(feed.recordClass)],
    checkEveryMinutes: feed.everyMs === null ? null : Math.max(5, Math.round(feed.everyMs / MINUTE)),
    notes: `${feed.refresh === "automatic" ? "Daily automatic refresh" : "Routine source contract"} for ${feed.scope}.`,
    status: "OPEN",
    readNow: false,
  };
}

/** A people source covers a jurisdiction, including places within it. */
export function peopleFeedDivision(recordClass: string, scope: string): string | null {
  if (recordClass !== "STATE_LEGISLATOR" && recordClass !== "FEDERAL_DIRECTORY") return null;
  if (recordClass === "FEDERAL_DIRECTORY" || scope === "US" || scope.startsWith("US:")) return "ocd-division/country:us";
  const postal = /^US-([A-Z]{2})(?:$|:)/.exec(scope)?.[1];
  const entry = Object.values(FIPS_TO_STATE).find(row => row.postal === postal);
  return entry ? `ocd-division/country:us/${entry.prefix}:${entry.postal.toLowerCase()}` : null;
}

/** Every non-meeting feed the system runs on a clock today, one draft each, in contract order. */
export function feedDoorDrafts(): DoorDraft[] {
  const feeds = new Map<string, FeedInput>();
  for (const contract of ROUTINE_SOURCE_CONTRACTS) {
    const adapter = contract.acquisitionAdapter;
    feeds.set(contract.id, {
      id: contract.id,
      sourceId: contract.sourceId,
      recordClass: contract.recordClass,
      scope: contract.scope,
      requestedUrl: adapter.authorityMode === "SINGLE_ROUTE" ? adapter.requestedUrl : OFFICIAL_ROSTER_TARGETS.find(target => target.id === contract.id)?.routes[0] ?? null,
      command: adapter.command,
      everyMs: contract.cadence.defaultEveryMs,
      refresh: "routine",
      authorityMode: adapter.authorityMode,
    });
  }
  for (const id of AUTOMATIC_REFRESH_CONTRACT_IDS) {
    const contract = requiredManualProductionContract(id);
    feeds.set(id, {
      id,
      sourceId: contract.sourceId,
      recordClass: contract.recordClass,
      scope: contract.scope,
      requestedUrl: null,
      command: contract.command,
      everyMs: 24 * 60 * MINUTE,
      refresh: "automatic",
      authorityMode: "REGISTERED_SOURCE_ROUTES",
    });
  }
  return [...feeds.values()].map(draftFor);
}

/** Known people contracts must be usable on the first check, before the next general door derivation. */
export async function ensurePeopleFeedDoors(input: {
  readonly repo: DoorRepository;
  readonly divisions: readonly string[];
  readonly at: string;
}): Promise<{ created: number; updated: number; unchanged: number }> {
  const counts = { created: 0, updated: 0, unchanged: 0 };
  const drafts = feedDoorDrafts().filter(draft => draft.ocdId &&
    draft.holds?.some(hold => hold === "state-legislator" || hold === "federal-directory" || hold === "statewide-official") &&
    input.divisions.some(division => division === draft.ocdId || division.startsWith(`${draft.ocdId}/`) || division.startsWith(`${draft.ocdId}#`) || draft.ocdId!.startsWith(`${division}/`) || draft.ocdId!.startsWith(`${division}#`)));
  for (const draft of drafts) {
    const checked = checkDoorDraft(draft);
    if (!checked.ok) throw new Error(`DOOR_DRAFT_INVALID: ${checked.why}`);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        let row = await input.repo.read(draft.doorId);
        if (row === null) {
          const created = await input.repo.put(draft.doorId, applyDerivedRow(null, checked.value, input.at, input.at)!, input.at);
          if (created.created) { counts.created++; break; }
          row = created.persisted;
        }
        if (!isDoorRecord(row.value)) throw new Error(`DOOR_RECORD_INVALID: ${draft.doorId}`);
        if (row.value.ocdId === checked.value.ocdId) { counts.unchanged++; break; }
        // Coverage is intrinsic to the registered contract, not an edit or a new read-now request.
        // Keep both clocks: updating them here could spend or renew an older deliberate check.
        await input.repo.compareAndSet(draft.doorId, row.revision, { ...row.value, ocdId: checked.value.ocdId }, row.updatedAt);
        counts.updated++;
        break;
      } catch (error) {
        if (attempt === 1) throw error;
      }
    }
  }
  return counts;
}

export async function seedFeedDoors(input: {
  readonly repo: DoorRepository;
  readonly deriveInputAt: string;
  readonly at: string;
}): Promise<{ created: number; updated: number; unchanged: number; keptManualEdit: number; refused: readonly string[] }> {
  const counts = { created: 0, updated: 0, unchanged: 0, keptManualEdit: 0 };
  const refused: string[] = [];
  for (const draft of feedDoorDrafts()) {
    try {
      const result = await upsertDerivedDoor(input.repo, draft, input.deriveInputAt, input.at);
      if (result === "kept-manual-edit") counts.keptManualEdit += 1;
      else counts[result] += 1;
    } catch (error) {
      refused.push(`${draft.doorId}: ${(error as Error).message}`);
    }
  }
  return { ...counts, refused };
}
