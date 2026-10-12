import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { getOrCreateBrowserKey, mintBrowserKey } from "../lib/state/browser-key.ts";

const ROOT = join(import.meta.dirname, "..");

/** The feedback key and the reaction key must never be the same value, including on the path where localStorage throws: two identifier-free stores holding one value would join. */
function withStorage(impl: {
  getItem: (k: string) => string | null;
  setItem: (k: string, v: string) => void;
}): () => void {
  const g = globalThis as unknown as { window?: unknown };
  const previous = g.window;
  g.window = { localStorage: impl };
  return () => {
    if (previous === undefined) delete g.window;
    else g.window = previous;
  };
}

test("browser key: the two stores get DIFFERENT keys when localStorage works", () => {
  const store = new Map<string, string>();
  const restore = withStorage({
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => void store.set(k, v),
  });
  try {
    const feedback = getOrCreateBrowserKey("wtp.feedback_key");
    const reaction = getOrCreateBrowserKey("wtp.reaction_key");
    assert.notEqual(feedback, reaction, "the two collection stores must never share a key");
    assert.equal(getOrCreateBrowserKey("wtp.feedback_key"), feedback, "the key is not stable");
    assert.equal(store.size, 2, "the two keys did not land under two storage keys");
  } finally {
    restore();
  }
});

test("browser key: the two stores get DIFFERENT keys when localStorage THROWS", () => {
  const restore = withStorage({
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  });
  try {
    const feedback = getOrCreateBrowserKey("wtp.feedback_key");
    const reaction = getOrCreateBrowserKey("wtp.reaction_key");
    assert.notEqual(
      feedback,
      reaction,
      "a SHARED in-memory fallback would make the two stores joinable — this is the path that would have done it",
    );
    assert.equal(
      getOrCreateBrowserKey("wtp.feedback_key"),
      feedback,
      "the fallback key must be stable within a session, or an answer cannot be changed",
    );
  } finally {
    restore();
  }
});

test("browser key: a minted key is 128 bits of hex and never repeats", () => {
  const keys = new Set(Array.from({ length: 200 }, () => mintBrowserKey()));
  assert.equal(keys.size, 200, "two mints collided — this is not a CSPRNG");
  for (const key of keys) assert.match(key, /^[0-9a-f]{32}$/);
});

test("browser key: a malformed stored value is re-minted rather than trusted", () => {
  const store = new Map<string, string>([["wtp.reaction_key", "not-a-key!!"]]);
  const restore = withStorage({
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => void store.set(k, v),
  });
  try {
    assert.match(getOrCreateBrowserKey("wtp.reaction_key"), /^[0-9a-f]{32}$/);
  } finally {
    restore();
  }
});

test("browser key: neither client keeps its own copy of the minting any more", () => {
  for (const path of ["lib/feedback/client.ts", "lib/reactions/client.ts"]) {
    const source = readFileSync(join(ROOT, path), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.ok(
      !/function mintKey\(/.test(code),
      `${path} still holds its own minting — a fix to one is invisible from the other`,
    );
    assert.ok(
      !/let memoryKey/.test(code),
      `${path} still holds its own fallback cell`,
    );
    assert.ok(
      /getOrCreateBrowserKey\(KEY_STORAGE\)/.test(code),
      `${path} does not use the shared implementation`,
    );
  }
});

test("browser key: the two storage keys are still two different strings", () => {
  const feedback = readFileSync(join(ROOT, "lib/feedback/client.ts"), "utf8");
  const reactions = readFileSync(join(ROOT, "lib/reactions/client.ts"), "utf8");
  assert.match(feedback, /const KEY_STORAGE = "wtp\.feedback_key"/);
  assert.match(reactions, /const KEY_STORAGE = "wtp\.reaction_key"/);
});
