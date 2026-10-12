import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import {
  artifactId,
  deriveSanitized,
  recordAcquisition,
  sha256Hex,
  type Artifact,
  type ArtifactDerivation,
} from "../lib/control-plane/evidence/artifact.ts";
import {
  DurableEvidenceStore,
  EvidenceCorrupted,
  InMemoryRestrictedProvider,
  RestrictedDurabilityUnavailable,
  SIDECAR_SUFFIX,
  UnsafeEvidenceKey,
  keyToRelativePath,
} from "../lib/control-plane/evidence/durable-store.ts";
import { RestrictedArtifactRefused } from "../lib/control-plane/evidence/artifact.ts";
import {
  EvidenceStoreRefusal,
  artifactMeta,
  assertDurable,
  buildManifest,
  manifestKey,
  objectClassOf,
  objectKey,
  putArtifact,
  putManifest,
  readArtifact,
  readForParser,
  type EvidenceManifest,
} from "../lib/control-plane/evidence/store.ts";
import { credentials, scanText } from "../lib/ops/fixture-credentials.ts";

const FAKE_GOOGLE_KEY = ["AI", "za"].join("") + "SyD4mQ8vX1nR7pLbT2wCzE0jHfGuY5aKs_-3xNp".slice(0, 35);

const SEEDED_PAGE =
  '<!doctype html><html><body><div class="pageContent">' +
  "<table><tr><th>Date</th><th>Meeting</th></tr>" +
  '<tr data-meeting-id="MTG-2026-0114"><td>1/14/26</td><td>Regular Session</td></tr></table>' +
  `<script>window.__BOOTSTRAP__='{"googleMapsApiKey":"${FAKE_GOOGLE_KEY}"}'</script>` +
  "</body></html>";

const PUBLIC_PAGE =
  '<div data-container="6dcb7f01-38a4-4f5e-9c21-0b7ae4d13c88">' +
  "<p>Regular Session — Wednesday, January 14, 2026 at 9:00 a.m.</p>" +
  '<a href="/Calendar.aspx?EID=48213&amp;page=2">Agenda</a></div>';

const PROJECT = "we-the-people";
const T_RETRIEVED = "2026-08-28T14:03:00.000Z";
const T_DERIVED = "2026-08-28T14:03:01.000Z";

const ACQUISITION = {
  canonicalUrl: "https://www.example.gov/2559/Board-of-Supervisors-Meeting-Schedule",
  retrievedAt: T_RETRIEVED,
  httpStatus: 200,
  headers: { "content-type": "text/html; charset=utf-8" },
  contentType: "text/html",
  sourceId: "legistar-insite",
  methodRouteId: "CLERK_SCHEDULE_PAGE",
  workItemId: "wi-0000000000000000000000ab",
  attemptId: "at-0000000000000000000000cd",
  permission: "ALLOWED" as const,
  transport: "REACHABLE" as const,
};

const utf8 = (s: string) => new TextEncoder().encode(s);
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

async function makeRoot(t: TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "wtp-evidence-"));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  return root;
}

async function everyFile(directory: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await everyFile(full)));
    else found.push(full);
  }
  return found;
}

async function assertTreeCarriesNoSecret(root: string, label: string): Promise<void> {
  for (const file of await everyFile(root)) {
    const text = await readFile(file, "latin1");
    assert.equal(
      text.includes(FAKE_GOOGLE_KEY),
      false,
      `${label}: ${file} carries a credential value`,
    );
    assert.equal(
      text.includes(FAKE_GOOGLE_KEY.slice(-16)),
      false,
      `${label}: ${file} carries a credential fragment`,
    );
  }
}

test("POSITIVE CONTROL: the seeded page is quarantined and the public page is not", () => {
  assert.equal(FAKE_GOOGLE_KEY.length, 39, "the control must be the real shape: AIza + 35");
  assert.deepEqual(
    credentials(scanText(SEEDED_PAGE, sha256Hex)).map((f) => f.classId),
    ["google_api_key"],
  );
  assert.deepEqual(credentials(scanText(PUBLIC_PAGE, sha256Hex)), []);

  assert.equal(recordAcquisition(ACQUISITION, SEEDED_PAGE).artifact.tier, "RESTRICTED_RAW");
  assert.equal(recordAcquisition(ACQUISITION, PUBLIC_PAGE).artifact.tier, "RAW");
});

