import assert from "node:assert/strict";
import test from "node:test";

import {
  acquireProcessSingleton,
  ProcessSingletonHeldError,
} from "../lib/civic-data/process-singleton.ts";

test("the OS-held singleton atomically excludes a second writer and releases after exit-equivalent close", async () => {
  const first = await acquireProcessSingleton("test-first", 0);
  try {
    await assert.rejects(
      acquireProcessSingleton("test-second", first.port),
      (error: unknown) =>
        error instanceof ProcessSingletonHeldError &&
        error.port === first.port &&
        error.singletonName === "test-second",
    );
  } finally {
    await first.release();
  }

  const replacement = await acquireProcessSingleton("test-replacement", first.port);
  assert.equal(replacement.port, first.port);
  await replacement.release();
  await replacement.release();
});

test("invalid singleton identities fail before binding", async () => {
  await assert.rejects(acquireProcessSingleton("", 0), /PROCESS_SINGLETON_NAME_REQUIRED/);
  await assert.rejects(acquireProcessSingleton("bad-port", 65_536), /PROCESS_SINGLETON_PORT_INVALID/);
});
