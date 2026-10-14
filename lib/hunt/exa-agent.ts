/**
 * The Exa agent lane: the same hunt packet sent to Exa's research agent, whose structured findings go into the Box
 * beside our own hunter's. Exa's model does the research; Exa reports what each run cost.
 */
import type { FetchLike } from "./search.ts";
import type { HuntPacket } from "./packet.ts";
import { huntBrief } from "./brief.ts";

const AGENT_RUNS = "https://api.exa.ai/agent/runs";
export const EXA_AGENT_HOST = new URL(AGENT_RUNS).host;
export const EXA_AGENT_EFFORT = "high";
const TERMINAL = new Set(["completed", "failed", "cancelled"]);
const POLL_MS = 4_000;

/** The same fields report_finding takes, so both lanes write the Box the same way. */
export const EXA_AGENT_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          subjectId: { type: "string", description: "The subject id in [brackets] from the blanks list." },
          field: { type: "string", description: "The blank's checklist id, e.g. OFF-04." },
          value: { type: "string", description: "The value as the page states it." },
          sourceUrl: { type: "string", description: "The page that states it." },
          sentence: { type: "string", description: "The exact sentence on that page that states the value." },
        },
        required: ["subjectId", "field", "value", "sourceUrl", "sentence"],
      },
    },
    summary: { type: "string" },
  },
  required: ["findings", "summary"],
} as const;

export interface ExaAgentFinding {
  readonly subjectId: string;
  readonly field: string;
  readonly value: string;
  readonly sourceUrl: string;
  readonly sentence: string;
}

export interface ExaAgentRun {
  readonly runId: string | null;
  readonly status: string;
  readonly findings: readonly ExaAgentFinding[];
  readonly summary: string;
  /** What Exa says the run cost; null when it did not say. */
  readonly costUsd: number | null;
  readonly error: string | null;
}

function findingsOf(structured: unknown): { findings: ExaAgentFinding[]; summary: string } {
  const value = structured as { findings?: unknown; summary?: unknown } | null;
  const rows = Array.isArray(value?.findings) ? value.findings as Record<string, unknown>[] : [];
  const findings = rows.flatMap(row => ["subjectId", "field", "value", "sourceUrl", "sentence"].every(key => typeof row[key] === "string" && row[key])
    ? [{ subjectId: String(row.subjectId), field: String(row.field), value: String(row.value), sourceUrl: String(row.sourceUrl), sentence: String(row.sentence) }]
    : []);
  return { findings, summary: typeof value?.summary === "string" ? value.summary : "" };
}

const costOf = (body: { costDollars?: { total?: unknown } | number }): number | null => {
  const raw = typeof body.costDollars === "number" ? body.costDollars : body.costDollars?.total;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
};

/** Start one run for a packet and wait for it to end, or for `deadlineMs` to pass. */
export async function runExaAgent(input: {
  readonly packet: HuntPacket;
  readonly key: string;
  readonly instructions: string;
  readonly deadlineMs: number;
  readonly fetchImpl?: FetchLike;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly clock?: () => number;
}): Promise<ExaAgentRun> {
  const fetchImpl = input.fetchImpl ?? ((url, init) => fetch(url, init as RequestInit) as unknown as ReturnType<FetchLike>);
  const sleep = input.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const clock = input.clock ?? Date.now;
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${input.key}` };
  const created = await fetchImpl(AGENT_RUNS, { method: "POST", headers, body: JSON.stringify({
    query: huntBrief(input.packet, { role: "HUNTER", tried: [] }), systemPrompt: input.instructions,
    effort: EXA_AGENT_EFFORT, outputSchema: EXA_AGENT_OUTPUT_SCHEMA }) });
  const createdText = await created.text();
  if (!created.ok) return { runId: null, status: "failed", findings: [], summary: "", costUsd: null,
    error: `exa HTTP ${created.status}: ${createdText.split(input.key).join("[REDACTED]").slice(0, 200)}` };
  let body = JSON.parse(createdText) as { id?: string; status?: string; output?: { structured?: unknown }; costDollars?: { total?: unknown }; error?: { message?: string } };
  const runId = typeof body.id === "string" ? body.id : null;
  while (runId !== null && !TERMINAL.has(String(body.status)) && clock() < input.deadlineMs) {
    await sleep(POLL_MS);
    const polled = await fetchImpl(`${AGENT_RUNS}/${encodeURIComponent(runId)}`, { method: "GET", headers });
    if (!polled.ok) continue;
    body = JSON.parse(await polled.text()) as typeof body;
  }
  const status = String(body.status ?? "unknown");
  const { findings, summary } = status === "completed" ? findingsOf(body.output?.structured) : { findings: [], summary: "" };
  return { runId, status, findings, summary, costUsd: costOf(body),
    error: status === "completed" ? null : body.error?.message ?? (TERMINAL.has(status) ? status : "the run did not finish before its time limit") };
}
