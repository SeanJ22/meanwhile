import "server-only";
import { readLivePipeline, type LivePipelineRead } from "@/lib/control-plane/live-pipeline-read.ts";
import { sharedRead } from "./shared-read.ts";

const cache = sharedRead<LivePipelineRead>({ freshMs: 2000, staleMs: 12_000, deadlineMs: 1800, keep: r => r.ok,
  late: () => ({ ok: false, reason: "Live pipeline read exceeded 1.8 seconds; the earlier published trail is retained with its original time." }) });

/** Read the existing log's presentation fields, in its original order. No evidence bodies or vaulted bytes cross the wire. */
export function loadLivePipeline(): Promise<LivePipelineRead> {
  return cache.read(() => readLivePipeline(process.env.WTP_CONTROL_PLANE_DATABASE_URL));
}
