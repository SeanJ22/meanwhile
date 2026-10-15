import assert from "node:assert/strict";
import test from "node:test";
import { readFile, writeFile, access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { readerEdgeChildRequest, runReaderEdgePublicationChild } from "../lib/civic-data/reader-edge-child.ts";
import type { ReaderEdgePublicationOutcome } from "../lib/civic-data/reader-edge-outcome.ts";
import type { WorkerMemoryRelease } from "../lib/control-plane/workers/worker-slots.ts";

const request = { state: "US-AZ", observedAt: "2026-10-15T12:00:00.000Z",
  selected: [{ recordClass: "MEETING" as const, scope: "US-AZ:meetings" }] };
const accepted: ReaderEdgePublicationOutcome = { ok: true, readerEdge: "PUBLISHED", store: "Netlify Blobs", sequence: 8, detail: null };

test("the edge child has its own memory admission and releases it only after its outcome is collected", async () => {
  const events: string[] = [];
  let path = "";
  const result = await runReaderEdgePublicationChild({ ...request, cwd: process.cwd(), env: process.env,
    memory: { acquire: async entry => {
      assert.equal(entry, "reader-publish:US-AZ/publish-reader-edge.mts");
      events.push("admitted");
      return Object.assign(() => events.push("released"), { observe: (pid: number) => events.push(`observed:${pid}`) }) as WorkerMemoryRelease;
    } }, run: async (commands, options) => {
      assert.deepEqual(events, ["admitted"]);
      assert.equal(options.concurrency, 1);
      const command = commands[0]!;
      assert.equal(command.args[1], "scripts/publish-reader-edge.mts");
      path = command.args[2]!.slice("--request=".length);
      assert.deepEqual(JSON.parse(await readFile(path, "utf8")), request);
      command.onStarted?.(12345);
      events.push("published");
      await writeFile(join(dirname(path), "outcome.json"), JSON.stringify(accepted));
      return [{ id: command.id, status: 0, signal: null, stdout: "", stderr: "", termination: "EXITED", errorMessage: null }];
    } });
  assert.deepEqual(result, accepted);
  assert.deepEqual(events, ["admitted", "observed:12345", "published", "released"]);
  await assert.rejects(access(dirname(path)), { code: "ENOENT" });
});

test("a held publication returns the same failure receipt and failed children never retain memory", async () => {
  for (const mode of ["held", "crashed", "contradictory"] as const) {
    let released = 0;
    const failure = { ...accepted, ok: false, readerEdge: "FAILED", detail: "The earlier manifest remains available." };
    const run = runReaderEdgePublicationChild({ ...request, cwd: process.cwd(), env: process.env,
      memory: { acquire: async () => () => { released++; } }, run: async commands => {
        const command = commands[0]!;
        const path = command.args[2]!.slice("--request=".length);
        if (mode !== "crashed") await writeFile(join(dirname(path), "outcome.json"), JSON.stringify(failure));
        return [{ id: command.id, status: mode === "held" ? 2 : 0, signal: null, stdout: "", stderr: "",
          termination: mode === "crashed" ? "TIMED_OUT" : "EXITED", errorMessage: null }];
      } });
    if (mode === "held") assert.deepEqual(await run, failure);
    else await assert.rejects(run, mode === "crashed" ? /READER_EDGE_CHILD_TIMED_OUT/ : /READER_EDGE_CHILD_EXIT_MISMATCH/);
    assert.equal(released, 1);
  }
});

test("reader child requests require an explicit state and typed pointer selection", () => {
  for (const invalid of [{ ...request, state: "country" }, { ...request, observedAt: "today" }, { ...request, selected: undefined },
    { ...request, selected: [{ recordClass: "UNKNOWN", scope: "US-AZ" }] }]) {
    assert.throws(() => readerEdgeChildRequest(invalid), /READER_EDGE_CHILD_REQUEST_INVALID/);
  }
});

test("an unchanged input identity avoids child import and memory admission", async () => {
  const current = { ...accepted, readerEdge: "CURRENT" };
  const result = await runReaderEdgePublicationChild({ ...request, selected: null, cwd: process.cwd(), env: process.env,
    memory: { acquire: async () => { throw new Error("unchanged inputs must not reserve a child"); } },
    precheck: async () => ({ fingerprint: "a".repeat(64), current }),
    run: async () => { throw new Error("unchanged inputs must not start a child"); },
  });
  assert.deepEqual(result, current);
});

test("changed input identity travels with the canonical publication request", async () => {
  const fingerprint = "b".repeat(64);
  await runReaderEdgePublicationChild({ ...request, selected: null, cwd: process.cwd(), env: process.env,
    memory: { acquire: async () => () => {} }, precheck: async () => ({ fingerprint, current: null }),
    run: async commands => {
      const command = commands[0]!;
      const path = command.args[2]!.slice("--request=".length);
      assert.deepEqual(JSON.parse(await readFile(path, "utf8")), { ...request, selected: null, publicationFingerprint: fingerprint });
      await writeFile(join(dirname(path), "outcome.json"), JSON.stringify(accepted));
      return [{ id: command.id, status: 0, signal: null, stdout: "", stderr: "", termination: "EXITED", errorMessage: null }];
    },
  });
});
