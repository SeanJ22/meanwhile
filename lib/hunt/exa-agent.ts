/** The same hunt packet sent to Exa's research agent; its findings go into the Box
 * beside our own hunter's, and Exa reports what each run cost. */
import type { FetchLike } from "./search.ts";
import type { HuntPacket } from "./packet.ts";
import { huntBrief } from "./brief.ts";

const AGENT_RUNS = "https://api.exa.ai/agent/runs";
export const EXA_AGENT_HOST = new URL(AGENT_RUNS).host;
export const EXA_AGENT_EFFORT = "high";
const TERMINAL = new Set(["completed", "failed", "cancelled"]);
const POLL_MS = 4_000;

/** The same fields report_finding takes, so both lanes write the Box the same way. */
const EXA_AGENT_OUTPUT_SCHEMA = {
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

interface ExaAgentFinding {
  readonly subjectId: string;
  readonly field: string;
  readonly value: string;
  readonly sourceUrl: string;
  readonly sentence: string;
}

export interface ExaAgentRun {
  readonly requestCount: number;
  readonly bytesFetched: number;
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
  return typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? raw : null;
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
  readonly onPoll?: () => void;
  readonly onCreated?: (runId: string) => Promise<void>;
  readonly resumeRunId?: string;
}): Promise<ExaAgentRun> {
  const fetchImpl = input.fetchImpl ?? ((url, init) => fetch(url, init as RequestInit) as unknown as ReturnType<FetchLike>);
  const sleep = input.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const clock = input.clock ?? Date.now;
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${input.key}` };
  let requestCount = 0, bytesFetched = 0;
  type RunBody = { id?: string; status?: string; output?: { structured?: unknown }; costDollars?: { total?: unknown } | number; error?: { message?: string } };
  const request = async (url: string, method: string, body?: string): Promise<RunBody> => {
    const remaining = input.deadlineMs - clock();
    if (remaining <= 0 && !url.endsWith('/cancel')) throw new Error('Exa request deadline reached');
    const signal = AbortSignal.timeout(Math.max(1, Math.min(20_000, url.endsWith('/cancel') ? 20_000 : remaining)));
    requestCount += 1;
    const response = await fetchImpl(url, {method,headers,signal,...(body === undefined ? {} : {body})});
    const text = await response.text();
    bytesFetched += Buffer.byteLength(text);
    if (!response.ok) throw new Error(`exa HTTP ${response.status}: ${text.split(input.key).join('[REDACTED]').slice(0,200)}`);
    return JSON.parse(text) as RunBody;
  };
  let runId = input.resumeRunId ?? null;
  let body: RunBody = {};
  let failure: string | null = null;
  try {
    body = runId ? await request(`${AGENT_RUNS}/${encodeURIComponent(runId)}`, 'GET')
      : await request(AGENT_RUNS, 'POST', JSON.stringify({
          query: huntBrief(input.packet, {role:'HUNTER',tried:[]}),
          systemPrompt: `${input.instructions}\nAs of ${new Date().toISOString().slice(0,10)}, report currently serving officials using the government's standing roster or an explicit current term. Keep former officials, future appointees and candidates separate. Use published public pages for contacts. Do not buy contact enrichment or use premium data providers.`,
          effort: EXA_AGENT_EFFORT, outputSchema: EXA_AGENT_OUTPUT_SCHEMA,
          metadata: {governmentId: input.packet.governmentId},
        }));
    runId = typeof body.id === 'string' ? body.id : runId;
    if (!runId) throw new Error('Exa did not return a run id');
    await input.onCreated?.(runId);
    while (!TERMINAL.has(String(body.status)) && clock() < input.deadlineMs) {
      await sleep(Math.min(POLL_MS, Math.max(0,input.deadlineMs-clock())));
      input.onPoll?.();
      if (clock() >= input.deadlineMs) break;
      try { body = await request(`${AGENT_RUNS}/${encodeURIComponent(runId)}`, 'GET'); }
      catch(error) { failure = error instanceof Error ? error.message : String(error); }
    }
  } catch(error) { failure = error instanceof Error ? error.message : String(error); }
  let timedOut = false;
  if (runId && !TERMINAL.has(String(body.status))) {
    timedOut = clock() >= input.deadlineMs;
    try { body = await request(`${AGENT_RUNS}/${encodeURIComponent(runId)}/cancel`, 'POST'); }
    catch(error) { failure = error instanceof Error ? error.message : String(error); }
  }
  const status = String(body.status ?? "unknown");
  const { findings, summary } = findingsOf(body.output?.structured);
  return { requestCount, bytesFetched, runId, status, findings, summary, costUsd: costOf(body),
    error: status === "completed" ? null : timedOut ? `the run passed its time limit and was ${status === "cancelled" ? "cancelled" : "left running: the cancel was not accepted"}`
      : body.error?.message ?? failure ?? status };
}
