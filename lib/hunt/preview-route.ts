/** Admin's preview of a send: what agents would hunt in a place, before any work is created. Read-only. */
import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE } from "../control-plane/admin-auth.ts";
import { guardAdminRequest } from "../control-plane/gateway/admin-guard.ts";
import { placeKeyOfWords, previewPlacePackets } from "./packet-read.ts";

const NO_STORE = { "cache-control": "private, no-store, no-cache, must-revalidate" };

export async function huntPreviewGet(request: NextRequest, seams: { readonly preview?: typeof previewPlacePackets; readonly placeOf?: typeof placeKeyOfWords } = {}): Promise<NextResponse> {
  const guard = await guardAdminRequest({ headers: request.headers, cookie: request.cookies.get(ADMIN_SESSION_COOKIE)?.value,
    checkOrigin: false, nowSeconds: Math.floor(Date.now() / 1000) });
  if (!guard.ok) return guard.status === 404 ? new NextResponse(null, { status: 404, headers: NO_STORE })
    : NextResponse.json({ says: guard.says }, { status: guard.status, headers: NO_STORE });
  const params = request.nextUrl.searchParams;
  const place = params.get("place") ?? "";
  if ([...params.keys()].some(k => k !== "place") || params.getAll("place").length !== 1 || !place.trim() || place.length > 200) {
    return NextResponse.json({ code: "INVALID_QUERY" }, { status: 400, headers: NO_STORE });
  }
  const key = await (seams.placeOf ?? placeKeyOfWords)(place);
  if (key === null) return NextResponse.json({ state: "REFUSED", says: "Name a ZIP, a county, a congressional district like AZ-01, or a state." }, { headers: NO_STORE });
  try {
    return NextResponse.json(await (seams.preview ?? previewPlacePackets)([key]), { headers: NO_STORE });
  } catch (error) {
    return NextResponse.json({ state: "REFUSED", placeKey: key, says: `What this place holds could not be read just now (${error instanceof Error ? error.message : "unknown error"}).` }, { headers: NO_STORE });
  }
}
