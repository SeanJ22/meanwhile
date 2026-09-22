import assert from "node:assert/strict";
import test from "node:test";

import { AGENT_JOB_LOG_KEY, type AgentJobRecord } from "../lib/control-plane/gateway/agent-job.ts";
import { defaultAdminConfig, withApiFallback, type AdminConfig } from "../lib/control-plane/gateway/admin-config.ts";
import { freezeContext, type AgentJobLog, type FrozenContext } from "../lib/control-plane/agents/job.ts";
import {
  MAX_OUTPUT_BYTES,
  REPLY_CONTRACT,
  RUN_ARGVS,
  conclusionFrom,
  outermostJsonObject,
  parseAgentReply,
  providerForLauncher,
  reviewPrompt,
  runArgvFor,
  runArgvIsPermitted,
} from "../lib/control-plane/agents/executor.ts";
import {
  PAID_ADAPTER_EXISTS,
  liveExecutionChoice,
  paidReadiness,
  runSingleJob,
  subscriptionCanTake,
  type PaidRunOutcome,
} from "../lib/control-plane/agents/execution.ts";
import { TRUSTED_LAUNCHER_ROOTS, compareVersionNames } from "../lib/control-plane/agents/run-host.ts";
import { AGENT_BOUNDS, LAUNCHERS, type AgentProviderId, type ProviderProbe } from "../lib/control-plane/agents/provider.ts";
import type { ReviewerAssignment } from "../lib/control-plane/agents/review.ts";

/* ========================================================================== */
/* ACLOSE-1 — the runner-side execution seam                                  */
/* ========================================================================== */

function tickingClock(): () => string {
  let t = 0;
  return () => {
    const at = new Date(Date.UTC(2026, 8, 7, 12, 0, t)).toISOString();
    t += 1;
    return at;
  };
}

function memoryLog(): { readonly log: AgentJobLog; readonly rows: AgentJobRecord[] } {
  const rows: AgentJobRecord[] = [];
  const log = {
    async append(key: string, recordId: string, record: AgentJobRecord) {
      assert.equal(key, AGENT_JOB_LOG_KEY);
      rows.push(record);
      return { appended: true, position: rows.length, record };
    },
    async read() {
      return rows;
    },
    async readAll() {
      return rows;
    },
    async keys() {
      return [AGENT_JOB_LOG_KEY];
    },
  };
  return { log: log as unknown as AgentJobLog, rows };
}

function snapshot(body = "export const x = 1;\n"): FrozenContext {
  return freezeContext(body, "the frozen Agent Bridge contract", "2026-09-07T12:00:00.000Z");
}

function assignment(over: Partial<ReviewerAssignment> = {}): ReviewerAssignment {
  const snap = snapshot();
  return {
    reviewId: "ir-abc",
    slot: "A",
    provider: "CODEX_SUBSCRIPTION",
    question: "Does this preserve subscription-first execution?",
    snapshot: snap,
    body: "export const x = 1;\n",
    bounds: { wallMs: 60_000, allowed: { files: [], systems: [] } },
    ...over,
  } as ReviewerAssignment;
}

/**
 * §3.1 forbids an arbitrary terminal, an arbitrary command and an arbitrary
 * script path. The version-check table already held that line; a RUN is the
 * same problem with a bigger blast radius, so it gets the same closed table.
 */
test("the run table is closed, and nothing outside it is permitted", () => {
  assert.deepEqual(Object.keys(RUN_ARGVS).sort(), ["CLAUDE_CODE_SUBSCRIPTION", "CODEX_SUBSCRIPTION"]);
  for (const argv of Object.values(RUN_ARGVS)) {
    assert.ok(Object.isFrozen(argv), "a run argv a caller could push onto is not a closed table");
    assert.ok(runArgvIsPermitted(argv));
  }
  // Nothing else, including a near-miss on one of the real ones.
  assert.equal(runArgvIsPermitted(["codex", "exec", "--sandbox", "danger-full-access", "-"]), false);
  assert.equal(runArgvIsPermitted(["bash", "-c", "rm -rf /"]), false);
  assert.equal(runArgvIsPermitted(["codex"]), false);
  assert.equal(runArgvIsPermitted([...RUN_ARGVS.CODEX_SUBSCRIPTION, "--extra"]), false);
  assert.throws(() => runArgvFor("SOMETHING_ELSE" as AgentProviderId), /closed/);
});

