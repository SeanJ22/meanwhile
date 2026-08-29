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
  assertDurable,
  buildManifest,
  objectKey,
  putArtifact,
  putManifest,
  readArtifact,
  readForParser,
} from "../lib/control-plane/evidence/store.ts";
import { credentials, scanText } from "../lib/ops/fixture-credentials.ts";

/**
 * **THE SEEDED FAILURE SUITE — EVIDENCE PLANE.**
 *
 * Each test plants a failure the architecture named and asserts the exact
 * refusal that catches it. A suite that only walks the happy path proves the
 * code runs; these prove it REFUSES, which is the only property that matters
 * when a retrieval brings back something nobody expected.
 *
 * ## THE CONTROLS ARE SYNTHESIZED AT RUNTIME, NEVER COMMITTED
 *
 * `tests/fixture-credentials.test.ts` established the rule and it is followed
 * here for the same reason: a test that needs a Google-shaped key to prove a
 * Google-shaped key is quarantined must not put one in the repository, or it
 * trips the very guard it exists to satisfy. Every credential in this file is
 * assembled from fragments while the test runs. No byte of this source matches a
 * credential pattern, and the repo-wide sweep in
 * `tests/fixture-credentials.test.ts` is what checks that claim rather than
 * this comment.
 *
 * ## THE POSITIVE CONTROL IS FIRST, ON PURPOSE
 *
 * Every assertion below about quarantine, substitution and redaction is
 * worthless if the scanner simply does not see the planted credential — the
 * whole suite would go green because nothing was found. So the first test
 * asserts that the shipped `scanText` CONFIRMS both planted values. If the
 * detector breaks, this suite goes red at the top rather than passing vacuously.
 */

/* ------------------------------------------- the synthesized controls */

/**
 * The exact shape of a Google API browser key — `AIza` and thirty-five more —
 * built from fragments. This is the literal class that turned PR #216 red and
 * PR #217 into a repair.
 */
const FAKE_GOOGLE_KEY = ["AI", "za"].join("") + "SyD4mQ8vX1nR7pLbT2wCzE0jHfGuY5aKs_-3xNp".slice(0, 35);

/** A live-looking bearer JWT: registered RFC 7519 claims, assembled at runtime. */
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

/**
 * The seeded page: a real-shaped county schedule page whose PUBLISHER emits a
 * live browser key and a thirty-day bearer token into its own bootstrap JSON.
 * The key appears twice, exactly as the Pima capture repeated its token, so the
 * occurrence count is exercised rather than assumed.
 */
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

/**
 * The thrown error itself. `assert.throws` returns `undefined`, so asserting on
 * an error's own fields — the name, the role, the hashes — needs the value, and
 * a test that reached for `assert.throws`'s return value would read `undefined`
 * and pass every field check vacuously.
 */
function caught(fn: () => unknown): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  return null;
}

/** Every value that must never leave the vault, for the leak assertions. */
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

/* ============================================ the positive control, first */

test("POSITIVE CONTROL: the shipped scanner confirms both planted credentials", () => {
  // If this fails, every quarantine assertion below is vacuous — the suite would
  // be green because nothing was ever detected.
  assert.equal(FAKE_GOOGLE_KEY.length, 39, "the control must be the real shape: AIza + 35");

  const confirmed = credentials(scanText(SEEDED_PAGE, sha256Hex));
  const classes = confirmed.map((f) => f.classId).sort();
  assert.deepEqual(classes, ["google_api_key", "jwt"], "the seeded page's credentials were not detected");

  const google = confirmed.find((f) => f.classId === "google_api_key");
  assert.equal(google?.occurrences, 2, "the key appears twice in the seeded page");
  assert.match(google?.fingerprint ?? "", /^[0-9a-f]{12}$/);
});

/* ===================================== SEEDED #16 — the PR #217 incident */

