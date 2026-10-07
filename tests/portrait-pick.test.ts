/**
 * `pickPortrait` finds a name-matched `<img src>` in a page's markup. That is a claim about the markup, not about
 * what the URL serves, so the picked URL is also fetched and checked to be a picture.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  decodeEntities,
  imagesIn,
  nameTokens,
  phoneIn,
  pickPortrait,
  verifyIsImage,
} from "../lib/hunt/portrait-pick.ts";

/** A fetch that answers with exactly what a recorded host answered. */
function canned(status: number, contentType: string, body: Uint8Array): typeof fetch {
  return (async () =>
    new Response(new Blob([body as BlobPart]), {
      status,
      headers: { "content-type": contentType },
    })) as unknown as typeof fetch;
}
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1]);
const HTML = new TextEncoder().encode("<!doctype html><html><head><title>Page Not Found</title>");

describe("a portrait URL has to serve a picture", () => {
  it("REFUSES the real soft-404 — 200, text/html, and the bytes are markup", () => {
    return verifyIsImage("https://chesterborough.org//images/2022/08/08/russell-goodwin.jpeg", canned(200, "text/html; charset=utf-8", HTML)).then((v) => {
      assert.equal(v.ok, false);
      assert.equal(v.status, 200, "the transport succeeded, which is the whole difficulty");
      assert.match(v.why, /soft 404|not the thing/i, "the reason must say what actually happened");
    });
  });

  it("accepts a real image, and says what it read", async () => {
    const v = await verifyIsImage("https://example.gov/portrait.jpg", canned(200, "image/jpeg", JPEG));
    assert.equal(v.ok, true);
    assert.match(v.why, /jpeg/);
  });

  it("REFUSES bytes and label that disagree, in either direction", async () => {
    // HTML labelled as an image — the direction a lax content-type check misses.
    assert.equal((await verifyIsImage("https://x/", canned(200, "image/jpeg", HTML))).ok, false);
    // A JPEG labelled text/html — real bytes, and the server contradicts itself.
    const v = await verifyIsImage("https://x/", canned(200, "text/html", JPEG));
    assert.equal(v.ok, false);
    assert.match(v.why, /disagree/);
  });

  it("a non-200 is refused with its status, never treated as an absence", async () => {
    const v = await verifyIsImage("https://x/", canned(404, "text/html", HTML));
    assert.equal(v.ok, false);
    assert.equal(v.status, 404);
  });

  it("decodes the entities a page's own markup puts inside a src", () => {
    /* WordPress emits `&#038;` for `&`. */
    assert.equal(
      decodeEntities("https://i0.wp.com/x.jpg?resize=860%2C1000&#038;ssl=1"),
      "https://i0.wp.com/x.jpg?resize=860%2C1000&ssl=1",
    );
    assert.equal(decodeEntities("https://x/a?b=1&amp;c=2"), "https://x/a?b=1&c=2");
  });
});

describe("the picker matches on the name and nothing else", () => {
  const page = `
    <img src="/img/seal.png" alt="Township seal">
    <img src="/img/banner-2026.jpg" alt="">
    <img src="/uploads/russell-goodwin.jpeg" alt="Councilman Russell Goodwin">
  `;

  it("picks the name-matched image and passes over the furniture", () => {
    const picked = pickPortrait("Russell GOODWIN", imagesIn(page, "https://chesterborough.org/government/mayor"));
    assert.ok(picked);
    assert.match(picked.src, /russell-goodwin\.jpeg$/);
    assert.match(picked.why, /goodwin/i);
  });

  it("returns NOTHING rather than the best of a bad set", () => {
    // A largest-image or first-image heuristic picks the seal; a wrong face is the worst failure.
    const furnitureOnly = `<img src="/img/seal.png" alt="Township seal"><img src="/img/banner.jpg" alt="">`;
    assert.equal(pickPortrait("Russell GOODWIN", imagesIn(furnitureOnly, "https://x/")), null);
  });

  it("reads data-src, because a lazily-loaded portrait hides behind a placeholder", () => {
    const lazy = `<img src="/placeholder.gif" data-src="/uploads/sean-mabey.jpg" alt="">`;
    const picked = pickPortrait("Sean MABEY", imagesIn(lazy, "https://kinnelonboro.org/"));
    assert.ok(picked, "a portrait in data-src is the one a reader with JavaScript sees");
    assert.match(picked.src, /sean-mabey/);
  });

  it("a short token never matches — initials and particles are not names", () => {
    assert.deepEqual(nameTokens("Jo A. Li"), []);
  });
});

describe("a phone read off a municipal page is narrow on purpose", () => {
  it("reads the shapes these sites actually write", () => {
    assert.equal(phoneIn("Call 973-714-8246 for the clerk"), "973-714-8246");
    assert.equal(phoneIn("(973) 398-6832 ext. 4"), "973-398-6832 ext. 4");
  });

  it("refuses a template number, which would send a reader to nobody", () => {
    assert.equal(phoneIn("555-123-4567"), null);
    assert.equal(phoneIn("000-000-0000"), null);
  });

  it("does not read a street address or a zip+4 as a phone", () => {
    assert.equal(phoneIn("124 Old Irondale Road, Wharton NJ 07885"), null);
  });
});
