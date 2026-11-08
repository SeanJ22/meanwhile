import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { build } from "esbuild";
import { launchGuarded } from "../scripts/browser.mts";
import { readerStartScript } from "../lib/reader/bootstrap.ts";

const KEYS: Record<string, string> = { "85701": "aaaaaaaaaaaa", "86001": "bbbbbbbbbbbb" };
const zip3File = (zip: string) => ({ v: 1, zips: { [zip]: { states: ["AZ"], point: [-110, zip === "86001" ? 33 : 32], key: KEYS[zip], ids: [], partial: [], fringe: [], districts: [] } } });

test("the arriving page starts the ZIP3 file and then the one answer before hydration and the reader consumes each response once", async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), contents: `
    import {resolveStoredZip} from './hooks/use-stored-zip.ts';
    import {loadZipEntry,answerUrl} from './lib/reader/answer-client.ts';
    import {fetchReaderResponse,readReaderJson} from './lib/reader/bootstrap.ts';
    import {readyReaderZip} from './lib/reader/zip.ts';
    import {loadStateOutlines} from './lib/map/state-focus.ts';
    const ready=readyReaderZip('85701');
    const location=await resolveStoredZip(JSON.stringify({zip:'85701'}));
    const entry=await loadZipEntry('85701');
    const response=await fetchReaderResponse(answerUrl('85701',entry.key));
    const bodyUsedBefore=response.bodyUsed;
    const place=await readReaderJson(response);
    const state=place.stateResponse.value;
    const bodyUsedAfter=response.bodyUsed;
    const rejectsSecondRead=await response.json().then(()=>false,error=>error.name==='TypeError');
    const settings=await readReaderJson(await fetchReaderResponse('/api/reader/settings'));
    const outlines=await loadStateOutlines();
    const reader=window.__readerBoundary;
    const boundary=await reader.request({kind:'header',url:reader.url});
    await reader.request({kind:'prefetch',url:reader.url,zip:'85701',lat:32,lng:-110,width:innerWidth,height:innerHeight});
    const tile=await reader.request({kind:'tile',url:reader.url,z:0,x:0,y:0});
    if(new Uint8Array(tile.data)[0]!==26)throw new Error('The prefetched tile did not cross the worker boundary');
    if(boundary.specVersion!==3||boundary.etag!==undefined)throw new Error('Invalid early boundary header');
    window.answer={location,state,place,settings,outlines,ready,bodyUsedBefore,bodyUsedAfter,rejectsSecondRead};
    window.openZip=async zip=>{
      const location=await resolveStoredZip(JSON.stringify({zip}));
      const entry=await loadZipEntry(zip);
      const response=await fetchReaderResponse(answerUrl(zip,entry.key));
      const place=await readReaderJson(response);
      return {location,state:place.stateResponse.value,place,bodyUsed:response.bodyUsed};
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
  const workerBundle=await build({entryPoints:["lib/map/boundary-worker.ts"],bundle:true,write:false,format:"esm",platform:"browser",logLevel:"silent"});
  const archive=Buffer.alloc(16384);archive.write("PMTiles");archive[7]=3;
  for(const [offset,value] of [[8,127],[16,5],[24,133],[32,2],[56,132],[64,1],[72,1],[80,1],[88,1]])archive.writeBigUInt64LE(BigInt(value),offset);
  archive[96]=1;archive[97]=1;archive[98]=1;archive[99]=1;
  for(const [offset,value] of [[102,-1800000000],[106,-850000000],[110,1800000000],[114,850000000]])archive.writeInt32LE(value,offset);
  archive.set([1,0,1,1,1],127);archive[132]=26;archive.write("{}",133);
  const requests: string[] = [];
  let releaseWorker = () => {};
  const stateRequested = new Promise<void>(resolve => { releaseWorker=resolve; });
  let releaseClient = () => {};
  const early = new Promise<void>(resolve => { releaseClient = resolve; });
  let releaseNextLocation = () => {};
  const nextLocation = new Promise<void>(resolve => { releaseNextLocation = resolve; });
  const server = createServer(async (request, response) => {
    const url = request.url!;
    if (url.startsWith("/api/") || url === "/geo/state-outlines.geojson" || url === "/archive.pmtiles") requests.push(url);
    if (url.startsWith("/api/reader/zip3/")) {
      const zip = url.includes("/860.json") ? "86001" : url.includes("/857.json") ? "85701" : null;
      if (zip === "86001") await nextLocation;
      if (!zip) response.writeHead(404).end(); else response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(zip3File(zip)));
    }
    else if (url.startsWith("/api/location/zip?")) response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ location: { zip: new URL(url, "http://localhost").searchParams.get("zip"), lat: 40, lng: -74 } }));
    else if (url.startsWith("/api/answer/")) { releaseWorker(); const value={ meetings: ["held"], coverage: null, stateResponse: { status: 200, value: { state: "AZ", version: "held",
      coverage: { bodies: [], seats: [{ocdId:"ocd-division/country:us/state:az/cd:7",divisionType:"cd",label:"District 7",representatives:[{id:"congress:A000001",name:"Selected member",state:"AZ"}]}],senators:[] },
      memberDirectories: [{ids:["congress:A000001"],directory:{source:null,committees:[],
        districtOffices:[{address:"100 Example Street",city:"Tucson",state:"AZ",zip:"85701",lat:null,lng:null}],
        officeDetails:[{officeKind:"DISTRICT",official:true,sourceUrl:"https://example.gov/offices",sourceOrg:"Official office",collectedAt:"2026-10-01"}] }},
        {ids:["congress:A000002"],directory:{source:null,committees:[],districtOffices:[{address:"An unselected office"}],officeDetails:[]}}] } } };
      response.writeHead(200,{"content-type":"application/json"}).end(JSON.stringify(value)); }
    else if (url === "/api/geocode") {
      let body="";for await(const chunk of request)body+=chunk;
      assert.equal(JSON.parse(body).address,"100 Example Street, Tucson, AZ 85701");
      response.writeHead(200,{"content-type":"application/json"}).end(JSON.stringify({match:true,lat:32,lng:-110}));
    }
    else if (url === "/api/reader/settings") response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({available:true,revision:1,values:{}}));
    else if (url === "/geo/state-outlines.geojson") response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({type:"FeatureCollection",features:[]}));
    else if (url === "/archive.pmtiles") {
      const range=/^bytes=(\d+)-(\d+)$/.exec(request.headers.range??"");assert.ok(range);
      const start=Number(range[1]),end=Number(range[2]);
      response.writeHead(206,{"content-type":"application/octet-stream","content-range":`bytes ${start}-${end}/${archive.length}`,"etag":'W/"weak"'}).end(archive.subarray(start,end+1));
    }
    else if(url==="/map-boundary-worker.mjs") { await stateRequested; response.writeHead(200,{"content-type":"application/javascript"}).end(workerBundle.outputFiles[0].text); }
    else if (url === "/client.js") { await early; response.writeHead(200, { "content-type": "application/javascript" }).end(bundle.outputFiles[0].text); }
    else response.writeHead(200, { "content-type": "text/html" }).end(`<!doctype html><head><script>${readerStartScript("/archive.pmtiles")}</script></head><body><script type="module" src="/client.js"></script></body>`);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  let browser: Awaited<ReturnType<typeof launchGuarded>> | null = null;
  try {
    browser = await launchGuarded({ label: "rs-01-early-reader", blockWrites: true });
    const page = await (await browser.context()).newPage();
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${address.port}/?zip=85701`, { waitUntil: "commit" });
    await page.waitForFunction(() => Object.keys(window.__readerStart?.requests ?? {}).length === 4);
    const parsedBeforeHydration = await page.evaluate(async () => {
      const start = window.__readerStart!;
      return Promise.all(Object.values(start.requests).map(async pending => {
        const response = await pending;
        return { value: await start.parsed.get(response), bodyUsed: response.bodyUsed };
      }));
    });
    assert.equal(parsedBeforeHydration.length, 4);
    assert.equal(await page.evaluate(()=>document.documentElement.dataset.raster),"pending","lightweight first paint is selected before hydration without creating another graphics context");
    assert.ok(parsedBeforeHydration.every(row => row.value && row.bodyUsed === false), "data and boundaries parse while client JavaScript remains blocked, preserving their native bodies");
    assert.deepEqual(await page.evaluate(() => window.__readerBoundary!.request({kind:"office",url:"/api/geocode",address:"100 Example Street, Tucson, AZ 85701"})),{lat:32,lng:-110});
    assert.equal(requests.filter(path=>path==="/api/geocode").length,1,"only the selected owner's public office starts before hydration; the later consumer shares its point");
    assert.equal(await page.evaluate(() => "answer" in window), false);
    releaseClient();
    await page.waitForFunction(() => "answer" in window);
    const answer = await page.evaluate(() => (window as unknown as { answer: { location: {zip: string}; state: {state: string}; place: {meetings: string[]}; bodyUsedBefore: boolean; bodyUsedAfter: boolean; rejectsSecondRead: boolean } }).answer);
    assert.equal(answer.location.zip, "85701"); assert.equal(answer.state.state, "AZ"); assert.deepEqual(answer.place.meetings, ["held"]);
    assert.deepEqual(await page.evaluate(() => (window as unknown as {answer:{ready:unknown;location:unknown}}).answer.ready),
      await page.evaluate(() => (window as unknown as {answer:{location:unknown}}).answer.location), "the same validated ZIP is synchronously available before hydration starts another promise chain");
    assert.equal(answer.bodyUsedBefore, false); assert.equal(answer.bodyUsedAfter, true); assert.equal(answer.rejectsSecondRead, true);
    await page.waitForFunction(() => "delayedAnswer" in window);
    assert.deepEqual(await page.evaluate(() => (window as unknown as { delayedAnswer: unknown }).delayedAnswer), { value: { held: true }, bodyUsed: true, cancellationResolved: false }, "parsed data is available while original-stream cancellation is still pending");
    await page.evaluate(() => (window as unknown as { releaseCancellation: () => void }).releaseCancellation());
    assert.deepEqual(requests.sort(), ["/api/geocode", "/api/reader/zip3/857.json", "/api/answer/85701/aaaaaaaaaaaa", "/api/reader/settings", "/geo/state-outlines.geojson", "/archive.pmtiles", "/archive.pmtiles"].sort(),
      "a published ZIP is two requests: the ZIP3 file and its answer, with no location, state or meetings route");
    const starts = [page.waitForRequest(request => new URL(request.url()).pathname === "/api/reader/zip3/860.json")];
    await page.evaluate(() => {
      const reader = window as unknown as {openZip:(zip:string)=>Promise<unknown>;nextAnswer?:unknown};
      void reader.openZip("86001").then(answer=>{reader.nextAnswer=answer;});
    });
    await Promise.all(starts);
    assert.equal(await page.evaluate(() => "nextAnswer" in window),false,"the new ZIP file starts at once and its answer follows the file");
    assert.deepEqual(await page.evaluate(() => (window as unknown as {readPreviousResponse:()=>Promise<unknown>}).readPreviousResponse()),
      {from:"early parser"},"a response from the previous ZIP still consumes its parsed value after a new ZIP starts");
    releaseNextLocation();
    await page.waitForFunction(() => "nextAnswer" in window);
    const next = await page.evaluate(() => (window as unknown as {nextAnswer:{location:{zip:string};state:{state:string};place:{meetings:string[]};bodyUsed:boolean}}).nextAnswer);
    assert.equal(next.location.zip,"86001");assert.equal(next.state.state,"AZ");assert.deepEqual(next.place.meetings,["held"]);assert.equal(next.bodyUsed,true);
    assert.deepEqual(requests.sort(),["/api/geocode","/api/reader/settings","/geo/state-outlines.geojson","/archive.pmtiles","/archive.pmtiles","/api/reader/zip3/857.json","/api/reader/zip3/860.json","/api/answer/85701/aaaaaaaaaaaa","/api/answer/86001/bbbbbbbbbbbb"].sort(),
      "the new ZIP consumes its file and answer once without fetching their resolved aliases again");
    const beforeReverse = requests.length;
    const reverse = await page.evaluate(async () => {
      const lookup = (window as unknown as {lookupZip:(zip:string)=>Promise<{zip:string}>}).lookupZip;
      return [(await lookup("85701")).zip,(await lookup("86001")).zip];
    });
    assert.deepEqual(reverse,["85701","86001"]);
    assert.equal(requests.length,beforeReverse,"initial restoration and subsequent choices both populate the ZIP cache; reversing starts no extra reads");
    await page.evaluate(async () => {
      history.pushState(null,"","/ballot");
      await (window as unknown as {lookupZip:(zip:string)=>Promise<unknown>}).lookupZip("10001");
    });
    assert.deepEqual(requests.slice(-2),["/api/reader/zip3/100.json","/api/location/zip?zip=10001"],"a lookup outside the map asks the ZIP3 file, and the database route only because the file lists no such ZIP");
    assert.equal(requests.length,beforeReverse+2);
    assert.deepEqual(errors, []);
  } finally { releaseClient();releaseNextLocation(); await browser?.close(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

test("an answer whose state part failed still carries its meetings, including when the optional worker cannot start",async()=>{
  for(const brokenWorker of [false,true]){
    const server=createServer((request,response)=>{
      const url=request.url!;
      response.setHeader("content-type","application/json");
      if(url==="/api/reader/zip3/857.json")return response.end(JSON.stringify(zip3File("85701")));
      if(url==="/api/answer/85701/aaaaaaaaaaaa")return response.end(JSON.stringify({meetings:["held"],coverage:null,stateResponse:{status:503,value:{error:"State unavailable"}}}));
      if(url==="/map-boundary-worker.mjs"){
        response.setHeader("content-type","application/javascript");return response.end('throw new Error("Worker unavailable");');
      }
      if(url.startsWith("/api/")||url==="/geo/state-outlines.geojson")return response.end("{}");
      response.setHeader("content-type","text/html");response.end(`<!doctype html><script>${readerStartScript(brokenWorker?"/archive.pmtiles":"")}</script><script>
        window.__readerStart.location.then(async location=>{
          const start=window.__readerStart,file=await start.requests["/api/reader/zip3/857.json"],place=await start.requests["/api/answer/85701/aaaaaaaaaaaa"];
          window.answer={location:{lat:location.lat,lng:location.lng,state:location.state},file:{status:file.status,value:await start.parsed.get(file)},place:{status:place.status,value:await start.parsed.get(place)}};
        });</script>`);
    });
    await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
    const address=server.address();assert.ok(address&&typeof address!=="string");
    let browser:Awaited<ReturnType<typeof launchGuarded>>|undefined;
    try{
      browser=await launchGuarded({label:"rs03-bundled-partial-failure",blockWrites:true});
      const page=await(await browser.context()).newPage();
      await page.goto(`http://127.0.0.1:${address.port}/?zip=85701`,{waitUntil:"commit"});
      await page.waitForFunction(()=>"answer" in window,undefined,{timeout:5000});
      const answer=await page.evaluate(()=>(window as unknown as {answer:{location:unknown;file:{status:number};place:unknown}}).answer);
      assert.deepEqual(answer.location,{lat:32,lng:-110,state:"AZ"},"the ZIP's point is [lng, lat] in the file");
      assert.equal(answer.file.status,200);
      assert.deepEqual(answer.place,{status:200,value:{meetings:["held"],coverage:null,stateResponse:{status:503,value:{error:"State unavailable"}}}});
    }finally{await browser?.close();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
  }
});
