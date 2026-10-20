import assert from "node:assert/strict";
import test from "node:test";

import { EXA_AGENT_EFFORT, runExaAgent } from "../lib/hunt/exa-agent.ts";
import type { HuntPacket } from "../lib/hunt/packet.ts";

const COUNTY = "ocd-division/country:us/state:az/county:pima";
const packet: HuntPacket = { governmentId: COUNTY, label: "Pima County", held: [],
  blanks: [{ subjectId: `${COUNTY}#board`, subjectLabel: "Board of Supervisors", checklistId: "MTG-01", family: "MTG", requirement: "Regular meeting schedule" }] };

function exa(responses: readonly unknown[]) {
  const sent: { url: string; init: { method?: string; body?: string } }[] = [];
  const fetchImpl = async (url: string, init?: unknown) => {
    sent.push({ url, init: (init ?? {}) as { method?: string; body?: string } });
    const body = responses[Math.min(sent.length - 1, responses.length - 1)];
    return { ok: true, status: 200, text: async () => JSON.stringify(body), json: async () => body } as unknown as Response;
  };
  return { sent, fetchImpl };
}

test("the packet goes to Exa's agent at high effort with the report_finding shape, and its findings and cost come back", async () => {
  const finding = { subjectId: `${COUNTY}#board`, field: "MTG-01", value: "first Tuesday", sourceUrl: "https://pima.example.gov/board",
    sentence: "The Board meets on the first Tuesday of each month." };
  const { sent, fetchImpl } = exa([{ id: "run-1", status: "running" },
    { id: "run-1", status: "completed", output: { structured: { findings: [finding, { subjectId: "x" }], summary: "one found" } }, costDollars: { total: 0.42 } }]);
  const run = await runExaAgent({ packet, key: "secret", instructions: "Hunt.", deadlineMs: Number.POSITIVE_INFINITY,
    fetchImpl: fetchImpl as never, sleep: async () => {} });
  const created = JSON.parse(sent[0]!.init.body!) as { effort: string; outputSchema: { required: string[] }; query: string };
  assert.equal(created.effort, EXA_AGENT_EFFORT);
  assert.deepEqual(created.outputSchema.required, ["findings", "summary"]);
  assert.match(created.query, /Regular meeting schedule/);
  assert.equal(run.status, "completed");
  assert.deepEqual(run.findings, [finding], "an incomplete finding is dropped");
  assert.equal(run.costUsd, 0.42);
  assert.equal(run.error, null);
});

test("a run past its time limit is cancelled, its cost recorded and whatever it reported kept", async () => {
  let now = 0;
  let polls = 0;
  const kept = { subjectId: `${COUNTY}#board`, field: "MTG-01", value: "first Tuesday", sourceUrl: "https://pima.example.gov/board", sentence: "The Board meets on the first Tuesday." };
  const { sent, fetchImpl } = exa([{ id: "run-2", status: "running" },
    { id: "run-2", status: "cancelled", output: { structured: { findings: [kept], summary: "" } }, costDollars: { total: 0.5 } }]);
  const run = await runExaAgent({ packet, key: "secret", instructions: "Hunt.", deadlineMs: 4, fetchImpl: fetchImpl as never,
    sleep: async () => { now += 5; }, clock: () => now, onPoll: () => { polls += 1; } });
  assert.equal(sent.at(-1)!.url, "https://api.exa.ai/agent/runs/run-2/cancel");
  assert.equal(sent.at(-1)!.init.method, "POST");
  assert.equal(run.requestCount,2,"the deadline is followed by cancellation, without another poll");
  assert.equal(run.status, "cancelled");
  assert.deepEqual(run.findings, [kept]);
  assert.equal(run.costUsd, 0.5);
  assert.match(run.error ?? "", /passed its time limit and was cancelled/);
  assert.ok(polls > 0, "each poll tells the worker pool the job is still working");
});
