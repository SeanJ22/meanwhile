/**
 * GET /api/census-geography/zctas?type=&geoid=&version=
 *
 * The Admin lane's typed read endpoint for the census-geography lookup — the
 * integration seam agreed with the Admin session (RULING 273: one shared typed
 * schema, `lib/census-geography/contract.ts`). It returns every Census ZCTA that
 * lies wholly or partly inside a selected geography, each with the
 * wholly-vs-partly flag (`whole`) and its labeled overlap `fraction` /
 * `fractionBasis`.
 *
 * It reads the promoted production pointer via `loadPublishedLookup()`, with the
 * committed AZ bootstrap as the non-prod fallback, so it serves live published
 * geography the moment promotion lands — no fixtures stand in for available
 * production data. Unknown is never zero: the contract's typed `status`
 * (OK / NOT_YET_PUBLISHED / NOT_IN_COVERAGE) is returned verbatim, and an empty
 * overlap set is only ever OK.
 *
 * `version` is optional; omitted, it resolves the published version for the type
 * (e.g. `cd:119`). Geography identifiers are public — not personal — so a GET
 * carrying them in the query is fine. The endpoint is data-access only: it writes
 * nothing and is never cached (a promotion can change the answer at any time).
 */
import { isGeographyType, type GeographyType } from "@/lib/census-geography/contract";
import { loadPublishedLookupState } from "@/lib/census-geography/reader";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store, no-cache, must-revalidate" } as const;

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const type = (params.get("type") ?? "").trim();
  const geoid = (params.get("geoid") ?? "").trim();
  const version = (params.get("version") ?? "").trim();

  // Validity checks (never behind a flag): a closed geography-type set and a
  // Census GEOID that is all digits with its leading zeros preserved.
  if (!isGeographyType(type)) {
    return Response.json(
      {
        ok: false,
        error: "unknown geography type",
        allowed: [
          "congressional_district",
          "county",
          "cbsa",
          "state_leg_upper",
          "state_leg_lower",
          "place",
          "county_subdivision",
        ],
      },
      { status: 400, headers: NO_STORE },
    );
  }
  if (!/^\d{2,}$/.test(geoid)) {
    return Response.json(
      { ok: false, error: "geoid must be the Census GEOID digits, leading zeros preserved (e.g. 0406, 04019, 38060)" },
      { status: 400, headers: NO_STORE },
    );
  }

  const narrowedType: GeographyType = type;
  // `source` is explicit so Admin never mistakes a fixture for live coverage:
  // in production it is only ever "published" or (pre-activation) "unavailable",
  // never "bootstrap" (the read-model gates the fixture off when NODE_ENV is
  // production). Admin should treat anything but "published" as not-yet-live.
  const { lookup, source, versionId } = await loadPublishedLookupState();

  // Resolve the version: honor the one asked for, else the type's published
  // version. An unresolved version flows through as a typed NOT_YET_PUBLISHED.
  let resolvedVersion = version;
  if (resolvedVersion === "") {
    const manifest = await lookup.manifest();
    resolvedVersion = manifest.scopes.find((scope) => scope.type === narrowedType)?.version ?? "";
  }

  const result = await lookup.zctasForGrouping({ type: narrowedType, geoid, version: resolvedVersion });
  return Response.json({ ok: true, source, activePublishedVersion: versionId, result }, { headers: NO_STORE });
}
