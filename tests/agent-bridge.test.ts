/**
 * **THE AGENT BRIDGE'S SEEDED FAILURES.** (ADM-C8 and ADM-C9, Admin C,
 * 2026-09-06.)
 *
 * Three claims this suite exists to stop the console from making:
 *
 *   1. that a provider is healthy when nothing measured it;
 *   2. that paid API spending is off when a restart or a truthy-looking value
 *      could turn it on;
 *   3. that two answers are an INDEPENDENT review when nothing structurally
 *      stopped one reviewer from reading the other's.
 *
 * Every guard here carries a POSITIVE CONTROL — a deliberately defective input
 * the instrument must reject — because a checker that passes on correct code
 * and would also pass on the defect is not a checker.
 *
 * The isolation guards are the important ones. They do not read the comments in
 * `review.ts`; they run the real `runIndependentReview` with a reviewer that
 * actively hunts for the other reviewer's conclusion through every string
 * reachable from its own brief, and they assert it finds nothing — with a
 * positive control that plants the conclusion in the brief and requires the
 * same walk to find it.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENT_MODES,
  MODE_WORDS,
  agentJobId,
  completeJob,
  failJob,
  fromAgentJobRecord,
  freezeContext,
  inFlightFor,
  jobRecordId,
  latestFor,
  openJob,
  persistJob,
  refuseJob,
  toAgentJobRecord,
  type AgentJobLog,
  type DelegatedAgentJob,
} from "@/lib/control-plane/agents/job.ts";
import {
  AGENT_BOUNDS,
  AGENT_PROVIDERS,
  API_FALLBACK_DEFAULT_ENABLED,
  AUTHENTICATION_READINGS,
  LAUNCHERS,
  PROVIDER_WORDS,
  apiFallbackPolicy,
  chooseExecutionPath,
  describeProvider,
  isAgentProvider,
  probeProvider,
  unobservedFromWeb,
  type ProbeHost,
  type ProviderProbe,
} from "@/lib/control-plane/agents/provider.ts";
import {
  compareConclusions,
  openBoth,
  proveIsolation,
  runAskBoth,
  runIndependentReview,
  seal,
  type ReviewDeps,
  type ReviewInput,
  type ReviewerAssignment,
  type ReviewerConclusion,
  type ReviewerExecutor,
} from "@/lib/control-plane/agents/review.ts";
import {
  buildAgentBridgeView,
  groupReviews,
  parseComparisonDetail,
  reviewDecisionSubject,
  shortHash,
  type AgentBridgeInput,
} from "@/lib/control-plane/agents/view.ts";
import {
  AGENT_JOB_LOG_KEY,
  latestByJob,
  type AgentJobRecord,
} from "@/lib/control-plane/gateway/agent-job.ts";
import { defaultAdminConfig, withApiFallback } from "@/lib/control-plane/gateway/admin-config.ts";
import { gap, held } from "@/lib/control-plane/owner-surface.ts";

import { codeOf } from "./read-code.ts";

/* ------------------------------------------------------------- fixtures */

/**
 * The modules that decide policy. None of them may read the environment, because
 * an environment read is precisely what would come back differently after a
 * deploy or a restart — the thing §4 forbids for the paid-API switch.
 */
const POLICY_FILES = [
  "lib/control-plane/agents/provider.ts",
  "lib/control-plane/agents/job.ts",
  "lib/control-plane/agents/review.ts",
  "lib/control-plane/agents/view.ts",
  "lib/control-plane/agents/read.ts",
];
/** The host adapter, which is the one file allowed to touch a machine. */
const HOST_FILE = "lib/control-plane/agents/host.ts";
const PAGE = "app/(admin)/admin/agents/page.tsx";
/** Everything the bridge is, for the sweeps that are about the whole of it. */
const BRIDGE_FILES = [...POLICY_FILES, HOST_FILE, PAGE];

/** A clock that advances one second per call, so orderings are checkable. */
function tickingClock(): () => string {
  let t = 0;
  return () => {
    const at = new Date(Date.UTC(2026, 8, 6, 12, 0, t)).toISOString();
    t += 1;
    return at;
  };
}

/**
 * An in-memory stand-in for the control plane's `agentJobs` log.
 *
 * It enforces the one rule a real append-only store enforces and an array does
 * not: a record id that arrives twice carrying DIFFERENT bytes is an
 * `AppendOnlyViolation`. Without that, a bridge that reused one id per job
 * would pass every test here and throw on the first real close.
 */