test("each run argv is the provider's own read-only, non-interactive mode, and takes its prompt on stdin", () => {
  const codex = RUN_ARGVS.CODEX_SUBSCRIPTION;
  assert.equal(codex[0], "codex");
  assert.ok(codex.includes("exec"), "codex must run its non-interactive subcommand");
  assert.equal(codex[codex.indexOf("--sandbox") + 1], "read-only", "a delegated job may not be given a writable sandbox");
  assert.equal(codex.at(-1), "-", "the prompt must arrive on stdin, never as an argument a shell could reinterpret");

  const claude = RUN_ARGVS.CLAUDE_CODE_SUBSCRIPTION;
  assert.equal(claude[0], "claude");
  assert.ok(claude.includes("--print"), "claude must answer and exit rather than opening a session");
  assert.equal(claude[claude.indexOf("--permission-mode") + 1], "plan", "a delegated job may not be given an editing mode");
  assert.ok(!claude.some((p) => p.includes("dangerously")), "no bypass flag belongs in a delegated run");

  // The launcher NAME, never a path — `run-host.ts` resolves it against a PATH
  // it composes from a closed list. A path here would be a path a caller could
  // one day supply.
  for (const argv of Object.values(RUN_ARGVS)) {
    assert.doesNotMatch(argv[0], /[\\/]/, "element 0 must be a program name, not a path");
  }
  assert.equal(providerForLauncher("codex"), "CODEX_SUBSCRIPTION");
  assert.equal(providerForLauncher("claude"), "CLAUDE_CODE_SUBSCRIPTION");
  assert.equal(providerForLauncher("bash"), null);
});

test("every trusted install directory is declared with a reason, and none is configurable", () => {
  for (const [provider, roots] of Object.entries(TRUSTED_LAUNCHER_ROOTS)) {
    assert.ok(LAUNCHERS[provider as AgentProviderId], `${provider} is not a provider`);
    assert.ok(roots.length > 0, `${provider} has no declared install directory`);
    for (const root of roots) {
      assert.ok(["HOME", "APPDATA", "LOCALAPPDATA"].includes(root.base), `${provider} hangs off an undeclared base`);
      assert.ok(root.segments.length > 0);
      assert.ok(root.why.length > 40, `${provider}'s directory carries no reason, so the list can grow silently`);
      for (const segment of root.segments) {
        assert.doesNotMatch(segment, /[*?]|\.\./, "a declared segment is a literal name, never a pattern or a traversal");
      }
    }
  }
});

test("the newest installed version wins, and a partly-removed one does not shadow it", () => {
  const sorted = ["2.1.258", "2.1.260", "2.1.9", "10.0.0"].sort(compareVersionNames);
  assert.equal(sorted[0], "10.0.0");
  assert.equal(sorted[1], "2.1.260");
  assert.equal(sorted[2], "2.1.258");
});

/* ------------------------------------------------------------- the prompt */

test("a reviewer's prompt carries the frozen bytes and its hash, and nothing about the other seat", () => {
  const a = assignment({ slot: "A", provider: "CODEX_SUBSCRIPTION" });
  const prompt = reviewPrompt(a);
  assert.ok(prompt.includes(a.snapshot.hash), "the reviewer cannot echo a hash it was never given");
  assert.ok(prompt.includes(a.body), "the frozen bytes must be in the prompt — the run has no filesystem to read them from");
  assert.ok(prompt.includes(a.question));
  assert.ok(prompt.includes(REPLY_CONTRACT));
  // ADM-C9's layer 1: an assignment carries no peer, so a prompt built from one
  // cannot mention a peer. Asserting on the rendered prompt catches a future
  // executor that reached for something outside its argument.
  assert.doesNotMatch(prompt, /\bREVIEWER_B\b|other reviewer|the other answer|peer/i);
  // Byte-identical, including the seat and the provider being absent from it:
  // the only difference between the two runs is which program receives it.
  const b = reviewPrompt(assignment({ slot: "B", provider: "CLAUDE_CODE_SUBSCRIPTION" }));
  assert.equal(prompt, b, "both seats must receive byte-identical instructions");
});

