import assert from "node:assert/strict";
import test from "node:test";

import {
  ArtifactContract,
  RestrictedArtifactRefused,
  artifactId,
  classifyAcquisition,
  deriveSanitized,
  recordAcquisition,
  sha256Hex,
  type Artifact,
} from "../lib/control-plane/evidence/artifact.ts";
import {
  NetworkAccessDenied,
  NotVaultIssued,
  assertNoNetwork,
  isNetworkCapability,
  isParserInput,
  issueParserInput,
  runParser,
} from "../lib/control-plane/evidence/parser-boundary.ts";
import {
  EvidenceStoreRefusal,
  MemoryEvidenceStore,
  artifactMeta,
  assertDurable,
  buildManifest,
  objectClassOf,
  objectIncompatibility,
  objectKey,
  putArtifact,
  putManifest,
  readArtifact,
  readForParser,
  workItemPrefix,
} from "../lib/control-plane/evidence/store.ts";
import { credentials, scanText } from "../lib/ops/fixture-credentials.ts";

const FAKE_GOOGLE_KEY = ["AI", "za"].join("") + "SyD4mQ8vX1nR7pLbT2wCzE0jHfGuY5aKs_-3xNp".slice(0, 35);

function fakeJwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  return `${b64({ alg: "RS256", typ: "at+jwt" })}.${b64(payload)}.${"Sy8nTh3t1c".repeat(4)}`;
}

const FAKE_BEARER = fakeJwt({
  nbf: 1787961287,
  exp: 1790553287,
  iss: "https://content.example.test/identity-server",
  client_id: "example:Example-guest",
  scope: ["contents.read"],
});

const SEEDED_PAGE =
  '<!doctype html><html><head><title>Board of Supervisors Meeting Schedule</title></head><body>' +
  '<div class="pageContent" data-container="7f3b1c2e-90ab-4d15-8e64-1b0c9a2d4f77">' +
  "<table><tr><th>Date</th><th>Time</th><th>Meeting</th></tr>" +
  '<tr data-meeting-id="MTG-2026-0114"><td>1/14/26</td><td>9:00 a.m.</td><td>Regular Session</td></tr>' +
  '<tr data-meeting-id="MTG-2026-0128"><td>1/28/26</td><td>9:00 a.m.</td><td>Regular Session</td></tr>' +
  "</table></div>" +
  `<script>window.__BOOTSTRAP__='{"googleMapsApiKey":"${FAKE_GOOGLE_KEY}","tiles":"https://maps.example.test/v1?key=${FAKE_GOOGLE_KEY}"}'</script>` +
  `<script>window.hcmsClientToken="Bearer ${FAKE_BEARER}"</script>` +
  "</body></html>";

const PROJECT = "we-the-people";
const T_RETRIEVED = "2026-08-28T14:03:00.000Z";
const T_DERIVED = "2026-08-28T14:03:01.000Z";

const ACQUISITION = {
  canonicalUrl: "https://www.example.gov/2559/Board-of-Supervisors-Meeting-Schedule",
  retrievalUrl: "https://www.example.gov/2559/Board-of-Supervisors-Meeting-Schedule?print=1",
  retrievedAt: T_RETRIEVED,
  httpStatus: 200,
  headers: { "content-type": "text/html; charset=utf-8", server: "example" },
  contentType: "text/html",
  sourceId: "legistar-insite",
  methodRouteId: "CLERK_SCHEDULE_PAGE",
  workItemId: "wi-0000000000000000000000ab",
  attemptId: "at-0000000000000000000000cd",
  permission: "ALLOWED" as const,
  transport: "REACHABLE" as const,
};

const utf8 = (s: string) => new TextEncoder().encode(s);

function caught(fn: () => unknown): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  return null;
}

const SECRETS = [FAKE_GOOGLE_KEY, FAKE_BEARER];

