/**
 * THE EVIDENCE PLANE, PART TWO — THE VAULT.
 *
 * ## Why an interface and not an implementation
 *
 * The durable store is object storage: S3, R2, B2, Netlify Blobs, anything with
 * `put`/`get`/`head`/`list` over an immutable key space. Which one is an
 * operational decision that will be made, remade and migrated. What must NOT
 * change with it is the key shape, the immutability rule and the access rule,
 * because those are what make an artifact citable and what keep a quarantined
 * body away from a parser.
 *
 * So the provider is an interface with exactly the four verbs every candidate
 * has, and everything the control plane relies on lives above it. A migration
 * then changes one class and no rule.
 *
 * ## THE KEY SHAPE IS PART OF THE DESIGN
 *
 *     project/<project>/source/<sourceId>/<yyyy>/<mm>/<dd>/<workItemId>/<contentHash>.<ext>
 *
 * Every segment earns its place, and the ORDER is the load-bearing part:
 *
 *   - `project` first, so one bucket can hold more than one project and a
 *     lifecycle rule or a deletion can be scoped to one without a scan.
 *   - `source` next, because a licence, a retention limit and a takedown all
 *     arrive per publisher. `list("project/x/source/legistar/")` is the answer
 *     to "what do we hold from this source", with no index to fall out of date.
 *   - the date, split into three segments, because storage lifecycle rules are
 *     prefix rules. `RESTRICTED_SHORT` expiry is a prefix policy or it is a
 *     cron job that eventually stops running.
 *   - `workItemId`, so the evidence for one obligation is contiguous and a
 *     replay reads one prefix.
 *   - `contentHash` as the OBJECT NAME, which makes the key space immutable by
 *     construction. **A key that could hold two different bodies over its life
 *     is a citation that stops being true without saying so.**
 *
 * The `.<ext>` suffix is a courtesy to humans and to content sniffing; the hash
 * is the identity.
 *
 * ## WHAT THE KEY SHAPE ACTUALLY GUARANTEES, STATED EXACTLY
 *
 * This comment used to read *"the same bytes always land on the same key, so a
 * re-run overwrites nothing and duplicates nothing"*. The first half is true
 * only WITHIN one scope and the second half was a global-deduplication claim the
 * key shape does not make. Five of the seven segments above are scope, not
 * content, so identical bytes retrieved for two work items, from two sources, or
 * on two days land on THREE DIFFERENT KEYS. Leaving the stronger claim in place
 * would have had a later session reason from it — "the hash is the key, so this
 * body is stored once" — and build a retention sweep, a takedown or a
 * deduplication pass on a property nothing enforces.
 *
 * The guarantee, entire:
 *
 *     IMMUTABILITY AND CONTENT IDENTITY WITHIN THE SCOPED OBJECT NAMESPACE.
 *     One key holds one body for the whole of its life. A key is never reused
 *     for different content, and a re-run that produces the same bytes for the
 *     same project, source, day and work item writes nothing new. DUPLICATE
 *     BODIES ACROSS WORK-ITEM, SOURCE AND DATE PREFIXES ARE PERMITTED, ON
 *     PURPOSE.
 *
 * That is the property a citation actually needs: the key a claim cites resolves
 * to the bytes it cited, forever. It is enforced — `putArtifact` recomputes the
 * hash of the offered bytes and refuses a key that already holds an incompatible
 * object — rather than merely described.
 *
 * **The duplication is bought deliberately.** A global `hash -> body` space would
 * store each body once and would cost every prefix rule above: a per-source
 * takedown becomes a full scan, `RESTRICTED_SHORT` expiry stops being a storage
 * lifecycle rule and becomes a cron job that eventually stops running, a
 * per-obligation replay stops being one contiguous read, and deleting one work
 * item's evidence risks deleting bytes another work item still cites. Evidence
 * bodies are small, prefix rules are what actually enforce retention, and a
 * duplicate body is the cheapest thing in this design.
 *
 * ## THE MANIFEST IS A MUTABLE INDEX, AND SAYS SO IN THE METADATA
 *
 * A `manifest.json` sits beside the bodies at the work-item prefix. It is the
 * per-obligation index — which artifacts, which tiers, which derivations — so
 * that a replay does not have to reconstruct relationships by listing and
 * guessing. It is REBUILT whenever the work item gains an artifact, so it is the
 * one object in the namespace that legitimately changes.
 *
 * That exemption is DECLARED (`ObjectMeta.objectClass`), not inferred from the
 * fact that its `contentHash` happens not to look like a `sha256-` value. A rule
 * that reads "anything whose hash is not sha256-shaped may be overwritten" is a
 * rule that lets any body through the moment a caller writes a malformed hash,
 * and it would be doing so at the exact point the immutability check is the last
 * thing standing. The default when nothing is declared is `IMMUTABLE_BODY`:
 * silence fails closed.
 *
 * ## `MemoryEvidenceStore` IS A TEST DOUBLE AND SAYS SO
 *
 * It is deterministic, ordered, and holds everything in a `Map`. **It provides
 * no durability of any kind.** It is here so the rules above can be tested
 * without a network, a bucket or a credential — never as a fallback a production
 * path can silently land on. `assertDurable` exists to make that unmissable.
 *
 * It is also STRICTER than the production contract, never looser. It used to be
 * a bare `Map.set`, which silently overwrote — so every test that "proved"
 * immutability proved it about a double that did not have the property. A double
 * that permits what production must refuse cannot witness the refusal; the only
 * safe direction for a test double to differ is toward refusing more.
 */

