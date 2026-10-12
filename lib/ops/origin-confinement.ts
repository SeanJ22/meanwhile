/** Synthetic-run identification never leaves our origin: marker headers are stripped from every third-party request. */

/** The headers a walk adds to declare itself. Lower-cased on the way in. */
export type MarkerHeaders = Readonly<Record<string, string>>;

export type ConfinementVerdict =
  /** Same origin as the page that asked for it — the marker travels. */
  | "SAME_ORIGIN_KEPT"
  /** A different origin — every marker header is removed. */
  | "CROSS_ORIGIN_STRIPPED"
  /** Neither URL parsed into an origin: stripped, and named apart from a known third party. */
  | "UNKNOWN_ORIGIN_STRIPPED";

export interface Confinement {
  verdict: ConfinementVerdict;
  /** The headers to actually send. */
  headers: Record<string, string>;
  /** Which marker names were removed, for a report or a test to name. */
  removed: string[];
}

function originOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    // `about:blank`, `data:` and `blob:` all parse. None of them is an origin
    // we can vouch for, so none of them keeps the marker.
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

/** Decide what headers one request may carry; `frameUrl` is the page that asked for it. */
export function confine(
  requestUrl: string,
  frameUrl: string,
  requestHeaders: Readonly<Record<string, string>>,
  markers: MarkerHeaders,
): Confinement {
  const names = Object.keys(markers).map((n) => n.toLowerCase());
  const strip = (): Confinement => {
    const headers: Record<string, string> = {};
    const removed: string[] = [];
    for (const [name, value] of Object.entries(requestHeaders)) {
      if (names.includes(name.toLowerCase())) {
        removed.push(name.toLowerCase());
        continue;
      }
      headers[name] = value;
    }
    return { verdict: "CROSS_ORIGIN_STRIPPED", headers, removed };
  };

  const target = originOf(requestUrl);
  const page = originOf(frameUrl);
  if (target === null || page === null) {
    return { ...strip(), verdict: "UNKNOWN_ORIGIN_STRIPPED" };
  }
  if (target !== page) return strip();
  return {
    verdict: "SAME_ORIGIN_KEPT",
    headers: { ...requestHeaders },
    removed: [],
  };
}

/** Whether this request may carry the marker at all. */
export function marksTravel(requestUrl: string, frameUrl: string): boolean {
  const target = originOf(requestUrl);
  const page = originOf(frameUrl);
  return target !== null && page !== null && target === page;
}

/** The third-party hosts this product's pages reach; append-only, each asserted stripped by a test. */
export const THIRD_PARTY_HOSTS: ReadonlyArray<string> = [
  "https://api.maptiler.com",
  "https://tiles.maptiler.com",
  "https://fonts.googleapis.com",
  "https://fonts.gstatic.com",
  "https://tile.openstreetmap.org",
  "https://www.openstreetmap.org",
  "https://x.com",
  "https://facebook.com",
  "https://instagram.com",
  "https://youtube.com",
  "https://mastodon.social",
  "https://api.congress.gov",
  "https://api.open.fec.gov",
  "https://en.wikipedia.org",
];
