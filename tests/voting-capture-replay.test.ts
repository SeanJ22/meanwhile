import assert from "node:assert/strict";
import test from "node:test";
import { writeFileSync } from "node:fs";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { fork } from "node:child_process";
import { once } from "node:events";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { serialize, deserialize } from "node:v8";
import { createHash } from "node:crypto";
import { VerifiedReplayFiles, encodeVerifiedReplay, reviveVerifiedReplay, replayPropertyAs, replayBytesAs } from "../lib/sources/verified-replay.ts";
import { votingFetchSession, disposeVotingFetchRuntime } from "../lib/ballot/voting-source-fetch.ts";
import type { VotingSourceRuntime } from "../lib/ballot/voting-source-types.ts";
const hash = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const plain = { headers: { "content-type": "text/plain" } }, html = { headers: { "content-type": "text/html" } };

test("completed binary and text captures retain only verified replay references across advanced IPC", () => {
  const files = new VerifiedReplayFiles();
  try {
    const bytes = new Uint8Array(2 * 1024 * 1024).fill(83), text = "Official source evidence ".repeat(100_000);
    const capture = files.capture({ url: "https://elections.example.gov/list", contentType: "text/plain", bytes });
    const evidence = files.text({ artifactId: "source", contentHash: `sha256-${hash(text)}`, text }, "text", hash(text));
    const page = replayPropertyAs(evidence, "text", "text", { url: capture.url, capture: { evidence } });
    const linking = replayPropertyAs(page, "text", "html", { url: page.url });
    const linkingCapture = replayBytesAs(linking, "html", { url: page.url });
    assert.equal(Object.getOwnPropertyDescriptor(capture, "bytes")?.value, undefined);
    assert.equal(typeof Object.getOwnPropertyDescriptor(capture, "bytes")?.get, "function");
    const wire = serialize(encodeVerifiedReplay({ captures: [capture, linkingCapture], page, linking }));
    assert.ok(wire.byteLength < 2_000, `advanced IPC must hold metadata, got ${wire.byteLength} bytes`);
    const read = reviveVerifiedReplay(deserialize(wire)) as { captures: typeof capture[]; page: typeof page; linking: typeof linking };
    assert.equal(hash(read.captures[0].bytes), hash(bytes)); assert.equal(read.page.text, text); assert.equal(read.linking.html, text);
    assert.equal(read.page.capture.evidence.contentHash, evidence.contentHash);
    assert.equal(hash(read.captures[1].bytes), hash(text));
    assert.ok(JSON.stringify({ capture, evidence, page, linking }).length < 3_000);
    files.dispose(); assert.throws(() => read.page.text, /ENOENT/);
  } finally { files.dispose(); }
});

test("replay rejects changed bytes and mismatched worker evidence identities", () => {
  const files = new VerifiedReplayFiles();
  try {
    const capture = files.capture({ bytes: new TextEncoder().encode("original") });
    const wire = JSON.parse(JSON.stringify(capture));
    writeFileSync(wire.__sourceReplay.bytes.ref.path, "modified");
    assert.throws(() => capture.bytes, /SOURCE_REPLAY_INTEGRITY_MISMATCH/);
    assert.throws(() => files.text({ text: "source" }, "text", hash("other")), /SOURCE_REPLAY_IDENTITY_MISMATCH/);
    const evidence = files.text({ text: "source", contentHash: `sha256-${hash("source")}` }, "text");
    const forged = encodeVerifiedReplay(evidence) as unknown as { contentHash: string };
    forged.contentHash = `sha256-${hash("other")}`;
    assert.throws(() => reviveVerifiedReplay(forged), /SOURCE_REPLAY_IDENTITY_MISMATCH/);
  } finally { files.dispose(); }
});