import {
  RestrictedArtifactRefused,
  parserMayRead,
  type Artifact,
  type ArtifactDerivation,
} from "./artifact.ts";
import { contentHash } from "../ids.ts";
import { issueParserInput, type ParserInput } from "./parser-boundary.ts";

/** ------------------------------------------------------ the provider */

/**
 * WHETHER THIS OBJECT MAY EVER BE REWRITTEN, DECLARED RATHER THAN GUESSED.
 *
 * Two classes and there will not be a third without a ruling, because every
 * additional mutable class is another key whose cited bytes can change.
 */
export const OBJECT_CLASSES = [
  /** Evidence. Written once, never rewritten. The default when nothing is said. */
  "IMMUTABLE_BODY",
  /**
   * A rebuilt index — today, exactly `manifest.json`. Its bytes change whenever
   * the work item gains an artifact, and nothing cites it as evidence.
   */
  "MUTABLE_INDEX",
] as const;
export type ObjectClass = (typeof OBJECT_CLASSES)[number];

export interface ObjectMeta {
  readonly contentType: string;
  readonly contentHash: string;
  readonly byteLength: number;
  /** Absent means `IMMUTABLE_BODY`. Silence fails closed, never open. */
  readonly objectClass?: ObjectClass;
  /** Small, flat, non-sensitive. **Never a credential value, ever.** */
  readonly custom?: Readonly<Record<string, string>>;
}

/** The declared class, with the fail-closed default applied in one place. */
export function objectClassOf(meta: ObjectMeta): ObjectClass {
  return meta.objectClass ?? "IMMUTABLE_BODY";
}

export interface StoredObject {
  readonly key: string;
  readonly bytes: Uint8Array;
  readonly meta: ObjectMeta;
}

/**
 * S3-compatible semantics, four verbs, no more.
 *
 * `head` returns metadata without transferring bytes — the verb an integrity
 * check and a retention sweep use, and the reason neither has to download a
 * megabyte of HTML to answer a question about it.
 */
export interface EvidenceStore {
  put(key: string, bytes: Uint8Array, meta: ObjectMeta): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  head(key: string): Promise<ObjectMeta | null>;
  /** Keys under a prefix, in lexicographic order. */
  list(prefix: string): Promise<string[]>;
}

/** ------------------------------------------------------------ keys */

const EXTENSIONS: Readonly<Record<string, string>> = {
  "text/html": "html",
  "application/xhtml+xml": "html",
  "application/json": "json",
  "text/json": "json",
  "text/plain": "txt",
  "text/csv": "csv",
  "application/pdf": "pdf",
  "application/xml": "xml",
  "text/xml": "xml",
  "application/rss+xml": "xml",
  "text/calendar": "ics",
};

/** The filename suffix for a content type. Unknown types get `bin`, never a guess. */
export function extensionFor(contentType: string): string {
  return EXTENSIONS[contentType.split(";")[0].trim().toLowerCase()] ?? "bin";
}