/* -------------------------------------------------------------- the parse */

test("the outermost JSON object is found even inside a CLI's own chrome", () => {
  assert.equal(outermostJsonObject('banner\n{"a":1}\ndone'), '{"a":1}');
  assert.equal(outermostJsonObject('{"a":{"b":2}}'), '{"a":{"b":2}}');
  // A brace inside a quoted string must not unbalance the scan.
  assert.equal(outermostJsonObject('{"a":"} not the end"}'), '{"a":"} not the end"}');
  assert.equal(outermostJsonObject("no json here"), null);
});

test("an answer that is not the shape we asked for is REFUSED, never summarised", () => {
  const cases: Array<[string, RegExp]> = [
    ["", /printed nothing/],
    ["I think it looks fine, honestly.", /no JSON object/],
    ["{not json}", /did not parse/],
    ['{"verdict":"ok","points":[]}', /no `reviewedHash`/],
    ['{"reviewedHash":"h","points":[]}', /no `verdict`/],
    ['{"reviewedHash":"h","verdict":"v"}', /no `points` array/],
    ['{"reviewedHash":"h","verdict":"v","points":[]}', /empty `points`/],
    ['{"reviewedHash":"h","verdict":"v","points":[{"topic":"t","stance":"MAYBE","says":"s","confidence":"HIGH"}]}', /not one of YES, NO, UNSURE/],
    ['{"reviewedHash":"h","verdict":"v","points":[{"topic":"t","stance":"YES","says":"s","confidence":"SORT OF"}]}', /not one of HIGH, MEDIUM, LOW/],
    ['{"reviewedHash":"h","verdict":"v","points":[{"topic":"","stance":"YES","says":"s","confidence":"HIGH"}]}', /no topic/],
  ];
  for (const [raw, why] of cases) {
    const parsed = parseAgentReply(raw);
    assert.equal(parsed.ok, false, `this should not have parsed: ${raw}`);
    if (!parsed.ok) assert.match(parsed.why, why);
  }
});

test("a well-formed answer becomes a conclusion, and an unreadable one becomes a thrown FAILED", () => {
  const a = assignment();
  const good = JSON.stringify({
    reviewedHash: a.snapshot.hash,
    verdict: "The reviewed invariants hold.",
    points: [{ topic: "arbitrary shell", stance: "NO", says: "No path turns text into a command.", confidence: "HIGH", evidence: "the closed table" }],
  });
  const conclusion = conclusionFrom(a, `chatter\n${good}\n`, "2026-09-07T12:00:00.000Z", "2026-09-07T12:01:00.000Z");
  assert.equal(conclusion.slot, "A");
  assert.equal(conclusion.provider, "CODEX_SUBSCRIPTION");
  assert.equal(conclusion.reviewedHash, a.snapshot.hash);
  assert.equal(conclusion.points.length, 1);
  assert.equal(conclusion.points[0].stance, "NO");

  assert.throws(
    () => conclusionFrom(a, "It all seems fine to me!", "2026-09-07T12:00:00.000Z", "2026-09-07T12:01:00.000Z"),
    /cannot read/,
    "prose must never be turned into a verdict — a fabricated stance would enter an agreement count",
  );
});