test("POSITIVE CONTROL: the durable store declares durability and assertDurable accepts it", async (t) => {
  const root = await makeRoot(t);
  const store = new DurableEvidenceStore(root);
  assert.equal(store.durable, true);

  assert.doesNotThrow(() => assertDurable(store, "the evidence writer"));

  // A root is required and is never invented from an env var or a clock.
  assert.throws(() => new DurableEvidenceStore("  "), EvidenceStoreRefusal);
});

test("DURABILITY: RAW and SANITIZED_DERIVED artifacts survive a FRESH store instance over the same root", async (t) => {
  const root = await makeRoot(t);
  const writer = new DurableEvidenceStore(root);

  const { artifact: raw } = recordAcquisition(ACQUISITION, PUBLIC_PAGE);
  const { artifact: derived, text } = deriveSanitized(raw, PUBLIC_PAGE, T_DERIVED);
  const derivedOwn: Artifact = { ...derived, workItemId: "wi-000000000000000000000d02" };

  const rawPut = await putArtifact(writer, PROJECT, raw, utf8(PUBLIC_PAGE));
  const derivedPut = await putArtifact(writer, PROJECT, derivedOwn, utf8(text));
  assert.equal(rawPut.written, true);
  assert.equal(derivedPut.written, true);

  const reader = new DurableEvidenceStore(root);

  const readBackRaw = await reader.get(rawPut.key);
  assert.equal(decode(readBackRaw!.bytes), PUBLIC_PAGE, "the RAW body did not survive");
  assert.equal(readBackRaw!.meta.custom?.tier, "RAW");

  const readBackDerived = await reader.get(derivedPut.key);
  assert.equal(decode(readBackDerived!.bytes), text);
  assert.equal(readBackDerived!.meta.custom?.tier, "SANITIZED_DERIVED");

  const head = (await reader.head(rawPut.key))!;
  assert.equal(head.contentHash, raw.contentHash);
  assert.equal(head.byteLength, raw.byteLength);
  assert.equal(objectClassOf(head), "IMMUTABLE_BODY");

  const keys = await reader.list(`project/${PROJECT}/`);
  assert.deepEqual(keys, [...keys].sort(), "list is not in lexicographic order");
  assert.deepEqual(keys, [rawPut.key, derivedPut.key].sort());

  // An absent key is `null` — the store answering "nothing here", never throwing.
  assert.equal(await reader.get(`project/${PROJECT}/source/x/2026/08/28/wi-x/sha256-x.html`), null);
  assert.equal(await reader.head(`project/${PROJECT}/source/x/2026/08/28/wi-x/sha256-x.html`), null);
});

test("DURABILITY: the retention policy survives the round trip through a fresh instance", async (t) => {
  const root = await makeRoot(t);
  const { artifact } = recordAcquisition(
    { ...ACQUISITION, retentionPolicy: "LICENCE_LIMITED" },
    PUBLIC_PAGE,
  );
  assert.equal(artifact.retentionPolicy, "LICENCE_LIMITED", "the control was not applied");

  const { key } = await putArtifact(new DurableEvidenceStore(root), PROJECT, artifact, utf8(PUBLIC_PAGE));

  const meta = (await new DurableEvidenceStore(root).head(key))!;
  assert.equal(meta.custom?.retentionPolicy, "LICENCE_LIMITED");
  assert.equal(meta.custom?.sourceId, ACQUISITION.sourceId);
  assert.equal(meta.custom?.workItemId, ACQUISITION.workItemId);
});

