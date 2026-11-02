import test from "node:test";
import assert from "node:assert/strict";
import {
  findSecrets,
  loadSecrets,
  redactSecrets,
} from "../lib/ops/secret-redaction.ts";

const SECRETS = [
  { name: "CENSUS_API_KEY", value: "aaaabbbbccccddddeeeeffff00001111222233ab" },
  { name: "DATABASE_URL", value: "postgresql://user:s3cr3tpassw0rdlong@host.example/neondb" },
  { name: "NEXT_PUBLIC_MAPTILER_KEY", value: "pk12345678901234567890" },
];

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
  const secrets = [{ name: "TOKEN", value: "abc+def/ghi=jklmnop" }];
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

test("the sweep opens saved values and also protects the former browser key", async () => {
  const secrets = await loadSecrets({
    list: async () => SECRETS,
    read: async name => SECRETS.find(row => row.name === name)?.value,
  });
  assert.deepEqual(secrets, SECRETS);
  assert.equal(findSecrets("style.json", SECRETS[2].value, secrets)[0].secretName, "NEXT_PUBLIC_MAPTILER_KEY");
});
