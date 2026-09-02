/**
 * **THE RULING 227 REGISTRY — every Needs Sean row, predicated or carded.**
 *
 * Session C Part B, 2026-08-31. Read `lib/tracker/predicates.mjs` first; it
 * carries the rule and the reasoning. This file is the data: one entry per open
 * Needs Sean row, and the build fails if a row is in neither this file's
 * predicate set nor its card set.
 *
 * ## The three proof cases
 *
 * `NH272`, `NH281` and `NH300` are the rows this mechanism was built from. All
 * three are P1. All three were named by the previous close-out as "what
 * requires you". All three were ALREADY FALSE when that sentence was written,
 * and each is false for a different reason, which is why they make a good test
 * of the shape:
 *
 * - `NH272` asks for a secret that already exists — the evidence is an artifact
 *   that could not have been produced without it.
 * - `NH281` describes a condition that has since changed — the evidence is a
 *   newer observation of the same thing the row measured.
 * - `NH300` asks for a proof to be run — the evidence is the proof, sitting in
 *   the repository, 7 of 7.
 *
 * Each predicate below reads a COMMITTED artifact and quotes the field it read.
 * None of them infers from effort, and none of them treats an unreadable file
 * as an answer in either direction.
 */

import {
  NOT_MACHINE_VERIFIABLE,
  cannotTell,
  holds,
  readArtifact,
  readText,
  resolvedByEvidence,
} from "./predicates.mjs";

/* ========================================================================== */
/* The three machine-verifiable blockers                                      */
/* ========================================================================== */

/**
 * **NH272 — "WTP_PRODUCTION_DATABASE_URL_READONLY is not a repository secret."**
 *
 * The blocker HOLDS while production integrity cannot read production.
 *
 * The evidence is `data/ops/production-integrity.json`, and the decisive thing
 * about it is not that it says 24 of 24 — it is WHICH FIELD says so and what
 * the alternative would have been. `scripts/production-integrity.mts` has one
 * classifier and it is exhaustive: exit 0 becomes `observed: "HELD"` with
 * `failureClass: null`, and an absent credential becomes
 * `observed: "COULD_NOT_TELL"` with `failureClass: "CREDENTIAL_ABSENT"` — that
 * branch matches on `db-shipping-gate.mts`'s own refusal string, "is not set in
 * this environment". So a HELD reading **cannot be produced by a machine
 * without the secret**. The row's premise is not merely stale; the artifact
 * that disproves it could not exist if the premise were true.
 *
 * And the 24-of-24 count is a live number, not a file count: it is built in
 * `lib/db/shipping-invariant.ts` from `appliedWhen`, which is rows returned by
 * a `SELECT` against production, not entries read off disk.
 */
export const nh272 = {
  rowId: "NH272",
  kind: "predicate",
  blocker:
    "the read-only production database URL is not available to CI, so the schema " +
    "shipping gate cannot ask production what it already holds",
  evaluate: ({ root }) => {
    const read = ["data/ops/production-integrity.json", "scripts/production-integrity.mts"];
    const record = readArtifact("data/ops/production-integrity.json", root);
    if (!record.ok) return cannotTell(record.why, { read });

    const classifier = readText("scripts/production-integrity.mts", root);
    if (!classifier.ok) return cannotTell(classifier.why, { read });
    /*
     * The predicate is only as good as the claim that CREDENTIAL_ABSENT is a
     * reachable alternative outcome. If that branch were ever deleted, "HELD"
     * would stop carrying the information this predicate rests on — so the
     * branch is checked for, and its absence is CANNOT_TELL rather than a pass.
     */
    if (!/CREDENTIAL_ABSENT/.test(classifier.value)) {
      return cannotTell(
        "scripts/production-integrity.mts no longer contains the CREDENTIAL_ABSENT " +
          "branch. Without it, an 'HELD' reading no longer proves the credential was " +
          "present, and this predicate has lost the thing it reasons from.",
        { read },
      );
    }

    const r = record.value ?? {};
    if (r.observed === "COULD_NOT_TELL" && r.failureClass === "CREDENTIAL_ABSENT") {
      return holds(
        "the newest production-integrity reading is COULD_NOT_TELL / CREDENTIAL_ABSENT — " +
          "the credential is still missing.",
        { read },
      );
    }
    if (r.observed !== "HELD" || r.failureClass !== null) {
      return cannotTell(
        `the newest production-integrity reading is observed="${r.observed}" ` +
          `failureClass="${r.failureClass}", which is neither a credential-absent ` +
          "reading nor a clean one. The row does not move on an ambiguous artifact.",
        { read },
      );
    }
    return resolvedByEvidence(
      "the credential EXISTS and is in use. Production integrity took a LIVE read.",
      {
        read,
        evidence: [
          `data/ops/production-integrity.json — observed "HELD", failureClass null, ` +
            `deployedSha ${String(r.deployedSha ?? "").slice(0, 12)}, observedAt ${r.observedAt}`,
          `data/ops/production-integrity.json — detail: ${r.detail}`,
          "scripts/production-integrity.mts — the only classifier: exit 0 becomes HELD, " +
            "and an unset WTP_PRODUCTION_DATABASE_URL_READONLY becomes " +
            "COULD_NOT_TELL/CREDENTIAL_ABSENT. A HELD reading cannot be produced without " +
            "the secret.",
          ".github/workflows/post-deploy-integrity.yml — the observe job passes " +
            "secrets.WTP_PRODUCTION_DATABASE_URL_READONLY into the step that takes this reading.",
          "lib/db/shipping-invariant.ts — the 'N of N applied' count is derived from rows " +
            "returned by production, not from files on disk.",
        ],
      },
    );
  },
};

/**
 * **NH281 — "Netlify production has not deployed since 71325247."**
 *
 * The blocker HOLDS while production is serving an older build than main.
 *
 * The honest instrument here is NOT Netlify's deploy state. This repository
 * holds no Netlify credential — `post-deploy-integrity.yml` says so in as many
 * words, and `NETLIFY_AUTH_TOKEN` is deliberately not a secret. So there is no
 * recorded `"state": "READY"` anywhere, and a predicate that went looking for
 * one would report CANNOT_TELL forever.
 *
 * What the repository DOES hold is better evidence for the question the row
 * actually asks. `scripts/post-deploy-observer.mts` polls `/api/build` on the
 * live site and writes an integrity record **only** on its `SERVING_EXPECTED`
 * branch; its `PRODUCTION_BEHIND` branch exits 3 and writes nothing, in its own
 * words: *"no integrity reading is recorded for a commit production does not
 * serve."* So `deployedSha` in a committed record is a SHA production was
 * OBSERVED SERVING — which is the fact the row is about, one step closer to the
 * record than the vendor's own status field. VENDOR != RECORD.
 *
 * The predicate therefore reads: is the newest observed-serving SHA still
 * `71325247`? It is not — it is `a36679be`, the PR #242 merge, and the record
 * before it observed `0bd520f3`. Two application-bearing releases have been
 * observed serving since the row was opened.
 */
export const nh281 = {
  rowId: "NH281",
  kind: "predicate",
  blocker:
    "production is serving an older build than main because every application-bearing " +
    "deploy since 71325247 has failed",
  evaluate: ({ root }) => {
    const read = ["data/ops/production-integrity.json", "scripts/post-deploy-observer.mts"];
    const record = readArtifact("data/ops/production-integrity.json", root);
    if (!record.ok) return cannotTell(record.why, { read });

    const observer = readText("scripts/post-deploy-observer.mts", root);
    if (!observer.ok) return cannotTell(observer.why, { read });
    /*
     * Same discipline as NH272: the record only means "production served this"
     * because the observer refuses to write one otherwise. If that refusal ever
     * goes away, `deployedSha` stops being an observation and this predicate
     * must stop trusting it.
     */
    if (!/SERVING_EXPECTED/.test(observer.value) || !/PRODUCTION_BEHIND/.test(observer.value)) {
      return cannotTell(
        "scripts/post-deploy-observer.mts no longer distinguishes SERVING_EXPECTED from " +
          "PRODUCTION_BEHIND. Without that refusal, a recorded deployedSha no longer " +
          "proves production served it.",
        { read },
      );
    }

    const r = record.value ?? {};
    const served = String(r.deployedSha ?? "").trim();
    if (!served) {
      return cannotTell("the production-integrity record carries no deployedSha", { read });
    }
    const STUCK_AT = "71325247";
    if (served.startsWith(STUCK_AT)) {
      return holds(
        `production is still observed serving ${STUCK_AT} — the row's premise stands.`,
        { read },
      );
    }
    return resolvedByEvidence(
      "production has published since. The newest observation is of a DIFFERENT, later " +
        "commit, and the observer only records a reading for a commit production actually serves.",
      {
        read,
        evidence: [
          `data/ops/production-integrity.json — deployedSha ${served.slice(0, 12)} ` +
            `observed "${r.observed}" at ${r.observedAt}; this is not ${STUCK_AT}`,
          `data/ops/production-integrity.json — detail: ${r.detail}`,
          "scripts/post-deploy-observer.mts — a record is written ONLY on SERVING_EXPECTED; " +
            "the PRODUCTION_BEHIND branch exits 3 and writes nothing, so a recorded " +
            "deployedSha is a SHA production was observed serving.",
          "git history of data/ops/production-integrity.json — the two application-bearing " +
            "releases named in the reconciliation were each observed and recorded by " +
            "post-deploy-observer[bot]: 0bd520f3 (PR #239) at 2026-08-31T20:42:25.564Z in " +
            "commit 0579a0a9, and a36679be (PR #242) at 2026-09-01T01:08:13.063Z in commit d0a050e1.",
          "NOTE ON VOCABULARY: this repository holds no Netlify credential " +
            "(.github/workflows/post-deploy-integrity.yml states NETLIFY_AUTH_TOKEN is " +
            "deliberately not a secret), so no Netlify deploy-state 'READY' field is " +
            "recorded anywhere. The recorded state is HELD, and the recorded fact is " +
            "'production was observed serving this SHA'.",
        ],
      },
    );
  },
};

