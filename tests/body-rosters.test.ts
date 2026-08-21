import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  BODY_ROSTERS,
  governingRosterHoldersForDivision,
  rosterHoldersForBody,
} from "../lib/registry/body-rosters.ts";
import { SOURCE_WIRING } from "../lib/registry/source-wiring.ts";

/**
 * Tier-3 rosters (5a/5b) — officeholder discipline held mechanically:
 * sourced, dated, keyed to real wired bodies, and actually rendered.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The committed retrieval ledgers, concatenated once.
 *
 * A ledger line is the bytes a public body actually sent us, with the URL, the
 * date, the HTTP status and the ladder rung it took to get them. An address
 * that appears in one was published; an address that appears in none has only
 * our word behind it.
 */
const EVIDENCE = (() => {
  const dir = join(ROOT, "docs", "evidence");
  if (!existsSync(dir)) return "";
  return readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl") || f.endsWith(".json"))
    .map((f) => readFileSync(join(dir, f), "utf8"))
    .join("\n");
})();

function publishedInEvidence(email: string): boolean {
  return EVIDENCE.includes(email);
}

test("every roster keys to a real body — a roster for nothing is a curation error", () => {
  // Generalized 2026-08-17 (Kearsarge): a roster may belong to a KNOWN
  // registry body whose calendar is not wired yet — showing a body's people
  // while its meetings are still being hunted is exactly the who-governs
  // case. What stays forbidden is a roster keyed to nothing at all.
  const wiredIds = new Set(SOURCE_WIRING.map((r) => r.bodyId));
  const registry = JSON.parse(
    readFileSync(join(process.cwd(), "lib", "registry", "registry.json"), "utf8"),
  ) as { bodies: { id: string }[] };
  const registryIds = new Set(registry.bodies.map((b) => b.id));
  for (const roster of BODY_ROSTERS) {
    assert.ok(
      wiredIds.has(roster.bodyId) || registryIds.has(roster.bodyId),
      `${roster.bodyName}: bodyId matches neither a source-wiring row nor a registry body`,
    );
  }
});

