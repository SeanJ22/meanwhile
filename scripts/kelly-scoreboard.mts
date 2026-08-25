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

import {
  KELLY_FIELDS,
  absenceStands,
  type ArguedAbsence,
  type CandidateDepth,
  type FieldState,
  type KellyField,
} from "../lib/hunt/kelly-depth.ts";

const ROOT = process.cwd();

/** @freshness-reads-here — a run stamp used as TODAY for an expiry comparison, never written into a freshness field. */
const TODAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Phoenix" }).format(new Date());

interface Candidacy {
  id: string;
  contestId: string;
  familyName: string;
  givenName: string;
}

const ballot = JSON.parse(readFileSync(join(ROOT, "data", "ballot", "nj-morris-2026.json"), "utf8")) as {
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

const contacts = JSON.parse(
  readFileSync(join(ROOT, "data", "ballot", "nj-morris-2026-contacts.json"), "utf8"),
) as { contacts: { candidacyId: string; email?: string | null }[] };
const filedEmail = new Map(contacts.contacts.map((c) => [c.candidacyId, c.email ?? null]));

const ABSENCE_FILE = join(ROOT, "data", "hunt", "nj-morris-argued-absences.json");
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

const rows: CandidateDepth[] = [];
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
console.log(`KELLY DEPTH at 07866 — RULING 143, measured ${TODAY}\n`);
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
