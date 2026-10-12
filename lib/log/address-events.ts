"use client";

import { logEvent } from "./client";
import { getOrCreateBrowserKey } from "../state/browser-key";

export type ReaderPage = "MAP" | "BALLOT" | "ASK";

/** Send only the ZIP and full district set; the typed address stays on the device. */
export function logAddressEntered(
  scope: { zip: string; divisionIds: string[] },
  page: ReaderPage,
): void {
  logEvent("ADDRESS_ENTERED", scope.divisionIds, { page }, scope.zip,
    getOrCreateBrowserKey("wtp.ask_key"));
}

export function readerPageForPath(pathname: string): ReaderPage {
  return pathname.startsWith("/ballot") ? "BALLOT" : pathname.startsWith("/ask") ? "ASK" : "MAP";
}
