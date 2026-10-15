/** Admin's preview of a send: what agents would hunt in a place, before any work is created. Read-only. */
import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE } from "../control-plane/admin-auth.ts";
import { guardAdminRequest } from "../control-plane/gateway/admin-guard.ts";
import { previewPlacePackets } from "./packet-read.ts";
import { readPlaceWords } from "./place-words.ts";

const NO_STORE = { "cache-control": "private, no-store, no-cache, must-revalidate" };

export async function huntPreviewGet(request: NextRequest, seams: { readonly preview?: typeof previewPlacePackets; readonly placeOf?: typeof readPlaceWords } = {}): Promise<NextResponse> {
  const guard = await guardAdminRequest({ headers: request.headers, cookie: request.cookies.get(ADMIN_SESSION_COOKIE)?.value,
    checkOrigin: false, nowSeconds: Math.floor(Date.now() / 1000) });
  if (!guard.ok) return guard.status === 404 ? new NextResponse(null, { status: 404, headers: NO_STORE })
    : NextResponse.json({ says: guard.says }, { status: guard.status, headers: NO_STORE });
  const params = request.nextUrl.searchParams;
  const place = params.get("place") ?? "";
  if ([...params.keys()].some(k => k !== "place") || params.getAll("place").length !== 1 || !place.trim() || place.length > 200) {
    return NextResponse.json({ code: "INVALID_QUERY" }, { status: 400, headers: NO_STORE });
  }
  try {
    const named = await (seams.placeOf ?? readPlaceWords)(place);
    if (named.state === "CHOICES") return NextResponse.json(named, { headers: NO_STORE });
    if (named.state === "NONE") return NextResponse.json({ state: "REFUSED", says: named.says }, { headers: NO_STORE });
    return NextResponse.json(await (seams.preview ?? previewPlacePackets)(named, new Date().toISOString()), { headers: NO_STORE });
  } catch (error) {
    return NextResponse.json({ state: "REFUSED", says: `What this place holds could not be read just now (${error instanceof Error ? error.message : "unknown error"}).` }, { headers: NO_STORE });
  }
}