function assertCarriesNoSecret(label: string, subject: unknown): void {
  const text = typeof subject === "string" ? subject : JSON.stringify(subject);
  for (const secret of SECRETS) {
    assert.equal(
      text.includes(secret),
      false,
      `${label} carries a credential value. RULING 127: the fingerprint, the class, the ` +
        "length and the line are what may be printed; the value never is.",
    );
    // The tail alone is enough to be a leak, and a naive truncation would pass
    // the full-string check while publishing most of the key.
    assert.equal(text.includes(secret.slice(-16)), false, `${label} carries a credential fragment`);
  }
}

test("POSITIVE CONTROL: the shipped scanner confirms both planted credentials", () => {
  assert.equal(FAKE_GOOGLE_KEY.length, 39, "the control must be the real shape: AIza + 35");

  const confirmed = credentials(scanText(SEEDED_PAGE, sha256Hex));
  const classes = confirmed.map((f) => f.classId).sort();
  assert.deepEqual(classes, ["google_api_key", "jwt"], "the seeded page's credentials were not detected");

  const google = confirmed.find((f) => f.classId === "google_api_key");
  assert.equal(google?.occurrences, 2, "the key appears twice in the seeded page");
  assert.match(google?.fingerprint ?? "", /^[0-9a-f]{12}$/);
});

test("SEEDED #16: a captured public page carrying a publisher credential is quarantined, and the parser gets the derivative", async () => {
  const store = new MemoryEvidenceStore();

  const { artifact: raw, classification } = recordAcquisition(ACQUISITION, SEEDED_PAGE);
  assert.equal(raw.tier, "RESTRICTED_RAW", "a page carrying a live third-party key is not RAW");
  assert.equal(classification.sanitizedDerivativeRequired, true);
  assert.equal(raw.retentionPolicy, "RESTRICTED_SHORT");
  assert.match(raw.contentHash, /^sha256-[0-9a-f]{64}$/);

  const rawPut = await putArtifact(store, PROJECT, raw, utf8(SEEDED_PAGE));
  assert.equal(rawPut.written, true);
  assert.equal(
    rawPut.key,
    `project/${PROJECT}/source/legistar-insite/2026/08/28/${ACQUISITION.workItemId}/${raw.contentHash}.html`,
  );
  const storedRaw = await store.get(rawPut.key);
  assert.equal(new TextDecoder().decode(storedRaw!.bytes), SEEDED_PAGE, "the raw bytes are not exact");

  const { artifact: derived, derivation, text } = deriveSanitized(raw, SEEDED_PAGE, T_DERIVED);
  assert.equal(derived.tier, "SANITIZED_DERIVED");
  assert.equal(derived.id, artifactId("SANITIZED_DERIVED", derivation.derivedHash));
  await putArtifact(store, PROJECT, derived, utf8(text));

  assert.equal(derivation.rawHash, raw.contentHash);
  assert.equal(derivation.derivedHash, derived.contentHash);
  assert.notEqual(derivation.rawHash, derivation.derivedHash);
  assert.deepEqual(derivation.redactionsByClass, { google_api_key: 2, jwt: 1 });
  assert.equal(derivation.distinctValuesRedacted, 2);
  assert.equal(derivation.substringsReplaced, 3);
  assert.equal(derivation.fingerprints.length, 2);
  for (const fp of derivation.fingerprints) assert.match(fp, /^[0-9a-f]{12}$/);

  assert.ok(text.includes('data-meeting-id="MTG-2026-0114"'));
  assert.ok(text.includes("7f3b1c2e-90ab-4d15-8e64-1b0c9a2d4f77"));
  assert.equal(credentials(scanText(text, sha256Hex)).length, 0, "the derivative still carries a credential");

  const derivatives = new Map<string, Artifact>([[raw.id, derived]]);
  const { input, read } = await readForParser(store, PROJECT, raw, { derivatives });
  assert.equal(read.substitutedForArtifactId, raw.id);
  assert.equal(read.artifact.id, derived.id);
  assert.equal(input.artifactId, derived.id);
  assert.equal(input.tier, "SANITIZED_DERIVED");
  assert.equal(input.canonicalUrl, ACQUISITION.canonicalUrl, "the derivative keeps the raw's provenance");
  assert.equal(input.attemptId, ACQUISITION.attemptId);
  assert.ok(isParserInput(input));

  const manifest = buildManifest(PROJECT, ACQUISITION.workItemId, [raw, derived], T_DERIVED);
  const manifestPath = await putManifest(store, PROJECT, raw, manifest);
  const manifestBytes = await store.get(manifestPath);

  assertCarriesNoSecret("the raw artifact record", raw);
  assertCarriesNoSecret("the derived artifact record", derived);
  assertCarriesNoSecret("the derivation record", derivation);
  assertCarriesNoSecret("the manifest", manifest);
  assertCarriesNoSecret("the stored manifest bytes", new TextDecoder().decode(manifestBytes!.bytes));
  assertCarriesNoSecret("the raw object metadata", (await store.head(rawPut.key))!);
  assertCarriesNoSecret("the substitution refusal message", read.refusal ?? "");
  assertCarriesNoSecret("the bytes issued to the parser", input.text);
  assertCarriesNoSecret(
    "the refusal error message",
    new RestrictedArtifactRefused(raw.id, "PARSER", derived.id).message,
  );

  assert.ok(new TextDecoder().decode((await store.get(rawPut.key))!.bytes).includes(FAKE_GOOGLE_KEY));
});

