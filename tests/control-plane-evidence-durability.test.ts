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

/**
 * **THE SEEDED FAILURE SUITE — THE FIRST DURABLE EVIDENCE ADAPTER.**
 *
 * `tests/control-plane-evidence.test.ts` proves the contract against a store
 * that lives in a `Map`. Every property there is a property of one process, and
 * the whole reason the evidence plane exists is that bytes must outlive the
 * session that fetched them. This suite proves the same contract against bytes
 * that reached a disk, plus the four things only a real substrate can get wrong:
 * a half-written body, a corrupted body, a key that escapes its root, and a
 * quarantined body written to a substrate that cannot hold one.
 *
 * ## THE PROCESS-DEATH PROOF AVAILABLE HERE
 *
 * A test cannot kill and restart the process it is running in. What it CAN do is
 * construct a SECOND `DurableEvidenceStore` object over the same root, holding no
 * reference to the first and sharing no in-memory state with it, and read the
 * artifact back through it. That is the property that would have been false for
 * `MemoryEvidenceStore` and is true here, and it is stated as what it is rather
 * than described as "durability proven".
 *
 * ## THE CONTROLS ARE SYNTHESIZED AT RUNTIME, NEVER COMMITTED
 *
 * The same rule `tests/fixture-credentials.test.ts` established and
 * `tests/control-plane-evidence.test.ts` follows: a test that needs a
 * Google-shaped key to prove a Google-shaped key is quarantined must not put one
 * in the repository, or it trips the very guard it exists to satisfy. Every
 * credential here is assembled from fragments while the test runs.
 *
 * ## NO TEST BYTE IS WRITTEN INTO THE REPOSITORY TREE
 *
 * Every root is an `mkdtemp` directory under the OS temp dir, removed in the
 * test's own `after` hook. A durable store that wrote into `tests/` would put
 * synthesized credential material into a working tree the fixture sweep guards,
 * which is the failure this whole plane exists to prevent.
 */

/* ------------------------------------------- the synthesized controls */

const FAKE_GOOGLE_KEY = ["AI", "za"].join("") + "SyD4mQ8vX1nR7pLbT2wCzE0jHfGuY5aKs_-3xNp".slice(0, 35);

const SEEDED_PAGE =
  '<!doctype html><html><body><div class="pageContent">' +
  "<table><tr><th>Date</th><th>Meeting</th></tr>" +
  '<tr data-meeting-id="MTG-2026-0114"><td>1/14/26</td><td>Regular Session</td></tr></table>' +
  `<script>window.__BOOTSTRAP__='{"googleMapsApiKey":"${FAKE_GOOGLE_KEY}"}'</script>` +
  "</body></html>";

/** An ordinary civic page. Nothing to redact, so it stays RAW and is durable. */
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

/** A fresh temp root, removed when the test that asked for it finishes. */
async function makeRoot(t: TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "wtp-evidence-"));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  return root;
}

/** Every file under a directory, recursively, as absolute paths. */
async function everyFile(directory: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await everyFile(full)));
    else found.push(full);
  }
  return found;
}

/**
 * SWEEP AN ENTIRE DIRECTORY TREE FOR A CREDENTIAL VALUE.
 *
 * Not "check the key we expected it not to be at" — the whole point of the
 * `RESTRICTED_RAW` refusal is that the bytes reach NO part of this substrate, and
 * a check aimed at one path would pass while a temp file, a sidecar or an orphan
 * from a partial write held the value. Read as `latin1` so a byte sequence that
 * is not valid UTF-8 is still searched rather than silently replaced.
 */
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

/* ============================================ the positive controls, first */

test("POSITIVE CONTROL: the seeded page is quarantined and the public page is not", () => {
  /*
   * Every RESTRICTED_RAW assertion below is vacuous if the scanner does not see
   * the planted key — the suite would go green because nothing was ever detected
   * and every artifact was RAW. And every durability assertion is vacuous if the
   * public page were quarantined, because it would never reach the disk at all.
   */
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

  // If this threw, every test below would be exercising a store the production
  // path refuses, and the refusal — not the durability — would be what passed.
  assert.doesNotThrow(() => assertDurable(store, "the evidence writer"));

  // A root is required and is never invented from an env var or a clock.
  assert.throws(() => new DurableEvidenceStore("  "), EvidenceStoreRefusal);
});