test("DURABLE IMMUTABILITY: an occupied key offered different bytes or incompatible metadata is refused", async (t) => {
  const root = await makeRoot(t);
  const store = new DurableEvidenceStore(root);
  const { artifact } = recordAcquisition(ACQUISITION, PUBLIC_PAGE);
  const key = objectKey(PROJECT, artifact);
  const meta = artifactMeta(artifact);

  await store.put(key, utf8(PUBLIC_PAGE), meta);

  await store.put(key, utf8(PUBLIC_PAGE), meta);
  assert.equal((await store.list("project/")).length, 1);

  const other = `${PUBLIC_PAGE}<p>edited</p>`;
  await assert.rejects(
    () => store.put(key, utf8(other), { ...meta, contentHash: `sha256-${"a".repeat(64)}` }),
    (e: unknown) => {
      assert.ok(e instanceof EvidenceStoreRefusal);
      assert.match(e.message, /The object name IS the hash/);
      return true;
    },
  );
  await assert.rejects(
    () => store.put(key, utf8(other), meta),
    (e: unknown) => {
      assert.ok(e instanceof EvidenceStoreRefusal);
      assert.match(e.message, /The object name IS the hash/);
      return true;
    },
  );

  await assert.rejects(
    () => store.put(key, utf8(PUBLIC_PAGE), { ...meta, custom: { ...meta.custom, tier: "RESTRICTED_RAW" } }),
    RestrictedDurabilityUnavailable,
  );
  await assert.rejects(
    () =>
      store.put(key, utf8(PUBLIC_PAGE), {
        ...meta,
        custom: { ...meta.custom, retentionPolicy: "DIAGNOSTIC" },
      }),
    (e: unknown) => {
      assert.ok(e instanceof EvidenceStoreRefusal);
      assert.match(e.message, /custom\.retentionPolicy/);
      return true;
    },
  );

  const tampered = PUBLIC_PAGE.replace("Regular Session", "Special Session");
  assert.equal(tampered.length, PUBLIC_PAGE.length, "the control must defeat the length check");
  await assert.rejects(() => putArtifact(store, PROJECT, artifact, utf8(tampered)), EvidenceStoreRefusal);
  assert.equal(decode((await store.get(key))!.bytes), PUBLIC_PAGE);
});

test("DURABLE IDEMPOTENCY: two concurrent putArtifact calls leave ONE object and no error", async (t) => {
  const root = await makeRoot(t);
  const store = new DurableEvidenceStore(root);
  const { artifact } = recordAcquisition(ACQUISITION, PUBLIC_PAGE);

  const [a, b] = await Promise.all([
    putArtifact(store, PROJECT, artifact, utf8(PUBLIC_PAGE)),
    putArtifact(store, PROJECT, artifact, utf8(PUBLIC_PAGE)),
  ]);
  assert.equal(a.key, b.key);
  assert.deepEqual(await store.list("project/"), [a.key]);
  assert.equal(decode((await new DurableEvidenceStore(root).get(a.key))!.bytes), PUBLIC_PAGE);
});

test("DURABLE READ: bytes that no longer hash to what was written are a FAILED READ that names the corruption", async (t) => {
  const root = await makeRoot(t);
  const store = new DurableEvidenceStore(root);
  const { artifact } = recordAcquisition(ACQUISITION, PUBLIC_PAGE);
  const { key } = await putArtifact(store, PROJECT, artifact, utf8(PUBLIC_PAGE));

  assert.equal(decode((await store.get(key))!.bytes), PUBLIC_PAGE);

  const bodyPath = join(root, ...key.split("/"));
  const corrupted = PUBLIC_PAGE.replace("Regular Session", "Special Session");
  assert.equal(corrupted.length, PUBLIC_PAGE.length, "the corruption must defeat a length check");
  await writeFile(bodyPath, corrupted);

  const err = await store.get(key).then(() => null, (e: unknown) => e as EvidenceCorrupted);
  assert.ok(err instanceof EvidenceCorrupted);
  assert.equal(err.name, "EvidenceCorrupted");
  assert.equal(err.recordedHash, artifact.contentHash);
  assert.notEqual(err.actualHash, artifact.contentHash);
  assert.match(err.message, /FAILED READ/);

  assert.ok(err instanceof EvidenceStoreRefusal);

  await assert.rejects(() => readArtifact(store, PROJECT, artifact, "AUDITOR"), EvidenceCorrupted);
  await assert.rejects(() => store.head(key), EvidenceCorrupted);
  await assert.rejects(() => store.put(key, utf8(PUBLIC_PAGE), artifactMeta(artifact)), EvidenceCorrupted);
  await assert.rejects(() => putArtifact(store, PROJECT, artifact, utf8(PUBLIC_PAGE)), EvidenceCorrupted);
});

