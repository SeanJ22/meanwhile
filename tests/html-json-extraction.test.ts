import assert from "node:assert/strict";
import test from "node:test";
import { extractEmbeddedHtml } from "../lib/extract/text-layer.ts";
import { artifactId, deriveSanitized, recordAcquisition, sha256Hex, type Artifact } from "../lib/control-plane/evidence/artifact.ts";
import { issueParserInput } from "../lib/control-plane/evidence/parser-boundary.ts";
import { MemoryEvidenceStore, putArtifact } from "../lib/control-plane/evidence/store.ts";
import { section3Record } from "../lib/control-plane/promotion/section3.ts";

const now = "2026-10-14T19:00:00.000Z";
const rich = '<p>Vote early September 24 – November 2, 2026. Don\'t guess.</p><a href="https://elections.example.gov/sample.pdf">Sample ballot</a>';
const payload = JSON.stringify({ widgets: [{ content: rich }], rawUrl: "https://unpublished.example.gov/", duplicate: rich });
const escaped = '"' + Array.from(payload).map(char => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`).join("") + '"';
const source = `<h1>Election help</h1><script>window.pages = JSON.parse(${escaped});</script>`;

test("embedded literal HTML decodes Unicode and quoted JavaScript string escapes without inventing links", () => {
  const read = extractEmbeddedHtml(source)!;
  assert.equal(read.fragments, 1);
  assert.equal(read.text, `${source}\n${rich}`);
  assert.ok(!read.text.includes('<a href="https://unpublished.example.gov/"'));
  const singleQuoted = "'" + payload.replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
  assert.equal(extractEmbeddedHtml(`<script>window.data = JSON.parse(${singleQuoted});</script>`)!.text.split("\n").at(-1), rich);
  assert.equal(extractEmbeddedHtml('<script>window.data = JSON.parse("\\x7b\\u0022content\\u0022:\\u0022<p>Actual field</p>\\u0022}")</script>')!.fragments, 1);
});

test("HTML JSON extraction follows an archived sanitizer chain to protected native bytes", async () => {
  const nativeText = `${source}<script>window.browserKey = "${"AIza" + "a".repeat(35)}";</script>`;
  const raw = recordAcquisition({ canonicalUrl: "https://elections.example.gov/voting", retrievedAt: now, httpStatus: 200,
    contentType: "text/html", sourceId: "Election office", methodRouteId: "official-page", workItemId: "election-navigation",
    attemptId: "native-page-read", permission: "ALLOWED", transport: "REACHABLE" }, nativeText).artifact;
  assert.equal(raw.tier, "RESTRICTED_RAW");
  const sanitized = deriveSanitized(raw, nativeText, now);
  const read = extractEmbeddedHtml(sanitized.text)!, hash = `sha256-${sha256Hex(read.text)}`;
  const derived: Artifact = { ...sanitized.artifact, id: artifactId("EXTRACTED_DERIVED", hash), tier: "EXTRACTED_DERIVED",
    contentHash: hash, byteLength: Buffer.byteLength(read.text), derivation: undefined,
    extraction: { kind: "HTML_TEXT", version: "html-json/1", complete: true, pages: 1, encoding: "utf-8", parent: sanitized.artifact } };
  const bytes = new TextEncoder().encode(read.text), store = new MemoryEvidenceStore();
  await putArtifact(store, "test", sanitized.artifact, new TextEncoder().encode(sanitized.text));
  await assert.rejects(putArtifact(store, "test", derived, bytes), /DOCUMENT_EXTRACTION_ORIGINAL_MISSING/);
  await putArtifact(store, "test", raw, new TextEncoder().encode(nativeText));
  await putArtifact(store, "test", derived, bytes);
  const issued = issueParserInput(derived, read.text);
  assert.equal(issued.sourceDocument!.artifactId, raw.id);
  assert.equal(issued.sourceDocument!.contentHash, raw.contentHash);
  assert.ok(issued.text.includes(rich));
  assert.throws(() => issueParserInput(raw, nativeText), /RESTRICTED_RAW/);
  const wrongProof: Artifact = { ...derived, extraction: { ...derived.extraction!, parent: { ...sanitized.artifact,
    derivation: { ...sanitized.derivation, substringsReplaced: 0 } } } };
  await assert.rejects(putArtifact(store, "test", wrongProof, bytes), /DOCUMENT_EXTRACTION_SANITIZER_PROOF_INVALID/);
  const wrongNative: Artifact = { ...derived, extraction: { ...derived.extraction!, parent: { ...sanitized.artifact,
    derivation: { ...sanitized.derivation, rawHash: `sha256-${"0".repeat(64)}` } } } };
  assert.throws(() => issueParserInput(wrongNative, read.text), /DOCUMENT_EXTRACTION_INCOMPLETE/);
  const credentialText = read.text + `<script>window.bad = "${"AIza" + "b".repeat(35)}";</script>`;
  const credentialHash = `sha256-${sha256Hex(credentialText)}`;
  const unsafe: Artifact = { ...derived, id: artifactId("EXTRACTED_DERIVED", credentialHash), contentHash: credentialHash,
    byteLength: Buffer.byteLength(credentialText) };
  await assert.rejects(putArtifact(store, "test", unsafe, new TextEncoder().encode(credentialText)), /DOCUMENT_EXTRACTION_CONTAINS_CREDENTIAL/);
});

test("embedded literal HTML reads actual parse calls rather than strings, comments, regular expressions or arbitrary execution", () => {
  const marker = globalThis as typeof globalThis & { htmlJsonExecuted?: boolean };
  delete marker.htmlJsonExecuted;
  const inert = `<script>
    globalThis.htmlJsonExecuted = true;
    const bait = ${JSON.stringify(`JSON.parse(${escaped})`)};
    const template = \`JSON.parse(${escaped})\`;
    const regex = /JSON.parse("<p>not parsed JSON<\\/p>")/;
    // JSON.parse(${escaped});
    /* JSON.parse(${escaped}); */
    JSON.parse(getData()); JSON.parse("{}" + dynamic()); JSON.parse("{}", arbitraryReviver);
  </script>`;
  assert.equal(extractEmbeddedHtml(inert), null);
  assert.equal(marker.htmlJsonExecuted, undefined);
  const liveData = inert.replace("</script>", `window.pages = JSON.parse(${escaped});</script>`);
  assert.equal(extractEmbeddedHtml(liveData)!.fragments, 1);
  assert.equal(marker.htmlJsonExecuted, undefined);
  assert.equal(extractEmbeddedHtml('<script>JSON.parse("invalid JSON")</script>'), null);
});

