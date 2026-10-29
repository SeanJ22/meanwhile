import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { build } from "esbuild";
import { launchGuarded } from "../scripts/browser.mts";

test("HTML starts the full style, fonts and only visible tiles before the page module", async () => {
  const bundle = await build({ entryPoints: ["lib/map/first-view.ts"], bundle: true, write: false, format: "iife", platform: "browser" });
  const requests: string[] = [];
  const server = createServer((request, response) => {
    const url = request.url!; requests.push(url);
    response.setHeader("Cache-Control", "public, max-age=3600");
    if (url === "/start.js") return response.setHeader("Content-Type", "text/javascript").end(bundle.outputFiles[0].text);
    if (url === "/") return response.setHeader("Content-Type", "text/html").end(`<script>window.__readerStart={location:Promise.resolve({zip:'00000',lat:.01,lng:.01})}</script><script async src="/start.js" data-map-dark="${origin}/style.json?key=fixture"></script>`);
    if (url.startsWith("/style.json")) return response.setHeader("Content-Type", "application/json").end(JSON.stringify({
      version: 8, glyphs: `${origin}/fonts/{fontstack}/{range}.pbf`, sprite: `${origin}/sprite`,
      sources: { basemap: { type: "vector", url: `${origin}/source.json` }, later: { type: "vector", url: `${origin}/offscreen.json` } },
      layers: [{ id: "labels", type: "symbol", source: "basemap", "source-layer": "labels", layout: { "text-font": ["Noto Sans Regular"] } }, { id: "later", type: "line", source: "later", "source-layer": "later", minzoom: 18 }],
    }));
    if (url.startsWith("/tiles.json") || url === "/source.json") return response.setHeader("Content-Type", "application/json").end(JSON.stringify({
      tilejson: "3.0.0", name: "provider metadata", minzoom: 0, maxzoom: 14,
      tiles: [`${origin}/${url === "/source.json" ? "vector" : "raster"}/{z}/{x}/{y}`],
    }));
    response.end(new Uint8Array());
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  const browser = await launchGuarded({ label: "cx-map-first-view", headless: true, blockWrites: true });
  try {
    const page = await browser.page({ viewport: { width: 390, height: 844 } });
    await page.goto(origin, { waitUntil: "networkidle" });
    const styles = await page.evaluate(async () => {
      const start = window.__readerMapStart!;
      return { vector: await start.vector, raster: await start.raster };
    });
    assert.equal(styles.vector.layers[0].id, "labels", "the complete provider style survives preloading");
    assert.ok("tiles" in styles.vector.sources.basemap && !('url' in styles.vector.sources.basemap));
    assert.ok(!('tilejson' in styles.raster.sources.basemap), "provider metadata is not passed as invalid style properties");
    assert.ok(requests.includes("/fonts/Noto%20Sans%20Regular/0-255.pbf"));
    assert.ok(requests.includes("/sprite.json") && requests.includes("/sprite.png"));
    assert.ok(requests.some(url => url.startsWith("/vector/11/")) && requests.some(url => url.startsWith("/raster/11/")));
    assert.ok(!requests.some(url => /\/(vector|raster)\/10\//.test(url)), "no off-screen overview delays the first view");
    assert.ok(!requests.includes("/offscreen.json"), "off-screen sources never hold up the first style");
    assert.ok(!requests.some(url => url.startsWith("/api/")), "map warmup adds no database-backed request");
  } finally { await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
