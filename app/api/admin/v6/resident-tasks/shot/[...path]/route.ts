import { loadWebsiteSavedKeys } from "../../../../../../../lib/core/keys-entry.ts";
import { storedKeyValue } from "../../../../../../../lib/core/keys-values.ts";
import { adminRead } from "@/lib/control-plane/admin-read.ts";
import { getStore } from "@netlify/blobs";
import type { NextRequest } from "next/server";

import { ADMIN_SESSION_COOKIE } from "@/lib/control-plane/admin-auth.ts";
import { guardAdminRequest } from "@/lib/control-plane/gateway/admin-guard.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "cache-control": "private, no-store" };

/** One resident-task screenshot from the portrait blob store, signed-in Admin only. The public portrait route never serves this prefix. */
async function get(request: NextRequest, context: { params: Promise<{ path: string[] }> }): Promise<Response> {
  await loadWebsiteSavedKeys();
  const guard = await guardAdminRequest({
    headers: request.headers,
    cookie: request.cookies.get(ADMIN_SESSION_COOKIE)?.value,
    checkOrigin: false,
    nowSeconds: Math.floor(Date.now() / 1000),
  });
  if (!guard.ok) return new Response(null, { status: guard.status === 404 ? 404 : guard.status, headers: NO_STORE });
  const { path } = await context.params;
  if (!path || path.length < 2 || path.some((part) => !/^[a-zA-Z0-9._-]+$/.test(part) || part === "." || part === "..") || !path.at(-1)!.endsWith(".png")) {
    return new Response(null, { status: 404, headers: NO_STORE });
  }
  const siteID = process.env.WTP_BLOBS_SITE_ID, token = storedKeyValue("WTP_BLOBS_TOKEN");
  let store;
  try { store = getStore({ name: "meanwhile-portraits", ...(siteID && token ? { siteID, token } : {}) }); }
  catch { return new Response(null, { status: 503, headers: NO_STORE }); }
  const bytes = await store.get(["resident-tasks", ...path].join("/"), { type: "arrayBuffer" });
  if (bytes === null) return new Response(null, { status: 404, headers: NO_STORE });
  return new Response(bytes, { headers: { "Content-Type": "image/png", ...NO_STORE } });
}

export const GET = adminRead(get);
