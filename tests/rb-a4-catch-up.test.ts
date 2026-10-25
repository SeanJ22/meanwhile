import assert from "node:assert/strict";
import test from "node:test";
import { loadChangedStates } from "../lib/facts/entities.ts";

const states = ["ak", "or", "tx", "wa", "wi"];

function rotation(current: Set<string>) {
  const reads: string[] = [];
  let cursor: string | null = null;
  return {
    reads, cursor: () => cursor,
    pass: (more: () => boolean = () => true) => loadChangedStates(states, cursor, async state => {
      reads.push(state);
      if (current.has(state)) return [];
      current.add(state);
      return [state];
    }, async state => { cursor = state; }, more),
  };
}

test("a changed importer reloads every state in one pass and stops at the first current state", async () => {
  const run = rotation(new Set(["wa"]));
  assert.deepEqual(await run.pass(), ["ak", "or", "tx"]);
  assert.deepEqual(run.reads, ["ak", "or", "tx", "wa"]);
  assert.deepEqual(await run.pass(), ["wi"]);
  assert.equal(run.cursor(), "ak");
});

test("when nothing changed each pass reads one state, as the one-state rotation did", async () => {
  const run = rotation(new Set(states));
  assert.deepEqual(await run.pass(), []);
  assert.deepEqual(await run.pass(), []);
  assert.deepEqual(run.reads, ["ak", "or"]);
});

test("a pass cut by its deadline resumes after the last state it checked", async () => {
  const run = rotation(new Set());
  let left = 2;
  assert.deepEqual(await run.pass(() => left-- > 0), ["ak", "or"]);
  assert.deepEqual(await run.pass(), ["tx", "wa", "wi"]);
});
