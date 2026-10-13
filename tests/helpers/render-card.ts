import assert from "node:assert/strict";
import { createServer } from "node:http";
import { build } from "esbuild";
import { launchGuarded } from "../../scripts/browser.mts";

/** Mount the actual leaf and card so source-contribution effects reach the footer. */
export async function renderCardWithSources({ modulePath, exportName, props, sourceUrls }: {
  modulePath: string;
  exportName: string;
  props: object;
  sourceUrls: readonly string[];
}): Promise<string> {
  const output = await build({
    stdin: {
      contents: `import React from "react"; import {createRoot} from "react-dom/client";
        import {Card} from "./components/ui/card.tsx";
        import {${exportName} as Content} from ${JSON.stringify(modulePath)};
        createRoot(document.getElementById("root")).render(<Card title="Fixture card" sources={[]}><Content {...${JSON.stringify(props)}} /></Card>);`,
      resolveDir: process.cwd(), sourcefile: "card-source-fixture.tsx", loader: "tsx",
    },
    bundle: true, write: false, outfile: ".scratch/card-source-fixture.js",
    platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent",
  });
  const javascript = output.outputFiles.find(file => file.path.endsWith(".js"))?.text;
  const stylesheet = output.outputFiles.find(file => file.path.endsWith(".css"))?.text ?? "";
  assert.ok(javascript);
  const server = createServer((request, response) => {
    if (request.url === "/fixture.js") response.writeHead(200, { "content-type": "application/javascript" }).end(javascript);
    else if (request.url === "/fixture.css") response.writeHead(200, { "content-type": "text/css" }).end(stylesheet);
    else if (request.url === "/") response.writeHead(200, { "content-type": "text/html" }).end('<!doctype html><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script>');
    else response.writeHead(200, { "content-type": "application/json" }).end("{}");
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  let browser: Awaited<ReturnType<typeof launchGuarded>> | null = null;
  try {
    browser = await launchGuarded({ label: "card-source-leaf" });
    const context = await browser.context();
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${address.port}/`);
    await page.waitForFunction(urls => {
      const links = [...document.querySelectorAll<HTMLAnchorElement>("[data-card-sources] a")].map(link => link.href);
      return urls.every(url => links.includes(url));
    }, sourceUrls);
    assert.equal(await page.locator("[data-card-sources]").count(), 1);
    assert.equal(await page.getByRole("button", { name: /^Sources/ }).count(), 1);
    await page.getByRole("button", { name: /^Sources/ }).click();
    const markup = await page.locator(".reader-card").evaluate(card => card.outerHTML);
    await context.close();
    return markup;
  } finally {
    await browser?.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}