test("SEEDED #7: a parser that attempts network access is denied by the capability boundary", () => {
  const err = caught(() => assertNoNetwork(["evidence.read", "net.http", "cpu.parse"], "PARSER"));
  assert.ok(err instanceof NetworkAccessDenied);
  assert.equal(err.name, "NetworkAccessDenied");
  assert.equal(err.role, "PARSER");
  assert.deepEqual(err.capabilities, ["net.http"]);

  const artifact = recordAcquisition(
    { ...ACQUISITION, contentType: "text/plain" },
    "Regular Session 1/14/26",
  ).artifact;
  const input = issueParserInput(artifact, "Regular Session 1/14/26");
  assert.equal(runParser(input, ["evidence.read"], (i) => i.text.length), 23);

  assert.throws(
    () => runParser(input, ["evidence.read", "browser.navigate"], (i) => i.text.length),
    NetworkAccessDenied,
  );

  // Prefix-matched, so a capability nobody has enumerated yet still fails closed.
  assert.equal(isNetworkCapability("net.http3"), true);
  assert.equal(isNetworkCapability("proxy.residential"), true);
  assert.equal(isNetworkCapability("playwright"), true);
  assert.equal(isNetworkCapability("evidence.read"), false);
  assert.equal(isNetworkCapability("fs.read"), false);
});

test("SEEDED #7: bytes that did not come from the vault cannot become a ParserInput", () => {
  const { artifact } = recordAcquisition(ACQUISITION, "the stored body");
  const err = caught(() => issueParserInput(artifact, "a body fetched from the network just now"));
  assert.ok(err instanceof NotVaultIssued);
  assert.equal(err.name, "NotVaultIssued");
  assert.equal(err.expectedHash, artifact.contentHash);
  assert.notEqual(err.actualHash, artifact.contentHash);

  // And a hand-built object literal is not a ParserInput, because the brand is
  // a module-private symbol and cannot be named from out here.
  assert.equal(isParserInput({ artifactId: artifact.id, text: "forged" }), false);
});

test("EVIDENCE REPLAY: the same raw bytes re-derive to the same hash and the same counts", () => {
  const { artifact: raw } = recordAcquisition(ACQUISITION, SEEDED_PAGE);

  const first = deriveSanitized(raw, SEEDED_PAGE, T_DERIVED);
  const second = deriveSanitized(raw, SEEDED_PAGE, "2027-01-01T00:00:00.000Z");

  assert.equal(first.derivation.derivedHash, second.derivation.derivedHash);
  assert.equal(first.artifact.id, second.artifact.id, "the derived id is a function of the bytes");
  assert.equal(first.text, second.text);
  assert.deepEqual(first.derivation.redactionsByClass, second.derivation.redactionsByClass);
  assert.deepEqual(first.derivation.fingerprints, second.derivation.fingerprints);
  assert.equal(first.derivation.sanitizerVersion, second.derivation.sanitizerVersion);
  assert.notEqual(first.derivation.derivedAt, second.derivation.derivedAt);

  // Ids are content-addressed, so a re-acquisition of an unchanged page lands on
  // the same key rather than duplicating the evidence.
  assert.equal(recordAcquisition(ACQUISITION, SEEDED_PAGE).artifact.id, raw.id);
});

