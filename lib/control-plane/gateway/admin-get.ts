import { NextResponse, type NextRequest } from "next/server";

import { ADMIN_SESSION_COOKIE } from "../admin-auth.ts";
import { guardAdminRequest } from "./admin-guard.ts";

const NO_STORE = { "cache-control": "no-store, no-cache, must-revalidate" };

export async function adminGet(
  request: NextRequest,
  read: (observedAt: string) => Promise<unknown>,
): Promise<NextResponse> {
  const observedAt = new Date().toISOString();
  const guard = await guardAdminRequest({
    headers: request.headers,
    cookie: request.cookies.get(ADMIN_SESSION_COOKIE)?.value,
    checkOrigin: false,
    nowSeconds: Math.floor(Date.parse(observedAt) / 1000),
  });
  if (!guard.ok) {
    return guard.status === 404
      ? new NextResponse(null, { status: 404, headers: NO_STORE })
      : NextResponse.json({ says: guard.says }, { status: guard.status, headers: NO_STORE });
  }
  try {
    return NextResponse.json(await read(observedAt), { headers: NO_STORE });
  } catch (error) {
    return NextResponse.json(
      { says: `This could not be read just now (${error instanceof Error ? error.name : "error"}). Nothing here means nothing was read, not that nothing happened.` },
      { status: 503, headers: NO_STORE },
    );
  }
}
