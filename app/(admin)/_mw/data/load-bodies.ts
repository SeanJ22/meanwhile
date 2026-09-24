import "server-only";

/**
 * The watched-body read for a page: the compiled meeting contracts joined to
 * the narrow production read (`body-store.ts`), projected by the pure model.
 * A failed read is UNREAD with its reason — never an empty body list.
 */
import { MEETING_PARTITION_CONTRACTS } from "@/lib/civic-data/meeting-partitions.ts";
import { buildBodyViews, type BodyView, type PublicZip, type WatchedContract } from "@/lib/control-plane/admin-view/bodies.ts";
import { lowestZipByDivision } from "@/lib/geo/zip-division-index.ts";

import { readBodyStore } from "./body-store.ts";
import { ADMIN_READ_DEADLINE_MS, lateWords, sharedRead } from "./shared-read.ts";

export type BodiesRead =
  | { readonly kind: "HELD"; readonly asOf: string; readonly views: readonly BodyView[] }
  | { readonly kind: "UNREAD"; readonly detail: string };

type AnyContract = (typeof MEETING_PARTITION_CONTRACTS)[number];

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

export function watchedContractOf(c: AnyContract): WatchedContract {
  const wiring = (c as unknown as { wiring?: Record<string, unknown> }).wiring ?? {};
  const config = (wiring.config ?? {}) as Record<string, unknown>;
  return {
    id: c.id,
    scope: c.scope,
    bodyId: c.bodyId,
    ocdId: text(c.ocdId),
    meetingSource: String(c.meetingSource),
    jurisdiction: text(wiring.jurisdiction),
    publishingOrg: text(wiring.publishingOrg),
    sourceUrl: text(config.baseUrl) ?? text(config.url) ?? text(config.calendarUrl) ?? text(config.icsUrl),
    verifiedAt: text(wiring.verifiedAt),
    cadence: c.cadence,
    retry: c.retry,
  };
}

export const WATCHED_CONTRACTS: readonly WatchedContract[] = MEETING_PARTITION_CONTRACTS.map(watchedContractOf);

/*
 * A ZIP whose readers are served each division, from the national ZIP index —
 * the public destination a body's meetings reach (`/?zip=`). The lowest ZIP is
 * taken so the link is stable; a division no indexed ZIP carries has no
 * destination to name, and a state whose index could not be read says so.
 */
function stateOf(ocdId: string): string | null {
  return /\/(?:state|district|territory):([a-z]{2})(?:\/|$|#)/.exec(ocdId)?.[1] ?? null;
}

async function zipsFor(contracts: readonly WatchedContract[]): Promise<(ocdId: string | null) => PublicZip> {
  const states = [...new Set(contracts.map((c) => (c.ocdId === null ? null : stateOf(c.ocdId))).filter((s): s is string => s !== null))];
  const byState = new Map(await Promise.all(states.map(async (st) => [st, await lowestZipByDivision(st)] as const)));
  return (ocdId) => {
    if (ocdId === null) return { kind: "NONE" };
    const st = stateOf(ocdId);
    const index = st === null ? undefined : byState.get(st);
    if (index === null) return { kind: "UNREAD" };
    if (index === undefined) return { kind: "NONE" };
    // A body's division, or the nearest enclosing division the index carries (a place inside a county).
    let id = ocdId.split("#")[0];
    while (id.includes("/")) {
      const hit = index.get(id);
      if (hit) return { kind: "ZIP", zip: hit };
      id = id.slice(0, id.lastIndexOf("/"));
    }
    return { kind: "NONE" };
  };
}

/*
 * A minute fresh, five minutes recent (see shared-read.ts): a body's standing
 * moves on the runner's clock, not on a click, and every page names the time
 * its bodies were read.
 */
const shared = sharedRead<BodiesRead>({
  freshMs: 60_000,
  staleMs: 5 * 60_000,
  deadlineMs: ADMIN_READ_DEADLINE_MS,
  keep: (r) => r.kind === "HELD",
  late: (ms) => ({ kind: "UNREAD", detail: lateWords("The body read", ms) }),
});

export async function loadWatchedBodies(nowIso: string): Promise<BodiesRead> {
  return shared.read(() => readWatchedBodies(nowIso));
}

async function readWatchedBodies(nowIso: string): Promise<BodiesRead> {
  const connection = process.env.DATABASE_URL?.trim() ?? "";
  if (connection === "") {
    return {
      kind: "UNREAD",
      detail: "This Admin runtime has no connection to the routine civic-data store, so no body was read. That is not the same as having no bodies.",
    };
  }
  try {
    const [store, zipOf] = await Promise.all([readBodyStore(connection, nowIso), zipsFor(WATCHED_CONTRACTS)]);
    return { kind: "HELD", asOf: store.asOf, views: buildBodyViews({ contracts: WATCHED_CONTRACTS, store, nowIso, zipOf }) };
  } catch (error) {
    // Server log only: a driver error can carry the connection string, so the page gets the class name alone.
    console.error("[admin] watched-body read failed", error instanceof Error ? `${error.name}: ${error.message.replace(/postgres(ql)?:\/\/\S+/gi, "<connection>")}` : error);
    return {
      kind: "UNREAD",
      detail: `The body read did not complete (${error instanceof Error ? error.name : "error"}). No body count is claimed until it does.`,
    };
  }
}