test("embedded literal HTML preserves call and field order and ignores plain HTML pages", () => {
  const literal = (text: string) => JSON.stringify(JSON.stringify({ html: text }));
  const html = `<script>JSON.parse(${literal("<p>First</p>")});JSON.parse(${literal("<p>Second</p>")});</script>`;
  assert.equal(extractEmbeddedHtml(html)!.text, `${html}\n<p>First</p>\n<p>Second</p>`);
  assert.equal(extractEmbeddedHtml("<p>Ordinary published page</p>"), null);
});

test("embedded JSON transcribes published hyperlink records without turning arbitrary URLs into links", () => {
  const url = "https://s3.amazonaws.com/pub-attachments/actual-faq.pdf";
  const values = { cards: [{ buttonUrl: url, buttonText: 'SEE OUR "FAQ"' }],
    link: { href: "/sample?state=IL&year=2026", label: "Sample <ballot>" },
    siblingLink: { href: "/registration", text: "Register" }, rawUrl: "https://unpublished.example.gov/",
    unmatchedUrl: { buttonUrl: "https://unpaired.example.gov/" }, unmatchedText: { buttonText: "Unpaired" },
    unsafe: { href: "javascript:alert(1)", label: "Unsafe" } };
  const html = `<script>window.pages = JSON.parse(${JSON.stringify(JSON.stringify(values))})</script>`;
  const read = extractEmbeddedHtml(html)!;
  assert.ok(read.text.includes(`<a href="${url}">SEE OUR &quot;FAQ&quot;</a>`));
  assert.ok(read.text.includes('<a href="/sample?state=IL&amp;year=2026">Sample &lt;ballot&gt;</a>'));
  assert.ok(read.text.includes('<a href="/registration">Register</a>'));
  assert.ok(!read.text.includes('<a href="https://unpublished.example.gov/"'));
  assert.ok(!read.text.includes('<a href="https://unpaired.example.gov/"'));
  assert.ok(!read.text.includes('<a href="javascript:'));
});

test("HTML JSON transcription remains bound to archived native bytes and only decoded fields reach section3", async () => {
  const raw = recordAcquisition({ canonicalUrl: "https://elections.example.gov/voting", retrievedAt: now, httpStatus: 200,
    contentType: "text/html", sourceId: "Election office", methodRouteId: "official-page", workItemId: "election-navigation",
    attemptId: "native-page-read", permission: "ALLOWED", transport: "REACHABLE" }, source).artifact;
  const read = extractEmbeddedHtml(source)!, hash = `sha256-${sha256Hex(read.text)}`;
  const derived: Artifact = { ...raw, id: artifactId("EXTRACTED_DERIVED", hash), tier: "EXTRACTED_DERIVED",
    contentHash: hash, byteLength: Buffer.byteLength(read.text), extraction: { kind: "HTML_TEXT", version: "html-json/1",
      complete: true, pages: 1, encoding: "utf-8", parent: raw } };
  const store = new MemoryEvidenceStore();
  await assert.rejects(putArtifact(store, "test", derived, new TextEncoder().encode(read.text)), /DOCUMENT_EXTRACTION_ORIGINAL_MISSING/);
  await putArtifact(store, "test", raw, new TextEncoder().encode(source));
  await putArtifact(store, "test", derived, new TextEncoder().encode(read.text));
  const issued = issueParserInput(derived, read.text);
  assert.equal(issued.sourceDocument!.artifactId, raw.id);
  assert.equal(issued.sourceDocument!.contentHash, raw.contentHash);
  assert.equal(issued.sourceDocument!.kind, "HTML_TEXT");
  const verified = (text: string) => section3Record({ recordClass: "BALLOT_CONTEST", fields: {
    value: "Vote early September 24 – November 2, 2026." }, minimums: ["value"],
    page: { url: raw.canonicalUrl, text, retrievedAt: now }, now });
  assert.equal(verified(source).live, false);
  assert.equal(verified(issued.text).live, true);
  const unknown = { ...derived, extraction: { ...derived.extraction!, version: "html-json/999" } };
  assert.throws(() => issueParserInput(unknown, read.text), /DOCUMENT_EXTRACTION_INCOMPLETE/);
  await assert.rejects(putArtifact(store, "test", unknown, new TextEncoder().encode(read.text)), /DOCUMENT_EXTRACTION_PROVENANCE_INVALID/);
});
