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

/**
 * **THE COMMITTED-FIXTURE CREDENTIAL GUARD.** (2026-08-28, the post-cleanroom
 * shipping hotfix.)
 *
 * PR #216 built clean, bundled clean, and was stopped by Netlify's secret
 * scanner over a Google Maps browser key that Pima County's own page emitted
 * into a fixture `--record` wrote verbatim. **GitHub CI was green the whole
 * time.** That gap is what this file closes: the class now fails in the
 * ordinary gate set, minutes after the fixture is written, instead of at the
 * deploy — and it fails for the whole fixture tree rather than for the one file
 * that happened to be found first. Running the scan for the first time proved
 * why that distinction matters: a SECOND fixture,
 * `tests/fixtures/schedulepage/newlondon-calendar-2026-08.html`, carried a
 * different key of the same class, and it would have been the next red deploy.
 *
 * ## THE CONTROLS ARE SYNTHESIZED, NEVER COMMITTED
 *
 * A guard that catches a Google-style key needs a Google-style key to catch,
 * and committing one would trip the very scanner this exists to satisfy — and
 * would put a credential-shaped literal in the repository to prove that
 * credential-shaped literals do not belong in the repository.
 *
 * So every positive control is BUILT AT RUNTIME from fragments. No byte in this
 * file, or in any file it reads, matches a credential pattern. `pnpm
 * fixtures:credentials` is run over the tracked tree at the end of this suite
 * and that claim is checked rather than asserted.
 *
 * ## THE NEGATIVE CONTROLS ARE THE HALF THAT KEEPS THE GUARD USABLE
 *
 * A redactor that eats meeting ids, dates, GUIDs and pagination parameters
 * destroys the evidence it was brought in to protect, and a guard with false
 * positives is a guard somebody turns off. Both directions are asserted.
 */

const ROOT = resolve(import.meta.dirname, "..");
const sha256 = (input: string | Buffer): string => createHash("sha256").update(input).digest("hex");

/* ------------------------------------------------- the positive controls */

/**
 * A Google API browser key's exact shape — `AIza` and thirty-five more — built
 * from fragments so this file never contains one. This is the literal class
 * that stopped the deploy.
 */
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
  // The Pima capture repeats its token five times. A guard that reported five
  // separate credentials would have a reader hunting four values that do not exist.
  const token = syntheticJwt({ exp: 1790553287, iss: "https://example.test" });
  const found = credentials(scanText(`${token} ${token} ${token} ${token} ${token}`, sha256));
  assert.equal(found.length, 1);
  assert.equal(found[0].occurrences, 5);
});

/* ------------------------------------------------- the negative controls */

