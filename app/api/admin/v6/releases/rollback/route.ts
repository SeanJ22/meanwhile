import { loadWebsiteSavedKeys } from "../../../../../../lib/core/keys-entry.ts";
import { adminRead } from "@/lib/control-plane/admin-read.ts";
import type { NextRequest } from "next/server";
import { adminGet } from "@/lib/control-plane/gateway/admin-get.ts";
import { netlifyRollbackAdapter } from "@/lib/ops/release-rollback-netlify.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

async function get(request: NextRequest) {
  await loadWebsiteSavedKeys();
  return adminGet(request, async observedAt => ({ observedAt, ...await netlifyRollbackAdapter().read() }));
}

export const GET = adminRead(get);
