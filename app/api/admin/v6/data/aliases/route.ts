import { loadWebsiteSavedKeys } from "../../../../../../lib/core/keys-entry.ts";
import { adminRead } from "@/lib/control-plane/admin-read.ts";
import type { NextRequest } from "next/server";
import { adminGet } from "@/lib/control-plane/gateway/admin-get.ts";
import { factReader } from "@/lib/facts/db.ts";
import { readAliasCounts } from "@/lib/core/aliases.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function get(request: NextRequest) {
  await loadWebsiteSavedKeys();
  return adminGet(request, async () => {
    const query = factReader();
    const counts = query ? await readAliasCounts(query) : null;
    return { counts };
  });
}

export const GET = adminRead(get);
