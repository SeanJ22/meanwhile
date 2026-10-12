import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

import { SANITIZED_CAPTURES, captureFor } from "../lib/ops/fixture-captures.ts";
import {
  CLASSES,
  PATTERN_BEARING_PATHS,
  REDACTION_PLACEHOLDER,
  SANITIZER_VERSION,
  credentials,
  isCapturedFixturePath,
  sanitizeText,
  scanText,
} from "../lib/ops/fixture-credentials.ts";
import { filesThatWouldBeCommitted } from "../lib/ops/repo-files.ts";

/** Positive controls are built at runtime from fragments, so no committed byte matches a credential pattern. */

const ROOT = resolve(import.meta.dirname, "..");
const sha256 = (input: string | Buffer): string => createHash("sha256").update(input).digest("hex");

/** A Google API browser key's exact shape, built from fragments so this file never contains one. */
const SYNTHETIC_GOOGLE_KEY =
  ["AI", "za"].join("") + "SyB7dV0q2mNxKp4LrT8wCzE1jHfGuY6aQs_-9xKm".slice(0, 35);

/** A live-looking bearer JWT: registered claims in the payload, built at runtime. */
function syntheticJwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64({ alg: "RS256", typ: "at+jwt" })}.${b64(payload)}.${"S1gn4tur3".repeat(4)}`;
}

test("the incident class is caught: a Google API browser key in captured HTML", () => {
  assert.equal(SYNTHETIC_GOOGLE_KEY.length, 39, "the control must be the real shape");

  const html =
    '<div class="pageContent"><table><tr><td>1/6/26</td><td>9 a.m.</td></tr></table></div>' +
    `<script>window.__PRELOADED_STATE__='{"googleMapsApiKey":"${SYNTHETIC_GOOGLE_KEY}"}'</script>`;

  const found = credentials(scanText(html, sha256));
  assert.equal(found.length, 1, "the planted key was not caught");
  assert.equal(found[0].classId, "google_api_key");
  assert.equal(found[0].length, 39);
});

test("a bearer JWT with registered claims is caught — the Pima hcmsClientToken shape", () => {
  const token = syntheticJwt({
    nbf: 1787961287,
    exp: 1790553287,
    iss: "https://content.example.com/identity-server",
    client_id: "example:Example-guest",
    scope: ["contents.read"],
  });
  const html = `<script>window.hcmsClientToken="Bearer ${token}"</script>`;

  const found = credentials(scanText(html, sha256));
  assert.equal(found.length, 1, "a live bearer token was not caught");
  assert.equal(found[0].classId, "jwt");
});

test("the same value in five places is ONE finding with five occurrences", () => {
  const token = syntheticJwt({ exp: 1790553287, iss: "https://example.test" });
  const found = credentials(scanText(`${token} ${token} ${token} ${token} ${token}`, sha256));
  assert.equal(found.length, 1);
  assert.equal(found[0].occurrences, 5);
});

test("ordinary civic identifiers are NOT flagged", () => {
  const benign = [
    '<div id="cc5f8c90dc-b4cb-431b-90ee-10648f8df655" data-containerid="5f8c90dc-b4cb-431b-90ee-10648f8df655">',
    '<div data-widget-id="3f3edd26-cdc8-460c-8067-34de57ed5994"></div>',
    "https://pima.legistar.com/MeetingDetail.aspx?ID=1381575&GUID=A1B2C3D4-1111-2222-3333-444455556666&Options=info",
    "/Calendar.aspx?Mode=This%20Year&Page=2&ID=138",
    "1/6/26 9 a.m. — Regular (at 5:00 p.m.) ** EventId 1823, EventItemId 1824",
    'window.googleAnalyticsTrackingId_UA="UA-204520854-137";window.googleAnalyticsTrackingId_GA4="G-27HNKRGZYX"',
    "52844f7fb75f999ce2f06f0abcc1f61b70dedb25",
    sha256("any content at all"),
    "550e8400-e29b-41d4-a716-446655440000",
    Buffer.from("a perfectly ordinary sentence with no structure at all").toString("base64"),
  ];

  for (const sample of benign) {
    const found = scanText(sample, sha256);
    assert.deepEqual(
      found.map((f) => f.classId),
      [],
      `a benign public identifier was flagged: ${sample.slice(0, 60)}…`,
    );
  }
});

test("a signed LINK is a public record identifier, not a credential", () => {
  // GovDelivery's `lnks.gd` wraps a public URL in a signed token whose payload carries no RFC 7519 authentication claim.
  const link = syntheticJwt({
    bulletin_link_id: 100,
    uri: "bp2:click",
    bulletin_id: "20230127.70570821",
    url: "https://www.justice.gov/usao-nj/civil-rights-enforcement/complaint",
  });

  const all = scanText(`"url": "https://lnks.gd/l/${link}"`, sha256);
  assert.equal(all.length, 1, "the shape must still be SEEN — silence would be the defect");
  assert.equal(all[0].confirmed, false, "a signed link must not be treated as a credential");
  assert.match(all[0].note ?? "", /no RFC 7519 authentication claim/);
  assert.equal(credentials(all).length, 0);
});

test("a PEM header quoted in prose or stubbed in a test is not a private key", () => {
  // Both shapes are real: prose may name the header, while a structural test
  // placeholder uses sixty-four `x`s so no test run ever handles key material.
  const prose = "the private half is many lines beginning `-----BEGIN OPENSSH PRIVATE KEY-----`.";
  assert.equal(credentials(scanText(prose, sha256)).length, 0);

  const placeholder = `-----BEGIN OPENSSH PRIVATE KEY-----\n${"x".repeat(64)}\n-----END OPENSSH PRIVATE KEY-----`;
  const found = scanText(placeholder, sha256);
  assert.equal(credentials(found).length, 0, "a structural placeholder is not key material");
  assert.match(found[0]?.note ?? "", /placeholder/);

  const real = `-----BEGIN OPENSSH PRIVATE KEY-----\n${Buffer.from(sha256("k1") + sha256("k2")).toString("base64")}\n-----END OPENSSH PRIVATE KEY-----`;
  assert.equal(credentials(scanText(real, sha256)).length, 1, "a real key body must still be caught");
});

test("sanitizing replaces the credential and NOTHING else", () => {
  const before =
    "<table><tr><td>8/25/26</td><td>9:00 a.m.</td><td>Regular</td></tr></table>" +
    `<script>var k="${SYNTHETIC_GOOGLE_KEY}";var id="5f8c90dc-b4cb-431b-90ee-10648f8df655";</script>`;

  const { text, replaced, redactions } = sanitizeText(before, sha256);
  assert.equal(replaced, 1);
  assert.equal(redactions[0].classId, "google_api_key");
  assert.ok(!text.includes(SYNTHETIC_GOOGLE_KEY), "the credential survived");
  assert.ok(text.includes(REDACTION_PLACEHOLDER));
  assert.equal(
    text.slice(0, before.indexOf("<script>")),
    before.slice(0, before.indexOf("<script>")),
  );
  assert.ok(text.includes("5f8c90dc-b4cb-431b-90ee-10648f8df655"), "a GUID was eaten");
  assert.equal(before.length - text.length, SYNTHETIC_GOOGLE_KEY.length - REDACTION_PLACEHOLDER.length);
});

test("the placeholder is not itself a credential, and sanitizing twice is a no-op", () => {
  const once = sanitizeText(`key="${SYNTHETIC_GOOGLE_KEY}"`, sha256);
  assert.equal(scanText(once.text, sha256).length, 0, "the placeholder trips the scanner");

  const twice = sanitizeText(once.text, sha256);
  assert.equal(twice.text, once.text);
  assert.equal(twice.replaced, 0);
});

test("no finding, report or placeholder ever carries the value", () => {
  const token = syntheticJwt({ exp: 1790553287, iss: "https://example.test" });
  const findings = scanText(`Bearer ${token} and ${SYNTHETIC_GOOGLE_KEY}`, sha256);
  assert.equal(findings.length, 2);

  const serialized = JSON.stringify(findings);
  assert.ok(!serialized.includes(token), "a finding carried the JWT");
  assert.ok(!serialized.includes(SYNTHETIC_GOOGLE_KEY), "a finding carried the key");
  for (const f of findings) {
    assert.match(f.fingerprint, /^[0-9a-f]{12}$/);
  }
});

/** Every committed text file, with the binaries and over-sized files set aside. */
function committedText(): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  for (const path of filesThatWouldBeCommitted({ cwd: ROOT })) {
    const abs = join(ROOT, path);
    try {
      if (statSync(abs).size > 64 * 1024 * 1024) continue;
      const buf = readFileSync(abs);
      if (buf.subarray(0, 8192).includes(0)) continue;
      out.push({ path, text: buf.toString("utf8") });
    } catch {
      /* unreadable is not readable, and is not counted clean */
    }
  }
  return out;
}

test("NO COMMITTED FIXTURE CARRIES A KNOWN CREDENTIAL CLASS", () => {
  const files = committedText();
  assert.ok(files.length > 500, `only ${files.length} files were read — the sweep did not run`);

  const fixtures = files.filter((f) => isCapturedFixturePath(f.path));
  assert.ok(fixtures.length > 20, `only ${fixtures.length} fixtures were read`);

  const offenders: string[] = [];
  for (const { path, text } of fixtures) {
    for (const f of credentials(scanText(text, sha256))) {
      offenders.push(`${path}:${f.line} ${f.classId} fp=${f.fingerprint} n=${f.occurrences}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `captured fixtures carry credential material:\n  ${offenders.join("\n  ")}\n` +
      "Run `pnpm fixtures:credentials --sanitize`.",
  );
});

