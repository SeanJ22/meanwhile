/** Completion status comes from bounded evidence across the whole saved log, never its tail. */
import { createReadStream } from "node:fs";
import { StringDecoder } from "node:string_decoder";

export const COMPLETION_LINE_BYTES = 4 * 1024 * 1024;
export const COMPLETION_EVIDENCE_BYTES = 1024 * 1024;
const controls = ["RH01_NATIONAL_RESULT ", "RH01_ROUTE_REPLAY ", "RH01_REPLAY ", "RH01_FRESHNESS_RESULT ", "RH01_PILOT_CYCLE ",
  "RCD_OPERATIONAL_OUTCOME=", "RCD_RUN=", "RCD_RECEIPT=", "INTAKE_RUNTIME_RECEIPT="] as const;
const statuses = /hunter lane:|refresh failed|open request hold could not be released|pilot-runner · 1 cycle\(s\) complete\.|owner-snapshot · published: snapshot;|incomplete control-plane inputs|NOT BUILT|--dry-run:|target: [^\r\n]*role=readonly|DRY RUN — nothing applied|No pending [^\r\n]* migrations within this plan|loss study:|not read:|nothing was measured|nothing was studied|break patterns:|claim audit:|lessons not saved:|could not be done:|live audit:|lessons not kept:|resident tasks:|speed:/;
type Receipt = { readonly acquisitionSucceeded?: boolean; readonly decision?: string; readonly state?: string };
export interface CompletionLogEvidence {
  readonly stdout: string; readonly stderr: string; readonly receipt: Receipt | null;
  readonly refusedOperation: boolean; readonly failures: readonly string[];
  readonly scannedBytes: number; readonly retainedBytes: number; readonly selectedLines: number;
}

function compactControl(line: string): { text: string; receipt?: Receipt } {
  const prefix = controls.find(value => line.startsWith(value));
  if (!prefix) return { text: line };
  let value: Record<string, unknown>;
  try { value = JSON.parse(line.slice(prefix.length)); }
  catch { return { text: line }; }
  if (!value || typeof value !== "object" || Array.isArray(value)) return { text: line };
  const keys = prefix === "RH01_NATIONAL_RESULT " ? ["zip", "completed", "deferred"]
    : prefix === "RH01_ROUTE_REPLAY " ? ["complete"]
      : prefix === "RH01_REPLAY " ? ["complete", "role", "taskId", "committedResultId", "reports"]
        : prefix === "RH01_FRESHNESS_RESULT " ? ["state", "durable", "simulated", "filtered", "registeredUnits", "workedUnits", "cycleId"]
          : prefix === "RH01_PILOT_CYCLE " ? ["ok", "recorded", "registeredUnits", "workedUnits"]
            : prefix === "RCD_OPERATIONAL_OUTCOME=" ? ["state", "durable"]
              : prefix === "RCD_RUN=" ? ["denominator", "attempted", "failed", "skipped"]
                : prefix === "RCD_RECEIPT=" ? ["acquisitionSucceeded", "decision", "state"]
                  : ["outcome", "reactionDays", "limiterRowsRemaining"];
  const compact = Object.fromEntries(keys.filter(key => key in value).map(key => [key, value[key]]));
  if (prefix === "RH01_REPLAY " && Array.isArray(compact.reports)) compact.reports = compact.reports.map(row =>
    row && typeof row === "object" ? { claimed: row.claimed, outcome: row.outcome, attemptId: row.attemptId } : row);
  if (prefix === "INTAKE_RUNTIME_RECEIPT=" && Array.isArray(compact.reactionDays)) compact.reactionDays = [];
  return { text: prefix + JSON.stringify(compact), ...(prefix === "RCD_RECEIPT=" ? { receipt: compact as Receipt } : {}) };
}

/** Each checker keeps its last status, while failure observations are monotone. */
function statusEvidence(line: string): readonly { key: string; text: string }[] {
  const result: { key: string; text: string }[] = [];
  const keep = (key: string, text: string) => result.push({ key, text });
  for (const literal of ["refresh failed", "open request hold could not be released", "hunter lane: stuck worker ended alone:",
    "incomplete control-plane inputs", "NOT BUILT", "--dry-run:", "not read:", "nothing was measured", "nothing was studied",
    "lessons not saved:", "could not be done:", "lessons not kept:"]) if (line.includes(literal)) keep(`failure:${literal}`, literal);
  for (const [key, pattern] of [
    ["hunter-task-failure", /hunter lane: task done: [^\r\n]*; (?:FAILED|NOT_CLAIMED|NOT_RUN)\b/],
    ["hunter-hunt-failure", /hunter lane: hunt done: [^\r\n]*; REFUSED;/],
    ["hunter-process-failure", /hunter lane: lease worker process ended: pid \d+; (?!exit 0\r?$)[^\r\n]+/],
  ] as const) { const match = pattern.exec(line); if (match) keep(key, match[0]); }
  for (const [key, pattern] of [
    ["hunter-armed", /^hunter lane: armed;/],
    ["hunter-ended", /^hunter lane: ended after \d+ wave\(s\), \d+ task result\(s\): (?:its life ended; the runner starts a fresh lane|a release asked it to drain)$/],
    ["pilot-ended", /pilot-runner · 1 cycle\(s\) complete\./], ["snapshot-published", /owner-snapshot · published: snapshot;/],
    ["migration-target", /target: [^\r\n]*role=readonly/], ["migration-dry", /DRY RUN — nothing applied/],
    ["migration-none", /No pending [^\r\n]* migrations within this plan/],
    ["loss-study", /loss study: \d+ lessons from \d+ losses/], ["break-patterns", /break patterns: \d+ found, \d+ lessons written/],
    ["live-audit", /live audit: \d+ sampled in \d+ areas;/], ["resident-tasks", /resident tasks: \d+ passed, 0 failed,/],
    ["speed", /speed: \d+ within three seconds, 0 too slow or unfinished,/],
  ] as const) { const match = pattern.exec(line); if (match) keep(key, match[0]); }
  const claims = /claim audit: (\d+) claims checked.*; (\d+) confirmed, (\d+) wrong, 0 could not be checked/.exec(line);
  if (claims) keep("claim-audit", `claim audit: ${claims[1]} claims checked; ${claims[2]} confirmed, ${claims[3]} wrong, 0 could not be checked`);
  return result;
}

