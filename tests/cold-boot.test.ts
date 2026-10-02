import test from "node:test";
import assert from "node:assert/strict";
import nextConfig from "../next.config.ts";

// C21 (2026-09-24). Netlify starts Next as a full server, so Next's default
// preload requires every route's server code before a cold instance answers
// its first request. The reason and the measurements sit beside the setting in
// next.config.ts; this keeps the setting from leaving quietly.
test("a cold server instance loads only the route it was asked for: Next's preload of every route stays off", () => {
  assert.equal(nextConfig.experimental?.preloadEntriesOnStart, false);
});

import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { middleware } from "../middleware.ts";
import { ADMIN_ORIGIN, PUBLIC_SITE_ORIGIN } from "../lib/ops/origins.ts";
import { publishReaderShell } from "../scripts/publish-reader-shell.mjs";

test("the root shell publishes the build's exact HTML and its hydration chunks", async () => {
  const root = await mkdtemp(join(tmpdir(), "meanwhile-reader-shell-"));
  try {
    await mkdir(join(root, ".next/server/app"), { recursive: true });
    const html = '<!doctype html><html><head><script src="/_next/static/chunks/map.js"></script></head><body>Meanwhile</body></html>';
    await writeFile(join(root, ".next/server/app/index.html"), html);
    assert.equal(await readFile(await publishReaderShell(root), "utf8"), html);
    await writeFile(join(root, ".next/server/app/index.html"), html.replace("map.js", "new-map.js"));
    assert.equal(await readFile(await publishReaderShell(root), "utf8"), html.replace("map.js", "new-map.js"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("only Netlify root document GET/HEAD use the static shell; RSC, actions and Admin keep their routes", async () => {
  const before = process.env.WTP_BUILD_ON_NETLIFY;
  try {
    process.env.WTP_BUILD_ON_NETLIFY = "true";
    for (const method of ["GET", "HEAD"]) {
      const request = new NextRequest(new URL("/?zip=85635", PUBLIC_SITE_ORIGIN), { method });
      const response = await middleware(request);
      const target = new URL(response.headers.get("x-middleware-rewrite")!);
      assert.equal(target.pathname, "/_reader-shell/index.html");
      assert.equal(target.search, "?zip=85635");
    }
    const cases: { path: string; method?: string; headers?: Record<string, string> }[] = [
      { path: "/?_rsc=abc" }, { path: "/ballot" }, { path: "/api/meetings" },
      { path: "/", method: "POST" }, { path: "/", headers: { rsc: "1" } },
      { path: "/", headers: { "x-nextjs-data": "1" } },
      { path: "/", headers: { "next-router-prefetch": "1" } },
      { path: "/", headers: { "next-action": "abc" } },
      { path: "/", headers: { accept: "text/x-component" } },
    ];
    for (const item of cases) {
      const response = await middleware(new NextRequest(new URL(item.path, PUBLIC_SITE_ORIGIN), {
        method: item.method, headers: item.headers,
      }));
      assert.equal(response.headers.get("x-middleware-rewrite"), null, JSON.stringify(item));
    }
    const admin = await middleware(new NextRequest(new URL("/", ADMIN_ORIGIN), { headers: { host: new URL(ADMIN_ORIGIN).host } }));
    assert.equal(new URL(admin.headers.get("location")!).pathname, "/admin");
    assert.equal((await middleware(new NextRequest(new URL("/_reader-shell/index.html", ADMIN_ORIGIN), { headers: { host: new URL(ADMIN_ORIGIN).host } }))).status, 404);
    assert.equal((await middleware(new NextRequest(new URL("/admin", PUBLIC_SITE_ORIGIN)))).status, 404);
    delete process.env.WTP_BUILD_ON_NETLIFY;
    assert.equal((await middleware(new NextRequest(new URL("/", PUBLIC_SITE_ORIGIN)))).headers.get("x-middleware-rewrite"), null);
  } finally {
    if (before === undefined) delete process.env.WTP_BUILD_ON_NETLIFY;
    else process.env.WTP_BUILD_ON_NETLIFY = before;
  }
});
