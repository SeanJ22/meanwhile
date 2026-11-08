/**
 * TC-02 · Plain files never run the middleware. Every file under public/ (and the app icons, the generated map worker, /_next/static)
 * is excluded by the matcher, while pages, API routes and every admin route stay matched.
 * Each matcher is compiled by Next's own compiler and used the way Netlify's Next runtime writes it into the edge manifest (pattern only, no host condition).
 */
import assert from "node:assert/strict";

import { join, relative, sep } from "node:path";
import test from "node:test";

import * as pageStaticInfo from "next/dist/build/analysis/get-page-static-info.js";

import { config } from "@/middleware.ts";
import { walkFiles } from "./helpers/walk-files.ts";

const ROOT = join(import.meta.dirname, "..");
// Next ships no declaration for this internal; it is the function `next build` itself uses to compile `config.matcher`.
const getMiddlewareMatchers = (pageStaticInfo as unknown as { getMiddlewareMatchers(matcher: unknown, nextConfig: object): never }).getMiddlewareMatchers;

/** What Netlify's Next runtime writes into the edge manifest: one path `pattern` per matcher, the matcher's compiled regexp. It carries no `has` host condition. */
const patterns = (getMiddlewareMatchers(config.matcher, {}) as unknown as { regexp: string }[]).map((m) => new RegExp(m.regexp));

function runs(path: string): boolean {
  return patterns.some((pattern) => pattern.test(path));
}

function files(dir: string): string[] {
  return walkFiles(dir);
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

test("every admin route is matched, even one that looks like a file", () => {
  for (const path of ["/admin", "/admin/login", "/admin/fleet", "/admin/x.js", "/admin/data.json", "/api/admin/session", "/api/admin/v6/resident-tasks/shot/a.png"]) {
    assert.equal(runs(path), true, `${path} must run the middleware`);
  }
});

test("no matcher waits on a host, because Netlify drops that condition and would run the middleware on every request", () => {
  assert.deepEqual(config.matcher.filter((m) => typeof m !== "string"), []);
});

test("one matcher list, no leftover broad pattern", () => {
  assert.equal(config.matcher.filter((m) => typeof m === "string" && m.startsWith("/((?!")).length, 1);
});
