/**
 * Admin's Now and Workers pages, rendered from section data in a browser and photographed, for before/after
 * reviews. It mounts the real command center (CommandCenter, buildLiveBundle) the way the Admin tests do, styled
 * with the built app's global stylesheet, and answers the panels that read their own routes (doors, settings,
 * updates) from the same fixture. No server, database or production read is involved.
 *
 *   pnpm build                                   # for the global stylesheet in .next/static
 *   ADMIN_SHOTS_LABEL=after pnpm exec tsx scripts/admin-now-shots.mts
 *
 * Writes docs/design/admin-now/<label>/{now,workers}-{desktop,narrow}.png and the pages' text.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { build } from "esbuild";

import { launchGuarded } from "./browser.mts";
import { adminNowFixture } from "../tests/fixtures/admin-now/fixture.ts";

const LABEL = process.env.ADMIN_SHOTS_LABEL ?? "after";
const OUT = join("docs", "design", "admin-now", LABEL);
mkdirSync(OUT, { recursive: true });

const fixture = adminNowFixture(LABEL === "before" ? "before" : "after");
const css = readdirSync(".next/static/chunks").filter((f) => f.endsWith(".css")).map((f) => readFileSync(join(".next/static/chunks", f), "utf8")).join("\n");
if (!css) throw new Error("No built stylesheet in .next/static/chunks: run `pnpm build` first.");

const entry = `
  import React from "react";
  import { createRoot } from "react-dom/client";
  import AdminLayout from "./app/(admin)/layout.tsx";
  import { CommandCenter } from "./app/(admin)/_mw/admin-v6/command-center.tsx";
  import { liveExecutor } from "./app/(admin)/_mw/admin-v6/executor.ts";
  import { buildLiveBundle } from "./app/(admin)/_mw/admin-v6/live-data.ts";
  import { workerStatusFromPulse } from "./app/(admin)/_mw/admin-v6/pulse-view.ts";

  const f = window.__ADMIN_FIXTURE__;
  const view = new URLSearchParams(location.search).get("view") || "now";
  createRoot(document.getElementById("root")).render(
    <AdminLayout><div className="admin">
      <CommandCenter data={buildLiveBundle(f.snapshot, f.reference, workerStatusFromPulse(f.pulse))} mode="live"
        executor={liveExecutor({ capabilities: () => null })} scopeKey="us" onScopeChange={() => {}} connection="live"
        lastGoodAt={f.reference.observedAt} recovered={false} access={{ role: "owner", canSpend: true, outreachAuthorized: false }}
        initialView={view} />
    </div></AdminLayout>,
  );
`;

const bundle = await build({
  stdin: { contents: entry, resolveDir: process.cwd(), sourcefile: "admin-now-shots.tsx", loader: "tsx" },
  alias: { "@": process.cwd() }, bundle: true, platform: "browser", format: "iife", write: false, outdir: "out",
  loader: { ".module.css": "local-css", ".css": "css" }, jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
});
const js = bundle.outputFiles.find((f) => f.path.endsWith(".js"))!.text;
const moduleCss = bundle.outputFiles.filter((f) => f.path.endsWith(".css")).map((f) => f.text).join("\n");

const html = () => `<!doctype html><html data-theme="dark"><head><meta charset="utf-8"><style>${css}</style><style>${moduleCss}</style></head>
<body style="margin:0;background:var(--bg)"><div id="root"></div></body></html>`;

const VIEWPORTS = [{ name: "desktop", width: 1440, height: 1000 }, { name: "narrow", width: 900, height: 1000 }] as const;
const browser = await launchGuarded({ label: `admin-now-${LABEL}` });
try {
  for (const viewport of VIEWPORTS) {
    for (const view of ["now", "workers"]) {
      const context = await browser.context({ viewport: { width: viewport.width, height: viewport.height } });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.route("http://admin.local/**", (route) => {
        const url = new URL(route.request().url());
        if (url.pathname === "/admin") return route.fulfill({ status: 200, contentType: "text/html", body: html() });
        const answer = fixture.routes[url.pathname];
        return answer ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(answer) }) : route.fulfill({ status: 503, body: "{}" });
      });
      await page.addInitScript((f) => { (window as unknown as { __ADMIN_FIXTURE__: unknown }).__ADMIN_FIXTURE__ = f; }, fixture);
      await page.clock.install({ time: new Date(fixture.reference.observedAt) });
      await page.goto(`http://admin.local/admin?view=${view}`);
      await page.addScriptTag({ content: js });
      await page.waitForTimeout(1500);
      await page.screenshot({ path: join(OUT, `${view}-${viewport.name}.png`), fullPage: true });
      writeFileSync(join(OUT, `${view}-${viewport.name}.txt`), await page.locator("body").innerText());
      if (errors.length) console.error(view, viewport.name, errors);
      await context.close();
    }
  }
} finally {
  await browser.close();
}
console.log(`wrote ${OUT}`);
