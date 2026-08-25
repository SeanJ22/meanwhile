/**
 * The candidate-evidence primitives — guarded against the pages they were
 * written for.
 *
 * RULING 110's second half: **the instrument is shown catching the real
 * instance.** A sweep that cannot find the defect it was written for is a sweep
 * reporting green about nothing, so every pattern here is tested against the
 * literal text of the page that exposed it, and against the page it must NOT
 * match.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  classifyCampaignPage,
  FREEMAIL_DOMAINS,
  flattenForEvidence,
  givenSurnamePair,
  matchNameForms,
  nameForms,
  officeEvidenceIn,
  partyOrganSelfIdIn,
  verdictFor,
} from "../lib/hunt/candidate-evidence.ts";

describe("office evidence", () => {
  it("catches the real instance: `for <place> <office>` on garykapner.com", () => {
    // The literal prose of that page, which is its title — a 533 KB Wix site
    // whose entire text layer is 225 characters.
    const hay = flattenForEvidence(
      "<title>Gary Kapner for Mendham Township Committee | Mendham Township, NJ, USA</title>",
    );
    const found = officeEvidenceIn(hay);
    assert.ok(
      found.includes("for <place> <office>"),
      `the page that exposed this pattern is not caught by it — found: ${JSON.stringify(found)}`,
    );
  });

  it("still catches the bare form it was widened from", () => {
    assert.ok(officeEvidenceIn("i am running for congress this year").length > 0);
    assert.ok(officeEvidenceIn("paid for by friends of somebody").includes("paid-for-by disclaimer"));
  });

  it("does not manufacture evidence out of unrelated prose", () => {
    // The widened pattern allows up to three words between `for` and the
    // office noun. It must not span a sentence to reach one.
    const innocuous =
      "thank you for visiting. our firm has represented clients before the zoning board, " +
      "the planning board and the town council for over thirty years.";
    assert.deepEqual(officeEvidenceIn(innocuous), []);
  });

  it("does not fire on the law-firm bios that manufactured two findings", () => {
    // RULING 68's live case: `elect` inside `selected`, `2026` inside a
    // copyright line. Both promoted an attorney bio as a campaign site.
    const firm =
      "morristown law firm, chipperson law group, p.c. our selected practice areas include " +
      "electronic discovery. copyright 2026 all rights reserved.";
    assert.deepEqual(officeEvidenceIn(firm), []);
  });
});

describe("party-organ self-identification", () => {
  it("catches the real instance: morrisdems.org's own title and first line", () => {
    const hay = flattenForEvidence(
      "<title>Home | Morris County Democratic Committee &#8212; Morris Dems (MCDC)</title>" +
        "<p>We are the Morris County Democratic Committee</p>",
    );
    assert.ok(
      partyOrganSelfIdIn(hay).length > 0,
      "the page that exposed this test is not caught by it",
    );
  });

  it("is symmetric across parties, which is a rule and not a courtesy", () => {
    // An instrument that recognised one party's committees and not the other's
    // would mislabel one side's county sites as individual campaign sites.
    const dem = flattenForEvidence("<p>We are the Morris County Democratic Committee</p>");
    const rep = flattenForEvidence("<p>We are the Morris County Republican Committee</p>");
    assert.equal(partyOrganSelfIdIn(dem).length > 0, partyOrganSelfIdIn(rep).length > 0);
    assert.ok(partyOrganSelfIdIn(rep).length > 0);

    const demTitle = flattenForEvidence("<title>Morris County Democratic Committee</title>");
    const repTitle = flattenForEvidence("<title>Morris County Republican Committee</title>");
    assert.equal(partyOrganSelfIdIn(demTitle).length > 0, partyOrganSelfIdIn(repTitle).length > 0);
  });

  it("does not fire on a candidate's own site that merely names their party", () => {
    const site = flattenForEvidence(
      "<title>Jane Doe for Township Committee</title><p>Jane is the Republican candidate " +
        "for Township Committee. Paid for by Doe for Township Committee.</p>",
    );
    assert.deepEqual(partyOrganSelfIdIn(site), []);
    assert.ok(officeEvidenceIn(site).length > 0);
  });
});

describe("name forms — RULING 110", () => {
  it("expands a filed name into the forms a campaign actually uses", () => {
    const forms = nameForms("Thomas H. Kean");
    const strings = forms.map((f) => f.form);
    assert.ok(strings.includes("tom kean"), `no diminutive form: ${strings.join(", ")}`);
    assert.ok(strings.includes("thomas kean"));
    assert.ok(strings.includes("kean"));
  });

  it("does not treat a generational suffix as the surname", () => {
    // RULING 103's initials defect, in its other costume.
    const forms = nameForms("Thomas J. Haynes III");
    assert.ok(!forms.some((f) => f.form === "iii"));
    assert.ok(forms.some((f) => f.form.endsWith("haynes")));
  });

  it("records every form searched, matched or not", () => {
    const matched = matchNameForms("Thomas H. Kean", "welcome to the tom kean campaign");
    assert.equal(matched.length, nameForms("Thomas H. Kean").length);
    assert.ok(matched.some((f) => f.form === "tom kean" && f.matched));
    assert.ok(matched.some((f) => f.form === "thomas kean" && !f.matched));
  });
});

describe("givenSurnamePair", () => {
  it("strips the parenthetical nickname that made the slate test find nothing", () => {
    // `Christopher (Chris) RUSSO` paired raw is `christopher (chris) russo`,
    // which matches no page ever written — and a corpus test built on it
    // silently finds nothing and reports that as a fact about the pages.
    assert.equal(givenSurnamePair("Christopher (Chris)", "RUSSO"), "christopher russo");
  });

  it("strips a quoted nickname and a comma suffix", () => {
    assert.equal(givenSurnamePair('Arthur J. "Art"', "BRUHN, JR."), "arthur bruhn");
  });
});

describe("the promotion verdict — RULING 68's two bars", () => {
  it("promotes only when the page NAMES the person AND says it is a campaign", () => {
    const forms = matchNameForms("Jane Doe", "jane doe for township committee");
    const office = officeEvidenceIn("jane doe for township committee");
    assert.equal(verdictFor("HIT", forms, office).outcome, "HIT");
  });

  it("refuses to promote on a surname alone", () => {
    const forms = matchNameForms("Jane Doe", "the doe family has lived here for years");
    const v = verdictFor("HIT", forms, ["for <office>"]);
    assert.equal(v.outcome, "LEAD");
    assert.match(v.detail, /surname/i);
  });

  it("refuses to promote a page that names the person with no office evidence", () => {
    const forms = matchNameForms("Rita C. Chipperson", "rita c. chipperson, attorney at law");
    const v = verdictFor("HIT", forms, []);
    assert.equal(v.outcome, "LEAD");
  });

  it("never promotes something that did not clear the control", () => {
    const forms = matchNameForms("Jane Doe", "jane doe for township committee");
    assert.equal(verdictFor("REFUSED", forms, ["for <office>"]).outcome, "REFUSED");
    assert.equal(verdictFor("EMPTY", forms, ["for <office>"]).outcome, "EMPTY");
  });
});

describe("the freemail list", () => {
  it("holds the providers the filing corpus actually contains", () => {
    for (const d of ["gmail.com", "yahoo.com", "optonline.net", "optimum.net", "fastmail.com"]) {
      assert.ok(FREEMAIL_DOMAINS.has(d), `${d} appears in the 07866 filing and is not listed`);
    }
  });

  it("does not list a domain that turned out to be a campaign's own", () => {
    // Erring the other way costs a whole candidate's site: an unknown domain is
    // walked and classified by what its page says, which is the safe direction.
    for (const d of ["corybooker.com", "tomkean.com", "garykapner.com", "analiliafornj.com"]) {
      assert.ok(!FREEMAIL_DOMAINS.has(d));
    }
  });
});

describe("what KIND of page it is — the paid-for-by rule, not a host list", () => {
  /*
   * Written from the ten promotions the 2026-08-25 inversion returned. Six were
   * real; two were `huffpost.com` promoted as William Maher's campaign site (the
   * page names Bill Maher, the comedian) and `wpgtalkradio.com` promoted as
   * Thomas H. Kean, Jr.'s. Adding two hosts to an exclusion list would have been
   * RULING 90's failure — every fix so far has been a list, and lists are
   * finite. The rule comes from statute instead: a candidate committee must
   * carry a "paid for by" disclaimer on the communications it pays for, and a
   * news organisation writing about a candidate does not.
   *
   * The evidence arrays below are the ACTUAL ones recorded for those hosts on
   * 2026-08-25, so this test is the instrument shown catching the real instance
   * rather than a constructed one (RULING 110).
   */
  it("promotes a campaign site — the disclaimer, and no party self-identification", () => {
    // analiliafornj.com, as recorded.
    const v = classifyCampaignPage({
      officeEvidence: ["paid-for-by disclaimer", "for <office>", "this campaign"],
      partyOrganSelfId: [],
    });
    assert.equal(v.kind, "CAMPAIGN_SITE");
  });

  it("REFUSES a news organisation, which is what the list would have had to name", () => {
    // huffpost.com, as recorded — "running for" and nothing else.
    assert.equal(classifyCampaignPage({ officeEvidence: ["running for"], partyOrganSelfId: [] }).kind, "LEAD");
    // wpgtalkradio.com, as recorded.
    assert.equal(classifyCampaignPage({ officeEvidence: ["this campaign"], partyOrganSelfId: [] }).kind, "LEAD");
  });

  it("a party organ is a THIRD thing — RULING 122's page, never a campaign site", () => {
    // morrisdems.org, as recorded: it carries the disclaimer AND says what it is.
    const v = classifyCampaignPage({
      officeEvidence: ["paid-for-by disclaimer", "for <place> <office>"],
      partyOrganSelfId: ["names itself a county committee", "names itself the party organisation"],
    });
    assert.equal(v.kind, "PARTY_HOSTED_PAGE");
    assert.match(v.why, /host/i, "the reason must say the host is named — that is the whole of RULING 122");
  });

  it("names what it saw when it refuses, so the refusal points at the page", () => {
    const v = classifyCampaignPage({ officeEvidence: ["running for"], partyOrganSelfId: [] });
    assert.match(v.why, /running for/, "the refusal must quote the evidence it did find");
    const bare = classifyCampaignPage({ officeEvidence: [], partyOrganSelfId: [] });
    assert.match(bare.why, /nothing/, "and say so when it found none");
  });
});
