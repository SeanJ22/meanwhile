import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { channel } from "node:diagnostics_channel";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { neon, neonConfig } from "@neondatabase/serverless";
import { PostgresRoutineDataStore } from "../../lib/civic-data/store.ts";
import type { SourceAuthorityId } from "../../lib/civic-data/source-authority.ts";
import type { ReadOnlyQuery } from "../../lib/control-plane/admin-view/promoted-slices.ts";
import { assertRuntimeAuthority } from "../../lib/civic-data/runtime-authority.ts";

interface BenchmarkStorageBytes {
  read: number;
  written: number;
  requests: number;
  statements: number;
  largestRead: number;
  largestWrite: number;
  databasePeakRssBytes: number;
  databaseElapsedMs: number;
  largestLatencyMs: number;
}
interface Answer { id: number; type?: string; status?: number; body?: string; databasePeakRssBytes?: number }

export class FederalMoneyBenchmarkStore extends PostgresRoutineDataStore {
  readonly bytes: BenchmarkStorageBytes;
  readonly query: ReadOnlyQuery;
  private readonly shutdown: () => Promise<void>;

  private constructor(bytes: BenchmarkStorageBytes, query: ReadOnlyQuery, shutdown: () => Promise<void>, source: SourceAuthorityId) {
    super(); this.bytes = bytes; this.query = query; this.shutdown = shutdown;
    Object.assign(this, { writeAuthority: assertRuntimeAuthority({ capabilities: ["ROUTINE_CONTRACT"], contract: source }) });
  }

  static async open(directory: string, source: SourceAuthorityId): Promise<FederalMoneyBenchmarkStore> {
    const original = { fetch: neonConfig.fetchFunction, url: process.env.DATABASE_URL, reporting: process.env.WTP_VITAL_SIGNS_REPORT, mode: process.env.WTP_RUNTIME_MODE, role: process.env.WTP_DB_ROLE, control: process.env.WTP_CONTROL_PLANE_DATABASE_URL };
    const bytes: BenchmarkStorageBytes = { read: 0, written: 0, requests: 0, statements: 0, largestRead: 0, largestWrite: 0, databasePeakRssBytes: 0, databaseElapsedMs: 0, largestLatencyMs: 0 };
    const child: ChildProcessWithoutNullStreams = spawn(process.execPath, ["--experimental-strip-types", resolve("scripts/lib/federal-money-postgres-server.mts"), resolve(directory), String(Date.now())], { stdio: ["pipe", "pipe", "pipe"] });
    child.stderr.pipe(process.stderr);
    let serial = 0;
    const pending = new Map<number, { resolve: (answer: Answer) => void; reject: (reason: Error) => void }>();
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    let receivedReady = false;
    const ready = new Promise<void>((accept, reject) => {
      child.once("error", reject);
      child.once("exit", code => { if (!receivedReady) reject(new Error(`Benchmark PostgreSQL exited ${code} before initialization`)); });
      lines.on("line", line => {
        const answer = JSON.parse(line) as Answer;
        if (answer.type === "ready") { receivedReady = true; accept(); return; }
        const request = pending.get(answer.id);
        pending.delete(answer.id); request?.resolve(answer);
      });
    });
    child.once("exit", code => {
      for (const request of pending.values()) request.reject(new Error(`Benchmark PostgreSQL exited ${code}`));
      pending.clear(); lines.close();
    });
    await ready;
    const send = (message: { type?: string; body?: string }): Promise<Answer> => new Promise((accept, reject) => {
      const id = ++serial; pending.set(id, { resolve: accept, reject });
      child.stdin.write(`${JSON.stringify({ id, ...message })}\n`, error => { if (error) { pending.delete(id); reject(error); } });
    });
    const request = async (body: string) => {
      const payload = JSON.parse(body) as { queries?: unknown[] };
      const outgoing = Buffer.byteLength(body);
      const memory = channel("federal-money:memory");
      if (memory.hasSubscribers) memory.publish({ stage: "database-request", item: source, itemBytes: outgoing, liveItems: 1 });
      const started = performance.now();
      const answer = await send({ body });
      const elapsed = performance.now() - started;
      bytes.databaseElapsedMs += elapsed; bytes.largestLatencyMs = Math.max(bytes.largestLatencyMs, elapsed);
      const incoming = Buffer.byteLength(answer.body!);
      if (memory.hasSubscribers) memory.publish({ stage: "database-response", item: source, itemBytes: incoming, liveItems: 1 });
      bytes.written += outgoing; bytes.read += incoming; bytes.requests++; bytes.statements += payload.queries?.length ?? 1;
      bytes.largestWrite = Math.max(bytes.largestWrite, outgoing); bytes.largestRead = Math.max(bytes.largestRead, incoming);
      return answer;
    };
    neonConfig.fetchFunction = async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (typeof init?.body !== "string") throw new Error("Benchmark Neon request must carry JSON.");
      const answer = await request(init.body);
      return new Response(answer.body, { status: answer.status, headers: { "content-type": "application/json" } });
    };
    process.env.DATABASE_URL = "postgresql://benchmark:benchmark@ep-federal-benchmark.us-east-2.aws.neon.tech/benchmark";
    process.env.WTP_VITAL_SIGNS_REPORT = "1";
    process.env.WTP_RUNTIME_MODE = "staging";
    process.env.WTP_DB_ROLE = "local";
    process.env.WTP_CONTROL_PLANE_DATABASE_URL = process.env.DATABASE_URL;
    const client = neon(process.env.DATABASE_URL);
    const query: ReadOnlyQuery = statements => client.transaction(statements.map(statement => client.query(statement.text, [...statement.params])));
    return new FederalMoneyBenchmarkStore(bytes, query, async () => {
      const exited = once(child, "exit");
      const answer = await send({ type: "close" });
      bytes.databasePeakRssBytes = answer.databasePeakRssBytes ?? 0;
      child.stdin.end(); await exited;
      neonConfig.fetchFunction = original.fetch;
      if (original.url === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = original.url;
      if (original.role === undefined) delete process.env.WTP_DB_ROLE; else process.env.WTP_DB_ROLE = original.role;
      if (original.control === undefined) delete process.env.WTP_CONTROL_PLANE_DATABASE_URL; else process.env.WTP_CONTROL_PLANE_DATABASE_URL = original.control;
      if (original.mode === undefined) delete process.env.WTP_RUNTIME_MODE; else process.env.WTP_RUNTIME_MODE = original.mode;
      if (original.reporting === undefined) delete process.env.WTP_VITAL_SIGNS_REPORT; else process.env.WTP_VITAL_SIGNS_REPORT = original.reporting;
    }, source);
  }

  async close() { await this.shutdown(); }
}
