import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { build } from "esbuild";
import { readerStartScript } from "../lib/reader/bootstrap.ts";
import { launchGuarded } from "../scripts/browser.mts";

test("HTML starts styles and fonts, then the renderer reuses only its visible tiles", async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), contents: `import * as map from "./lib/map/first-view.ts"; window.consumeFirstMap=(url,type)=>map.firstMapProtocol({...map.arrivingMapRequest(url),type},new AbortController());` }, bundle: true, write: false, format: "iife", platform: "browser" });
  const requests: string[] = [];
  const server = createServer((request, response) => {
    const url = request.url!; requests.push(url);
    response.setHeader("Cache-Control", "public, max-age=3600");
    if (url === "/start.js") return response.setHeader("Content-Type", "text/javascript").end(bundle.outputFiles[0].text);
    if (url === "/") return response.setHeader("Content-Type", "text/html").end(`<script>${readerStartScript("", `${origin}/fonts/Noto%20Sans%20Regular/0-255.pbf`)}</script><script>window.__readerStart={location:Promise.resolve({zip:'00000',lat:.01,lng:.01})}</script><script async src="/start.js" data-map-dark="${origin}/style.json?key=fixture"></script>`);
    if (url.startsWith("/style.json")) return response.setHeader("Content-Type", "application/json").end(JSON.stringify({
      version: 8, glyphs: `${origin}/fonts/{fontstack}/{range}.pbf`, sprite: `${origin}/sprite`,
      sources: { basemap: { type: "vector", url: `${origin}/source.json` }, later: { type: "vector", url: `${origin}/offscreen.json` } },
      layers: [{ id: "labels", type: "symbol", source: "basemap", "source-layer": "labels", layout: { "text-font": ["Noto Sans Regular"] } }, { id: "later", type: "line", source: "later", "source-layer": "later", minzoom: 18 }],
    }));
    if (url.startsWith("/tiles.json") || url === "/source.json") return response.setHeader("Content-Type", "application/json").end(JSON.stringify({
      tilejson: "3.0.0", name: "provider metadata", minzoom: 0, maxzoom: 14,
      tiles: [`${origin}/${url === "/source.json" ? "vector" : "raster"}/{z}/{x}/{y}`],
    }));
    if (url === "/sprite.json") return response.setHeader("Content-Type", "application/json").end(JSON.stringify({ icon: { width: 1 } }));
    response.end(new Uint8Array());
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  const browser = await launchGuarded({ label: "cx-map-first-view", headless: true, blockWrites: true });
  try {
    const page = await browser.page({ viewport: { width: 390, height: 844 } });
    await page.goto(origin, { waitUntil: "networkidle" });
    const vectorStarted = page.waitForRequest(request => request.url().startsWith(`${origin}/vector/11/`));
    const styles = await page.evaluate(async () => {
      const start = window.__readerMapStart!; start.select(false);
      return { vector: await start.vector, raster: await start.raster };
    });
    await vectorStarted; await page.evaluate(() => Promise.all(window.__readerMapResources!.values()).then(() => undefined));
    assert.equal(styles.vector.layers[0].id, "labels", "the complete provider style survives preloading");
    assert.ok("tiles" in styles.vector.sources.basemap && !('url' in styles.vector.sources.basemap));
    assert.ok(!('tilejson' in styles.raster.sources.basemap), "provider metadata is not passed as invalid style properties");
    assert.ok(requests.includes("/fonts/Noto%20Sans%20Regular/0-255.pbf"));
    assert.ok(requests.includes("/sprite.json") && requests.includes("/sprite.png"));
    assert.ok(requests.some(url => url.startsWith("/vector/11/")) && !requests.some(url => url.startsWith("/raster/")));
    assert.ok(!requests.some(url => /\/(vector|raster)\/10\//.test(url)), "no off-screen overview delays the first view");
    assert.ok(!requests.includes("/offscreen.json"), "off-screen sources never hold up the first style");
    assert.ok(!requests.some(url => url.startsWith("/api/")), "map warmup adds no database-backed request");
    const before = requests.length;
    await page.evaluate(async ({ origin, tile }) => {
      const consume = (window as unknown as { consumeFirstMap: (url: string, type: string) => Promise<{ data: unknown }> }).consumeFirstMap;
      const sprite = await consume(`${origin}/sprite.json`, "json");
      if (JSON.stringify(sprite.data) !== '{"icon":{"width":1}}') throw new Error("Sprite metadata lost");
      await consume(`${origin}${tile}`, "arrayBuffer");
      await consume(`${origin}/fonts/Noto Sans Regular/0-255.pbf`, "arrayBuffer");
    }, { origin, tile: requests.find(url => url.startsWith("/vector/11/"))! });
    assert.equal(requests.length, before, "renderer consumes the first tile and sprite without a second request, even with HTTP caching disabled");
    requests.length = 0;
    await page.reload({ waitUntil: "networkidle" });
    const rasterStarted = page.waitForRequest(request => request.url().startsWith(`${origin}/raster/11/`));
    await page.evaluate(() => window.__readerMapStart!.select(true));
    await rasterStarted;
    await page.evaluate(() => Promise.all(window.__readerMapResources!.values()).then(() => undefined));
    assert.ok(requests.some(url => url.startsWith("/raster/11/")) && !requests.some(url => url.startsWith("/vector/")), "software graphics never fetch unused vector tiles");
    assert.ok(!requests.includes("/sprite.png"), "software graphics never fetch unused vector sprites");
  } finally { await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
