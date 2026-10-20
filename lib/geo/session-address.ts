import {
  commitStorageWrite,
  publishToListeners,
  subscribeToStorage,
} from "@/lib/state/subscribe-to-storage";
import type { GeographySelection } from "../census-geography/selection.ts";

/** The one key. Named so it is greppable and so nothing else claims it. */
export const SESSION_ADDRESS_KEY = "wtp.session_address_scope";

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
  /** What the reader typed for the street, for their own recognition only. */
  streetLabel: string;
  /** The division ids the address confirmed, across every level that resolved. */
  divisionIds: string[];

  splitLevels: string[];
  /** When it was resolved, so a surface can say "you told us this" honestly. */
  resolvedAt: string;
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    // A browser refusing storage can still resolve an address for the open view.
    return null;
  }
}

/** Read the remembered address scope, or null. Never throws. */
export function readSessionAddress(): SessionAddressScope | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(SESSION_ADDRESS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SessionAddressScope>;
    if (
      typeof parsed.zip !== "string" ||
      !Array.isArray(parsed.contestIds) ||
      typeof parsed.resolvedAt !== "string"
    ) {
      return null;
    }
    return {
      zip: parsed.zip,
      ...(parsed.selection ? { selection: parsed.selection } : {}),
      contestIds: parsed.contestIds.filter((id): id is string => typeof id === "string"),
      divisionIds: Array.isArray(parsed.divisionIds)
        ? parsed.divisionIds.filter((id): id is string => typeof id === "string")
        : [],
      splitLevels: Array.isArray(parsed.splitLevels)
        ? parsed.splitLevels.filter((id): id is string => typeof id === "string")
        : [],
      streetLabel: typeof parsed.streetLabel === "string" ? parsed.streetLabel : "",
      resolvedAt: parsed.resolvedAt,
    };
  } catch {
    return null;
  }
}

/** Remember the street and resolved scope until the reader chooses to forget it. */
export function writeSessionAddress(scope: Omit<SessionAddressScope, "resolvedAt">): void {
  const store = storage();
  if (!store) return;
  // `commitStorageWrite` writes, then publishes either way; a refused store
  // costs the reader a second prompt, never an error.
  commitStorageWrite(
    () =>
      store.setItem(
        SESSION_ADDRESS_KEY,
        JSON.stringify({ ...scope, resolvedAt: new Date().toISOString() }),
      ),
    publish,
  );
}

/** Forget the address and widen every subscribed surface to the whole ZIP. */
export function clearSessionAddress(): void {
  const store = storage();
  if (!store) return;
  // Clearing widens every surface, not just the control clicked.
  commitStorageWrite(() => store.removeItem(SESSION_ADDRESS_KEY), publish);
}

export function sessionAddressFor(zip: string | null, selection?: GeographySelection): SessionAddressScope | null {
  if (!zip) return null;
  const scope = readSessionAddress();
  if (!scope || scope.zip !== zip || (scope.selection?.purpose ?? "representation") !== (selection?.purpose ?? "representation")) return null;
  if (selection && (scope.selection?.asOf !== selection.asOf || scope.selection?.electionDate !== selection.electionDate)) return null;
  return scope;
}
