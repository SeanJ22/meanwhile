import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { v6ZipGet } from "../lib/control-plane/admin-view/v6-zip-route.ts";
import { ADMIN_HOST, PUBLIC_HOST, adminSessionCookie, withAdminSessionKey } from "./admin-session.ts";

const stateOf = async (zip: string) => (zip === "85122" ? "AZ" : null);

test("ZIP lookup: public host 404, no session 401, a ZIP the index files under a state answers its lowercase state, one it lacks is a 404, bad input is a 400", async () => {
  const pub = await v6ZipGet(new NextRequest(`https://${PUBLIC_HOST}/api/admin/v6/zip?zip=85122`, { headers: { host: PUBLIC_HOST } }), { stateOf });
  assert.equal(pub.status, 404);
  const anon = await v6ZipGet(new NextRequest(`https://${ADMIN_HOST}/api/admin/v6/zip?zip=85122`, { headers: { host: ADMIN_HOST } }), { stateOf });
  assert.equal(anon.status, 401);
  await withAdminSessionKey(async () => {
    const cookie = await adminSessionCookie();
    const ask = (query: string) => v6ZipGet(new NextRequest(`https://${ADMIN_HOST}/api/admin/v6/zip${query}`, { headers: { host: ADMIN_HOST, cookie } }), { stateOf });
    const ok = await ask("?zip=85122");
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { zip: "85122", state: "az" });
    assert.match(ok.headers.get("cache-control") ?? "", /no-store/);
    assert.equal((await ask("?zip=00000")).status, 404);
    assert.equal((await ask("?zip=8512")).status, 400);
    assert.equal((await ask("?zip=85122&zip=85123")).status, 400);
    assert.equal((await ask("?zip=85122&x=1")).status, 400);
    assert.equal((await ask("")).status, 400);
  });
});