test("nothing outside the fixture tree carries one either, the scanner's own sources aside", () => {
  const offenders: string[] = [];
  for (const { path, text } of committedText()) {
    if (isCapturedFixturePath(path) || PATTERN_BEARING_PATHS.includes(path)) continue;
    for (const f of credentials(scanText(text, sha256))) {
      offenders.push(`${path}:${f.line} ${f.classId} fp=${f.fingerprint}`);
    }
  }
  assert.deepEqual(offenders, [], `credential material outside the fixture tree:\n  ${offenders.join("\n  ")}`);
});

test("the pattern-bearing files carry PATTERNS and not values", () => {
  for (const path of PATTERN_BEARING_PATHS) {
    const abs = join(ROOT, path);
    assert.ok(existsSync(abs), `${path} is exempted and does not exist`);
    assert.deepEqual(
      credentials(scanText(readFileSync(abs, "utf8"), sha256)).map((f) => f.classId),
      [],
      `${path} is on the pattern-bearing list but carries a real value`,
    );
  }
});

test("every sanitized fixture still hashes to what the record says", () => {
  const record = JSON.parse(readFileSync(join(ROOT, "data/fixtures/sanitization.json"), "utf8")) as {
    sanitizerVersion: string;
    fixtures: Record<string, { sanitizedSha256: string; rawSha256: string }>;
  };

  assert.equal(record.sanitizerVersion, SANITIZER_VERSION);
  const entries = Object.entries(record.fixtures);
  assert.ok(entries.length > 0, "the record is empty");

  for (const [path, entry] of entries) {
    const abs = join(ROOT, path);
    assert.ok(existsSync(abs), `${path} is in the record and not on disk`);
    assert.equal(
      sha256(readFileSync(abs)),
      entry.sanitizedSha256,
      `${path} has changed since it was sanitized — re-run \`pnpm fixtures:credentials --sanitize\``,
    );
    assert.notEqual(entry.rawSha256, entry.sanitizedSha256, `${path}: the raw hash records nothing`);
    assert.match(entry.rawSha256, /^[0-9a-f]{64}$/);
  }
});