/* ================================ the process-death proof, such as it is */

test("DURABILITY: RAW and SANITIZED_DERIVED artifacts survive a FRESH store instance over the same root", async (t) => {
  const root = await makeRoot(t);
  const writer = new DurableEvidenceStore(root);

  const { artifact: raw } = recordAcquisition(ACQUISITION, PUBLIC_PAGE);
  const { artifact: derived, text } = deriveSanitized(raw, PUBLIC_PAGE, T_DERIVED);
  // The RAW page redacts to itself, so the derivative shares its key. Give it its
  // own work item, which is what a real second obligation would have anyway.
  const derivedOwn: Artifact = { ...derived, workItemId: "wi-000000000000000000000d02" };

  const rawPut = await putArtifact(writer, PROJECT, raw, utf8(PUBLIC_PAGE));
  const derivedPut = await putArtifact(writer, PROJECT, derivedOwn, utf8(text));
  assert.equal(rawPut.written, true);
  assert.equal(derivedPut.written, true);

  /*
   * A SECOND STORE OBJECT over the same root, holding no reference to the first
   * and sharing no in-memory state with it. This is the process-death proof
   * available without spawning: it is exactly the assertion `MemoryEvidenceStore`
   * would fail, and it is stated as what it is rather than as "durability".
   */
  const reader = new DurableEvidenceStore(root);

  const readBackRaw = await reader.get(rawPut.key);
  assert.equal(decode(readBackRaw!.bytes), PUBLIC_PAGE, "the RAW body did not survive");
  assert.equal(readBackRaw!.meta.custom?.tier, "RAW");

  const readBackDerived = await reader.get(derivedPut.key);
  assert.equal(decode(readBackDerived!.bytes), text);
  assert.equal(readBackDerived!.meta.custom?.tier, "SANITIZED_DERIVED");

  // `head` returns metadata only after checking its body.
  const head = (await reader.head(rawPut.key))!;
  assert.equal(head.contentHash, raw.contentHash);
  assert.equal(head.byteLength, raw.byteLength);
  assert.equal(objectClassOf(head), "IMMUTABLE_BODY");

  // `list` is lexicographic, and only committed objects appear in it.
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

  /*
   * Retention is what a lifecycle sweep reads, and a sweep runs in a process that
   * did not do the writing. A policy that lived only in the writer's memory would
   * make every sweep default the body to permanent — silently extending the life
   * of bytes a licence limits.
   */
  const meta = (await new DurableEvidenceStore(root).head(key))!;
  assert.equal(meta.custom?.retentionPolicy, "LICENCE_LIMITED");
  assert.equal(meta.custom?.sourceId, ACQUISITION.sourceId);
  assert.equal(meta.custom?.workItemId, ACQUISITION.workItemId);
});

/* ============================ the immutability contract, at the provider */

