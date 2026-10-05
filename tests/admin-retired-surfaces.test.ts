import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { lookupAction } from "../lib/control-plane/gateway/registry.ts";
import { SECTION_IDS } from "../app/(admin)/_mw/admin-v6/contract.ts";
test("retired actions, sections and routes offer no empty controls or endpoints", () => {
  for (const type of ["config.setApiFallback","fleet.retryWorkItem"]) assert.equal(lookupAction(type),null);
  for (const section of ["workRows","decided"]) assert.equal((SECTION_IDS as readonly string[]).includes(section),false);
  for (const route of ["checklist-definitions","checklist-instances","deploy-preview","public-reader-observation","runner-progress","work-progress"])
    assert.equal(existsSync(`app/api/admin/${route}/route.ts`),false,route);
});
