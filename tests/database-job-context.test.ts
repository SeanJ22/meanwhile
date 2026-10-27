import assert from "node:assert/strict";
import { test } from "node:test";
import { withReaderRoute } from "../lib/db/reader-route.ts";
import {
  countNeonBytes, databaseTransferFetch, hourStart, processNeonBytes, withDatabaseJob, withQueryCaller,
} from "../lib/db/transfer-by-caller.ts";

test("streamed database responses retain the requesting job when another job consumes them", async () => {
  const at = Date.parse("2031-01-02T03:00:00Z");
  const replies = ["Cochisé", "meeting agenda"];
  let request = 0;
  const counted = databaseTransferFetch(async () => {
    const bytes = Buffer.from(replies[request++]!);
    let part = 0;
    return new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        if (part++ === 0) controller.enqueue(bytes.subarray(0, 3));
        else { controller.enqueue(bytes.subarray(3)); controller.close(); }
      },
    }, { highWaterMark: 0 }));
  }, row => {
    const table = Object.keys(row.reads ?? {})[0]?.split("\t").slice(1).join("\t");
    countNeonBytes(row.database, row.responseBytes, at, { requests: row.requests, bytes: row.requestBytes }, undefined, table);
  });
  const body = JSON.stringify({ query: "SELECT payload FROM civic_data_promotions WHERE record_class=$1", params: ["REGISTRATION"] });
  const responses = await Promise.all(replies.map((_, index) => withDatabaseJob(`source-${index}`, () =>
    withReaderRoute(`source-${index}`, () => withQueryCaller("query:civic_data_promotions", () => counted("https://database.invalid/sql", {
      headers: { "neon-connection-string": "postgresql://local.invalid/staging" }, body,
    }))))));
  assert.deepEqual(await Promise.all(responses.map((response, index) =>
    withDatabaseJob(`consumer-${index}`, () => withReaderRoute(`consumer-${index}`, () => response.text())))), replies);
  const hour = processNeonBytes().find(row => row.hour === hourStart(at))!;
  const reads = Object.entries(hour.reads ?? {});
  assert.equal(reads.length, 2, "request and response chunks retain the same job, table and file");
  for (const [index, reply] of replies.entries()) {
    const read = reads.find(([key]) => key.split("\t")[1] === `source-${index}`)!;
    assert.equal(read[0].split("\t")[2], "civic_data_promotions:REGISTRATION");
    assert.match(read[0].split("\t")[3]!, /^tests\/database-job-context\.test\.ts$/);
    assert.deepEqual(read[1], [1, Buffer.byteLength(body), Buffer.byteLength(reply)]);
    assert.equal(hour.counters?.[`neon_bytes:control-plane:source-${index}`], Buffer.byteLength(reply));
  }
  assert.equal(hour.requests, 2);
  assert.equal(hour.bytes["control-plane"], replies.reduce((sum, reply) => sum + Buffer.byteLength(reply), 0));
});