test("DURABLE IMMUTABILITY: an occupied key offered different bytes or incompatible metadata is refused", async (t) => {
  const root = await makeRoot(t);
  const store = new DurableEvidenceStore(root);
  const { artifact } = recordAcquisition(ACQUISITION, PUBLIC_PAGE);
  const key = objectKey(PROJECT, artifact);
  const meta = artifactMeta(artifact);

  await store.put(key, utf8(PUBLIC_PAGE), meta);

  // Identical bytes and metadata: a proven no-op, not an error and not a rewrite.
  await store.put(key, utf8(PUBLIC_PAGE), meta);
  assert.equal((await store.list("project/")).length, 1);

  // Different bytes under the same key. Refused whether the caller updates the
  // recorded hash to match them or leaves it claiming the stored body's.
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

  // Incompatible identity metadata behind identical bytes — the same shared rule
  // the in-memory double enforces, so the two cannot come to disagree.
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

  // And through `putArtifact`, the same refusal for a same-length tampered body —
  // the case a byte-length comparison cannot see.
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

/* ================================ corruption, and the half-written write */

test("DURABLE READ: bytes that no longer hash to what was written are a FAILED READ that names the corruption", async (t) => {
  const root = await makeRoot(t);
  const store = new DurableEvidenceStore(root);
  const { artifact } = recordAcquisition(ACQUISITION, PUBLIC_PAGE);
  const { key } = await putArtifact(store, PROJECT, artifact, utf8(PUBLIC_PAGE));

  // POSITIVE CONTROL: the read works before the corruption, so the refusal below
  // is the verification firing and not the file having never been readable.
  assert.equal(decode((await store.get(key))!.bytes), PUBLIC_PAGE);

  /*
   * The seeded failure: a body replaced under its own name. A bad sector, a
   * partial restore, a sync tool, an editor. Length-preserving, because a store
   * that only compared the recorded byte length would pass this — and a parse of
   * the wrong bytes is a false claim about a government that nothing downstream
   * can detect.
   */
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

  // It is a refusal, not an empty document — a caller catching the store's own
  // refusal type still gets an error rather than a body or a zero-length read.
  assert.ok(err instanceof EvidenceStoreRefusal);

  // And `readArtifact` propagates it rather than reporting the artifact missing.
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

  /*
   * The seeded failure: the process died between the body write and the sidecar
   * write. Simulated by removing the sidecar, which leaves exactly that state on
   * disk. A store that listed bodies rather than sidecars would report this key
   * as an artifact it holds, and the next read would hand back bytes with no
   * recorded hash, no tier and therefore no readership rule.
   */
  await rm(join(root, ...key.split("/")) + SIDECAR_SUFFIX);

  assert.equal(await store.head(key), null, "an uncommitted body is reported as an object");
  assert.equal(await store.get(key), null);
  assert.deepEqual(await store.list("project/"), []);
  // The orphan body is still on disk; it is garbage, not evidence.
  assert.ok((await stat(join(root, ...key.split("/")))).isFile());

  // Re-putting the key renames over the orphan atomically and commits properly.
  assert.equal((await putArtifact(store, PROJECT, artifact, utf8(PUBLIC_PAGE))).written, true);
  assert.deepEqual(await store.list("project/"), [key]);

  /* The opposite half: a committed sidecar whose body is gone is a FAILED READ
     and says so, because something did commit and the body is not there. */
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

  /* An in-flight temp file is never mistaken for evidence, and never enlarges the
     listing — a store that listed one would report a partial write as an artifact. */
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

/* ========================================= keys, and the traversal refusal */

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

  // A refusal is a refusal, not a partial write: the root is still empty.
  assert.deepEqual(await everyFile(root), []);

  // The positive control for the guard: an ordinary key maps and stores.
  const { artifact } = recordAcquisition(ACQUISITION, PUBLIC_PAGE);
  const safe = objectKey(PROJECT, artifact);
  assert.equal(keyToRelativePath(safe).split(/[\\/]/).join("/"), safe);
  assert.equal((await putArtifact(store, PROJECT, artifact, utf8(PUBLIC_PAGE))).written, true);
});

/* ==================== RESTRICTED_RAW IS NEVER SILENTLY DURABLE-ACTIVATED */

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

  // The refusal names the missing ACTIVATION and never hints at what the body
  // contains — this message is read wherever writes are logged.
  assert.equal(err.message.includes(FAKE_GOOGLE_KEY), false);
  assert.equal(err.message.includes(FAKE_GOOGLE_KEY.slice(-16)), false);

  /*
   * THE STRONG ASSERTION: not "the expected key is absent" but "no file anywhere
   * under this root carries the value". A check aimed at one path would pass while
   * a temp file, a sidecar or an orphan from a partial write held it.
   */
  await assertTreeCarriesNoSecret(root, "the plain filesystem root after a refused restricted put");
  assert.deepEqual(await everyFile(root), []);
  assert.deepEqual(await store.list(""), []);

  // The SANITIZED derivative of the same retrieval stores normally. Refusing the
  // raw is not refusing the evidence — the readable half is durable.
  const { artifact: derived, text } = deriveSanitized(raw, SEEDED_PAGE, T_DERIVED);
  const put = await putArtifact(store, PROJECT, derived, utf8(text));
  assert.equal(put.written, true);
  await assertTreeCarriesNoSecret(root, "the filesystem root holding only the derivative");
  assert.equal(decode((await new DurableEvidenceStore(root).get(put.key))!.bytes), text);
});

