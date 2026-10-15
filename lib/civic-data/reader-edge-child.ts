import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROUTINE_RECORD_CLASSES, type PromotedPointerIdentity } from "./types.ts";
import { ROUTINE_STATES } from "./state-scope.ts";
import { runBoundedChildPass, ROUTINE_CHILD_TIMEOUT_MS } from "./bounded-child-pass.ts";
import type { WorkerProcessSlots } from "../control-plane/workers/worker-slots.ts";
import type { ReaderEdgePublicationOutcome } from "./reader-edge-outcome.ts";

export interface ReaderEdgeChildRequest {
  readonly state: string;
  readonly observedAt: string;
  readonly selected: readonly Pick<PromotedPointerIdentity, "recordClass" | "scope">[] | null;
  readonly publicationFingerprint?: string;
}

export function readerEdgeChildRequest(value: unknown): ReaderEdgeChildRequest {
  const request = value as Partial<ReaderEdgeChildRequest> | null;
  if (!request || !ROUTINE_STATES.includes(request.state ?? "") || typeof request.observedAt !== "string" ||
    !Number.isFinite(Date.parse(request.observedAt)) || new Date(request.observedAt).toISOString() !== request.observedAt ||
    request.publicationFingerprint !== undefined && (!/^[a-f0-9]{64}$/.test(request.publicationFingerprint) || request.selected !== null) ||
    request.selected !== null && (!Array.isArray(request.selected) || request.selected.some(pointer =>
      !pointer || !ROUTINE_RECORD_CLASSES.includes(pointer.recordClass) || typeof pointer.scope !== "string" || !pointer.scope))) {
    throw new Error("READER_EDGE_CHILD_REQUEST_INVALID");
  }
  return request as ReaderEdgeChildRequest;
}

function outcomeFrom(value: unknown): ReaderEdgePublicationOutcome {
  const outcome = value as Partial<ReaderEdgePublicationOutcome> | null;
  if (!outcome || typeof outcome.ok !== "boolean" || typeof outcome.readerEdge !== "string" ||
    !["local folder", "Netlify Blobs", "not configured"].includes(outcome.store ?? "") ||
    outcome.sequence !== null && (!Number.isSafeInteger(outcome.sequence) || outcome.sequence! < 0) ||
    outcome.detail !== null && typeof outcome.detail !== "string" ||
    outcome.supersededMeetingFields !== undefined && (!Number.isSafeInteger(outcome.supersededMeetingFields) || outcome.supersededMeetingFields < 0)) {
    throw new Error("READER_EDGE_CHILD_OUTCOME_INVALID");
  }
  return outcome as ReaderEdgePublicationOutcome;
}

export async function runReaderEdgePublicationChild(input: ReaderEdgeChildRequest & {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly memory: WorkerProcessSlots;
  readonly run?: typeof runBoundedChildPass;
  readonly precheck?: () => Promise<{ readonly fingerprint: string; readonly current: ReaderEdgePublicationOutcome | null }>;
}): Promise<ReaderEdgePublicationOutcome> {
  const checked = input.selected === null ? await input.precheck?.() : undefined;
  if (checked?.current) return checked.current;
  const request = readerEdgeChildRequest({ state: input.state, observedAt: input.observedAt,
    selected: input.selected?.map(({ recordClass, scope }) => ({ recordClass, scope })) ?? null,
    ...(checked ? { publicationFingerprint: checked.fingerprint } : {}) });
  const id = `reader-publish:${request.state}/publish-reader-edge.mts`;
  const release = await input.memory.acquire(id, Date.now() + ROUTINE_CHILD_TIMEOUT_MS);
  let directory: string | undefined;
  try {
    directory = await mkdtemp(join(tmpdir(), "meanwhile-reader-publication-"));
    const path = join(directory, "request.json");
    await writeFile(path, JSON.stringify(request), { mode: 0o600 });
    const [run] = await (input.run ?? runBoundedChildPass)([{ id, executable: process.execPath,
      args: ["--experimental-strip-types", "scripts/publish-reader-edge.mts", `--request=${path}`],
      env: input.env, onStarted: pid => release.observe?.(pid),
    }], { cwd: input.cwd, env: input.env, concurrency: 1, maxBufferBytes: 1024 * 1024 });
    if (!run) throw new Error("READER_EDGE_CHILD_RESULT_MISSING");
    if (run.stdout) process.stdout.write(run.stdout);
    if (run.stderr) process.stderr.write(run.stderr);
    if (run.termination !== "EXITED") throw new Error(`READER_EDGE_CHILD_${run.termination}`);
    const outcome = outcomeFrom(JSON.parse(await readFile(join(directory, "outcome.json"), "utf8")));
    if (run.status !== (outcome.ok ? 0 : 2)) throw new Error("READER_EDGE_CHILD_EXIT_MISMATCH");
    return outcome;
  } finally {
    try { if (directory) await rm(directory, { recursive: true, force: true }); }
    finally { release(); }
  }
}
