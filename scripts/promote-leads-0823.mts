/**
 * **PROMOTING A RUNG-1 LEAD, WITH A CONTROL AND A NAMED SET OF SEARCH FORMS.**
 * (`NH106` session, 2026-08-23. Serves the campaign-site field, owed 0 of 272
 * at 07866, and the municipal roster leads mined from Wikipedia the same day.)
 *
 * ## Which claim this serves, and why it is expansion rather than a side quest
 *
 * RULING 89: expansion is a NEW ROUTE TO A FIELD ALREADY OWED. Campaign site
 * stands at **0 of 272** at 07866 and it is on the item list. Two sets of leads
 * were parked at rung 1 on 2026-08-23 by a session with **no egress** — its own
 * note says *"every outbound host was refused at the egress on 2026-08-23"* —
 * so nothing could be confirmed and everything was correctly recorded as a
 * LEAD. This session has egress. That is the whole of what changed.
 *
 * ## Why a guessed domain can never be promoted on a 200
 *
 * RULING 68. A session once reported `HIT` on **16 of 16 people** across two
 * routes because every host answered 200 — an SPA shell, a login wall, and a
 * search page that echoed the query into its own HTML so a substring test for
 * the surname passed. A 100% hit rate on guessed identifiers across sixteen
 * different people is a measurement of the instrument.
 *
 * So every promotion here clears TWO bars, and the second is the new one:
 *
 * 1. **The control.** `lib/hunt/control-query.ts`, unchanged and reused rather
 *    than reimplemented — a request for a path that cannot exist on the same
 *    host, and an answer indistinguishable from it is the host talking about
 *    itself.
 * 2. **Self-identification.** The page's own text must name the candidate AND
 *    say what they are running for or in which cycle. Clearing the control only
 *    proves the response is DISTINGUISHABLE from boilerplate; it says nothing
 *    about whose page it is, and that is the exact gap between `LEAD` and
 *    `HIT`.
 *
 * ## RULING 110 — the FORMS, not just the terms
 *
 * A search that returns nothing must show it looked in the right FORM. A
 * candidate filed as `Thomas H. Kean` runs a site that says **Tom Kean**, and
 * a sweep for the filed string finds nothing and would report an absence. So
 * the name is expanded into a named set of forms, every form is recorded on
 * every row whether it matched or not, and the report states the forms used.
 *
 * `NAME_FORMS` below is that list. It is deliberately visible in the output:
 * a reader of the ledger can see that `tom` was tried for `Thomas` and draw
 * their own conclusion about a miss.
 *
 * ## RULING 100 — the count is asserted, not counted
 *
 * Both inputs state their own totals (`counts.leads` = 12; `counts.municipal`
 * = 9). This reads those stated numbers, compares them against the rows it
 * actually walked, and FAILS on a shortfall rather than reporting whatever it
 * happened to get. A partial that reconciles is still a wrong answer.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ControlledProbe, type ProbeOutcome } from "../lib/hunt/control-query.ts";
import {
  nameForms,
  OFFICE_EVIDENCE,
  verdictFor,
} from "../lib/hunt/candidate-evidence.ts";
import { politeGetText } from "../lib/sources/http.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CAMPAIGN_LEADS = join(ROOT, "data/hunt/campaign-site-leads-nj-morris.json");
const WIKI_LEADS = join(ROOT, "data/hunt/wiki-leader-leads-07866.json");
const OUT = join(ROOT, "data/hunt/lead-promotion-0823.json");

/** Today, passed in rather than read from a clock. `pnpm stamp` is the source. */
const STAMP = process.env.WTP_STAMP ?? "";

/* -------------------------------------------------------------------------- */
/* THE WALK                                                                   */
/* -------------------------------------------------------------------------- */

interface Row {
  set: "campaign-site" | "municipal-roster";
  subject: string;
  contestOrEntity: string;
  url: string;
  outcome: ProbeOutcome;
  /** Every form searched, and whether the page carried it. RULING 110. */
  formsSearched: { form: string; kind: string; matched: boolean }[];
  officeEvidence: string[];
  bytes: number;
  control: number;
  detail: string;
  attemptedAt: string;
  /** The ladder rung this was reached at — `CLAUDE.md`'s numbering, always. */
  walkedAtRung: number;
}