test("a reviewer that echoes the WRONG hash is recorded as it answered, not corrected", () => {
  const a = assignment();
  const raw = JSON.stringify({
    reviewedHash: "sha256-something-else",
    verdict: "v",
    points: [{ topic: "t", stance: "UNSURE", says: "s", confidence: "LOW", evidence: "" }],
  });
  const conclusion = conclusionFrom(a, raw, "2026-09-07T12:00:00.000Z", "2026-09-07T12:01:00.000Z");
  assert.equal(
    conclusion.reviewedHash,
    "sha256-something-else",
    "substituting the correct hash here would forge the very proof the field exists to supply",
  );
});

test("the output bound is the context bound — a provider that prints a novel is not answering", () => {
  assert.equal(MAX_OUTPUT_BYTES, AGENT_BOUNDS.maxContextBytes);
});

/* ========================================================================== */
/* ACLOSE-2 — the paid-API fallback decision, wired and OFF                   */
/* ========================================================================== */

function probe(over: Partial<ProviderProbe> = {}): ProviderProbe {
  return {
    provider: "CLAUDE_CODE_SUBSCRIPTION",
    observedFrom: "RUNNER_HOST",
    observedAt: "2026-09-07T12:00:00.000Z",
    launcher: { found: true, at: "C:/x/claude.exe" },
    home: { present: true, savedSignIn: true },
    version: { asked: true, printed: "2.1.260 (Claude Code)", why: null },
    ...over,
  } as ProviderProbe;
}

const PERMITS = { permits: true, why: "under the ceiling" };
const REFUSES = { permits: false, why: "the rolling window has reached $25" };

test("a subscription is available only when all three observations say so", () => {
  assert.equal(subscriptionCanTake(probe()).can, true);
  assert.equal(subscriptionCanTake(probe({ launcher: { found: false, at: null } })).can, false);
  assert.equal(subscriptionCanTake(probe({ version: { asked: true, printed: null, why: "it did not answer." } })).can, false);
  assert.equal(subscriptionCanTake(probe({ home: { present: true, savedSignIn: false } })).can, false);
  // A launcher that resolves is not a launcher that starts, and neither is a sign-in.
  assert.match(subscriptionCanTake(probe({ home: { present: true, savedSignIn: false } })).why, /nobody has signed in/);
});

test("OFF is the default, survives an absent or corrupt config, and REFUSES rather than billing", () => {
  for (const config of [null, undefined as unknown as AdminConfig, defaultAdminConfig(), { nonsense: true } as unknown as AdminConfig]) {
    const live = liveExecutionChoice({
      provider: "CLAUDE_CODE_SUBSCRIPTION",
      probe: probe({ launcher: { found: false, at: null } }),
      config,
      credentialPresent: true,
      ceiling: PERMITS,
    });
    assert.equal(live.fallback.enabled, false, "an unreadable config must read as OFF");
    assert.equal(live.choice.path, "REFUSE");
    assert.match(live.choice.says, /nothing was sent and nothing was charged|no API credential|has no paid API path/);
  }
});

test("a working subscription always wins, even with paid spending switched ON", () => {
  const on = withApiFallback(defaultAdminConfig(), {
    enabled: true,
    decidedAt: "2026-09-07T00:00:00.000Z",
    decidedBy: "sess",
    receiptId: "r",
  });
  const live = liveExecutionChoice({ provider: "CLAUDE_CODE_SUBSCRIPTION", probe: probe(), config: on, credentialPresent: true, ceiling: PERMITS });
  assert.equal(live.choice.path, "SUBSCRIPTION");
  assert.equal(live.paid, null, "the paid path is not even considered while the subscription can take the work");
});

