import type { OnlineAccess } from "../sources/types.ts";

/** Online-only attendance stated in the location field. A hybrid venue keeps its physical address. */
export function publishedOnlineAccess(location: string): OnlineAccess | null {
  if (!/\b(?:virtual|zoom|webex|teams|teleconference)\b/i.test(location))
    return null;
  if (
    /\b(?:hybrid|in[- ]person|city hall|courthouse|chambers|boardroom)\b/i.test(
      location,
    ) ||
    /\b\d+\s+(?:[a-z0-9][\w.'’-]*\s+){0,8}(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd|court|ct|way|highway|hwy|parkway|pkwy|plaza)\b/i.test(
      location,
    )
  )
    return null;
  const statedUrl = /https?:\/\/[^\s<>"']+/i
    .exec(location)?.[0]
    ?.replace(/[),;.]+$/, "");
  return { label: location, joinUrl: statedUrl ?? null };
}
