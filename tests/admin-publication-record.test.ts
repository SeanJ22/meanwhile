import test from "node:test";
import assert from "node:assert/strict";
import {
  PUBLICATION_PROTECTED_KEY_PATTERN, PUBLICATION_RECORD_PAGE_SIZE, PUBLICATION_RECORD_TEXT_SLICE,
  isProtectedPublicationKey, parsePublicationRecordPath, sanitizePublicationRecordNode,
} from "../lib/control-plane/admin-view/publication-record.ts";

test("record paths are bounded JSON string arrays and never navigate protected keys", () => {
  assert.deepEqual(parsePublicationRecordPath("[]"), []);
  assert.deepEqual(parsePublicationRecordPath('["members","0","name"]'), ["members", "0", "name"]);
  for (const value of [null, "", "not json", "{}", "null", '["name",4]',
    JSON.stringify(Array.from({ length: 21 }, () => "a")),
    JSON.stringify(["a".repeat(301)]),
    JSON.stringify(Array.from({ length: 11 }, () => "a".repeat(300)))]) {
    assert.equal(parsePublicationRecordPath(value), null);
  }
  assert.equal(parsePublicationRecordPath(JSON.stringify(Array.from({ length: 10 }, () => "a".repeat(300))))?.length, 10);
  assert.deepEqual(parsePublicationRecordPath(JSON.stringify(["🙂".repeat(300)])), ["🙂".repeat(300)]);
  assert.equal(parsePublicationRecordPath(JSON.stringify(["🙂".repeat(301)])), null);
  const escapedEmojiPath = `[${Array.from({length:10},()=>`"${"\\uD83D\\uDE42".repeat(300)}"`).join(",")}]`;
  assert.equal(parsePublicationRecordPath(escapedEmojiPath)?.length,10);
  for (const key of ["password", "PASSWD", "secret", "api_key", "apiKey", "API-KEY", "AUTHORIZATION",
    "access_token", "refresh_token", "private_key", "cookie"]) {
    assert.equal(isProtectedPublicationKey(key), true, key);
    assert.equal(parsePublicationRecordPath(JSON.stringify(["parent", key])), null, key);
  }
  assert.equal(isProtectedPublicationKey("officePhone"), false);
  assert.equal(new RegExp(PUBLICATION_PROTECTED_KEY_PATTERN, "i").test("apiKey"), true);
});

test("one bounded page redacts protected children and retains public contact and safe URLs", () => {
  const node = sanitizePublicationRecordNode({
    kind: "object", total: 100, children: [
      { key: "name", kind: "string", size: 12, value: "Jane Official" },
      { key: "email", kind: "string", size: 18, value: "office@example.gov" },
      { key: "sourceUrl", kind: "string", size: 72, value: "https://official.example/profile?id=5&api_key=private#secret" },
      { key: "password", kind: "object", size: 27, value: { nested: "private" } },
      { key: "apiKey", kind: "string", size: 100, value: "secret" },
    ],
  });
  assert.ok(node);
  assert.equal(node.total, 100); // A page is not the complete object.
  assert.deepEqual(node.children[0], { key: "name", kind: "string", size: 12, value: "Jane Official" });
  assert.equal(node.children[1]?.value, "office@example.gov");
  assert.equal(node.children[2]?.value, "https://official.example/profile?id=5");
  assert.deepEqual(node.children[3], { key: "password", kind: "missing", value: "[redacted]", protected: true });
  assert.deepEqual(node.children[4], { key: "apiKey", kind: "missing", value: "[redacted]", protected: true });
});

test("long text slices, Unicode, and scalar values remain bounded without invented completeness", () => {
  const original = "x".repeat(6_000) + "END";
  const node = sanitizePublicationRecordNode({ kind: "string", total: original.length, children: [], text: original });
  assert.ok(node);
  assert.equal(node.total, original.length);
  assert.ok(node.text && node.text.length <= PUBLICATION_RECORD_TEXT_SLICE);
  assert.equal(node.text?.includes("END"), false);
  const emoji = "🙂".repeat(6_000);
  const emojiNode = sanitizePublicationRecordNode({ kind: "string", total: 6_000, children: [], text: emoji });
  assert.equal(emojiNode?.text, emoji);
  const boundary = sanitizePublicationRecordNode({ kind: "string", total: 6_001, children: [], text: "a".repeat(5_999) + "🙂x" });
  assert.equal(boundary?.text, "a".repeat(5_999) + "🙂");
  assert.deepEqual(sanitizePublicationRecordNode({ kind: "number", total: 0, children: [], value: 42 }),
    { kind: "number", total: 0, children: [], value: 42 });
  assert.deepEqual(sanitizePublicationRecordNode({ kind: "null", total: 0, children: [], value: null }),
    { kind: "null", total: 0, children: [], value: null });
  assert.deepEqual(sanitizePublicationRecordNode({ kind: "null", total: 0, children: [] }),
    { kind: "null", total: 0, children: [] });
});

