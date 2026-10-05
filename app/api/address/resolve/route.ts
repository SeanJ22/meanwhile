import {
  zipThisAddressResolvesTo,
  locateAddressInZip,
  sampleStreetPoints,
} from "@/lib/geo/census-geocoder";
import {
  resolveAddress,
  type AddressResolution,
  type Sample,
} from "@/lib/geo/address-resolution";
import { divisionsAt } from "@/lib/registry/server";
import { contestsForDivisions } from "@/lib/sources/ballot-nj-morris";
import { readerBallotSourcesForDivisions } from "@/lib/ballot/reader-sources";

/**
 * `POST /api/address/resolve` — **the one address resolver for the whole
 * product.** (WGH-5, 2026-08-22, the author's 8/22 walkthrough, item 9.)
 *
 * A street and a zip go in. What comes back is which jurisdictions the reader
 * is CONFIRMED to be in, level by level, and which levels their street
 * genuinely crosses — plus, on an unambiguous street only, the street's
 * midpoint so the map can re-centre. On an ambiguous street no point comes
 * back at all, because there is not one to give.
 *
 * ## Why the whole thing runs on the server
 *
 * The previous shape geocoded in the browser through `/api/geocode`, then sent
 * the resolved POINT to `/api/ballot/scope`. That works, and it means the
 * reader's coordinates exist in their own page's memory and travel twice.
 *
 * Here the browser sends a street name and a zip — which is what it already
 * puts in a form field — and receives division ids. One request answers what
 * used to take two, and the browser never holds a HOUSE, only the midpoint of a
 * street it can already see on the map.
 *
 * ## What is stored: nothing
 *
 * No log row (this route never calls `logEvent`), no store, no cache, no
 * console line carrying an address. `no-store`, for the D40 reason production
 * already broke once by serving one campaign's books for three politicians: an
 * answer that is per-reader by construction must never sit in a shared cache.
 *
 * **The house number is used and dropped.** It is read from the request body,
 * spent on one geocode, and never written down — not returned, not logged, not
 * put in the response. The caller drops it too (see the shared prompt
 * component). Item 9.6.
 *
 * ## The three answers
 *
 * - `RESOLVED` — every level the reader's street touches has one answer.
 * - `AMBIGUOUS` — one or more levels are genuinely split, named individually,
 *   with the confirmed levels still confirmed. **Partial ambiguity resolves
 *   partially** (item 9.5): the page is never held hostage to one level.
 * - `FAILED` — we could not place the street. A fact about our lookup, and it
 *   is worded as one everywhere it renders.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = {
  "cache-control": "no-store, no-cache, must-revalidate",
} as const;

function bad(): Response {
  return Response.json({ ok: false }, { status: 400, headers: NO_STORE });
}

/** Contest ids for a confirmed division set — the ballot page's narrowing. */
async function contestIdsFor(ocdIds: readonly string[]): Promise<string[]> {
  if (ocdIds.length === 0) return [];
  for (const { source } of await readerBallotSourcesForDivisions(ocdIds)) {
    const candidate = source.normalize(await source.fetch());
    const hit = contestsForDivisions(candidate, [...ocdIds]);
    if (hit.contests.length > 0 || hit.absences.length > 0) {
      return hit.contests.map((c) => c.id);
    }
  }
  return [];
}

export async function POST(request: Request) {
  let zip = "";
  let street = "";
  let houseNumber = "";
  try {
    const body = (await request.json()) as {
      zip?: unknown;
      street?: unknown;
      houseNumber?: unknown;
    };
    zip = typeof body.zip === "string" ? body.zip.trim() : "";
    street = typeof body.street === "string" ? body.street.trim() : "";
    houseNumber = typeof body.houseNumber === "string" ? body.houseNumber.trim() : "";
  } catch {
    return bad();
  }

  // Validity checks, not rate limits — closed shapes, real bounds, and never
  // behind a flag. A 60-character street is a paste accident or an attack.
  if (!/^\d{5}$/.test(zip)) return bad();
  if (street.length < 3 || street.length > 120) return bad();
  if (houseNumber.length > 12) return bad();

  /*
   * With a house number there is ONE point and nothing to average, so every
   * level is certain by construction. Without one, the street is sampled at
   * several low numbers and the divisions are compared.
   */
  const points: { lat: number; lng: number }[] = [];
  if (houseNumber.length > 0) {
    const point = await locateAddressInZip(houseNumber, street, zip);
    if (point) points.push({ lat: point.lat, lng: point.lng });
  } else {
    points.push(...(await sampleStreetPoints(street, zip)));
  }

  if (points.length === 0) {
    /*
     * ── BAL-38 ── **ASK WHERE IT DOES RESOLVE, before saying we could not
     * place it.** (2026-08-31.)
     *
     * `locateAddressInZip` puts the ZIP into the query, so an address in the
     * next ZIP over cannot match and comes back exactly like a bad address.
     * The reader was then told we could not place it — true, about us, and
     * hiding the fact that we placed it perfectly well somewhere else.
     *
     * Only on the failure branch, and only with a house number: a street-only
     * lookup samples several points and has no single address to re-ask about.
     * No extra address leaves this product on the happy path.
     */
    const elsewhere =
      houseNumber.length > 0
        ? await zipThisAddressResolvesTo(houseNumber, street, zip)
        : null;
    const failed: AddressResolution = {
      status: "FAILED",
      reason: "NOT_FOUND",
      ...(elsewhere ? { resolvesInZip: elsewhere } : {}),
    };
    return Response.json({ ok: true, resolution: failed, contestIds: [] }, { headers: NO_STORE });
  }

  const samples: Sample[] = [];
  for (const p of points) {
    const divisions = await divisionsAt(p.lat, p.lng);
    samples.push(
      divisions.map((d) => ({ ocdId: d.ocdId, divisionType: d.divisionType, label: d.label })),
    );
  }

  const resolution = resolveAddress(samples);

  /*
   * Contests come from the CONFIRMED divisions only. A level the street
   * genuinely crosses contributes nothing until the reader settles it, because
   * narrowing a ballot on a jurisdiction we are not sure of would hide
   * contests the reader may actually vote in — and hiding a contest silently
   * is how a reader ends up believing it does not exist.
   */
  const confirmed =
    resolution.status === "FAILED"
      ? []
      : resolution.levels.filter((l) => l.certain).flatMap((l) => l.divisionIds);

  /*
   * The POINT comes back only when the answer is unambiguous, and only so the
   * map can re-centre on the reader's street the way it always has.
   *
   * Stated rather than assumed, because it looks like the one thing this route
   * was built to avoid: it is the same datum the browser already held under the
   * previous two-request shape, it is a STREET midpoint and never a house, it is
   * never written anywhere, and on an ambiguous street it is withheld entirely —
   * there is no single point to give, and inventing one would be the render
   * default manufacturing a claim.
   */
  const point =
    resolution.status === "RESOLVED" && points.length > 0
      ? {
          lat: points.reduce((sum, q) => sum + q.lat, 0) / points.length,
          lng: points.reduce((sum, q) => sum + q.lng, 0) / points.length,
        }
      : null;

  return Response.json(
    { ok: true, resolution, contestIds: await contestIdsFor(confirmed), point },
    { headers: NO_STORE },
  );
}
