import assert from "node:assert/strict";
import test from "node:test";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { holdRawCapture, readRawCaptureText } from "../lib/civic-data/raw-capture-vault.ts";
import { RawCaptureFailure, rawResponseCapture, vaultSourceResponse } from "../lib/sources/raw-response.ts";
import { readPublisherBody } from "../lib/civic-data/source-acquisition-error.ts";

test("different publishers and MIME labels hold one copy of identical bytes", async () => {
  const vault = new MemoryEvidenceStore();
  const a = await holdRawCapture(vault, "a", "same source", "text/plain");
  const b = await holdRawCapture(vault, "b", "same source", "text/html");
  assert.deepEqual(a, b);
  assert.equal(vault.size, 1);
  assert.equal(await readRawCaptureText(vault, b), "same source");
});

test("a source consumer receives its original bytes only after the capture is durable", async () => {
  const vault = new MemoryEvidenceStore();
  const response = vaultSourceResponse(new Response('{"fact":42}', { headers: { "content-type": "application/json" } }), vault, "source");
  assert.deepEqual(await response.json(), { fact: 42 });
  const capture = await rawResponseCapture(response);
  assert.ok(capture);
  assert.equal(await readRawCaptureText(vault, capture), '{"fact":42}');
  assert.equal(vaultSourceResponse(response, vault, "again"), response);
  assert.equal(vault.size, 1);
});

test("an interrupted or truncated response never becomes a complete raw capture", async () => {
  const vault = new MemoryEvidenceStore();
  const response = vaultSourceResponse(new Response("short", { headers: { "content-length": "12" } }), vault, "source");
  await assert.rejects(response.text(), /content length mismatch/);
  await assert.rejects(rawResponseCapture(response)!, /content length mismatch/);
  const cancelled = vaultSourceResponse(new Response("cancelled"), vault, "source");
  await cancelled.body!.cancel();
  await assert.rejects(rawResponseCapture(cancelled)!);
  assert.equal(vault.size, 0);
});

test("a fully read publisher refusal is retained as source evidence without becoming a successful acquisition",async()=>{
  const vault=new MemoryEvidenceStore();
  const response=vaultSourceResponse(new Response("Publisher maintenance",{status:503}),vault,"source");
  assert.equal(response.status,503);assert.equal(response.ok,false);
  assert.equal(await response.text(),"Publisher maintenance");
  const capture=await rawResponseCapture(response);assert.ok(capture);
  assert.equal(await readRawCaptureText(vault,capture),"Publisher maintenance");
});

test("a vault failure remains a vault failure rather than a publisher outage", async () => {
  const vault = new MemoryEvidenceStore();
  vault.put = async () => { throw new Error("vault unavailable"); };
  const response = vaultSourceResponse(new Response("source facts"), vault, "source");
  await assert.rejects(readPublisherBody("source", () => response.text()), RawCaptureFailure);
  await assert.rejects(rawResponseCapture(response)!, RawCaptureFailure);
});
