import { loadWebsiteSavedKeys } from "../../../../lib/core/keys-entry.ts";
import { storedKeyValue } from "../../../../lib/core/keys-values.ts";
import { getStore } from "@netlify/blobs";

export async function GET(_request: Request, context: { params: Promise<{ path: string[] }> }): Promise<Response> {
  await loadWebsiteSavedKeys();
  const { path } = await context.params;
  if (!path || !["candidates", "officials"].includes(path[0]) || path.some(part => !/^[a-zA-Z0-9._-]+$/.test(part) || part === "." || part === "..")) {
    return new Response(null, { status: 404 });
  }
  const siteID = process.env.WTP_BLOBS_SITE_ID, token = storedKeyValue("WTP_BLOBS_TOKEN");
  // Hosted functions use Netlify's supplied context; the Linux host passes secrets.
  let store;
  try { store = getStore({ name: "meanwhile-portraits", ...(siteID && token ? { siteID, token } : {}) }); }
  catch { return new Response(null, { status: 503 }); }
  const bytes = await store.get(path.join("/"), { type: "arrayBuffer" });
  if (bytes === null) return new Response(null, { status: 404 });
  const extension = path.at(-1)?.split(".").at(-1)?.toLowerCase();
  const types: Record<string, string> = { avif: "image/avif", webp: "image/webp", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg" };
  return new Response(bytes, { headers: { "Content-Type": types[extension ?? ""] ?? "application/octet-stream", "Cache-Control": "public, max-age=3600, s-maxage=86400" } });
}
