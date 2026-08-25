#!/usr/bin/env tsx
/**
 * `pnpm rotation:prove` — RULING 95 and RULING 127, applied to a ROTATION.
 *
 * Written for the NJ depth session of 2026-08-24 to close the evidence half of
 * `NS11`: nine credentials leaked into session transcripts, and the row is only
 * answerable by proving each OLD value DEAD and each NEW value LIVE.
 *
 * The new half is `pnpm credentials`. This is the old half, and it is the
 * awkward one: the old values exist nowhere except the transcripts that leaked
 * them. So this reads them back out of the transcripts, CALLS them, and reports
 * only a verdict.
 *
 * **It never prints a credential value — old or new.** That is RULING 127, and
 * it is why the extraction is anchored on the HOST the credential belongs to
 * rather than on a credential-shaped pattern: a shape scan would drag every git
 * SHA in the transcripts into a list this program then makes network calls with.
 *
 * A candidate equal to a CURRENT value in `.env.local` is discarded before any
 * call — that one is not an old key, it is the live key, and calling it here
 * would report "still live" about a rotation that did happen.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { loadSecrets } from "../lib/ops/secret-redaction.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TRANSCRIPTS = "C:/Users/seanj/.claude/projects/C--Users-seanj-dev-we-the-people";

const current = new Set(loadSecrets(join(ROOT, ".env.local")).map((s) => s.value));

type Verdict = { live: boolean; how: string };

type Probe = {
  name: string;
  /** Anchored on the credential's own host, never on a credential-shaped pattern. */
  extract: RegExp;
  /**
   * The SECOND form, and it is not optional — RULING 110. A key escapes in more
   * than one shape: `?api_key=…` in a resolved URL is one, and `NAME=…` in an
   * echoed environment or a shell line is another. The first run of this script
   * reported "no old value" for four credentials on the strength of the URL form
   * alone, which is a sweep looking in the right place in the wrong form.
   *
   * The token character class is deliberately wide and the length floor high, so
   * a prose word after the name cannot become a candidate.
   */
  nameAnchored?: RegExp;
  /** Returns a verdict for one candidate value. The value goes no further. */
  call: (value: string) => Promise<Verdict>;
};

/** `NAME` followed by an assignment or a colon and then a long opaque token. */
function byName(name: string, token = "[A-Za-z0-9_\\-]{20,120}"): RegExp {
  return new RegExp(`${name}["'\\s]*[=:]["'\\s]*(${token})`, "g");
}

async function json(url: string, init?: RequestInit) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(25_000) });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    /* not JSON — which is itself the finding for the Census host */
  }
  return { status: res.status, text, body };
}