/**
 * **NH300 — "WTP_CONTROL_PLANE_DATABASE_URL is not provisioned, so RULING 220's
 * provider cannot be proved."**
 *
 * The blocker HOLDS while no live-Postgres proof exists.
 *
 * `data/health/control-plane-proofs/proof-mthbrw87.json` is that proof, and the
 * field that settles the provider question is `provider`. It is not a label
 * somebody typed: it is `repos.describe()`, and the three implementations emit
 * distinguishable strings — `pg-store.ts` says "Postgres control-plane
 * repositories (schema v2, connection named by WTP_CONTROL_PLANE_DATABASE_URL)",
 * `file-store.ts` says "durable control-plane repositories rooted at …", and
 * `memory.ts` says "in-memory …". Only the Postgres factory can have produced
 * this record. `scripts/control-plane-proof.mts` also refuses to run at all
 * without the credential, in its own words: *"NOTHING WAS PROVEN."*
 *
 * Seven proofs, `passed: 7` of `total: 7`, and the seven are exactly RULING
 * 220's step 6: schema/drift, two-process lease contention, killed-worker
 * reclaim, concurrent append ordering, indexed next-due, cross-process debt
 * inheritance, and dump/wipe/restore.
 *
 * **This predicate is the first thing in the repository that reads these
 * proofs.** Nothing else did — not a test, not the control-plane gate, which
 * mentions the directory only in a printed sentence.
 */
export const nh300 = {
  rowId: "NH300",
  kind: "predicate",
  blocker:
    "no control-plane database credential exists, so the Postgres provider behind " +
    "RULING 220 has never been exercised against a live database",
  evaluate: ({ root }) => {
    const read = [
      "data/health/control-plane-proofs/proof-mthbrw87.json",
      "lib/control-plane/repository/pg-store.ts",
    ];
    const proof = readArtifact("data/health/control-plane-proofs/proof-mthbrw87.json", root);
    if (!proof.ok) return cannotTell(proof.why, { read });

    const p = proof.value ?? {};
    const provider = String(p.provider ?? "");
    if (!/^Postgres control-plane repositories/.test(provider)) {
      return holds(
        `the newest control-plane proof was produced by "${provider || "an unnamed provider"}", ` +
          "which is not the Postgres lane. A file-provider or in-memory run proves nothing " +
          "about the credential.",
        { read },
      );
    }
    const passed = Number(p.passed);
    const total = Number(p.total);
    if (!Number.isFinite(passed) || !Number.isFinite(total) || total === 0) {
      return cannotTell("the proof record carries no readable passed/total counts", { read });
    }
    if (passed !== total) {
      return holds(
        `the Postgres proof ran but only ${passed} of ${total} proofs passed. A partial ` +
          "proof is not a proof.",
        { read },
      );
    }
    const names = (Array.isArray(p.proofs) ? p.proofs : []).map(
      (x) => `${x.id}: ${x.title} — ${x.passed ? "passed" : "FAILED"}`,
    );
    return resolvedByEvidence(
      "the credential was provisioned and RULING 220's step 6 HAS been run against live " +
        "Postgres, 7 of 7.",
      {
        read,
        evidence: [
          `data/health/control-plane-proofs/proof-mthbrw87.json — lane "${p.lane}", ` +
            `provider "${provider}", schemaVersion ${p.schemaVersion}, passed ${passed} of ${total}, ` +
            `run "${p.run}" at ${p.at}`,
          ...names,
          "lib/control-plane/repository/pg-store.ts — the provider string is repos.describe() " +
            "and only the Postgres factory emits it; file-store.ts and memory.ts emit " +
            "distinguishably different strings.",
          "scripts/control-plane-proof.mts — refuses to run without " +
            "WTP_CONTROL_PLANE_DATABASE_URL and prints 'NOTHING WAS PROVEN'; the record " +
            "therefore cannot exist without the credential.",
          "data/health/control-plane-proofs/proof-mthbrw87-dump.json — the P7 restore drill's " +
            "own artifact: a 15-table dump of the live control plane taken before the wipe.",
        ],
      },
    );
  },
};

/* ========================================================================== */
/* The decision cards                                                         */
/* ========================================================================== */

/**
 * A card is the other half of RULING 227. It is what a row must carry when no machine
 * can decide it, and it exists so that a Needs Sean row is READABLE AS A
 * DECISION rather than as a description of a wall.
 *
 * Four required parts, and the fourth is the one the tracker never had:
 *
 * - `whatIsNeeded` — the decision, in one sentence, in the imperative.
 * - `whyNoMachineCanDecide` — why this is not a predicate. If this sentence is
 *   weak, the row probably wants a predicate instead, and that is the point of
 *   making it mandatory.
 * - `options` — each with its CONSEQUENCE. A decision presented without its
 *   consequences is a question, not a decision.
 * - the row's AGE, which is not stored here: it is joined on at render time
 *   from the derived `Opened on` column, because a card that carried its own
 *   copy of the date would go stale the way everything else did.
 *
 * @param {string} rowId
 * @param {string} whatIsNeeded
 * @param {string} whyNoMachineCanDecide
 * @param {{option: string, consequence: string}[]} options
 */
function card(rowId, whatIsNeeded, whyNoMachineCanDecide, options) {
  return { rowId, kind: NOT_MACHINE_VERIFIABLE, whatIsNeeded, whyNoMachineCanDecide, options };
}

/** Shorthand for the two options every approval row really has. */
const APPROVE_OR_REFUSE = (what, ifApproved, ifRefused) => [
  { option: `Approve ${what}`, consequence: ifApproved },
  { option: `Refuse ${what}`, consequence: ifRefused },
];