export async function readCompletionLogEvidence(input: { readonly stdoutFile: string; readonly stderrFile: string }): Promise<CompletionLogEvidence> {
  const lines = { stdout: new Map<string, string>(), stderr: new Map<string, string>() }, failures = new Set<string>();
  let scannedBytes = 0, retainedBytes = 0, selectedLines = 0, refusedOperation = false, receipt: Receipt | null = null;
  const keep = (channel: "stdout" | "stderr", key: string, text: string): boolean => {
    const prior = lines[channel].get(key), bytes = Buffer.byteLength(text) + 1;
    const total = retainedBytes - (prior === undefined ? 0 : Buffer.byteLength(prior) + 1) + bytes;
    if (total > COMPLETION_EVIDENCE_BYTES - 1024) { failures.add("SELECTED_EVIDENCE_LIMIT"); return false; }
    retainedBytes = total; selectedLines++; lines[channel].set(key, text); return true;
  };
  for (const [channel, path] of [["stdout", input.stdoutFile], ["stderr", input.stderrFile]] as const) {
    let chunks: Buffer[] = [], lineBytes = 0, start = "", carry = "", remote = false, relevant = false;
    let decoder = new StringDecoder("utf8");
    const part = (bytes: Buffer) => {
      scannedBytes += bytes.length; lineBytes += bytes.length;
      const decoded = decoder.write(bytes);
      start = (start + decoded.slice(0, 256)).slice(0, 256);
      let text = carry + decoded;
      if (/RH01_UNSUPPORTED|WRITE_HANDLE_REFUSED|RuntimeAuthorityRefused/.test(text)) refusedOperation = true;
      if (!remote) {
        const index = text.indexOf("RH01_REMOTE_");
        if (index >= 0) { remote = true; text = text.slice(index + "RH01_REMOTE_".length); }
      }
      if (remote && text.includes("_BLOCKED")) refusedOperation = true;
      relevant ||= controls.some(prefix => start.startsWith(prefix)) ||
        /^(?:hunter lane:|target:|loss study:|break patterns:|claim audit:|live audit:|resident tasks:|speed:|owner-snapshot|pilot-runner)/.test(start.trimStart()) ||
        statuses.test(carry + decoded);
      carry = text.slice(-256);
      if (lineBytes <= COMPLETION_LINE_BYTES) chunks.push(bytes);
      else { chunks = []; if (relevant) failures.add("CONTROL_LINE_LIMIT"); }
    };
    const end = () => {
      if (lineBytes > COMPLETION_LINE_BYTES) { if (relevant) failures.add("CONTROL_LINE_LIMIT"); }
      else {
        const line = Buffer.concat(chunks, lineBytes).toString("utf8").replace(/\r$/, "");
        const prefix = controls.find(value => line.startsWith(value));
        if (prefix) {
          const compact = compactControl(line);
          if (keep(channel, prefix, compact.text) && channel === "stdout" && compact.receipt) receipt = compact.receipt;
        }
        for (const observation of statusEvidence(line)) keep(channel, observation.key, observation.text);
      }
      chunks = []; lineBytes = 0; start = ""; carry = ""; remote = false; relevant = false; decoder = new StringDecoder("utf8");
    };
    try {
      for await (const raw of createReadStream(path, { highWaterMark: 64 * 1024 })) {
        const bytes = raw as Buffer;
        let begin = 0;
        for (;;) {
          const newline = bytes.indexOf(10, begin);
          if (newline < 0) { if (begin < bytes.length) part(bytes.subarray(begin)); break; }
          part(bytes.subarray(begin, newline)); scannedBytes++; end(); begin = newline + 1;
        }
      }
      if (lineBytes) end();
    } catch { failures.add(`UNREADABLE_${channel.toUpperCase()}_LOG`); }
  }
  if (refusedOperation) lines.stderr.set("boundary-refusal", "RH01_UNSUPPORTED_RECORDED_OPERATION");
  if (failures.size) lines.stderr.set("evidence-failure", "RH01_UNSUPPORTED_COMPLETION_EVIDENCE " + [...failures].join(","));
  const stdout = [...lines.stdout.values()].join("\n"), stderr = [...lines.stderr.values()].join("\n");
  return { stdout, stderr, receipt,
    refusedOperation, failures: [...failures], scannedBytes, retainedBytes: Buffer.byteLength(stdout) + Buffer.byteLength(stderr), selectedLines };
}