test("DURABLE WRITE: the sidecar is the commit point, so an interrupted write is absent rather than half-declared", async (t) => {
  const root = await makeRoot(t);
  const store = new DurableEvidenceStore(root);
  const { artifact } = recordAcquisition(ACQUISITION, PUBLIC_PAGE);
  const { key } = await putArtifact(store, PROJECT, artifact, utf8(PUBLIC_PAGE));

  await rm(join(root, ...key.split("/")) + SIDECAR_SUFFIX);

  assert.equal(await store.head(key), null, "an uncommitted body is reported as an object");
  assert.equal(await store.get(key), null);
  assert.deepEqual(await store.list("project/"), []);
  // The orphan body is still on disk; it is garbage, not evidence.
  assert.ok((await stat(join(root, ...key.split("/")))).isFile());

  assert.equal((await putArtifact(store, PROJECT, artifact, utf8(PUBLIC_PAGE))).written, true);
  assert.deepEqual(await store.list("project/"), [key]);

  await rm(join(root, ...key.split("/")));
  await assert.rejects(() => store.head(key), EvidenceStoreRefusal);
  await assert.rejects(() => store.put(key, utf8(PUBLIC_PAGE), artifactMeta(artifact)), EvidenceStoreRefusal);
  await assert.rejects(() => putArtifact(store, PROJECT, artifact, utf8(PUBLIC_PAGE)), EvidenceStoreRefusal);
  await assert.rejects(
    () => store.get(key),
    (e: unknown) => {
      assert.ok(e instanceof EvidenceStoreRefusal);
      assert.match(e.message, /never an empty document/);
      return true;
    },
  );

  await writeFile(join(root, ".wtp-evidence-tmp-deadbeef"), "half a body");
  assert.deepEqual(await store.list(""), [key], "an in-flight temp file was listed as an object");
});

test("a missing or corrupted body readback leaves no committed sidecar", async (t) => {
  for (const fault of ["missing", "corrupt"]) {
  const root = await makeRoot(t);
  const store = new DurableEvidenceStore(root);
  const { artifact } = recordAcquisition(ACQUISITION, PUBLIC_PAGE);
  const key = objectKey(PROJECT, artifact);
  // Delete the renamed body before the commit readback, simulating interrupted storage.
  const writer = store as unknown as { atomicWrite: (path: string, bytes: Uint8Array, accept: unknown) => Promise<void> };
  const original = writer.atomicWrite.bind(store);
  writer.atomicWrite = async (path, bytes, accept) => {
    await original(path, bytes, accept);
    if (!path.endsWith(SIDECAR_SUFFIX)) {
      if (fault === "missing") await rm(path);
      else await writeFile(path, PUBLIC_PAGE.replace("Regular Session", "Special Session"));
    }
  };
  await assert.rejects(() => putArtifact(store, PROJECT, artifact, utf8(PUBLIC_PAGE)), EvidenceStoreRefusal);
  assert.equal(await store.head(key), null);
  assert.equal(await store.get(key), null);
  assert.deepEqual(await store.list("project/"), []);
  }
});