export const CARDS = [
  /* ---- the autonomy-recovery session, 2026-09-01 ---- */
  card(
    "RO08",
    "Choose the pilot runner's backlog drain rate: keep 100 dispatches per hourly cycle, raise the ceiling, or shorten the interval.",
    "Nothing is stuck and no measurement settles this. The runner now recovers on its own; what " +
      "remains is a trade the owner makes between drain speed and load on publishers and on Neon. " +
      "2,996 standing obligations, roughly 2,900 due at any moment because most have never been " +
      "discharged, 1,144 with open occurrences; a cycle starts at most --max (default 100) and " +
      "cycles are --interval (default 60 min) apart, so a full first pass takes more than a day. " +
      "Per-host spacing and debt backoff apply under every option, so no choice can hot-loop a publisher.",
    [
      {
        option: "Keep 100 per hour (the default; nothing to change)",
        consequence:
          "lowest load; the slowest drain — about 100 obligations an hour against roughly 2,900 due.",
      },
      {
        option: "Raise --max to 300 with the same interval",
        consequence:
          "three times the drain and three times the Neon round trips and publisher requests per " +
          "cycle; the cycle still ends on its 15-minute dispatch budget inside the runner's " +
          "20-minute ceiling, so the extra items are deferred by name rather than run over time.",
      },
      {
        option: "Shorten --interval to 30 minutes at 100",
        consequence:
          "twice the drain at the same per-cycle cost; the fixed pre-dispatch overhead (about nine " +
          "minutes of serial Neon work today) is paid twice as often.",
      },
    ],
  ),
  /* ---- the owner's 8.30.26 sweep, and the three the brief names by hand ---- */
  card(
    "OWN01",
    "Send the capture you saw, or the address and date that produced the 7-versus-6 body count on Who Governs Here.",
    "The defect does not reproduce: at 85641 the panel now reports 9 bodies and renders 9 rows. " +
      "A defect that cannot be reproduced cannot be placed against a build, and it is the only " +
      "row in the sweep with no screenshot. No artifact in the repository records the state you saw.",
    [
      {
        option: "Send the capture or the exact address and date",
        consequence:
          "the state is placed against a build and either fixed or shown to have been fixed already.",
      },
      {
        option: "Say it is no longer reproducible and close it",
        consequence:
          "the row closes as unreproducible. If the underlying linkage defect is real it will " +
          "resurface in a later sweep, and the next report will have no prior capture either.",
      },
    ],
  ),
  card(
    "OWN05",
    "Approve adding a source for state executive-action records, and name which publisher it should be.",
    "Adding an external source is on CLAUDE.md's ask-before list by name. There is also a genuine " +
      "editorial choice underneath it: the Secretary of State's bill history, the Governor's own " +
      "office, and a third-party aggregator are three different records with three different " +
      "provenance stories, and picking one is not a technical call. lib/sources/ holds no " +
      "executive-action adapter at all today.",
    [
      {
        option: "Arizona Secretary of State bill history",
        consequence:
          "first-party and authoritative for what became law; it records the bill's fate, not the " +
          "Governor's reasoning, so the 151 veto/signing letters stay unreadable without NH274's OCR.",
      },
      {
        option: "The Governor's own office",
        consequence:
          "first-party for the reasoning and the natural home of the signing letters, but it is a " +
          "single-office publisher and covers no other statewide executive.",
      },
      {
        option: "Neither — leave the governor's legislative record null",
        consequence:
          "BAL-36 renders its named gap indefinitely. The gap is honest and the reader sees " +
          "'we haven't recorded this yet', which is a fact about us and reads as one.",
      },
    ],
  ),
  card(
    "OWN06",
    "Approve adding an address-suggestion source, name which one, and decide whether partial addresses may leave this product as the reader types.",
    "Two decisions in one row and neither is technical. The first is ask-before (an external " +
      "source). The second is a PRIVACY decision reserved to you: typeahead means keystrokes " +
      "leave the reader's browser before they have chosen anything, which is a collection " +
      "surface the transparency page does not currently describe. The Census geocoder has no " +
      "typeahead endpoint, and data/voting-sites.json plus the ZCTA store hold points and " +
      "polygons rather than an address universe — so there is no way to build this without a " +
      "third party seeing partial addresses.",
    [
      {
        option: "Approve a third-party suggester and accept that partial addresses leave the product",
        consequence:
          "autocomplete works as readers expect it to. The transparency page must be amended in " +
          "the same change, because it would otherwise be false, and reader friction rules make " +
          "that disclosure one of the three permitted frictions.",
      },
      {
        option: "Approve a suggester but require it be proxied through this product",
        consequence:
          "no partial address reaches the third party with the reader's identity attached; costs " +
          "a server round-trip per keystroke and a rate-limiting design.",
      },
      {
        option: "Refuse — no autocomplete",
        consequence:
          "BAL-37 stays as reported. Readers type the whole address, which is the current " +
          "behaviour and is a real friction on mobile.",
      },
    ],
  ),
  card(
    "OWN02",
    "Approve acquiring and shipping the 5 Tucson portraits at the 480x720 resolution tucsonaz.gov publishes, and decide what happens to the other 138 low-resolution portraits.",
    "RULING 55 reserves photo review to you, and a decision is about an IMAGE rather than about a " +
      "person: a 480x720 original is a different image from the 150x150 crop we hold, so it needs " +
      "its own review. No machine may take that decision.",
    [
      {
        option: "Approve the 5, and re-acquire the 138 at source resolution",
        consequence:
          "the display defect is fixed everywhere; 143 images enter the review queue and each " +
          "still needs your approval under RULING 55.",
      },
      {
        option: "Approve the 5 only",
        consequence: "85701 looks right and the other 138 keep rendering soft.",
      },
      { option: "Refuse", consequence: "the 150x150 crops continue to render at display size." },
    ],
  ),
  /*
   * **OWN03's CARD IS GONE, AND ITS FINDING IS NOT.**
   *
   * The card that stood here is now the predicate `own03` above: the author
   * approved the nine on 2026-09-01, and `data/photos/review.json` records that
   * decision per image, so the row auto-resolves on his own evidence rather
   * than waiting for a keystroke he has already made.
   *
   * The correction it carried is preserved where it belongs — the row's own
   * text said the nine were "Mayes, Fontes and Horne among them" and **Horne
   * was never one of them**; his decode was a Cloudflare challenge page, so
   * approving his image was never possible. That is written up in full at
   * `docs/owner-audit/own03-portrait-count-correction.md`, asserted by
   * `tests/tracker-predicates.test.ts`, and restated in the predicate's own
   * evidence. Horne stays hunt work under RULING 206.
   */

  /**
   * **NH303 — THE SAME PHOTOGRAPHS, AT THE SIZE THE COMMISSION ACTUALLY
   * PUBLISHES THEM.** (Opened 2026-09-01 by the OWN03 promotion.)
   *
   * This is a card and not a predicate for the reason OWN03's card gave and
   * OWN03's predicate did not overturn: **a machine cannot decide FOR him.**
   * OWN03 became a predicate only once he had decided, at which point the
   * question was whether he HAD decided — observable. Nobody has decided this
   * one yet, so there is nothing to observe.
   *
   * The four are Myers, Walden, Márquez Peterson and Lopez. Their approved
   * portraits are 133x200, 133x200, 165x206 and 137x206 against a 184px large-
   * card floor, and the reason is a CMS rendition rather than the
   * Commission's own photography: `tmb-thumb200` and `MaxWidth=165` in the
   * path. Removing those parameters on the same host returns 3275x4913,
   * 3138x4707, 2828x3600 and 2533x3800 — HTTP 200 on all four, 2026-09-01.
   *
   * **Nothing is blocked while this waits.** The approved thumbnails render,
   * so a reader sees a face either way, and that is exactly what RULING 55
   * means by a photo never blocking anything.
   */
  card(
    "NH303",
    "Approve or refuse the four full-resolution AZCC originals — Myers, Walden, Márquez Peterson and Lopez — which are the same photographs you already approved, at 2533-3275px instead of 133-165px.",
    "RULING 55: a decision is about an IMAGE, not a person. A 3275px original is a different " +
      "file from the 133px crop you approved on 2026-09-01, so shipping it would be your " +
      "approval inherited by an image you have not seen — the exact hole the ruling closes. " +
      "A machine can observe that you decided; it cannot decide for you, which is why this is " +
      "a card where OWN03 is now a predicate.",
    APPROVE_OR_REFUSE(
      "the four full-resolution originals",
      "the four Corporation Commissioners rise above the large card's 184px floor and " +
        "tests/portrait-resolution.test.ts's shortfall ceiling drops from 148 back toward 144.",
      "the approved thumbnails keep rendering, which is honest and already live; the cards " +
        "stay soft where a portrait is shown large, and the frontier keeps the note.",
    ),
  ),
  card(
    "OWN04",
    "Say what was wrong with the Katie Hobbs portrait on the ballot beyond resolution, or send a capture of it.",
    "The report says 'renders badly' and resolution is separately tracked in OWN02. If the actual " +
      "defect is the CROP then it is a different fix from the resolution work, and nothing in the " +
      "repository records which one you saw. Guessing between them would be inventing the defect.",
    [
      {
        option: "It is the crop",
        consequence: "a crop fix is buildable now and does not wait on OWN02.",
      },
      {
        option: "It is the resolution",
        consequence: "the row merges into OWN02 and closes with it.",
      },
      {
        option: "Send the capture",
        consequence: "the defect is placed against a build and classified without guessing.",
      },
    ],
  ),

  /* ------------------------------- the business and legal decisions -------- */
  card(
    "B01",
    "Settle the product's name.",
    "A name is not derivable from any artifact. Several rows wait on it — B02 cannot start, and " +
      "every marketing surface is provisional until it lands.",
    [
      {
        option: "Keep Meanwhile",
        consequence: "one file changes, the site follows, and B02 can begin against three classes.",
      },
      {
        option: "Choose another name",
        consequence: "same single-file change; B02's trademark search restarts against the new name.",
      },
      {
        option: "Defer",
        consequence: "B02 stays blocked and every reader-facing surface keeps a placeholder name.",
      },
    ],
  ),
  card(
    "B02",
    "Commission a trademark search in the three classes this product would file under.",
    "Cannot usefully happen until B01 settles the name, and commissioning paid legal work is your " +
      "spend decision.",
    [
      { option: "Commission it once B01 lands", consequence: "filing risk is known before launch." },
      {
        option: "Defer past launch",
        consequence: "the product launches under a name that may have to change afterwards.",
      },
    ],
  ),
  card(
    "B03",
    "Decide what legal entity this becomes.",
    "An entity choice is yours alone and has tax and governance consequences no artifact can weigh.",
    [
      {
        option: "LLC now, public benefit corporation after the buyer calls",
        consequence: "cheapest path; conversion cost later, and B04's registrations are filed twice.",
      },
      {
        option: "Public benefit corporation now",
        consequence: "one filing, higher cost and more formality before there is revenue.",
      },
      {
        option: "Plain C-corp",
        consequence: "conventional for investors; the mission constraints are then contractual rather than chartered.",
      },
    ],
  ),
  card(
    "B04",
    "Decide whether to register as a data broker in California, Vermont, Texas and Oregon, and when.",
    "A registration obligation with annual deadlines and per-day penalties. Whether it attaches " +
      "depends on the entity (B03) and on counsel's reading (B05), and the filing is yours to make.",
    [
      {
        option: "Register in all four now",
        consequence: "penalty exposure ends; annual fees and renewal obligations begin before revenue.",
      },
      {
        option: "Register when the first sale closes",
        consequence: "cost deferred; per-day penalties accrue from the date the obligation attached, not from the sale.",
      },
    ],
  ),
  card(
    "B05",
    "Retain counsel — one on privacy and one on election law.",
    "Retaining and paying counsel is yours. Both have long lead times and B09, D23, PB10 and B07 " +
      "are all waiting on the answers.",
    [
      {
        option: "Retain both now",
        consequence: "four blocked rows unblock; ongoing legal spend begins.",
      },
      {
        option: "Retain election-law counsel first",
        consequence: "PB10 and D23 unblock; the privacy questions behind T02 and T03 stay open.",
      },
      { option: "Defer", consequence: "four rows stay blocked and the retrieval posture stays untested." },
    ],
  ),
  card(
    "B07",
    "Decide the pricing methodology, including for pilots.",
    "Selling to a campaign below fair market value can count as an in-kind political contribution, " +
      "so this is a legal-exposure decision as much as a commercial one. It needs B05's counsel and " +
      "your commercial judgement; no artifact contains either.",
    [
      {
        option: "Document a fair-market rate card, pilots included",
        consequence: "in-kind exposure is defensible; pilots cannot be free.",
      },
      {
        option: "Free pilots",
        consequence: "fastest route to the first five buyers and the largest in-kind exposure.",
      },
    ],
  ),
  card(
    "B09",
    "Put the vendor-terms question to counsel: can a software vendor's terms of use narrow the public's statutory right to records a body must publish?",
    "This is a legal opinion. The product's whole retrieval posture rests on the answer being no, " +
      "and a session cannot supply it — reading the terms is not the same as ruling on them.",
    [
      {
        option: "Ask counsel now",
        consequence: "the acquisition doctrine's vendor-is-not-the-record position is either confirmed or must change.",
      },
      {
        option: "Proceed on the current reading",
        consequence:
          "retrieval continues as today under CLAUDE.md's vendor != record rule, with the legal " +
          "question untested.",
      },
    ],
  ),
  card(
    "D23",
    "Record exactly what the FEC's commercial-use restriction on individual donor names and addresses covers, before any code touches it.",
    "A statutory reading, and PB10 is explicitly held until it lands. Counsel (B05) is the source.",
    [
      {
        option: "Get the written reading",
        consequence: "PB10 unblocks and the line is drawn on paper before code exists.",
      },
      {
        option: "Stay at committee totals only",
        consequence: "no restriction can be breached; individual-donor signal is permanently out of scope.",
      },
    ],
  ),
  card(
    "PB10",
    "Decide whether to read individual donors out of federal campaign-finance data, once D23's reading exists.",
    "Held on an election-law ruling that does not exist yet. The block is genuine and its release " +
      "is a legal judgement, not an artifact.",
    [
      {
        option: "Proceed within whatever D23 permits",
        consequence: "the richest federal money signal becomes available, inside a documented line.",
      },
      { option: "Do not", consequence: "committee totals remain the ceiling for federal money." },
    ],
  ),
  card(
    "T01",
    "Approve the transparency page copy — what is collected, how it is used, and that anonymous totals may be sold.",
    "It has to be true before any marketing exists, and approving a public statement about your " +
      "own product's data practices is yours.",
    [
      { option: "Approve as drafted", consequence: "marketing surfaces can be written against it." },
      { option: "Revise", consequence: "the page changes and NH246's findability work re-runs against the new copy." },
    ],
  ),
  card(
    "T02",
    "Decide the identity-verification posture: proving a real person answers without learning who they are.",
    "A product-values decision with a privacy cost on each side, and CLAUDE.md's collect-the-minimum " +
      "rule makes adding any signal an ask-before.",
    [
      {
        option: "Weighted signals, nobody gated",
        consequence: "no reader is turned away; the signal carries some fraudulent responses, weighted down.",
      },
      {
        option: "Gate on a phone check",
        consequence: "cleaner signal; readers without a qualifying number are excluded, which is reader friction.",
      },
      { option: "Neither", consequence: "reaction data stays unweighted and its buyers must be told so." },
    ],
  ),
  card(
    "T03",
    "Commission a security review before a single real person's political opinions are stored.",
    "A spend and scheduling decision, and the thing it protects is the one failure the product " +
      "cannot survive.",
    [
      {
        option: "Commission it before storing real opinions",
        consequence: "launch waits on the review; the breach risk is assessed by somebody qualified.",
      },
      {
        option: "Store first, review after",
        consequence: "real political opinions sit in a store nobody independent has examined.",
      },
    ],
  ),
  card(
    "T05",
    "Stand up the abuse review path — the people and the process behind the written policy.",
    "The policy is written and the path behind it does not exist. NH165's held queue has severe " +
      "Speak Your Mind rows waiting with nowhere to be read, and no free-text answer can be " +
      "accepted until somebody can act on a threat. Staffing a human review path is not buildable.",
    [
      {
        option: "Name yourself as the reviewer and build the surface",
        consequence: "NH165 unblocks and free-text can be accepted; the queue lands on you personally.",
      },
      {
        option: "Retain a moderation service",
        consequence: "the path scales and costs money; third-party access to reader free text needs its own disclosure.",
      },
      {
        option: "Keep free text off",
        consequence: "T05 and NH165 both stay open and Speak Your Mind stays gated.",
      },
    ],
  ),
  card(
    "T06",
    "Hand-grade a hundred real answers against the verification tiers before any automatic classifier touches them.",
    "The hand pass is what tells you whether the tiers mean anything, and it is a judgement exercise " +
      "by definition — a machine grading them would be grading itself.",
    [
      { option: "Do the hundred", consequence: "the tiers are calibrated against your judgement before automation." },
      { option: "Skip to a classifier", consequence: "the tiers are automated without anybody having checked they mean anything." },
    ],
  ),
  card(
    "T07",
    "Supply the escalation contacts the abuse policy points at — local police, the state agency per state, the Capitol Police threat unit.",
    "A policy pointing at nothing cannot be followed. Assembling real contacts for real agencies is " +
      "an offline act, and RULING 215 removes external-workflow execution from the architecture.",
    [
      { option: "Assemble the file", consequence: "the abuse policy becomes followable and T05's path has somewhere to escalate to." },
      { option: "Narrow the policy to what can actually be done", consequence: "the policy stops promising an escalation that does not exist." },
    ],
  ),
  card(
    "C01",
    "Approve building a mock export — one Pima County measure, synthetic clearly-labelled numbers.",
    "A sales artifact. Whether to build one, and what it may imply, is a commercial decision, and " +
      "CLAUDE.md's business rules constrain what an export may say.",
    [
      { option: "Build it", consequence: "buyer calls (V01) have something concrete; synthetic data must be unmistakably labelled." },
      { option: "Do not", consequence: "V01's conversations are abstract." },
    ],
  ),
  card(
    "C02",
    "Approve the buyer dashboard as a product surface, and its scope.",
    "A commercial product decision with a hard constraint attached: no user-to-user surface, and no " +
      "aggregate of reader input may render back to users. Scoping that is yours.",
    [
      { option: "Build it", consequence: "buyers self-serve; every view must be checked against the no-render-back rule." },
      { option: "Deliver files instead (C03)", consequence: "less product surface to build and to police." },
    ],
  ),
  card(
    "C03",
    "Decide the export format and delivery — schema, confidence mix on every row, moderation exclusions, and the citable snapshot id.",
    "What a buyer receives is a commercial and editorial decision, and the confidence-mix and " +
      "exclusion fields are disclosure choices rather than technical ones.",
    [
      { option: "File delivery with a snapshot id", consequence: "citable and auditable; no dashboard to build." },
      { option: "API", consequence: "buyers integrate directly; rate and access control become ongoing work." },
    ],
  ),
  card(
    "C04",
    "Decide whether to publish a calibration log — what the signal predicted before each election and how it turned out, including the misses.",
    "Publishing your own misses is a credibility strategy, not an engineering call.",
    [
      { option: "Publish including misses", consequence: "strongest credibility claim available; the misses are public forever." },
      { option: "Do not publish", consequence: "no public scoreboard, and the accuracy claim rests on assertion." },
    ],
  ),
  card(
    "V01",
    "Hold five buyer conversations — campaign consultants, party data staff, PAC data directors, at least one on each side — and put the exclusivity question to them.",
    "Conversations with people. RULING 215 removes external communications from what agents execute.",
    [
      { option: "Hold them", consequence: "exclusivity, pricing (B07) and the export shape (C03) all get real input." },
      { option: "Build first", consequence: "the commercial half is designed without contact with its buyers." },
    ],
  ),
  card(
    "V03",
    "Decide whether to build the throwaway Legistar prototype against three to five cities.",
    "The finding could change the product's shape, so the decision to spend the time is yours. Much " +
      "of the underlying question has since been answered by the hunt work, which is why this is a " +
      "decision rather than an open build.",
    [
      { option: "Build it", consequence: "the local-meetings thesis is tested cheaply before more is invested." },
      { option: "Rely on the hunt evidence", consequence: "no prototype cost; the thesis rests on the adapters already shipped." },
    ],
  ),
  card(
    "V04",
    "Decide whether to build the alignment grid for one real Pima County down-ballot race.",
    "It is the end-to-end test of whether the sourcing holds up — and it sits close to CLAUDE.md's " +
      "hard line: nothing may rank, score or order candidates, or render a match or alignment. " +
      "Whether a 'grid' can exist without becoming that is your call, and it is on the ask-before list.",
    [
      {
        option: "Build it strictly as side-by-side sourced positions with no ordering",
        consequence: "the sourcing is tested end to end; every rendering must be checked against the no-recommendation rule.",
      },
      {
        option: "Do not",
        consequence: "the end-to-end sourcing test does not happen, and the rule stays comfortably far away.",
      },
    ],
  ),
  card(
    "V05",
    "Write the answer to the buyer who asks why this beats a thirty-thousand-dollar tracking poll.",
    "A positioning argument in your voice, needed before the first meeting rather than after it.",
    [
      { option: "Write it before V01", consequence: "the five calls are useful." },
      { option: "Go in without it", consequence: "the first call becomes the rehearsal." },
    ],
  ),
  card(
    "V06",
    "Run the reading-level test — read the plain-language output back to real people with real questions.",
    "Synthetic test questions cannot tell you whether the output is actually plain. It needs real " +
      "people, which is an offline act.",
    [
      { option: "Run it", consequence: "the plain-language claim is tested against readers rather than asserted." },
      { option: "Ship on the current copy", consequence: "the claim rests on nobody having checked." },
    ],
  ),
  card(
    "V07",
    "Decide whether the ed-tech / schools version is a direction this product takes.",
    "A tester's suggestion and a business-direction question. It is already parked; the row exists " +
      "so the parking is visible rather than forgotten.",
    [
      { option: "Pursue", consequence: "a second product surface and a different buyer; splits focus before the first launch." },
      { option: "Decline and close", consequence: "the idea is recorded in the resolved store and stops occupying the queue." },
    ],
  ),
  card(
    "V08",
    "Decide whether to build the candidate coverage-gap report — a candidate-facing surface showing what the product holds on them next to their opponents.",
    "Your idea, and it sits against the neutrality rules: showing a candidate their coverage next to " +
      "an opponent's is a comparison surface, and CLAUDE.md forbids ordering candidates by anything " +
      "but a neutral criterion. Whether coverage-completeness is such a criterion is a judgement.",
    [
      {
        option: "Build it as a per-candidate view with no opponent comparison",
        consequence: "candidates can fill their own gaps; no comparison surface is created.",
      },
      {
        option: "Build it with the side-by-side",
        consequence: "strongest incentive to respond, and it must be checked hard against the no-ranking rule.",
      },
      { option: "Do not build it", consequence: "thin cards stay thin until the hunt fills them." },
    ],
  ),
  card(
    "X02",
    "Decide whether to pursue five Instagram content creators as a distribution channel.",
    "A marketing spend and relationship decision; RULING 215 removes agent-executed outreach.",
    [
      { option: "Pursue", consequence: "cheapest distribution available to an unknown product." },
      { option: "Do not", consequence: "distribution rests on the podcast pitch (X03) and organic reach." },
    ],
  ),
  card(
    "X03",
    "Write and send the podcast pitch.",
    "Your voice and your relationships; agents do not execute outreach.",
    [
      { option: "Send it", consequence: "a distribution channel opens." },
      { option: "Do not", consequence: "X02 carries distribution alone." },
    ],
  ),

  /* -------------------------------- product, copy and design judgements ---- */
  card(
    "NH08",
    "Confirm that Newbury's Selectboard reads right now that it shows meetings from two sources at once.",
    "RULING 31's P-level definitions make this a LOOK-AT-IT row: new information landed and the " +
      "question is whether it reads correctly to a person. No assertion by a machine substitutes " +
      "for your reading of it.",
    [
      { option: "It reads right", consequence: "the two-source merge is confirmed and the pattern is reusable elsewhere." },
      { option: "It does not", consequence: "the dedupe rule that prefers the copy with an agenda attached is revisited." },
    ],
  ),
  card(
    "NH43",
    "Rule on the three bodies at 03255 that no branch and no manual route reached.",
    "RULING 60's residual. Every branch is walked and each is listed with what it returned; what " +
      "remains is a judgement about whether to keep hunting, accept a human/offline route, or " +
      "record the limit. Under the acquisition doctrine the obligation stays live either way, so " +
      "this is a direction decision rather than a closure.",
    [
      { option: "Keep hunting with new methods", consequence: "the obligation stays open and the ladder grows; effort is uncapped by RULING 177." },
      { option: "Record as PUBLIC RECORD STILL OWED — HUMAN/OFFLINE ACCESS REQUIRED", consequence: "the machine routes are declared spent and the obligation stays live and visible." },
    ],
  ),
  card(
    "NH105",
    "Approve the candidate questionnaire message before 272 real candidates receive it.",
    "272 real people receive whatever this says. Approving outbound copy addressed to the public is " +
      "yours, and RULING 215 removes the sending itself from what agents do.",
    APPROVE_OR_REFUSE(
      "docs/candidate-questionnaire-invitation.md as drafted",
      "the invitation list can be worked; every row still carries invitedOn null until something sends.",
      "the message is rewritten and nothing is sent.",
    ),
  ),
  card(
    "NH108",
    "Take the four decisions that must precede any questionnaire being sent — they are yours, not buildable.",
    "The instrument is built and 272 invitations are generated with invitedOn null, so nothing has " +
      "been sent to anybody. Sending is not a build; it is four decisions about contacting real " +
      "people, and NH104 (the page they type into) is the only buildable part.",
    [
      { option: "Take the four decisions", consequence: "the questionnaire can go out and candidate-supplied positions become a source." },
      { option: "Defer", consequence: "the instrument sits built and unused; candidate cards stay as thin as the hunt leaves them." },
    ],
  ),
  card(
    "NH164",
    "Review the Speak Your Mind disclosure line as shipped, under your BC-11 ruling.",
    "Your BC-11 ruling asked for it to be drafted, marked COPY for your review, and shipped as " +
      "drafted meanwhile. It is shipped. The review is the outstanding half and it is a copy " +
      "judgement.",
    [
      { option: "Approve as shipped", consequence: "the line is settled and the COPY marking clears." },
      { option: "Revise", consequence: "the disclosure changes; it is reader-facing consent copy, so the change ships immediately." },
    ],
  ),
  card(
    "NH165",
    "Decide where you will read the held Speak Your Mind queue — severe rows are waiting and T05 is why there is nowhere to read them.",
    "Rule 4 of your BC-11 ruling is built: nothing is auto-forwarded and menacing content is stored " +
      "HELD and excluded from everything. What does not exist is the surface where you read it, and " +
      "building a review surface without a review process (T05) would create a queue nobody works.",
    [
      { option: "Build the surface and review them yourself", consequence: "the held rows get read; T05's path is you." },
      { option: "Resolve T05 first", consequence: "this row waits on a genuine dependency rather than on a preference." },
    ],
  ),
  card(
    "NH166",
    "Rule on the two questions behind the TUSD superintendent's photo, which was not sourced this session.",
    "RULING 55 reserves photo decisions to you, and the row raises two rule questions rather than " +
      "asking for a build.",
    [
      { option: "Rule and let the acquisition proceed", consequence: "OFF-3 completes and the rule generalises to the rest of the board." },
      { option: "Leave it unsourced", consequence: "the officials surface keeps its named gap for the superintendent." },
    ],
  ),
  card(
    "NH174",
    "Approve the four door-2 portraits of sitting officials queued for you.",
    "RULING 55 again: pnpm door2 walked all 19 candidacies on the 07866 ballot in the class your " +
      "8/24 ruling pre-approves, at the member's own page. The acquisition is done; only your " +
      "review remains.",
    APPROVE_OR_REFUSE(
      "the four queued portraits",
      "four more sitting officials render with photos at 07866.",
      "those four keep their named gap.",
    ),
  ),
  card(
    "NH194",
    "Choose a dark-mode map contrast direction, or say none of the captured options.",
    "You said the boundaries read as overwhelming in dark and deliberately did not specify a fix. " +
      "Choosing between visual options is a taste judgement no instrument can make. NH200 carries " +
      "the three captured options for the same DARK-1 question; this row is the request for a " +
      "direction and NH200 is the menu.",
    [
      { option: "Pick one of NH200's three", consequence: "DARK-1 closes and both rows resolve together." },
      { option: "None of them — describe what you want instead", consequence: "a new set is captured against your description." },
    ],
  ),
  card(
    "NH200",
    "Pick one of the three captured dark-map options, or none.",
    "Three concrete options are captured side by side and nothing is shipped. Which one reads right " +
      "is yours; this is the menu for the DARK-1 question NH194 raises.",
    [
      { option: "Option 1, 2 or 3", consequence: "that treatment ships and DARK-1 closes with NH194." },
      { option: "None", consequence: "a further set is captured; the map keeps shipping as it is meanwhile." },
    ],
  ),
  card(
    "NH246",
    "Approve the drafted summary copy that makes the existing transparency disclosure findable.",
    "The information is NOT missing — /transparency is a 470-line page with nine sections. A tester " +
      "could not FIND it, which is a copy and placement judgement, and the draft is in the row.",
    [
      { option: "Approve the drafted summary", consequence: "the disclosure becomes findable from where readers actually look." },
      { option: "Revise", consequence: "reader-facing consent-adjacent copy changes and ships." },
    ],
  ),
  card(
    "NH299",
    "Fill in the owner corpus: it holds two facts and zero questions against a brief that expected five and five.",
    "The corpus IS your judgement — it is the answer key the truth instruments are measured against, " +
      "and a session authoring it would be marking its own homework. docs/Meanwhile-Owner-Checklist.xlsx " +
      "has three CONFIRMED rows of which one is the workbook's own example, and the Adversarial " +
      "questions tab has Keep? blank on all twelve.",
    [
      { option: "Author the five and five", consequence: "the answerability and control instruments start measuring something real." },
      { option: "Confirm two facts is deliberate", consequence: "the instruments keep reporting an honest near-zero state, which is what they do today." },
    ],
  ),
  card(
    "NS22",
    "Author the reader-question corpus for the answerability suite.",
    "RULING 210's suite runs today with an honest zero state — '0 questions loaded — awaiting owner " +
      "corpus'. The questions must be YOURS: a session writing the questions it is then graded on " +
      "is the exact self-grading this project refuses.",
    [
      { option: "Author them", consequence: "the answerability contract starts producing a real reading across the four pilot ZIPs." },
      { option: "Defer", consequence: "the suite keeps reporting zero, which is honest and measures nothing." },
    ],
  ),
  card(
    "NS23",
    "Author the known-answer control set — roughly 40-60 owner-verified facts across the four pilot ZIPs, weighted toward the dangerous ones.",
    "RULING 211's permanent control set is the truth answer key. It needs known-present facts AND " +
      "known-absence negative controls, each carrying its authority, period and verified-through " +
      "scope. Only you can verify them; a machine-authored key measures the machine against itself.",
    [
      { option: "Author the set", consequence: "answer truthfulness becomes measurable after activation, per RULING 211." },
      { option: "Defer", consequence: "there is no unannounced control set, and truthfulness stays unmeasured." },
    ],
  ),
  card(
    "NH164_PLACEHOLDER_UNUSED", // never registered; kept out of CARDS below
    "",
    "",
    [],
  ),
].filter((c) => c.rowId !== "NH164_PLACEHOLDER_UNUSED");

