import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { personKey } from "../lib/photos/person.ts";

test("person keys ignore suffixes, accents and punctuation, and nothing else", () => {
  assert.equal(personKey("Katie Hobbs"), "KATIE HOBBS");
  assert.equal(personKey("Daniel Butierez Sr."), "DANIEL BUTIEREZ");
  assert.equal(personKey("José D. García-López"), "JOSE D GARCIA LOPEZ");
  // Distinct people stay distinct.
  assert.notEqual(personKey("Alma Hernandez"), personKey("Consuelo Hernandez"));
});

test("the production person-photo resolver reads only the promoted registry projection", () => {
  const source = readFileSync("lib/photos/person.ts", "utf8");
  assert.match(source, /getRegistryRuntimeReadModel\(\)/);
  assert.match(source, /runtime\.statewideExecutives/);
  assert.doesNotMatch(source, /readFileSync|statewide-executives\.ts/);
});