test("every roster cites the body's own page, never a vendor's", () => {
  const vendorHosts = /legistar|civicplus|hylandcloud|diligent|civicweb|apptegy|iqm2|revize/i;
  for (const roster of BODY_ROSTERS) {
    assert.match(roster.sourceUrl, /^https:\/\//);
    assert.ok(
      !vendorHosts.test(new URL(roster.sourceUrl).hostname),
      `${roster.bodyName}: roster cited to a vendor host — rosters come from the body's own page`,
    );
    assert.match(
      roster.collectedAt,
      /^\d{4}-\d{2}-\d{2}$/,
      `${roster.bodyName}: collectedAt must be a date — sourced AND dated`,
    );
  }
});

test("every member has a name, a published title, and no invented contact", () => {
  for (const roster of BODY_ROSTERS) {
    assert.ok(roster.members.length >= 3, `${roster.bodyName}: suspiciously thin roster`);
    const ids = new Set<string>();
    for (const member of roster.members) {
      assert.ok(member.name.length >= 5, `${roster.bodyName}: bad name "${member.name}"`);
      assert.ok(member.officeTitle.length >= 4, `${member.name}: no title`);
      assert.ok(!ids.has(member.id), `duplicate member id ${member.id}`);
      ids.add(member.id);
      if (member.email) {
        /*
         * **THE RULE IS "PUBLISHED", AND THE DOMAIN LIST WAS ONLY A PROXY FOR
         * IT.** (Widened 2026-08-20, NH Hunt.)
         *
         * What this guard exists to refuse is an INVENTED address — a
         * `firstname.lastname@` pattern-matched onto a person who never
         * published one. A hand-kept list of government domains catches that
         * and also catches something it should not: Kearsarge Regional School
         * District's own staff directory publishes its District Clerk at a
         * `@gmail.com` address, on a `kearsarge.org` page, in the district's
         * own words. That address is unusual and it is real, and refusing it
         * would be refusing a published fact because of its shape.
         *
         * So there are two ways to pass, and the second is the stronger one:
         *
         *   1. the address is on the body's own domain — the fast path, and
         *      still hand-kept, still a list;
         *   2. the address appears VERBATIM in a committed retrieval ledger
         *      under `docs/evidence/`, which is a recording of bytes a public
         *      body actually sent us on a stated date.
         *
         * Proof beats pattern. A guessed address cannot satisfy (2) unless
         * somebody forges a ledger, and a real one on an odd domain no longer
         * has to be dropped to keep a test green.
         */
        const onOwnDomain =
          /@(tucsonaz\.gov|pima\.gov|tusd1\.org|vailschooldistrict\.org|newbury\.nh\.gov|kearsarge\.org|rockawaytownship\.org|rocktwp\.net)$/.test(
            member.email,
          );
        assert.ok(
          onOwnDomain || publishedInEvidence(member.email),
          `${member.name}: ${member.email} is neither on the body's own domain ` +
            "nor recorded verbatim in any committed retrieval ledger under docs/evidence/",
        );
      }
    }
  }
});

test("the author's named example is covered: TUSD renders a full board", () => {
  const holders = rosterHoldersForBody(
    "ocd-division/country:us/state:az/school_district:tucson_unified_district#board",
  );
  /*
   * F01 1.2 (2026-08-19): 5 → 6. The sixth is the SUPERINTENDENT, who is hired
   * by this board and does not sit on it. He is in the roster array because
   * that is where the body card's `superintendent` slot resolves from, and
   * `bodySubject` removes him from the seated list in the same change — so the
   * board is still five seats, and the count below says which is which rather
   * than just growing by one.
   */
  const seated = holders.filter((h) => !/superintendent/i.test(h.officeTitle));
  const hired = holders.filter((h) => /superintendent/i.test(h.officeTitle));
  assert.equal(seated.length, 5, "TUSD's board has five ELECTED seats");
  assert.equal(hired.length, 1, "and one hired superintendent");
  assert.equal(holders.length, 6);
  assert.ok(seated.some((h) => h.officeTitle.includes("President")));
  for (const holder of holders) {
    assert.ok(holder.sourceUrl, `${holder.name}: no source — a name without one may not render`);
  }

  // The hired executive must never be labelled as a board seat. A reader who
  // reads "Governing Board Member" beside the superintendent's name has been
  // told something false about how the district is governed.
  assert.equal(hired[0].officeTitle, "Superintendent");
  assert.ok(
    !/board member|board president|board clerk/i.test(hired[0].officeTitle),
    "the superintendent must not wear a board title",
  );
});

/**
 * F01 1.2 — the seated/hired split, held at the render.
 *
 * A person appearing under BOTH "Who sits on it" and "Runs the district day to
 * day" would be the card saying two different things about one person's job.
 */
test("F01 1.2: the superintendent is pulled out of the seated list, not duplicated", () => {
  const entry = readFileSync(
    join(process.cwd(), "components", "map", "map-entry.tsx"),
    "utf8",
  );
  assert.match(
    entry,
    /const seated = superintendent\s*\n?\s*\? roster\.filter\(\(h\) => h\.id !== superintendent\.id\)\s*\n?\s*: roster;/,
    "the seated list must exclude the hired superintendent",
  );
  assert.match(entry, /representation: seated,/);
});

test("the mayor joins the model (5b): Tucson's roster includes the Mayor", () => {
  const holders = rosterHoldersForBody(
    "ocd-division/country:us/state:az/place:tucson#governing",
  );
  const mayor = holders.find((h) => h.officeTitle === "Mayor");
  assert.ok(mayor, "no Mayor on the Tucson Mayor & Council roster");
  assert.ok(mayor.email && mayor.phone, "the mayor's published contact must ride along");
  // 7 = the mayor plus six ward members — Tucson's actual council.
  assert.equal(holders.length, 7);
});

test("an unwired body renders the honest absence, not an invented roster", () => {
  assert.deepEqual(rosterHoldersForBody("no-such-body"), []);
  assert.deepEqual(rosterHoldersForBody(null), []);
});

test("the surfaces render the rosters — the register is not shelf-ware", () => {
  const mapEntry = readFileSync(
    join(process.cwd(), "components", "map", "map-entry.tsx"),
    "utf8",
  );
  assert.ok(
    mapEntry.includes("rosterHoldersForBody"),
    "map-entry must wire rosters into the meeting surfaces",
  );
});

test("the division lookup finds both registry suffixes — school boards are #board", () => {
  // The Sunnyside catch (2026-08-18): a #governing-only lookup rendered
  // "no sourced officeholder" over every curated school-board roster.
  const tusd = governingRosterHoldersForDivision(
    "ocd-division/country:us/state:az/school_district:tucson_unified_district",
  );
  assert.ok(tusd.length >= 5, "TUSD board roster unreachable by division");
  const sunnyside = governingRosterHoldersForDivision(
    "ocd-division/country:us/state:az/school_district:sunnyside_unified_district",
  );
  assert.ok(sunnyside.length === 5, "Sunnyside board roster unreachable by division");
  assert.ok(sunnyside.some((m) => m.name === "Beki Quintero"));
  const amphi = governingRosterHoldersForDivision(
    "ocd-division/country:us/state:az/school_district:amphitheater_unified_district",
  );
  assert.ok(amphi.length === 5, "Amphitheater board roster unreachable by division");
  const tucson = governingRosterHoldersForDivision(
    "ocd-division/country:us/state:az/place:tucson",
  );
  assert.ok(tucson.length > 0, "#governing bodies must still resolve");
  assert.equal(governingRosterHoldersForDivision(null).length, 0);
});
