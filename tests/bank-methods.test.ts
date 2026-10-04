import { test } from 'node:test';
import assert from 'node:assert/strict';
import { doorMethodEntries, portableProcedure } from '../lib/control-plane/bank-methods.ts';
import { emptyFieldManual, newFieldManualEntry, upsertEntries } from '../lib/control-plane/field-manual.ts';

const door = (subjectId: string, url: string) => newFieldManualEntry('scout', subjectId, {
  role: 'SCOUT', kind: 'SCOUT_DISCOVERY', title: subjectId, summary: 'events feed', outcome: 'YIELDED',
  recordClasses: ['meetings'], url, payload: { subjectId, procedure: `GET ${url} and read the events` },
});

test('one host-free platform method retains two place doors', () => {
  const a = door('ocd-division/country:us/state:ca/county:first', 'https://first.legistar.com/events');
  const b = door('ocd-division/country:us/state:nv/county:second', 'https://second.legistar.com/events');
  const methods = [...doorMethodEntries(a), ...doorMethodEntries(b)];
  assert.equal(methods[0]!.id, methods[1]!.id);
  const store = upsertEntries(emptyFieldManual(), [a, b, ...methods], 'now');
  assert.equal(store.entries.filter(e => e.kind === 'METHOD').length, 1);
  const method = store.entries.find(e => e.kind === 'METHOD')!;
  assert.deepEqual(method.states, []);
  assert.equal((method.payload as { places: string[] }).places.length, 2);
  assert.equal((method.payload as { doorEntryIds: string[] }).doorEntryIds.length, 2);
  assert.doesNotMatch(method.summary, /first|second|legistar\.com/);
});

test('saved custom-domain markup identifies a platform, while an unidentified page stays a place door', () => {
  const row = door('ocd-division/country:us/state:ca/county:first', 'https://example.gov/agenda');
  assert.equal(doorMethodEntries(row).length, 0);
  assert.deepEqual(doorMethodEntries(row, [{ url: row.url!, html: '<script src="/Common/Modules/Calendar.js"></script>' }])[0]!.platforms, ['civicplus']);
  assert.equal(portableProcedure('GET https://example.gov/agenda using example.gov', row.url!), 'GET {door} using {host}');
});
