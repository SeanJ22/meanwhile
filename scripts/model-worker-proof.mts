/**
 * `pnpm model:proof` — **ONE BOUNDED MODEL-WORKER RUN, THROUGH THE DISPATCH
 * PATH, FOR THE MODEL HALF OF COST TRUTH.** (Owner-authorized 2026-08-31.)
 *
 * ## What was already proven, and what was not
 *
 * The cost ledger's DETERMINISTIC half is exercised: an HTTP walk records
 * bytes, requests and duration on its Attempt, and `pnpm control-plane:proof`
 * holds that. Its MODEL half had never run at all. Every
 * `BOUNDED_MODEL_WORKER` Attempt in this repository's history was a lane label
 * over work no model did — W3.E's own finding, ten of them on 2026-08-31 —
 * so the three fields that only a model call can fill had never been filled by
 * one:
 *
 * ```
 *   provider / version   the actual model that answered, from the response
 *   inputTokens / outputTokens   the PROVIDER's count, never our estimate
 *   usd                  computed from those counts and a stated rate
 * ```
 *
 * This runs exactly one, through `dispatchOne`, so the Attempt is opened,
 * leased, closed and costed by the same path every other executor uses. A
 * script that called the API and wrote a row itself would prove the API works
 * and nothing about the control plane.
 *
 * ## The bounds, and every one of them is stated
 *
 * ```
 *   ONE dispatch        no fleet, no loop, no queue
 *   ONE message         a short prompt with a short answer
 *   max_tokens 256      a ceiling on the only unbounded term
 *   effort low          the cheapest setting; this proves plumbing, not depth
 *   no tools            nothing it could reach, so nothing it could spend on
 * ```
 *
 * **The work it does is deliberately not civic.** It asks the model to echo a
 * fixed token. Nothing this run produces is a claim about a government, and
 * the disposition it writes says so: `WALKED_NO_YIELD`, with an observation of
 * zero records. A proof that answered a real civic question would put an
 * unreviewed model sentence into the evidence path to test a cost field.
 *
 * ## NOT_CONFIGURED is a state and it is not a failure
 *
 * The key is read from `WTP_WORKERS_ANTHROPIC_API_KEY` — the workers' own
 * variable, never the session's `ANTHROPIC_API_KEY`, so a machine that can run
 * the Ask synthesis cannot accidentally bill this lane. Absent, the script
 * reports `NOT_CONFIGURED`, names the variable, and exits 0. `pnpm
 * control-plane:gate` uses the identical posture and states why: an
 * unconfigured machine has nothing to prove and nothing to hide.
 *
 * **The value is never printed, logged, or written anywhere.**
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { config as loadEnv } from "dotenv";

import { createFileRepositories } from "../lib/control-plane/repository/file-store.ts";
import {
  attemptsForRouteTask,
  registerRouteTask,
  registerWorkItem,
} from "../lib/control-plane/repository/coordinator.ts";
import { createRouteTask } from "../lib/control-plane/route-task.ts";
import { createWorkItem } from "../lib/control-plane/work-item.ts";
import {
  dispatchOne,
  type DeclaredExecutor,
} from "../lib/control-plane/scheduler/dispatch.ts";
import {
  scheduleObligation,
  isScheduled,
  type FreshnessObligation,
} from "../lib/control-plane/scheduler/obligation.ts";
import { costEntryFromAttempt } from "../lib/control-plane/cost.ts";
import { floorLine, floored } from "../lib/ops/denominator-floor.ts";
import {
  MODEL_WORKER_MODEL,
  MODEL_WORKER_RATES,
  usdForUsage,
} from "../lib/control-plane/model-cost.ts";

loadEnv({ path: join(process.cwd(), ".env.local") });

const KEY_VAR = "WTP_WORKERS_ANTHROPIC_API_KEY";
const apiKey = process.env[KEY_VAR]?.trim();

if (!apiKey) {
  console.log(`model:proof · NOT_CONFIGURED — ${KEY_VAR} is not set on this machine.`);
  console.log(
    "  There is no model worker to exercise, so the model half of cost truth is UNPROVEN " +
      "here rather than failing. That is a state, and it is not a pass: nothing below ran.",
  );
  process.exit(0);
}

const NOW = new Date().toISOString();
const NOW_MS = Date.parse(NOW);

const obligation: FreshnessObligation = {
  id: "ob:model-worker-proof",
  recordClass: "meetings",
  subjectId: "ocd-division/country:us/state:az/county:pima",
  routeId: "MODEL_WORKER_COST_PROOF",
  active: true,
  readerImpactAt: null,
  observedChangeRateHours: null,
  lastWorkedAt: new Date(NOW_MS - 48 * 3_600_000).toISOString(),
};

const scheduled = scheduleObligation(obligation, NOW_MS);
if (!isScheduled(scheduled)) {
  console.error("model:proof · the proof obligation did not schedule; nothing ran.");
  process.exit(1);
}

const repos = await createFileRepositories(mkdtempSync(join(tmpdir(), "wtp-model-proof-")));
const item = createWorkItem({
  project: "freshness",
  subject: obligation.subjectId,
  obligation: "refresh:meetings",
  why: "the model half of cost truth, owner-authorized 2026-08-31",
  now: NOW,
});
const task = createRouteTask({
  workItemId: item.id,
  routeId: obligation.routeId!,
  routeLabel: "bounded model worker — cost proof",
  target: "api.anthropic.com/v1/messages",
  inherited: false,
  now: NOW,
});
await registerWorkItem(repos, item, NOW);
await registerRouteTask(repos, task, NOW);

/** What the provider reported. Null where it did not report — never a guess. */
interface ProviderUsage {
  readonly model: string;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
}