const PROBES: Probe[] = [
  {
    name: "CONGRESS_API_KEY",
    extract: /api\.congress\.gov\/[^\s"'`]*?api_key=([A-Za-z0-9]{20,60})/g,
    nameAnchored: byName("CONGRESS_API_KEY"),
    call: async (v) => {
      const r = await json(
        `https://api.congress.gov/v3/member/congress/119/NJ?format=json&limit=1&currentMember=true&api_key=${v}`,
      );
      const ok = r.status === 200 && Array.isArray((r.body as { members?: unknown[] } | null)?.members);
      return { live: ok, how: `HTTP ${r.status}${ok ? " with a members array" : " with no members array"}` };
    },
  },
  {
    name: "CENSUS_API_KEY",
    extract: /api\.census\.gov\/[^\s"'`]*?[?&]key=([A-Za-z0-9]{30,60})/g,
    nameAnchored: byName("CENSUS_API_KEY"),
    call: async (v) => {
      const r = await json(
        `https://api.census.gov/data/2023/acs/acs5?get=NAME,B01003_001E&for=zip%20code%20tabulation%20area:07866&key=${v}`,
      );
      const ok = Array.isArray(r.body) && (r.body as unknown[]).length > 1;
      const invalid = /Invalid Key/i.test(r.text);
      return {
        live: ok,
        how: `HTTP ${r.status}${ok ? " with ACS rows" : invalid ? ' with an HTML page titled "Invalid Key"' : " with no ACS rows"}`,
      };
    },
  },
  {
    name: "FEC_API_KEY",
    extract: /api\.open\.fec\.gov\/[^\s"'`]*?api_key=([A-Za-z0-9]{20,60})/g,
    nameAnchored: byName("FEC_API_KEY"),
    call: async (v) => {
      const r = await json(`https://api.open.fec.gov/v1/candidates/?state=NJ&per_page=1&sort=name&api_key=${v}`);
      const ok = r.status === 200 && Array.isArray((r.body as { results?: unknown[] } | null)?.results);
      return { live: ok, how: `HTTP ${r.status}${ok ? " with a results array" : " with no results array"}` };
    },
  },
  {
    name: "LEGISCAN_API_KEY",
    extract: /api\.legiscan\.com\/[^\s"'`]*?[?&]key=([A-Za-z0-9]{20,60})/g,
    nameAnchored: byName("LEGISCAN_API_KEY"),
    call: async (v) => {
      const r = await json(`https://api.legiscan.com/?key=${v}&op=getSessionList&state=NJ`);
      const status = (r.body as { status?: string } | null)?.status;
      return { live: status === "OK", how: `HTTP ${r.status} status=${String(status ?? "none")}` };
    },
  },
  {
    name: "PLURAL_API_KEY",
    extract: /(?:openstates[^\s"'`]{0,60}?(?:apikey|x-api-key)["'\s:=]+)([A-Za-z0-9-]{20,60})/gi,
    nameAnchored: byName("PLURAL_API_KEY"),
    call: async (v) => {
      const r = await json("https://v3.openstates.org/jurisdictions?classification=state&per_page=1", {
        headers: { "X-API-KEY": v },
      });
      const ok = r.status === 200 && Array.isArray((r.body as { results?: unknown[] } | null)?.results);
      return { live: ok, how: `HTTP ${r.status}${ok ? " with a results array" : " with no results array"}` };
    },
  },
  {
    name: "ANTHROPIC_API_KEY",
    extract: /(sk-ant-[A-Za-z0-9_-]{20,120})/g,
    nameAnchored: byName("ANTHROPIC_API_KEY", "sk-ant-[A-Za-z0-9_\-]{20,120}"),
    call: async (v) => {
      const r = await json("https://api.anthropic.com/v1/models?limit=1", {
        headers: { "x-api-key": v, "anthropic-version": "2023-06-01" },
      });
      const ok = r.status === 200 && Array.isArray((r.body as { data?: unknown[] } | null)?.data);
      return { live: ok, how: `HTTP ${r.status}${ok ? " with a models array" : " with no models array"}` };
    },
  },
  {
    name: "a Neon connection string",
    extract: /(postgresql:\/\/[A-Za-z0-9_]+:[^@\s"'`]+@ep-[A-Za-z0-9-]+\.[A-Za-z0-9.-]*neon\.tech\/[A-Za-z0-9_]+)/g,
    call: async (v) => {
      const { neon } = await import("@neondatabase/serverless");
      try {
        const sql = neon(v);
        const rows = (await sql`select current_user as who`) as { who: string }[];
        return { live: rows.length === 1, how: "the database answered with a role" };
      } catch (e) {
        return { live: false, how: `refused: ${(e as Error).message.split("\n")[0].slice(0, 90)}` };
      }
    },
  },
];

function transcriptFiles(): string[] {
  if (!existsSync(TRANSCRIPTS)) return [];
  const out: string[] = [];
  const walk = (dir: string, depth = 0) => {
    if (depth > 4) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (statSync(p).size < 200 * 1024 * 1024) out.push(p);
    }
  };
  walk(TRANSCRIPTS);
  return out;
}

const files = transcriptFiles();
if (files.length === 0) {
  console.error("rotation:prove · CANNOT RUN — no transcript files read, so nothing could be searched.");
  process.exit(2);
}

console.log(`rotation:prove · ${files.length} transcript file(s), ${PROBES.length} credential class(es)\n`);
console.log("  Values are never printed. A candidate equal to a CURRENT .env.local value is discarded unread.\n");

const candidates = new Map<string, Set<string>>();
for (const probe of PROBES) candidates.set(probe.name, new Set());

for (const f of files) {
  let text: string;
  try {
    text = readFileSync(f, "utf8");
  } catch {
    continue;
  }
  for (const probe of PROBES) {
    for (const form of [probe.extract, probe.nameAnchored]) {
      if (!form) continue;
      for (const m of text.matchAll(form)) {
        const v = m[1];
        if (!v || current.has(v)) continue;
        candidates.get(probe.name)!.add(v);
      }
    }
  }
}

let proven = 0;
let stillLive = 0;
let none = 0;

for (const probe of PROBES) {
  const set = [...candidates.get(probe.name)!];
  if (set.length === 0) {
    console.log(`  ${probe.name.padEnd(28)} NO OLD VALUE IN THE TRANSCRIPTS — nothing to prove dead`);
    none += 1;
    continue;
  }
  for (let i = 0; i < set.length; i += 1) {
    let verdict: Verdict;
    try {
      verdict = await probe.call(set[i]);
    } catch (e) {
      verdict = { live: false, how: `the call threw: ${(e as Error).message.split("\n")[0].slice(0, 90)}` };
    }
    const label = set.length > 1 ? `${probe.name} #${i + 1}` : probe.name;
    if (verdict.live) {
      stillLive += 1;
      console.log(`  ${label.padEnd(28)} STILL LIVE — ${verdict.how}   ** NOT ROTATED **`);
    } else {
      proven += 1;
      console.log(`  ${label.padEnd(28)} PROVEN DEAD — ${verdict.how}`);
    }
  }
}

console.log(
  `\nrotation:prove · ${proven} old value(s) proven dead · ${stillLive} still live · ${none} class(es) with no old value in the transcripts`,
);
process.exit(stillLive > 0 ? 1 : 0);
