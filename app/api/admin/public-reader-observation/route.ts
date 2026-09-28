import { neon } from "@neondatabase/serverless";
import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE } from "@/lib/control-plane/admin-auth.ts";
import { openControlPlane } from "@/lib/control-plane/admin-data.ts";
import { parsePublishedResultSubjectKey, PublishedResultQueryError,
  readExactServedWitness, readPublishedResultObservation } from "@/lib/control-plane/admin-view/public-reader-observation-read.ts";
import { guardAdminRequest } from "@/lib/control-plane/gateway/admin-guard.ts";
import { controlPlaneUrlFromEnv } from "@/lib/control-plane/repository/pg-store.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
const NO_STORE = { "cache-control": "no-store, no-cache, must-revalidate" };

/** One published WorkItem and its exact, saved public-browser observation. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const guard = await guardAdminRequest({ headers: request.headers,
    cookie: request.cookies.get(ADMIN_SESSION_COOKIE)?.value, checkOrigin: false,
    nowSeconds: Math.floor(Date.now() / 1000) });
  if (!guard.ok) return guard.status === 404 ? new NextResponse(null, { status: 404 })
    : NextResponse.json({ says: guard.says }, { status: guard.status, headers: NO_STORE });
  const params = request.nextUrl.searchParams;
  if ([...params.keys()].some(key => !["workItemId", "subject"].includes(key)) ||
    ["workItemId", "subject"].some(key => params.getAll(key).length !== 1))
    return NextResponse.json({ code: "INVALID_SUBJECT_KEY" }, { status: 400, headers: NO_STORE });
  let subjectKey;
  try { subjectKey = parsePublishedResultSubjectKey(params.get("workItemId"), params.get("subject")); }
  catch { return NextResponse.json({ code: "INVALID_SUBJECT_KEY" }, { status: 400, headers: NO_STORE }); }
  const opened = await openControlPlane();
  const url = controlPlaneUrlFromEnv();
  if (!opened.ok || !url) return NextResponse.json({ state: "UNAVAILABLE", says: "The saved publication and public observation could not be read." },
    { status: 503, headers: NO_STORE });
  try {
    const result = await readPublishedResultObservation({ repos: opened.repos, subjectKey,
      readWitness: item => readExactServedWitness(neon(url), item) });
    return result ? NextResponse.json(result, { headers: NO_STORE }) : new NextResponse(null, { status: 404, headers: NO_STORE });
  } catch (error) {
    if (error instanceof PublishedResultQueryError && error.code === "SUBJECT_MISMATCH")
      return new NextResponse(null, { status: 404, headers: NO_STORE });
    return NextResponse.json({ state: "UNAVAILABLE", says: "The saved publication or public observation could not be read." },
      { status: 503, headers: NO_STORE });
  }
}