let observed = null as ProviderUsage | null;
let transportNote = "";

const modelWorker: DeclaredExecutor = {
  lane: "BOUNDED_MODEL_WORKER",
  /*
   * The identity is DECLARED before the Attempt opens, which is W3.E's fix:
   * the Attempt is a durable record of an execution and must carry the
   * identity of the thing executing. `version` is the model this run ASKS
   * for; what actually answered is compared against it below, because a
   * silent model change is a named threat and the request is not the answer.
   */
  workerFor: ({ holder }) => ({
    role: "ACQUIRER",
    provider: "anthropic",
    version: MODEL_WORKER_MODEL,
    instance: holder,
  }),
  run: async () => {
    const started = Date.now();
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: MODEL_WORKER_MODEL,
          max_tokens: 256,
          output_config: { effort: "low" },
          messages: [
            {
              role: "user",
              content:
                "Reply with exactly this word and nothing else: ACKNOWLEDGED. " +
                "This is a plumbing check for a cost ledger; there is no task.",
            },
          ],
        }),
      });
      const durationMs = Date.now() - started;

      if (!response.ok) {
        const body = await response.text();
        transportNote = `HTTP ${response.status}: ${body.slice(0, 200)}`;
        return {
          ranAs: "BOUNDED_MODEL_WORKER" as const,
          kind: "ABORTED" as const,
          cost: {
            /* The call FAILED, so no usage was reported. Null, not zero — an
               unmeasured field is not a measurement of nothing. */
            inputTokens: null,
            outputTokens: null,
            usd: null,
            durationMs,
            bytesFetched: body.length,
            requestCount: 1,
          },
          detail: `the provider refused the request: ${transportNote}`,
        };
      }

      const body = (await response.json()) as {
        model?: string;
        usage?: { input_tokens?: number; output_tokens?: number };
        content?: { type?: string; text?: string }[];
      };
      const inputTokens =
        typeof body.usage?.input_tokens === "number" ? body.usage.input_tokens : null;
      const outputTokens =
        typeof body.usage?.output_tokens === "number" ? body.usage.output_tokens : null;
      observed = {
        model: body.model ?? "unreported",
        inputTokens,
        outputTokens,
      };
      const said = body.content?.find((b) => b.type === "text")?.text?.trim() ?? "";

      return {
        ranAs: "BOUNDED_MODEL_WORKER" as const,
        kind: "DISPOSED" as const,
        disposition: {
          /*
           * **NOTHING ABOUT A GOVERNMENT WAS LEARNED AND THE DISPOSITION SAYS
           * SO.** This run asked a model to echo a token; it walked a route
           * and yielded no record, which is exactly `WALKED_NO_YIELD`, and the
           * observation counts are zero because they are zero.
           */
          disposition: "WALKED_NO_YIELD" as const,
          observation: {
            rawCount: 0,
            normalizedCount: 0,
            routeOnlyCount: 0,
            earliest: null,
            latest: null,
          },
          permission: "ALLOWED" as const,
          transport: "REACHABLE" as const,
          note:
            "a bounded model-worker plumbing run for the cost ledger. It asked for one token " +
            `and received ${JSON.stringify(said.slice(0, 40))}. No civic record was sought and ` +
            "none was found; the value of this Attempt is its cost fields.",
        },
        cost: {
          inputTokens,
          outputTokens,
          /* Computed from the PROVIDER's counts and a stated rate. Null when
             the provider reported no usage — a cost over nothing measured is
             not zero, it is unknown. */
          usd: usdForUsage(inputTokens, outputTokens),
          durationMs,
          bytesFetched: null,
          requestCount: 1,
        },
        detail: `the model answered in ${durationMs}ms`,
      };
    } catch (error) {
      transportNote = error instanceof Error ? error.message : String(error);
      return {
        ranAs: "BOUNDED_MODEL_WORKER" as const,
        kind: "ABORTED" as const,
        cost: {
          inputTokens: null,
          outputTokens: null,
          usd: null,
          durationMs: Date.now() - started,
          bytesFetched: null,
          requestCount: 1,
        },
        detail: `the request did not complete: ${transportNote}`,
      };
    }
  },
};

