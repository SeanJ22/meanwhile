import assert from "node:assert/strict";
import { test } from "node:test";
import { GET } from "../app/api/funding/[target]/route.ts";

test("funding route refuses malformed or excessive identifiers without guessing another person", async () => {
  for (const target of ["", "%XX", "x".repeat(513)]) {
    const response = await GET(new Request("http://localhost/api/funding/control"), { params: Promise.resolve({ target }) });
    assert.equal(response.status, 400);
  }
});
