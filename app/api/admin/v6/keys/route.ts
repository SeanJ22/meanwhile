import type { NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE } from "@/lib/control-plane/admin-auth.ts";
import { adminRead } from "@/lib/control-plane/admin-read.ts";
import { handleKeys } from "@/lib/core/keys-http.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const handle = (request: NextRequest) => handleKeys(request, request.cookies.get(ADMIN_SESSION_COOKIE)?.value);
export const GET = adminRead(handle);
export const POST = handle;
export const DELETE = handle;