test("a RESTRICTED_RAW artifact handed to a PARSER role is refused BY NAME", async () => {
  const store = new MemoryEvidenceStore();
  const { artifact: raw } = recordAcquisition(ACQUISITION, SEEDED_PAGE);
  await putArtifact(store, PROJECT, raw, utf8(SEEDED_PAGE));

  await assert.rejects(() => readArtifact(store, PROJECT, raw, "PARSER"), RestrictedArtifactRefused);

  const caught = await readArtifact(store, PROJECT, raw, "PARSER").then(
    () => null,
    (e: unknown) => e as RestrictedArtifactRefused,
  );
  assert.equal(caught?.name, "RestrictedArtifactRefused");
  assert.equal(caught?.artifactId, raw.id);
  assert.equal(caught?.role, "PARSER");
  assert.equal(caught?.sanitizedDerivativeId, null);
  assert.match(caught?.message ?? "", /RESTRICTED_RAW/);
  assertCarriesNoSecret("the bare refusal message", caught?.message ?? "");

  await assert.rejects(() => readArtifact(store, PROJECT, raw, "PUBLISHER"), RestrictedArtifactRefused);

  const auditorRead = await readArtifact(store, PROJECT, raw, "AUDITOR");
  assert.equal(auditorRead.text, SEEDED_PAGE);

  const acquirerRead = await readArtifact(store, PROJECT, raw, "ACQUIRER");
  assert.equal(acquirerRead.text, SEEDED_PAGE);
  assert.equal(acquirerRead.substitutedForArtifactId, undefined);
});

test("an artifact with no contentHash cannot be stored", async () => {
  const store = new MemoryEvidenceStore();
  const { artifact } = recordAcquisition(ACQUISITION, SEEDED_PAGE);

  for (const bad of ["", "   ", "deadbeef", "sha256-not-hex"]) {
    const broken = { ...artifact, contentHash: bad } as Artifact;
    assert.throws(() => objectKey(PROJECT, broken), EvidenceStoreRefusal, `contentHash ${JSON.stringify(bad)}`);
    await assert.rejects(
      () => putArtifact(store, PROJECT, broken, utf8(SEEDED_PAGE)),
      EvidenceStoreRefusal,
    );
  }
  assert.equal(store.size, 0, "nothing may reach the store without a content address");
});

test("a byte-length that disagrees with the artifact is refused", async () => {
  const store = new MemoryEvidenceStore();
  const { artifact } = recordAcquisition(ACQUISITION, SEEDED_PAGE);
  await assert.rejects(
    () => putArtifact(store, PROJECT, artifact, utf8(SEEDED_PAGE.slice(0, 100))),
    EvidenceStoreRefusal,
  );
});

test("deriving from a derivative, or from bytes that are not the artifact's, is refused", () => {
  const { artifact: raw } = recordAcquisition(ACQUISITION, SEEDED_PAGE);
  const { artifact: derived } = deriveSanitized(raw, SEEDED_PAGE, T_DERIVED);

  assert.throws(() => deriveSanitized(derived, "anything", T_DERIVED), ArtifactContract);
  assert.throws(() => deriveSanitized(raw, `${SEEDED_PAGE} `, T_DERIVED), (e: unknown) => {
    assert.ok(e instanceof ArtifactContract);
    assert.match(e.message, /hash to/);
    return true;
  });
});

test("the in-memory store refuses to stand in for durability", () => {
  assert.throws(
    () => assertDurable(new MemoryEvidenceStore(), "the evidence writer"),
    EvidenceStoreRefusal,
  );
});