test("parallel and duplicate public GETs replay their own robot and redirect evidence without another fetch", async () => {
  const requested: string[] = [], runtime: VotingSourceRuntime = { captureCache: new Map(), fetch: async (value, init) => {
    const url = String(value); requested.push(url); assert.equal(init?.credentials, "omit"); assert.equal(init?.redirect, "manual");
    if (url.endsWith("/robots.txt")) return new Response("User-agent: *\nDisallow: /", plain);
    if (url.endsWith("/start")) return new Response(null, { status: 302, headers: { location: "/actual" } });
    return new Response(`<html>${url}</html>`, html);
  } };
  try {
    const first = votingFetchSession(runtime), second = votingFetchSession(runtime);
    const [a, b] = await Promise.all([first.get("https://elections.example.gov/start"), second.get("https://elections.example.gov/start")]);
    assert.equal(a.url, "https://elections.example.gov/actual"); assert.equal(hash(a.bytes), hash(b.bytes));
    assert.equal(requested.filter(url => url.endsWith("/start")).length, 1); assert.equal(requested.filter(url => url.endsWith("/actual")).length, 1);
    assert.ok(first.attempts.some(row => /recorded as evidence/.test(row.outcome))); assert.ok(second.attempts.some(row => /Held capture reused/.test(row.outcome)));
    assert.deepEqual(first.rawBodies.map(row => row.url), second.rawBodies.map(row => row.url));
    assert.ok(first.rawBodies.some(row => row.url.endsWith("/robots.txt")));
    assert.ok(first.rawBodies.every(row => typeof Object.getOwnPropertyDescriptor(row, "bytes")?.get === "function"));
    const before = requested.length;
    await assert.rejects(second.get("https://elections.example.gov/start", { headers: new Headers({ authorization: "forbidden" }) }), /Authenticated/);
    assert.equal(requested.length, before, "a held GET cannot bypass authentication refusal");
    assert.ok(serialize(encodeVerifiedReplay(await runtime.captureCache!.get("https://elections.example.gov/start"))).byteLength < 2_000);
  } finally { disposeVotingFetchRuntime(runtime); }
});

test("unrelated parallel GET caches never inherit another page and failed GETs remain retryable", async () => {
  const requests = new Map<string, number>();
  const runtime: VotingSourceRuntime = { captureCache: new Map(), fetch: async (value, init) => {
    const url = String(value); requests.set(url, (requests.get(url) ?? 0) + 1);
    if (url.endsWith("/robots.txt")) return new Response("User-agent: *\nAllow: /", plain);
    if (url.endsWith("/retry") && requests.get(url) === 1) return new Response("Unavailable", { status: 503 });
    if (url.endsWith("/a")) await new Promise(resolve => setTimeout(resolve, 10));
    return new Response(`${url}:${init?.method ?? "GET"}:${init?.body ?? ""}`, plain);
  } };
  try {
    const session = votingFetchSession(runtime);
    await Promise.all([session.get("https://elections.example.gov/a"), session.get("https://elections.example.gov/b")]);
    for (const key of ["a", "b"]) {
      const held = await runtime.captureCache!.get(`https://elections.example.gov/${key}`);
      assert.ok(held?.every(row => row.url.endsWith("/robots.txt") || row.url.endsWith(`/${key}`)), "one page never captures a concurrent sibling response");
    }
    await assert.rejects(session.get("https://elections.example.gov/retry"), /HTTP 503/);
    assert.equal(runtime.captureCache!.has("https://elections.example.gov/retry"), false);
    await session.get("https://elections.example.gov/retry");
    assert.equal(requests.get("https://elections.example.gov/retry"), 2);
    await session.get("https://elections.example.gov/a", { method: "POST", body: "first" });
    const second = await session.get("https://elections.example.gov/a", { method: "POST", body: "second" });
    assert.match(new TextDecoder().decode(second.bytes), /POST:second$/); assert.equal(requests.get("https://elections.example.gov/a"), 3);
  } finally { disposeVotingFetchRuntime(runtime); }
});


test("a real child publication transports replay identities through advanced IPC and cleans its pass files at exit", async () => {
  const directory = await mkdtemp(join(tmpdir(), "replay-ipc-test-"));
  const path = join(directory, "child.mts"), replayModuleUrl = pathToFileURL(resolve("lib/sources/verified-replay.ts")).href;
  await writeFile(path, `import {VerifiedReplayFiles,encodeVerifiedReplay} from ${JSON.stringify(replayModuleUrl)};
` +
    `const files=new VerifiedReplayFiles();process.on("message",()=>{const text="Official source witness ".repeat(100000);
` +
    `process.send(encodeVerifiedReplay({evidence:files.text({artifactId:"source",text},"text")}));});`);
  const child = fork(path, [], { serialization: "advanced", stdio: ["ignore", "ignore", "inherit", "ipc"], execArgv: ["--experimental-strip-types"] });
  try {
    const message = once(child, "message"); child.send("publish");
    const [wire] = await message;
    assert.ok(serialize(wire).byteLength < 600, "the child sends no completed body bytes");
    const read = reviveVerifiedReplay(wire) as { evidence: { artifactId: string; text: string } };
    assert.equal(read.evidence.artifactId, "source"); assert.equal(hash(read.evidence.text), hash("Official source witness ".repeat(100_000)));
    const exit = once(child, "exit"); child.disconnect(); await exit;
    assert.throws(() => read.evidence.text, /ENOENT/, "the acquiring process removes its temporary replay files on exit");
  } finally { if (child.connected) child.disconnect(); if (child.exitCode === null) child.kill(); await rm(directory, { recursive: true, force: true }); }
});
