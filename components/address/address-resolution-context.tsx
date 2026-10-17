"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Handlers the map provides once so any jurisdiction pill can settle the
 * reader's address without threading callbacks. Without a provider the pill
 * still opens the prompt and keeps the address and scope in `localStorage`.
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
