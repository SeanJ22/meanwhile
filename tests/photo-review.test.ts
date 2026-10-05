import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { verifyPortraitSources, portraitVerificationMatches, portraitBindingMatches, type PortraitVerification } from "../lib/photos/evidence.ts";
import { installRegistryRuntimeFirstSeeds } from "./helpers/registry-runtime-first-seed.ts";
import type { WorkerPublicationCapture } from "../lib/civic-data/worker-roster-publication.ts";
import { allCandidateCards, cardForCandidacy, cardForNominee } from "../lib/ballot/candidate-cards.ts";

const NOW="2026-10-01T00:00:00Z", NAME="Jane Doe", IMAGE="https://images.example.org/jane-doe.jpg";
function capture(url:string,text:string):WorkerPublicationCapture {
  const hash=`sha256-${createHash('sha256').update(text).digest('hex')}`;
  return {evidence:{artifactId:hash,contentHash:hash,text,canonicalUrl:url,retrievedAt:NOW,sourceId:new URL(url).hostname,
    acquiredByAttemptId:'fixture',methodRouteId:'portrait'},observedAt:NOW,httpStatus:200,transport:'REACHABLE',partial:false};
}
const profile=capture('https://legislature.gov/jane',`<h1>Jane Doe</h1><img alt="Jane Doe" src="${IMAGE}"><p>Photograph is public domain.</p>`);
const roster=capture('https://data.openstates.org/people/current/oh.csv',`name,image\nJane Doe,${IMAGE}\n`);
const sources={imageUrl:IMAGE,captures:[profile,roster]};

test('the same named portrait has two saved sources and its own explicit licence',()=>{
  const got=verifyPortraitSources(NAME,sources,NOW);
  assert.equal(got.sources.length,2);assert.equal(got.license?.value,'public domain');
  assert.equal(got.license?.sourceUrl,profile.evidence.canonicalUrl);
});

test('a non-official portrait still needs two intact fresh copies of the same named image',()=>{
  const profile = capture('https://press.example.org/jane', '<h1>Jane Doe</h1><img alt="Jane Doe" src="'+IMAGE+'">');
  const bad=[
    {...sources,captures:[profile]},
    {...sources,captures:[profile,capture('https://press.example.org/jane-copy',profile.evidence.text+' ')]},
    {...sources,captures:[profile,{...roster,partial:true}]},
    {...sources,captures:[profile,{...roster,observedAt:'2020-01-01T00:00:00Z'}]},
    {...sources,captures:[profile,{...roster,evidence:{...roster.evidence,text:roster.evidence.text+'corruption'}}]},
    {...sources,captures:[profile,capture(roster.evidence.canonicalUrl,`name,image\nOther Person,${IMAGE}\n`)]},
    {...sources,captures:[profile,capture(roster.evidence.canonicalUrl,`name,image\nJane Doe,https://images.example.org/other.jpg\n`)]},
  ];
  for(const input of bad)assert.throws(()=>verifyPortraitSources(NAME,input,NOW),/PORTRAIT_/);
});

test('a replacement URL or source image cannot inherit another portrait verification',()=>{
  const hash='sha256-'+'a'.repeat(64),url='/api/portraits/officials/'+hash.slice(7)+'.jpg';
  const verification:PortraitVerification={...verifyPortraitSources(NAME,sources,NOW),imageHash:hash,sourceImageHash:hash};
  const photo={url,sourceUrl:IMAGE,verification};
    assert.equal(portraitBindingMatches(NAME,photo),true);
    assert.equal(portraitBindingMatches('Someone Else',photo),false);
    assert.equal(portraitBindingMatches(NAME,{...photo,url:url+'?swapped'}),false);
    assert.equal(portraitBindingMatches(NAME,{...photo,sourceUrl:'https://images.example.org/other.jpg'}),false);
    assert.equal(portraitVerificationMatches(NAME,{...verification,sources:[verification.sources[0]]}),true);
    assert.equal(portraitVerificationMatches(NAME),false);
});

test('already-published portraits and the candidate biography/contact fields stay visible without a new approval record',async()=>{
  await installRegistryRuntimeFirstSeeds();
  const file=allCandidateCards();
  for(const [key,card] of Object.entries(file.cards).filter(([,c])=>c.photoUrl).slice(0,5)){
    const i=key.indexOf('|');const got=i<0?cardForCandidacy(key):cardForNominee(key.slice(0,i),key.slice(i+1));
    assert.ok(got);
    assert.ok(got.photoUrl,'an already-published portrait stays visible while its sources gain corroboration');
    for(const field of ['bio','bioSourceUrl','email','phone','filedAddress'] as const)assert.equal(got[field],card[field]);
  }
});

test('CP-10: one official portrait publishes without a licence sentence and still binds the exact image bytes',()=>{
  const own = capture('https://legislature.gov/jane', `<h1>Jane Doe</h1><img alt="Jane Doe" src="${IMAGE}">`);
  const checked = verifyPortraitSources(NAME,{ imageUrl: IMAGE, captures: [own] },NOW);
  assert.equal(checked.basis,'OWN_PAGE'); assert.equal(checked.license,undefined);
  assert.equal(checked.attribution?.sourceUrl,own.evidence.canonicalUrl);
  const hash='sha256-'+'b'.repeat(64);
  assert.equal(portraitBindingMatches(NAME,{ url:'/api/portraits/officials/'+hash.slice(7)+'.jpg',sourceUrl:IMAGE,
    verification:{...checked,imageHash:hash,sourceImageHash:hash} }),true);
});

test('CP-10: a verified own-campaign portrait needs one source; a personal social account still needs two',()=>{
  const own = capture('https://jane.example/', `<title>Jane Doe for Mayor 2026</title><img alt="Jane Doe" src="${IMAGE}">`);
  const checked=verifyPortraitSources(NAME,{imageUrl:IMAGE,captures:[own],campaign:{url:own.evidence.canonicalUrl,name:NAME,office:'Mayor',cycle:'2026'}},NOW);
  assert.equal(checked.basis,'OWN_PAGE');
  const personal=capture('https://social.example/jane',own.evidence.text);
  assert.throws(()=>verifyPortraitSources(NAME,{imageUrl:IMAGE,captures:[personal]},NOW),/SECOND_SOURCE/);
  assert.throws(()=>verifyPortraitSources('Other Person',{imageUrl:IMAGE,captures:[own],campaign:{url:own.evidence.canonicalUrl,name:NAME,office:'Mayor',cycle:'2026'}},NOW),/SECOND_SOURCE/);
});