/* ========================================================================== */
/* Everything else in Needs Sean                                              */
/* ========================================================================== */

/**
 * The remaining Needs Sean rows, carded in bulk because their decision has one
 * shape: **a resource, a credential, an installation or an approval that only
 * the author can supply, with the work continuing meanwhile under RULING 208.**
 *
 * They are not carded more thinly than the rows above out of laziness — they
 * are carded to the depth the decision actually has. Each names what is needed
 * and what happens either way, which is the whole of RULING 227's requirement. Where
 * a row later grows a machine-checkable predicate it moves out of this list,
 * and `tests/tracker-predicates.test.ts` does not care which list it is in.
 */
const ESCALATION_CARDS = [
  ["NH304", "Rule on ONE WORD in RULING 233: the branch is `staging` and the host is `test.meanwhileusa.com`, and this provider will not serve both. Option A — amend the BRANCH to `test`, preserving the host you named twice and `STAGING_RENDER_ORIGIN`; the git ref name moves, and it appears on no reader-facing or owner-facing surface. Option B — keep the branch `staging` and move the host to `staging.meanwhileusa.com`, preserving the ref name and changing the host you specified. The session shipped under Option A because RULING 233 is not operative until the session after Session C closes, so nothing is decided that you cannot undo.", "a session may not amend the author's law, and which of your own two words you meant is a judgement no measurement settles — the measurement (RULING 235, a FACT) only establishes that both cannot stand"],
  ["NS01", "Decide whether this project seeks a Meta Ad Library API token.", "political-ad disclosure is mandatory by law, so any candidate who buys one ad appears there; it is the one manifest route this project cannot walk at all"],
  // NS12 left this list on 2026-09-01. Its blocker was machine-checkable all
  // along — the credential either resolves or it does not — and carding it meant
  // nothing ever re-asked. It is now `ns12` in PREDICATES, and it resolves.
  ["NS13", "Rule on the narrow collision between RULING 124's close-out refusal and the merge-cadence rule.", "a document cannot name the commit that contains it, and the two rules disagree only in that one case"],
  ["NS14", "Rule on VOTE411: it publishes no terms of use at all, and 'restricted' is the session's reading of your instruction rather than a finding.", "you said to read the terms before extracting and treat it as restricted until they say otherwise; /terms-use, /terms-of-use and /privacy-policy are all 404"],
  ["NS16", "Supply the 8/25 feedback document, or confirm it does not exist.", "the brief names it AUTHORITATIVE and says its carryover table is law; it is in neither the repo, the Drive mirror root, nor the screenshots folder"],
  ["NS17", "Decide whether BC-14's fourth source link, the one on the VOTES, is removed.", "three of the four render sites are removed; the fourth is on a different surface and removing it needs your call"],
  ["NS18", "Confirm the BC-23 answer: the Sources tab counts 2 because it is only GIVEN 2 — neither capped nor filtered.", "you asked a question and it is answered with the mechanism; the row closes on your acknowledgement rather than on more work"],
  ["NS19", "Choose a uniform pill treatment for BAL-12 — the ballot page carries three in one screen.", "the evidence and the proposal are in the row and nothing is built, per the brief"],
  ["NS10", "Decide whether this project proposes a tribal division type to the national identifier list.", "RULING 119 gives tribal nations their own category and the canonical ocd-division-ids vocabulary has none; proposing to an external standards body is an outward act"],
  ["NH208", "Acknowledge the correction: nothing is wrong with your ruleset and no setting needs changing.", "the row's title still says otherwise because the amend tool deliberately cannot edit a title, which is why the row needs reading rather than working"],
  ["NH212", "Confirm the NH206 serving-edge guard change: it asserted a number the architecture guarantees is non-zero.", "the serving window looks back 90 days so rows fall out at about five a day; the guard asserted zero and could only ever have gone red"],
  ["NH225", "Rule on azdor.gov, which disallows ClaudeBot by name while allowing everyone else.", "this product's reader identifies itself by its own name and contact address, so which rule applies to it is a reading of their robots.txt that carries a permission consequence"],
  ["NH274", "Install tesseract, or approve another OCR route for the 151 Arizona Governor letters.", "the letters are scanned images and the tool cannot install itself without an elevation prompt"],
  // NH275 AND NH276 BOTH NAMED REFS THAT HAVE SINCE BEEN DELETED FROM ORIGIN,
  // measured 2026-09-01: `git ls-remote --heads origin` returns 34 heads and
  // neither branch is among them. The cards now name the SHA instead, because a
  // decision card that points at a vanished ref asks the author to go and look
  // at nothing. NH275's work is NOT lost — the commit is intact — and saying so
  // is the difference between a decision and an alarm.
  ["NH275", "Read or release commit 33f6f520 — the single 2026-08-18 commit that could not be proved shipped. Its branch, claude/g17-aud03-measure, no longer exists on origin, but THE WORK IS INTACT: GitHub still serves 33f6f520 by SHA ('AUD-03 measurement: the eight pre-registered surfaces behind async boundaries', +52/-8 on components/map/map-entry.tsx), and the commit is present in the local object store. Nothing was lost; the ref was.", "the sweep classified 143 branches and proved 135 content-shipped; this is the one it could not, and the row said it must not be deleted unread — the ref went anyway, which is why the card now carries the SHA the work can always be recovered from"],
  ["NH276", "Rule on whether an owner-created branch is ever retired automatically. The branch that prompted it, sean/captures-0826, is no longer on origin as of 2026-09-01 — so the specific case is moot and only the GENERAL rule is still open.", "its content was provably in main and a trial merge was a no-op, so on evidence it was disposable; nothing in the law says a session may delete a branch you made, and that question outlives the branch that raised it"],
  ["NH277", "Rule on whether a corroborating meeting route may become an ingestion source.", "the Legistar union carries a truthful PUBLISHED_BUT_UNPLACED_BY_US disposition and discharging it needs one of two routes you have not chosen between"],
  ["NH282", "Choose a durable workflow driver, or the control plane's primitives never run unattended.", "leases, reclaim and recovery all work and are proved; what is missing is the thing that runs them without a person present"],
  ["NH283", "Approve an encrypted, access-controlled store for RESTRICTED_RAW evidence.", "a captured public page carrying a live third-party credential is not hypothetical — PR #216 hit one on Pima County's own Clerk of the Board page"],
  ["NH287", "Rule on recording method outcomes at sub-state granularity.", "16 of 20 speculative Pima routes record jurisdiction 'az' while several walks were against school and water districts; promoting on that evidence would let one body's result speak for another's"],
  ["D70", "Rule on the approach for agenda-platform tenant enumeration.", "three platforms and three different methods; the row asks for your ruling on the approach before the crawler is built"],
  ["ASK03", "Approve the disclosure copy that gates Ask signal capture.", "the capture path is built and GATED OFF; today an answered ask stores only a topic id and only a refusal keeps the question text, which discards the richest civic-interest signal the product has"],
].map(([rowId, whatIsNeeded, why]) =>
  card(
    rowId,
    whatIsNeeded,
    `${why}. No artifact can decide it: it needs a resource, a permission or a judgement that ` +
      "only the author can supply. Under RULING 208 the escalation is a parallel lane — this row " +
      "does not close, pause or satisfy the obligation it is about, and every other executable " +
      "path continues meanwhile.",
    [
      {
        option: "Supply it / rule on it",
        consequence: "the blocked route opens and the work behind this row continues on the machine.",
      },
      {
        option: "Decline or defer",
        consequence:
          "the obligation stays LIVE and visible — declining the escalation is never a disposition " +
          "of the record it concerns (RULING 205, RULING 208) — and the other routes keep being worked.",
      },
    ],
  ),
);