function memoryLog(): { readonly log: AgentJobLog; readonly rows: AgentJobRecord[]; readonly order: string[] } {
  const rows: AgentJobRecord[] = [];
  const order: string[] = [];
  const byId = new Map<string, string>();
  const log = {
    async append(key: string, recordId: string, record: AgentJobRecord) {
      assert.equal(key, AGENT_JOB_LOG_KEY, "every delegated job lands under the one agent-job key");
      assert.ok(recordId.startsWith(`${record.jobId}:`), "a transition row is named by its job and then by the transition");
      const canonical = JSON.stringify(record);
      const already = byId.get(recordId);
      assert.ok(
        already === undefined || already === canonical,
        `an append-only store would refuse a differing record under the id ${recordId}`,
      );
      byId.set(recordId, canonical);
      order.push(`${(record.extra as { role?: string }).role}:${record.status}`);
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
  return { log: log as unknown as AgentJobLog, rows, order };
}

/** The stored records read back as the bridge's jobs, the way the page reads them. */
function jobsOf(rows: readonly AgentJobRecord[]): DelegatedAgentJob[] {
  const out: DelegatedAgentJob[] = [];
  for (const row of rows) {
    const job = fromAgentJobRecord(row);
    assert.ok(job !== null, `the bridge can read back the record it wrote for ${row.jobId}`);
    out.push(job);
  }
  return out;
}

/** A host where a provider is fully present. */
function healthyHost(now: string): ProbeHost {
  return {
    resolve: (launcher) => `/usr/local/bin/${launcher}`,
    exists: () => true,
    askVersion: () => ({ ok: true, printed: "1.2.3", why: null }),
    homeDir: "/home/owner",
    now,
  };
}

function probeOf(overrides: Partial<ProviderProbe>): ProviderProbe {
  return {
    provider: "CODEX_SUBSCRIPTION",
    observedFrom: "RUNNER_HOST",
    observedAt: "2026-09-06T12:00:00.000Z",
    launcher: { found: true, at: "/usr/local/bin/codex" },
    home: { present: true, savedSignIn: true },
    version: { asked: true, printed: "1.2.3", why: null },
    ...overrides,
  };
}

const OFF = apiFallbackPolicy(null);

/**
 * The one config that opens the paid path, built through the gateway module’s own
 * writer so this suite cannot drift from the shape the action actually stores.
 */
const ALLOWED = withApiFallback(defaultAdminConfig("2026-09-06T10:00:00.000Z"), {
  enabled: true,
  decidedAt: "2026-09-06T11:00:00.000Z",
  decidedBy: "adm_session_ref",
  receiptId: "config.setApiFallback:k",
});

/** Every string reachable from a value, so a walk can prove what is NOT there. */
function reachableStrings(value: unknown, seen = new Set<unknown>()): string[] {
  if (typeof value === "string") return [value];
  if (value === null || typeof value !== "object") return [];
  if (seen.has(value)) return [];
  seen.add(value);
  const out: string[] = [];
  for (const inner of Object.values(value as Record<string, unknown>)) out.push(...reachableStrings(inner, seen));
  return out;
}

/** Every function-valued property reachable from a value. A brief with one is a channel. */
function reachableFunctions(value: unknown, seen = new Set<unknown>()): number {
  if (typeof value === "function") return 1;
  if (value === null || typeof value !== "object") return 0;
  if (seen.has(value)) return 0;
  seen.add(value);
  let count = 0;
  for (const inner of Object.values(value as Record<string, unknown>)) count += reachableFunctions(inner, seen);
  return count;
}

function conclusionOf(slot: "A" | "B", hash: string, verdict: string, stance: "YES" | "NO", now: string): ReviewerConclusion {
  return {
    slot,
    provider: slot === "A" ? "CODEX_SUBSCRIPTION" : "CLAUDE_CODE_SUBSCRIPTION",
    reviewedHash: hash,
    verdict,
    points: [
      { topic: "migration-safety", stance, says: `${slot} on migration safety`, confidence: "HIGH", evidence: `${slot} pointed at the migration block` },
      { topic: "naming", stance: "YES", says: `${slot} on naming`, confidence: "LOW", evidence: `${slot} pointed at the identifier list` },
    ],
    startedAt: now,
    completedAt: now,
  };
}

function reviewInput(overrides: Partial<ReviewInput> = {}): ReviewInput {
  return {
    body: "the exact diff both reviewers read, byte for byte",
    describes: "the diff on branch admin-c at SHA 5d73a490",
    question: "Is this change safe to merge?",
    scope: "PR 294 — the agent bridge",
    allowed: { files: ["lib/control-plane/agents/**"], systems: [] },
    requestedOutput: "A yes or no on merge safety, with the reasons.",
    providers: { a: "CODEX_SUBSCRIPTION", b: "CLAUDE_CODE_SUBSCRIPTION" },
    idempotencyKey: "k1",
    ...overrides,
  };
}

/* ================================================================== *
 * 1. THE PROVIDERS — measured, never assumed
 * ================================================================== */

test("ADM-C8: the provider list is the two canonical subscription types and nothing else", () => {
  assert.deepEqual([...AGENT_PROVIDERS], ["CODEX_SUBSCRIPTION", "CLAUDE_CODE_SUBSCRIPTION"]);
  assert.equal(isAgentProvider("CODEX_SUBSCRIPTION"), true);
  assert.equal(isAgentProvider("ANTHROPIC_API"), false, "an API-key provider is not a subscription provider");
  for (const p of AGENT_PROVIDERS) {
    assert.ok(PROVIDER_WORDS[p].name.length > 0, `${p} has a name for the owner's page`);
    assert.ok(!PROVIDER_WORDS[p].name.includes("_"), `${p} does not render as the machine constant`);
  }
});

test("ADM-C8: a probe takes three independent readings and never runs a launcher it could not find", () => {
  let asked = 0;
  const host: ProbeHost = {
    resolve: () => null,
    exists: () => false,
    askVersion: () => {
      asked += 1;
      return { ok: true, printed: "should never happen", why: null };
    },
    homeDir: "/home/owner",
    now: "2026-09-06T12:00:00.000Z",
  };
  const probe = probeProvider(host, "CODEX_SUBSCRIPTION");
  assert.equal(asked, 0, "nothing is run when the launcher did not resolve");
  assert.equal(probe.launcher.found, false);
  assert.equal(probe.home.present, false);
  assert.equal(probe.version.asked, false);
  assert.ok(probe.version.why !== null, "the reason nothing was run is recorded, not left blank");

  const good = probeProvider(healthyHost("2026-09-06T12:00:00.000Z"), "CLAUDE_CODE_SUBSCRIPTION");
  assert.equal(good.launcher.found, true);
  assert.equal(good.home.savedSignIn, true);
  assert.equal(good.version.printed, "1.2.3");
  assert.equal(good.observedFrom, "RUNNER_HOST");
});

test("ADM-C8 · §3.1: a probe can only ever run a frozen argv from the closed launcher table", () => {
  for (const provider of AGENT_PROVIDERS) {
    const spec = LAUNCHERS[provider];
    assert.ok(Object.isFrozen(spec), `${provider}'s launcher spec is frozen`);
    assert.ok(Object.isFrozen(spec.versionArgv), `${provider}'s argv is frozen`);
    assert.equal(spec.versionArgv[0], spec.launcher, "the argv starts with the launcher itself");
    assert.deepEqual(spec.versionArgv.slice(1), ["--version"], "the only thing a probe may ask is a version");
  }
  // POSITIVE CONTROL: an unnamed provider has no argv, so there is nothing safe
  // to run for it and the probe must refuse rather than improvise one.
  assert.throws(
    () => probeProvider(healthyHost("2026-09-06T12:00:00.000Z"), "SOME_OTHER_AGENT" as never),
    /closed/,
    "an unrecognised provider id is refused, not probed",
  );
  const code = codeOf("lib", "control-plane", "agents", "provider.ts");
  assert.ok(!code.includes("child_process"), "the module reaches for no process spawner of its own");
  assert.ok(!code.includes("execSync"), "there is no place a command string could be assembled");
});

test("ADM-C8: a provider is never reported authenticated — the strongest reading is a saved sign-in", () => {
  assert.deepEqual([...AUTHENTICATION_READINGS], ["SIGNED_IN_UNVERIFIED", "NO_SAVED_SIGN_IN", "CANNOT_TELL_FROM_HERE"]);
  const d = describeProvider({ probe: probeOf({}), fallback: OFF, inFlight: 0, latestTask: null, latestError: null });
  assert.equal(d.authenticated.held, true);
  assert.equal(d.authenticated.held ? d.authenticated.value : null, "SIGNED_IN_UNVERIFIED");
  assert.ok(d.happened.includes("only proven when a job runs"), "the card says what a saved sign-in does not prove");
  assert.equal(d.canRunNow, true);
  assert.equal(d.needsYou, false);
});

test("ADM-C8: not installed is the owner's to fix; installed-but-silent is outside this system", () => {
  const missing = describeProvider({
    probe: probeOf({ launcher: { found: false, at: null }, home: { present: false, savedSignIn: false }, version: { asked: false, printed: null, why: "not found" } }),
    fallback: OFF,
    inFlight: 0,
    latestTask: null,
    latestError: null,
  });
  assert.equal(missing.blocker, "OWNER_GATED");
  assert.equal(missing.canRunNow, false);
  assert.equal(missing.needsYou, true);
  assert.ok(missing.needsYouAction !== null && missing.needsYouAction.includes("install"));
  assert.equal(missing.authenticated.held, false, "there is no sign-in to check, so this is a gap and not a No");
  assert.equal(missing.authenticated.held ? null : missing.authenticated.gap.whose, "OURS");
  assert.ok(missing.happened.includes("Nothing has been tried"), "absence is argued, never asserted as a failure");

  /*
   * The reading actually taken on the owner's machine on 2026-09-06: signed in,
   * set up, and not on the runner's path. "Not installed" would be a false
   * sentence and the wrong instruction, so the two cases are told apart.
   */
  const setUpButUnreachable = describeProvider({
    probe: probeOf({ launcher: { found: false, at: null }, home: { present: true, savedSignIn: true }, version: { asked: false, printed: null, why: "not found" } }),
    fallback: OFF,
    inFlight: 0,
    latestTask: null,
    latestError: null,
  });
  assert.equal(setUpButUnreachable.canRunNow, false);
  assert.equal(setUpButUnreachable.blocker, "OWNER_GATED");
  assert.ok(!setUpButUnreachable.happened.includes("never been set up"), "a signed-in provider is not described as never set up");
  assert.ok(setUpButUnreachable.happened.includes("not on the path"), "the sentence names the actual obstacle");
  assert.ok(setUpButUnreachable.needsYouAction !== null && !setUpButUnreachable.needsYouAction.includes("install"));
  assert.equal(setUpButUnreachable.configured.held ? setUpButUnreachable.configured.value : null, true, "a saved sign-in is evidence it is set up");

  const silent = describeProvider({
    probe: probeOf({ version: { asked: true, printed: null, why: "no answer" } }),
    fallback: OFF,
    inFlight: 0,
    latestTask: null,
    latestError: null,
  });
  assert.equal(silent.blocker, "EXTERNAL");
  assert.equal(silent.canRunNow, false);

  const signedOut = describeProvider({
    probe: probeOf({ home: { present: true, savedSignIn: false } }),
    fallback: OFF,
    inFlight: 0,
    latestTask: null,
    latestError: null,
  });
  assert.equal(signedOut.blocker, "OWNER_GATED");
  assert.equal(signedOut.canRunNow, false);
  assert.equal(signedOut.authenticated.held ? signedOut.authenticated.value : null, "NO_SAVED_SIGN_IN");
});

test("ADM-C8: from the website nothing about a provider is claimed — every field is a named gap, classified EXTERNAL", () => {
  const d = unobservedFromWeb("CODEX_SUBSCRIPTION", OFF, "2026-09-06T12:00:00.000Z");
  assert.equal(d.observedFrom, "WEB_FUNCTION");
  assert.equal(d.blocker, "EXTERNAL");
  assert.equal(d.canRunNow, false);
  for (const [name, field] of [
    ["configured", d.configured],
    ["reachable", d.reachable],
    ["authenticated", d.authenticated],
    ["capacity", d.capacity],
    ["occupancy", d.occupancy],
    ["latestError", d.latestError],
  ] as const) {
    assert.equal(field.held, false, `${name} is not claimed from a place that cannot measure it`);
    assert.equal(field.held ? null : field.gap.whose, "UNKNOWABLE_NOW", `${name}'s gap says nobody can settle it from here`);
    assert.ok(field.held ? false : field.gap.says.length > 20, `${name} carries the sentence the owner reads`);
  }
  /*
   * The reason belongs on the card once, not on every field. Measured on the
   * rendered page: one identical paragraph repeated six times, which is the
   * kind of surface §9A exists to stop.
   */
  const sentences = [d.configured, d.reachable, d.authenticated, d.capacity, d.occupancy, d.latestTask, d.latestError].map((f) =>
    f.held ? "" : f.gap.says,
  );
  assert.equal(new Set(sentences).size, sentences.length, "each field says which particular thing is unknowable, not the same paragraph seven times");
  assert.ok(d.happened.includes("cannot see that machine"), "the reason is stated once, on the card");
});

test("ADM-C8: capacity is free slots OF total, and busy is derived from work in flight", () => {
  const busy = describeProvider({ probe: probeOf({}), fallback: OFF, inFlight: 1, latestTask: null, latestError: null });
  assert.equal(busy.capacity.held, true);
  if (busy.capacity.held) {
    assert.equal(busy.capacity.value.value, 0);
    assert.equal(busy.capacity.value.denominator, AGENT_BOUNDS.maxConcurrentJobsPerProvider);
    assert.ok(busy.capacity.value.contract.length > 20, "the number states what it licenses a reader to conclude");
    assert.ok(busy.capacity.value.denominatorSource.length > 20, "the denominator says where it came from");
  }
  assert.equal(busy.occupancy.held ? busy.occupancy.value : null, "BUSY");
  // POSITIVE CONTROL: more in flight than seats must never produce a negative
  // count or a numerator above its denominator.
  const over = describeProvider({ probe: probeOf({}), fallback: OFF, inFlight: 99, latestTask: null, latestError: null });
  assert.equal(over.capacity.held ? over.capacity.value.value : -1, 0);
});

/* ================================================================== *
 * 2. PAID API FALLBACK — off, and off again after a restart
 * ================================================================== */

test("ADM-C8: paid API fallback is OFF by default and fails closed on every not-exactly-true value", () => {
  assert.equal(API_FALLBACK_DEFAULT_ENABLED, false);
  const closed = [
    null,
    undefined,
    {},
    { apiFallback: null },
    { apiFallback: {} },
    { apiFallback: { enabled: "true" } },
    { apiFallback: { enabled: 1 } },
    { apiFallback: { enabled: "on" } },
    { apiFallback: { enabled: {} } },
  ];
  for (const config of closed) {
    const policy = apiFallbackPolicy(config as never);
    assert.equal(policy.enabled, false, `${JSON.stringify(config)} does not open the paid path`);
    assert.equal(policy.source, "DEFAULT");
    assert.ok(policy.says.includes("never"), "the sentence promises nothing is quietly billed");
  }
  // POSITIVE CONTROL: the one value that does open it, so the guard above is
  // measuring something rather than always passing.
  const on = apiFallbackPolicy(ALLOWED);
  assert.equal(on.enabled, true);
  assert.equal(on.source, "OWNER_DECISION");
  assert.equal(on.decidedAt, "2026-09-06T11:00:00.000Z");
});

test("ADM-C8: nothing that decides policy reads an environment variable, so a restart cannot turn spending on", () => {
  for (const file of POLICY_FILES) {
    const code = codeOf(...file.split("/"));
    assert.ok(!code.includes("process.env"), `${file} reads no environment variable`);
  }
  assert.equal(POLICY_FILES.length, 5, "the sweep covered every policy module in the bridge");
  // The host adapter is the ONE file that touches a machine, and the only
  // environment it may read is where programs live — never a WTP_ variable and
  // never anything that could reach the paid-API decision.
  const host = codeOf(...HOST_FILE.split("/"));
  const reads = [...host.matchAll(/process\.env(?:\.([A-Za-z_]+))?/g)].map((m) => m[1] ?? "(whole object)");
  assert.deepEqual(new Set(reads), new Set(["(whole object)"]), "the host adapter takes the environment as an argument rather than reaching into named variables");
  assert.ok(!/WTP_/.test(host), "the host adapter names no project credential");
  assert.ok(!host.includes("apiFallback"), "the host adapter cannot reach the paid-API policy at all");
});

test("§3.1: the host adapter can only ever run one of the declared version checks", async () => {
  const { argvIsPermitted, nodeProbeHost } = await import("@/lib/control-plane/agents/host.ts");
  for (const provider of AGENT_PROVIDERS) {
    assert.ok(argvIsPermitted(LAUNCHERS[provider].versionArgv), `${provider}'s own version check is permitted`);
  }
  // POSITIVE CONTROL: every shape of a command that is not one of those two is
  // refused, including one that starts with a permitted launcher.
  for (const forbidden of [["rm", "-rf", "/"], ["codex"], ["codex", "exec", "anything"], ["codex", "--version", "--extra"], []]) {
    assert.equal(argvIsPermitted(forbidden), false, `${JSON.stringify(forbidden)} is not a declared version check`);
  }
  const host = nodeProbeHost("2026-09-06T12:00:00.000Z");
  assert.throws(() => host.askVersion(["codex", "exec", "whatever"]), /closed/, "the host refuses to run it, not merely disapproves");
  assert.throws(() => host.askVersion(["git", "log"]), /closed/);
  const code = codeOf(...HOST_FILE.split("/"));
  assert.ok(code.includes("shell: false"), "no shell interprets anything");
  assert.ok(!code.includes("execSync("), "no string-shaped command exists to be run");
  assert.ok(code.includes("existsSync"), "a saved sign-in is answered by presence");
  assert.ok(!code.includes("readFileSync"), "the credential file is never opened");
});

test("ADM-C8: an exhausted subscription is refused, never silently billed", () => {
  const ok = chooseExecutionPath(true, OFF, "Codex");
  assert.equal(ok.path, "SUBSCRIPTION");
  assert.equal(ok.blocker, null);

  const refused = chooseExecutionPath(false, OFF, "Codex");
  assert.equal(refused.path, "REFUSE");
  assert.equal(refused.blocker, "EXTERNAL");
  assert.ok(refused.says.includes("nothing was charged"), "the refusal says money did not move");

  // POSITIVE CONTROL: with the owner's setting on, and only then, the paid path
  // opens — proving the refusal above is a decision and not a hard-coded no.
  const billed = chooseExecutionPath(false, apiFallbackPolicy(ALLOWED), "Codex");
  assert.equal(billed.path, "PAID_API");
  assert.ok(billed.says.includes("billed"), "when it does cost money, the sentence says so");
});

/* ================================================================== *
 * 3. THE JOB — bounded and typed, never a shell
 * ================================================================== */

test("ADM-C8: a delegated job may only read or propose; anything that could ship is refused at construction", () => {
  const context = freezeContext("body", "the diff", "2026-09-06T12:00:00.000Z");
  const base = {
    mode: "CLAUDE" as const,
    role: "SINGLE" as const,
    provider: "CLAUDE_CODE_SUBSCRIPTION" as const,
    context,
    scope: "PR 294",
    allowed: { files: [], systems: [] },
    requestedOutput: "a review",
    startedAt: "2026-09-06T12:00:00.000Z",
    idempotencyKey: "k",
  };
  for (const authority of ["READ_ONLY", "PROPOSE_ONLY"] as const) {
    assert.ok(openJob({ ...base, authority }).jobId.startsWith("aj-"));
  }
  for (const authority of ["REVERSIBLE_NONPRODUCTION", "CODE_CHANGE", "GOVERNED_INTEGRATION", "OWNER_DECISION_REQUIRED", "PROHIBITED"] as const) {
    assert.throws(() => openJob({ ...base, authority }), /read and propose/, `${authority} is refused`);
  }
  assert.throws(() => openJob({ ...base, authority: "READ_ONLY", requestedOutput: "  " }), /requested output/);
});

test("ADM-C8: the record carries a content hash of the snapshot, never the snapshot", () => {
  const secretish = "the whole reviewed diff, which must not end up in the control plane";
  const context = freezeContext(secretish, "the diff on branch admin-c", "2026-09-06T12:00:00.000Z");
  assert.ok(context.hash.startsWith("sha256-"));
  assert.equal(context.bytes, Buffer.byteLength(secretish, "utf8"));
  const job = openJob({
    mode: "GPT",
    role: "SINGLE",
    provider: "CODEX_SUBSCRIPTION",
    context,
    scope: "PR 294",
    authority: "READ_ONLY",
    allowed: { files: [], systems: [] },
    requestedOutput: "a review",
    startedAt: "2026-09-06T12:00:00.000Z",
    idempotencyKey: "k",
  });
  assert.ok(!JSON.stringify(job).includes(secretish), "the reviewed bytes are identified, not carried");
  assert.throws(() => freezeContext("x".repeat(AGENT_BOUNDS.maxContextBytes + 1), "too big", "now"), /bounded job/);
  assert.throws(() => freezeContext("x", "  ", "now"), /description/);
});

test("ADM-C8: a job id is derived from what makes it that job, so a retry collides instead of forking", () => {
  const same = {
    mode: "GPT" as const,
    role: "SINGLE" as const,
    provider: "CODEX_SUBSCRIPTION" as const,
    contextHash: "sha256-abc",
    scope: "PR 294",
    startedAt: "2026-09-06T12:00:00.000Z",
  };
  assert.equal(agentJobId(same), agentJobId({ ...same }));
  assert.notEqual(agentJobId(same), agentJobId({ ...same, startedAt: "2026-09-06T12:00:01.000Z" }));
  assert.notEqual(agentJobId(same), agentJobId({ ...same, provider: "CLAUDE_CODE_SUBSCRIPTION" }));
  assert.ok(AGENT_MODES.every((m) => MODE_WORDS[m].name.length > 0 && !MODE_WORDS[m].name.includes("_")));
});

test("ADM-C8: a refusal is an ending with no result; a completion is an ending with one", async () => {
  const { log, rows } = memoryLog();
  const context = freezeContext("body", "the diff", "2026-09-06T12:00:00.000Z");
  const job = openJob({
    mode: "CLAUDE",
    role: "SINGLE",
    provider: "CLAUDE_CODE_SUBSCRIPTION",
    context,
    scope: "PR 294",
    authority: "PROPOSE_ONLY",
    allowed: { files: ["lib/**"], systems: [] },
    requestedOutput: "a branch with the fix",
    startedAt: "2026-09-06T12:00:00.000Z",
    idempotencyKey: "k",
  });
  await persistJob(log, job, "2026-09-06T12:00:00.000Z");
  assert.equal(job.state, "RUNNING");
  assert.equal(job.result, null);

  const refused = refuseJob(job, { code: "AGENT_PROVIDER_UNAVAILABLE", says: "Claude Code could not take this." }, "2026-09-06T12:00:05.000Z");
  assert.equal(refused.state, "REFUSED");
  assert.equal(refused.result, null, "a refusal is not an empty answer");
  assert.equal(refused.completedAt, "2026-09-06T12:00:05.000Z");

  const done = completeJob(job, { says: "Safe to merge.", detail: "…", reviewedHash: context.hash }, "2026-09-06T12:00:09.000Z", {
    branch: "claude/agent-bridge",
    pullRequest: "#294",
  });
  assert.equal(done.state, "DONE");
  assert.equal(done.producedBranch, "claude/agent-bridge");
  assert.equal(done.producedPullRequest, "#294");

  const broke = failJob(job, "It started and stopped.", "2026-09-06T12:00:11.000Z");
  assert.equal(broke.state, "FAILED");
  assert.equal(broke.result, null);

  assert.equal(rows.length, 1);
  assert.equal(inFlightFor([job], "CLAUDE_CODE_SUBSCRIPTION"), 1);
  assert.equal(inFlightFor([done], "CLAUDE_CODE_SUBSCRIPTION"), 0);
  assert.equal(latestFor([job, done], "CODEX_SUBSCRIPTION"), null);
});

/* ================================================================== *
 * 4. INDEPENDENT REVIEW — the isolation is structural
 * ================================================================== */

test("ADM-C8: the bridge stores its job in the control plane's own record, output digested rather than kept", () => {
  const context = freezeContext("the reviewed diff", "the diff on branch admin-c", "2026-09-06T12:00:00.000Z");
  const opening = openJob({
    mode: "CLAUDE",
    role: "SINGLE",
    provider: "CLAUDE_CODE_SUBSCRIPTION",
    context,
    scope: "PR 294",
    authority: "PROPOSE_ONLY",
    allowed: { files: ["lib/**"], systems: ["github"] },
    requestedOutput: "a branch with the fix",
    startedAt: "2026-09-06T12:00:00.000Z",
    idempotencyKey: "k",
  });
  const job = completeJob(
    opening,
    { says: "Done.", detail: "a long agent answer nobody wants in the control plane", reviewedHash: context.hash },
    "2026-09-06T12:00:09.000Z",
    { branch: "claude/fix", pullRequest: "#294" },
  );

  /*
   * The store has no update, and it throws on a differing record under one id.
   * So opening and closing must be two rows — a single id per job would pass
   * every in-memory test and throw on the first real close.
   */
  assert.ok(jobRecordId(opening).startsWith(`${opening.jobId}:`), "a transition row is named by its job first");
  assert.notEqual(jobRecordId(opening), jobRecordId(job), "opening and closing are two rows, not one row rewritten");
  assert.equal(jobRecordId(job), jobRecordId({ ...job }), "and a true retry of one transition is the same row");

  const record = toAgentJobRecord(job);
  assert.equal(record.jobId, job.jobId);
  assert.equal(record.status, "DONE", "the record carries the control plane's own status vocabulary");
  assert.equal(record.subject, "PR 294");
  assert.equal(record.receiptId, job.receiptId);
  assert.ok(record.resultDigest !== null && record.resultDigest.startsWith("sha256-"));
  assert.ok(!JSON.stringify({ ...record, extra: {} }).includes("a long agent answer"), "the named fields digest the output rather than carry it");

  const back = fromAgentJobRecord(record);
  assert.deepEqual(back, job, "everything the bridge needs survives the round trip");

  // A COMPARISON row belongs to no provider, and that survives too.
  const comparison = toAgentJobRecord({ ...job, role: "COMPARISON", provider: null });
  assert.ok(comparison.provider.length > 0, "the stored provider is never an empty string");
  assert.equal(fromAgentJobRecord(comparison)?.provider, null, "and it reads back as nobody, not as a provider whose name we lost");

  // POSITIVE CONTROL: the aggregate-only boundary is checked at write time, and
  // a reader-level field name three objects deep is refused rather than stored.
  assert.throws(
    () => toAgentJobRecord({ ...job, result: { says: "s", detail: "d", reviewedHash: "h", comment: "a reader's words" } as never }),
    /aggregate-only|refused/i,
    "a reader-level field inside the result is refused at append time",
  );
});

test("ADM-C8: a row in the shared log this bridge did not write is counted, never dropped", () => {
  const foreign = {
    formatVersion: 1,
    jobId: "aj-someone-else",
    provider: "SOMETHING_ELSE",
    mode: "UNKNOWN_MODE",
    status: "DONE",
    subject: "another writer's job",
    requestedAt: "2026-09-06T12:00:00.000Z",
    startedAt: null,
    completedAt: null,
    resultDigest: null,
    receiptId: null,
    extra: {},
  } as AgentJobRecord;
  assert.equal(fromAgentJobRecord(foreign), null, "a row without this bridge's own bag is not read as one of its jobs");

  const view = buildAgentBridgeView(viewInput({ jobs: held({ jobs: [], unreadable: 3 }) }));
  assert.equal(view.unreadableRows, 3);
  assert.ok(view.unreadableSays !== null && view.unreadableSays.includes("cannot read"), "the page says so rather than shrinking its own denominator");
  assert.equal(view.jobCount.held ? view.jobCount.value.denominator : -1, 0, "unreadable rows are not counted as jobs either");

  // POSITIVE CONTROL: with nothing unreadable there is no sentence to read, so
  // the note above is a measurement and not decoration.
  assert.equal(buildAgentBridgeView(viewInput()).unreadableSays, null);
});

test("ADM-C9: a reviewer's brief has no field through which the other's conclusion could arrive", () => {
  const code = codeOf("lib", "control-plane", "agents", "review.ts");
  const declaration = /export interface ReviewerAssignment \{([\s\S]*?)\n\}/.exec(code);
  assert.ok(declaration !== null, "the assignment interface was found — the guard has a denominator");
  const fields = [...declaration[1].matchAll(/^\s*readonly ([A-Za-z]+)/gm)].map((m) => m[1]);
  assert.deepEqual(fields, ["reviewId", "slot", "provider", "question", "snapshot", "body", "bounds"]);
  const forbidden = /peer|other|counterpart|conclusion|verdict|transcript|previous|thread/i;
  for (const field of fields) assert.ok(!forbidden.test(field), `the brief carries no field named ${field}`);
  // POSITIVE CONTROL: the same field check, run against a brief that DOES carry
  // a channel, must fail — otherwise this guard would pass on anything.
  assert.ok(forbidden.test("peerConclusion"), "the checker recognises a channel when there is one");
});

test("ADM-C9: neither reviewer can reach the other's conclusion, even after the other has finished", async () => {
  const { log, order } = memoryLog();
  const now = tickingClock();
  let aVerdict = "";
  let bSawStrings: string[] = [];
  let bSawFunctions = -1;
  let bBriefFrozen = false;

  const execute: ReviewerExecutor = async (assignment: ReviewerAssignment) => {
    if (assignment.slot === "A") {
      const c = conclusionOf("A", assignment.snapshot.hash, "A says the migration is unsafe", "NO", now());
      aVerdict = c.verdict;
      return c;
    }
    // B runs after A has certainly finished, and then hunts for A's answer
    // through every string reachable from its own brief.
    await new Promise((resolve) => setImmediate(resolve));
    bSawStrings = reachableStrings(assignment);
    bSawFunctions = reachableFunctions(assignment);
    bBriefFrozen = Object.isFrozen(assignment) && Object.isFrozen(assignment.bounds);
    return conclusionOf("B", assignment.snapshot.hash, "B says the migration is safe", "YES", now());
  };

  const deps: ReviewDeps = { execute, log, now, pathFor: () => chooseExecutionPath(true, OFF, "provider") };
  const outcome = await runIndependentReview(deps, reviewInput());

  assert.ok(aVerdict.length > 0, "the first reviewer really produced a conclusion — the hunt had something to find");
  assert.equal(bSawFunctions, 0, "the brief carries no callable through which anything could be fetched");
  assert.equal(bBriefFrozen, true, "the brief is frozen, so a reviewer cannot even rewrite its own instructions");
  for (const found of bSawStrings) {
    assert.ok(!found.includes(aVerdict), "the second reviewer's brief does not contain the first's verdict");
    assert.ok(!found.includes("A on migration safety"), "nor any of the first reviewer's points");
  }
  // POSITIVE CONTROL: plant the conclusion in a brief-shaped object and require
  // the same walk to find it. Without this, an empty walk would look like proof.
  const planted = reachableStrings({ ...reviewInput(), leaked: aVerdict });
  assert.ok(planted.some((s) => s.includes(aVerdict)), "the walk finds a planted conclusion");

  assert.equal(outcome.mode, "INDEPENDENT_REVIEW");
  assert.equal(outcome.preservesIndependence, true);
  assert.equal(order[order.length - 1], "COMPARISON:DONE", "the comparison is written last, after both seats");
  assert.ok(order.indexOf("REVIEWER_A:DONE") < order.lastIndexOf("COMPARISON:DONE"));
  assert.ok(order.indexOf("REVIEWER_B:DONE") < order.lastIndexOf("COMPARISON:DONE"));
});

test("ADM-C9: a sealed conclusion opens only as a pair, and there is no single-conclusion opener", async () => {
  const a = conclusionOf("A", "sha256-x", "A verdict", "NO", "2026-09-06T12:00:01.000Z");
  const b = conclusionOf("B", "sha256-x", "B verdict", "YES", "2026-09-06T12:00:02.000Z");
  const sa = seal(a);
  const sb = seal(b);

  assert.ok(!JSON.stringify(sa).includes("A verdict"), "the handle carries no answer");
  assert.ok(!JSON.stringify(sa).includes("migration"), "nor any of the reviewer's points");
  assert.equal(Object.isFrozen(sa), true);

  const both = openBoth(sa, sb);
  assert.equal(both.ok, true);
  if (both.ok) {
    assert.equal(both.a.slot, "A", "the pair opens in slot order however it was handed over");
    assert.equal(both.b.slot, "B");
  }
  const reversed = openBoth(sb, sa);
  assert.equal(reversed.ok && reversed.a.slot, "A", "argument order cannot change whose answer is whose");

  assert.equal(openBoth(sa, sa).ok, false, "one reviewer's handle twice is not a pair");
  const foreign = { kind: "SEALED_REVIEWER_CONCLUSION" as const, slot: "B" as const, provider: "CLAUDE_CODE_SUBSCRIPTION" as const, completedAt: "x" };
  assert.equal(openBoth(sa, foreign).ok, false, "a handle this module did not seal cannot be opened here");

  const exported = await import("@/lib/control-plane/agents/review.ts");
  const openers = Object.keys(exported).filter((name) => /^open/.test(name));
  assert.deepEqual(openers, ["openBoth"], "openBoth is the only opener the module exports");
});

test("ADM-C9: the isolation proof is computed from the run's own stamps, and fails when it should", () => {
  const snapshot = freezeContext("body", "the diff", "2026-09-06T12:00:00.000Z");
  const assignmentA = { reviewId: "r", slot: "A", provider: "CODEX_SUBSCRIPTION", question: "q", snapshot, body: "body", bounds: { wallMs: 1, allowed: { files: [], systems: [] } } } as ReviewerAssignment;
  const assignmentB = { ...assignmentA, slot: "B", provider: "CLAUDE_CODE_SUBSCRIPTION" } as ReviewerAssignment;
  const a = conclusionOf("A", snapshot.hash, "A", "NO", "2026-09-06T12:00:01.000Z");
  const b = conclusionOf("B", snapshot.hash, "B", "YES", "2026-09-06T12:00:02.000Z");

  const good = proveIsolation({ assignmentA, assignmentB, a, b, assignmentsFrozenAt: "2026-09-06T12:00:00.000Z", comparedAt: "2026-09-06T12:00:03.000Z" });
  assert.equal(good.holds, true);
  assert.equal(good.sameSnapshot, true);
  assert.equal(good.eachReviewedWhatItWasGiven, true);
  assert.equal(good.comparedAfterBoth, true);

  // POSITIVE CONTROL 1: a reviewer that echoed a different copy did not review
  // the frozen one, whatever else is true of the run.
  const wrongCopy = proveIsolation({
    assignmentA,
    assignmentB,
    a: { ...a, reviewedHash: "sha256-something-else" },
    b,
    assignmentsFrozenAt: "2026-09-06T12:00:00.000Z",
    comparedAt: "2026-09-06T12:00:03.000Z",
  });
  assert.equal(wrongCopy.eachReviewedWhatItWasGiven, false);
  assert.equal(wrongCopy.holds, false);
  assert.ok(wrongCopy.says.includes("cannot be shown as an independent review"));

  // POSITIVE CONTROL 2: a comparison stamped before a reviewer finished cannot
  // have been computed after both of them.
  const tooEarly = proveIsolation({ assignmentA, assignmentB, a, b, assignmentsFrozenAt: "2026-09-06T12:00:00.000Z", comparedAt: "2026-09-06T12:00:01.500Z" });
  assert.equal(tooEarly.comparedAfterBoth, false);
  assert.equal(tooEarly.holds, false);

  // POSITIVE CONTROL 3: two different frozen copies are not one snapshot.
  const otherSnapshot = freezeContext("a different body", "another diff", "2026-09-06T12:00:00.000Z");
  const split = proveIsolation({
    assignmentA,
    assignmentB: { ...assignmentB, snapshot: otherSnapshot } as ReviewerAssignment,
    a,
    b: { ...b, reviewedHash: otherSnapshot.hash },
    assignmentsFrozenAt: "2026-09-06T12:00:00.000Z",
    comparedAt: "2026-09-06T12:00:03.000Z",
  });
  assert.equal(split.sameSnapshot, false);
  assert.equal(split.holds, false);
});

test("ADM-C9: agreement is by topic and stance; a topic one of them raised alone is neither", () => {
  const a = conclusionOf("A", "sha256-x", "A", "NO", "2026-09-06T12:00:01.000Z");
  const b = conclusionOf("B", "sha256-x", "B", "YES", "2026-09-06T12:00:02.000Z");
  const onlyOnB = { ...b, points: [...b.points, { topic: "docs", stance: "YES" as const, says: "B alone on docs", confidence: "MEDIUM" as const, evidence: "the README" }] };
  const comparison = compareConclusions(a, onlyOnB, "2026-09-06T12:00:03.000Z");
  assert.deepEqual(comparison.disagreements.map((d) => d.topic), ["migration-safety"]);
  assert.deepEqual(comparison.agreements.map((x) => x.topic), ["naming"]);
  assert.deepEqual(comparison.onlyB.map((p) => p.topic), ["docs"]);
  assert.deepEqual(comparison.onlyA, []);
  assert.equal(comparison.agreements[0].confidence, "LOW", "two reviewers are only as sure as the less sure one");
  assert.ok(comparison.disagreements[0].aEvidence.length > 0 && comparison.disagreements[0].bEvidence.length > 0);
  assert.equal(comparison.comparedAt, "2026-09-06T12:00:03.000Z");
});

test("ADM-C9: ASK_BOTH claims no independence, and its outcome is not an independent review's", async () => {
  const { log } = memoryLog();
  const now = tickingClock();
  const execute: ReviewerExecutor = async (a) =>
    conclusionOf(a.slot, a.snapshot.hash, `${a.slot} verdict`, a.slot === "A" ? "NO" : "YES", now());
  const deps: ReviewDeps = { execute, log, now, pathFor: () => chooseExecutionPath(true, OFF, "provider") };

  const asked = await runAskBoth(deps, reviewInput());
  assert.equal(asked.mode, "ASK_BOTH");
  assert.equal(asked.preservesIndependence, false);
  assert.ok(!Object.prototype.hasOwnProperty.call(asked, "isolation"), "an ask-both run carries no isolation proof at all");
  assert.ok(asked.says.includes("does not prove"), "the page is told, in words, what this mode did not prove");
  assert.ok(asked.comparison !== null, "two answers are still comparable");

  const reviewed = await runIndependentReview(deps, reviewInput({ idempotencyKey: "k2" }));
  assert.equal(reviewed.preservesIndependence, true);
  assert.ok(reviewed.isolation !== null && reviewed.isolation.holds, "the independent run proves what the other cannot");
});

test("ADM-C8 honesty: an unavailable provider produces a refusal record, never a claimed completion", async () => {
  const { log, rows } = memoryLog();
  const now = tickingClock();
  let executed = 0;
  const deps: ReviewDeps = {
    execute: async () => {
      executed += 1;
      throw new Error("this must never be reached");
    },
    log,
    now,
    pathFor: (provider) => chooseExecutionPath(false, OFF, PROVIDER_WORDS[provider].name),
  };
  const outcome = await runIndependentReview(deps, reviewInput());

  assert.equal(executed, 0, "nothing was sent to a provider that cannot take the work");
  assert.equal(outcome.a.state, "REFUSED");
  assert.equal(outcome.b.state, "REFUSED");
  assert.equal(outcome.comparison, null, "one side against nothing is not a comparison");
  assert.equal(outcome.isolation, null, "there is nothing to prove independent");
  assert.ok(outcome.says.includes("Only one side of this review came back") || outcome.says.length > 0);
  const refused = jobsOf(rows).filter((r) => r.state === "REFUSED");
  assert.equal(refused.length, 2, "both refusals are durable records, not a toast");
  for (const row of refused) {
    assert.equal(row.result, null);
    assert.ok(row.refusal !== null && row.refusal.says.includes("nothing was charged"));
  }
  assert.ok(!rows.some((r) => r.status === "DONE"), "nothing anywhere claims this finished");
});

test("ADM-C9: a reviewer that dies is FAILED, not refused, and stops the comparison", async () => {
  const { log } = memoryLog();
  const now = tickingClock();
  const deps: ReviewDeps = {
    execute: async (a) => {
      if (a.slot === "B") throw new Error("the provider dropped the connection");
      return conclusionOf("A", a.snapshot.hash, "A verdict", "NO", now());
    },
    log,
    now,
    pathFor: () => chooseExecutionPath(true, OFF, "provider"),
  };
  const outcome = await runIndependentReview(deps, reviewInput());
  assert.equal(outcome.a.state, "DONE");
  assert.equal(outcome.b.state, "FAILED");
  assert.equal(outcome.comparison, null);
  assert.equal(outcome.isolation, null);
  assert.ok(outcome.says.includes("Only one side"), "the page is told why there is nothing to compare");
});

/* ================================================================== *
 * 5. THE VIEW — a gap is never a zero
 * ================================================================== */

function viewInput(overrides: Partial<AgentBridgeInput> = {}): AgentBridgeInput {
  return {
    observedFrom: "WEB_FUNCTION",
    at: "2026-09-06T12:00:00.000Z",
    jobs: held({ jobs: [], unreadable: 0 }),
    config: null,
    probes: gap("UNKNOWABLE_NOW", "This website cannot look at the machine that runs the work."),
    decisions: held([]),
    ...overrides,
  };
}

test("ADM-C8: on the website both provider cards are gaps classified EXTERNAL, and neither can run", () => {
  const view = buildAgentBridgeView(viewInput());
  assert.equal(view.providers.length, 2);
  for (const p of view.providers) {
    assert.equal(p.observedFrom, "WEB_FUNCTION");
    assert.equal(p.blocker, "EXTERNAL");
    assert.equal(p.canRunNow, false);
    assert.equal(p.configured.held, false);
  }
  assert.equal(view.fallback.enabled, false);
  assert.ok(view.next.includes("refused"), "the page says what happens when a subscription cannot take the work");
});

test("ADM-C8: a control plane we could not reach renders as a named gap, never as zero jobs", () => {
  const view = buildAgentBridgeView(viewInput({ jobs: gap("UNKNOWABLE_NOW", "The control plane could not be opened. We could not ask.") }));
  assert.equal(view.jobs.held, false);
  assert.equal(view.jobCount.held, false);
  assert.equal(view.reviews.held, false);
  assert.equal(view.reviewCount.held, false);
  assert.equal(view.jobs.held ? null : view.jobs.gap.whose, "UNKNOWABLE_NOW");

  // POSITIVE CONTROL: a store that answered and holds nothing is a DIFFERENT
  // fact and does render as a held, honest zero.
  const empty = buildAgentBridgeView(viewInput());
  assert.equal(empty.jobs.held, true);
  assert.equal(empty.jobCount.held ? empty.jobCount.value.value : -1, 0);
});

test("ADM-C8: stated N equals rendered rows on the job table", async () => {
  const { log, rows } = memoryLog();
  const now = tickingClock();
  const deps: ReviewDeps = {
    execute: async (a) => conclusionOf(a.slot, a.snapshot.hash, `${a.slot} verdict`, a.slot === "A" ? "NO" : "YES", now()),
    log,
    now,
    pathFor: () => chooseExecutionPath(true, OFF, "provider"),
  };
  await runIndependentReview(deps, reviewInput());

  const view = buildAgentBridgeView(viewInput({ jobs: held({ jobs: jobsOf(rows), unreadable: 0 }) }));
  assert.equal(view.jobs.held, true);
  assert.equal(view.jobCount.held, true);
  if (view.jobs.held && view.jobCount.held) {
    assert.equal(view.jobCount.value.value, view.jobs.value.length, "the number over the table is the length of the array under it");
    assert.equal(view.jobCount.value.denominator, latestByJob(jobsOf(rows)).length, "the denominator counts jobs, not log rows");
    assert.equal(view.jobs.value.length, 3, "one review is two reviewer jobs plus the comparison, however many rows recorded them");
  }
});

test("ADM-C9: the view reconstructs a review from the log and never calls an ask-both run independent", async () => {
  const { log, rows } = memoryLog();
  const now = tickingClock();
  const deps: ReviewDeps = {
    execute: async (a) => conclusionOf(a.slot, a.snapshot.hash, `${a.slot} verdict`, a.slot === "A" ? "NO" : "YES", now()),
    log,
    now,
    pathFor: () => chooseExecutionPath(true, OFF, "provider"),
  };
  const run = await runIndependentReview(deps, reviewInput());
  const asked = await runAskBoth(deps, reviewInput({ idempotencyKey: "k9", scope: "PR 295 — something else" }));
  assert.ok(run.isolation !== null && asked.mode === "ASK_BOTH");

  const reviews = groupReviews(jobsOf(rows), held([]));
  assert.equal(reviews.length, 2, "both runs were reconstructed from the log alone");
  const independent = reviews.find((r) => r.independent);
  const both = reviews.find((r) => !r.independent);
  assert.ok(independent !== undefined && both !== undefined);

  assert.equal(independent.isolation.held, true, "the independent run shows its proof");
  assert.equal(independent.isolation.held ? independent.isolation.value.holds : false, true);
  assert.equal(independent.comparison.held, true);
  assert.equal(independent.comparison.held ? independent.comparison.value.disagreements.length : -1, 1);
  assert.equal(independent.seats.length, 2);
  assert.deepEqual(independent.seats.map((s) => s.slot), ["First reviewer", "Second reviewer"]);
  assert.equal(independent.snapshotShort, shortHash(independent.snapshot.hash));

  assert.equal(both.isolation.held, false, "an ask-both run has no isolation to show");
  assert.ok(both.isolation.held ? false : both.isolation.gap.says.includes("does not prove independence"));
});

test("ADM-C9: a decision log we could not read never makes the page say the owner decided nothing", async () => {
  const { log, rows } = memoryLog();
  const now = tickingClock();
  const deps: ReviewDeps = {
    execute: async (a) => conclusionOf(a.slot, a.snapshot.hash, `${a.slot} verdict`, a.slot === "A" ? "NO" : "YES", now()),
    log,
    now,
    pathFor: () => chooseExecutionPath(true, OFF, "provider"),
  };
  await runIndependentReview(deps, reviewInput());

  const unreadable = groupReviews(jobsOf(rows), gap("UNKNOWABLE_NOW", "Reading your decisions failed. We could not ask."));
  assert.equal(unreadable[0].decision.held, false);
  assert.equal(unreadable[0].decision.held ? null : unreadable[0].decision.gap.whose, "UNKNOWABLE_NOW");
  assert.equal(unreadable[0].needsYou, false, "he is not asked to decide again because a database failed");

  // POSITIVE CONTROL: a readable log with no decision DOES ask him, because
  // then "you have not decided" is a fact rather than an inference.
  const readable = groupReviews(jobsOf(rows), held([]));
  assert.equal(readable[0].decision.held, false);
  assert.equal(readable[0].decision.held ? null : readable[0].decision.gap.whose, "OURS");
  assert.equal(readable[0].needsYou, true);
  assert.ok(readable[0].needsYouAction !== null && readable[0].needsYouAction.includes("disagreed"));

  // And a recorded decision reads back against the subject the page mints.
  const decided = groupReviews(
    jobsOf(rows),
    held([{ subjectId: reviewDecisionSubject(readable[0].reviewId), chosenOption: "Go with the second reviewer", ownerAnswer: null, decidedAt: "2026-09-06T13:00:00.000Z" }]),
  );
  assert.equal(decided[0].decision.held, true);
  assert.equal(decided[0].decision.held ? decided[0].decision.value.chose : null, "Go with the second reviewer");
  assert.equal(decided[0].needsYou, false);
});

test("ADM-C9: a comparison recorded in a form the page cannot read is a named gap, not an empty agreement", () => {
  assert.equal(parseComparisonDetail("not json at all").held, false);
  assert.equal(parseComparisonDetail(JSON.stringify({ comparison: {} })).held, false);
  const good = parseComparisonDetail(
    JSON.stringify({ comparison: { agreements: [], disagreements: [], onlyA: [], onlyB: [], comparedAt: "x", says: "y" }, isolation: { holds: true } }),
  );
  assert.equal(good.held, true);
});

/* ================================================================== *
 * 6. THE PAGE — render law
 * ================================================================== */

/**
 * The page source with every JSX ATTRIBUTE expression and every property lookup
 * removed, so what is left is what the owner actually reads.
 *
 * `title={p.observedFrom}` is the raw form kept for the hover, `key={p.provider}`
 * is React bookkeeping and `PROVIDER_WORDS[p.provider]` is a lookup — none of
 * them is text on the face. `>{p.provider}<` is, and survives this.
 */
function pageAsRendered(): string {
  return codeOf(...PAGE.split("/"))
    .replace(/\b[A-Za-z]+=\{[^{}]*\}/g, " ")
    .replace(/\[[^[\]]*\]/g, " ");
}

test("ADM-C8: no machine constant leads on the agent page — the raw form lives in the hover", () => {
  const shown = pageAsRendered();
  assert.ok(shown.length > 2000, "the page source was read — the guard has a denominator");
  for (const rendered of ["{p.provider}", "{p.blocker}", "{p.observedFrom}", "{j.state}", "{j.mode}", "{j.authority}", "{r.mode}", "{p.authenticated.value}", "{p.occupancy.value}"]) {
    assert.ok(!shown.includes(rendered), `${rendered} is never rendered as visible text`);
  }
  // POSITIVE CONTROL 1: the stripper leaves a real defect standing, so the
  // sweep above is measuring something.
  assert.ok(
    "<span>{p.provider}</span>".replace(/\b[A-Za-z]+=\{[^{}]*\}/g, " ").replace(/\[[^[\]]*\]/g, " ").includes("{p.provider}"),
    "a constant rendered as text survives the stripping and would fail the sweep",
  );
  // POSITIVE CONTROL 2: the hovers really do carry the raw forms, so the rule
  // above is "not leading" rather than "hidden".
  const full = codeOf(...PAGE.split("/"));
  assert.ok(full.includes("title={p.observedFrom}"), "the observation point is on the hover");
  assert.ok(full.includes("title={j.mode}"), "the mode constant is on the hover");
  assert.ok(full.includes("title={r.mode}"), "the review mode constant is on the hover");
  assert.ok(full.includes("title={j.snapshotHash}"), "the full snapshot hash is on the hover, never leading");
});

test("ADM-C8: the log records every transition, and every projection reads the CURRENT state of a job", async () => {
  const { log, rows } = memoryLog();
  const now = tickingClock();
  const deps: ReviewDeps = {
    execute: async (a) => conclusionOf(a.slot, a.snapshot.hash, `${a.slot} verdict`, a.slot === "A" ? "NO" : "YES", now()),
    log,
    now,
    pathFor: () => chooseExecutionPath(true, OFF, "provider"),
  };
  await runIndependentReview(deps, reviewInput());

  const collapsed = latestByJob(jobsOf(rows));
  assert.ok(rows.length > collapsed.length, "the raw log holds more rows than there are jobs");
  assert.equal(new Set(collapsed.map((j) => j.jobId)).size, collapsed.length, "one row per job after the fold");
  assert.ok(collapsed.every((j) => j.state !== "RUNNING"), "each job reads at the state it ended in");

  // POSITIVE CONTROL: the raw log really does still contain the opening rows,
  // so a projection that forgot to fold would say a finished provider is busy —
  // which is the defect this fold exists to prevent.
  assert.ok(rows.some((r) => r.status === "RUNNING" && r.provider === "CODEX_SUBSCRIPTION"));
  assert.equal(inFlightFor(jobsOf(rows), "CODEX_SUBSCRIPTION"), 0, "a finished job is not in flight, whatever the raw log looks like");
  assert.equal(latestFor(jobsOf(rows), "CODEX_SUBSCRIPTION")?.state, "DONE");

  const view = buildAgentBridgeView(viewInput({ jobs: held({ jobs: jobsOf(rows), unreadable: 0 }) }));
  assert.equal(view.jobCount.held ? view.jobCount.value.denominator : -1, collapsed.length, "the table counts jobs, not log rows");
});

test("ADM-C8: the page renders every stamp through <When>, mints no route, and writes only an intent", () => {
  const code = codeOf(...PAGE.split("/"));
  assert.ok(code.includes('export const dynamic = "force-dynamic"'), "the page is never cached");
  assert.ok(code.includes("export const revalidate = 0"));
  assert.ok(code.includes("<QueueForm returnTo={AGENTS_PAGE_PATH} />"), "one hidden queue form, so a gap button can sit in a sentence");
  assert.ok(code.includes("action={DECISION_ROUTE}"), "a review decision goes through the console's existing decision route");
  assert.ok(!code.includes("toLocaleString"), "no stamp is formatted anywhere but in <When>");
  for (const forbidden of ["WTP_", "process.env", "fetch(", "iframe", "document.cookie"]) {
    assert.ok(!code.includes(forbidden), `the page contains no ${forbidden}`);
  }
  // Two write paths and no third: the gateway for the policy, the decision log
  // for what the owner concluded. Nothing here posts anywhere else.
  const actions = [...code.matchAll(/action=\{([A-Za-z_]+)\}/g)].map((m) => m[1]);
  assert.deepEqual(new Set(actions), new Set(["GATEWAY_ACTION_ROUTE", "DECISION_ROUTE"]));
});

test("ADM-C8: the paid-API switch is the gateway's action, needs saying twice to turn on, and claims no enforcement", () => {
  const code = codeOf(...PAGE.split("/"));
  assert.ok(code.includes("value={SET_API_FALLBACK_ACTION}"), "the control posts the gateway's own action type");
  assert.ok(code.includes('name="type"') && code.includes('name="subject"'), "it uses the gateway's envelope rather than a private one");
  // §9A.22: turning it ON is the expensive direction, so it is the one behind a
  // disclosure with its own explicit confirmation — and the gateway refuses it
  // without that confirmation regardless of what this page renders.
  assert.ok(code.includes('name="confirmed"'), "turning it on carries an explicit confirmation");
  assert.ok(code.includes('<summary>Allow paid API spending</summary>'), "the on direction sits behind a disclosure");
  assert.ok(code.includes('value="false"'), "turning it off needs no ceremony");
  assert.ok(code.includes("view.fallback.missingSeam"), "the page names the exact piece that is missing");
  assert.ok(code.includes("Nothing in the running system reads the setting yet"), "and says plainly that recording it permits nothing");
  const policy = apiFallbackPolicy(null);
  assert.ok(policy.missingSeam.length > 80, "the missing seam is a real sentence, taken from the module that owns the setting");
  assert.ok(policy.enforcement.length > 0);
});

test("§3.4: nothing in the bridge iframes, scrapes or replays a consumer AI session", () => {
  let scanned = 0;
  for (const file of BRIDGE_FILES) {
    const code = codeOf(...file.split("/"));
    scanned += 1;
    for (const forbidden of ["iframe", "document.cookie", "chatgpt.com", "claude.ai", "puppeteer", "playwright", "setCookie", "webContents"]) {
      assert.ok(!code.toLowerCase().includes(forbidden.toLowerCase()), `${file} does not reach for ${forbidden}`);
    }
  }
  assert.equal(scanned, 7, "the sweep read every file in the bridge and its page");
});

test("§9A.1: the bridge never says 'our' to the owner, and never prints a credential's name", () => {
  const ours = /\bour\b/i;
  let scanned = 0;
  for (const file of BRIDGE_FILES) {
    const parts = file.split("/");
    const code = codeOf(...parts);
    scanned += 1;
    const strings = [...code.matchAll(/"([^"\\]{6,})"/g)].map((m) => m[1]);
    for (const s of strings) {
      assert.ok(!ours.test(s), `${file} says "our" in: ${s}`);
      assert.ok(!/WTP_[A-Z_]+/.test(s), `${file} prints an environment variable name in: ${s}`);
    }
  }
  assert.equal(scanned, 7, "the sweep read every file in the bridge and its page");
  // POSITIVE CONTROL: the matcher must catch the word it is looking for, and
  // must not fire on "your", which is the word the pages actually use.
  assert.ok(ours.test("this is our gap"));
  assert.ok(!ours.test("your ChatGPT subscription"));
});
