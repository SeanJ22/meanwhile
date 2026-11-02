import { loadWebsiteSavedKeys } from "../../../../../lib/core/keys-entry.ts";
import { adminRead } from "@/lib/control-plane/admin-read.ts";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { ADMIN_SESSION_COOKIE } from "@/lib/control-plane/admin-auth.ts";
import { openControlPlane } from "@/lib/control-plane/admin-data.ts";
import { guardAdminRequest } from "@/lib/control-plane/gateway/admin-guard.ts";
import { ADMIN_V6_RECEIPT_CONTRACT, lookupAdminReceipt, validReceiptIdentity } from "@/lib/control-plane/admin-view/receipt-lookup.ts";
import { confirmReceipt } from "@/lib/control-plane/gateway/confirmation.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const privateHeaders = { "cache-control": "private, no-store, max-age=0" };

async function get(request: NextRequest): Promise<NextResponse> {
  await loadWebsiteSavedKeys();
  const guard = await guardAdminRequest({ headers: request.headers,
    cookie: request.cookies.get(ADMIN_SESSION_COOKIE)?.value, checkOrigin: false,
    nowSeconds: Math.floor(Date.now() / 1000) });
  if (!guard.ok) return guard.status === 404
    ? new NextResponse(null, { status: 404, headers: privateHeaders })
    : NextResponse.json({ error: guard.says }, { status: guard.status, headers: privateHeaders });
  const type = request.nextUrl.searchParams.get("type") ?? "";
  const key = request.nextUrl.searchParams.get("key") ?? "";
  if (!validReceiptIdentity(type, key) || [...request.nextUrl.searchParams.keys()].some(name => name !== "type" && name !== "key"))
    return NextResponse.json({ error: "Invalid receipt identity." }, { status: 400, headers: privateHeaders });
  const opened = await openControlPlane();
  if (!opened.ok) return NextResponse.json({ error: "The receipt store could not be read." }, { status: 503, headers: privateHeaders });
  try {
    const receipt = await lookupAdminReceipt(opened.repos, type, key);
    // What the runner did about it, from the runner's own records. Null when there is no receipt.
    const confirmation = receipt ? await confirmReceipt(opened.repos, receipt) : null;
    return NextResponse.json({ contract: ADMIN_V6_RECEIPT_CONTRACT, receipt, confirmation }, { headers: privateHeaders });
  } catch {
    return NextResponse.json({ error: "The exact receipt could not be checked." }, { status: 503, headers: privateHeaders });
  }
}

export const GET = adminRead(get);
