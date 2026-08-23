/**
 * **SYNTHETIC-RUN IDENTIFICATION NEVER LEAVES OUR ORIGIN** — RULING 101,
 * 2026-08-23.
 *
 * ## Two findings, one line of code, and only one of them was closed
 *
 * `VF02` (NJ Hunt 6) found that Playwright's `extraHTTPHeaders` applies to
 * EVERY request a context makes, third parties included. MapTiler's CORS
 * preflight does not allow `x-wtp-synthetic-run`, so the basemap style request
 * was refused **in every capture and every walk this repo has ever taken** —
 * which is why NJ Hunt 5's photographs showed *Basemap unavailable* while its
 * 371 checks were green. Both were honest. They were looking at different
 * pages, because the instrument was breaking the thing it was measuring.
 *
 * That finding was fixed. The SECOND one was recorded and not enforced: **our
 * run identifier was crossing our origin to every third-party host the page
 * touched.** Nothing sensitive leaked — a run id names a walk, not a person —
 * but a header identifying our infrastructure arriving at hosts we do not
 * control is the wrong shape for a product whose central claim is that its
 * stores share no joinable column. It is exactly the kind of thing that is
 * true only until somebody adds a host.
 *
 * ## Why this is a module and not four lines inside the harness
 *
 * It was four lines inside the harness, and four lines inside a harness are
 * remembered rather than enforced: nothing failed if they were deleted, and
 * nothing could test them without launching a browser. Here they are a pure
 * function over `(requestUrl, frameUrl, headers)` that a unit test can walk
 * across every third-party host the app actually talks to.
 *
 * `scripts/browser.mts` calls this and `tests/origin-confinement.test.ts`
 * asserts that it does, so removing the call fails the build.
 *
 * ## Failing safe means not leaking, never leaking to be safe
 *
 * An unparseable URL, an opaque frame, `about:blank` — every one of them is
 * treated as CROSS-origin and stripped. The cost of over-stripping is that one
 * of our own rows lands `ORGANIC` and is visible as such in the census. The
 * cost of under-stripping is a header we cannot recall from a host we do not
 * own. Those are not symmetrical.
 */

/** The headers a walk adds to declare itself. Lower-cased on the way in. */
export type MarkerHeaders = Readonly<Record<string, string>>;

export type ConfinementVerdict =
  /** Same origin as the page that asked for it — the marker travels. */
  | "SAME_ORIGIN_KEPT"
  /** A different origin — every marker header is removed. */
  | "CROSS_ORIGIN_STRIPPED"
  /**
   * Neither URL could be parsed into an origin. Stripped, and named separately
   * so a report can tell "we know it was third-party" from "we could not
   * tell" — the same distinction `CANNOT_RUN` keeps apart from `ZERO_ROWS`.
   */
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

/**
 * Decide what headers one request may carry.
 *
 * `requestUrl` is where the request is going. `frameUrl` is the page that
 * asked for it — our origin, when the walk is walking our site.
 */
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

/**
 * True where this request may carry the marker at all. The cheap form, for a
 * caller that only needs the decision.
 */
export function marksTravel(requestUrl: string, frameUrl: string): boolean {
  const target = originOf(requestUrl);
  const page = originOf(frameUrl);
  return target !== null && page !== null && target === page;
}

/**
 * **The third-party hosts this product's pages actually reach.**
 *
 * Not a decorative list: `tests/origin-confinement.test.ts` walks every one of
 * them and asserts the marker is stripped, so the guard has a stated
 * denominator rather than one example. **Append-only** — a host that stops
 * being used costs nothing to keep asserting about, and removing one is how a
 * later leak goes unnoticed.
 *
 * MapTiler is first because it is the one that broke, and the two font hosts
 * are here because a style document can pull glyphs from either.
 */
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
