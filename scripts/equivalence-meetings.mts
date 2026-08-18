/**
 * AUD-04's deliverable: proof that resolving the governing geography once
 * changes NOTHING about what `/api/meetings` answers.
 *
 *   corepack pnpm exec tsx scripts/equivalence-meetings.mts capture
 *   corepack pnpm exec tsx scripts/equivalence-meetings.mts verify
 *
 * ## Why a proof rather than a claim
 *
 * The change is a pure de-duplication: the route resolved the same point
 * against the same polygons twice — `divisionsAt`, then `coverageAt`, whose
 * `summarizeCoverage` calls `bodiesAt`, which calls `divisionsAt` again — so
 * every request paid for two identical point-in-polygon sweeps to answer two
 * questions about one location. "Pure de-duplication" is exactly the claim that
 * is easy to make and easy to be wrong about, so the brief asks for byte
 * identity rather than an assertion, and this is the instrument.
 *
 * ## In-process, deliberately
 *
 * The handler is imported and called directly rather than fetched over the
 * network. Two reasons: the comparison is then of THIS tree's behaviour before
 * and after, with no deploy, no snapshot drift and no clock skew between the
 * two runs; and the route's search-log write is fire-and-forget against the
 * LOCAL database, so an equivalence run writes nothing to the store the
 * business sells from.
 *
 * ## What is compared, and what is deliberately excluded
 *
 * The full JSON body, byte for byte, for the four pilot zips plus one point
 * outside coverage — the case where the answer is mostly absence, which is
 * where a resolution change would show up first and where an accidental empty
 * would be easiest to miss.
 *
 * Nothing is excluded. There is no time-varying field in the body to normalise:
 * meeting rows and the snapshot block are read from the committed snapshot, and
 * the handler is passed a fixed clock nowhere — so if a run straddles a
 * scheduled refresh the diff will report it loudly rather than smoothing it,
 * which is the correct behaviour for an instrument whose whole job is to notice
 * a difference.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

import { GET } from "@/app/api/meetings/route";

const OUT = join(process.cwd(), "screenshots", "equivalence");
const BASELINE = join(OUT, "aud04-meetings-baseline.json");

/**
 * The four pilot zips, plus one point outside coverage.
 *
 * 06716 (Cheshire, Connecticut) is the out-of-coverage probe the state-focus
 * measurement already uses for its no-active-state frame, so the two
 * instruments are asking about the same place.
 */
const PROBES = [
  { name: "85701 Tucson", zip: "85701", lat: 32.21696, lng: -110.971 },
  { name: "85641 Vail", zip: "85641", lat: 32.04903, lng: -110.62291 },
  { name: "07866 Rockaway", zip: "07866", lat: 40.95499, lng: -74.48801 },
  { name: "03255 Newbury", zip: "03255", lat: 43.31403, lng: -72.02455 },
  { name: "06716 Cheshire CT (outside coverage)", zip: "06716", lat: 41.5, lng: -72.9 },
] as const;

async function capture(): Promise<Record<string, { status: number; body: string }>> {
  const out: Record<string, { status: number; body: string }> = {};
  for (const p of PROBES) {
    const url = `http://localhost/api/meetings?zip=${p.zip}&lat=${p.lat}&lng=${p.lng}`;
    const res = await GET(new Request(url));
    const body = await res.text();
    out[p.name] = { status: res.status, body };
    console.log(`  ${p.name}: HTTP ${res.status}, ${body.length} bytes`);
  }
  return out;
}

const mode = process.argv[2];

if (mode === "capture") {
  mkdirSync(OUT, { recursive: true });
  console.log("AUD-04 equivalence — capturing BEFORE state\n");
  const snap = await capture();
  writeFileSync(BASELINE, JSON.stringify(snap, null, 1), "utf8");
  console.log(`\nbaseline written: ${BASELINE}`);
  console.log(`${Object.keys(snap).length} probe point(s) captured`);
} else if (mode === "verify") {
  if (!existsSync(BASELINE)) {
    console.error(
      `no baseline at ${BASELINE} — run \`capture\` on the UNCHANGED tree first.\n` +
        "Refusing to run: a verify with nothing to compare against would print a " +
        "reassuring nothing.",
    );
    process.exit(1);
  }
  console.log("AUD-04 equivalence — verifying AFTER state\n");
  const before = JSON.parse(readFileSync(BASELINE, "utf8")) as Record<
    string,
    { status: number; body: string }
  >;
  const after = await capture();

  const names = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  let identical = 0;
  const differing: string[] = [];

  for (const name of names) {
    const b = before[name];
    const a = after[name];
    if (!b || !a) {
      differing.push(`${name}: present in only one run`);
      continue;
    }
    if (b.status === a.status && b.body === a.body) {
      identical += 1;
      continue;
    }
    if (b.status !== a.status) {
      differing.push(`${name}: HTTP ${b.status} → ${a.status}`);
      continue;
    }
    // Name the first differing byte rather than dumping two documents: the
    // offset is what tells you WHICH field moved.
    let i = 0;
    while (i < b.body.length && i < a.body.length && b.body[i] === a.body[i]) i += 1;
    differing.push(
      `${name}: bodies diverge at byte ${i} — ` +
        `before …${b.body.slice(Math.max(0, i - 60), i + 60)}… / ` +
        `after …${a.body.slice(Math.max(0, i - 60), i + 60)}…`,
    );
  }

  console.log(
    `\n${identical}/${names.length} probe point(s) byte-identical before and after`,
  );
  if (differing.length > 0) {
    console.log("\nDIFFERENCES:");
    for (const d of differing) console.log(`  ${d}`);
    process.exit(1);
  }
  console.log("AUD-04: zero behaviour change, proven rather than asserted.");
} else {
  console.error("usage: equivalence-meetings.mts capture|verify");
  process.exit(1);
}
