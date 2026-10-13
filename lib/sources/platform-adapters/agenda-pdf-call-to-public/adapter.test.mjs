import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extract } from './adapter.mjs';

const SOURCE_URL = 'https://example.org/agenda.pdf';

const AGENDA_EXCERPT =
  'VI. Call to the Public (Limited to 3 to 5 minutes, personnel problems will not be discussed at this time). ' +
  'The President may allow individuals from the public to address the Board. ' +
  'Comments should be limited to education-related issues on items that do not appear on the agenda or for which no public hearing has been held. ' +
  'The Board shall not and cannot discuss or take legal action on matters raised during an open call to the public unless the matters are properly noticed for discussion and legal action, but may instruct the Principal to schedule discussion on a later date.';

function byField(facts, field) {
  return facts.find((f) => f.field === field);
}

test('extracts the three call-to-public rules with exact quotes', () => {
  const facts = extract({ text: AGENDA_EXCERPT, sourceUrl: SOURCE_URL });
  assert.equal(facts.length, 3);

  const limit = byField(facts, 'call_to_public.time_limit');
  assert.equal(limit.value, '3 to 5 minutes');
  assert.equal(limit.exactQuote, 'Limited to 3 to 5 minutes');

  const scope = byField(facts, 'call_to_public.comment_scope');
  assert.equal(
    scope.exactQuote,
    'Comments should be limited to education-related issues on items that do not appear on the agenda or for which no public hearing has been held.',
  );
  assert.equal(
    scope.value,
    'education-related issues on items that do not appear on the agenda or for which no public hearing has been held',
  );

  for (const f of facts) {
    assert.equal(f.sourceUrl, SOURCE_URL);
    assert.ok(AGENDA_EXCERPT.includes(f.exactQuote), 'quote must be verbatim input text');
  }
});

test('tolerates line breaks and extra whitespace inside a rule, quoting the input as-is', () => {
  const spaced = AGENDA_EXCERPT.replace('Limited to 3 to 5', 'Limited to\n  3 to   5');
  const facts = extract({ text: spaced, sourceUrl: SOURCE_URL });
  const limit = byField(facts, 'call_to_public.time_limit');
  assert.ok(limit, 'time limit should still match');
  assert.equal(limit.value, '3 to 5 minutes');
  assert.ok(spaced.includes(limit.exactQuote), 'quote must be a substring of the input');
});

test('returns no facts when the call-to-public rules are absent', () => {
  const facts = extract({
    text: 'Pursuant to A.R.S. 38-431.02, notice is hereby given of a regular meeting.',
    sourceUrl: SOURCE_URL,
  });
  assert.deepEqual(facts, []);
});

test('does not invent a signup procedure or written-comment channel', () => {
  const facts = extract({ text: AGENDA_EXCERPT, sourceUrl: SOURCE_URL });
  const fields = facts.map((f) => f.field);
  assert.ok(!fields.some((f) => /signup|written/i.test(f)));
});

test('returns empty for invalid input', () => {
  assert.deepEqual(extract({ text: null, sourceUrl: SOURCE_URL }), []);
  assert.deepEqual(extract({ text: AGENDA_EXCERPT, sourceUrl: '' }), []);
  assert.deepEqual(extract(), []);
});
