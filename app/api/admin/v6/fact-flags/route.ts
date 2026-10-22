import { NextResponse, type NextRequest } from "next/server";
import { matching, rejectUnknown } from "@/lib/api/params";
import { ADMIN_SESSION_COOKIE } from "@/lib/control-plane/admin-auth.ts";
import { guardAdminRequest } from "@/lib/control-plane/gateway/admin-guard.ts";
import { factReader } from "@/lib/facts/db.ts";
import { readOwnerFlags } from "@/lib/facts/owner-flags.ts";

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
  const unknown = rejectUnknown(params, ["after"]);
  const after = matching(params, "after", /^[0-9]{1,15}$/, { default: null });
  if (!unknown.ok) return NextResponse.json({ error: unknown.error }, { status: 400, headers: privateHeaders });
  if (!after.ok) return NextResponse.json({ error: after.error }, { status: 400, headers: privateHeaders });
  const query = factReader();
  if (!query) return NextResponse.json({ says: "The fact store could not be read just now." }, { status: 503, headers: privateHeaders });
  try {
    const flags = await readOwnerFlags(query, after.value === null ? 0 : Number(after.value), 50);
    return NextResponse.json({ flags, next: flags.length === 50 ? flags.at(-1)!.id : null }, { headers: privateHeaders });
  } catch {
    return NextResponse.json({ says: "The flags could not be read just now." }, { status: 503, headers: privateHeaders });
  }
}
