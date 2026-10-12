import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { SYNTHETIC_RUN_HEADER } from "../lib/db/run-marker.ts";
import {
  confine,
  marksTravel,
  THIRD_PARTY_HOSTS,
} from "../lib/ops/origin-confinement.ts";

import { PUBLIC_SITE_ORIGIN } from "../lib/ops/origins.ts";

const OURS = PUBLIC_SITE_ORIGIN;
const MARKERS = { [SYNTHETIC_RUN_HEADER]: "walk-all-2026-08-23" } as const;
const BASE = {
  accept: "*/*",
  "user-agent": "playwright",
  [SYNTHETIC_RUN_HEADER]: "walk-all-2026-08-23",
} as const;

test("the marker travels to our own origin", () => {
  const d = confine(`${OURS}/api/meetings?zip=07866`, `${OURS}/`, BASE, MARKERS);
  assert.equal(d.verdict, "SAME_ORIGIN_KEPT");
  assert.equal(d.headers[SYNTHETIC_RUN_HEADER], "walk-all-2026-08-23");
  assert.deepEqual(d.removed, []);
});

test("a localhost production build is its own origin and keeps the marker", () => {
  // Local production builds are verified too, so the same rule has to hold there.
  const d = confine("http://localhost:3000/api/meetings", "http://localhost:3000/", BASE, MARKERS);
  assert.equal(d.verdict, "SAME_ORIGIN_KEPT");
});

test("EVERY third-party host this product's pages reach is stripped", () => {
  // The denominator is stated rather than exemplified.
  assert.ok(THIRD_PARTY_HOSTS.length >= 14, "the host list shrank — it is append-only");
  const confirmed: string[] = [];
  for (const host of THIRD_PARTY_HOSTS) {
    const d = confine(`${host}/some/path?k=1`, `${OURS}/`, BASE, MARKERS);
    assert.equal(d.verdict, "CROSS_ORIGIN_STRIPPED", host);
    assert.equal(d.headers[SYNTHETIC_RUN_HEADER], undefined, `${host} still received the marker`);
    // Everything else survives — this strips the marker, not the request.
    assert.equal(d.headers["user-agent"], "playwright", host);
    assert.deepEqual(d.removed, [SYNTHETIC_RUN_HEADER], host);
    confirmed.push(host);
  }
  assert.equal(
    confirmed.length,
    THIRD_PARTY_HOSTS.length,
    `${confirmed.length} of ${THIRD_PARTY_HOSTS.length} third-party hosts confirmed clean`,
  );
});

test("the MapTiler style request — the exact call that failed — carries no custom header", () => {
  // A third party's CORS preflight can refuse the marker header and fail the whole fetch.
  const d = confine(
    "https://api.maptiler.com/maps/basic-v2-dark/style.json?key=REDACTED",
    `${OURS}/`,
    BASE,
    MARKERS,
  );
  assert.equal(d.headers[SYNTHETIC_RUN_HEADER], undefined);
  assert.equal(
    Object.keys(d.headers).some((h) => h.toLowerCase().startsWith("x-wtp-")),
    false,
    "no x-wtp-* header may reach a third party",
  );
});

test("a subdomain is a different origin, and so is a scheme change", () => {
  assert.equal(marksTravel(`${OURS}/x`, "https://other.netlify.app/"), false);
  assert.equal(
    marksTravel(OURS.replace("https://", "http://") + "/x", `${OURS}/`),
    false,
  );
  assert.equal(marksTravel(`${OURS}:8443/x`, `${OURS}/`), false);
});

test("an unreadable origin fails SAFE — stripped, and named as its own verdict", () => {
  // Failing safe means not leaking; "could not tell" is kept apart from "known third-party".
  for (const [url, frame] of [
    ["data:text/html,x", `${OURS}/`],
    [`blob:${OURS}/abc`, `${OURS}/`],
    [`${OURS}/x`, "about:blank"],
    ["not a url at all", `${OURS}/`],
  ] as const) {
    const d = confine(url, frame, BASE, MARKERS);
    assert.equal(d.verdict, "UNKNOWN_ORIGIN_STRIPPED", `${url} ← ${frame}`);
    assert.equal(d.headers[SYNTHETIC_RUN_HEADER], undefined);
  }
});

test("marker names are matched case-insensitively", () => {
  const d = confine("https://api.maptiler.com/x", `${OURS}/`, { "X-WTP-Synthetic-Run": "r1" }, {
    "x-wtp-synthetic-run": "r1",
  });
  assert.equal(Object.keys(d.headers).length, 0);
  assert.deepEqual(d.removed, ["x-wtp-synthetic-run"]);
});

test("scripts/browser.mts routes every request through confine()", async () => {
  const src = await readFile(join(process.cwd(), "scripts", "browser.mts"), "utf8");
  assert.match(
    src,
    /import \{ confine \} from "\.\.\/lib\/ops\/origin-confinement\.ts"/,
    "the harness must use the shared decision, not its own inline copy",
  );
  assert.match(
    src,
    /context\.route\("\*\*\/\*"[\s\S]{0,400}?confine\(/,
    "every request the context makes must pass through confine() — a narrower " +
      "route pattern would leave hosts unconfined",
  );
  assert.doesNotMatch(
    src,
    /delete\s+stripped\[/,
    "the inline strip was replaced by the tested function; a second copy is how they diverge",
  );
});
