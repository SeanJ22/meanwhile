import { guardAdminRequest } from "../control-plane/gateway/admin-guard.ts";
import { productionKeysStore, type KeysStore } from "./keys-store.ts";
import { KEY_SERVICES, keyName, knownKeyService, type KeyService } from "./keys-model.ts";
import { testDueKeys } from "./keys-test.ts";

const HEADERS = { "cache-control": "no-store, no-cache, must-revalidate" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: HEADERS });

export async function handleKeys(request: Request, cookie: string | undefined, dependencies: {
  readonly store?: () => KeysStore; readonly test?: typeof testDueKeys;
} = {}): Promise<Response> {
  const guard = await guardAdminRequest({ headers: request.headers, cookie,
    checkOrigin: request.method !== "GET", nowSeconds: Math.floor(Date.now() / 1000) });
  if (!guard.ok) return guard.status === 404 ? new Response(null, { status: 404 }) : json({ says: guard.says }, guard.status);
  try {
    const store = (dependencies.store ?? productionKeysStore)();
    const testSaved = dependencies.test ?? testDueKeys;
    if (request.method === "GET") return json({ rows: await store.list(true) });
    if (Number(request.headers.get("content-length") ?? "0") > 24_000) return json({ says: "That key is too long." }, 400);
    const text = await request.text();
    if (text.length > 24_000) return json({ says: "That key is too long." }, 400);
    let body: { name?: unknown; value?: unknown; service?: unknown; action?: unknown };
    try { body = JSON.parse(text); } catch { return json({ says: "The key could not be read. Try again." }, 400); }
    if (!body || typeof body !== "object") return json({ says: "Enter the key's name." }, 400);
    let name: string;
    try { name = keyName(body.name); } catch { return json({ says: "Give the key a name using letters, numbers, spaces, dots or dashes." }, 400); }
    if (request.method === "DELETE") { await store.remove(name); return json({ says: "Key deleted." }); }
    if (body.action === "test") {
      const at = new Date().toISOString(); await store.retest(name, at);
      const checked = await testSaved(store, at, name);
      if (!checked && !(await store.list()).some(row => row.name === name)) return json({ says: "That key is no longer saved." }, 404);
      return json({ says: checked ? "The saved key was tested." : "Its test is running." });
    }
    if (body.action === "undo") {
      const at = new Date().toISOString(); await store.undo(name, at); await testSaved(store, at, name);
      return json({ says: "The earlier key setting was restored and tested." });
    }
    const service = knownKeyService(name) ?? body.service;
    if (typeof body.value !== "string" || !body.value.trim() || body.value.length > 16_384 || typeof service !== "string" || !Object.hasOwn(KEY_SERVICES, service)) {
      return json({ says: "Enter the name, paste the key, and choose what it is for." }, 400);
    }
    const at = new Date().toISOString();
    await store.save(name, body.value.trim(), service as KeyService, at);
    await testSaved(store, at, name);
    const rows = await store.list(true);
    return json({ says: rows.find(row => row.name === name)?.testedAt ? "Key saved and tested." : "Key saved. Its test is running.", rows });
  } catch { return json({ says: "The Keys box could not finish that change. Check the saved keys before trying again." }, 503); }
}