test("SEEDED #16: a captured public page carrying a publisher credential is quarantined, and the parser gets the derivative", async () => {
  const store = new MemoryEvidenceStore();

  /* 1. Acquisition triage decides the tier FROM THE BYTES. */
  const { artifact: raw, classification } = recordAcquisition(ACQUISITION, SEEDED_PAGE);
  assert.equal(raw.tier, "RESTRICTED_RAW", "a page carrying a live third-party key is not RAW");
  assert.equal(classification.sanitizedDerivativeRequired, true);
  assert.equal(raw.retentionPolicy, "RESTRICTED_SHORT");
  assert.match(raw.contentHash, /^sha256-[0-9a-f]{64}$/);

  /* 2. The EXACT bytes are stored. Evidence is not thrown away to avoid a leak. */
  const rawPut = await putArtifact(store, PROJECT, raw, utf8(SEEDED_PAGE));
  assert.equal(rawPut.written, true);
  assert.equal(
    rawPut.key,
    `project/${PROJECT}/source/legistar-insite/2026/08/28/${ACQUISITION.workItemId}/${raw.contentHash}.html`,
  );
  const storedRaw = await store.get(rawPut.key);
  assert.equal(new TextDecoder().decode(storedRaw!.bytes), SEEDED_PAGE, "the raw bytes are not exact");

  /* 3. The mandatory sanitized derivative. */
  const { artifact: derived, derivation, text } = deriveSanitized(raw, SEEDED_PAGE, T_DERIVED);
  assert.equal(derived.tier, "SANITIZED_DERIVED");
  assert.equal(derived.id, artifactId("SANITIZED_DERIVED", derivation.derivedHash));
  await putArtifact(store, PROJECT, derived, utf8(text));

  /* Both hashes recorded, and they DIFFER — a derivation that hashes to its
     input redacted nothing and would be the quarantined bytes relabelled. */
  assert.equal(derivation.rawHash, raw.contentHash);
  assert.equal(derivation.derivedHash, derived.contentHash);
  assert.notEqual(derivation.rawHash, derivation.derivedHash);
  assert.deepEqual(derivation.redactionsByClass, { google_api_key: 2, jwt: 1 });
  assert.equal(derivation.distinctValuesRedacted, 2);
  assert.equal(derivation.substringsReplaced, 3);
  assert.equal(derivation.fingerprints.length, 2);
  for (const fp of derivation.fingerprints) assert.match(fp, /^[0-9a-f]{12}$/);

  /* The record the parser reads keeps the public record byte-for-byte. */
  assert.ok(text.includes('data-meeting-id="MTG-2026-0114"'));
  assert.ok(text.includes("7f3b1c2e-90ab-4d15-8e64-1b0c9a2d4f77"));
  assert.equal(credentials(scanText(text, sha256Hex)).length, 0, "the derivative still carries a credential");

  /* 4. THE PARSER RECEIVES THE DERIVATIVE, and the substitution is reported. */
  const derivatives = new Map<string, Artifact>([[raw.id, derived]]);
  const { input, read } = await readForParser(store, PROJECT, raw, { derivatives });
  assert.equal(read.substitutedForArtifactId, raw.id);
  assert.equal(read.artifact.id, derived.id);
  assert.equal(input.artifactId, derived.id);
  assert.equal(input.tier, "SANITIZED_DERIVED");
  assert.equal(input.canonicalUrl, ACQUISITION.canonicalUrl, "the derivative keeps the raw's provenance");
  assert.equal(input.attemptId, ACQUISITION.attemptId);
  assert.ok(isParserInput(input));

  /* 5. NO CREDENTIAL VALUE ANYWHERE OUTSIDE THE QUARANTINED BODY. */
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

  /* And the quarantined body IS still there, which is the half a "delete it"
     reading of the incident would have lost. */
  assert.ok(new TextDecoder().decode((await store.get(rawPut.key))!.bytes).includes(FAKE_GOOGLE_KEY));
});

/* ==================================== SEEDED #7 — the capability boundary */

test("SEEDED #7: a parser that attempts network access is denied by the capability boundary", () => {
  const err = caught(() => assertNoNetwork(["evidence.read", "net.http", "cpu.parse"], "PARSER"));
  assert.ok(err instanceof NetworkAccessDenied);
  assert.equal(err.name, "NetworkAccessDenied");
  assert.equal(err.role, "PARSER");
  assert.deepEqual(err.capabilities, ["net.http"]);

  // A parser holding only vault capabilities runs.
  const artifact = recordAcquisition(
    { ...ACQUISITION, contentType: "text/plain" },
    "Regular Session 1/14/26",
  ).artifact;
  const input = issueParserInput(artifact, "Regular Session 1/14/26");
  assert.equal(runParser(input, ["evidence.read"], (i) => i.text.length), 23);

  // The same parser, granted the network, is refused BEFORE it runs — the grant
  // is the defect, not the call, so a fetch behind a rare branch is still caught.
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
  // A caller that fetched a page live and attached the artifact's metadata to it.
  const err = caught(() => issueParserInput(artifact, "a body fetched from the network just now"));
  assert.ok(err instanceof NotVaultIssued);
  assert.equal(err.name, "NotVaultIssued");
  assert.equal(err.expectedHash, artifact.contentHash);
  assert.notEqual(err.actualHash, artifact.contentHash);

  // And a hand-built object literal is not a ParserInput, because the brand is
  // a module-private symbol and cannot be named from out here.
  assert.equal(isParserInput({ artifactId: artifact.id, text: "forged" }), false);
});

