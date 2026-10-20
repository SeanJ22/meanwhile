import test from "node:test";
import assert from 'node:assert/strict';
import {siteFindings,isBodyName} from '../lib/hunt/site-findings.ts';

test("government pages preserve current body, official and seat identities across published layouts",async()=>{
const scope={governmentId:'ocd-division/country:us/state:az/place:example',bodyId:'ocd-division/country:us/state:az/place:example#governing',bodyName:'City Council',name:'Example',state:'AZ',website:'https://example.gov/'};
const read=(html:string,url='https://example.gov/council')=>siteFindings(scope,{url,html,artifactId:'saved',observedAt:'2026-10-20T07:00:00.000Z'});
const one='<main><h1>City Council</h1><table><tr><td>José Pérez</td><td>Mayor</td><td>jose@example.gov</td></tr></table></main>';
assert.ok(read(one).some(f=>f.field==='OFF-04' && f.value==='José Pérez'));
assert.ok(read(one).some(f=>f.field==='OFF-02' && f.value==='Mayor'));
const planning=read(one.replaceAll('City Council','Planning Commission'));assert.ok(planning.some(f=>f.field==='GOV-02' && f.value==='Planning Commission' && f.subjectId!==scope.bodyId));assert.ok(planning.filter(f=>f.field.startsWith('OFF-')).every(f=>f.subjectId!==scope.bodyId));
assert.ok(!read(one,'https://example.gov/election/candidates').some(f=>f.field.startsWith('OFF-')));
assert.ok(!read(one,'https://example.gov/history/council').some(f=>f.field==='GOV-02' || f.field.startsWith('OFF-')));
assert.ok(!read('<address>123 Main Street</address>').some(f=>f.field==='body.officeAddress'));
assert.ok(read('<h2>City Hall Office</h2><address>123 Main Street</address>').some(f=>f.field==='body.officeAddress'));
assert.equal(read(one,'https://other.gov/council').length,0);
console.log('single sourced member, exact seat, Unicode name, separate body, candidate, history, office address and host checks passed');

for(const name of ['Mayor establishes new Department of Housing and Land Management with City Council’s blessing','Council Chambers (1st Floor)','Energy Commission Projects','Board','Meet the Council'])assert.equal(isBodyName(name),false,name);
for(const name of ['Board of Parks & Recreation','City Council','Commission on Disabilities','Zoning Board of Appeals'])assert.equal(isBodyName(name),true,name);
for(const name of ['Social Media Policy','Tree Commission Member','BOW Member'])assert.ok(!read(`<h1>City Council</h1><table><tr><td>${name}</td><td>Council Member</td><td>x@example.gov</td></tr></table>`).some(f=>f.field==='OFF-04'),name);
console.log('article headings, chamber labels, unnamed boards and job/navigation labels stay out of body and holder findings');

assert.ok(!read('<h1>State & Local Elected Officials</h1><table><tr><td>Mile High Conservation</td><td>District Supervisor Ueland, Donald E. 2026</td><td>406-723-1123</td></tr></table>','https://example.gov/State-Local-Elected-Officials').some(f=>f.field==='OFF-04'));
assert.ok(!read('<h1>Be Aware of Fraudulent Invoices from the Casper Planning and Zoning Commission</h1>','https://example.gov/news_detail_T6_R283.php').some(f=>f.field==='GOV-02'));
console.log('multi-government official directory and news-detail pages do not seat their rows on the current governing body');

const split=read('<h1>Joint Powers Board</h1><table><tr><th>Title</th><th>First Name</th><th>Last Name</th><th>Entity</th></tr><tr><td>Board Member</td><td>Dan</td><td>Sabrosky</td><td>Bar Nunn</td></tr></table>','https://example.gov/joint-powers-board');
assert.ok(split.some(f=>f.field==='OFF-04' && f.value==='Dan Sabrosky'));assert.ok(!split.some(f=>f.field==='OFF-04' && f.value==='Bar Nunn'));
assert.ok(split.some(f=>f.field==='OFF-02' && f.value==='Board Member'));
console.log('split first/last-name columns bind the holder and preserve their role; the represented town stays a town');

const sharedRole=read('<h1>Planning Commission</h1><table><tr><td>Jane Doe</td><td>Board Member</td></tr><tr><td>John Smith</td><td>Board Member</td></tr></table>');
assert.equal(sharedRole.filter(f=>f.field==='OFF-02' && f.value==='Board Member').length,2);
assert.ok(sharedRole.some(f=>f.field==='OFF-02' && f.exactQuote.includes('Jane Doe')));assert.ok(sharedRole.some(f=>f.field==='OFF-02' && f.exactQuote.includes('John Smith')));
console.log('equal roles on different people retain each person’s source row');

const sharedPage=read('<h1>Community Redevelopment Agency (CRA) &amp; CRA Advisory Board (CRAAB)</h1><h2>CRA Members:</h2><table><tr><td>Jane Doe</td><td>Chair</td></tr></table><h2>CRA Advisory Board (CRAAB):</h2><table><tr><td>John Smith</td><td>Chair</td></tr></table>','https://example.gov/boards');
const agency=sharedPage.find(f=>f.field==='GOV-02' && f.value==='Community Redevelopment Agency (CRA)');const advisory=sharedPage.find(f=>f.field==='GOV-02' && f.value==='CRA Advisory Board (CRAAB)');
assert.ok(agency&&advisory);assert.notEqual(agency.subjectId,advisory.subjectId);assert.ok(sharedPage.some(f=>f.field==='OFF-04' && f.value==='Jane Doe' && f.subjectId===agency.subjectId));assert.ok(sharedPage.some(f=>f.field==='OFF-04' && f.value==='John Smith' && f.subjectId===advisory.subjectId));
console.log('two bodies sharing a source page retain separate named sections and member rows');

const vice=read('<h1>Joint Powers Board</h1><table><tr><th>Title</th><th>First Name</th><th>Last Name</th></tr><tr><td>Vice - Chairman</td><td>Dave</td><td>North</td></tr></table>','https://example.gov/joint-board');assert.ok(vice.some(f=>f.field==='OFF-02' && f.value==='Vice - Chairman'));
console.log('source office qualifiers such as Vice - Chairman stay in the reported seat');

});
