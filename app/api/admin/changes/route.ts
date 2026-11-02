import { loadWebsiteSavedKeys } from "../../../../lib/core/keys-entry.ts";
import { adminRead } from "@/lib/control-plane/admin-read.ts";
import type { NextRequest } from "next/server";

import { readChanges } from "@/lib/control-plane/changes/source.ts";
import { adminGet } from "@/lib/control-plane/gateway/admin-get.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

/** One plain line per change from any session, with where it has got to. Read from GitHub, cached for a minute. */
async function get(request: NextRequest) {
  await loadWebsiteSavedKeys();
  return adminGet(request, () => readChanges());
}

export const GET = adminRead(get);