test("ordinary civic content is NOT redacted and stays RAW", () => {
  const page =
    '<div data-container="6dcb7f01-38a4-4f5e-9c21-0b7ae4d13c88">' +
    "<p>Regular Session — Wednesday, January 14, 2026 at 9:00 a.m.</p>" +
    '<a href="/Calendar.aspx?EID=48213&amp;page=2">Agenda</a>' +
    "<span>Ordinance 2026-014</span><span>Resolution 2026-0421</span>" +
    "<code>commit 4f9a1c7d2b8e35a06c1d9f4e7b2a8c05d3e6f107</code>" +
    "<span>Parcel 117-23-0140</span><span>MTG-2026-0114</span></div>";

  const classification = classifyAcquisition(page);
  assert.equal(classification.tier, "RAW");
  assert.equal(classification.sanitizedDerivativeRequired, false);
  assert.deepEqual(classification.confirmed, []);
  assert.deepEqual(classification.findings, [], "an ordinary civic page produced a finding");

  const { artifact } = recordAcquisition(ACQUISITION, page);
  assert.equal(artifact.tier, "RAW");
  assert.equal(artifact.retentionPolicy, "EVIDENCE_PERMANENT");

  const input = issueParserInput(artifact, page);
  assert.equal(input.text, page);
});

test("nothing the scanner set aside is dropped silently — the preserved half is carried", () => {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const signedLink =
    `${b64({ alg: "HS256" })}.${b64({ bulletin_link_id: 118273, uri: "https://example.gov/x", bulletin_id: 44 })}.` +
    "Sy8nTh3t1cSy8nTh3t1c";
  const page = `<a href="https://lnks.example/l/${signedLink}">notice</a><p>Meeting 1/14/26</p>`;

  const classification = classifyAcquisition(page);
  assert.equal(classification.tier, "RAW", "a signed public link is not a credential");
  assert.equal(classification.findings.length, 1);
  assert.equal(classification.findings[0].confirmed, false);
  assert.match(classification.findings[0].note ?? "", /not a credential/);

  const { artifact } = recordAcquisition(ACQUISITION, page);
  const { derivation } = deriveSanitized(artifact, page, T_DERIVED);
  assert.equal(derivation.preserved.length, 1);
  assert.equal(derivation.substringsReplaced, 0);
  assert.deepEqual(derivation.redactionsByClass, {});
});

test("the object key is content-addressed, source-scoped and date-sharded", async () => {
  const store = new MemoryEvidenceStore();
  const { artifact: raw } = recordAcquisition(ACQUISITION, SEEDED_PAGE);
  const { artifact: derived, text } = deriveSanitized(raw, SEEDED_PAGE, T_DERIVED);

  await putArtifact(store, PROJECT, raw, utf8(SEEDED_PAGE));
  await putArtifact(store, PROJECT, derived, utf8(text));
  await putManifest(store, PROJECT, raw, buildManifest(PROJECT, ACQUISITION.workItemId, [raw, derived], T_DERIVED));

  const keys = await store.list(`project/${PROJECT}/source/legistar-insite/`);
  assert.equal(keys.length, 3);
  for (const k of keys) {
    assert.match(k, new RegExp(`^project/${PROJECT}/source/legistar-insite/2026/08/28/wi-[0-9a-f]+/`));
  }
  assert.ok(keys.some((k) => k.endsWith("/manifest.json")));

  assert.notEqual(objectKey(PROJECT, raw), objectKey(PROJECT, derived));

  const again = await putArtifact(store, PROJECT, raw, utf8(SEEDED_PAGE));
  assert.equal(again.written, false);
  assert.equal(store.size, 3);
});

test("a read of an artifact the store does not hold is a FAILED read, never an empty document", async () => {
  const store = new MemoryEvidenceStore();
  const { artifact } = recordAcquisition({ ...ACQUISITION, contentType: "text/plain" }, "unstored");
  await assert.rejects(() => readArtifact(store, PROJECT, artifact, "AUDITOR"), EvidenceStoreRefusal);
});

const TAMPERED_PAGE = SEEDED_PAGE.replace("Regular Session", "Special Session");

