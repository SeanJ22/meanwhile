import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBoundedChildPass, ROUTINE_CHILD_CONCURRENCY, type BoundedChildCommand, type BoundedChildLauncher, type BoundedChildPassOptions, type BoundedChildResult } from "./bounded-child-pass.ts";

export interface MeetingBatchMember {
  readonly id: string;
  readonly dueAt: string;
  readonly nextDueAt: string;
}
export interface MeetingBatchOptions extends Pick<BoundedChildPassOptions, "cwd" | "env" | "concurrency" | "onStarting"> {
  readonly onMemberStarted: (id: string) => Promise<void> | void;
  readonly onSettled: (member: MeetingBatchMember, result: BoundedChildResult) => Promise<void> | void;
  readonly onWorkerSettled: (id: string) => Promise<void> | void;
}

export function meetingBatchGroups<T>(members: readonly T[], concurrency = ROUTINE_CHILD_CONCURRENCY): T[][] {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new Error("MEETING_BATCH_CONCURRENCY_INVALID");
  const groups = Array.from({ length: Math.min(concurrency, members.length) }, () => [] as T[]);
  members.forEach((member, index) => groups[index % groups.length]!.push(member));
  return groups;
}

export async function runMeetingBatchPass(
  members: readonly MeetingBatchMember[], options: MeetingBatchOptions, launch?: BoundedChildLauncher,
): Promise<readonly BoundedChildResult[]> {
  if (!members.length) return [];
  if (new Set(members.map(member => member.id)).size !== members.length) throw new Error("MEETING_BATCH_DUPLICATE_MEMBER");
  const groups = meetingBatchGroups(members, options.concurrency);
  const directory = await mkdtemp(join(tmpdir(), "meanwhile-meeting-batch-"));
  const results = new Map<string, BoundedChildResult>();
  const started = new Set<string>();
  const settle = async (member: MeetingBatchMember, result: BoundedChildResult) => {
    if (results.has(member.id)) throw new Error(`MEETING_BATCH_DUPLICATE_RESULT:${member.id}`);
    try {
      await options.onSettled(member, result);
      results.set(member.id, { ...result, stdout: "", stderr: "", settlementErrorMessage: null });
    } catch (error) {
      results.set(member.id, { ...result, stdout: "", stderr: "", settlementErrorMessage: error instanceof Error ? error.message : String(error) });
    }
  };
  try {
    const commands: BoundedChildCommand[] = [];
    for (const [index, group] of groups.entries()) {
      const file = join(directory, `${index}.json`);
      await writeFile(file, JSON.stringify(group), { mode: 0o600 });
      const memberById = new Map(group.map(member => [member.id, member]));
      commands.push({
        id: `meeting-batch:${options.env.WTP_SOURCE_STATE ?? "US"}:${index}`, executable: process.execPath,
        args: ["--experimental-strip-types", "scripts/ingest.ts", `--meeting-tasks-file=${file}`], env: options.env,
        onStdoutLine: async line => {
          const match = /^RCD_MEETING_PARTITION_(STARTED|RECEIPT|ERROR)=(.*)$/.exec(line);
          if (!match) return;
          const record = JSON.parse(match[2]!) as { id?: string; source?: string; detail?: string };
          const id = match[1] === "RECEIPT" ? record.source : record.id;
          const member = id === undefined ? undefined : memberById.get(id);
          if (!member) throw new Error(`MEETING_BATCH_UNEXPECTED_MEMBER:${id}`);
          if (match[1] === "STARTED") {
            if (started.has(member.id)) throw new Error(`MEETING_BATCH_DUPLICATE_START:${member.id}`);
            started.add(member.id); await options.onMemberStarted(member.id); return;
          }
          if (!started.has(member.id)) throw new Error(`MEETING_BATCH_RESULT_BEFORE_START:${member.id}`);
          await settle(member, {
            id: member.id, status: match[1] === "RECEIPT" ? 0 : 1, signal: null,
            stdout: match[1] === "RECEIPT" ? line : "", stderr: "", termination: "EXITED",
            errorMessage: match[1] === "ERROR" ? record.detail ?? "Meeting member failed" : null,
          });
        },
      });
    }
    await runBoundedChildPass(commands, {
      ...options, discardOutputAfterSettlement: true,
      onSettled: async (result, index) => {
        try {
          for (const member of groups[index]!) {
            if (results.has(member.id)) continue;
            await settle(member, started.has(member.id) ? { ...result, id: member.id } : {
              id: member.id, status: null, signal: null, stdout: "", stderr: "", termination: "SPAWN_FAILED",
              errorMessage: `PASS_TIME_BUDGET: meeting worker ended before this member started (${result.errorMessage ?? result.termination})`,
            });
          }
        } finally { await options.onWorkerSettled(result.id); }
      },
    }, launch);
    return members.map(member => results.get(member.id)!);
  } finally { await rm(directory, { recursive: true, force: true }); }
}