async function readBody(url: string): Promise<{ status: number; body: string }> {
  try {
    const r = await politeGetText(url, { profile: "browser" });
    return { status: r.status, body: r.text };
  } catch (e) {
    const status = (e as { status?: number }).status ?? 0;
    return { status, body: "" };
  }
}

async function walk(): Promise<void> {
  if (STAMP === "") {
    throw new Error(
      "WTP_STAMP is unset. Every date entering a document comes from `pnpm stamp`; " +
        "a plausible date is a fabrication (CLAUDE.md, the date rule).",
    );
  }

  const campaign = JSON.parse(readFileSync(CAMPAIGN_LEADS, "utf8")) as {
    counts: { leads: number };
    leads: { candidate: string; contestTitle: string; url: string; host: string }[];
  };
  const wiki = JSON.parse(readFileSync(WIKI_LEADS, "utf8")) as {
    counts: { municipal: number };
    rows: { entity: string; name: string; officeTitle: string; wikipediaUrl: string; municipal: boolean }[];
  };

  /* RULING 100: the source states a count. Yielding fewer FAILS. */
  const statedCampaign = campaign.counts.leads;
  const statedMunicipal = wiki.counts.municipal;
  const municipalRows = wiki.rows.filter((r) => r.municipal);
  if (campaign.leads.length !== statedCampaign) {
    throw new Error(
      `count assertion FAILED: campaign lead file states ${statedCampaign} leads and holds ` +
        `${campaign.leads.length}. A partial that reconciles is still a wrong answer (RULING 100).`,
    );
  }
  if (municipalRows.length !== statedMunicipal) {
    throw new Error(
      `count assertion FAILED: wiki lead file states ${statedMunicipal} municipal rows and holds ` +
        `${municipalRows.length} (RULING 100).`,
    );
  }

  const rows: Row[] = [];
  const probe = new ControlledProbe(async (url: string) => {
    const r = await readBody(url);
    return { status: r.status, length: Buffer.byteLength(r.body, "utf8") };
  });

  console.log(`\ncampaign-site leads — ${statedCampaign} stated, walking all ${statedCampaign}\n`);

  for (const lead of campaign.leads) {
    /* The control and the real query go through the SAME url-maker, which is
     * what makes the comparison valid — a control fetched from a different
     * path measures a different page. */
    const make = (id: string): string =>
      id === lead.url ? lead.url : `https://${lead.host}/${id}`;
    const p = await probe.probe(make, lead.url, { guessed: true });

    const body = p.outcome === "LEAD" || p.outcome === "HIT" ? (await readBody(lead.url)).body : "";
    const hay = body.toLowerCase().replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    const forms = nameForms(lead.candidate).map((f) => ({
      form: f.form,
      kind: f.kind,
      matched: hay.includes(f.form),
    }));
    const office = OFFICE_EVIDENCE.filter(([, re]) => re.test(hay)).map(([label]) => label);
    const v = verdictFor(p.outcome, forms, office);

    rows.push({
      set: "campaign-site",
      subject: lead.candidate,
      contestOrEntity: lead.contestTitle,
      url: lead.url,
      outcome: v.outcome,
      formsSearched: forms,
      officeEvidence: office,
      bytes: p.length,
      control: p.control,
      detail: v.detail,
      attemptedAt: STAMP,
      /* Rung 3: a plain fetch carrying the full browser header set. */
      walkedAtRung: 3,
    });
    console.log(
      `  ${v.outcome.padEnd(8)} ${lead.candidate.padEnd(26)} ${lead.url}\n` +
        `           ${v.detail}`,
    );
  }

  console.log(`\nmunicipal roster leads — ${statedMunicipal} stated, walking all ${statedMunicipal}\n`);

  for (const lead of municipalRows) {
    /*
     * These were mined from Wikipedia and could not be citation-confirmed on
     * 2026-08-23 because that session had no egress. RULING 87: Wikipedia
     * NAMES the person and the citation PROVES them, so the confirming read is
     * against the municipality's own site, not against the encyclopedia.
     */
    const make = (id: string): string =>
      id === lead.wikipediaUrl ? lead.wikipediaUrl : `https://en.wikipedia.org/wiki/${id}`;
    const p = await probe.probe(make, lead.wikipediaUrl, { guessed: false });
    const body = p.outcome === "HIT" ? (await readBody(lead.wikipediaUrl)).body : "";
    const hay = body.toLowerCase().replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    const forms = nameForms(lead.name).map((f) => ({
      form: f.form,
      kind: f.kind,
      matched: hay.includes(f.form),
    }));
    const office = [lead.officeTitle.toLowerCase()].filter((t) => hay.includes(t));
    /*
     * A Wikipedia page naming the person is STILL a lead under RULING 87 —
     * an encyclopedia is a discovery source and never a source of record. The
     * outcome recorded is therefore capped at LEAD however well it matches,
     * and the row exists to hand a confirmable name to the next reader.
     */
    const named = forms.some((f) => f.matched && f.kind !== "surname");
    rows.push({
      set: "municipal-roster",
      subject: lead.name,
      contestOrEntity: `${lead.entity} — ${lead.officeTitle}`,
      url: lead.wikipediaUrl,
      outcome: p.outcome === "REFUSED" ? "REFUSED" : "LEAD",
      formsSearched: forms,
      officeEvidence: office,
      bytes: p.length,
      control: p.control,
      detail: named
        ? "the encyclopedia article names this person in this office; RULING 87 caps it at LEAD " +
          "because the citation, not the article, is what proves them"
        : `the article did not carry any of the ${forms.length} name forms searched`,
      attemptedAt: STAMP,
      walkedAtRung: 3,
    });
    console.log(
      `  ${(p.outcome === "REFUSED" ? "REFUSED" : "LEAD").padEnd(8)} ${lead.name.padEnd(26)} ` +
        `${lead.entity} — ${lead.officeTitle}\n           ${named ? "named in article" : "NOT named in article"}`,
    );
  }

  const tally = (set: string, outcome: string): number =>
    rows.filter((r) => r.set === set && r.outcome === outcome).length;

  const summary = {
    campaignSite: {
      stated: statedCampaign,
      walked: rows.filter((r) => r.set === "campaign-site").length,
      HIT: tally("campaign-site", "HIT"),
      LEAD: tally("campaign-site", "LEAD"),
      EMPTY: tally("campaign-site", "EMPTY"),
      REFUSED: tally("campaign-site", "REFUSED"),
    },
    municipalRoster: {
      stated: statedMunicipal,
      walked: rows.filter((r) => r.set === "municipal-roster").length,
      LEAD: tally("municipal-roster", "LEAD"),
      REFUSED: tally("municipal-roster", "REFUSED"),
    },
  };

  writeFileSync(
    OUT,
    `${JSON.stringify(
      {
        note:
          "Control-checked promotion of the rung-1 leads parked on 2026-08-23 by a session with no " +
          "egress. RULING 68: a guessed identifier yields a LEAD, never a HIT, unless the page " +
          "self-identifies with the person AND the office. RULING 110: every name FORM searched is " +
          "recorded on every row, matched or not. RULING 87: a Wikipedia article is capped at LEAD " +
          "however well it matches — the citation proves the person, the article only names them.",
        walkedAt: STAMP,
        forms: "filed · given+surname · diminutive+surname · surname (never sufficient alone)",
        summary,
        rows,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  console.log(`\n  campaign-site   ${JSON.stringify(summary.campaignSite)}`);
  console.log(`  municipal       ${JSON.stringify(summary.municipalRoster)}`);
  console.log(`\nwrote ${OUT}`);

  /* RULING 100 again, on the way out: the walk must have covered what it said. */
  if (summary.campaignSite.walked !== statedCampaign) {
    throw new Error("count assertion FAILED on write: campaign rows walked != stated");
  }
  if (summary.municipalRoster.walked !== statedMunicipal) {
    throw new Error("count assertion FAILED on write: municipal rows walked != stated");
  }
}

await walk();