test("POSITIVE CONTROL: the tampered page is byte-length-identical and hash-different", () => {
  // Without this, the refusal below could be the LENGTH guard firing and the hash
  // recomputation could be absent entirely while the suite stayed green.
  assert.equal(
    Buffer.byteLength(TAMPERED_PAGE, "utf8"),
    Buffer.byteLength(SEEDED_PAGE, "utf8"),
    "the tampered control must defeat the length check, or it tests the wrong guard",
  );
  assert.notEqual(TAMPERED_PAGE, SEEDED_PAGE);
});

test("IMMUTABILITY: bytes that do not hash to the artifact's contentHash are refused at the store boundary", async () => {
  const store = new MemoryEvidenceStore();
  const { artifact } = recordAcquisition(ACQUISITION, SEEDED_PAGE);

  const err = await putArtifact(store, PROJECT, artifact, utf8(TAMPERED_PAGE)).then(
    () => null,
    (e: unknown) => e as EvidenceStoreRefusal,
  );
  assert.ok(err instanceof EvidenceStoreRefusal);
  assert.equal(err.name, "EvidenceStoreRefusal");
  assert.match(err.message, /hash to sha256-[0-9a-f]{64}/);
  assert.match(err.message, /The key IS the hash/);
  assert.equal(store.size, 0, "bytes that do not hash to their address reached the store");

  const ok = await putArtifact(store, PROJECT, artifact, utf8(SEEDED_PAGE));
  assert.equal(ok.written, true);
  assert.equal(store.size, 1);
});

test("IMMUTABILITY: an occupied key must hold the SAME object, and the refusal names the field", async () => {
  const store = new MemoryEvidenceStore();
  const page =
    '<div data-container="6dcb7f01-38a4-4f5e-9c21-0b7ae4d13c88">' +
    "<p>Regular Session — Wednesday, January 14, 2026 at 9:00 a.m.</p></div>";

  const { artifact: raw } = recordAcquisition(ACQUISITION, page);
  const { artifact: derived, text } = deriveSanitized(raw, page, T_DERIVED);
  assert.equal(raw.tier, "RAW");
  assert.equal(derived.tier, "SANITIZED_DERIVED");
  assert.equal(derived.contentHash, raw.contentHash, "nothing was redacted, so the bytes are equal");
  assert.equal(objectKey(PROJECT, derived), objectKey(PROJECT, raw), "one key, two tiers");

  await putArtifact(store, PROJECT, raw, utf8(page));

  const err = await putArtifact(store, PROJECT, derived, utf8(text)).then(
    () => null,
    (e: unknown) => e as EvidenceStoreRefusal,
  );
  assert.ok(err instanceof EvidenceStoreRefusal);
  assert.match(err.message, /custom\.tier/);
  assert.match(err.message, /"RAW"/);
  assert.match(err.message, /"SANITIZED_DERIVED"/);
  assert.match(err.message, /decides who may read/);
  assert.equal(store.size, 1, "the second write neither stored nor relabelled");

  assert.equal((await store.head(objectKey(PROJECT, raw)))?.custom?.tier, "RAW");
});

