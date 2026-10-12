import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE } from "../admin-auth.ts";
import { stateOfZip } from "../bulk-hunts/zip-state.ts";
import { guardAdminRequest } from "../gateway/admin-guard.ts";

const NO_STORE = { "cache-control": "private, no-store, no-cache, must-revalidate" };

/** A ZIP the national ZIP index lacks is a 404, never a guess. */
export async function v6ZipGet(request: NextRequest, seams: { readonly stateOf?: (zip: string) => Promise<string | null> } = {}): Promise<NextResponse> {
  const guard = await guardAdminRequest({ headers: request.headers, cookie: request.cookies.get(ADMIN_SESSION_COOKIE)?.value,
    checkOrigin: false, nowSeconds: Math.floor(Date.now() / 1000) });
  if (!guard.ok) return guard.status === 404 ? new NextResponse(null, { status: 404, headers: NO_STORE })
    : NextResponse.json({ says: guard.says }, { status: guard.status, headers: NO_STORE });
  const params = request.nextUrl.searchParams;
  const zip = params.get("zip") ?? "";
  if ([...params.keys()].some((k) => k !== "zip") || params.getAll("zip").length !== 1 || !/^\d{5}$/.test(zip)) {
    return NextResponse.json({ code: "INVALID_ZIP" }, { status: 400, headers: NO_STORE });
  }
  const state = await (seams.stateOf ?? stateOfZip)(zip);
  if (state === null) return NextResponse.json({ code: "ZIP_NOT_IN_INDEX" }, { status: 404, headers: NO_STORE });
  return NextResponse.json({ zip, state: state.toLowerCase() }, { headers: NO_STORE });
}
