import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { build } from "esbuild";
import { launchGuarded } from "../scripts/browser.mts";
import { READER_START_SCRIPT } from "../lib/reader/bootstrap.ts";

test("the arriving page starts state and place before hydration and the reader consumes each response once", async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), contents: `
    import {resolveStoredZip} from './hooks/use-stored-zip.ts';
    import {loadReaderState} from './lib/reader/client.ts';
    import {fetchReaderResponse,readReaderJson} from './lib/reader/bootstrap.ts';
    const location=await resolveStoredZip(JSON.stringify({zip:'85701'}));
    const response=await fetchReaderResponse('/api/meetings?lat=32&lng=-110&zip=85701');
    const bodyUsedBefore=response.bodyUsed;
    const [state,place]=await Promise.all([loadReaderState(location.postal.state,location.zip),readReaderJson(response)]);
    const bodyUsedAfter=response.bodyUsed;
    const rejectsSecondRead=await response.json().then(()=>false,error=>error.name==='TypeError');
    window.answer={location,state,place,bodyUsedBefore,bodyUsedAfter,rejectsSecondRead};
    window.openZip=async zip=>{
      const location=await resolveStoredZip(JSON.stringify({zip}));
      const response=await fetchReaderResponse('/api/meetings?lat='+location.lat+'&lng='+location.lng+'&zip='+zip);
      const [state,place]=await Promise.all([loadReaderState(location.postal.state,zip),readReaderJson(response)]);
      return {location,state,place,bodyUsed:response.bodyUsed};
    };
    window.lookupZip=zip=>resolveStoredZip(JSON.stringify({zip}));
    const previousResponse=new Response(JSON.stringify({from:'body'}));
    window.__readerStart.parsed.set(previousResponse,Promise.resolve({from:'early parser'}));
    window.readPreviousResponse=()=>readReaderJson(previousResponse);
    let cancellationResolved=false;
    const pendingCancellation=new Promise(resolve=>{window.releaseCancellation=()=>{cancellationResolved=true;resolve()}});
    const held=new Response(new ReadableStream({cancel:()=>pendingCancellation}));
    window.__readerStart.parsed.set(held,Promise.resolve({held:true}));
    void readReaderJson(held).then(value=>{window.delayedAnswer={value,bodyUsed:held.bodyUsed,cancellationResolved}});
  ` }, bundle: true, write: false, format: "esm", platform: "browser", define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent" });
  const requests: string[] = [];
  let releaseClient = () => {};
  const early = new Promise<void>(resolve => { releaseClient = resolve; });
  let releaseNextLocation = () => {};
  const nextLocation = new Promise<void>(resolve => { releaseNextLocation = resolve; });
  const server = createServer(async (request, response) => {
    const url = request.url!;
    if (url.startsWith("/api/")) requests.push(url);
    if (url.startsWith("/api/location/zip")) {
      const zip = new URL(url,"http://localhost").searchParams.get("zip");
      if (zip === "85003") await nextLocation;
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ location: { zip, lat: zip === "85003" ? 33 : 32, lng: -110,
        postal: { state: "AZ", place:"Fixture place",county:"Fixture county" } } }));
    }
    else if (url.startsWith("/api/reader/state")) response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ state: "AZ", version: "held" }));
    else if (url.startsWith("/api/meetings")) response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ meetings: ["held"] }));
    else if (url === "/client.js") { await early; response.writeHead(200, { "content-type": "application/javascript" }).end(bundle.outputFiles[0].text); }
    else response.writeHead(200, { "content-type": "text/html" }).end(`<!doctype html><head><script>${READER_START_SCRIPT}</script></head><body><script type="module" src="/client.js"></script></body>`);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  let browser: Awaited<ReturnType<typeof launchGuarded>> | null = null;
  try {
    browser = await launchGuarded({ label: "rs-01-early-reader", blockWrites: true });
    const page = await (await browser.context()).newPage();
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${address.port}/?zip=85701`, { waitUntil: "commit" });
    await page.waitForFunction(() => Object.keys(window.__readerStart?.requests ?? {}).length === 2);
    const parsedBeforeHydration = await page.evaluate(async () => {
      const start = window.__readerStart!;
      return Promise.all(Object.values(start.requests).map(async pending => {
        const response = await pending;
        return { value: await start.parsed.get(response), bodyUsed: response.bodyUsed };
      }));
    });
    assert.equal(parsedBeforeHydration.length, 2);
    assert.ok(parsedBeforeHydration.every(row => row.value && row.bodyUsed === false), "both responses parse while client JavaScript remains blocked, preserving their native bodies");
    assert.equal(await page.evaluate(() => "answer" in window), false);
    releaseClient();
    await page.waitForFunction(() => "answer" in window);
    const answer = await page.evaluate(() => (window as unknown as { answer: { location: {zip: string}; state: {state: string}; place: {meetings: string[]}; bodyUsedBefore: boolean; bodyUsedAfter: boolean; rejectsSecondRead: boolean } }).answer);
    assert.equal(answer.location.zip, "85701"); assert.equal(answer.state.state, "AZ"); assert.deepEqual(answer.place.meetings, ["held"]);
    assert.equal(answer.bodyUsedBefore, false); assert.equal(answer.bodyUsedAfter, true); assert.equal(answer.rejectsSecondRead, true);
    await page.waitForFunction(() => "delayedAnswer" in window);
    assert.deepEqual(await page.evaluate(() => (window as unknown as { delayedAnswer: unknown }).delayedAnswer), { value: { held: true }, bodyUsed: true, cancellationResolved: false }, "parsed data is available while original-stream cancellation is still pending");
    await page.evaluate(() => (window as unknown as { releaseCancellation: () => void }).releaseCancellation());
    assert.deepEqual(requests.sort(), ["/api/location/zip?zip=85701", "/api/reader/state?zip=85701", "/api/meetings?zip=85701"].sort());
    const starts = ["/api/location/zip","/api/reader/state","/api/meetings"].map(path => page.waitForRequest(request => {
      const url = new URL(request.url());return url.pathname===path && url.searchParams.get("zip")==="85003";
    }));
    await page.evaluate(() => {
      const reader = window as unknown as {openZip:(zip:string)=>Promise<unknown>;nextAnswer?:unknown};
      void reader.openZip("85003").then(answer=>{reader.nextAnswer=answer;});
    });
    await Promise.all(starts);
    assert.equal(await page.evaluate(() => "nextAnswer" in window),false,"both data reads start while the new ZIP location is still pending");
    assert.deepEqual(await page.evaluate(() => (window as unknown as {readPreviousResponse:()=>Promise<unknown>}).readPreviousResponse()),
      {from:"early parser"},"a response from the previous ZIP still consumes its parsed value after a new ZIP starts");
    releaseNextLocation();
    await page.waitForFunction(() => "nextAnswer" in window);
    const next = await page.evaluate(() => (window as unknown as {nextAnswer:{location:{zip:string};state:{state:string};place:{meetings:string[]};bodyUsed:boolean}}).nextAnswer);
    assert.equal(next.location.zip,"85003");assert.equal(next.state.state,"AZ");assert.deepEqual(next.place.meetings,["held"]);assert.equal(next.bodyUsed,true);
    assert.deepEqual(requests.sort(),["85701","85003"].flatMap(zip=>[`/api/location/zip?zip=${zip}`,`/api/reader/state?zip=${zip}`,`/api/meetings?zip=${zip}`]).sort(),
      "the new ZIP consumes state and place once without fetching their resolved aliases again");
    const beforeReverse = requests.length;
    const reverse = await page.evaluate(async () => {
      const lookup = (window as unknown as {lookupZip:(zip:string)=>Promise<{zip:string}>}).lookupZip;
      return [(await lookup("85701")).zip,(await lookup("85003")).zip];
    });
    assert.deepEqual(reverse,["85701","85003"]);
    assert.equal(requests.length,beforeReverse,"initial restoration and subsequent choices both populate the ZIP cache; reversing starts no extra reads");
    await page.evaluate(async () => {
      history.pushState(null,"","/ballot");
      await (window as unknown as {lookupZip:(zip:string)=>Promise<unknown>}).lookupZip("10001");
    });
    assert.deepEqual(requests.slice(-1),["/api/location/zip?zip=10001"],"a lookup outside the map starts only its location request");
    assert.equal(requests.length,beforeReverse+1);
    assert.deepEqual(errors, []);
  } finally { releaseClient();releaseNextLocation(); await browser?.close(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
