import { NextResponse, type NextRequest } from "next/server";
import { readHeldPlaceCapture } from "../../civic-data/held-place-capture.ts";
import { zipCountsByState } from "../bulk-hunts/zip-state.ts";
import { ADMIN_SESSION_COOKIE } from "../admin-auth.ts";
import { openControlPlane } from "../admin-data.ts";
import { guardAdminRequest } from "../gateway/admin-guard.ts";
import { refreshOwedOverlay } from "./owed-overlay-read.ts";
import { readStateDistricts, zipDivisionIds } from "./v6-national-geography.ts";
import { nationalScopeOf, v6NationalSection, type NationalDeps } from "./v6-national-read.ts";
import { population } from "./v6-stuck-route.ts";
import { readV6Sources } from "./v6-money-hunts-route.ts";
import { readPopulationFacts, statePopulationId } from "../../reference/population-facts.ts";

const NO_STORE = { "cache-control": "private, no-store, no-cache, must-revalidate" };

/** A response that waits longer than this for place scores breaks the three-second bar; the read goes on and the next request has them. */
const SCORE_BUDGET_MS = 2_500;

export const defaultNationalDeps: NationalDeps = {
  now: () => new Date().toISOString(),
  districts: (state) => readStateDistricts(state),
  zipCounts: zipCountsByState,
  zipDivisions: (zips) => zipDivisionIds(zips),
    // The owner's owed overlay counts in every place score below, so it is read first.
  readHeld: async (ids, now) => { await refreshOwedOverlay(); return readHeldPlaceCapture(ids, { now }); },
  scoreBudgetMs: SCORE_BUDGET_MS,
};

export async function v6NationalGet(request: NextRequest, options: { readonly deps?: NationalDeps } = {}): Promise<NextResponse> {
  const guard = await guardAdminRequest({ headers: request.headers, cookie: request.cookies.get(ADMIN_SESSION_COOKIE)?.value,
    checkOrigin: false, nowSeconds: Math.floor(Date.now() / 1000) });
  if (!guard.ok) return guard.status === 404 ? new NextResponse(null, { status: 404, headers: NO_STORE })
    : NextResponse.json({ says: guard.says }, { status: guard.status, headers: NO_STORE });
  const query = nationalScopeOf(request.nextUrl.searchParams);
  if (!query.ok) return NextResponse.json({ code: query.code }, { status: 400, headers: NO_STORE });
  const deps = options.deps ?? defaultNationalDeps;
  const opened = await openControlPlane();
  if (!opened.ok) return NextResponse.json({ state: "UNREAD", code: "CONTROL_PLANE_UNREAD", says: opened.detail }, { status: 503, headers: NO_STORE });
  const [sources, stuck] = await Promise.all([
    readV6Sources(opened.repos, deps.now(), false),
    population().then((read) => read?.rows ?? null, () => null),
  ]);
  const out = await v6NationalSection({ scopeKey: query.scopeKey, scope: query.scope,
    sources: { hunts: { scopes: sources.scopes, malformedScopes: sources.malformedScopes, attribution: sources.attribution }, stuck }, deps });
  if ("kind" in out) return NextResponse.json({ code: out.code, says: out.says }, { status: out.status, headers: NO_STORE });
  const keys = out.data.map(row => row.kind === "State" ? statePopulationId(row.code) : row.kind === "ZIP" ? `zcta:${row.code}` : `congressional_district:${row.placeKey.split(".").at(-1)}`);
  const acs = await readPopulationFacts(keys.filter((id): id is string => id !== null));
  return NextResponse.json({ ...out, data: out.data.map((row, index) => ({ ...row,
    population: acs.rows.find(fact => `${fact.geography}:${fact.code}` === keys[index]) ?? null })) }, { headers: NO_STORE });
}
