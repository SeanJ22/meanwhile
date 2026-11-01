import { storedKeyValue } from "../../core/keys-values.ts";
import { NextResponse, type NextRequest } from "next/server";
import { readHeldPlaceCapture } from "../../civic-data/held-place-capture.ts";
import { zipCountsByState } from "../bulk-hunts/zip-state.ts";
import { ADMIN_SESSION_COOKIE } from "../admin-auth.ts";
import { openControlPlane } from "../admin-data.ts";
import { guardAdminRequest } from "../gateway/admin-guard.ts";
import { readStateDistricts, zipDivisionIds } from "./v6-national-geography.ts";
import { nationalScopeOf, v6NationalSection, type NationalDeps } from "./v6-national-read.ts";
import { population } from "./v6-stuck-route.ts";
import { expansionScopesOf } from "../expansion/scopes.ts";
import { ADMIN_CONFIG_ID } from "../gateway/admin-config.ts";
import type { OwnerSnapshot } from "../owner-surface.ts";
import { readPopulationFacts, statePopulationId } from "../../reference/population-facts.ts";
import { databaseHttpReadOnlySql, databaseHttpReadOnlyQuery } from "../../reader/database.ts";
import { controlPlaneUrlFromEnv } from "../repository/pg-store.ts";
import { readCountryScores } from "../line-keeper/country.ts";
import { readOwnerDistrictStuckCounts } from "../repository/owner-stuck-counts.ts";
import { US_STATES } from "../readiness/catalog.ts";

const NO_STORE = { "cache-control": "private, no-store, no-cache, must-revalidate" };

/** A response that waits longer than this for place scores breaks the three-second bar; the read goes on and the next request has them. */
const SCORE_BUDGET_MS = 2_500;

export const defaultNationalDeps: NationalDeps = {
  now: () => new Date().toISOString(),
  districts: (state) => readStateDistricts(state),
  zipCounts: () => { const connection = storedKeyValue("DATABASE_URL"); return zipCountsByState(connection ? databaseHttpReadOnlySql(connection).query : undefined); },
  zipDivisions: (zips) => zipDivisionIds(zips),
  readHeld: (ids, now) => readHeldPlaceCapture(ids, { now }),
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
  const readerConnection = storedKeyValue("DATABASE_URL");
  const populationQuery = readerConnection ? databaseHttpReadOnlyQuery(readerConnection, 2_000) : undefined;
  const earlyPopulation = query.scope.kind === "country"
    ? readPopulationFacts(US_STATES.map(state => statePopulationId(state.code)).filter((key): key is string => key !== null), populationQuery) : null;
  const earlyZips = query.scope.kind === "country" ? deps.zipCounts().catch(() => null) : null;
  const quick=async<T>(read:Promise<T>):Promise<T|null>=>{
    let timer:ReturnType<typeof setTimeout>;
    try{return await Promise.race([read.catch(()=>null),new Promise<null>(resolve=>{timer=setTimeout(()=>resolve(null),SCORE_BUDGET_MS);})]);}
    finally{clearTimeout(timer!);}
  };
  const [config,snapshot,stuck,country]=await Promise.all([
    quick(opened.repos.adminConfig.read(ADMIN_CONFIG_ID,{expansionScopes:true})),
    quick(opened.repos.ownerSnapshots.readNarrowed('current',{billingAttribution:true})),
    quick(population(query.scopeKey)),
    query.scope.kind==='country'&&!options.deps&&controlPlaneUrlFromEnv()?quick(readCountryScores(databaseHttpReadOnlySql(controlPlaneUrlFromEnv()!))):null,
  ]);
  const scopes=expansionScopesOf(config?.value??null);
  const attribution=(snapshot?.value as Pick<OwnerSnapshot,'billingAttribution'>|undefined)?.billingAttribution;
  const out = await v6NationalSection({ scopeKey: query.scopeKey, scope: query.scope,
    sources: { hunts: { scopes:config?scopes.scopes:null, malformedScopes:scopes.malformed, attribution }, stuck:stuck?.rows??null,
      stuckCounts:stuck?.summary?.counts,
      ...(controlPlaneUrlFromEnv()?{countDistrictStuck:(districts:readonly import('./v6-national-geography.ts').DistrictInfo[])=>
        readOwnerDistrictStuckCounts(databaseHttpReadOnlySql(controlPlaneUrlFromEnv()!),districts)}:{}) },
    deps: earlyZips ? { ...deps, zipCounts: () => earlyZips } : deps,
    ...(!options.deps && query.scope.kind==='country'?{publishedScores:new Map((country??[]).map(s=>[`st:${s.state}`,s.score]))}:{}) });
  if ("kind" in out) return NextResponse.json({ code: out.code, says: out.says }, { status: out.status, headers: NO_STORE });
  const keys = out.data.map(row => row.kind === "State" ? statePopulationId(row.code) : row.kind === "ZIP" ? `zcta:${row.code}` : `congressional_district:${row.placeKey.split(".").at(-1)}`);
  const acs = earlyPopulation ? await earlyPopulation : await readPopulationFacts(keys.filter((id): id is string => id !== null), populationQuery);
  const countryGaps=!options.deps&&query.scope.kind==='country'?(country===null||country.length===0?['The country’s published Readers have report is unavailable.']:country.filter(s=>s.error!==null).map(s=>`${s.state.toUpperCase()}: ${s.error}`)):[];
  return NextResponse.json({ ...out,missingParts:[...out.missingParts,...countryGaps], data: out.data.map((row, index) => ({ ...row,
    population: acs.rows.find(fact => `${fact.geography}:${fact.code}` === keys[index]) ?? null })) }, { headers: NO_STORE });
}
