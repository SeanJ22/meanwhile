#!/usr/bin/env tsx
/**
 * `pnpm kelly` — **the distance to done for 07866, as a number.**
 *
 * RULING 143 says every candidate on this ballot is either at Kelly depth in
 * full or carries an argued absence, and that the distance remaining is reported
 * as a number against 272 every session, because that number decides when
 * Arizona starts. This computes it.
 *
 * ```
 * pnpm kelly                 the count, plus the per-field split
 * pnpm kelly --owed          every candidate still owed something, named
 * pnpm kelly --json          the whole scoreboard as data
 * ```
 *
 * ## Where each of the five fields is READ FROM, and why it is read rather than stored
 *
 * | field | source of record |
 * |---|---|
 * | photo | `data/ballot/candidate-cards-2026.json` → `photoUrl`, and the asset must exist on disk |
 * | phone | the same card → `phone` |
 * | contact | the same card → `email`, or the clerk's filed email in `nj-morris-2026-contacts.json` |
 * | verified page | `data/ballot/candidate-links-2026.json` → `official` |
 * | campaign site | the same file → `campaign` |
 *
 * A `kellyDepth` column on the candidate record would be a claim that goes stale
 * the moment any of those files moves, with nothing noticing. So nothing is
 * stored; the answer is derived every time it is asked.
 *
 * ## The three-way split, never a bare count (RULING 105)
 *
 * HELD, ARGUED ABSENT with its expiry, and OWED. The middle number is what keeps
 * the report honest: without it there is no way to tell a field this project
 * has established is not there from a field nobody has looked for, and those
 * need completely different responses.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { today } from "./doc-dates.mjs";

import {
  KELLY_FIELDS,
  absenceStands,
  type ArguedAbsence,
  type KellyReading,
  type FieldState,
  type KellyField,
} from "../lib/hunt/kelly-depth.ts";

const ROOT = process.cwd();

/**
 * @freshness-reads-here — the day an expiry is compared AGAINST, never a value
 * written into a freshness field.
 *
 * From `scripts/doc-dates.mjs` rather than a local `Intl.DateTimeFormat`:
 * a second copy of the Phoenix formatter is a duplicate implementation
 * (RULING 103), and the two would drift the first time one was corrected.
 */
const TODAY = today();

interface Candidacy {
  id: string;
  contestId: string;
  familyName: string;
  givenName: string;
}

/**
 * WHICH BALLOT. Defaults to 07866, because RULING 143 is about 07866 and the
 * number this prints is the one that decides when Arizona starts.
 *
 * It takes an argument because the alternative is a SECOND scoreboard for New
 * Hampshire, and RULING 103 is explicit that a renamed copy of a function is a
 * duplicate implementation — the two would drift the first time one of them was
 * fixed.
 */
const BALLOTS: Record<string, { file: string; label: string; contacts?: string }> = {
  "07866": {
    file: "nj-morris-2026.json",
    label: "07866 (Morris County, New Jersey)",
    contacts: "nj-morris-2026-contacts.json",
  },
  "03255": { file: "nh-merrimack-2026.json", label: "03255 (Merrimack County, New Hampshire)" },
};
const ZIP = (process.argv.find((a) => a.startsWith("--zip=")) ?? "--zip=07866").slice("--zip=".length);
const CHOSEN = BALLOTS[ZIP];
if (!CHOSEN) {
  console.error(`pnpm kelly --zip=<${Object.keys(BALLOTS).join("|")}>`);
  process.exit(2);
}

const ballot = JSON.parse(readFileSync(join(ROOT, "data", "ballot", CHOSEN.file), "utf8")) as {
  contests: { id: string; title: string }[];
  candidacies: Candidacy[];
};

const cards = JSON.parse(
  readFileSync(join(ROOT, "data", "ballot", "candidate-cards-2026.json"), "utf8"),
) as {
  cards: Record<string, { photoUrl?: string | null; phone?: string | null; email?: string | null }>;
};

const links = JSON.parse(
  readFileSync(join(ROOT, "data", "ballot", "candidate-links-2026.json"), "utf8"),
) as { links: Record<string, { official?: { url: string }; campaign?: { url: string } }> };

/* A contacts file is a per-zip artifact and not every zip has one; where it is
   absent the card is the only source, which is a smaller claim honestly made. */
const contactsPath = CHOSEN.contacts ? join(ROOT, "data", "ballot", CHOSEN.contacts) : null;
const filedEmail = new Map<string, string | null>(
  contactsPath && existsSync(contactsPath)
    ? (JSON.parse(readFileSync(contactsPath, "utf8")) as {
        contacts: { candidacyId: string; email?: string | null }[];
      }).contacts.map((c) => [c.candidacyId, c.email ?? null])
    : [],
);

const ABSENCE_FILE = join(ROOT, "data", "hunt", `argued-absences-${ZIP}.json`);
const absences: ArguedAbsence[] = existsSync(ABSENCE_FILE)
  ? (JSON.parse(readFileSync(ABSENCE_FILE, "utf8")) as { rows: ArguedAbsence[] }).rows
  : [];
