import assert from "node:assert/strict";
import test from "node:test";
import { gunzipSync } from "node:zlib";
import { compressedJson } from "../lib/api/compressed-json.ts";

test("meeting transport preserves ordinary JSON for gzip and identity clients", async () => {
  const answer = { governingOcdIds: ["ocd-division/country:us/state:ca"],
    coverage: { bodies: [{ readerRoster: { members: [{ name: "José" }] } }] }, meetings: [{ id: "meeting:1" }] };
  const request = (encoding: string) => new Request("https://example.test/api/meetings?zip=90210", { headers: { "Accept-Encoding": encoding } });
  const init = { headers: { "Netlify-Vary": "query=zip", "Cache-Control": "public, max-age=10" } };
  for (const encoding of ["gzip", "br, gzip;q=0.5", "*"]) {
    const response = await compressedJson(request(encoding), answer, init);
    assert.equal(response.headers.get("content-encoding"), "gzip");
    assert.equal(response.headers.get("vary"), "Accept-Encoding");
    assert.deepEqual(JSON.parse(gunzipSync(Buffer.from(await response.arrayBuffer())).toString()), answer);
  }
  for (const encoding of ["identity", "gzip;q=0, *;q=1", ""]) {
    const response = await compressedJson(request(encoding), answer, init);
    assert.equal(response.headers.get("content-encoding"), null);
    assert.equal(response.headers.get("vary"), "Accept-Encoding");
    assert.deepEqual(await response.json(), answer);
  }
});
