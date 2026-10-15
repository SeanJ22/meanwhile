import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import http from "node:http";
import { PassThrough, Readable } from "node:stream";
import test from "node:test";
import { captureSourceAcquisitions } from "../lib/sources/acquisition-trace.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { DurableEvidenceStore } from "../lib/control-plane/evidence/durable-store.ts";
import { memoryWebsitePacing, WEBSITE_PACING_DDL } from "../lib/control-plane/website-pacing.ts";
import { fetchSource, prefetchSourceRequests, runWithSourceFetch, SourceFetchDeferred, type SourceResponseCapture } from "../lib/sources/fetch-source.ts";
import { fileSourceFetchStore, postgresSourceFetchStore, SOURCE_FETCH_DDL, type SavedSourceResponse, type SourceCheck, type SourceFetchStore } from "../lib/sources/fetch-source-state.ts";
import { checkedPublicAddress, isPublicAddress, publicTransport } from "../lib/hunt/public-transport.ts";

function memoryStore() {
  const values = new Map<string, SavedSourceResponse>(), checks: SourceCheck[] = [];
  const store: SourceFetchStore = {
    pacing: memoryWebsitePacing(), withLease: async (_key, operation) => operation(),
    read: async key => values.get(key) ?? null, readEntryRequest: async () => null,
    record: async (key, value, check) => { if (value) values.set(key, value); checks.push(check); },
  };
  return { store, checks, values };
}

