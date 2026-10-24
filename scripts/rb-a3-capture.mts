import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { launchGuarded } from "./browser.mts";
import { PUBLIC_SITE_ORIGIN } from "../lib/ops/origins.ts";
import type { CoveredBody } from "../lib/registry/coverage.ts";

const directory = process.argv[2] ?? ".scratch/rb-a3";
mkdirSync(directory, { recursive: true });
const browser = await launchGuarded({ label: "rb-a3-production-capture", blockWrites: true, headless: true,
  args: ["--no-sandbox"], proxy: { server: process.env.HTTPS_PROXY ?? "http://proxy:8080" } });
try {
  const context = await browser.context({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
  await context.route("**/*", async route => {
    if (!["GET", "HEAD", "OPTIONS"].includes(route.request().method())) await route.abort("blockedbyclient");
    else await route.fallback();
  });
  const page = await context.newPage();
  for (const [name, url] of [
    ["mesa-api", "https://webapi.legistar.com/v1/mesa/Bodies?$filter=BodyActiveFlag%20eq%201"],
    ["mesa-gov", "https://www.mesaaz.gov/Government/Mayor-City-Council"],
  ]) {
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    assert.equal(response?.status(), 200, url);
    writeFileSync(`${directory}/${name}.txt`, await page.locator("body").innerText());
    writeFileSync(`${directory}/${name}.html`, await page.content());
  }
  const pending: Promise<void>[] = [];
  let baseline: { coverage: { bodies: CoveredBody[] }; meetings: unknown[] } | undefined;
  page.on("response", response => {
    if (response.url().includes("/api/meetings?") && response.url().includes("include=state")) pending.push((async () => {
      assert.equal(response.status(), 200);
      const text = await response.text();
      baseline = JSON.parse(text);
      writeFileSync(`${directory}/mesa-meetings.json`, text);
    })());
  });
  const response = await page.goto(`${PUBLIC_SITE_ORIGIN}/?zip=85201`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  assert.equal(response?.status(), 200);
  await page.getByRole("button", { name: "Skip", exact: true }).click({ timeout: 15_000 }).catch(() => {});
  await page.getByRole("button", { name: "Who governs here?", exact: true }).click();
  await page.getByRole("button", { name: "City Council", exact: true }).click();
  await page.screenshot({ path: `${directory}/mesa-reader.png`, fullPage: true });
  writeFileSync(`${directory}/mesa-reader-body.txt`, await page.locator("body").innerText());
  await Promise.all(pending);
  assert(baseline);

  // Copy just this page's published registry metadata, through the authorized read-only role.
  const connection = process.env.WTP_PRODUCTION_DATABASE_URL_READONLY;
  assert(connection && new URL(connection).username === "readonly", "The specified reader readonly connection is required");
  const query = neon(connection);
  const rows = await query.query(`WITH root AS (
    SELECT reader_payload_node(payload) p FROM civic_data_promotions WHERE key='REGISTRY_RUNTIME_BINDING:US-AZ:reader-registry-runtime'
  ), r AS (SELECT reader_payload_node(p->'registry') p FROM root)
  SELECT jsonb_build_object('generatedAt',r.p->'generatedAt',
    'bodies',(SELECT jsonb_agg(reader_payload_node(b.item)) FROM reader_payload_members(r.p->'bodies') b WHERE reader_payload_node(b.item)->>'id'=ANY($1::text[])),
    'divisions',(SELECT jsonb_agg(reader_payload_node(d.item)) FROM reader_payload_members(r.p->'divisions') d WHERE reader_payload_node(d.item)->>'ocdId'=ANY($2::text[]))) registry FROM r`,
  [baseline.coverage.bodies.map(body => body.bodyId), baseline.coverage.bodies.map(body => body.ocdId)]);
  writeFileSync(`${directory}/mesa-runtime.json`, JSON.stringify(rows[0].registry));
  console.log(JSON.stringify({ observedAt: new Date().toISOString(), page: page.url(), status: response?.status(),
    bodies: baseline.coverage.bodies.length, meetings: baseline.meetings.length, writesBlocked: browser.writesBlocked.count }));
} finally { await browser.close(); }
