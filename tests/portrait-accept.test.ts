import assert from "node:assert/strict";
import test from "node:test";
import {PORTRAIT_ACCEPT,PORTRAIT_FORMATS} from "../lib/photos/decode.ts";
test("image negotiation exactly matches the full decoder format set",()=>{
  assert.deepEqual(PORTRAIT_ACCEPT.split(",").map(s=>s.trim().split(";")[0].replace("image/","")).sort(),[...PORTRAIT_FORMATS].sort());
});
