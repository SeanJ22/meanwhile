import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { filesThatWouldBeCommitted } from "../lib/ops/repo-files.ts";
import {
  MIN_SECRET_LENGTH,
  findSecrets,
  isPublishedByDesign,
  loadSecrets,
  parseSecrets,
  redactSecrets,
} from "../lib/ops/secret-redaction.ts";

/** Matching is by value, never by shape: a 40-hex key looks like every git SHA in the repository. */
const ROOT = resolve(import.meta.dirname, "..");

/** A fake env, so this test never depends on the real one being present. */
const FAKE_ENV = [
  "# a comment line",
  "CENSUS_API_KEY=aaaabbbbccccddddeeeeffff00001111222233ab",
  "WTP_DB_ROLE=local",
  'DATABASE_URL="postgresql://user:s3cr3tpassw0rdlong@host.example/neondb"',
  "NEXT_PUBLIC_MAPTILER_KEY=pk12345678901234567890",
  "SHORT=abc",
].join("\n");

const SECRETS = parseSecrets(FAKE_ENV);

test("parsing takes long values, skips comments, and drops short configuration", () => {
  const names = SECRETS.map((s) => s.name).sort();
  assert.deepEqual(names, ["CENSUS_API_KEY", "DATABASE_URL", "NEXT_PUBLIC_MAPTILER_KEY"]);
  // WTP_DB_ROLE=local is a "credential" in the ledger's sense and is five
  // characters. Redacting the word "local" out of every output would destroy
  // far more than it protected.
  assert.equal(SECRETS.some((s) => s.name === "WTP_DB_ROLE"), false);
  assert.ok(MIN_SECRET_LENGTH >= 8, "the floor must be high enough to exclude ordinary words");
});

test("THE ACTUAL LEAK CHANNEL: a key inside a URL curl echoed back is redacted", () => {
  const curlOutput =
    "status=200 redirects=0 " +
    "final=https://api.census.gov/data/2023/acs/acs5?get=NAME,B01003_001E" +
    "&for=zip%20code%20tabulation%20area:07866&key=aaaabbbbccccddddeeeeffff00001111222233ab" +
    " bytes=84";

  const redacted = redactSecrets(curlOutput, SECRETS);
  assert.ok(
    !redacted.includes("aaaabbbbccccddddeeeeffff00001111222233ab"),
    "the key survived redaction inside a URL — this is exactly how it leaked",
  );
  assert.match(redacted, /<REDACTED:CENSUS_API_KEY>/);
  // Everything else must survive: the diagnostic value of the line is the point.
  assert.match(redacted, /status=200/);
  assert.match(redacted, /api\.census\.gov/);
});

test("a percent-encoded value is redacted too", () => {
  const secrets = parseSecrets("TOKEN=abc+def/ghi=jklmnop");
  const line = `POST ?token=${encodeURIComponent("abc+def/ghi=jklmnop")}`;
  const redacted = redactSecrets(line, secrets);
  assert.ok(!redacted.includes(encodeURIComponent("abc+def/ghi=jklmnop")));
  assert.match(redacted, /<REDACTED:TOKEN>/);
});

test("a connection string is redacted whole, not left half-recognisable", () => {
  const line = 'psql "postgresql://user:s3cr3tpassw0rdlong@host.example/neondb" -c "select 1"';
  const redacted = redactSecrets(line, SECRETS);
  assert.ok(!redacted.includes("s3cr3tpassw0rdlong"), "the password survived");
  assert.match(redacted, /<REDACTED:DATABASE_URL>/);
});

test("the placeholder names WHICH credential, so the line stays diagnostic", () => {
  const redacted = redactSecrets("key=aaaabbbbccccddddeeeeffff00001111222233ab", SECRETS);
  assert.equal(redacted, "key=<REDACTED:CENSUS_API_KEY>");
});

test("findSecrets reports the credential, the count and the line numbers", () => {
  const text = [
    "line one is clean",
    "key=aaaabbbbccccddddeeeeffff00001111222233ab",
    "clean again",
    "twice: aaaabbbbccccddddeeeeffff00001111222233ab aaaabbbbccccddddeeeeffff00001111222233ab",
  ].join("\n");
  const hits = findSecrets("x.md", text, SECRETS);
  const census = hits.find((h) => h.secretName === "CENSUS_API_KEY");
  assert.ok(census, "the sweep missed a plain occurrence");
  assert.equal(census.occurrences, 3);
  assert.deepEqual(census.lines, [2, 4], "a report with no line numbers makes a scrub a hunt");
});

test("NEXT_PUBLIC_* is published by design and is set aside by PREFIX, never by a hand-list", () => {
  assert.equal(isPublishedByDesign("NEXT_PUBLIC_MAPTILER_KEY"), true);
  assert.equal(isPublishedByDesign("CENSUS_API_KEY"), false);
  assert.equal(isPublishedByDesign("DATABASE_URL"), false);
  assert.equal(isPublishedByDesign("WTP_PRODUCTION_DATABASE_URL_WRITE"), false);
});

/** Skipped with a named reason when `.env.local` is absent (CI). */
test("no real credential value appears anywhere in the repository", () => {
  const envPath = join(ROOT, ".env.local");
  if (!existsSync(envPath)) {
    console.log(
      "secret-redaction · REPOSITORY SWEEP DID NOT RUN — no .env.local on this machine. This is a skip, not a pass. Run `pnpm secrets:sweep` locally.",
    );
    return;
  }
  const secrets = loadSecrets(envPath).filter((s) => !isPublishedByDesign(s.name));
  assert.ok(secrets.length > 0, "no non-public secrets parsed — this sweep would pass vacuously");

  // Files that WOULD BE COMMITTED — tracked AND untracked. A credential pasted
  // in and not yet staged is exactly the case this must catch, and a
  // tracked-only listing cannot see it.
  const files = filesThatWouldBeCommitted({ cwd: ROOT }).filter((f) => !f.startsWith(".env"));

  assert.ok(files.length > 100, `only ${files.length} files listed — the sweep would report clean without looking`);

  const found: string[] = [];
  for (const rel of files) {
    let text: string;
    try {
      text = readFileSync(join(ROOT, rel), "utf8");
    } catch {
      continue;
    }
    for (const h of findSecrets(rel, text, secrets)) {
      found.push(`${h.secretName} in ${h.file} line ${h.lines[0]}`);
    }
  }

  assert.deepEqual(
    found,
    [],
    `a credential value is committed in this repository — it is in git history too, so rotation is mandatory: ${found.join("; ")}`,
  );
});
