import assert from 'node:assert/strict';
import test from 'node:test';
import { extract } from './sparqdata-policy.ts';
import { runInstalledAdapter } from '../../control-plane/scheduler/scout-adapters.ts';

const sourceUrl = 'https://policies.sparqdata.com/sopapi/document/getdocument/partner/district/book/PUBLIC';
const document = { partnerCode: 'partner', collectionCode: 'book', documentCode: 'PUBLIC',
  title: 'Public participation', dtAdopted: '2026-01-15T00:00:00', isViewable: true, isEmptyDoc: false, isPartialDoc: false,
  html: '<html><head><style>.hidden{display:none}</style></head><body><h1>Public participation</h1>' +
    '<p>Submit a form &amp; speak to the board.</p><script>secret()</script>' +
    '<a href="/partner/browse/district/book/OTHER">Related policy</a></body></html>' };

test('plain and double-encoded policy responses retain text, adoption and source links', () => {
  for (const text of [JSON.stringify(document), JSON.stringify(JSON.stringify(document)).replace(/</g, '\\u003C')]) {
    const result = extract({ text, sourceUrl });
    assert.equal(result.sourceUrl, sourceUrl);
    assert.equal(result.policyCode, 'PUBLIC');
    assert.equal(result.adoptedAt, document.dtAdopted);
    assert.match(result.text, /Submit a form & speak to the board\./);
    assert.doesNotMatch(result.text, /secret|display:none/);
    assert.equal(result.links[0].url, 'https://policies.sparqdata.com/partner/browse/district/book/OTHER');
  }
});

test('the installed adapter handles another partner and collection through the common runtime', async () => {
  const other = { ...document, partnerCode: 'association', collectionCode: 'manual', documentCode: 'ABC', dtAdopted: null };
  const url = 'https://policies.sparqdata.com/sopapi/document/getdocument/association/another-district/manual/ABC';
  const result = await runInstalledAdapter('sparqdata-policy', JSON.stringify(JSON.stringify(other)), url) as ReturnType<typeof extract>;
  assert.equal(result.policyCode, 'ABC');assert.equal(result.sourceUrl, url);assert.equal(result.adoptedAt, null);
});

test('wrong identity, unavailable content and unrelated routes never supply policy text', () => {
  for (const changed of [{partnerCode:'other'}, {collectionCode:'other'}, {documentCode:'other'},
    {isViewable:false}, {isPartialDoc:true}, {isEmptyDoc:true}, {html:''}]) {
    assert.throws(() => extract({text:JSON.stringify({...document,...changed}),sourceUrl}), /SPARQ_POLICY_/);
  }
  assert.throws(() => extract({text:'null',sourceUrl}), /DOCUMENT_REQUIRED/);
  assert.throws(() => extract({text:JSON.stringify(document),sourceUrl:'https://unrelated.example/sopapi/document/getdocument/partner/district/book/PUBLIC'}), /SOURCE_REQUIRED/);
  assert.throws(() => extract({text:JSON.stringify(document),sourceUrl:sourceUrl.replace('/sopapi/document/getdocument/', '/browse/')}), /SOURCE_REQUIRED/);
});
