/** Exercise the real owed editor and setting gateway against disposable local Postgres. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { build } from "esbuild";
import { PGlite } from "@electric-sql/pglite";
import { launchGuarded } from "./browser.mts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { pgAggregateRepository } from "../lib/control-plane/repository/pg-store.ts";
import { ADMIN_SECTIONS_EXPAND_DDL, pgAdminConfigRepository } from "../lib/control-plane/repository/admin-config.ts";
import { DEFAULT_OWED_TABLE, OWED_TABLE_SETTING, owedTable } from "../lib/coverage/owed-table.ts";
import { projectSettings } from "../lib/control-plane/admin-view/v6-settings-read.ts";
import type { AdminConfig } from "../lib/control-plane/gateway/admin-config.ts";
import { submit } from "../lib/control-plane/gateway/gateway.ts";

const out = ".scratch/rb-a6-admin-check";
mkdirSync(`${out}/public`, { recursive: true });
writeFileSync(`${out}/entry.tsx`, `import React from 'react';import{createRoot}from'react-dom/client';import{OwedPanel}from'../../app/(admin)/_mw/admin-v6/owed-panel.tsx';import s from'../../app/(admin)/_mw/admin-v6/v6.module.css';createRoot(document.getElementById('app')!).render(<div className={s.root}><OwedPanel/></div>);`);
await build({ entryPoints: [`${out}/entry.tsx`], bundle: true, outdir: `${out}/public`, jsx: "automatic", platform: "browser",
  define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" } });
const pg = new PGlite();
await pg.exec("CREATE TABLE cp_admin_config(id text PRIMARY KEY,revision bigint NOT NULL,updated_at timestamptz NOT NULL,value jsonb NOT NULL,changed_at timestamptz DEFAULT now())");
for (const ddl of ADMIN_SECTIONS_EXPAND_DDL) await pg.exec(ddl);
const query = async (text: string, params: readonly unknown[] = []) => (await pg.query<Record<string, unknown>>(text, [...params])).rows;
const repos = { ...createMemoryRepositories(), adminConfig: pgAdminConfigRepository(pgAggregateRepository<AdminConfig>({ query }, "AdminConfig", "cp_admin_config"), query) };
const production = JSON.parse(readFileSync("docs/rb-a6/production.json", "utf8"));
const rootStyle = readFileSync("app/globals.css", "utf8").match(/:root\s*\{[^}]+\}/)?.[0] ?? "";
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url!, "http://localhost");
    const now = new Date().toISOString();
    if (url.pathname === "/api/admin/v6/owed") {
      const held = await repos.adminConfig.read("current", { settingHistory: { latestPerKey: 20 } });
      const config = held?.value ?? null;
      const setting = projectSettings({ config, heartbeat: null, published: null, observedAt: now }).rows.find(row => row.key === OWED_TABLE_SETTING);
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ data: { table: owedTable(config), setting, counts: production.counts.filter((row: {state: string}) => row.state === (url.searchParams.get("state") ?? "US")) } }));
    } else if (url.pathname === "/api/admin/action") {
      let text = ""; for await (const chunk of request) text += chunk;
      const body = JSON.parse(text);
      const result = await submit({ ...body, stateVersion: null, caller: "OWNER_SESSION", actorRef: "local-editor-test" },
        { repos, now: () => now, currentStateVersion: null, codeSha: null });
      response.setHeader("content-type", "application/json"); response.end(JSON.stringify(result));
    } else if (url.pathname === "/") {
      response.setHeader("content-type", "text/html");
      response.end(`<html><head><style>${rootStyle}body{margin:0;background:var(--bg);color:var(--text)}</style><link rel="stylesheet" href="/entry.css"></head><body><div id="app"></div><script src="/entry.js"></script></body></html>`);
    } else {
      const file = url.pathname === "/entry.js" ? "entry.js" : url.pathname === "/entry.css" ? "entry.css" : null;
      if (!file) { response.writeHead(404); response.end(); return; }
      response.setHeader("content-type", file.endsWith("css") ? "text/css" : "application/javascript"); response.end(readFileSync(`${out}/public/${file}`));
    }
  } catch (error) { response.writeHead(500); response.end(error instanceof Error ? error.message : "Local check failed"); }
});
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
const address = server.address(); assert.ok(address && typeof address !== "string");
const browser = await launchGuarded({ label: "rb-a6-admin", blockWrites: true, executablePath: process.env.RB_A6_CHROME, args: ["--no-sandbox"] });
try {
  const page = await browser.page({ viewport: { width: 1440, height: 1000 } });
  page.on("pageerror", error => console.error(error));
  await page.goto(`http://127.0.0.1:${address.port}`);
  const field = page.getByLabel("What is owed for item 1", { exact: true });
  await field.waitFor();
  await page.getByLabel("State counts", { exact: true }).selectOption("AZ");
  await page.getByRole("rowheader", { name: "Arizona", exact: true }).waitFor();
  await field.fill("Every government with authority here");
  await page.getByRole("button", { name: "Save list", exact: true }).click();
  await page.getByText("Saved.", { exact: true }).waitFor();
  const [edit] = await query("SELECT value FROM cp_admin_setting_history ORDER BY ordinal DESC LIMIT 1");
  assert.deepEqual((edit.value as {before: unknown}).before, DEFAULT_OWED_TABLE);
  await page.getByRole("button", { name: "Undo last change", exact: true }).click();
  await page.getByText("The previous list is restored.", { exact: true }).waitFor();
  assert.deepEqual(owedTable((await repos.adminConfig.mustRead("current")).value), DEFAULT_OWED_TABLE);
  await page.getByLabel("Where items are owed", { exact: true }).selectOption("AZ");
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  await field.fill("Public records contact");
  await page.getByText("Technical details", { exact: true }).click();
  await page.getByLabel("Field", { exact: true }).fill("records_contact");
  await page.getByRole("button", { name: "Save list", exact: true }).click();
  await page.getByText("Saved.", { exact: true }).waitFor();
  assert.equal(owedTable((await repos.adminConfig.mustRead("current")).value).states.AZ[0].field, "records_contact");
  await page.screenshot({ path: `${out}/state-addition.png`, fullPage: true });
  await page.getByRole("button", { name: "Undo last change", exact: true }).click();
  await page.getByText("The previous list is restored.", { exact: true }).waitFor();
  assert.deepEqual(owedTable((await repos.adminConfig.mustRead("current")).value), DEFAULT_OWED_TABLE);
  await page.getByLabel("Where items are owed", { exact: true }).selectOption("");
  await page.screenshot({ path: `${out}/baseline.png`, fullPage: false });
  const [history] = await query("SELECT count(*)::int AS n FROM cp_admin_setting_history");
  assert.equal(history.n, 4);
  console.log(`Chrome editor: baseline edit and state addition each logged and undone; ${history.n} SQL history rows.`);
} finally { await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); await pg.close(); }