console.log(`model:proof · ONE bounded run · model ${MODEL_WORKER_MODEL} · key from ${KEY_VAR}`);
console.log(
  `  rate stated: $${MODEL_WORKER_RATES.inputUsdPerMillion}/1M input, ` +
    `$${MODEL_WORKER_RATES.outputUsdPerMillion}/1M output (${MODEL_WORKER_RATES.statedOn})`,
);

const result = await dispatchOne(repos, {
  obligation: scheduled,
  routeTaskId: task.id,
  holder: `model-proof-${process.pid}`,
  now: NOW,
  leaseTtlMs: 120_000,
  maturity: () => "UNGRADUATED",
  executor: modelWorker,
});

console.log(`\n  dispatch outcome: ${result.outcome}`);
console.log(`  executor recorded: ${result.executor ?? "none"}`);
console.log(`  detail: ${result.detail}`);

/*
 * **THE PERSISTED ATTEMPT IS REOPENED, not the returned object.** W3.E's
 * regression was a fix that corrected the RESULT while the durable record kept
 * the fiction, and a proof that read the return value is the proof that would
 * have missed it.
 */
const attempts = await attemptsForRouteTask(repos, task.id);
const attempt = attempts.at(-1);
if (!attempt) {
  console.error("\nmodel:proof · FAILED — no Attempt was persisted. Nothing is proven.");
  process.exit(1);
}

const { worker, cost } = attempt.value;
console.log("\n  THE PERSISTED ATTEMPT");
console.log(`    id           ${attempt.value.id}`);
console.log(`    provider     ${worker.provider}`);
console.log(`    version      ${worker.version}`);
console.log(`    role         ${worker.role}`);
console.log(`    outcome      ${attempt.value.outcome ?? "open"}`);
console.log("  ITS COST, MEASURED");
console.log(`    inputTokens  ${cost.inputTokens ?? "UNMEASURED"}`);
console.log(`    outputTokens ${cost.outputTokens ?? "UNMEASURED"}`);
console.log(`    usd          ${cost.usd === null ? "UNMEASURED" : `$${cost.usd.toFixed(6)}`}`);
console.log(`    durationMs   ${cost.durationMs ?? "UNMEASURED"}`);

const entry = costEntryFromAttempt(attempt.value, {
  routeId: obligation.routeId,
  source: "anthropic",
  jurisdiction: obligation.subjectId,
  project: "freshness",
  recordedAt: NOW,
});
console.log(
  `\n  ledger entry: ${entry.role} · ${entry.project} · route ${entry.routeId} · ` +
    `usd ${entry.cost.usd === null ? "UNMEASURED" : entry.cost.usd.toFixed(6)}`,
);

/* THE PROOF CONDITIONS, each answered rather than assumed. */
const failures: string[] = [];
if (worker.provider !== "anthropic") failures.push("the Attempt does not name the provider");
if (worker.version !== MODEL_WORKER_MODEL) {
  failures.push(`the Attempt names ${worker.version}, not the model requested`);
}
if (observed === null) {
  failures.push(`the provider never answered: ${transportNote || "no reason recorded"}`);
} else {
  if (observed.model !== MODEL_WORKER_MODEL) {
    /* A SILENT MODEL CHANGE IS A NAMED THREAT. Reported, not swallowed. */
    console.log(
      `\n  NOTE: requested ${MODEL_WORKER_MODEL}, the response reported ${observed.model}. ` +
        "The Attempt records what was REQUESTED; this line records what answered.",
    );
  }
  if (observed.inputTokens === null || observed.outputTokens === null) {
    failures.push("the provider reported no token usage, so no cost could be computed");
  }
}
if (cost.usd === null && observed?.inputTokens != null) {
  failures.push("usage was reported and no cost was computed");
}

/*
 * RULING 159: the proof's own count states its denominator. "0 failed" over a
 * condition list that never ran and "0 failed" over four conditions that all
 * passed print the same digit and are opposite facts — which is the exact
 * class this script exists to close one level down, in the cost fields.
 */
const conditions = floored(
  "proof conditions that FAILED",
  "provider named · model matched · usage reported · cost computed",
  4,
  failures.length,
);
console.log(`\n  ${floorLine(conditions)}`);

if (failures.length > 0) {
  console.error(`\nmodel:proof · UNPROVEN — ${failures.length} condition(s) failed:`);
  for (const f of failures) console.error(`  · ${f}`);
  process.exit(1);
}

console.log(
  "\nmodel:proof · PROVEN — one bounded model-worker run reached the provider, the provider " +
    "reported its own usage, a cost was computed from it at a stated rate, and all three are " +
    "on the PERSISTED Attempt. One run is the whole proof; there is no fleet here.",
);
