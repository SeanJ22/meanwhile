/**
 * `pickPortrait` finds a name-matched `<img src>` in a page's markup. That is a claim about the markup, not about
 * what the URL serves, so the picked URL is also fetched and checked to be a picture.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  decodeEntities,
  imagesIn,
  phoneIn,
  pickPortrait,
} from "../lib/hunt/portrait-pick.ts";

describe("HTML image extraction", () => {
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
    assert.match(picked.why, /full source name/i);
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

  it("matches short full names but never a surname alone", () => {
    assert.ok(pickPortrait("Jo Li",imagesIn('<img alt="Jo Li" src="/jo-li.jpg">',"https://example.gov/")));
    assert.equal(pickPortrait("Jane Smith",imagesIn('<img alt="John Smith" src="/smith.jpg">',"https://example.gov/")),null);
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
