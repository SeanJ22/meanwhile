/**
 * TC-02 · Plain files never run the middleware. Every file under public/ (and the app icons, the generated map worker, /_next/static)
 * is excluded by the matcher, while pages, API routes, every admin route and every path on the admin host stay matched.
 * The matcher is compiled by Next's own compiler, so this is the routing Netlify gets.
 */
import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import test from "node:test";

import * as pageStaticInfo from "next/dist/build/analysis/get-page-static-info.js";
import { getMiddlewareRouteMatcher } from "next/dist/shared/lib/router/utils/middleware-route-matcher.js";

import { config } from "@/middleware.ts";
import { ADMIN_ORIGIN } from "@/lib/ops/origins.ts";

const ROOT = join(import.meta.dirname, "..");
// Next ships no declaration for this internal; it is the function `next build` itself uses to compile `config.matcher`.
const getMiddlewareMatchers = (pageStaticInfo as unknown as { getMiddlewareMatchers(matcher: unknown, nextConfig: object): never }).getMiddlewareMatchers;
const matches = getMiddlewareRouteMatcher(getMiddlewareMatchers(config.matcher, {}));

function runs(path: string, host = "meanwhileusa.com"): boolean {
  return matches(path, { headers: { host } } as never, {});
}

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? files(full) : [full];
  });
}

test("no file under public/ runs the middleware", () => {
  const all = files(join(ROOT, "public")).map((f) => "/" + relative(join(ROOT, "public"), f).split(sep).join("/"));
  assert.ok(all.some((p) => p.endsWith(".geojson")) && all.some((p) => p.endsWith(".jpg")), "public/ must hold the files this test is about");
  for (const path of all) assert.equal(runs(path), false, `${path} must not run the middleware`);
});

test("the named static paths do not run the middleware", () => {
  for (const path of [
    "/geo/state-outlines.geojson",
    "/maplibre-gl-worker.mjs",
    "/robots.txt",
    "/favicon.ico",
    "/icon.svg",
    "/apple-icon.png",
    "/opengraph-image.png",
    "/tiles/x.pbf",
    "/fonts/a.woff2",
    "/_next/static/chunks/main-abc.js",
    "/_next/static/css/app.css",
    "/_next/image",
  ]) {
    assert.equal(runs(path), false, `${path} must not run the middleware`);
  }
});

test("pages and API routes that need the middleware still run it", () => {
  for (const path of ["/", "/ballot", "/place/az", "/api/ask/classify", "/api/portraits/az/jane-doe.jpg", "/api/maptiler/v1/x.pbf", "/api/representation/ocd-division/country:us"]) {
    assert.equal(runs(path), true, `${path} must run the middleware`);
  }
});

test("every admin route is matched on both hosts, even one that looks like a file", () => {
  const adminHost = new URL(ADMIN_ORIGIN).host;
  for (const host of ["meanwhileusa.com", adminHost, "unknown.invalid"]) {
    for (const path of ["/admin", "/admin/login", "/admin/fleet", "/admin/x.js", "/admin/data.json", "/api/admin/session", "/api/admin/v6/resident-tasks/shot/a.png"]) {
      assert.equal(runs(path, host), true, `${path} on ${host} must run the middleware`);
    }
  }
});

test("the admin host still refuses every non-admin path, files included", () => {
  assert.equal(new URL(ADMIN_ORIGIN).host, "admin.meanwhileusa.com", "the matcher literal mirrors ADMIN_ORIGIN");
  for (const path of ["/", "/geo/state-outlines.geojson", "/maplibre-gl-worker.mjs", "/place/az"]) {
    assert.equal(runs(path, "admin.meanwhileusa.com"), true, `${path} on the admin host must run the middleware`);
  }
});

test("one matcher list, no leftover broad pattern", () => {
  assert.equal(config.matcher.filter((m) => typeof m === "string" && m.startsWith("/((?!")).length, 1);
});