test("split URL keys and credential tokens are withheld on both sides of a page boundary", () => {
  const firstUrl = sanitizePublicationRecordNode({kind:"string",total:12_000,children:[],
    text:"public text https://example.gov/report?api_",endsMidToken:true});
  const secondUrl = sanitizePublicationRecordNode({kind:"string",total:12_000,children:[],
    text:"key=SECRET_VALUE later public text",startsMidToken:true});
  assert.equal(firstUrl?.boundaryTextWithheld,true);
  assert.equal(secondUrl?.boundaryTextWithheld,true);
  assert.equal(firstUrl?.text?.includes("api_"),false);
  assert.equal(secondUrl?.text?.includes("SECRET_VALUE"),false);
  assert.equal(firstUrl?.text?.includes("public text"),true);
  assert.equal(secondUrl?.text?.includes("later public text"),true);

  const firstCredential = sanitizePublicationRecordNode({kind:"string",total:12_000,children:[],
    text:"public sk-ant-",endsMidToken:true});
  const secondCredential = sanitizePublicationRecordNode({kind:"string",total:12_000,children:[],
    text:"SECRET_CONTINUATION visible",startsMidToken:true});
  assert.equal(firstCredential?.text?.includes("sk-ant-"),false);
  assert.equal(secondCredential?.text?.includes("SECRET_CONTINUATION"),false);
  const uninterrupted = sanitizePublicationRecordNode({kind:"string",total:12_000,children:[],
    text:"SECRET_CONTINUATION",startsMidToken:true,endsMidToken:true});
  assert.equal(uninterrupted?.text,"[boundary text withheld]");
  assert.equal(uninterrupted?.boundaryTextWithheld,true);
});

test("child previews withhold incomplete trailing tokens and preserve long-key navigation limits", () => {
  const node = sanitizePublicationRecordNode({kind:"object",total:2,children:[
    {key:"publicSource",kind:"string",size:700,value:"See https://example.gov/?api_",endsMidToken:true},
    {key:"🙂".repeat(300),kind:"object",size:4,pathUnavailable:true},
  ]});
  assert.ok(node);
  assert.equal(node.children[0]?.boundaryTextWithheld,true);
  assert.equal(String(node.children[0]?.value).includes("api_"),false);
  assert.equal(node.children[1]?.pathUnavailable,true);
});

test("malformed or unbounded DB projections remain unknown, not an empty full record", () => {
  assert.equal(PUBLICATION_RECORD_PAGE_SIZE, 25);
  assert.equal(PUBLICATION_RECORD_TEXT_SLICE, 6_000);
  for (const raw of [null, {}, [], { kind: "object", total: 0 },
    { kind: "object", total: -1, children: [] },
    { kind: "object", total: 0, children: Array.from({ length: 26 }, (_, i) => ({ key: String(i), kind: "null" })) },
    { kind: "object", total: 1, children: [{ key: "public", kind: "object", value: { raw: "secret" } }] },
    { kind: "string", total: 1, children: [], text: { raw: "secret" } },
    { kind: "string", total: 1, children: [], text: "x", startsMidToken: "true" },
    { kind: "object", total: 1, children: [], endsMidToken: true },
    { kind: "object", total: 1, children: [{key:"x",kind:"string",endsMidToken:"true"}] },
    { kind: "object", total: 1, children: [{key:"x",kind:"object",endsMidToken:true}] },
    { kind: "object", total: 1, children: [{key:"x",kind:"object",pathUnavailable:"yes"}] },
    { kind: "string", total: 12_001, children: [], text: "x".repeat(12_001) },
    { kind: "unknown", total: 0, children: [] }]) {
    assert.equal(sanitizePublicationRecordNode(raw), null);
  }
});
