/**
 * The address the reader typed and its resolved scope (districts, contest ids,
 * and ZIP) stay in localStorage on this device until the reader presses
 * "Forget this address". The map, ballot and Ask show the remembered address
 * and use the same scope. The address goes only to the Census geocoder lookup;
 * no street, house number or coordinates are written to our database.
 */

import {
  commitStorageWrite,
  publishToListeners,
  subscribeToStorage,
} from "@/lib/state/subscribe-to-storage";
import type { GeographySelection } from "../census-geography/selection.ts";

/** The one key. Named so it is greppable and so nothing else claims it. */
export const SESSION_ADDRESS_KEY = "wtp.session_address_scope";

/**
 * Same-tab subscribers. `localStorage` fires `storage` only in other tabs,
 * so the two writers here publish to local listeners themselves.
 */
const listeners = new Set<() => void>();

export function subscribeToSessionAddress(onStoreChange: () => void): () => void {
  return subscribeToStorage(listeners, onStoreChange);
}

/** Tell every subscriber the scope moved. Called by both writers, always. */
function publish(): void {
  publishToListeners(listeners);
}

export interface SessionAddressScope {
  selection?: GeographySelection;
  /** The zip the address was resolved inside. */
  zip: string;
  /** Contest ids on the ballot at that point. The whole payload's value. */
  contestIds: string[];
  /** Only these proven exclusions can hide a contest. */
  excludedContestIds?: string[];
  /** The full address the reader typed, kept only on their device. */
  streetLabel: string;
  /** The division ids the address confirmed, across every level that resolved. */
  divisionIds: string[];
  /** Reader-facing district names returned by the address lookup. */
  divisionLabels?: string[];
  /**
   * Levels the street genuinely crosses, so a surface can keep hedging exactly
   * those rows and nothing else. Partial ambiguity resolves partially.
   */
  splitLevels: string[];
  /** When it was resolved, so a surface can say "you told us this" honestly. */
  resolvedAt: string;
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    // Private modes and webviews can throw on access.
    return null;
  }
}

/** Read the device's remembered address scope, or null. Never throws. */
export function readSessionAddress(): SessionAddressScope | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(SESSION_ADDRESS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SessionAddressScope>;
    if (
      (parsed as { scopeVersion?: unknown }).scopeVersion !== 3 ||
      typeof parsed.zip !== "string" ||
      !Array.isArray(parsed.contestIds) ||
      typeof parsed.streetLabel !== "string" ||
      typeof parsed.resolvedAt !== "string"
    ) {
      return null;
    }
    return {
      zip: parsed.zip,
      ...(parsed.selection ? { selection: parsed.selection } : {}),
      contestIds: parsed.contestIds.filter((id): id is string => typeof id === "string"),
      excludedContestIds: Array.isArray(parsed.excludedContestIds) ? parsed.excludedContestIds.filter((id): id is string => typeof id === "string") : [],
      divisionIds: Array.isArray(parsed.divisionIds)
        ? parsed.divisionIds.filter((id): id is string => typeof id === "string")
        : [],
      divisionLabels: Array.isArray(parsed.divisionLabels)
        ? parsed.divisionLabels.filter((label): label is string => typeof label === "string")
        : [],
      splitLevels: Array.isArray(parsed.splitLevels)
        ? parsed.splitLevels.filter((id): id is string => typeof id === "string")
        : [],
      streetLabel: parsed.streetLabel,
      resolvedAt: parsed.resolvedAt,
    };
  } catch {
    return null;
  }
}

/** Write it. `resolvedAt` records the lookup time without limiting its lifetime. */
export function writeSessionAddress(scope: Omit<SessionAddressScope, "resolvedAt">): void {
  const store = storage();
  if (!store) return;
  // `commitStorageWrite` writes, then publishes either way; a refused store
  // costs the reader a second prompt, never an error.
  commitStorageWrite(
    () =>
      store.setItem(
        SESSION_ADDRESS_KEY,
        JSON.stringify({ scopeVersion: 3, zip: scope.zip, contestIds: scope.contestIds,
          excludedContestIds: scope.excludedContestIds ?? [], divisionIds: scope.divisionIds, splitLevels: scope.splitLevels,
          divisionLabels: scope.divisionLabels ?? [], streetLabel: scope.streetLabel, resolvedAt: new Date().toISOString(),
          ...(scope.selection ? { selection: scope.selection } : {}) }),
      ),
    publish,
  );
}

/** Forget it on this device, and widen every surface. */
export function clearSessionAddress(): void {
  const store = storage();
  if (!store) return;
  // Clearing widens every surface, not just the control clicked.
  commitStorageWrite(() => store.removeItem(SESSION_ADDRESS_KEY), publish);
}

/**
 * Does the device hold an address that answers for this zip? An address in
 * one zip answers nothing about another.
 */
export function sessionAddressFor(zip: string | null, selection?: GeographySelection): SessionAddressScope | null {
  if (!zip) return null;
  const scope = readSessionAddress();
  if (!scope || scope.zip !== zip || (scope.selection?.purpose ?? "representation") !== (selection?.purpose ?? "representation")) return null;
  // A remembered address stays until it is forgotten; only a different election asks again.
  if (selection?.purpose === "election" && scope.selection?.electionDate !== selection.electionDate) return null;
  return scope;
}
