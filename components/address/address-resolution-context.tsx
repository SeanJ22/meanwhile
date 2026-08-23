"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * **What happens when a reader settles their address, wherever they settle it.**
 * (`JUR-2` / `PU04`, 2026-08-23.)
 *
 * ## Why a context and not four more props
 *
 * The jurisdiction badge renders on three surfaces — the meeting popup, the
 * meeting panel and the list overlay — and every one of them is several
 * components deep inside the map shell. Threading two callbacks down three
 * paths would mean touching a dozen component signatures for a button, and
 * every one of those signatures is a place a future surface forgets to pass
 * them and gets a pill that opens a prompt and then does nothing. **That is
 * the exact defect `WGH-2` was adopted over: the old pill was dead, and
 * clicking it did nothing at all.**
 *
 * So the map provides the two handlers once, and any badge anywhere reads
 * them. A surface that renders the pill cannot forget to wire it, because
 * there is nothing to wire.
 *
 * ## Both handlers, and why the first one is the real one
 *
 * `onPoint` is what makes the answer change. It moves the QUERY point, so the
 * meetings, the officials, the district overlays and every badge re-resolve
 * from the server's next response rather than from anything this component
 * decided. `onResolved` is the lighter half — the narrowing has been applied,
 * turn on the district layers that now mean something.
 *
 * Absent provider means absent handlers, and the pill still opens the prompt
 * and still writes the reader's answer to `sessionStorage`, which is what the
 * ballot page reads. Degraded, never broken.
 */
export interface AddressResolutionHandlers {
  /** The street resolved to a point. Fires only on an unambiguous street. */
  onPoint?: (point: { lat: number; lng: number; street: string }) => void;
  /** The reader's jurisdiction picture changed. */
  onResolved?: (scope: { divisionIds: string[]; contestIds: string[] }) => void;
  /** The reader asked to go back to the whole zip. */
  onCleared?: () => void;
}

const AddressResolutionContext = createContext<AddressResolutionHandlers>({});

export function AddressResolutionProvider({
  value,
  children,
}: {
  value: AddressResolutionHandlers;
  children: ReactNode;
}) {
  return (
    <AddressResolutionContext.Provider value={value}>
      {children}
    </AddressResolutionContext.Provider>
  );
}

export function useAddressResolution(): AddressResolutionHandlers {
  return useContext(AddressResolutionContext);
}