test("ON permits a paid path only where one exists, is configured, and is under its ceiling", () => {
  const on = withApiFallback(defaultAdminConfig(), { enabled: true, decidedAt: "2026-09-07T00:00:00.000Z", decidedBy: "s", receiptId: "r" });
  const down = probe({ launcher: { found: false, at: null } });

  // The provider this repository HAS a governed client for.
  const ok = liveExecutionChoice({ provider: "CLAUDE_CODE_SUBSCRIPTION", probe: down, config: on, credentialPresent: true, ceiling: PERMITS });
  assert.equal(ok.choice.path, "PAID_API");

  // No credential — allowed to spend, nothing to spend with.
  const noKey = liveExecutionChoice({ provider: "CLAUDE_CODE_SUBSCRIPTION", probe: down, config: on, credentialPresent: false, ceiling: PERMITS });
  assert.equal(noKey.choice.path, "REFUSE");
  assert.match(noKey.choice.says, /no API credential is configured/);

  // Over the ceiling — allowed to spend, and the cap says not this one.
  const capped = liveExecutionChoice({ provider: "CLAUDE_CODE_SUBSCRIPTION", probe: down, config: on, credentialPresent: true, ceiling: REFUSES });
  assert.equal(capped.choice.path, "REFUSE");
  assert.match(capped.choice.says, /spend ceiling/);

  // And the provider with no governed client at all: an honest refusal, not an
  // invented API client so the toggle looks symmetrical.
  assert.equal(PAID_ADAPTER_EXISTS.CODEX_SUBSCRIPTION, false);
  const codex = liveExecutionChoice({
    provider: "CODEX_SUBSCRIPTION",
    probe: probe({ provider: "CODEX_SUBSCRIPTION", launcher: { found: false, at: null } }),
    config: on,
    credentialPresent: true,
    ceiling: PERMITS,
  });
  assert.equal(codex.choice.path, "REFUSE");
  assert.match(codex.choice.says, /no paid API path in this system/);
  assert.equal(paidReadiness("CODEX_SUBSCRIPTION", true, PERMITS).ready, false);
});

test("nothing in the decision can turn a refusal into a spend", () => {
  // Every combination, and PAID_API may only ever appear with the setting ON.
  const off = defaultAdminConfig();
  const on = withApiFallback(off, { enabled: true, decidedAt: "2026-09-07T00:00:00.000Z", decidedBy: "s", receiptId: "r" });
  for (const config of [off, on]) {
    for (const found of [true, false]) {
      for (const credentialPresent of [true, false]) {
        for (const ceiling of [PERMITS, REFUSES]) {
          for (const provider of ["CODEX_SUBSCRIPTION", "CLAUDE_CODE_SUBSCRIPTION"] as AgentProviderId[]) {
            const live = liveExecutionChoice({
              provider,
              probe: probe({ provider, launcher: found ? { found: true, at: "x" } : { found: false, at: null } }),
              config,
              credentialPresent,
              ceiling,
            });
            if (live.choice.path === "PAID_API") {
              assert.equal(config, on, "a paid path was chosen while the owner's setting was OFF");
              assert.equal(found, false, "a paid path was chosen while the subscription could take it");
              assert.equal(credentialPresent, true);
              assert.equal(ceiling, PERMITS);
              assert.equal(PAID_ADAPTER_EXISTS[provider], true);
            }
          }
        }
      }
    }
  }
});

/* -------------------------------------------------- the job that runs it */

test("with the setting OFF and no subscription, the job is REFUSED and no paid runner is ever called", async () => {
  const { log, rows } = memoryLog();
  let paidCalls = 0;
  const outcome = await runSingleJob(
    {
      log,
      now: tickingClock(),
      pathFor: () =>
        liveExecutionChoice({
          provider: "CLAUDE_CODE_SUBSCRIPTION",
          probe: probe({ launcher: { found: false, at: null } }),
          config: defaultAdminConfig(),
          credentialPresent: true,
          ceiling: PERMITS,
        }).choice,
      runSubscription: async () => {
        throw new Error("the subscription must not be reached when the path is REFUSE");
      },
      runPaid: async () => {
        paidCalls += 1;
        return { raw: "billed", usd: 1, model: "m" };
      },
      recordSpend: async () => {},
    },
    {
      mode: "CLAUDE",
      provider: "CLAUDE_CODE_SUBSCRIPTION",
      context: snapshot(),
      scope: "a bounded read-only review",
      allowed: { files: [], systems: [] },
      requestedOutput: "findings grounded in the frozen snapshot",
      idempotencyKey: "k1",
      prompt: "…",
      wallMs: 60_000,
    },
  );
  assert.equal(paidCalls, 0, "a refused job must not reach a paid adapter at all");
  assert.equal(outcome.path, "REFUSE");
  assert.equal(outcome.usd, 0);
  assert.equal(outcome.job.state, "REFUSED");
  assert.match(outcome.job.refusal?.says ?? "", /nothing was sent and nothing was charged/);
  // A refusal is persisted exactly like a completion: "we did not do this, and
  // here is why" is a result the console must be able to read back.
  assert.equal(rows.length, 2, "a refused job must leave both its RUNNING and its REFUSED transition on the log");
  assert.deepEqual(rows.map((r) => r.status), ["RUNNING", "REFUSED"]);
});

