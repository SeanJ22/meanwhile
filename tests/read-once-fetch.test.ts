import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { readOncePerRun } from "../lib/meetings/read-once-fetch.ts";

test("concurrent and later agenda reads retain exact bytes, headers and status with one upstream request", async () => {
  let calls = 0;
  const read = readOncePerRun(async () => {
    calls++;
    return new Response(new Uint8Array([0, 255, 17, 128]), { status: 206, headers: { "content-type": "application/pdf", etag: "exact" } });
  });
  try {
    const responses = await Promise.all([read("https://agenda.example/file"), read("https://agenda.example/file")]);
    for (const response of [...responses, await read("https://agenda.example/file")]) {
      assert.equal(response.status, 206);
      assert.equal(response.headers.get("etag"), "exact");
      assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [0, 255, 17, 128]);
    }
    assert.equal(calls, 1);
    assert.equal(read.distinctReads(), 1);
  } finally { read.close(); }
  await assert.rejects(read("https://agenda.example/file"), /AGENDA_READ_CACHE_CLOSED/);
});

test("no-content responses and failed requests remain exact read-once outcomes", async () => {
  let calls = 0;
  const read = readOncePerRun(async input => {
    calls++;
    if (String(input).endsWith("failed")) throw new Error("publisher unavailable");
    return new Response(null, { status: 204 });
  });
  try {
    assert.equal((await read("https://agenda.example/empty")).status, 204);
    assert.equal((await read("https://agenda.example/empty")).body, null);
    await assert.rejects(read("https://agenda.example/failed"), /publisher unavailable/);
    await assert.rejects(read("https://agenda.example/failed"), /publisher unavailable/);
    assert.equal(calls, 2);
  } finally { read.close(); }
});

test("a board's 128 MiB of distinct downloaded agendas does not stay in the calendar heap", () => {
  const output = execFileSync(process.execPath, ["--expose-gc", "--experimental-strip-types", "--input-type=module", "-e", `
    import {readOncePerRun} from ${JSON.stringify(new URL("../lib/meetings/read-once-fetch.ts", import.meta.url).href)};
    const read=readOncePerRun(async()=>new Response(new Uint8Array(2*1024*1024).fill(17)));
    try {
      await (await read('https://agenda.example/0')).arrayBuffer();
      for(let cycle=0;cycle<3;cycle++){await new Promise(resolve=>setImmediate(resolve));globalThis.gc();}
      const before=process.memoryUsage().rss;
      for(let i=0;i<64;i++) await (await read('https://agenda.example/'+i)).arrayBuffer();
      for(let cycle=0;cycle<3;cycle++){await new Promise(resolve=>setImmediate(resolve));globalThis.gc();}
      const retained=process.memoryUsage().arrayBuffers;
      const rssGrowth=process.memoryUsage().rss-before;
      const again=new Uint8Array(await (await read('https://agenda.example/0')).arrayBuffer());
      console.log(JSON.stringify({retained,rssGrowth,requests:read.distinctReads(),byte:again[0],length:again.length}));
    } finally {read.close();}
  `], { encoding: "utf8", env: { ...process.env, MALLOC_MMAP_THRESHOLD_: "131072", MALLOC_TRIM_THRESHOLD_: "131072" } });
  const result = JSON.parse(output);
  assert.ok(result.retained < 64 * 1024 * 1024, `${result.retained} bytes retained after 128 MiB of distinct agendas`);
  assert.ok(result.rssGrowth < 64 * 1024 * 1024, `${result.rssGrowth} bytes of resident growth after 128 MiB of distinct agendas`);
  assert.equal(result.requests, 64);
  assert.equal(result.byte, 17);
  assert.equal(result.length, 2 * 1024 * 1024);
});
