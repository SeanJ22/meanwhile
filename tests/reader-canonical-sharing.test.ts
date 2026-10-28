import assert from "node:assert/strict";
import test from "node:test";
import { readCanonicalPackages } from "../lib/reader/canonical.ts";
import type { ReadOnlyQuery } from "../lib/control-plane/admin-view/promoted-slices.ts";
import { withReaderRoute } from "../lib/db/reader-route.ts";

const before = "a".repeat(64), after = "b".repeat(64);
let fixtureId = 0;
function fixture() {
  const state = { version: before, unavailable: false, race: false, versions: 0, bodies: 0 };
  let release = () => {}, started = () => {};
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const firstStarted = new Promise<void>(resolve => { started = resolve; });
  const query = (async statements => {
    if(state.unavailable)throw Error("Page unavailable");
    state.bodies++;
    if (state.race) { state.version = after; state.race = false; }
    const version = state.version;
    started();
    if (version === before) await blocked;
    return [[{ row_kind: "publication-fingerprint", part_payload: version },
      { row_kind: "additional", part_payload: [{ version }] }]];
  }) as ReadOnlyQuery;
  // Both callers must name the same source selection and SQL.
  fixtureId++;
  const sharedRead = () => readCanonicalPackages([[]], query, { text: "SELECT 1", params: [] });
  return { state, firstStarted, release: () => release(), read: sharedRead };
}

for (const [firstRoute, secondRoute] of [["/ballot", "/api/reader/state"], ["/api/reader/state", "/ballot"]])
  test(`concurrent ${firstRoute} then ${secondRoute} read their own saved page snapshot`, async () => {
  const f = fixture();
  try {
    const first = withReaderRoute(firstRoute, () => f.read().readGroup(0));
    await f.firstStarted;
    const second = withReaderRoute(secondRoute, () => f.read().readGroup(0));
    await new Promise(resolve => setImmediate(resolve));
    f.release();
    const [a, b] = await Promise.all([first, second]);
    assert.equal(f.state.versions, 0);
    assert.equal(f.state.bodies, 2);
    assert.deepEqual(a.additionalRows, [{ version: before }]);
    assert.deepEqual(b.additionalRows, a.additionalRows);
    assert.notEqual(a.additionalRows, b.additionalRows);
  } finally { f.release(); }
});

test("a new publication never joins an older pending snapshot", async () => {
  const f = fixture();
  try {
    const first = f.read().readGroup(0);
    await f.firstStarted;
    f.state.version = after;
    const second = await f.read().readGroup(0);
    assert.deepEqual(second.additionalRows, [{ version: after }]);
    assert.equal(f.state.bodies, 2);
    f.release();
    assert.deepEqual((await first).additionalRows, [{ version: before }]);
  } finally { f.release(); }
});

test("a page replaced before its read is read from the body’s own snapshot without downloading it again", async () => {
  const f = fixture();
  f.state.race = true;
  const result = await f.read().readGroup(0);
  assert.deepEqual(result.additionalRows, [{ version: after }]);
  assert.equal(f.state.versions, 0);
  assert.equal(f.state.bodies, 1);
});

test("a failed page read cannot borrow an existing pending answer", async () => {
  const f = fixture();
  try {
    const first = f.read().readGroup(0);
    await f.firstStarted;
    f.state.unavailable = true;
    await assert.rejects(f.read().readGroup(0), /Page unavailable/);
    f.release();
    await first;
    assert.equal(f.state.bodies, 1);
  } finally { f.release(); }
});

test("a standalone ballot reads its own current snapshot while sharing metadata loads independently", async () => {
  const f = fixture();
  f.release();
  const first = await withReaderRoute("/ballot", () => f.read().readGroup(0));
  assert.deepEqual(first.additionalRows, [{ version: before }]);
  f.state.version = after;
  const second = await withReaderRoute("/ballot", () => f.read().readGroup(0));
  assert.deepEqual(second.additionalRows, [{ version: after }]);
  assert.equal(f.state.versions, 0);
  assert.equal(f.state.bodies, 2, "independent direct requests still read their own database snapshot");
});