test("RESTRICTED_RAW: a provider that does not DECLARE encryption and access control is refused by the same rule", async (t) => {
  const root = await makeRoot(t);
  const { artifact: raw } = recordAcquisition(ACQUISITION, SEEDED_PAGE);

  /*
   * The seam cannot be satisfied by re-wrapping a plain store in a different
   * name. Without the declarations, "has a restricted provider" would mean
   * "somebody passed an object", and the cheapest object to pass is exactly the
   * substitution this refusal exists to prevent.
   */
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

  // The quarantined body is in the provider and NOWHERE on disk.
  assert.equal(provider.size, 1);
  assert.equal(decode((await provider.get(rawPut.key))!.bytes), SEEDED_PAGE);
  await assertTreeCarriesNoSecret(root, "the filesystem root beside an activated provider");

  // The derivative is on disk and survives a fresh instance; the raw does not,
  // because it never went there. Durability of the readable half is unaffected.
  const fresh = new DurableEvidenceStore(root);
  assert.equal(decode((await fresh.get(derivedPut.key))!.bytes), text);
  assert.equal(await fresh.get(rawPut.key), null, "the quarantined body leaked to the plain root");

  // `list` over the activated store shows both; over a plain one, only the derivative.
  assert.deepEqual(await store.list("project/"), [rawPut.key, derivedPut.key].sort());
  assert.deepEqual(await fresh.list("project/"), [derivedPut.key]);

  // An AUDITOR may read the quarantined body back through the seam — answering
  // "did we really redact that" is exactly what the tier is kept for.
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

  // With NO derivative known, the parser read is a refusal by name — never the raw.
  await assert.rejects(
    () => readForParser(store, PROJECT, raw),
    RestrictedArtifactRefused,
  );
  // And a PUBLISHER — anything that puts text in front of a reader — is refused too.
  await assert.rejects(
    () => readArtifact(store, PROJECT, raw, "PUBLISHER"),
    RestrictedArtifactRefused,
  );
});

/* =========================== the derivation replays from the durable store */

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

  /*
   * A REPLAY IS A DIFFERENT PROCESS by construction — a parser fix in September
   * re-run over August's retrievals. So the manifest is read back through a store
   * object that did not write it, and the derivation is checked against the bytes
   * that are actually on the substrate rather than against anything in memory.
   */
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

  // The link resolves to the STORED bodies, both of them, on both sides.
  const storedRaw = await replay.get(objectKey(PROJECT, raw));
  const storedDerived = await replay.get(objectKey(PROJECT, derived));
  assert.equal(storedRaw!.meta.contentHash, derivation.rawHash);
  assert.equal(storedDerived!.meta.contentHash, derivation.derivedHash);
  assert.equal(
    artifactId("SANITIZED_DERIVED", derivation.derivedHash),
    derivation.derivedArtifactId,
    "the derived id is not a function of the stored bytes",
  );

  // Nothing in the persisted index carries a credential value.
  await assertTreeCarriesNoSecret(root, "the durable root holding the manifest");

  // The manifest is the one durable object that may be rebuilt in place.
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

/* ====================== A KEY SEGMENT WINDOWS REFUSES IS ENCODED ON DISK, NEVER LOST */

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

  /* The runner's host is Windows: a colon in the work-id segment failed every write (ENOENT, 2026-09-24). */
  const store = new DurableEvidenceStore(await makeRoot(t));
  const { artifact } = recordAcquisition({ ...ACQUISITION, workItemId: "discovery:meetings:az:school:central-arizona-college" }, PUBLIC_PAGE);
  const key = objectKey(PROJECT, artifact);
  assert.match(key, /discovery:meetings:az:school:central-arizona-college/, "the key keeps its exact bytes");
  assert.equal((await putArtifact(store, PROJECT, artifact, utf8(PUBLIC_PAGE))).written, true);
  assert.equal(decode((await store.get(key))?.bytes ?? new Uint8Array()), PUBLIC_PAGE, "and reads back by that key");
  assert.ok((await store.list(`project/${PROJECT}/`)).includes(key), "and lists back as that key, decoded");
  assert.doesNotMatch(keyToRelativePath(key), /:/, "while its path on disk holds no colon");
});
