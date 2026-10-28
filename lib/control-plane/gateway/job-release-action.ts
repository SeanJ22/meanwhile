import { protectedJob } from "../job-transfer-breaker.ts";
import { jobLabel } from "../job-names.ts";
import type { RegisteredAction } from "./registry.ts";
import { writeFailureSays } from "./write-readback.ts";

export const JOB_RELEASE_ACTION = "jobs.release";

/** The owner's release of a job its hourly transfer breaker paused. The runner reads it on its next check, within ten minutes. */
export const jobReleaseAction: RegisteredAction = {
  definition: { type: JOB_RELEASE_ACTION, label: "Release a paused job",
    does: "Lets a job the database transfer breaker paused start again. The runner reads the release on its next check, within ten minutes.",
    doesNot: "Does not raise the 0.5 GB hourly limit; the job pauses again if it passes it.", authority: "OWNER_DECISION_REQUIRED",
    subjectKind: "a paused job", requiresStateVersion: false, refusals: ["INVALID_INPUT", "DOWNSTREAM_REFUSED"] },
  validate(input) {
    if (Object.keys(input).some(key => key !== "job")) return { ok: false, why: "the request has fields a release does not use" };
    const job = typeof input.job === "string" ? input.job.trim() : "";
    if (!job || job.length > 300 || /[\t\r\n]/.test(job)) return { ok: false, why: "choose a paused job" };
    if (protectedJob(job)) return { ok: false, why: "this job is never paused" };
    return { ok: true, value: { job } };
  },
  async execute(deps, context, input) {
    const job = String(input.job), pauses = deps.repos.jobTransferPauses;
    if (!pauses) return { ok: false, refusal: "DOWNSTREAM_REFUSED", says: "Paused jobs cannot be released from here yet." };
    let released: boolean;
    try { released = await pauses.release({ job, at: context.at, receiptId: context.receiptId, actorRef: context.request.actorRef }); }
    catch (error) { return { ok: false, refusal: "DOWNSTREAM_REFUSED", says: writeFailureSays("your release", error) }; }
    if (!released) return { ok: false, refusal: "DOWNSTREAM_REFUSED", subject: job, says: `${jobLabel(job)} is not paused.` };
    return { ok: true, outcome: "DONE", subject: job, says: `Released ${jobLabel(job)}. It starts again within ten minutes.`,
      openedWork: [], readBackAt: "/admin", undo: null };
  },
};
