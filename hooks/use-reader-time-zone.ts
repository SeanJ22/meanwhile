"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};
const readerZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const serverZone = () => null;

/** Browser time is read after hydration, so server UTC is never shown as local. */
export function useReaderTimeZone(): string | null {
  return useSyncExternalStore(subscribe, readerZone, serverZone);
}