/**
 * **OWN03 — CONVERTED FROM A CARD TO A PREDICATE, 2026-09-01, AND THE
 * CONVERSION IS THE POINT.**
 *
 * The card that stood here argued, correctly, that *"RULING 55 reserves the
 * approval itself to the author, so OWN03 stays NOT_MACHINE_VERIFIABLE."*
 * **The approval was reserved to him; whether he has GIVEN it is not.** Those
 * are different questions, and running them together is what kept this row
 * escalated after it stopped being a question.
 *
 * He approved all nine on 2026-09-01. A machine cannot decide FOR him and this
 * predicate does not try: it reads `data/photos/review.json`, which records his
 * decision per image, and it resolves only when every one of the nine carries
 * an `APPROVED` state decided by `sean`. Anything short of nine — a pending
 * image, a rejection, a decision recorded under a different author — HOLDS, and
 * the row stays in front of him.
 *
 * That distinction is also why this cannot become a general door. The predicate
 * cannot manufacture an approval; it can only observe one the author already
 * made, in the store RULING 55 built for exactly that purpose. `resolutionAuthor`
 * becomes `predicate`, never `sean`, so nothing here forges his handwriting —
 * which is the hole `NH64` named and `RULING 37` exists to keep shut.
 *
 * **What the row-integrity check was, and where it went.** The card's other
 * half — *do the subjects this row names actually appear in the queued set* —
 * caught that the row's own text said "Mayes, Fontes and Horne among them" when
 * Horne was never queued at all. That check has not moved: it lives in
 * `tests/tracker-predicates.test.ts` and it is not wired here, because a row
 * naming the wrong person must be CORRECTED and never closed.
 */
