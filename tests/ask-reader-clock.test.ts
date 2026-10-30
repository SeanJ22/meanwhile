import assert from 'node:assert/strict';
import test from 'node:test';
import { readableSitting } from '../lib/ask/meeting-time.ts';
import { composeSittingAnswer } from '../lib/ask/sitting-answer.ts';

const sitting = {id:'one',title:'Council Meeting',startsAt:'2026-10-28T00:30:00Z',timeZone:'America/Chicago',status:'SCHEDULED'};
const input = {shape:'MEETING_TIME' as const, subjectName:'Council',sittings:[sitting],records:[{kind:'MEETING' as const,id:'one',text:'Council meeting',sourceUrl:'https://example.gov/one'}],sittingGaps:[],now:Date.parse('2026-10-27T12:00Z')};

test('Ask states a meeting on its own body clock, with the zone', ()=>{
 assert.match(readableSitting(sitting),/Tuesday, October 27th, 2026 at 7:30 PM CDT/);
 assert.match(composeSittingAnswer(input)!.answer,/October 27 at 7:30 PM CDT/);
 assert.match(readableSitting({...sitting,startPrecision:'DAY' as const}),/Tuesday, October 27th, 2026 \(start time not posted\)/);
});