test("IMMUTABILITY: the identity split is exactly the four fields, and attempt-scoped facts may differ", async () => {
  const store = new MemoryEvidenceStore();
  const { artifact } = recordAcquisition(ACQUISITION, SEEDED_PAGE);
  await putArtifact(store, PROJECT, artifact, utf8(SEEDED_PAGE));

  const second: Artifact = {
    ...artifact,
    attemptId: "at-0000000000000000000099ff",
    methodRouteId: "CLERK_SCHEDULE_PRINT_VIEW",
    retrievedAt: "2026-08-28T21:44:00.000Z",
    httpStatus: 203,
    transport: "REACHABLE",
  };
  const again = await putArtifact(store, PROJECT, second, utf8(SEEDED_PAGE));
  assert.equal(again.written, false, "a second attempt bringing back identical bytes is idempotent");
  assert.equal(store.size, 1);

  const meta = (await store.head(again.key))!;
  assert.equal(meta.custom?.attemptId, ACQUISITION.attemptId);

  for (const [field, value] of [
    ["tier", "SANITIZED_DERIVED"],
    ["sourceId", "some-other-publisher"],
    ["workItemId", "wi-0000000000000000000000ff"],
    ["retentionPolicy", "DIAGNOSTIC"],
  ] as const) {
    const conflict = objectIncompatibility(meta, {
      ...meta,
      custom: { ...meta.custom, [field]: value },
    });
    assert.equal(conflict?.field, `custom.${field}`, `${field} is not being compared`);
    assert.equal(conflict?.offered, value);
  }

  // The negative control: an attempt-scoped field is NOT a conflict.
  for (const field of ["attemptId", "methodRouteId", "retrievedAt", "httpStatus", "transport"]) {
    assert.equal(
      objectIncompatibility(meta, { ...meta, custom: { ...meta.custom, [field]: "changed" } }),
      null,
      `${field} is attempt-scoped and must not refuse a re-retrieval`,
    );
  }

  // A charset parameter is not a disagreement about what was stored.
  assert.equal(
    objectIncompatibility(meta, { ...meta, contentType: "text/html; charset=utf-8" }),
    null,
  );
  assert.equal(objectIncompatibility(meta, { ...meta, contentType: "application/pdf" })?.field, "contentType");
});

test("IDEMPOTENCY: two concurrent putArtifact calls for the same artifact leave ONE object and no error", async () => {
  const store = new MemoryEvidenceStore();
  const { artifact } = recordAcquisition(ACQUISITION, SEEDED_PAGE);

  const [a, b] = await Promise.all([
    putArtifact(store, PROJECT, artifact, utf8(SEEDED_PAGE)),
    putArtifact(store, PROJECT, artifact, utf8(SEEDED_PAGE)),
  ]);

  assert.equal(a.key, b.key);
  assert.equal(store.size, 1, "a race produced two objects");
  const stored = await store.get(a.key);
  assert.equal(new TextDecoder().decode(stored!.bytes), SEEDED_PAGE);

  assert.equal((await putArtifact(store, PROJECT, artifact, utf8(SEEDED_PAGE))).written, false);
});

test("IDEMPOTENCY: the same key offered incompatible bytes or metadata is refused at the PROVIDER, not only the helper", async () => {
  const store = new MemoryEvidenceStore();
  const { artifact } = recordAcquisition(ACQUISITION, SEEDED_PAGE);
  const key = objectKey(PROJECT, artifact);
  const meta = artifactMeta(artifact);

  await store.put(key, utf8(SEEDED_PAGE), meta);

  await store.put(key, utf8(SEEDED_PAGE), meta);
  assert.equal(store.size, 1);

  const err = await store
    .put(key, utf8(TAMPERED_PAGE), meta)
    .then(() => null, (e: unknown) => e as EvidenceStoreRefusal);
  assert.ok(err instanceof EvidenceStoreRefusal);
  assert.match(err.message, /The metadata is not the evidence; the bytes are/);

  await assert.rejects(
    () => store.put(key, utf8(SEEDED_PAGE), { ...meta, custom: { ...meta.custom, tier: "RAW" } }),
    EvidenceStoreRefusal,
  );

  assert.equal(new TextDecoder().decode((await store.get(key))!.bytes), SEEDED_PAGE);
});