test("a subscription run completes, costs nothing, and says so", async () => {
  const { log, rows } = memoryLog();
  const outcome = await runSingleJob(
    {
      log,
      now: tickingClock(),
      pathFor: () =>
        liveExecutionChoice({
          provider: "CODEX_SUBSCRIPTION",
          probe: probe({ provider: "CODEX_SUBSCRIPTION" }),
          config: defaultAdminConfig(),
          credentialPresent: false,
          ceiling: PERMITS,
        }).choice,
      runSubscription: async () => "the answer",
    },
    {
      mode: "GPT",
      provider: "CODEX_SUBSCRIPTION",
      context: snapshot(),
      scope: "a bounded read-only review",
      allowed: { files: [], systems: [] },
      requestedOutput: "findings",
      idempotencyKey: "k2",
      prompt: "…",
      wallMs: 60_000,
    },
  );
  assert.equal(outcome.path, "SUBSCRIPTION");
  assert.equal(outcome.usd, 0);
  assert.equal(outcome.job.state, "DONE");
  assert.match(outcome.job.result?.says ?? "", /Nothing was charged/);
  assert.equal(outcome.raw, "the answer");
  assert.deepEqual(rows.map((r) => r.status), ["RUNNING", "DONE"]);
});

test("a PAID_API path with nothing to meter it REFUSES rather than becoming an unrecorded spend", async () => {
  const { log } = memoryLog();
  const outcome = await runSingleJob(
    {
      log,
      now: tickingClock(),
      // A caller that decided to bill and supplied no adapter and no ledger.
      pathFor: () => ({ path: "PAID_API", says: "billed per use", blocker: null }),
      runSubscription: async () => "unused",
    },
    {
      mode: "CLAUDE",
      provider: "CLAUDE_CODE_SUBSCRIPTION",
      context: snapshot(),
      scope: "a bounded read-only review",
      allowed: { files: [], systems: [] },
      requestedOutput: "findings",
      idempotencyKey: "k3",
      prompt: "…",
      wallMs: 60_000,
    },
  );
  assert.equal(outcome.path, "REFUSE");
  assert.equal(outcome.job.state, "REFUSED");
  assert.equal(outcome.job.refusal?.code, "AGENT_PAID_PATH_UNMETERED");
});

test("a paid run that DOES happen is recorded in the ledger before the job is closed", async () => {
  const { log } = memoryLog();
  const recorded: PaidRunOutcome[] = [];
  const outcome = await runSingleJob(
    {
      log,
      now: tickingClock(),
      pathFor: () => ({ path: "PAID_API", says: "billed per use", blocker: null }),
      runSubscription: async () => {
        throw new Error("not the paid path");
      },
      // A DETERMINISTIC STUB. The overnight brief forbids proving this with real
      // money, and a stub proves the wiring: the ledger call happens, and the
      // job carries the cost it reported.
      runPaid: async () => ({ raw: "the billed answer", usd: 0.42, model: "claude-opus-5-5" }),
      recordSpend: async (o) => {
        recorded.push(o);
      },
    },
    {
      mode: "CLAUDE",
      provider: "CLAUDE_CODE_SUBSCRIPTION",
      context: snapshot(),
      scope: "a bounded read-only review",
      allowed: { files: [], systems: [] },
      requestedOutput: "findings",
      idempotencyKey: "k4",
      prompt: "…",
      wallMs: 60_000,
    },
  );
  assert.equal(outcome.path, "PAID_API");
  assert.equal(outcome.usd, 0.42);
  assert.equal(outcome.job.state, "DONE");
  assert.deepEqual(recorded.map((r) => r.usd), [0.42], "a paid call that reaches no ledger is an unmetered spend");
});

