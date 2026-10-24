import { createOfficeLocator, type OfficePoint } from "./office-locator.ts";

const locate = createOfficeLocator();
export function officePointFor(address: string): Promise<OfficePoint | null> {
  const worker = typeof window === "undefined" ? undefined : window.__readerBoundary;
  return worker ? (worker.request({ kind: "office", url: "/api/geocode", address }) as Promise<OfficePoint | null>).catch(() => null) : locate(address);
}
