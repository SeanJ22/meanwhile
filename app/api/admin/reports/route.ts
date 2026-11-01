import { loadWebsiteSavedKeys } from "../../../../lib/core/keys-entry.ts";
import { adminRead } from "@/lib/control-plane/admin-read.ts";
import type { NextRequest } from "next/server";

import { adminGet } from "@/lib/control-plane/gateway/admin-get.ts";
import { readReports } from "@/lib/control-plane/reports/read-reports.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

/** "Report a problem" submissions from the live site and the tester site, labeled by site. Read only. */
async function get(request: NextRequest) {
  await loadWebsiteSavedKeys();
  return adminGet(request, (observedAt) => readReports(observedAt));
}

export const GET = adminRead(get);
