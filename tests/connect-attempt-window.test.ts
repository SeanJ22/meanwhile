import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { getDefaultAutoSelectFamilyAttemptTimeout, setDefaultAutoSelectFamilyAttemptTimeout } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CONNECT_ATTEMPT_WINDOW_MS,
  installConnectAttemptWindow,
  nodeOptionsWithConnectWindow,
} from "../lib/ops/connect-attempt-window.ts";

const FLAG = "--network-family-autoselection-attempt-timeout";

test("the window is appended once, replaces an earlier value, and leaves other options alone", () => {
  assert.equal(nodeOptionsWithConnectWindow(undefined), `${FLAG}=${CONNECT_ATTEMPT_WINDOW_MS}`);
  assert.equal(nodeOptionsWithConnectWindow(""), `${FLAG}=${CONNECT_ATTEMPT_WINDOW_MS}`);
  assert.equal(nodeOptionsWithConnectWindow("--max-old-space-size=4096"), `--max-old-space-size=4096 ${FLAG}=${CONNECT_ATTEMPT_WINDOW_MS}`);
  assert.equal(nodeOptionsWithConnectWindow(`--trace-warnings ${FLAG}=250 --max-old-space-size=4096`, 2_500), `--trace-warnings ${FLAG}=2500 --max-old-space-size=4096`);
  const twice = nodeOptionsWithConnectWindow(nodeOptionsWithConnectWindow("--trace-warnings"));
  assert.equal(twice.split(FLAG).length - 1, 1);
});

test("install sets this process's default and the environment children inherit", () => {
  const before = getDefaultAutoSelectFamilyAttemptTimeout();
  const env: Record<string, string | undefined> = { NODE_OPTIONS: "--trace-warnings" };
  try {
    installConnectAttemptWindow(2_500, env);
    assert.equal(getDefaultAutoSelectFamilyAttemptTimeout(), 2_500);
    assert.equal(env.NODE_OPTIONS, `--trace-warnings ${FLAG}=2500`);
  } finally {
    setDefaultAutoSelectFamilyAttemptTimeout(before);
  }
});

test("a child started with that environment runs with the window before its own code", () => {
  const env = { ...process.env, NODE_OPTIONS: nodeOptionsWithConnectWindow(undefined, 2_500) };
  const seen = execFileSync(process.execPath, [
    "--input-type=module",
    "-e",
    "import { getDefaultAutoSelectFamilyAttemptTimeout } from 'node:net'; process.stdout.write(String(getDefaultAutoSelectFamilyAttemptTimeout()));",
  ], {
    env,
    encoding: "utf8",
  });
  assert.equal(seen, "2500");
});

test("the window fits the measured handshake and stays inside the per-request deadline", () => {
  assert.ok(CONNECT_ATTEMPT_WINDOW_MS >= 1_000);
  assert.ok(CONNECT_ATTEMPT_WINDOW_MS * 3 < 30_000);
});

test("pilot-runner installs the connect window before its singleton, handoff or any read", () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "scripts/pilot-runner.mts"), "utf8");
  const install = src.indexOf("installConnectAttemptWindow();");
  assert.ok(install > 0, "pilot-runner.mts must call installConnectAttemptWindow()");
  for (const later of ["acquireProcessSingleton(", "reconcileRuntimeReleaseAtBoundary();", "startStandingRuntimeClock();"]) {
    const at = src.indexOf(later, src.indexOf("\nconst ROOT"));
    assert.ok(at > install, `${later} must come after installConnectAttemptWindow()`);
  }
});
