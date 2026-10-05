import assert from "node:assert/strict";
import test from "node:test";
import { linkHealthKey, projectLinkHealth, readLinkHealth, type ReaderLinkHealth } from "../lib/design/link-health.ts";
import { publishReaderLinkHealth, type LinkHealthEdgeStore } from "../lib/civic-data/reader-link-health-publication.ts";

const address = "https://office.example.gov/record";
test("only recorded DEAD verdicts disable a destination, and recovery enables it", () => {
  const found = projectLinkHealth(null, [{ url: `${address}#section`, verdict: "DEAD" }], "2026-10-05T12:00:00Z");
  assert.deepEqual(found.deadAddresses, [address]);
  for (const verdict of ["WAITING", "LATER"] as const) {
    assert.deepEqual(projectLinkHealth(found, [{ url: address, verdict }], "2026-10-05T13:00:00Z").deadAddresses, [address]);
    assert.deepEqual(projectLinkHealth(null, [{ url: address, verdict }], "2026-10-05T13:00:00Z").deadAddresses, []);
  }
  assert.deepEqual(projectLinkHealth(found, [{ url: address, verdict: "OK" }], "2026-10-05T14:00:00Z").deadAddresses, []);
  assert.equal(linkHealthKey("mailto:public@example.gov"), null);
  assert.equal(linkHealthKey("https://user:password@example.gov"), null);
  assert.equal(readLinkHealth({ ...found, deadAddresses: ["javascript:alert(1)"] }), null);
});

test("a concurrent and then stale sweep cannot erase a newer Reader finding", async () => {
  let held: { snapshot: ReaderLinkHealth; etag: string } | null = null;
  let version = 0;
  let conflict = true;
  const store: LinkHealthEdgeStore = {
    async read() { return held; },
    async write(snapshot, etag) {
      if (conflict) { conflict = false; return false; }
      if (etag !== (held?.etag ?? null)) return false;
      held = { snapshot, etag: String(++version) };
      return true;
    },
  };
  const purges: readonly string[][] = [];
  const options = { store, purge: async (tags: readonly string[]) => { (purges as string[][]).push([...tags]); } };
  assert.equal(await publishReaderLinkHealth([{ url: address, verdict: "DEAD" }], "2026-10-05T14:00:00Z", options), true);
  assert.equal(await publishReaderLinkHealth([{ url: address, verdict: "OK" }], "2026-10-05T13:00:00Z", options), false);
  assert.deepEqual((await store.read())?.snapshot.deadAddresses, [address]);
  assert.equal(await publishReaderLinkHealth([{ url: address, verdict: "DEAD" }], "2026-10-05T14:00:00Z", options), true);
  await assert.rejects(publishReaderLinkHealth([{ url: address, verdict: "OK" }], "2026-10-05T14:00:00Z", options), /Conflicting/);
  assert.equal(purges.length, 2);
  assert.equal(await publishReaderLinkHealth([{ url: address, verdict: "OK" }], "2026-10-05T15:00:00Z", options), true);
  assert.deepEqual((await store.read())?.snapshot.deadAddresses, []);
});
