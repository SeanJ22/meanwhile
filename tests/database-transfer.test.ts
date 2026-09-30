import assert from "node:assert/strict";
import { test } from "node:test";
import { databaseTransferFetch, type DatabaseTransfer } from "../lib/db/transfer.ts";

test("database counter counts actual UTF-8 response bytes and leaves JSON unchanged", async () => {
  const rows: DatabaseTransfer[] = [];
  const body = JSON.stringify({ value: "Cochisé", records: [1, 2, 3] });
  const counted = databaseTransferFetch(async () => new Response(body, { headers: { "content-type": "application/json" } }), row => { rows.push(row); });
  const response = await counted("https://database.invalid/sql", {
    headers: { "neon-connection-string": "postgresql://local.invalid/staging" }, body: "select 1",
  });
  assert.deepEqual(await response.json(), JSON.parse(body));
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.responseBytes, Buffer.byteLength(body));
  assert.equal(rows[0]!.requestBytes, 8);
  assert.equal(rows[0]!.requests, 1);
});

test("government/API requests do not count as database transfer", async () => {
  const counted = databaseTransferFetch(async () => new Response("official page"), () => { assert.fail("counted source HTTP"); });
  assert.equal(await (await counted("https://example.gov")).text(), "official page");
});