test("conditional reads survive a new store and rehydrate exactly the held bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "fetch-source-"));
  try {
    const vault = new DurableEvidenceStore(join(root, "vault"), { remote: null });
    const calls: Headers[] = [], captures: SourceResponseCapture[] = [];
    const transport: typeof fetch = async (_input, init) => {
      calls.push(new Headers(init?.headers));
      return calls.length === 1
        ? new Response("calendar original", { headers: { etag: '"one"', "last-modified": "Wed, 01 Oct 2025 00:00:00 GMT", "content-type": "text/calendar" } })
        : new Response(null, { status: 304, headers: { etag: '"one"' } });
    };
    for (let pass = 0; pass < 2; pass += 1) {
      const response = await runWithSourceFetch({ vault, runtime: { transport, store: fileSourceFetchStore(join(root, "state")) },
        onResponse: value => { captures.push(value); } }, () => fetchSource("https://town.example/calendar"));
      assert.equal(response.status, 200);
      assert.equal(await response.text(), "calendar original");
      assert.equal(response.headers.get("x-meanwhile-source-status"), pass ? "304" : null);
    }
    assert.match(calls[0]!.get("user-agent")!, /we-the-people/);
    assert.equal(calls[1]!.get("if-none-match"), '"one"');
    assert.equal(calls[1]!.get("if-modified-since"), "Wed, 01 Oct 2025 00:00:00 GMT");
    assert.equal(captures[1]!.httpStatus, 304);
    assert.equal(captures[0]!.rawHash, captures[1]!.rawHash);
    assert.equal((await vault.list("project/freshness/source-fetch/responses/")).length, 2);
    await assert.rejects(access(join(root, "state")), { code: "ENOENT" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("all readers of a small publisher share one rolling hourly allowance", async () => {
  const root = await mkdtemp(join(tmpdir(), "fetch-pacing-"));
  try {
    let now = 10_000, sent = 0;
    const vault = new MemoryEvidenceStore();
    const read = (index: number) => runWithSourceFetch({ vault, websiteSize: { kind: "local-government", population: 9000 },
      runtime: { store: fileSourceFetchStore(root), now: () => now, transport: async () => { sent += 1; return new Response("ok"); } } },
    () => fetchSource(`https://${index % 2 ? "www." : ""}town.example/page/${index}`));
    const results = await Promise.allSettled(Array.from({ length: 12 }, (_, index) => read(index)));
    assert.equal(results.filter(result => result.status === "fulfilled").length, 10);
    assert.equal(sent, 10);
    assert.ok(results.filter(result => result.status === "rejected").every(result => result.status === "rejected" && result.reason instanceof SourceFetchDeferred));
    now += 3_600_000;
    assert.equal((await read(12)).status, 200);
    assert.equal(sent, 11);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Retry-After seconds and HTTP date hold every reader and failed bodies reach the vault", async () => {
  for (const retryAfter of ["120", "Thu, 15 Oct 2026 00:02:00 GMT"]) {
    let now = Date.parse("2026-10-15T00:00:00Z"), sent = 0;
    const { store, checks } = memoryStore(), vault = new MemoryEvidenceStore();
    const context = { vault, runtime: { store, now: () => now, transport: async () => { sent += 1; return new Response("busy", { status: 503, headers: { "retry-after": retryAfter } }); } } };
    const first = await runWithSourceFetch(context, () => fetchSource("https://state.example/calendar"));
    assert.equal(await first.text(), "busy");
    assert.equal(checks[0]!.httpStatus, 503);
    assert.equal((await vault.list("project/freshness/source-fetch/responses/")).length, 1);
    await assert.rejects(runWithSourceFetch(context, () => fetchSource("https://state.example/other")), (error: unknown) => error instanceof SourceFetchDeferred && error.until === now + 120_000);
    now += 120_000;
    await runWithSourceFetch(context, () => fetchSource("https://state.example/other"));
    assert.equal(sent, 2);
  }
});

test("large responses are completely saved in bounded chunks", async () => {
  const { store } = memoryStore(), vault = new MemoryEvidenceStore();
  let remaining = 20;
  const response = await runWithSourceFetch({ vault, runtime: { store, transport: async () => new Response(new ReadableStream({
    pull(controller) { if (!remaining) controller.close(); else { remaining -= 1; controller.enqueue(new Uint8Array(1024 * 1024).fill(remaining)); } },
  })) } }, () => fetchSource("https://state.example/archive"));
  const reader = response.body!.getReader();
  let total = 0;
  for (;;) { const { value, done } = await reader.read(); if (done) break; assert.ok(value.byteLength <= 8 * 1024 * 1024); total += value.byteLength; }
  assert.equal(total, 20 * 1024 * 1024);
  assert.equal((await vault.list("project/freshness/source-fetch/body/")).length, 4);
});

test("redirects save each answer, recheck the destination, and redact durable credentials", async () => {
  const { store, checks } = memoryStore(), vault = new MemoryEvidenceStore();
  const credentials: (string | null)[] = [], captures: SourceResponseCapture[] = [];
  const capture = await captureSourceAcquisitions(run => run("calendar", () => runWithSourceFetch({ vault, sensitiveQueryParameters: ["client_secret"], onResponse: capture => { captures.push(capture); }, runtime: { store, transport: async (_input, init) => {
    credentials.push(new Headers(init?.headers).get("authorization"));
    return credentials.length === 1 ? new Response("moved", { status: 302, headers: { location: "https://other.example/calendar?client_secret=private-value" } }) : new Response("public");
  } } }, () => fetchSource("https://state.example/calendar?api_key=private", { headers: { authorization: "Bearer private" } }))));
  const response = capture.value;
  assert.equal(await response.text(), "public");
  assert.deepEqual(credentials, ["Bearer private", null]);
  assert.equal(checks.length, 2);
  assert.equal(checks[0]!.url.includes("private"), false);
  assert.equal(new URL(captures[1]!.requestedUrl).searchParams.get("api_key"), "[redacted]");
  assert.equal(new URL(captures[1]!.finalUrl).searchParams.get("client_secret"), "[redacted]");
  assert.equal(response.url, "https://other.example/calendar?client_secret=private-value");
  assert.ok(capture.evidence.length > 0);
  assert.doesNotMatch(JSON.stringify(capture.evidence), /private/);
  assert.doesNotMatch(JSON.stringify(captures), /private/);
  assert.equal(captures[1]!.finalUrl, "https://other.example/calendar?client_secret=%5Bredacted%5D");
  assert.equal((await vault.list("project/freshness/source-fetch/responses/")).length, 2);
});

test("DNS pinning rejects private, mixed, mapped, and metadata addresses before connecting", async () => {
  for (const address of ["127.0.0.1", "169.254.169.254", "100.64.0.1", "192.168.0.1", "::1", "::ffff:127.0.0.1", "fc00::1", "2001:db8::1", "2002:7f00:1::"]) assert.equal(isPublicAddress(address), false, address);
  for (const address of ["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"]) assert.equal(isPublicAddress(address), true, address);
  await assert.rejects(checkedPublicAddress(new URL("https://state.example"), async () => [{ address: "1.1.1.1", family: 4 }, { address: "10.0.0.1", family: 4 }]));
  assert.deepEqual(await checkedPublicAddress(new URL("https://state.example"), async () => [{ address: "1.1.1.1", family: 4 }]), { address: "1.1.1.1", family: 4 });
});

test("transport pins both lookup forms and reuses the checked host connection pool", async context => {
  const agents: unknown[] = [];
  context.mock.method(http, "request", ((_url: URL, options: http.RequestOptions, callback: (response: http.IncomingMessage) => void) => {
    agents.push(options.agent);
    const lookup = options.lookup! as unknown as (host: string, options: { all: boolean }, callback: (...values: unknown[]) => void) => void;
    lookup("8.8.8.8", { all: false }, (...values) => assert.deepEqual(values, [null, "8.8.8.8", 4]));
    lookup("8.8.8.8", { all: true }, (...values) => assert.deepEqual(values, [null, [{ address: "8.8.8.8", family: 4 }]]));
    assert.equal((options.headers as Record<string, string>).host, "8.8.8.8");
    const outgoing = new PassThrough();
    outgoing.once("finish", () => {
      const incoming = Readable.from([Buffer.from("public bytes")]) as http.IncomingMessage;
      incoming.rawHeaders = ["Content-Type", "text/plain"]; incoming.statusCode = 200;
      callback(incoming); outgoing.destroy();
    });
    return outgoing as unknown as http.ClientRequest;
  }) as typeof http.request);
  for (let read = 0; read < 2; read += 1) assert.equal(await (await publicTransport("http://8.8.8.8/calendar", { headers: { host: "private.internal" } })).text(), "public bytes");
  assert.equal(agents[0], agents[1]);
});

test("Postgres tracks each body sharing a URL and counts unchanged checks on the Eastern day", async () => {
  const { PGlite } = await import("@electric-sql/pglite"), database = new PGlite();
  try {
    for (const statement of [...WEBSITE_PACING_DDL, ...SOURCE_FETCH_DDL]) await database.exec(statement);
    const store = postgresSourceFetchStore(async (statement, parameters) => (await database.query<Record<string, unknown>>(statement, [...parameters])).rows);
    const vault = new MemoryEvidenceStore(), sent = new Map<string, number>();
    for (const sourceId of ["city-council", "school-board"]) {
      for (let pass = 0; pass < 2; pass += 1) await runWithSourceFetch({ sourceId, state: "US-AZ", vault,
        nextDueAt: "2026-10-15T03:00:00Z", runtime: { store, now: () => Date.parse("2026-10-15T02:00:00Z"), transport: async () => {
          const count = sent.get(sourceId) ?? 0; sent.set(sourceId, count + 1);
          return count ? new Response(null, { status: 304 }) : new Response("shared calendar", { headers: { etag: '"current"' } });
        } } }, async () => { assert.equal(await (await fetchSource("https://town.example/calendar")).text(), "shared calendar"); });
    }
    const checks = await database.query<{ source_id: string; http_status: number }>("SELECT source_id,http_status FROM cp_source_checks ORDER BY source_id");
    assert.deepEqual(checks.rows, [{ source_id: "city-council", http_status: 304 }, { source_id: "school-board", http_status: 304 }]);
    const totals = await database.query<{ day: string; checks: string; unchanged: string }>("SELECT day::text,sum(checks)::text AS checks,sum(unchanged)::text AS unchanged FROM cp_source_check_days GROUP BY day");
    assert.deepEqual(totals.rows, [{ day: "2026-10-14", checks: "4", unchanged: "2" }]);
  } finally { await database.close(); }
});

test("nested source scopes retain publisher size and the shared transport when optional overrides are absent", async () => {
  const { store } = memoryStore(), vault = new MemoryEvidenceStore();
  let sent = 0;
  await runWithSourceFetch({ vault, websiteSize: { kind: "school-district", students: 2000 },
    runtime: { store, now: () => 1_000_000, transport: async () => { sent += 1; return new Response("ok"); } } }, async () => {
    const read = () => runWithSourceFetch({ websiteSize: undefined, pacing: undefined,
      runtime: { transport: undefined, now: undefined } }, () => fetchSource("https://district.example/calendar"));
    for (let request = 0; request < 10; request += 1) await read();
    await assert.rejects(read(), SourceFetchDeferred);
  });
  assert.equal(sent, 10);
});


test("sibling body clocks share a due response across store instances while each source keeps its check", async () => {
  const root = await mkdtemp(join(tmpdir(), "fetch-siblings-"));
  try {
    const vault = new DurableEvidenceStore(join(root, "vault"), { remote: null });
    let sent = 0, now = Date.parse("2026-10-15T12:00:00Z");
    const transport: typeof fetch = async (input, init) => {
      sent += 1;
      if (String(input).endsWith("/calendar")) return new Response(null, { status: 302, headers: { location: "/events" } });
      assert.equal(new Headers(init?.headers).has("if-none-match"), sent > 2);
      return sent > 2 ? new Response(null, { status: 304 }) : new Response("same shared calendar", { headers: { etag: '"shared"' } });
    };
    const read = (sourceId: string, dueAt: string) => runWithSourceFetch({ sourceId, state: "US-AZ", dueAt, vault,
      websiteSize: { kind: "local-government", population: 2000 }, runtime: { now: () => now, transport, store: fileSourceFetchStore(root) } },
    async () => (await fetchSource("https://town.example/calendar")).text());
    const bodies = await Promise.all(Array.from({ length: 20 }, (_, index) => read(`body-${index}`, "2026-10-15T12:00:00Z")));
    assert.ok(bodies.every(body => body === "same shared calendar"));
    assert.equal(sent, 2, "the redirect and shared calendar are each requested once for all due bodies");
    now += 3_600_000;
    assert.equal(await read("body-0", "2026-10-15T13:00:00Z"), "same shared calendar");
    assert.equal(sent, 4, "a later body clock requires a new check, including conditional validators after redirect");
  } finally { await rm(root, { recursive: true, force: true }); }
});


test("browser navigation and subrequests use the same publisher allowance and saved transport", async () => {
  const { routeSourceRequests } = await import("../scripts/scout-browse.mts");
  const { store } = memoryStore(), vault = new MemoryEvidenceStore();
  let handle: ((route: import("playwright").Route) => Promise<void>) | undefined, sent = 0, fulfilled = 0, aborted = 0;
  const page = { route: async (pattern: string, callback: typeof handle) => { assert.equal(pattern, "**/*"); handle = callback; } };
  await routeSourceRequests(page as unknown as import("playwright").Page, "https://town.example", 60_000);
  await runWithSourceFetch({ vault, websiteSize: { kind: "local-government", population: 2000 },
    runtime: { store, now: () => 1_000_000, transport: async (_url, init) => {
      assert.match(new Headers(init?.headers).get("user-agent") ?? "", /we-the-people/);
      sent += 1; return new Response("public page");
    } } }, async () => {
    for (let index = 0; index < 11; index += 1) await handle!({
      request: () => ({ url: () => `https://town.example/page/${index}`, method: () => "GET", headers: () => ({}), postData: () => null }),
      fulfill: async () => { fulfilled += 1; }, abort: async () => { aborted += 1; },
    } as unknown as import("playwright").Route);
  });
  assert.deepEqual({ sent, fulfilled, aborted }, { sent: 10, fulfilled: 10, aborted: 1 });
  assert.equal((await vault.list("project/freshness/source-fetch/responses/")).length, 10);
});


test("a caller-held validator counts a 304 without inventing an absent body", async () => {
  const { store, checks, values } = memoryStore(), vault = new MemoryEvidenceStore();
  const response = await runWithSourceFetch({ vault, runtime: { store, transport: async () => new Response(null, { status: 304 }) } },
    () => fetchSource("https://town.example/calendar", { headers: { "if-none-match": '"held-by-adapter"' } }));
  assert.equal(response.status, 304);
  assert.equal(await response.text(), "");
  assert.equal(checks[0]?.unchanged, true);
  assert.equal(checks[0]?.downloadedBytes, 0);
  assert.equal(values.size, 0);
  assert.equal((await vault.list("project/freshness/source-fetch/responses/")).length, 1);
});

test("root prefetch shares durable responses with serial adapters without duplicating checks or document reads", async () => {
  const { PGlite } = await import("@electric-sql/pglite"), database = new PGlite();
  try {
    for (const statement of [...WEBSITE_PACING_DDL, ...SOURCE_FETCH_DDL]) await database.exec(statement);
    const store = postgresSourceFetchStore(async (statement, parameters) => (await database.query<Record<string, unknown>>(statement, [...parameters])).rows);
    const vault = new MemoryEvidenceStore(), calls: string[] = [], captures: SourceResponseCapture[] = [];
    let now = Date.parse("2026-10-15T12:00:00Z");
    const transport: typeof fetch = async (input, init) => {
      const url = String(input); calls.push(url);
      if (url.endsWith("/calendar")) return new Response(null, { status: 302, headers: { location: "/events" } });
      if (url.endsWith("/events") && new Headers(init?.headers).has("if-none-match")) return new Response(null, { status: 304 });
      return new Response(url.endsWith("/events") ? "calendar" : "document", { headers: { etag: '"current"' } });
    };
    const context = { vault, runtime: { store, transport, now: () => now }, sourceId: "council", state: "US-NJ" };
    await runWithSourceFetch(context, async () => {
      await (await fetchSource("https://town.example/calendar", { headers: { accept: "text/html" } })).body?.cancel();
      await (await fetchSource("https://town.example/old-agenda.pdf")).body?.cancel();
    });
    assert.deepEqual(await store.readEntryRequest("US-NJ", "council"), {
      url: "https://town.example/calendar", headers: [["accept", "text/html"]], redirect: "follow", byteCount: 8,
    });
    now += 3_600_000;
    const dueAt = new Date(now).toISOString();
    await runWithSourceFetch({ ...context, onResponse: capture => { captures.push(capture); } }, async () => {
      const trace = await captureSourceAcquisitions(run => run("council", () => prefetchSourceRequests({ sourceId: "council", state: "US-NJ", dueAt })));
      assert.deepEqual(trace.evidence, []);
      assert.equal(captures.length, 0);
      const response = await fetchSource("https://town.example/calendar", { headers: { accept: "text/html" }, source: { dueAt } });
      assert.equal(await response.text(), "calendar");
      assert.equal(response.headers.get("x-meanwhile-source-reused"), "true");
      assert.equal(response.headers.get("x-meanwhile-source-status"), "304");
      assert.equal(response.headers.get("x-meanwhile-source-checked-at"), dueAt);
    });
    assert.equal(captures.length, 1);
    assert.equal(captures[0]!.retrievedAt, dueAt);
    assert.equal(calls.filter(url => url.endsWith(".pdf")).length, 1);
    assert.equal(calls.length, 5, "only the calendar redirect and its conditional target are prefetched");
    const totals = await database.query<{ checks: string; unchanged: string }>("SELECT sum(checks)::text AS checks,sum(unchanged)::text AS unchanged FROM cp_source_check_days");
    assert.deepEqual(totals.rows, [{ checks: "5", unchanged: "1" }]);
    const checked = await database.query<{ next_due_at: string }>("SELECT next_due_at::text FROM cp_source_checks WHERE source_id='council' AND url LIKE '%events'");
    assert.equal(Date.parse(checked.rows[0]!.next_due_at), now, "prefetch leaves the member's work due until its receipt settles");
  } finally { await database.close(); }
});

test("prefetch inventory excludes secrets, POSTs, old documents and oversized roots", async () => {
  const namespace = await mkdtemp(join(tmpdir(), "fetch-entry-")), store = fileSourceFetchStore(namespace), vault = new MemoryEvidenceStore();
  try {
    let sent = 0;
    const runtime = { store, transport: async () => { sent += 1; return new Response("public"); } };
    const cases: [string, string, RequestInit][] = [
      ["secret-query", "https://town.example/calendar?client_secret=private", {}],
      ["dated-query", "https://town.example/calendar?from=2026-10-15", {}],
      ["secret-header", "https://town.example/calendar", { headers: { authorization: "private" } }],
      ["unknown-header", "https://town.example/calendar", { headers: { "x-client": "private" } }],
      ["post", "https://town.example/calendar", { method: "POST", body: "private" }],
    ];
    for (const [sourceId, url, init] of cases) {
      await runWithSourceFetch({ sourceId, state: "US-NJ", sensitiveQueryParameters: ["client_secret"], vault, runtime }, async () => {
        await (await fetchSource(url, init)).body?.cancel();
        await (await fetchSource("https://town.example/old-agenda.pdf")).body?.cancel();
      });
      assert.equal(await store.readEntryRequest("US-NJ", sourceId), null);
    }
    const before = sent;
    await runWithSourceFetch({ vault, runtime }, async () => {
      await prefetchSourceRequests({ sourceId: "oversized", state: "US-NJ", dueAt: new Date().toISOString(),
        seed: { url: "https://town.example/calendar", headers: [], redirect: "follow", byteCount: 1024 * 1024 + 1 } });
      await prefetchSourceRequests({ sourceId: "auth-seed", state: "US-NJ", dueAt: new Date().toISOString(),
        seed: { url: "https://town.example/calendar?api_key=private", headers: [], redirect: "follow", byteCount: 1 } });
      await prefetchSourceRequests({ sourceId: "credential-seed", state: "US-NJ", dueAt: new Date().toISOString(),
        seed: { url: "https://user:private@town.example/calendar", headers: [], redirect: "follow", byteCount: 1 } });
    });
    assert.equal(sent, before);
  } finally { await rm(namespace, { recursive: true, force: true }); }
});

test("prefetch reserves held body bytes through vault completion and releases them after failures", async () => {
  for (const fails of [false, true]) {
    const { store } = memoryStore(), vault = new MemoryEvidenceStore(), events: string[] = [];
    const transport: typeof fetch = async () => {
      events.push("request");
      if (fails) throw new Error("connection closed");
      return new Response("public");
    };
    const work = runWithSourceFetch({ vault, runtime: { store, transport } }, () => prefetchSourceRequests({
      sourceId: "council", state: "US-NJ", dueAt: "2026-10-15T00:00:00Z",
      seed: { url: "https://town.example/calendar", headers: [], redirect: "follow", byteCount: 220_402 },
      acquire: async bytes => {
        assert.equal(bytes, 220_402);
        events.push("reserve");
        return () => { events.push("release"); };
      },
    }));
    if (fails) await assert.rejects(work, /connection closed/);
    else {
      await work;
      assert.equal((await vault.list("project/freshness/source-fetch/responses/")).length, 1);
    }
    assert.deepEqual(events, ["reserve", "request", "release"]);
  }
});