/** `yyyy/mm/dd` from an ISO instant, in UTC. Local time would shard by traveller. */
export function datePath(isoInstant: string): string {
  const t = Date.parse(isoInstant);
  if (Number.isNaN(t)) throw new EvidenceStoreRefusal(`retrievedAt is not an instant: ${isoInstant}`);
  const d = new Date(t);
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${d.getUTCFullYear()}/${mm}/${dd}`;
}

/** The prefix that holds every artifact for one obligation on one day. */
export function workItemPrefix(project: string, artifact: Artifact): string {
  return (
    `project/${project}/source/${artifact.sourceId}/` +
    `${datePath(artifact.retrievedAt)}/${artifact.workItemId}/`
  );
}

/** The immutable, content-addressed key for one artifact's bytes. */
export function objectKey(project: string, artifact: Artifact): string {
  if (!artifact.contentHash || !/^sha256-[0-9a-f]{64}$/.test(artifact.contentHash)) {
    throw new EvidenceStoreRefusal(
      `Artifact ${artifact.id || "<no id>"} has no usable contentHash ` +
        `(${JSON.stringify(artifact.contentHash ?? null)}). The key IS the hash, so an ` +
        "artifact without one cannot be stored, cited, deduplicated or replayed.",
    );
  }
  return (
    workItemPrefix(project, artifact) +
    `${artifact.contentHash}.${extensionFor(artifact.contentType)}`
  );
}

/** The per-obligation index that sits beside the bodies. */
export function manifestKey(project: string, artifact: Artifact): string {
  return `${workItemPrefix(project, artifact)}manifest.json`;
}

export class EvidenceStoreRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvidenceStoreRefusal";
  }
}

/** ------------------------------------------- immutability, enforced */

/**
 * WHICH `custom` FIELDS ARE IMMUTABLE IDENTITY, AND WHY EACH ONE IS.
 *
 * Two writes to one key mean "the same artifact" or they mean one of them is
 * wrong. Deciding which fields carry that meaning is the whole check, so the
 * split is stated here with a reason per entry rather than left as whatever the
 * comparison happened to iterate over.
 *
 *   - `tier` — **the dangerous one.** The tier decides WHO MAY READ THE BYTES.
 *     A second write that relabels a `RESTRICTED_RAW` key as
 *     `SANITIZED_DERIVED` hands every parser downstream the quarantined body
 *     while every record says the substitution happened. That is the PR #217
 *     class re-entering through the write path.
 *   - `sourceId` and `workItemId` — both are SEGMENTS OF THE KEY. Metadata that
 *     disagrees with the key it was written under means the key was derived from
 *     something other than this artifact, and every prefix rule that reads the
 *     key (takedown, retention, replay) is now reading a different record than
 *     the metadata describes.
 *   - `retentionPolicy` — it decides when the bytes are DESTROYED. A quiet
 *     second write either extends the life of credential-bearing material past
 *     `RESTRICTED_SHORT` or shortens the life of evidence a published claim
 *     still stands on. Neither may happen without somebody deciding it.
 *
 * **What may legitimately differ, and is therefore not compared:** `attemptId`,
 * `methodRouteId`, `retrievedAt`, `httpStatus`, `permission`, `transport`,
 * `canonicalUrl` and `retrievalUrl`. Every one of them is a fact about ONE
 * PHYSICAL EXECUTION, not about the bytes. The ladder exists precisely so a body
 * can be reached a second way; two attempts on the same UTC day (the key shards
 * to the day, not the second) that bring back identical bytes are the ladder
 * working, and refusing the second write would turn a successful re-retrieval
 * into an error. First writer wins for these, and the authoritative per-attempt
 * record is the `Artifact` in the manifest, never this metadata summary — the
 * object metadata exists so a retention sweep and an integrity check can work
 * from `head` without transferring bytes.
 *
 * **Unrecognised `custom` keys are not compared and never printed.** They are
 * not identity by construction, and a refusal message that echoed an arbitrary
 * value a future caller stashed there would be the one place in this module that
 * could print something RULING 127 forbids.
 */
export const IMMUTABLE_IDENTITY_FIELDS: readonly string[] = [
  "tier",
  "sourceId",
  "workItemId",
  "retentionPolicy",
  "extraction",
];

/** Attempt-scoped facts. Listed so the split is readable, not just the half that binds. */
export const ATTEMPT_SCOPED_FIELDS: readonly string[] = [
  "attemptId",
  "methodRouteId",
  "retrievedAt",
  "httpStatus",
  "permission",
  "transport",
  "canonicalUrl",
  "retrievalUrl",
];

export interface MetaConflict {
  /** The field that disagreed. Always one of the named sets above. */
  readonly field: string;
  readonly stored: string;
  readonly offered: string;
}

/**
 * The content type without its parameters — the form the key's extension is
 * derived from. `text/html` and `text/html; charset=utf-8` describe the same
 * bytes and produce the same key, so a charset that appears on one write and not
 * the other is not a disagreement about what was stored.
 */
function contentTypeEssence(contentType: string): string {
  return contentType.split(";")[0].trim().toLowerCase();
}

/**
 * IS THE OFFERED OBJECT THE SAME OBJECT ALREADY AT THIS KEY?
 *
 * Returns the FIRST disagreement, or `null` when the two writes mean the same
 * artifact. Checked in a fixed order so two runs report the same conflict and a
 * refusal message is reproducible.
 *
 * The class check comes first because the two classes are compared differently:
 * an immutable body is compared on its bytes' identity, a mutable index is not
 * (its whole purpose is that its bytes change). A write that tried to reclassify
 * one as the other is refused before either comparison runs — that reclassifying
 * write is exactly how an evidence body would acquire permission to be rewritten.
 */
export function objectIncompatibility(
  stored: ObjectMeta,
  offered: ObjectMeta,
): MetaConflict | null {
  const storedClass = objectClassOf(stored);
  const offeredClass = objectClassOf(offered);
  if (storedClass !== offeredClass) {
    return { field: "objectClass", stored: storedClass, offered: offeredClass };
  }

  const storedType = contentTypeEssence(stored.contentType);
  const offeredType = contentTypeEssence(offered.contentType);
  if (storedType !== offeredType) {
    return { field: "contentType", stored: storedType, offered: offeredType };
  }

  // The content hash binds for BOTH classes. For a body it is the key's own
  // object name; for the manifest it is `manifest:<workItemId>`, and a manifest
  // for one obligation must not land on another obligation's index.
  if (stored.contentHash !== offered.contentHash) {
    return { field: "contentHash", stored: stored.contentHash, offered: offered.contentHash };
  }

  if (storedClass === "MUTABLE_INDEX") return null;

  if (stored.byteLength !== offered.byteLength) {
    return {
      field: "byteLength",
      stored: String(stored.byteLength),
      offered: String(offered.byteLength),
    };
  }

  for (const field of IMMUTABLE_IDENTITY_FIELDS) {
    const a = stored.custom?.[field];
    const b = offered.custom?.[field];
    if (a !== b) {
      return { field: `custom.${field}`, stored: a ?? "<absent>", offered: b ?? "<absent>" };
    }
  }

  return null;
}

/**
 * The refusal, in words, naming the field and both values.
 *
 * A refusal that said only "this key is occupied" would send the caller to look
 * for a race it did not have. The field is the whole diagnosis: `custom.tier`
 * means somebody is relabelling a quarantined body, `contentHash` means the key
 * was built from a hash the bytes do not have, `objectClass` means an evidence
 * body was offered the manifest's rewrite exemption.
 */
export function immutabilityRefusal(key: string, conflict: MetaConflict): EvidenceStoreRefusal {
  const extra =
    conflict.field === "custom.tier"
      ? " Two tiers cannot share one key: the tier decides who may read the bytes, and " +
        "the second write would change the readership of a body already cited under the first."
      : "";
  return new EvidenceStoreRefusal(
    `Key ${key} already holds an object and the offered one is not the same object: ` +
      `${conflict.field} is ${JSON.stringify(conflict.stored)} in the stored object and ` +
      `${JSON.stringify(conflict.offered)} in the offered one. An evidence key holds one ` +
      `body for the whole of its life — a key that could hold two different bodies is a ` +
      `citation that stops being true without saying so.${extra}`,
  );
}

/** Byte-for-byte, without allocating a copy or leaking timing on evidence bytes. */
export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * THE PROVIDER-LEVEL IMMUTABILITY RULE, WRITTEN ONCE.
 *
 * Every `EvidenceStore` implementation calls this from `put`, so the in-memory
 * double, the durable filesystem adapter and whatever object store replaces it
 * cannot come to disagree about what "already there" means. Returns `true` when
 * the write is a no-op (the object is already present and identical), `false`
 * when it must proceed, and THROWS when the key is occupied by something else.
 */
export function reconcileExistingObject(
  key: string,
  offeredBytes: Uint8Array,
  offeredMeta: ObjectMeta,
  stored: { readonly meta: ObjectMeta; readonly bytes?: Uint8Array } | null,
): boolean {
  if (!stored) return false;

  const conflict = objectIncompatibility(stored.meta, offeredMeta);
  if (conflict) throw immutabilityRefusal(key, conflict);

  if (objectClassOf(offeredMeta) === "MUTABLE_INDEX") return false;

  if (stored.bytes && !sameBytes(stored.bytes, offeredBytes)) {
    /*
     * Metadata that matches while the bytes do not is the case a hash comparison
     * alone cannot reach: a caller that wrote the recorded hash into the metadata
     * of bytes that do not have it. The stored body wins and the write is
     * refused, because the stored body is the one already cited.
     */
    throw new EvidenceStoreRefusal(
      `Key ${key} already holds ${stored.meta.byteLength} byte(s) recorded as ` +
        `${stored.meta.contentHash}, and the offered bytes carry identical metadata while ` +
        "differing byte-for-byte. The metadata is not the evidence; the bytes are.",
    );
  }

  return true;
}

/** ------------------------------------------------------- the manifest */

export interface EvidenceManifest {
  readonly project: string;
  readonly workItemId: string;
  readonly artifacts: readonly Artifact[];
  readonly derivations: readonly ArtifactDerivation[];
  readonly updatedAt: string;
}

/**
 * Rebuild the manifest for one work item.
 *
 * Deterministic ordering by artifact id, so two runs over the same evidence
 * produce byte-identical manifests and a diff means something changed rather
 * than that a Map iterated differently.
 */
export function buildManifest(
  project: string,
  workItemId: string,
  artifacts: readonly Artifact[],
  now: string,
): EvidenceManifest {
  const mine = artifacts.filter((a) => a.workItemId === workItemId);
  const sorted = [...mine].sort((a, b) => a.id.localeCompare(b.id));
  return {
    project,
    workItemId,
    artifacts: sorted,
    derivations: sorted.flatMap((a) => (a.derivation ? [a.derivation] : [])),
    updatedAt: now,
  };
}

/** ------------------------------------------------------------ roles */

/**
 * WHO IS ASKING. Access is decided by role and tier, never by caller identity.
 *
 * `ACQUIRER` writes the bytes and is the only role that ever holds a network
 * capability. `AUDITOR` may read a quarantined body because answering "did we
 * really redact that" is exactly what an audit is for. `PARSER` may not, and
 * `PUBLISHER` — anything that puts text in front of a reader — may not either.
 */
export const EVIDENCE_ROLES = ["ACQUIRER", "PARSER", "AUDITOR", "PUBLISHER"] as const;
export type EvidenceRole = (typeof EVIDENCE_ROLES)[number];

/** The roles cleared to read `RESTRICTED_RAW` bytes. Deliberately two. */
export const RESTRICTED_READERS: readonly EvidenceRole[] = ["ACQUIRER", "AUDITOR"];

export function mayReadTier(role: EvidenceRole, artifact: Artifact): boolean {
  // `parserMayRead` states the tier half of the rule once, in `artifact.ts`, so
  // the two modules cannot come to disagree about what a parser is entitled to.
  if (parserMayRead(artifact)) return true;
  return RESTRICTED_READERS.includes(role);
}

/** ------------------------------------------------------------ writes */

/** The object metadata for one artifact. One place, so a re-put compares like with like. */
export function artifactMeta(artifact: Artifact): ObjectMeta {
  return {
    contentType: artifact.contentType,
    contentHash: artifact.contentHash,
    byteLength: artifact.byteLength,
    objectClass: "IMMUTABLE_BODY",
    custom: {
      tier: artifact.tier,
      sourceId: artifact.sourceId,
      methodRouteId: artifact.methodRouteId,
      workItemId: artifact.workItemId,
      attemptId: artifact.attemptId,
      retentionPolicy: artifact.retentionPolicy,
      permission: artifact.permission,
      transport: artifact.transport,
      canonicalUrl: artifact.canonicalUrl,
      retrievalUrl: artifact.retrievalUrl,
      retrievedAt: artifact.retrievedAt,
      httpStatus: String(artifact.httpStatus),
      ...(artifact.extraction ? { extraction: JSON.stringify(artifact.extraction) } : {}),
    },
  };
}

/**
 * STORE ONE ARTIFACT'S BYTES AT ITS CONTENT-ADDRESSED KEY.
 *
 * Three checks, in this order, and the order is deliberate — each one produces a
 * more precise refusal than the next would.
 *
 *   1. **The offered length is the recorded length.** The cheapest disagreement
 *      to name, and naming it as a length is more useful than naming it as a
 *      hash mismatch, which is what it would otherwise become.
 *   2. **THE OFFERED BYTES ARE RE-HASHED AND MUST MATCH `artifact.contentHash`.**
 *      This function used to compare only the length and then write. The key is
 *      DERIVED from `contentHash`, so bytes that do not hash to it were stored at
 *      the address of a body they are not — and every citation of that key, every
 *      replay from it, and every integrity check that trusts the key as the hash
 *      would then be repeating a false claim THE STORE ITSELF CREATED. A length
 *      check cannot see this: two bodies of equal length are the ordinary case
 *      (an edited page, a truncated read that filled to the same size, the wrong
 *      artifact's bytes handed to the right artifact's record).
 *      `contentHash` from `lib/control-plane/ids.ts` is the one implementation of
 *      the address, imported rather than re-derived, so the check and the key
 *      cannot come to disagree about what the address is.
 *   3. **An occupied key must hold THE SAME OBJECT.** An existing key used to be
 *      treated as automatic idempotent success — `if (existing) return`, with no
 *      comparison at all — which made "idempotent" mean "whatever got there
 *      first", and made a re-put of a DIFFERENT artifact onto an occupied key
 *      report success while storing nothing. `objectIncompatibility` decides it,
 *      and the refusal names the field and both values.
 *
 * The no-op on an identical re-put is not an optimisation: re-storing under a
 * content address must be idempotent, or two workers racing the same retrieval
 * produce two writes of the same bytes and one of them is arbitrarily "the"
 * write. A genuine race can have both callers report `written: true` — both did
 * call `put`, and the provider is what makes them converge on one object. That
 * is reported honestly rather than papered over with a second read.
 */
async function requireDocumentOriginal(store: EvidenceStore, project: string, artifact: Artifact): Promise<void> {
  if (artifact.tier !== "EXTRACTED_DERIVED") return;
  const extraction = artifact.extraction;
  if (!extraction || extraction.parent.tier !== "RAW" || extraction.parent.canonicalUrl !== artifact.canonicalUrl ||
    extraction.parent.workItemId !== artifact.workItemId || !Number.isSafeInteger(extraction.pages) || extraction.pages < 1 ||
    extraction.version !== "pdf-transcription/1" || !["PDF_TEXT", "PDF_TABLES"].includes(extraction.kind)) {
    throw new EvidenceStoreRefusal("DOCUMENT_EXTRACTION_PROVENANCE_INVALID");
  }
  const parent = await store.get(objectKey(project, extraction.parent));
  if (!parent || contentHash(parent.bytes) !== extraction.parent.contentHash || parent.meta.custom?.tier !== "RAW" ||
    parent.meta.custom?.canonicalUrl !== artifact.canonicalUrl || parent.meta.custom?.sourceId !== artifact.sourceId ||
    parent.meta.custom?.workItemId !== artifact.workItemId) throw new EvidenceStoreRefusal("DOCUMENT_EXTRACTION_ORIGINAL_MISSING");
}

export async function putArtifact(
  store: EvidenceStore,
  project: string,
  artifact: Artifact,
  bytes: Uint8Array,
): Promise<{ key: string; written: boolean }> {
  const key = objectKey(project, artifact);

  await requireDocumentOriginal(store, project, artifact);

  if (bytes.byteLength !== artifact.byteLength) {
    throw new EvidenceStoreRefusal(
      `Artifact ${artifact.id} records ${artifact.byteLength} bytes and ${bytes.byteLength} ` +
        "were offered. The recorded length is part of the evidence.",
    );
  }

  const offeredHash = contentHash(bytes);
  if (offeredHash !== artifact.contentHash) {
    throw new EvidenceStoreRefusal(
      `Artifact ${artifact.id} records ${artifact.contentHash} and the offered bytes hash ` +
        `to ${offeredHash}. The key IS the hash, so storing these bytes would put them at ` +
        `the address of a body they are not, and every citation of ${key} would repeat a ` +
        "false claim this store created.",
    );
  }

  const meta = artifactMeta(artifact);
  const existing = await store.head(key);
  if (existing) {
    const conflict = objectIncompatibility(existing, meta);
    if (conflict) throw immutabilityRefusal(key, conflict);
    return { key, written: false };
  }

  await store.put(key, bytes, meta);
  return { key, written: true };
}

/**
 * WRITE THE PER-OBLIGATION INDEX. Pretty-printed so a diff is readable.
 *
 * **This is the one write in the module that is allowed to replace what is
 * already there,** and it says so in the metadata: `objectClass:
 * "MUTABLE_INDEX"`. The manifest is rebuilt every time the work item gains an
 * artifact, so an immutability rule applied to it would make the second artifact
 * of every obligation unstorable.
 *
 * The exemption is DECLARED and not inferred. Its `contentHash` is
 * `manifest:<workItemId>` rather than a `sha256-` value — it is an index of
 * bodies, not a body, and a content address for something rebuilt on every
 * change would be a new key every time and no index at all. But a rule that read
 * "not sha256-shaped, therefore rewritable" would hand the same exemption to any
 * caller that wrote a malformed hash, at exactly the moment the immutability
 * check is the last thing standing. The hash is still COMPARED, because it
 * carries the work item id: one obligation's index may not overwrite another's.
 */
export async function putManifest(
  store: EvidenceStore,
  project: string,
  representative: Artifact,
  manifest: EvidenceManifest,
): Promise<string> {
  const key = manifestKey(project, representative);
  const bytes = new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`);
  await store.put(key, bytes, {
    contentType: "application/json",
    contentHash: `manifest:${manifest.workItemId}`,
    byteLength: bytes.byteLength,
    objectClass: "MUTABLE_INDEX",
  });
  return key;
}