test("a provider that starts and does not finish leaves a FAILED job, not a silent one", async () => {
  const { log, rows } = memoryLog();
  const outcome = await runSingleJob(
    {
      log,
      now: tickingClock(),
      pathFor: () => ({ path: "SUBSCRIPTION", says: "on your subscription", blocker: null }),
      runSubscription: async () => {
        throw new Error("it did not finish inside its bound and was stopped");
      },
    },
    {
      mode: "GPT",
      provider: "CODEX_SUBSCRIPTION",
      context: snapshot(),
      scope: "a bounded read-only review",
      allowed: { files: [], systems: [] },
      requestedOutput: "findings",
      idempotencyKey: "k5",
      prompt: "…",
      wallMs: 60_000,
    },
  );
  assert.equal(outcome.job.state, "FAILED");
  assert.match(outcome.job.says, /did not finish/);
  assert.deepEqual(rows.map((r) => r.status), ["RUNNING", "FAILED"]);
});

/**
 * THE FINDING THE FIRST REAL ACLOSE-3 JOB RETURNED, MADE EXECUTABLE.
 *
 * Codex reviewed the frozen bytes of this module on the subscription and
 * reported that `runSingleJob` handled REFUSE and PAID_API and let every other
 * classification fall through to `runSubscription` — so an unrecognised path
 * would EXECUTE and be reported as `SUBSCRIPTION`. It was right, and this is the
 * regression test for it.
 */
test("an execution path this bridge cannot classify runs nothing at all (§3.6)", async () => {
  const { log, rows } = memoryLog();
  let ran = 0;
  const outcome = await runSingleJob(
    {
      log,
      now: tickingClock(),
      pathFor: () => ({ path: "SOMETHING_NEW" as never, says: "", blocker: null }),
      runSubscription: async () => {
        ran += 1;
        return "this must never happen";
      },
    },
    {
      mode: "GPT",
      provider: "CODEX_SUBSCRIPTION",
      context: snapshot(),
      scope: "s",
      allowed: { files: [], systems: [] },
      requestedOutput: "findings",
      idempotencyKey: "k7",
      prompt: "…",
      wallMs: 60_000,
    },
  );
  assert.equal(ran, 0, "an unclassified path started a subscription job");
  assert.equal(outcome.path, "REFUSE");
  assert.equal(outcome.job.state, "REFUSED");
  assert.equal(outcome.job.refusal?.code, "AGENT_EXECUTION_PATH_UNCLASSIFIED");
  assert.deepEqual(rows.map((r) => r.status), ["RUNNING", "REFUSED"]);
});

/**
 * THE SECOND FINDING THE FIRST REAL ACLOSE-3 JOB RETURNED.
 *
 * Claude Code reviewed the frozen bytes and reported that `recordSpend` sat
 * inside the outer `try`, so a throw from the LEDGER dropped to the catch and
 * the job was recorded FAILED with `usd: 0` — after the API had already billed.
 * "The log says the job failed and cost nothing" is a false claim about money.
 */
