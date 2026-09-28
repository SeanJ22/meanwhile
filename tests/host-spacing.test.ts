import assert from "node:assert/strict";
import test from "node:test";
import { serializeHostSpacing } from "../lib/control-plane/workers/host-spacing.ts";

test("overlapping lanes serialize waits for one host without holding another host", async () => {
  const active = new Map<string, number>();
  const largest = new Map<string, number>();
  const releases: (() => void)[] = [];
  const spaceOut = serializeHostSpacing(async host => {
    const count = (active.get(host) ?? 0) + 1;
    active.set(host, count);
    largest.set(host, Math.max(largest.get(host) ?? 0, count));
    await new Promise<void>(resolve => { releases.push(resolve); });
    active.set(host, count - 1);
  });
  const first = spaceOut("same.gov");
  const second = spaceOut("same.gov");
  const independent = spaceOut("other.gov");
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(releases.length, 2, "one same-host wait and an independent host have started");
  releases[0]();
  await first;
  await Promise.resolve();
  assert.equal(releases.length, 3, "the second same-host wait starts only after the first ends");
  releases[1]();
  releases[2]();
  await Promise.all([second, independent]);
  assert.equal(largest.get("same.gov"), 1);
  assert.equal(largest.get("other.gov"), 1);
});