test("DURABLE KEYS: a key that would escape the root is refused BY NAME, and nothing is written", async (t) => {
  const root = await makeRoot(t);
  const store = new DurableEvidenceStore(root);

  const unsafe: readonly [string, RegExp][] = [
    ["../escaped.html", /\.\.<?/],
    ["project/../../escaped.html", /\.\./],
    ["/etc/passwd", /absolute path/],
    ["C:/Windows/system32/x", /drive-letter/],
    ["project\\x\\body.html", /backslash/],
    ["project//body.html", /empty path segment/],
    ["project/./body.html", /"\."/],
    ["", /empty/],
    ["project/x/body.html.meta.json", /another key's/],
    [".wtp-evidence-tmp-x/body.html", /in-flight writes/],
  ];

  for (const [key, pattern] of unsafe) {
    assert.throws(
      () => keyToRelativePath(key),
      (e: unknown) => {
        assert.ok(e instanceof UnsafeEvidenceKey, `${JSON.stringify(key)} was not refused`);
        assert.equal(e.name, "UnsafeEvidenceKey");
        assert.match(e.message, pattern);
        return true;
      },
      JSON.stringify(key),
    );
    await assert.rejects(
      () => store.put(key, utf8("x"), { contentType: "text/plain", contentHash: "x", byteLength: 1 }),
      UnsafeEvidenceKey,
      JSON.stringify(key),
    );
  }

  assert.deepEqual(await everyFile(root), []);

  const { artifact } = recordAcquisition(ACQUISITION, PUBLIC_PAGE);
  const safe = objectKey(PROJECT, artifact);
  assert.equal(keyToRelativePath(safe).split(/[\\/]/).join("/"), safe);
  assert.equal((await putArtifact(store, PROJECT, artifact, utf8(PUBLIC_PAGE))).written, true);
});

test("RESTRICTED_RAW: a plain filesystem root refuses the quarantined body BY NAME, and no byte of it reaches the tree", async (t) => {
  const root = await makeRoot(t);
  const store = new DurableEvidenceStore(root);

  const { artifact: raw } = recordAcquisition(ACQUISITION, SEEDED_PAGE);
  assert.equal(raw.tier, "RESTRICTED_RAW");

  const err = await putArtifact(store, PROJECT, raw, utf8(SEEDED_PAGE)).then(
    () => null,
    (e: unknown) => e as RestrictedDurabilityUnavailable,
  );
  assert.ok(err instanceof RestrictedDurabilityUnavailable);
  assert.equal(err.name, "RestrictedDurabilityUnavailable");
  assert.equal(err.providerId, null);
  assert.match(err.message, /Missing activation: a RestrictedEvidenceProvider/);
  assert.match(err.message, /The tier is not weakened to fit the substrate/);

  assert.equal(err.message.includes(FAKE_GOOGLE_KEY), false);
  assert.equal(err.message.includes(FAKE_GOOGLE_KEY.slice(-16)), false);

  await assertTreeCarriesNoSecret(root, "the plain filesystem root after a refused restricted put");
  assert.deepEqual(await everyFile(root), []);
  assert.deepEqual(await store.list(""), []);

  const { artifact: derived, text } = deriveSanitized(raw, SEEDED_PAGE, T_DERIVED);
  const put = await putArtifact(store, PROJECT, derived, utf8(text));
  assert.equal(put.written, true);
  await assertTreeCarriesNoSecret(root, "the filesystem root holding only the derivative");
  assert.equal(decode((await new DurableEvidenceStore(root).get(put.key))!.bytes), text);
});

test("RESTRICTED_RAW: a provider that does not DECLARE encryption and access control is refused by the same rule", async (t) => {
  const root = await makeRoot(t);
  const { artifact: raw } = recordAcquisition(ACQUISITION, SEEDED_PAGE);

  for (const [options, expected] of [
    [{ encryptedAtRest: false }, /encryption at rest/],
    [{ accessControlled: false }, /access control/],
    [{ encryptedAtRest: false, accessControlled: false }, /encryption at rest, access control/],
  ] as const) {
    const provider = new InMemoryRestrictedProvider({ providerId: "under-declared", ...options });
    const store = new DurableEvidenceStore(root, { restricted: provider });
    const err = await putArtifact(store, PROJECT, raw, utf8(SEEDED_PAGE)).then(
      () => null,
      (e: unknown) => e as RestrictedDurabilityUnavailable,
    );
    assert.ok(err instanceof RestrictedDurabilityUnavailable);
    assert.equal(err.providerId, "under-declared");
    assert.match(err.message, expected);
    assert.equal(provider.size, 0, "the under-declared provider received the quarantined bytes");
  }

  await assertTreeCarriesNoSecret(root, "the root behind an under-declared provider");
});

test("RESTRICTED_RAW: with a declaring provider the body routes to the SEAM and never to the filesystem root", async (t) => {
  const root = await makeRoot(t);
  const provider = new InMemoryRestrictedProvider({ providerId: "test-encrypted-vault" });
  const store = new DurableEvidenceStore(root, { restricted: provider });

  const { artifact: raw } = recordAcquisition(ACQUISITION, SEEDED_PAGE);
  const { artifact: derived, text } = deriveSanitized(raw, SEEDED_PAGE, T_DERIVED);

  const rawPut = await putArtifact(store, PROJECT, raw, utf8(SEEDED_PAGE));
  const derivedPut = await putArtifact(store, PROJECT, derived, utf8(text));
  assert.equal(rawPut.written, true);
  assert.equal(derivedPut.written, true);

  assert.equal(provider.size, 1);
  assert.equal(decode((await provider.get(rawPut.key))!.bytes), SEEDED_PAGE);
  await assertTreeCarriesNoSecret(root, "the filesystem root beside an activated provider");

  const fresh = new DurableEvidenceStore(root);
  assert.equal(decode((await fresh.get(derivedPut.key))!.bytes), text);
  assert.equal(await fresh.get(rawPut.key), null, "the quarantined body leaked to the plain root");

  assert.deepEqual(await store.list("project/"), [rawPut.key, derivedPut.key].sort());
  assert.deepEqual(await fresh.list("project/"), [derivedPut.key]);

  const audit = await readArtifact(store, PROJECT, raw, "AUDITOR");
  assert.equal(audit.text, SEEDED_PAGE);
});

test("RESTRICTED_RAW: a parser reading through the DURABLE store gets the sanitized derivative, and PUBLISHER gets nothing", async (t) => {
  const root = await makeRoot(t);
  const provider = new InMemoryRestrictedProvider({ providerId: "test-encrypted-vault" });
  const store = new DurableEvidenceStore(root, { restricted: provider });

  const { artifact: raw } = recordAcquisition(ACQUISITION, SEEDED_PAGE);
  const { artifact: derived, text } = deriveSanitized(raw, SEEDED_PAGE, T_DERIVED);
  await putArtifact(store, PROJECT, raw, utf8(SEEDED_PAGE));
  await putArtifact(store, PROJECT, derived, utf8(text));

  const derivatives = new Map<string, Artifact>([[raw.id, derived]]);
  const { input, read } = await readForParser(store, PROJECT, raw, { derivatives });

  assert.equal(read.substitutedForArtifactId, raw.id, "the substitution was performed silently");
  assert.equal(input.artifactId, derived.id);
  assert.equal(input.tier, "SANITIZED_DERIVED");
  assert.equal(input.canonicalUrl, ACQUISITION.canonicalUrl, "the derivative keeps the provenance");
  assert.equal(input.text.includes(FAKE_GOOGLE_KEY), false, "the parser received a credential");
  assert.equal(credentials(scanText(input.text, sha256Hex)).length, 0);
  assert.equal((read.refusal ?? "").includes(FAKE_GOOGLE_KEY), false);

  await assert.rejects(
    () => readForParser(store, PROJECT, raw),
    RestrictedArtifactRefused,
  );
  await assert.rejects(
    () => readArtifact(store, PROJECT, raw, "PUBLISHER"),
    RestrictedArtifactRefused,
  );
});

test("DURABLE REPLAY: the manifest rebuilt from the durable store links the raw and its derivative BY HASH", async (t) => {
  const root = await makeRoot(t);
  const provider = new InMemoryRestrictedProvider({ providerId: "test-encrypted-vault" });
  const store = new DurableEvidenceStore(root, { restricted: provider });

  const { artifact: raw } = recordAcquisition(ACQUISITION, SEEDED_PAGE);
  const { artifact: derived, text } = deriveSanitized(raw, SEEDED_PAGE, T_DERIVED);
  await putArtifact(store, PROJECT, raw, utf8(SEEDED_PAGE));
  await putArtifact(store, PROJECT, derived, utf8(text));

  const key = await putManifest(
    store,
    PROJECT,
    raw,
    buildManifest(PROJECT, ACQUISITION.workItemId, [raw, derived], T_DERIVED),
  );
  assert.equal(key, manifestKey(PROJECT, raw));

  const replay = new DurableEvidenceStore(root, { restricted: provider });
  const manifest = JSON.parse(decode((await replay.get(key))!.bytes)) as EvidenceManifest;

  assert.equal(manifest.artifacts.length, 2);
  assert.equal(manifest.derivations.length, 1);
  const derivation = manifest.derivations[0] as ArtifactDerivation;

  assert.equal(derivation.rawArtifactId, raw.id);
  assert.equal(derivation.derivedArtifactId, derived.id);
  assert.equal(derivation.rawHash, raw.contentHash);
  assert.equal(derivation.derivedHash, derived.contentHash);
  assert.notEqual(derivation.rawHash, derivation.derivedHash, "a derivation that hashes to its input redacted nothing");
  assert.deepEqual(derivation.redactionsByClass, { google_api_key: 1 });
  for (const fp of derivation.fingerprints) assert.match(fp, /^[0-9a-f]{12}$/);

  const storedRaw = await replay.get(objectKey(PROJECT, raw));
  const storedDerived = await replay.get(objectKey(PROJECT, derived));
  assert.equal(storedRaw!.meta.contentHash, derivation.rawHash);
  assert.equal(storedDerived!.meta.contentHash, derivation.derivedHash);
  assert.equal(
    artifactId("SANITIZED_DERIVED", derivation.derivedHash),
    derivation.derivedArtifactId,
    "the derived id is not a function of the stored bytes",
  );

  await assertTreeCarriesNoSecret(root, "the durable root holding the manifest");

  const rebuilt = await putManifest(
    store,
    PROJECT,
    raw,
    buildManifest(PROJECT, ACQUISITION.workItemId, [raw], "2026-08-29T00:00:00.000Z"),
  );
  assert.equal(rebuilt, key);
  const after = JSON.parse(decode((await new DurableEvidenceStore(root).get(key))!.bytes)) as EvidenceManifest;
  assert.equal(after.artifacts.length, 1, "the durable index did not rebuild in place");
  assert.equal(objectClassOf((await new DurableEvidenceStore(root).head(key))!), "MUTABLE_INDEX");
});

test("A key segment Windows cannot hold is encoded on disk and listed back exactly; every legal segment keeps its path", async (t) => {
  const { encodePathSegment, decodePathSegment } = await import("../lib/control-plane/evidence/durable-store.ts");
  for (const legal of ["wi-0000000000000000000000ab", "api.wikimedia.org", "2026", "sha256-abc.html", "discovery-meetings-az_city_x-1a2b3c4d"]) {
    assert.equal(encodePathSegment(legal), legal, `${legal} is legal on every host and must not move`);
  }
  for (const unsafe of ["discovery:meetings:az:school:x", 'a<b>c"d|e?f*g', "100%", "trailing.", "trailing ", "tab\there"]) {
    const encoded = encodePathSegment(unsafe);
    assert.doesNotMatch(encoded, /[<>:"|?*\u0001-\u001f]|[. ]$/, `${JSON.stringify(encoded)} is still not a legal Windows segment`);
    assert.equal(decodePathSegment(encoded), unsafe, "the encoding reverses");
  }

  // A colon is invalid in a Windows path segment.
  const store = new DurableEvidenceStore(await makeRoot(t));
  const { artifact } = recordAcquisition({ ...ACQUISITION, workItemId: "discovery:meetings:az:school:central-arizona-college" }, PUBLIC_PAGE);
  const key = objectKey(PROJECT, artifact);
  assert.match(key, /discovery:meetings:az:school:central-arizona-college/, "the key keeps its exact bytes");
  assert.equal((await putArtifact(store, PROJECT, artifact, utf8(PUBLIC_PAGE))).written, true);
  assert.equal(decode((await store.get(key))?.bytes ?? new Uint8Array()), PUBLIC_PAGE, "and reads back by that key");
  assert.ok((await store.list(`project/${PROJECT}/`)).includes(key), "and lists back as that key, decoded");
  assert.doesNotMatch(keyToRelativePath(key), /:/, "while its path on disk holds no colon");
});
