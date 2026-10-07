/**
 * Appends the owner's PAUSE_RUNNER (or RESUME_RUNNER) intent, the reason in
 * `note`, through the same append path the admin API uses, so a deliberately
 * stopped runner is not shown as a crash.
 *
 * Best effort: a control plane that cannot be opened, or an append that does
 * not land, prints "pause note NOT recorded: <why>" and exits 0. Only a bad
 * `--action` (or an over-long note) exits 2.
 *
 * ```
 *   node --env-file=.env.local --experimental-strip-types scripts/runner-pause-note.mts \
 *     --action=PAUSE_RUNNER|RESUME_RUNNER --note="<reason>" [--by=<command>] [--file-store=<dir>]
 * ```
 *
 * `--by` names the calling command (default "runner-pause-note"); the intent's
 * actor is "<by> on <host>". `--file-store=<dir>` writes to a local file store,
 * never the deployed plane.
 */

import { hostname } from "node:os";

import { createFileRepositories } from "../lib/control-plane/repository/file-store.ts";
import {
  CONTROL_PLANE_URL_VAR,
  controlPlaneUrlFromEnv,
  createPgRepositories,
} from "../lib/control-plane/repository/pg-store.ts";
import type { ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";
import {
  appendResearchIntent,
  buildResearchIntent,
  validateIntentNote,
} from "../lib/control-plane/research-view.ts";
import { assertRuntimeAuthority } from "../lib/civic-data/runtime-authority.ts";

const flag = (name: string): string | null => {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? null : hit.slice(name.length + 3);
};

const RUNNER_ACTIONS = ["PAUSE_RUNNER", "RESUME_RUNNER"] as const;
type RunnerAction = (typeof RUNNER_ACTIONS)[number];
const isRunnerAction = (value: string | null): value is RunnerAction =>
  value !== null && (RUNNER_ACTIONS as readonly string[]).includes(value);

const action = flag("action");
if (!isRunnerAction(action)) {
  console.error(
    `runner-pause-note: --action must be PAUSE_RUNNER or RESUME_RUNNER (got ${
      action === null ? "nothing" : JSON.stringify(action)
    })`,
  );
  process.exit(2);
}
const noteCheck = validateIntentNote(action, flag("note"));
if (!noteCheck.ok) {
  console.error(`runner-pause-note: ${noteCheck.detail}`);
  process.exit(2);
}

const by = flag("by") ?? "runner-pause-note";
const host = hostname();
const nowIso = new Date().toISOString();
const intent = buildResearchIntent(action, nowIso, `host:${host}`, noteCheck.note, `${by} on ${host}`);

async function open(): Promise<ControlPlaneRepositories> {
  const store = flag("file-store");
  if (store !== null) return createFileRepositories(store);
  assertRuntimeAuthority({ capabilities: ["OWNER_DISPATCH"] });
  const url = controlPlaneUrlFromEnv();
  if (url === null) throw new Error(`${CONTROL_PLANE_URL_VAR} is not set in this process`);
  return createPgRepositories(url, nowIso);
}

let repos: ControlPlaneRepositories;
try {
  repos = await open();
} catch (error) {
  console.log(`pause note NOT recorded: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(0);
}

const wrote = await appendResearchIntent(repos, intent, nowIso);
if (!wrote.ok) {
  console.log(`pause note NOT recorded: ${wrote.detail}`);
  process.exit(0);
}
console.log(
  `${action === "PAUSE_RUNNER" ? "pause" : "resume"} note recorded: ${intent.intentId}` +
    `${intent.note === null ? "" : ` — ${intent.note}`} (by ${intent.actor}${wrote.appended ? "" : "; an identical record already stood"})`,
);
