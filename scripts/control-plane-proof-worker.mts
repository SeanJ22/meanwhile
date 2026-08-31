/**
 * A WORKER PROCESS for the control-plane proofs. Never run by hand.
 *
 * (Session B resume, W3.D, 2026-08-31. RULING 220's cutover proof conditions.)
 *
 * This exists because the proofs it serves cannot be performed inside one
 * process. "Two workers contend and one wins" is trivially true when both are
 * closures over one heap; the thing under test is two OPERATING SYSTEM
 * PROCESSES reaching one database, which is what a second machine looks like
 * from Postgres's side. `crash` in particular calls `process.exit` with an open
 * Attempt — no `finally` runs, no cleanup happens, and that is the entire
 * point, because a design that depended on a `finally` would pass a test that
 * simulated death by throwing and fail the one that actually kills.
 *
 * Modes, each named by the proof it serves:
 *
 * ```
 *   claim    contend for one RouteTask and report win or observed-lease
 *   crash    claim, open an Attempt, record a partial artifact, then DIE
 *   append   hammer one append-only log key with N records
 *   debt     write a freshness debt and exit, for another process to inherit
 * ```
 *
 * Output is ONE line of JSON on stdout so the parent can parse it without a
 * protocol. Env var names only, never values.
 */

import { claimRouteTask, beginAttemptFor, recordArtifactMetadata } from "../lib/control-plane/repository/coordinator.ts";
import { controlPlaneUrlFromEnv, createPgRepositories } from "../lib/control-plane/repository/pg-store.ts";
import { recordFailure } from "../lib/control-plane/scheduler/debt.ts";
import { persistDebts } from "../lib/control-plane/scheduler/durable.ts";
import type { ArtifactRecord } from "../lib/control-plane/repository/types.ts";

const [mode, ...rest] = process.argv.slice(2);
const url = controlPlaneUrlFromEnv();
if (url === null) {
  process.stdout.write(JSON.stringify({ mode, ok: false, why: "control plane not configured" }) + "\n");
  process.exit(2);
}

const NOW = new Date().toISOString();
const repos = await createPgRepositories(url, NOW);
const me = `proof-worker-${process.pid}`;

function say(payload: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify({ mode, pid: process.pid, ...payload }) + "\n");
}

if (mode === "claim") {
  const [routeTaskId, ttl] = rest;
  try {
    const outcome = await claimRouteTask(repos, {
      routeTaskId,
      holder: me,
      now: NOW,
      ttlMs: Number(ttl),
    });
    say({ won: true, holder: me, leaseId: outcome.lease.value.id });
  } catch (error) {
    /* The loser OBSERVES the lease. That is the proof's other half: a losing
       claim must be able to say who holds it, not merely that it failed. */
    say({ won: false, observed: error instanceof Error ? error.message : String(error) });
  }
  process.exit(0);
}

if (mode === "crash") {
  const [routeTaskId, workItemId, ttl] = rest;
  const outcome = await claimRouteTask(repos, {
    routeTaskId,
    holder: me,
    now: NOW,
    ttlMs: Number(ttl),
  });
  const attempt = await beginAttemptFor(repos, {
    routeTaskId,
    workItemId,
    worker: { role: "ACQUIRER", provider: "we-the-people", version: "proof-worker", instance: me },
    lease: outcome.lease.value,
    now: NOW,
    methodVersion: 0,
    policyVersion: "proof",
  });
  const artifact: ArtifactRecord = {
    artifactId: `art-crash-${process.pid}`,
    workItemId,
    routeTaskId,
    attemptId: attempt.value.id,
    tier: "RESTRICTED_RAW",
    contentHash: `sha256-crashproof-${process.pid}`,
    byteLength: 1234,
    contentType: "text/html",
    canonicalUrl: "https://example.invalid/partial",
    partial: true,
    recordedAt: NOW,
  };
  await recordArtifactMetadata(repos, artifact, NOW);
  say({ claimed: true, attemptId: attempt.value.id, artifactId: artifact.artifactId });
  /*
   * THE KILL. Not a throw, not a rejection, not a return — `process.exit`, so
   * that no `finally`, no `process.on("exit")` handler and no unwind of any
   * kind gets a chance to tidy up. What the control plane sees afterwards is
   * exactly what it would see if this machine lost power.
   */
  process.exit(137);
}

if (mode === "append") {
  const [logKey, countRaw, tag] = rest;
  const count = Number(countRaw);
  const positions: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const outcome = await repos.transitions.append(
      logKey,
      `tr-${tag}-${i}`,
      {
        transitionId: `tr-${tag}-${i}`,
        workItemId: logKey,
        transition: { from: null, to: "OPEN", at: NOW, by: me, why: `append proof ${tag} ${i}` },
      } as never,
      NOW,
    );
    positions.push(outcome.position);
  }
  say({ appended: positions.length, positions });
  process.exit(0);
}

if (mode === "debt") {
  const [obligationId, target] = rest;
  const debt = recordFailure(null, {
    obligationId,
    cause: "TRANSPORT_FAILED",
    detail: `written by process ${process.pid}, which then exited without telling anyone`,
    target,
    dueAt: NOW,
    now: NOW,
  });
  const result = await persistDebts(repos, [debt], NOW);
  say({ written: result.written, obligationId, retryAt: debt.retryAt, firstFailedAt: debt.firstFailedAt });
  process.exit(0);
}

say({ ok: false, why: `unknown mode ${JSON.stringify(mode)}` });
process.exit(2);
