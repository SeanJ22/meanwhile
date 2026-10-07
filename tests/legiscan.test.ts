import assert from "node:assert/strict";
import { test } from "node:test";

import { GET as votesGet } from "../app/api/votes/route.ts";
import { readZip } from "../lib/sources/legiscan/zip.ts";

test("an id that is neither shape is refused, not guessed at", async () => {
  for (const bad of ["", "plural:nope", "congress:xyz", "curated:az/thing"]) {
    const response = await votesGet(
      new Request(`https://example.test/api/votes?member=${encodeURIComponent(bad)}`),
    );
    assert.equal(response.status, 400, `"${bad}" was accepted`);
  }
});

test("the zip reader rejects what it cannot read rather than returning nothing", () => {
  assert.throws(
    () => readZip(Buffer.from("not a zip at all, not even close")),
    /no end-of-central-directory/,
  );
});