/* ================================================== replay determinism */

test("EVIDENCE REPLAY: the same raw bytes re-derive to the same hash and the same counts", () => {
  const { artifact: raw } = recordAcquisition(ACQUISITION, SEEDED_PAGE);

  const first = deriveSanitized(raw, SEEDED_PAGE, T_DERIVED);
  // A different derivation moment, which must change nothing but the stamp.
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

/* ================================================ the refusals, by name */

test("a RESTRICTED_RAW artifact handed to a PARSER role is refused BY NAME", async () => {
  const store = new MemoryEvidenceStore();
  const { artifact: raw } = recordAcquisition(ACQUISITION, SEEDED_PAGE);
  await putArtifact(store, PROJECT, raw, utf8(SEEDED_PAGE));

  await assert.rejects(() => readArtifact(store, PROJECT, raw, "PARSER"), RestrictedArtifactRefused);

  // The refusal names ITSELF, the artifact and the role — never the contents.
  // "You may not read this" and "this does not exist" are opposite claims, and a
  // refusal that could be mistaken for the second turns policy into an absence.
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

  // A PUBLISHER — anything that puts text in front of a reader — is refused too.
  await assert.rejects(() => readArtifact(store, PROJECT, raw, "PUBLISHER"), RestrictedArtifactRefused);

  // An AUDITOR may read it: answering "did we really redact that" is the job.
  const auditorRead = await readArtifact(store, PROJECT, raw, "AUDITOR");
  assert.equal(auditorRead.text, SEEDED_PAGE);

  // The ACQUIRER that wrote it may still read it back to verify what it stored.
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

/* ============================================== the negative controls */

test("ordinary civic content is NOT redacted and stays RAW", () => {
  /*
   * A redactor that eats meeting ids, dates, GUIDs and pagination parameters
   * destroys the evidence it was brought in to protect. This is the shipped
   * `CLASSES` list being asked the question, not a re-implementation of it.
   */
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

  // And a RAW artifact reaches a parser unaltered — no derivative, no detour.
  const input = issueParserInput(artifact, page);
  assert.equal(input.text, page);
});

test("nothing the scanner set aside is dropped silently — the preserved half is carried", () => {
  /*
   * A GovDelivery signed link decodes to a payload whose entire content is a
   * public URL. It is a PUBLIC RECORD IDENTIFIER the hunt genuinely found, and
   * redacting it would destroy the provenance of a source link to protect
   * nothing. It must be preserved AND it must be reported, with the reason.
   */
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

  // Carried through into the derivation record, not dropped.
  const { artifact } = recordAcquisition(ACQUISITION, page);
  const { derivation } = deriveSanitized(artifact, page, T_DERIVED);
  assert.equal(derivation.preserved.length, 1);
  assert.equal(derivation.substringsReplaced, 0);
  assert.deepEqual(derivation.redactionsByClass, {});
});

/* ========================================================= the key shape */

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

  // The raw and the derivative are two distinct objects, and neither key could
  // ever be reused for different bytes.
  assert.notEqual(objectKey(PROJECT, raw), objectKey(PROJECT, derived));

  // The put is idempotent under a content address: a re-run overwrites nothing.
  const again = await putArtifact(store, PROJECT, raw, utf8(SEEDED_PAGE));
  assert.equal(again.written, false);
  assert.equal(store.size, 3);
});

test("a read of an artifact the store does not hold is a FAILED read, never an empty document", async () => {
  const store = new MemoryEvidenceStore();
  const { artifact } = recordAcquisition({ ...ACQUISITION, contentType: "text/plain" }, "unstored");
  await assert.rejects(() => readArtifact(store, PROJECT, artifact, "AUDITOR"), EvidenceStoreRefusal);
});
