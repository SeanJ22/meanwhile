import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { captureSourceAcquisitions } from "../lib/sources/acquisition-trace.ts";
import { InSiteSession } from "../lib/sources/legistar-insite/http.ts";

test("InSite GET, postback and binary reads keep exact source evidence without global fetch interception", async () => {
  const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x41, 0xff]);
  const requestedUrl = "https://county.legistar.com/Calendar.aspx";
  const finalUrl = "https://county.legistar.com/current";
  const seen: string[] = [];
  const fetchImpl: typeof fetch = async (_url, init) => {
    seen.push(init?.method ?? "GET");
    const response = new Response(bytes);
    Object.defineProperty(response, "url", { value: finalUrl });
    return response;
  };
  const session = new InSiteSession({ fetchImpl });
  const reads = [() => session.get(requestedUrl), () => session.postForm(requestedUrl, { range: "This Month" }),
    () => session.getBytes(requestedUrl)];
  for (const read of reads) {
    const captured = await captureSourceAcquisitions(run => run("legistar-insite", async () => { await read(); }));
    assert.deepEqual(captured.evidence, [{ source: "legistar-insite", requestedUrl, finalUrl, httpStatus: 200,
      rawHash: createHash("sha256").update(bytes).digest("hex"), byteCount: bytes.byteLength }]);
  }
  assert.deepEqual(seen, ["GET", "POST", "GET"]);
});

test("an interrupted InSite body never creates a completed acquisition", async () => {
  const captured = await captureSourceAcquisitions(run => run("legistar-insite", async () => {
    const session = new InSiteSession({ fetchImpl: async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array([65])); controller.error(new Error("truncated body")); },
    })) });
    await assert.rejects(session.get("https://county.legistar.com/Calendar.aspx"), /truncated body/);
  }));
  assert.deepEqual(captured.evidence, []);
});