test("the declared half and the generated half name the same files", () => {
  const record = JSON.parse(readFileSync(join(ROOT, "data/fixtures/sanitization.json"), "utf8")) as {
    fixtures: Record<string, unknown>;
  };

  for (const path of Object.keys(record.fixtures)) {
    const capture = captureFor(path);
    assert.ok(capture, `${path} was sanitized with no declaration in lib/ops/fixture-captures.ts`);
    assert.match(capture.sourceUrl, /^https:\/\//, `${path}: sourceUrl is not a URL`);
    assert.match(capture.capturedOn, /^\d{4}-\d{2}-\d{2}$/, `${path}: capturedOn is not a date`);
    assert.ok(capture.capturedBy.trim().length > 0, `${path}: nothing recorded WHAT captured it`);
    assert.ok(capture.provesWhat.trim().length > 0, `${path}: nothing recorded WHY it is held`);
  }

  for (const capture of SANITIZED_CAPTURES) {
    assert.ok(existsSync(join(ROOT, capture.path)), `${capture.path} is declared and does not exist`);
    assert.ok(
      capture.path in record.fixtures,
      `${capture.path} is declared as sanitized but the generated record does not name it`,
    );
  }
});

test("no script writes a captured page into tests/fixtures/ except through the boundary", () => {
  // A source file that names `tests/fixtures` as a write destination must reach it through `writeCapturedFixture`.
  const offenders: string[] = [];

  for (const path of filesThatWouldBeCommitted({ cwd: ROOT, paths: ["scripts", "lib", "app"] })) {
    if (!/\.(?:ts|tsx|mts|mjs)$/.test(path)) continue;
    if (path === "lib/ops/fixture-captures.ts") continue; // the boundary itself

    const text = readFileSync(join(ROOT, path), "utf8");
    if (!/tests[/\\"']+.{0,4}fixtures/.test(text)) continue;

    const writes = text.match(
      /(?:writeFileSync|appendFileSync|createWriteStream|copyFileSync)\([^)]*fixtures[^)]*\)/g,
    );
    if (writes && !text.includes("writeCapturedFixture")) {
      offenders.push(`${path} — ${writes.length} bare write(s) into the fixture tree`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    "these write captured pages straight to disk; route them through " +
      `writeCapturedFixture in lib/ops/fixture-captures.ts:\n  ${offenders.join("\n  ")}`,
  );
});

test("POSITIVE CONTROL: the boundary guard's own detector fires on a bare write", () => {
  const bare = 'writeFileSync(join(ROOT, "tests/fixtures", name), body);';
  assert.match(bare, /(?:writeFileSync|appendFileSync|createWriteStream|copyFileSync)\([^)]*fixtures[^)]*\)/);
  assert.match(bare, /tests[/\\"']+.{0,4}fixtures/);
});

test("every class is anchored on a literal marker, never on entropy alone", () => {
  assert.ok(CLASSES.length >= 8, "the class list has been emptied");
  const ids = CLASSES.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, "two classes share an id");

  for (const klass of CLASSES) {
    assert.ok(klass.what.trim().length > 0, `${klass.id} does not say what it is`);
    assert.ok(!klass.pattern.global, `${klass.id} carries the g flag — lastIndex would leak between files`);
    // A pattern of only character classes and quantifiers is an entropy scanner; every class needs a literal run of three or more characters.
    const literals = klass.pattern.source.match(/[A-Za-z-]{3,}/g) ?? [];
    const anchors = literals.filter((l) => !/^(?:A-Za-z|Za-z|BEGIN|PRIVATE|KEY|RSA|EC|DSA|OPENSSH|PGP)$/.test(l));
    assert.ok(
      anchors.length > 0 || /BEGIN/.test(klass.pattern.source),
      `${klass.id} has no literal anchor: ${klass.pattern.source}`,
    );
  }
});