test("THE MANIFEST: a rebuilt index overwrites in place, and the exemption is declared rather than inferred from the hash format", async () => {
  const store = new MemoryEvidenceStore();
  const { artifact: raw } = recordAcquisition(ACQUISITION, SEEDED_PAGE);
  const { artifact: derived, text } = deriveSanitized(raw, SEEDED_PAGE, T_DERIVED);

  await putArtifact(store, PROJECT, raw, utf8(SEEDED_PAGE));
  const first = buildManifest(PROJECT, ACQUISITION.workItemId, [raw], T_DERIVED);
  const key = await putManifest(store, PROJECT, raw, first);

  const meta = (await store.head(key))!;
  assert.equal(objectClassOf(meta), "MUTABLE_INDEX");
  assert.equal(meta.contentHash, `manifest:${ACQUISITION.workItemId}`);

  await putArtifact(store, PROJECT, derived, utf8(text));
  const second = buildManifest(PROJECT, ACQUISITION.workItemId, [raw, derived], T_DERIVED);
  assert.equal(await putManifest(store, PROJECT, raw, second), key);

  const rebuilt = JSON.parse(new TextDecoder().decode((await store.get(key))!.bytes)) as {
    artifacts: readonly { id: string }[];
  };
  assert.equal(rebuilt.artifacts.length, 2, "the rebuilt index did not replace the first one");
  assert.equal(store.size, 3, "the rebuild created a second index object");

  const bodyKey = objectKey(PROJECT, raw);
  await assert.rejects(
    () =>
      store.put(bodyKey, utf8(SEEDED_PAGE), {
        ...artifactMeta(raw),
        objectClass: "MUTABLE_INDEX",
      }),
    (e: unknown) => {
      assert.ok(e instanceof EvidenceStoreRefusal);
      assert.match(e.message, /objectClass/);
      return true;
    },
  );

  await assert.rejects(
    () =>
      store.put(key, utf8("{}"), {
        contentType: "application/json",
        contentHash: "manifest:wi-000000000000000000000099",
        byteLength: 2,
        objectClass: "MUTABLE_INDEX",
      }),
    (e: unknown) => {
      assert.ok(e instanceof EvidenceStoreRefusal);
      assert.match(e.message, /contentHash/);
      return true;
    },
  );

  /* Silence fails CLOSED: metadata with no declared class is an immutable body. */
  assert.equal(objectClassOf({ contentType: "text/html", contentHash: "x", byteLength: 1 }), "IMMUTABLE_BODY");
});

test("KEY SEMANTICS: identical bytes under two work items are two DISTINCT keys, and each key is individually immutable", async () => {
  const store = new MemoryEvidenceStore();
  const page = "<p>Regular Session — Wednesday, January 14, 2026 at 9:00 a.m.</p>";

  const one = recordAcquisition(
    { ...ACQUISITION, workItemId: "wi-000000000000000000000a01" },
    page,
  ).artifact;
  const two = recordAcquisition(
    { ...ACQUISITION, workItemId: "wi-000000000000000000000b02" },
    page,
  ).artifact;
  const otherSource = recordAcquisition({ ...ACQUISITION, sourceId: "granicus" }, page).artifact;
  const otherDay = recordAcquisition(
    { ...ACQUISITION, retrievedAt: "2026-08-29T14:03:00.000Z" },
    page,
  ).artifact;

  // Identical bytes, therefore an identical artifact id — content identity holds.
  assert.equal(one.contentHash, two.contentHash);
  assert.equal(one.id, two.id, "the artifact id is a function of tier and bytes");

  // And FOUR distinct keys, because the scope is in the key and the scope differs.
  const keys = [one, two, otherSource, otherDay].map((a) => objectKey(PROJECT, a));
  assert.equal(new Set(keys).size, 4, "the key scoping is not doing what the header now claims");
  assert.notEqual(workItemPrefix(PROJECT, one), workItemPrefix(PROJECT, two));

  for (const artifact of [one, two, otherSource, otherDay]) {
    assert.equal((await putArtifact(store, PROJECT, artifact, utf8(page))).written, true);
  }
  assert.equal(store.size, 4, "duplicate bodies across prefixes are permitted, on purpose");

  assert.equal((await store.list(`project/${PROJECT}/source/granicus/`)).length, 1);
  assert.equal((await store.list(workItemPrefix(PROJECT, one))).length, 1);

  for (const artifact of [one, two, otherSource, otherDay]) {
    assert.equal((await putArtifact(store, PROJECT, artifact, utf8(page))).written, false);
    await assert.rejects(
      () =>
        store.put(objectKey(PROJECT, artifact), utf8(`${page} `), {
          ...artifactMeta(artifact),
          byteLength: page.length + 1,
        }),
      EvidenceStoreRefusal,
    );
  }
  assert.equal(store.size, 4);
});