const absenceFor = new Map<string, ArguedAbsence>();
for (const a of absences) absenceFor.set(`${a.candidacyId}|${a.field}`, a);

function held(id: string, field: KellyField): { yes: boolean; evidence: string } {
  const card = cards.cards[id];
  const link = links.links[id];
  switch (field) {
    case "photo": {
      const url = card?.photoUrl ?? null;
      if (!url) return { yes: false, evidence: "no photoUrl on the card" };
      /*
       * The asset must EXIST. A photoUrl pointing at nothing renders as a broken
       * image, which is worse than an honest initials block — and it would count
       * here as a held field while the reader sees a gap.
       */
      const onDisk = join(ROOT, "public", url.replace(/^\//, ""));
      if (!existsSync(onDisk)) return { yes: false, evidence: `photoUrl ${url} but no file at public${url}` };
      return { yes: true, evidence: url };
    }
    case "phone":
      return card?.phone ? { yes: true, evidence: card.phone } : { yes: false, evidence: "no phone on the card" };
    case "contact": {
      const e = card?.email ?? filedEmail.get(id) ?? null;
      return e ? { yes: true, evidence: e } : { yes: false, evidence: "no email held" };
    }
    case "verifiedPage":
      return link?.official
        ? { yes: true, evidence: link.official.url }
        : { yes: false, evidence: "no verified official page" };
    case "campaignSite":
      return link?.campaign
        ? { yes: true, evidence: link.campaign.url }
        : { yes: false, evidence: "no campaign site" };
  }
}

const rows: KellyReading[] = [];
for (const c of ballot.candidacies) {
  const fields = {} as Record<KellyField, FieldState>;
  const owed: KellyField[] = [];
  for (const f of KELLY_FIELDS) {
    const h = held(c.id, f);
    if (h.yes) {
      fields[f] = { state: "HELD", evidence: h.evidence };
      continue;
    }
    const a = absenceFor.get(`${c.id}|${f}`);
    if (a) {
      const verdict = absenceStands(a, TODAY);
      if (verdict.stands) {
        fields[f] = { state: "ARGUED_ABSENT", at: a.at, expiresOn: a.expiresOn };
        continue;
      }
      fields[f] = { state: "OWED", why: verdict.why };
      owed.push(f);
      continue;
    }
    fields[f] = { state: "OWED", why: h.evidence };
    owed.push(f);
  }
  rows.push({
    candacyId: c.id,
    subject: `${c.givenName} ${c.familyName}`.replace(/\s+/g, " ").trim(),
    contestId: c.contestId,
    fields,
    done: owed.length === 0,
    owed,
  });
}

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ measuredOn: TODAY, total: rows.length, rows }, null, 1));
  process.exit(0);
}

const done = rows.filter((r) => r.done).length;
console.log(`KELLY DEPTH at ${CHOSEN.label} — RULING 143, measured ${TODAY}\n`);
console.log(
  "  The five Kelly fields are photo, phone, contact, a specific verified page and a\n" +
    "  campaign site. That is NOT the four-field denominator earlier NH reports used\n" +
    "  (photo, own words, contact, site), and the two numbers are different measurements\n" +
    "  of different things — stated rather than reconciled, because a single figure in\n" +
    "  front of two measurements is the shape the two-numbers rule forbids.\n",
);
console.log(`  ${done} of ${rows.length} candidates are DONE (every field held or argued absent)`);
console.log(`  ${rows.length - done} still owe at least one field\n`);

console.log("  per field — HELD / ARGUED ABSENT / OWED, each of " + rows.length);
for (const f of KELLY_FIELDS) {
  const h = rows.filter((r) => r.fields[f].state === "HELD").length;
  const a = rows.filter((r) => r.fields[f].state === "ARGUED_ABSENT").length;
  const o = rows.filter((r) => r.fields[f].state === "OWED").length;
  console.log(`    ${f.padEnd(14)} ${String(h).padStart(4)} / ${String(a).padStart(4)} / ${String(o).padStart(4)}`);
}

const voided = rows.flatMap((r) =>
  KELLY_FIELDS.filter((f) => {
    const s = r.fields[f];
    return s.state === "OWED" && /^(VOID|STALE)/.test(s.why);
  }).map((f) => ({ subject: r.subject, field: f, why: (r.fields[f] as { why: string }).why })),
);
console.log(
  `\n  absence records on file: ${absences.length} · returned to OWED as void or stale: ${voided.length}`,
);
for (const v of voided.slice(0, 20)) console.log(`    ${v.subject} · ${v.field} · ${v.why.slice(0, 90)}`);

if (process.argv.includes("--owed")) {
  console.log("\n  STILL OWED, by candidate:");
  for (const r of rows.filter((x) => !x.done)) {
    console.log(`    ${r.subject.padEnd(34)} ${r.owed.join(", ")}`);
  }
}
