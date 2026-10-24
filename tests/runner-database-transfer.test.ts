import assert from "node:assert/strict";
import { test } from "node:test";
import { neon, neonConfig } from "@neondatabase/serverless";
import { flushDatabaseTransfer, installDatabaseTransferCounter, keepRunnerTransfer, pendingDatabaseTransfer, pendingRunnerDatabaseTransfer, runnerDatabaseTransferView } from "../lib/db/transfer.ts";
import { VITAL_SIGNS_REPORT_ENV, processNeonBytes, takeNeonBytesHours } from "../lib/db/transfer-by-caller.ts";
import { formatVitalSignsReport, parseVitalSignsReport } from "../lib/db/transfer-by-caller.ts";
import { neonTransferOf } from "../lib/control-plane/admin-view/v6-spend-read.ts";

const READER = "postgresql://local:local@ep-reader-runner-transfer.us-east-2.aws.neon.tech/neondb";
const CONTROL = "postgresql://local:local@ep-cp-runner-transfer.us-east-2.aws.neon.tech/neondb";

/** A stand-in for the platform socket the Pool driver opens; installed before the counter wraps it. */
class FakeSocket extends EventTarget {
  readonly url: string;
  sent: unknown[] = [];
  constructor(url: string | URL) { super(); this.url = String(url); }
  send(data: unknown): void { this.sent.push(data); }
}
neonConfig.webSocketConstructor = FakeSocket as unknown as typeof WebSocket;

const writes: { query: string; params: unknown[] }[][] = [];
const answer = JSON.stringify({ command: "SELECT", rowCount: 1, rowAsArray: true, fields: [{ name: "n", dataTypeID: 25 }], rows: [["x".repeat(400)]] });
neonConfig.fetchFunction = async (_url: string | URL | Request, init?: RequestInit) => {
  const body = JSON.parse(String(init?.body));
  if (body.queries) {
    writes.push(body.queries);
    return new Response(JSON.stringify({ results: body.queries.map(() => ({ command: "INSERT", rowCount: 1, rowAsArray: true, fields: [], rows: [] })) }));
  }
  return new Response(answer);
};
Object.assign(process.env, { DATABASE_URL: READER, WTP_CONTROL_PLANE_DATABASE_URL: CONTROL });
installDatabaseTransferCounter();

test("a runner process's bytes reach the daily table once, from its hour reports, even when it never flushes", async () => {
  process.env[VITAL_SIGNS_REPORT_ENV] = "1";
  try {
    await neon(CONTROL).query("select 1");
    assert.deepEqual(pendingDatabaseTransfer(), [], "a process reporting to the runner keeps no daily rows of its own");
    const [first] = takeNeonBytesHours();
    assert.equal(first!.bytes["control-plane"], Buffer.byteLength(answer));
    assert.equal(first!.sent!["control-plane"].requests, 1);
    keepRunnerTransfer(first!);
    keepRunnerTransfer(first!);
    await neon(CONTROL).query("select 2");
    const [second] = takeNeonBytesHours();
    keepRunnerTransfer(second!);
    const rows = pendingDatabaseTransfer();
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.client, "runner");
    assert.equal(rows[0]!.database, "control-plane");
    assert.equal(rows[0]!.requests, 2, "a repeated report adds nothing; a later one adds only what is new");
    assert.equal(rows[0]!.responseBytes, 2 * Buffer.byteLength(answer));
    assert.equal(rows[0]!.requestBytes, second!.sent!["control-plane"].bytes);
    assert.ok(rows[0]!.requestBytes > first!.sent!["control-plane"].bytes);
    const hourly = neonTransferOf({ kind: "RECORDED", rows, runner: runnerDatabaseTransferView(pendingRunnerDatabaseTransfer()) }).runnerReads!;
    assert.equal(hourly.length, 1);
    assert.equal(hourly[0].hour, first!.hour);
    assert.equal(hourly[0].requests, 2);
    assert.equal(hourly[0].responseBytes, 2 * Buffer.byteLength(answer));
    assert.equal(await flushDatabaseTransfer(), true);
    assert.match(writes.at(-1)![0]!.query, /INSERT INTO database_transfer_daily/);
    assert.deepEqual(writes.at(-1)![0]!.params.slice(2, 6).map(String), ["runner", "2", String(rows[0]!.requestBytes), String(2 * Buffer.byteLength(answer))]);
  } finally {
    delete process.env[VITAL_SIGNS_REPORT_ENV];
  }
});

test("all job and table reads survive bounded child reports and duplicate delivery", async () => {
  const reads = Object.fromEntries(Array.from({ length: 150 }, (_, n) => [`reader\tlobbying-${n}\tcivic_data_payload_parts`, [1, 100, 1000] as const]));
  const part = { hour: "2026-10-24T07:00:00.000Z", pid: 99123, startedMs: 1, requests: 150,
    bytes: { reader: 150000, "control-plane": 0 }, sent: { reader: { requests: 150, bytes: 15000 }, "control-plane": { requests: 0, bytes: 0 } },
    byCaller: { "reader: query:civic_data_payload_parts": 150000 }, processes: ["lobbying#99123"], reads };
  const reports = formatVitalSignsReport(part).split("\n");
  assert.ok(reports.length > 2);
  assert.ok(reports.every(line => Buffer.byteLength(line) <= 3800));
  for (const line of [...reports, ...reports]) keepRunnerTransfer(parseVitalSignsReport(line)!);
  const rows = pendingDatabaseTransfer().filter(row => row.day === "2026-10-24" && row.client === "runner" && row.database === "reader");
  const hourly = neonTransferOf({ kind: "RECORDED", rows, runner: runnerDatabaseTransferView(pendingRunnerDatabaseTransfer()) }).runnerReads!.filter(row => row.hour === part.hour);
  assert.equal(hourly.length, 150);
  assert.equal(hourly.reduce((sum, row) => sum + row.responseBytes, 0), 150000);
  assert.equal(hourly.reduce((sum, row) => sum + row.requests, 0), 150);
  await flushDatabaseTransfer();
});

test("a database socket's bytes count under the database it reaches and the code that opened it", () => {
  const Socket = neonConfig.webSocketConstructor as unknown as new (url: string) => FakeSocket;
  const socket = new Socket("wss://ep-reader-runner-transfer.us-east-2.aws.neon.tech/v2");
  socket.dispatchEvent(Object.assign(new Event("message"), { data: new ArrayBuffer(300) }));
  socket.send("abc");
  assert.deepEqual(socket.sent, ["abc"], "the socket still sends");
  const counted = processNeonBytes().flatMap(hour => Object.entries(hour.byCaller)).filter(([caller]) => caller.startsWith("reader: websocket"));
  assert.equal(counted.length, 1);
  assert.match(counted[0]![0], /^reader: websocket ← tests\/runner-database-transfer\.test\.ts:\d+$/);
  assert.equal(counted[0]![1], 300);
  const reader = pendingDatabaseTransfer().find(row => row.database === "reader");
  assert.deepEqual(reader && { responseBytes: reader.responseBytes, requestBytes: reader.requestBytes, requests: reader.requests },
    { responseBytes: 300, requestBytes: 3, requests: 0 });
  const elsewhere = new Socket("wss://example.invalid/v2");
  elsewhere.dispatchEvent(Object.assign(new Event("message"), { data: "not ours" }));
  assert.equal(pendingDatabaseTransfer().find(row => row.database === "reader")?.responseBytes, 300, "another host is not a civic database");
});