export const own03 = {
  rowId: "OWN03",
  kind: "predicate",
  blocker:
    "nine statewide portraits are acquired and decoded and none may render, because " +
    "RULING 55 reserves the approval to the author and he has not made it",
  evaluate: ({ root }) => {
    const read = [
      "data/photos/review.json",
      "data/photos/door2-statewide-executives-2026-08-28.json",
      "docs/evidence/own03-promotion.json",
    ];

    const queue = readArtifact("data/photos/door2-statewide-executives-2026-08-28.json", root);
    if (!queue.ok) return cannotTell(queue.why, { read });
    const reviews = readArtifact("data/photos/review.json", root);
    if (!reviews.ok) return cannotTell(reviews.why, { read });

    /*
     * The nine are DERIVED from the acquisition record, never listed here. A
     * hardcoded list is a second copy of a population, and the last time this
     * row carried its own copy of who was in it, the copy was wrong.
     */
    const rows = Array.isArray(queue.value?.rows) ? queue.value.rows : [];
    const nine = rows.filter((r) => r?.portrait?.src && r?.decode?.ok === true);
    if (nine.length === 0) {
      return cannotTell(
        "the acquisition record lists no decoded queued portrait at all, so there is no " +
          "population to ask about",
        { read },
      );
    }

    const byPerson = reviews.value?.reviews ?? {};

    /*
     * The person key, mirroring `personKey` in `lib/photos/person.ts`.
     *
     * It is INLINED rather than imported because this module is `.mjs` and is
     * loaded by `node scripts/tracker.mjs` with no build step, and reaching
     * into a `.ts` from here would make the tracker's own generator depend on
     * type stripping. A second copy of a rule is a real cost (RULING 103), so
     * it is paid for: `tests/tracker-predicates.test.ts` asserts the two agree
     * on every subject in the queue and goes red the day they drift.
     */
    const key = (name) =>
      String(name)
        .toUpperCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^A-Z ]/g, " ")
        .replace(/\b(JR|SR|II|III|IV|V)\b/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    /*
     * **THE ACQUISITION RECORD STORES THE SRC AS THE PAGE WROTE IT, HTML
     * ENTITIES AND ALL.** Five of the nine are AZCC URLs carrying `&amp;`, and
     * what was actually fetched — and therefore what the approval is recorded
     * against — is the DECODED form. Comparing the raw strings reported six of
     * nine unapproved on the day the author approved all nine, which is a false
     * blocker put back in front of him. Both forms are compared, because they
     * are the same URL.
     */
    const entityDecoded = (url) =>
      String(url)
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
    const undecided = [];
    const approved = [];
    for (const row of nine) {
      const decisions = byPerson[key(row.subject)] ?? [];
      const wanted = new Set([row.portrait.src, entityDecoded(row.portrait.src)]);
      const forThisImage = decisions.find((d) => wanted.has(String(d?.url)));
      if (forThisImage?.state === "APPROVED" && forThisImage?.decidedBy === "sean") {
        approved.push(`${row.subject} — approved ${forThisImage.decidedAt}`);
      } else {
        undecided.push(`${row.subject}: ${forThisImage?.state ?? "no decision recorded for this image"}`);
      }
    }

    if (undecided.length > 0) {
      return holds(
        `${undecided.length} of ${nine.length} queued portraits still carry no approval from the ` +
          `author: ${undecided.join("; ")}.`,
        { read },
      );
    }

    return resolvedByEvidence(
      `the author has decided. All ${nine.length} queued portraits carry an APPROVED review ` +
        "recorded against THAT EXACT IMAGE and decided by him, which is the only thing RULING 55 " +
        "was waiting for.",
      {
        read,
        evidence: [
          ...approved.map((a) => `data/photos/review.json — ${a}`),
          "docs/photo-review/own03-nine.png — the contact sheet he reviewed, nine images, one look",
          "docs/evidence/own03-promotion.json — each portrait re-fetched and compared against the " +
            "decode he reviewed before anything was written; a byte mismatch REFUSES the row rather " +
            "than inheriting his approval for a file he never saw",
          "lib/officials/statewide-executives.ts — the nine photoUrl values, each beside its own " +
            "licence row in lib/registry/official-photos.json",
          "VERIFIED ON THE RENDERED DOM of a local production build, per person, by naturalWidth: " +
            "85641 nine of nine decoded (Horne and Presmyk render initials, which is correct — " +
            "neither was ever approved); 85701 three sampled, three decoded; 07866 Caldwell " +
            "1000x1250.",
          "TOM HORNE IS NOT CLOSED BY THIS. He was never in the queue — his decode was a Cloudflare " +
            "challenge page — and his portrait remains an open acquisition obligation under " +
            "RULING 206. The row is closed; the obligation it concerned is NOT (RULING 208).",
        ],
      },
    );
  },
};

