import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = ts.createSourceFile("address-prompt.tsx", readFileSync("components/address/address-prompt.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let send: ts.VariableDeclaration | undefined;
const visit = (node: ts.Node) => {
  if (ts.isVariableDeclaration(node) && node.name.getText() === "send") send = node;
  ts.forEachChild(node, visit);
};
visit(source);
assert.ok(send?.initializer);
const makeSend = new Function("dependencies", ts.transpileModule(`
  const { fetch, zip, postalEntry, selection, street, page, readerPageForPath, logAddressEntered, setPhase, setError, setElsewhere, setResolution, setHouseNumber, setStreet, onPoint, onResolved, writeSessionAddress } = dependencies;
  return ${send.initializer.getText()};
`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText);

async function submit(street: string, withNumber: string, body: unknown) {
  const state: Record<string, unknown> = { street, houseNumber: withNumber, elsewhere: "99999" };
  const requests: { url: string; input: unknown }[] = [];
  const points: unknown[] = [];
  const writes: unknown[] = [];
  const entries: unknown[] = [];
  const setter = (key: string) => (value: unknown) => {
    state[key] = typeof value === "function" ? value(state[key]) : value;
  };
  const run = makeSend({
    zip: "43215", postalEntry: false, selection: undefined, street,
    page: "MAP", readerPageForPath: () => "MAP",
    logAddressEntered: (scope: unknown) => entries.push(scope),
    fetch: async (url: string, init: RequestInit) => {
      requests.push({ url, input: JSON.parse(String(init.body)) });
      assert.equal(init.method, "POST");
      assert.equal(init.cache, "no-store");
      return Response.json(body);
    },
    setPhase: setter("phase"), setError: setter("error"), setElsewhere: setter("elsewhere"),
    setResolution: setter("resolution"), setHouseNumber: setter("houseNumber"), setStreet: setter("street"),
    onPoint: (point: unknown) => points.push(point),
    onResolved: () => assert.fail("an unresolved address cannot narrow the page"),
    writeSessionAddress: (scope: unknown) => writes.push(scope),
  }) as (house: string) => Promise<void>;
  await run(withNumber);
  assert.equal(requests.length, 1);
  assert.deepEqual(writes, []);
  assert.equal(entries.length, 1, "every entry counts once, including an unresolved address");
  assert.doesNotMatch(JSON.stringify(entries), /Capitol|\b123\b|\blat\b|\blng\b/);
  return { state, points, request: requests[0] };
}

test("a failed full address reports failure once and preserves the reader's input", async () => {
  for (const [street, house] of [["123 Capitol Sq", ""], ["Capitol Sq", "123"]]) {
    const { state, points } = await submit(street, house, {
      ok: true, basis: "EXACT_ADDRESS", resolution: { status: "FAILED", reason: "NOT_FOUND" },
    });
    assert.equal(state.phase, "FAILED");
    assert.equal(state.street, street);
    assert.equal(state.houseNumber, house);
    assert.equal(state.elsewhere, null);
    assert.match(String(state.error), /couldn't place that address/);
    assert.doesNotMatch(String(state.error), /123/);
    assert.deepEqual(points, []);
  }
});

test("a different ZIP remains an offer and never changes the current place or stores address text", async () => {
  const { state, points, request } = await submit("123 Capitol Sq", "", {
    ok: true, basis: "EXACT_ADDRESS", resolution: { status: "FAILED", reason: "NOT_FOUND", resolvesInZip: "43216" },
  });
  assert.equal(state.phase, "FAILED");
  assert.equal(state.elsewhere, "43216");
  assert.match(String(state.error), /resolves in 43216/);
  assert.doesNotMatch(String(state.error), /123/);
  assert.deepEqual(request.input, { zip: "43215", street: "123 Capitol Sq" });
  assert.deepEqual(points, []);
});

test("a street-only result still asks for a house number and can orient the map", async () => {
  const point = { lat: 39.961, lng: -83.001 };
  const { state, points } = await submit("Capitol Sq", "", {
    ok: true, basis: "STREET_SAMPLE", resolution: { status: "FAILED", reason: "NOT_FOUND" }, point,
  });
  assert.equal(state.phase, "NEEDS_NUMBER");
  assert.equal(state.error, null);
  assert.equal(state.elsewhere, null);
  assert.deepEqual(points, [point]);
});
