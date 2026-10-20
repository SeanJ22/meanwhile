import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { neonRequestDeadlineFetch } from "../lib/ops/neon-request-deadline.ts";

test("a response that sends headers then stalls is aborted and closes the socket", async t => {
  let closed!: () => void;
  const disconnected = new Promise<void>(resolve => { closed = resolve; });
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.write('{"rows":');
    response.on("close", closed);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const response = await neonRequestDeadlineFetch(fetch, 150)(`http://127.0.0.1:${address.port}`);
  await assert.rejects(response.json(), { name: "TimeoutError" });
  await disconnected;
});

test("Request cancellation and body cancellation reach the underlying transport", async () => {
  const caller = new AbortController();
  let cancelled = 0;
  const bounded = neonRequestDeadlineFetch(async (_input, init) => {
    assert.ok(init?.signal);
    return new Response(new ReadableStream({ cancel() { cancelled++; } }));
  }, 500);
  const response = await bounded(new Request("https://example.invalid", { signal: caller.signal }));
  caller.abort(new Error("owner cancelled"));
  await assert.rejects(response.text(), /owner cancelled/);
  assert.equal(cancelled, 1);
  await (await bounded("https://example.invalid")).body!.cancel();
  assert.equal(cancelled, 2);
  assert.equal(await (await neonRequestDeadlineFetch(async () => new Response("ok"), 500)("https://example.invalid")).text(), "ok");
});
