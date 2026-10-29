import test from "node:test";
import assert from "node:assert/strict";
import { X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { issuerCompletingFetch, trustStore as tls } from "../lib/sources/issuer-chain.ts";

// Production, Oct 17-29: www.elections.alaska.gov (and gec.guam.gov) send their certificate without its intermediate,
// so every Alaska and Guam read ended in "fetch failed". These are the certificates Alaska's server and its issuer publish.
const directory = "tests/fixtures/voting-sources/issuer-chain/";
const leaf = new X509Certificate(readFileSync(directory + "alaska-elections-leaf.crt"));
const issuer = readFileSync(directory + "globalsign-gcc-r46-ov-tls-ca-2025.crt");
const incomplete = () => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("unable to verify the first certificate"), { code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" }) });
const trustsIssuer = () => tls.getCACertificates("default").some(pem => new X509Certificate(pem).fingerprint256 === new X509Certificate(issuer).fingerprint256);

test("a page whose server omits its intermediate is read once the issuer its certificate names verifies to a trusted root", async t => {
  const defaults = tls.getCACertificates("default");
  t.after(() => tls.setDefaultCACertificates(defaults));
  const pages = async () => { if (!trustsIssuer()) throw incomplete(); return new Response("Alaska Division of Elections"); };
  const named: string[] = [];
  const read = issuerCompletingFetch(pages, { leaf: async host => { assert.equal(host, "www.elections.alaska.gov"); return leaf; },
    download: async url => { named.push(url); return new Uint8Array(issuer); } });
  assert.equal(await (await read("https://www.elections.alaska.gov/")).text(), "Alaska Division of Elections");
  assert.deepEqual(named, ["http://secure.globalsign.com/cacert/gsgccr46ovtlsca2025.crt"]);
  assert.ok(trustsIssuer());
});

test("an issuer that did not sign the server's certificate, or any other failure, is never trusted", async t => {
  const defaults = tls.getCACertificates("default");
  t.after(() => tls.setDefaultCACertificates(defaults));
  const pages = async () => { throw incomplete(); };
  const unrelated = issuerCompletingFetch(pages, { leaf: async () => leaf, download: async () => new Uint8Array(readFileSync(directory + "alaska-elections-leaf.crt")) });
  await assert.rejects(unrelated("https://www.elections.alaska.gov/"), /fetch failed/);
  const refused = issuerCompletingFetch(async () => { throw new TypeError("fetch failed"); }, { leaf: async () => assert.fail("only an incomplete chain is completed") });
  await assert.rejects(refused("https://www.elections.alaska.gov/"), /fetch failed/);
  assert.equal(tls.getCACertificates("default").length, defaults.length);
});
