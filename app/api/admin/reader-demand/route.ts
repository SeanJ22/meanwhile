import { loadWebsiteSavedKeys } from "../../../../lib/core/keys-entry.ts";
import { adminRead } from "@/lib/control-plane/admin-read.ts";
import type { NextRequest } from "next/server";

import { adminGet } from "@/lib/control-plane/gateway/admin-get.ts";
import { readReaderDemand } from "@/lib/control-plane/reader-demand.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

/** What readers looked up and asked for, organic traffic, aggregate only. Read only. */
async function get(request: NextRequest) {
  await loadWebsiteSavedKeys();
  return adminGet(request, (observedAt) => readReaderDemand(observedAt));
}

export const GET = adminRead(get);
