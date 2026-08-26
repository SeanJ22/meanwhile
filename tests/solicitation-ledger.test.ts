/**
 * **RULING 160 — the solicitation ledger.** (2026-08-25, Sean's ruling.)
 *
 * The load-bearing case is the one no artifact can catch: **a perfectly uniform
 * rate sheet with a one-sided customer list.** Every other constraint —
 * published uniform rates, never exclusive, no off-catalog cuts — is checkable
 * by looking at a document. This one is only checkable if the offers were
 * written down, and only legible if the reconciling unit is the CONTEST.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  ledgerVerdict,
  offCatalogOffers,
  reconcileByContest,
  solicitationBreaches,
  type Ledger,
} from "../lib/business/solicitation-ledger.ts";

const ROOT = process.cwd();

/** The worked example. One contest, two candidacies, one published rate. */
const WORKED_EXAMPLE: Ledger = {
  rateCard: [
    {
      id: "insight-contest-2026",
      product: "Aggregate constituent-priority insight for one contest, one cycle",
      priceCents: 250_000,
      publishedOn: "2026-08-25",
    },
  ],
  buyers: [
    { id: "buyer-1", name: "Rockaway Township Republican Committee", actsForCandidacyId: "cand-a" },
    { id: "buyer-2", name: "Rockaway Township Democratic Committee", actsForCandidacyId: "cand-b" },
  ],
  offers: [
    {
      id: "offer-1",
      buyerId: "buyer-1",
      contestId: "nj-morris:rockaway-township:council-ward-1",
      rateCardId: "insight-contest-2026",
      offeredOn: "2026-08-25",
    },
    {
      id: "offer-2",
      buyerId: "buyer-2",
      contestId: "nj-morris:rockaway-township:council-ward-1",
      rateCardId: "insight-contest-2026",
      offeredOn: "2026-08-25",
    },
  ],
  contests: [
    {
      contestId: "nj-morris:rockaway-township:council-ward-1",
      title: "Township Council, Ward 1",
      candidacyIds: ["cand-a", "cand-b"],
    },
  ],
};

test("RULING 160: the worked example reconciles — both sides approached, same published rate, same day", () => {
  const verdict = ledgerVerdict(WORKED_EXAMPLE);
  assert.equal(verdict.contests, 1);
  assert.equal(verdict.equal, 1);
  assert.deepEqual(verdict.breaches, []);
  assert.deepEqual(verdict.offCatalog, []);
  assert.equal(verdict.line, "equal solicitation: 1 of 1 contest(s)");

  const [row] = reconcileByContest(WORKED_EXAMPLE);
  assert.deepEqual(row.approached, ["cand-a", "cand-b"]);
  assert.deepEqual(row.notApproached, []);
  assert.equal(row.equal, true);
});

test("RULING 160 — THE LOAD-BEARING CASE: a uniform rate sheet with a one-sided customer list is a BREACH, by name", () => {
  /*
   * This is the whole reason the ledger exists. Every artifact is perfect here:
   * one published rate, no exclusivity clause, no bespoke cut, one price for
   * everybody. And only one side was ever asked.
   */
  const oneSided: Ledger = {
    ...WORKED_EXAMPLE,
    offers: [WORKED_EXAMPLE.offers[0]],
  };

  // The artifacts are clean...
  assert.deepEqual(offCatalogOffers(oneSided), [], "the rate card is uniform and the offer is on it");
  assert.equal(oneSided.rateCard.length, 1, "one published price for everybody");

  // ...and the behaviour is not.
  const breaches = solicitationBreaches(oneSided);
  assert.equal(breaches.length, 1);
  assert.deepEqual(
    breaches[0].notApproached,
    ["cand-b"],
    "the breach did not NAME the side that was never approached",
  );
  assert.match(
    ledgerVerdict(oneSided).line,
    /BREACH in Township Council, Ward 1 \(not approached: cand-b\)/,
    "the verdict reports a percentage or a count instead of a name",
  );
});

test("RULING 160: a contest nobody was approached about is NOT a breach", () => {
  // No offer was made, so no advantage was handed to anyone. Calling this a
  // breach would make the instrument fire on every contest we have not sold
  // yet, and an alarm that is wrong on every quiet day is one nobody reads
  // (RULING 115).
  const untouched: Ledger = { ...WORKED_EXAMPLE, offers: [] };
  assert.deepEqual(solicitationBreaches(untouched), []);
  assert.equal(reconcileByContest(untouched)[0].equal, true);
});

