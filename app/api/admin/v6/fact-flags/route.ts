import type { NextRequest } from "next/server";
import { adminGet } from "@/lib/control-plane/gateway/admin-get.ts";
import { factReader } from "@/lib/facts/db.ts";
import { readOwnerFlags } from "@/lib/facts/owner-flags.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return adminGet(request, async () => {
    const query = factReader();
    if (!query) throw new Error("Fact store unavailable");
    const cursor = Number(request.nextUrl.searchParams.get("after") ?? 0);
    const after = Number.isSafeInteger(cursor) && cursor > 0 ? cursor : 0;
    const flags = await readOwnerFlags(query,after,50);
    return {flags,next:flags.length === 50 ? flags.at(-1)!.id : null};
  });
}
