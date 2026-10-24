import type { NextRequest } from "next/server";
import { adminGet } from "@/lib/control-plane/gateway/admin-get.ts";
import { factReader } from "@/lib/facts/db.ts";
import { readAliasCounts } from "@/lib/core/aliases.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return adminGet(request, async () => {
    const query = factReader();
    const counts = query ? await readAliasCounts(query) : null;
    return { counts };
  });
}
