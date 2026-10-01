import assert from "node:assert/strict";
import test from "node:test";
import { parseDispatchTarget, unitMatchesTarget } from "../lib/control-plane/scheduler/dispatch-target.ts";

test("the words that command the dispatch are not part of the place it names", () => {
  for (const words of ["Send agents to Arizona", "Deploy fleet to Arizona", "Put the workers on Arizona", "Dispatch scouts there to Arizona"]) {
    const target = parseDispatchTarget(words);
    assert.deepEqual(target.states, ["az"], words);
    assert.deepEqual(target.terms, [], `${words}: a state alone matches the whole state`);
  }
  const target = parseDispatchTarget("Send agents to Arizona 85635");
  assert.deepEqual(target.terms, ["85635"]);
  assert.ok(unitMatchesTarget(parseDispatchTarget("Send agents to Arizona"), { id: "freshness:jurisdiction:az:city:x#y", subjectId: "az:city:x" }));
  assert.ok(!unitMatchesTarget(parseDispatchTarget("Send agents to Arizona"), { id: "freshness:jurisdiction:nj:city:x#y", subjectId: "nj:city:x" }));
});

test("a real term next to the command words still narrows the match", () => {
  const target = parseDispatchTarget("Send agents to Pima County campaign finance");
  assert.deepEqual(target.terms, ["pima", "campaign", "finance"]);
});