test("RULING 160: an unaligned buyer is COUNTED, never taken as a side", () => {
  // A newsroom or a university buying insight is not one side of a contest.
  // Counting it as one would let a single unaligned sale mask a one-sided
  // customer list, which is the exact failure this file exists to catch.
  const withNewsroom: Ledger = {
    ...WORKED_EXAMPLE,
    buyers: [...WORKED_EXAMPLE.buyers, { id: "buyer-3", name: "Daily Record", actsForCandidacyId: null }],
    offers: [
      WORKED_EXAMPLE.offers[0],
      {
        id: "offer-3",
        buyerId: "buyer-3",
        contestId: "nj-morris:rockaway-township:council-ward-1",
        rateCardId: "insight-contest-2026",
        offeredOn: "2026-08-25",
      },
    ],
  };
  const [row] = reconcileByContest(withNewsroom);
  assert.equal(row.unalignedOffers, 1);
  assert.deepEqual(row.notApproached, ["cand-b"], "an unaligned offer was counted as a side");
  assert.equal(row.equal, false);
});

test("RULING 160: constraint 4 — an offer at a rate that is not on the published card is off-catalog", () => {
  const bespoke: Ledger = {
    ...WORKED_EXAMPLE,
    offers: [
      WORKED_EXAMPLE.offers[0],
      { ...WORKED_EXAMPLE.offers[1], id: "offer-2b", rateCardId: "special-deal-for-buyer-2" },
    ],
  };
  const defects = offCatalogOffers(bespoke);
  assert.equal(defects.length, 1);
  assert.equal(defects[0].offerId, "offer-2b");
  assert.match(defects[0].why, /off-catalog cut/);
});

test("RULING 160 + RULING 132: the ledger shares no VALUE SPACE with reader data", () => {
  /*
   * Asserted over value spaces, never over column names — checking names is
   * exactly how `feedback.reply_to` held a raw email address and was waved
   * through as a carefully-written exception (RULING 132, and RULING 110's
   * wrong-form search inside a test).
   *
   * The ledger's identifiers are: rate-card ids, buyer ids, offer ids, PUBLIC
   * ballot contest ids and PUBLIC candidacy ids. None of those is a world value
   * that identifies a person independently of us.
   */
  /*
   * **COMMENTS ARE STRIPPED FIRST, and that is not a loophole.** The module's
   * own prose explains what it does NOT hold — "no email belonging to a
   * reader" — so a sweep over the raw text fires on the sentence promising the
   * thing is absent. What is being asserted is a fact about the DATA SHAPES,
   * so the sweep reads the code. The plant below runs against the same
   * stripped text, so the instrument is still shown catching a real field.
   */
  const raw = readFileSync(join(ROOT, "lib", "business", "solicitation-ledger.ts"), "utf8");
  const source = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(source.includes("export interface Offer {"), "stripping comments removed the code too");

  const READER_VALUE_SPACES: Array<[string, RegExp]> = [
    ["an email address", /\bemail\b/i],
    ["a reader zip", /\bzip\b/i],
    ["a continuity key", /continuity|browserKey|deviceId/i],
    ["a reaction", /\breaction/i],
    ["a search-log row", /searchLog|search_log/i],
    ["an IP address", /\bip(?:Address)?\b/i],
    ["a phone number", /\bphone\b/i],
    ["a street address", /streetAddress|mailingAddress/i],
  ];
  for (const [name, shape] of READER_VALUE_SPACES) {
    assert.ok(
      !shape.test(source),
      `the solicitation ledger names ${name} — that is a join path to reader data`,
    );
  }

  // And the sweep is shown catching a real one, so a clean result can never be
  // an instrument that matched nothing (RULING 110).
  const planted = `${source}\nexport interface Leak { email: string; zip: string; }`;
  assert.ok(
    READER_VALUE_SPACES.some(([, shape]) => shape.test(planted)),
    "the value-space sweep cannot catch a planted reader field",
  );

  // The other direction: no collection store may reach the ledger.
  const collectionFiles = readdirSync(join(ROOT, "lib", "signal"));
  for (const f of collectionFiles) {
    if (!f.endsWith(".ts")) continue;
    const s = readFileSync(join(ROOT, "lib", "signal", f), "utf8");
    assert.ok(
      !s.includes("solicitation-ledger"),
      `lib/signal/${f} imports the solicitation ledger — the aggregation layer must not be able to reach it`,
    );
  }
});

test("RULING 160: an offer cannot carry a price of its own", () => {
  // Constraint 4, enforced by ABSENCE (the RULING 112 pattern): there is no
  // price field on an offer, so a bespoke number is not expressible. A typed
  // number is how an off-catalog cut gets made without anyone deciding to.
  const source = readFileSync(join(ROOT, "lib", "business", "solicitation-ledger.ts"), "utf8");
  const offerBlock = source.slice(
    source.indexOf("export interface Offer {"),
    source.indexOf("export interface Ledger {"),
  );
  assert.ok(offerBlock.length > 50, "the Offer interface could not be read — this guard measured nothing");
  for (const banned of ["priceCents", "price", "amount", "discount"]) {
    assert.ok(
      !new RegExp(`\\b${banned}\\b\\s*[?:]`).test(offerBlock),
      `Offer carries \`${banned}\` — a per-offer number is an off-catalog cut waiting to happen`,
    );
  }
});
