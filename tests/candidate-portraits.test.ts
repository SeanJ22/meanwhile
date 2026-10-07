import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { candidatePortraitFromOwnSite } from "../lib/ballot/candidate-portraits.ts";
import { readerCandidateProfiles } from "../lib/ballot/candidate-reader-privacy.ts";
import type { CandidateProfilesProjection } from "../lib/civic-data/manual-projections.ts";
import type { WorkerPublicationCapture } from "../lib/civic-data/worker-roster-publication.ts";

const NOW = "2026-10-01T00:00:00Z", NAME = "Jane Doe", SITE = "https://janedoeforcouncil.com/";
const IMAGE = "https://janedoeforcouncil.com/img/jane-doe.jpg";
const PNG = Uint8Array.from([0xff,0xd8,0xff,0xc0,0,17,8,0,240,0,200,3,1,0x11,0,2,0x11,0,3,0x11,0,0xff,0xd9]);

function capture(url: string, text: string): WorkerPublicationCapture {
  const hash = `sha256-${createHash("sha256").update(text).digest("hex")}`;
  return { evidence: { artifactId: hash, contentHash: hash, text, canonicalUrl: url, retrievedAt: NOW, sourceId: new URL(url).hostname,
    acquiredByAttemptId: "fixture", methodRouteId: "portrait" }, observedAt: NOW, httpStatus: 200, transport: "REACHABLE", partial: false };
}
const page = (html: string) => ({ name: NAME, office: "City Council", cycle: "2026",
  capture: capture(SITE, `<h1>Jane Doe for City Council 2026</h1>${html}`) });
const runtime = () => { const stored = new Map<string, Uint8Array>();
  return { stored, io: { read: async () => PNG, put: async (key: string, bytes: Uint8Array) => { stored.set(key, bytes); } } }; };

test("a named portrait on the campaign's own page is stored under candidates/ and bound by OWN_PAGE", async () => {
  const { stored, io } = runtime();
  const got = await candidatePortraitFromOwnSite(page(`<img alt="Jane Doe" src="${IMAGE}">`), NOW, io);
  assert.ok("patch" in got);
  const { patch } = got;
  assert.match(patch.photoUrl!, /^\/api\/portraits\/candidates\/[a-f0-9]{64}\.jpg$/);
  assert.equal(patch.photoVerification?.basis, "OWN_PAGE");
  assert.match(patch.photoSource!, /janedoeforcouncil\.com/);
  assert.equal([...stored.keys()].length, 1);
  assert.ok([...stored.keys()][0].startsWith("candidates/"));
  const card = { ...patch, bio: null } as never;
  const projection = (c: unknown) => ({ cards: { cards: { "k": c }, note: "x", hunts: [] } }) as unknown as CandidateProfilesProjection;
  assert.equal(readerCandidateProfiles(projection(card)).cards.cards.k.photoUrl, patch.photoUrl);
  const unbound = readerCandidateProfiles(projection({ ...patch, photoVerification: undefined })).cards.cards.k;
  assert.equal(unbound.photoUrl, null); assert.equal(unbound.photoSource, null);
  const swapped = readerCandidateProfiles(projection({ ...patch, photoUrl: patch.photoUrl!.replace(/[a-f0-9]{8}\./, "00000000.") })).cards.cards.k;
  assert.equal(swapped.photoUrl, null);
});

test("an image that does not carry the candidate's name is never offered, and committed portraits stay visible", async () => {
  const { stored, io } = runtime();
  const got = await candidatePortraitFromOwnSite(page(`<img alt="Campaign logo" src="https://janedoeforcouncil.com/logo.png">`), NOW, io);
  assert.deepEqual(got, { gap: "PORTRAIT_NOT_ON_OWN_PAGE" });
  assert.equal(stored.size, 0);
  const legacy = { photoUrl: "/candidates/az-pima-x.jpg", photoSource: "official portrait" };
  const out = readerCandidateProfiles({ cards: { cards: { k: legacy }, note: "", hunts: [] } } as unknown as CandidateProfilesProjection);
  assert.equal(out.cards.cards.k.photoUrl, legacy.photoUrl);
});