/** ------------------------------------------------------------- reads */

export interface ArtifactRead {
  /** The artifact whose bytes are returned — NOT necessarily the one asked for. */
  readonly artifact: Artifact;
  readonly bytes: Uint8Array;
  readonly text: string;
  /**
   * Set when a `RESTRICTED_RAW` request was answered with its derivative. The
   * substitution is REPORTED rather than performed silently: a parser output
   * attributed to the raw when it was produced from the sanitized body is an
   * attribution that cannot be replayed.
   */
  readonly substitutedForArtifactId?: string;
  /** The refusal, in words, when a substitution happened. Names no credential. */
  readonly refusal?: string;
}

export interface ReadOptions {
  /** rawArtifactId -> the sanitized derivative made from it. */
  readonly derivatives?: ReadonlyMap<string, Artifact>;
}

/**
 * READ AN ARTIFACT AS A ROLE.
 *
 * The one rule that matters: **a `PARSER` handed a `RESTRICTED_RAW` artifact is
 * refused by name.** If a sanitized derivative is known it is read instead and
 * the substitution is reported; if none exists the read throws
 * `RestrictedArtifactRefused`, which is a claim about the reader and never about
 * the record. A parser that received the quarantined body would put a live
 * third-party credential into extracted fields, log lines and summaries — the
 * PR #217 class, one layer downstream of where it was caught.
 */