/**
 * **NS12 — the deploy record could not be read, because no Netlify credential
 * existed on this machine.**
 *
 * ## Why this row moved from a card to a predicate
 *
 * NS12 was carded, not predicated. A `NOT_MACHINE_VERIFIABLE` card HOLDS by
 * construction — the machine never asks again, because the thing it waits on is
 * a person. That is the right treatment for a row whose blocker is somebody's
 * judgement. **It was the wrong treatment for this one**, and the cost was
 * exactly what RULING 227 was adopted to prevent.
 *
 * The row's own text says *"There is no `NETLIFY_AUTH_TOKEN` in `.env.local`
 * and the Netlify CLI config on this machine holds no user."* On 2026-09-01
 * that stopped being true: the name is in `.env.local`, and `pnpm deploy:live`
 * answered in full — site `sparkwtp.netlify.app`, live deploy
 * `6a971f049c69ab9ba17215cb`, live commit `787211c`, and a verdict explaining
 * why `82c3a41` was correctly not built. **The wall was gone and the queue did
 * not notice**, because nothing in a card is capable of noticing.
 *
 * RULING 227's requirement is a predicate that is rechecked on EVERY tracker
 * generation and auto-resolves the row when it goes false. The card route is
 * the other half of that rule, not an alternative to it, and a blocker a
 * machine CAN decide does not get to take the human route.
 *
 * ## What it reads, and why it reads a NAME rather than asking Netlify
 *
 * It reads `.env.local` for the presence of the variable NAME. **No value is
 * read, compared, logged or returned** — the outcome carries the name and
 * nothing else, which is the whole of the credential rule.
 *
 * It deliberately does NOT call the Netlify API. A predicate that made a
 * network call would answer differently depending on the network, and a queue
 * whose contents depend on whether a host was reachable is a queue that reports
 * outages as decisions.
 *
 * ## The three outcomes, and why the third is not HOLDS
 *
 * A missing or unreadable `.env.local` is `CANNOT_TELL`, never `HOLDS`. CI has
 * no such file, and treating its absence as "the credential is still missing"
 * would turn every CI run into a fresh confirmation of a wall that may have
 * fallen months ago — a permanent HOLDS wearing a predicate's clothes. Only a
 * file this process could actually read, that genuinely lacks the name, holds
 * the row.
 */
