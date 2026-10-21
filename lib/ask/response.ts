import type { AskTrace } from "./trace.ts";

/** Timings describe completed work; overlapping reads have separate names. */
export function askResponse(body: unknown, init?: ResponseInit): Response {
  const response = Response.json(body, init);
  const trace = body && typeof body === "object" && "trace" in body ? body.trace as AskTrace : null;
  if (!trace) return response;
  const entries: [string, number | undefined][] = [
    ["answer", trace.totalMs],
    ...Object.entries(trace.stages ?? {}).map(([name, ms]): [string, number] => [`stage_${name}`, ms]),
    ...Object.entries(trace.preloads ?? {}).map(([name, ms]): [string, number] => [`read_${name}`, ms]),
    ["interpret", trace.interpretation.ms],
    ...(trace.synthesis.writers ?? []).map((writer, index): [string, number] => [`writer_${index + 1}`, writer.ms]),
    ["ai_answer", trace.fallback?.ms],
  ];
  response.headers.set("Server-Timing", entries.filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]))
    .map(([name, ms]) => `${name.replace(/[^a-zA-Z0-9_]/g, "_")};dur=${Math.max(0, Math.round(ms))}`).join(", "));
  return response;
}