export async function readArtifact(
  store: EvidenceStore,
  project: string,
  artifact: Artifact,
  asRole: EvidenceRole,
  options: ReadOptions = {},
): Promise<ArtifactRead> {
  let target = artifact;
  let substitutedFor: string | undefined;
  let refusal: string | undefined;

  if (!mayReadTier(asRole, artifact)) {
    const derivative = options.derivatives?.get(artifact.id) ?? null;
    if (!derivative) throw new RestrictedArtifactRefused(artifact.id, asRole, null);
    refusal = new RestrictedArtifactRefused(artifact.id, asRole, derivative.id).message;
    substitutedFor = artifact.id;
    target = derivative;
  }

  const key = objectKey(project, target);
  const object = await store.get(key);
  if (!object) {
    throw new EvidenceStoreRefusal(
      `Artifact ${target.id} is recorded at ${key} and the store does not hold it. ` +
        "A missing body is a failed read, never an empty document.",
    );
  }

  if (target.tier === "EXTRACTED_DERIVED") {
    if (object.meta.custom?.extraction !== JSON.stringify(target.extraction)) throw new EvidenceStoreRefusal("DOCUMENT_EXTRACTION_METADATA_MISMATCH");
    await requireDocumentOriginal(store, project, target);
  }

  return {
    artifact: target,
    bytes: object.bytes,
    text: new TextDecoder().decode(object.bytes),
    ...(substitutedFor ? { substitutedForArtifactId: substitutedFor } : {}),
    ...(refusal ? { refusal } : {}),
  };
}

