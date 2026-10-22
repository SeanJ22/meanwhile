import { NextResponse, type NextRequest } from "next/server";
import { matching, rejectUnknown } from "@/lib/api/params";
import { ADMIN_SESSION_COOKIE } from "@/lib/control-plane/admin-auth.ts";
import { guardAdminRequest } from "@/lib/control-plane/gateway/admin-guard.ts";
import { factReader } from "@/lib/facts/db.ts";
import { searchPublishedFacts } from "@/lib/facts/owner-flags.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const privateHeaders = { "cache-control": "no-store, no-cache, must-revalidate" };

export async function GET(request: NextRequest): Promise<NextResponse> {
  const guard = await guardAdminRequest({ headers: request.headers,
    cookie: request.cookies.get(ADMIN_SESSION_COOKIE)?.value, checkOrigin: false,
    nowSeconds: Math.floor(Date.now() / 1000) });
  if (!guard.ok) return guard.status === 404
    ? new NextResponse(null, { status: 404, headers: privateHeaders })
    : NextResponse.json({ says: guard.says }, { status: guard.status, headers: privateHeaders });
  const params = request.nextUrl.searchParams;
  const unknown = rejectUnknown(params, ["q"]);
  const words = matching(params, "q", /^[\s\S]{3,100}$/, "refuse");
  if (!unknown.ok) return NextResponse.json({ error: unknown.error }, { status: 400, headers: privateHeaders });
  if (!words.ok) return NextResponse.json({ error: words.error }, { status: 400, headers: privateHeaders });
  const query = factReader();
  if (!query) return NextResponse.json({ says: "The fact store could not be read just now." }, { status: 503, headers: privateHeaders });
  try {
    return NextResponse.json(await searchPublishedFacts(query, words.value!), { headers: privateHeaders });
  } catch {
    return NextResponse.json({ says: "The search could not be run just now." }, { status: 503, headers: privateHeaders });
  }
}
