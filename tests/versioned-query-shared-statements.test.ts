import assert from "node:assert/strict";
import test from "node:test";

test("a checked statement is recognized by every bundled copy of the versioned-query module", async () => {
  // Next.js can copy one module into several server chunks; Node gives a URL with a different query its own instance.
  type VersionedQuery = typeof import("../lib/db/versioned-query.ts");
  const copy = (name: string) => new URL(`../lib/db/versioned-query.ts?copy=${name}`, import.meta.url).href;
  const reader = await import(copy("reader")) as VersionedQuery;
  const driver = await import(copy("driver")) as VersionedQuery;
  assert.notEqual(reader.versionedSelect, driver.versionedSelect, "the two imports are separate module instances");
  let recognized: boolean | undefined;
  const cache = { row: async (input: { current: (previous: string | null, held?: never) => Promise<unknown> }) => {
    await input.current(null).catch(() => undefined);
    return null;
  } };
  await reader.versionedSelect("test", cache as never)(async text => {
    recognized = driver.isVersionedSelectStatement(text);
    return [];
  }, "SELECT 1 AS one");
  assert.equal(recognized, true, "the driver copy sees the reader copy's checked statement");
});