/**
 * Read as a parser and get a branded `ParserInput` back.
 *
 * This is the only path from the vault into a parser. It composes the tier rule
 * with the brand from `parser-boundary.ts`, so the substitution and the
 * construction happen in one place and a caller cannot do the first without the
 * second.
 */
export async function readForParser(
  store: EvidenceStore,
  project: string,
  artifact: Artifact,
  options: ReadOptions = {},
): Promise<{ input: ParserInput; read: ArtifactRead }> {
  const read = await readArtifact(store, project, artifact, "PARSER", options);
  // `read.artifact` is already the derivative where a substitution happened, so
  // this call cannot refuse — and it is still made, because the brand is what
  // the parser signature requires and the hash check is what the brand certifies.
  const input = issueParserInput(read.artifact, read.text);
  return { input, read };
}

/** ------------------------------------------------- the test double */

/**
 * **A TEST DOUBLE. NOT PRODUCTION DURABILITY. NOT ANY DURABILITY.**
 *
 * Everything lives in one `Map` in one process and is gone when it exits. It
 * exists so the key shape, the idempotent put and the access rules can be
 * exercised without a bucket or a credential, and it is deterministic — `list`
 * sorts — so a test asserting key order asserts the design and not V8's
 * insertion order.
 *
 * `durable` is `false` and `assertDurable` reads it. A production path that
 * reaches this class fails loudly rather than appearing to store evidence.
 *
 * **IT IS STRICTER THAN PRODUCTION, NEVER LOOSER.** `put` was a bare `Map.set`:
 * it silently overwrote, so the double did not have the one property the tests
 * above it existed to prove, and every immutability assertion in the suite was
 * being made against a store that would have accepted the violation. A double
 * that permits what production must refuse cannot witness the refusal. The only
 * safe direction for a test double to differ from the contract is toward
 * refusing MORE, so this one refuses an occupied key by the same shared rule the
 * durable adapter uses.
 */