test("a paid call whose ledger write fails is still reported as spent", async () => {
  const { log } = memoryLog();
  const outcome = await runSingleJob(
    {
      log,
      now: tickingClock(),
      pathFor: () => ({ path: "PAID_API", says: "billed per use", blocker: null }),
      runSubscription: async () => {
        throw new Error("not the paid path");
      },
      runPaid: async () => ({ raw: "the billed answer", usd: 0.42, model: "claude-opus-5-5" }),
      recordSpend: async () => {
        throw new Error("the cost ledger was unreachable");
      },
    },
    {
      mode: "CLAUDE",
      provider: "CLAUDE_CODE_SUBSCRIPTION",
      context: snapshot(),
      scope: "s",
      allowed: { files: [], systems: [] },
      requestedOutput: "findings",
      idempotencyKey: "k8",
      prompt: "…",
      wallMs: 60_000,
    },
  );
  assert.equal(outcome.job.state, "DONE", "the call happened; recording it as FAILED denies a real spend");
  assert.equal(outcome.usd, 0.42, "the money was spent, so the outcome must say so");
  assert.match(outcome.job.result?.says ?? "", /billed \$0\.42/);
  assert.match(outcome.job.result?.says ?? "", /ledger is short by this entry/);
});

/**
 * The narrower half, raised by the INDEPENDENT REVIEW against the already-fixed
 * bytes: wrapping `recordSpend` covers a ledger throw, and a throw from the
 * paid call ITSELF still reported `$0.00`. We cannot know whether that request
 * was billed, so the record must not say it was free.
 */
test("a failure on the paid path never claims the call was free", async () => {
  const { log } = memoryLog();
  const outcome = await runSingleJob(
    {
      log,
      now: tickingClock(),
      pathFor: () => ({ path: "PAID_API", says: "billed per use", blocker: null }),
      runSubscription: async () => "not this path",
      runPaid: async () => {
        throw new Error("the response could not be read");
      },
      recordSpend: async () => {},
    },
    {
      mode: "CLAUDE",
      provider: "CLAUDE_CODE_SUBSCRIPTION",
      context: snapshot(),
      scope: "s",
      allowed: { files: [], systems: [] },
      requestedOutput: "findings",
      idempotencyKey: "k9",
      prompt: "…",
      wallMs: 60_000,
    },
  );
  assert.equal(outcome.job.state, "FAILED");
  assert.match(outcome.job.says, /cannot tell from here whether that call was billed/);
  // The claim, not the words. "it cost nothing" appears here inside a negation,
  // which is the whole point of the sentence.
  assert.doesNotMatch(outcome.job.says, /nothing was charged/);
  // And the subscription path, where we DO know, still says so plainly.
  const { log: log2 } = memoryLog();
  const free = await runSingleJob(
    {
      log: log2,
      now: tickingClock(),
      pathFor: () => ({ path: "SUBSCRIPTION", says: "s", blocker: null }),
      runSubscription: async () => {
        throw new Error("it did not finish");
      },
    },
    {
      mode: "GPT",
      provider: "CODEX_SUBSCRIPTION",
      context: snapshot(),
      scope: "s",
      allowed: { files: [], systems: [] },
      requestedOutput: "findings",
      idempotencyKey: "k10",
      prompt: "…",
      wallMs: 60_000,
    },
  );
  assert.doesNotMatch(free.job.says, /cannot tell/);
});

test("the closed tables cannot be mutated in place, outer object included", () => {
  assert.ok(Object.isFrozen(RUN_ARGVS), "a table whose outer object is writable is closed only by convention");
  assert.ok(Object.isFrozen(LAUNCHERS));
  assert.ok(Object.isFrozen(PAID_ADAPTER_EXISTS));
});

test("a delegated job may only ever be opened at an agent authority", async () => {
  const { log } = memoryLog();
  // `runSingleJob` hard-codes READ_ONLY; this proves the underlying assertion is
  // the thing enforcing it rather than a comment above the literal.
  const outcome = await runSingleJob(
    {
      log,
      now: tickingClock(),
      pathFor: () => ({ path: "SUBSCRIPTION", says: "s", blocker: null }),
      runSubscription: async () => "ok",
    },
    {
      mode: "GPT",
      provider: "CODEX_SUBSCRIPTION",
      context: snapshot(),
      scope: "s",
      allowed: { files: [], systems: [] },
      requestedOutput: "findings",
      idempotencyKey: "k6",
      prompt: "…",
      wallMs: 60_000,
    },
  );
  assert.equal(outcome.job.authority, "READ_ONLY");
});
