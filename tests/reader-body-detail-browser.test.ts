import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { build } from "esbuild";
import { launchGuarded } from "../scripts/browser.mts";

test("a body opens with one keyed request and reports loading or failure honestly", async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import React,{useState} from 'react'; import {createRoot} from 'react-dom/client';
    import {useBodyDetail} from './hooks/use-body-detail.ts';
    function App(){const [open,setOpen]=useState(false);const value=useBodyDetail('AZ',open?'body:one':null,open);
      return <><button onClick={()=>setOpen(!open)}>Toggle</button><p id="status">{value.status}</p>
        <p id="name">{value.detail?.roster.members[0]?.name??''}</p></>};
    createRoot(document.getElementById('root')).render(<App/>);
  ` }, bundle: true, write: false, format: "esm", platform: "browser", logLevel: "silent" });
  let requests = 0;
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === "/client.js") return response.writeHead(200, { "content-type": "application/javascript" }).end(bundle.outputFiles[0].text);
    if (url.pathname === "/api/reader/body") {
      requests++;
      assert.equal(url.searchParams.get("state"), "AZ");
      assert.equal(url.searchParams.get("body"), "body:one");
      const attempt = requests;
      setTimeout(() => attempt === 1 ? response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({
        bodyId: "body:one", roster: { members: [{ id: "person:1", name: "A Person" }], gaps: [], officePhone: null },
      })) : response.writeHead(503).end(), 150);
      return;
    }
    response.writeHead(200, { "content-type": "text/html" }).end('<div id="root"></div><script type="module" src="/client.js"></script>');
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  let browser: Awaited<ReturnType<typeof launchGuarded>> | null = null;
  try {
    browser = await launchGuarded({ label: "zs-body-detail", blockWrites: true });
    const page = await (await browser.context()).newPage();
    await page.goto(`http://127.0.0.1:${address.port}/`);
    await page.waitForSelector("#status");
    assert.equal(requests, 0);
    await page.getByRole("button", { name: "Toggle" }).click();
    await page.getByText("loading", { exact: true }).waitFor();
    await page.getByText("A Person", { exact: true }).waitFor();
    assert.equal(requests, 1);
    await page.getByRole("button", { name: "Toggle" }).click();
    await page.getByText("idle", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Toggle" }).click();
    await page.getByText("loading", { exact: true }).waitFor();
    await page.getByText("unavailable", { exact: true }).waitFor();
    assert.equal(await page.locator("#name").textContent(), "");
    assert.equal(requests, 2);
  } finally {
    await browser?.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test("the officials list requests each needed body only after it opens", async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import React,{useState} from 'react'; import {createRoot} from 'react-dom/client';
    import {useBodyDetails} from './hooks/use-body-details.ts';
    const bodies=['one','two'].map(id=>({bodyId:id,readerState:'AZ',rosterSummary:{memberCount:1,hasSelectBoard:false}}));
    window.calls=[];window.fetch=async url=>{const body=new URL(url,location.href).searchParams.get('body');window.calls.push(body);
      return Response.json({bodyId:body,roster:{members:[{id:body,name:body}],gaps:[],officePhone:null}})};
    function App(){const [open,setOpen]=useState(false),value=useBodyDetails(bodies,open);
      return <><button onClick={()=>setOpen(true)}>Open officials</button><p id="pending">{String(value.pending)}</p>
        <p id="members">{value.bodies.flatMap(body=>body.readerRoster?.members??[]).map(member=>member.name).join(',')}</p></>};
    createRoot(document.getElementById('root')).render(<App/>);
  ` }, bundle: true, write: false, format: "esm", platform: "browser", logLevel: "silent" });
  const server = createServer((request, response) => request.url === "/client.js"
    ? response.writeHead(200, { "content-type": "application/javascript" }).end(bundle.outputFiles[0].text)
    : response.writeHead(200, { "content-type": "text/html" }).end('<div id="root"></div><script type="module" src="/client.js"></script>'));
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  let browser: Awaited<ReturnType<typeof launchGuarded>> | null = null;
  try {
    browser = await launchGuarded({ label: "zs-body-list", blockWrites: true });
    const page = await (await browser.context()).newPage();
    await page.goto(`http://127.0.0.1:${address.port}/`);
    await page.waitForSelector("#pending");
    assert.deepEqual(await page.evaluate(() => (window as unknown as { calls: string[] }).calls), []);
    await page.getByRole("button", { name: "Open officials" }).click();
    await page.getByText("one,two", { exact: true }).waitFor();
    assert.deepEqual((await page.evaluate(() => (window as unknown as { calls: string[] }).calls)).sort(), ["one", "two"]);
  } finally {
    await browser?.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