export class MemoryEvidenceStore implements EvidenceStore {
  /** Read by `assertDurable`. Always false here, and that is the point. */
  readonly durable: boolean;

  private readonly objects: Map<string, StoredObject>;

  constructor() {
    this.durable = false;
    this.objects = new Map();
  }

  async put(key: string, bytes: Uint8Array, meta: ObjectMeta): Promise<void> {
    const existing = this.objects.get(key) ?? null;
    // Shared with the durable adapter so the double and the real thing cannot
    // come to disagree about what "already there" means. Returns true when the
    // write is a proven no-op; throws, by name, when the key holds something else.
    if (reconcileExistingObject(key, bytes, meta, existing)) return;

    // A copy, so a caller mutating its buffer afterwards cannot rewrite stored
    // evidence — the one way an in-memory double diverges dangerously from a
    // real object store, where the bytes have already left the process.
    this.objects.set(key, { key, bytes: Uint8Array.from(bytes), meta });
  }

  async get(key: string): Promise<StoredObject | null> {
    const found = this.objects.get(key);
    return found ? { key, bytes: Uint8Array.from(found.bytes), meta: found.meta } : null;
  }

  async head(key: string): Promise<ObjectMeta | null> {
    return this.objects.get(key)?.meta ?? null;
  }

  async list(prefix: string): Promise<string[]> {
    return [...this.objects.keys()].filter((k) => k.startsWith(prefix)).sort();
  }

  /** Test affordance only. Never a production read path. */
  get size(): number {
    return this.objects.size;
  }
}

/** Refuse a non-durable store where evidence is actually meant to persist. */
export function assertDurable(store: EvidenceStore, context: string): void {
  if ((store as { durable?: boolean }).durable === false) {
    throw new EvidenceStoreRefusal(
      `${context} requires a durable evidence store and was handed an in-memory ` +
        "test double. Bytes written here are lost when the process exits, and " +
        "evidence that does not survive the process is not evidence.",
    );
  }
}
