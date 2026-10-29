import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE } from "@/lib/control-plane/admin-auth.ts";
import { guardAdminRequest } from "@/lib/control-plane/gateway/admin-guard.ts";
import { productionKeysStore } from "@/lib/core/keys-store.ts";
import { KEY_NAMES, KEY_SERVICES, keyName, type KeyService } from "@/lib/core/keys-model.ts";
import { testDueKeys } from "@/lib/core/keys-test.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const HEADERS = { "cache-control": "no-store, no-cache, must-revalidate" };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: HEADERS });

async function handle(request: NextRequest): Promise<NextResponse> {
  const guard = await guardAdminRequest({ headers: request.headers, cookie: request.cookies.get(ADMIN_SESSION_COOKIE)?.value,
    checkOrigin: request.method !== "GET", nowSeconds: Math.floor(Date.now() / 1000) });
  if (!guard.ok) return guard.status === 404 ? new NextResponse(null, { status: 404 }) : json({ says: guard.says }, guard.status);
  try {
    const store = productionKeysStore();
    if (request.method === "GET") return json({ rows: await store.list() });
    if (Number(request.headers.get("content-length") ?? "0") > 24_000) return json({ says: "That key is too long." }, 400);
    const text = await request.text();
    if (text.length > 24_000) return json({ says: "That key is too long." }, 400);
    let body: { name?: unknown; value?: unknown; service?: unknown };
    try { body = JSON.parse(text); } catch { return json({ says: "The key could not be read. Try again." }, 400); }
    if (!body || typeof body !== "object") return json({ says: "Enter the key's name." }, 400);
    let name: string;
    try { name = keyName(body.name); } catch { return json({ says: "Give the key a name using letters, numbers, spaces, dots or dashes." }, 400); }
    if (request.method === "DELETE") { await store.remove(name); return json({ says: "Key deleted." }); }
    const service = body.service ?? KEY_NAMES[name];
    if (typeof body.value !== "string" || !body.value.trim() || body.value.length > 16_384 || typeof service !== "string" || !Object.hasOwn(KEY_SERVICES, service)) {
      return json({ says: "Enter the name, paste the key, and choose what it is for." }, 400);
    }
    const at = new Date().toISOString();
    await store.save(name, body.value.trim(), service as KeyService, at);
    await testDueKeys(store, at, name);
    return json({ says: "Key saved and tested.", rows: await store.list() });
  } catch { return json({ says: "The Keys box could not finish that change. Check the saved keys before trying again." }, 503); }
}
export const GET = handle;
export const POST = handle;
export const DELETE = handle;