test("ordinary civic identifiers are NOT flagged", () => {
  /*
   * Every one of these is real material from the captured pages this guard
   * runs over. If any becomes a finding, the sanitizer will start eating the
   * public record, which is a worse failure than the one it prevents.
   */
  const benign = [
    // CivicPlus container and widget GUIDs, from the Pima capture verbatim.
    '<div id="cc5f8c90dc-b4cb-431b-90ee-10648f8df655" data-containerid="5f8c90dc-b4cb-431b-90ee-10648f8df655">',
    '<div data-widget-id="3f3edd26-cdc8-460c-8067-34de57ed5994"></div>',
    // Legistar meeting and body ids, and the pagination state that reproduces a page.
    "https://pima.legistar.com/MeetingDetail.aspx?ID=1381575&GUID=A1B2C3D4-1111-2222-3333-444455556666&Options=info",
    "/Calendar.aspx?Mode=This%20Year&Page=2&ID=138",
    // Dates, times, and a meeting's own numbering.
    "1/6/26 9 a.m. — Regular (at 5:00 p.m.) ** EventId 1823, EventItemId 1824",
    // Public analytics identifiers, which are published to every visitor by design.
    'window.googleAnalyticsTrackingId_UA="UA-204520854-137";window.googleAnalyticsTrackingId_GA4="G-27HNKRGZYX"',
    // A git SHA and a sha256 — the exact false positives that ruled shape-based
    // scanning out for `lib/ops/secret-redaction.ts`.
    "52844f7fb75f999ce2f06f0abcc1f61b70dedb25",
    sha256("any content at all"),
    // An ordinary UUID and a base64 blob that is not a JWT.
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
  /*
   * The live case, from `data/states/nj/hunt/nj-campaign-sites-press-outlet-wp-search.json`.
   * GovDelivery's `lnks.gd` wraps a public justice.gov URL in a signed token
   * whose payload carries NO RFC 7519 authentication claim. Redacting it would
   * destroy the provenance of a source link the hunt genuinely found.
   */
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

  // POSITIVE CONTROL, so the two assertions above cannot both pass by the
  // pattern simply never matching anything.
  const real = `-----BEGIN OPENSSH PRIVATE KEY-----\n${Buffer.from(sha256("k1") + sha256("k2")).toString("base64")}\n-----END OPENSSH PRIVATE KEY-----`;
  assert.equal(credentials(scanText(real, sha256)).length, 1, "a real key body must still be caught");
});

/* ------------------------------------------------------- the sanitization */

test("sanitizing replaces the credential and NOTHING else", () => {
  const before =
    "<table><tr><td>8/25/26</td><td>9:00 a.m.</td><td>Regular</td></tr></table>" +
    `<script>var k="${SYNTHETIC_GOOGLE_KEY}";var id="5f8c90dc-b4cb-431b-90ee-10648f8df655";</script>`;

  const { text, replaced, redactions } = sanitizeText(before, sha256);
  assert.equal(replaced, 1);
  assert.equal(redactions[0].classId, "google_api_key");
  assert.ok(!text.includes(SYNTHETIC_GOOGLE_KEY), "the credential survived");
  assert.ok(text.includes(REDACTION_PLACEHOLDER));
  // Everything the parser reads is byte-identical.
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

/* -------------------------------------------- the tree, as it stands today */

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
      // Named by EXACT PATH and CLASS, with the fingerprint standing in for the
      // value — RULING 127. A reader can confirm the fix without ever seeing it.
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
  // The exemption is narrow and it is checked. If the scanner's own sources
  // ever start carrying a real value, the list stops being about regex literals
  // and the exemption becomes the hole.
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

/* ------------------------------------------------------ provenance, both halves */

test("every sanitized fixture still hashes to what the record says", () => {
  /*
   * THIS IS THE DRIFT CHECK, and it earned its place the day it was written.
   *
   * The New London capture is stored LF (`.gitattributes` marks
   * `tests/fixtures/** -text` — recorded evidence is never converted), and a
   * working copy carrying CRLF instead was hashed at one point during the
   * repair. The bytes the record described were not the bytes on disk, and
   * nothing would have said so. A hash comparison says so immediately.
   */
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
    // Provenance that cannot be followed is not provenance.
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

/* --------------------------------------------- the acquisition boundary */

test("no script writes a captured page into tests/fixtures/ except through the boundary", () => {
  /*
   * **THE INSTANCE WAS ONE `writeFileSync`. THIS IS THE CLASS.**
   *
   * `scripts/learn-legistar-horizon.mts` wrote its recordings straight to disk,
   * and a live Google Maps key and a thirty-day bearer token came with them.
   * Sanitizing that one file fixes that one file; the next recorder somebody
   * writes inherits the defect unless the bare write is what fails.
   *
   * So the rule is structural: a source file that names `tests/fixtures` as a
   * write destination must reach it through `writeCapturedFixture`. Reading a
   * fixture is untouched — every test does that — and so is naming the
   * directory in order to EXCLUDE it, which `url-sweep` and `dupes` both do.
   */
  const offenders: string[] = [];

  for (const path of filesThatWouldBeCommitted({ cwd: ROOT, paths: ["scripts", "lib", "app"] })) {
    if (!/\.(?:ts|tsx|mts|mjs)$/.test(path)) continue;
    if (path === "lib/ops/fixture-captures.ts") continue; // the boundary itself

    const text = readFileSync(join(ROOT, path), "utf8");
    if (!/tests[/\\"']+.{0,4}fixtures/.test(text)) continue;

    // A write call whose argument list mentions the fixture tree.
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
  // Without this, the test above passes just as happily when its regex is wrong
  // as when the tree is clean — which is the shape RULING 62 exists to catch.
  const bare = 'writeFileSync(join(ROOT, "tests/fixtures", name), body);';
  assert.match(bare, /(?:writeFileSync|appendFileSync|createWriteStream|copyFileSync)\([^)]*fixtures[^)]*\)/);
  assert.match(bare, /tests[/\\"']+.{0,4}fixtures/);
});

/* ------------------------------------------------------------- the classes */

test("every class is anchored on a literal marker, never on entropy alone", () => {
  assert.ok(CLASSES.length >= 8, "the class list has been emptied");
  const ids = CLASSES.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, "two classes share an id");

  for (const klass of CLASSES) {
    assert.ok(klass.what.trim().length > 0, `${klass.id} does not say what it is`);
    assert.ok(!klass.pattern.global, `${klass.id} carries the g flag — lastIndex would leak between files`);
    /*
     * The anchor test. A pattern made only of character classes and quantifiers
     * is an entropy scanner wearing a class's name, and it is what
     * `lib/ops/secret-redaction.ts` correctly refuses. Every class must carry a
     * literal run — a vendor prefix or a structural marker — of at least three
     * characters.
     */
    const literals = klass.pattern.source.match(/[A-Za-z-]{3,}/g) ?? [];
    const anchors = literals.filter((l) => !/^(?:A-Za-z|Za-z|BEGIN|PRIVATE|KEY|RSA|EC|DSA|OPENSSH|PGP)$/.test(l));
    assert.ok(
      anchors.length > 0 || /BEGIN/.test(klass.pattern.source),
      `${klass.id} has no literal anchor: ${klass.pattern.source}`,
    );
  }
});