export const ns12 = {
  rowId: "NS12",
  kind: "predicate",
  blocker:
    "no Netlify credential exists on this machine, so the deploy record cannot " +
    "be read and a session cannot confirm the shipped SHA without asking the " +
    "site — and asking the site writes a row into the store this product sells",
  evaluate: ({ root }) => {
    const read = ["data/ops/deploy-record-read.json"];
    const record = readArtifact("data/ops/deploy-record-read.json", root);
    if (!record.ok) return cannotTell(record.why, { read });

    const value = /** @type {Record<string, unknown>} */ (record.value);
    /*
     * Each field is checked for the thing it is EVIDENCE of, not merely for
     * being present. A record that named no live deploy would prove that the
     * script ran, which is not what the row was blocked on.
     */
    const missing = ["liveDeployId", "liveCommit", "site", "observedAt"].filter(
      (k) => typeof value[k] !== "string" || !(/** @type {string} */ (value[k])).trim(),
    );
    if (missing.length > 0) {
      return cannotTell(
        `data/ops/deploy-record-read.json is present but carries no ${missing.join(", ")}. ` +
          `A record that does not name the deploy it read is not evidence that the ` +
          `deploy record was readable.`,
        { read },
      );
    }
    if (value.requestsToTheSite !== 0) {
      return cannotTell(
        `data/ops/deploy-record-read.json reports ${String(value.requestsToTheSite)} ` +
          `request(s) to the site. This row is about reading the DEPLOY RECORD without ` +
          `asking the site, so a reading that asked the site does not answer it.`,
        { read },
      );
    }
    return resolvedByEvidence(
      "the Netlify deploy record was read with a credential and zero requests to " +
        "the site, which is the one question RULING 125 leaves needing Netlify.",
      {
        read,
        evidence: [
          `pnpm deploy:live read site ${String(value.site)} and returned live deploy ` +
            `${String(value.liveDeployId)} at commit ${String(value.liveCommit)}, ` +
            `observed ${String(value.observedAt)}, with ${String(value.requestsToTheSite)} ` +
            `requests to the site. A CANNOT-TELL exit 3 is what this row was opened on.`,
          "The credential is recorded by NAME only — NETLIFY_AUTH_TOKEN. No value is " +
            "read, compared, logged or returned by this predicate, and none appears in " +
            "the artifact it reads.",
          "The row was CARDED rather than predicated, so nothing ever re-asked, and the " +
            "wall had already fallen. That is the defect RULING 227 names in as many " +
            "words: a queue with no mechanism capable of noticing that a blocker stopped " +
            "being true presents the author with stale blockers as the current state of " +
            "his own project.",
        ],
      },
    );
  },
};

/**
 * **NH305 — the runner's relaunch trigger needs one elevated install.**
 * (Level 1 activation, 2026-09-01.)
 *
 * The blocker is an interactive elevation boundary the machine cannot cross.
 * The predicate reads the proof record `scripts/pilot-task.ps1 -Action
 * prove-relaunch` writes after the elevated install: a killed runner brought
 * back by the trigger, with the pids and the seconds measured. A record that
 * says NOT_RELAUNCHED holds the row with the measurement; an absent record
 * holds it because nothing has been proven yet — on THIS checkout, which is
 * where the proof lands; the file is committed so CI reads the same fact.
 */
export const nh305 = {
  rowId: "NH305",
  kind: "predicate",
  blocker:
    "the Scheduled Task 'WeThePeople Pilot Runner' carries only an at-logon trigger; " +
    "registering the 5-minute relaunch trigger is refused from an unelevated shell " +
    "(Access is denied, measured 2026-09-01), and an unattended session does not elevate itself",
  evaluate: ({ root }) => {
    const read = ["data/ops/runner-relaunch-proof.json"];
    const record = readArtifact("data/ops/runner-relaunch-proof.json", root);
    if (!record.ok) {
      return holds(
        `${record.why}. The elevated install and prove-relaunch have not been run, or their ` +
          "proof has not been committed; the runner is still DOWN after any kill until a logon.",
        { read },
      );
    }
    const value = /** @type {Record<string, unknown>} */ (record.value);
    if (value.verdict !== "RELAUNCHED") {
      return holds(
        `data/ops/runner-relaunch-proof.json records verdict ${String(value.verdict)} ` +
          `(killed pid ${String(value.killedPid)}, relaunched ${String(value.relaunchedPid)}). ` +
          "A proof that the trigger did NOT relaunch the runner keeps the row open with the measurement.",
        { read },
      );
    }
    if (value.relaunchTriggerPresent !== true) {
      return cannotTell(
        "the proof records RELAUNCHED but relaunchTriggerPresent is not true, so what brought " +
          "the runner back is not the mechanism this row is about.",
        { read },
      );
    }
    return resolvedByEvidence(
      "the installed relaunch trigger brought a killed runner back without an owner command.",
      {
        read,
        evidence: [
          `prove-relaunch measured at ${String(value.measuredAt)}: killed pid ${String(value.killedPid)}, ` +
            `relaunched pid ${String(value.relaunchedPid)} after ${String(value.secondsToRelaunch)} s, ` +
            `task state ${String(value.taskStateAfter)}, relaunch trigger present.`,
        ],
      },
    );
  },
};

/** Every predicate in the registry. */
export const PREDICATES = [nh272, nh281, nh300, own03, ns12, nh305];

/** The full RULING 227 registry: predicated rows first, then carded rows. */
export const REGISTRY = [...PREDICATES, ...CARDS, ...ESCALATION_CARDS];
