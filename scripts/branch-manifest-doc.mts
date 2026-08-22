/**
 * **THE ROUTE TABLE IN `docs/branch-manifest.md` IS GENERATED** (built
 * 2026-08-21, NH Hunt 6 item 2).
 *
 * ```
 * corepack pnpm manifest:doc          # write
 * corepack pnpm manifest:doc --check  # fail if the doc is behind the module
 * ```
 *
 * The document carries the reasoning, the index and the rules, all hand-written.
 * The ROUTES themselves come from `lib/hunt/branch-manifest.ts`, because a
 * hand-kept second copy of a list is a copy that goes wrong — and this
 * particular list decides whether a claim about a named person is allowed to
 * render. The gap ledger is generated for the same reason.
 *
 * Only the region between the two `GENERATED ROUTES` markers is touched.
 * Everything else in the file is the author's and a session's prose, and this
 * script never rewrites it.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  MANIFEST_FIELDS,
  MANIFEST_INCOMPLETENESS_NOTE,
  MANIFEST_ROUTES,
  MANIFEST_VERSION,
  routeCounts,
  routesFor,
  type ManifestField,
} from "../lib/hunt/branch-manifest.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DOC = join(ROOT, "docs", "branch-manifest.md");
const BEGIN = "<!-- BEGIN GENERATED ROUTES — written by `corepack pnpm manifest:doc`, never by hand -->";
const END = "<!-- END GENERATED ROUTES -->";

const FIELD_LABEL: Record<ManifestField, string> = {
  photo: "Photo",
  blurb: "In their own words",
  contact: "Contact",
  campaignSite: "Campaign site",
  verifiedPage: "Specific verified page",
};

/** A cell that cannot break the table, whatever the prose does. */
function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n+/g, " ").trim();
}

export function generatedSection(): string {
  const counts = routeCounts();
  const out: string[] = [];

  out.push(`## The routes — manifest ${MANIFEST_VERSION}`);
  out.push("");
  out.push(
    `**${MANIFEST_ROUTES.length} routes named**, across ` +
      `${new Set(MANIFEST_ROUTES.map((r) => r.through)).size} distinct dependencies. ` +
      "A route may serve several fields; a route is counted once per field it can " +
      "actually produce, and a route forbidden for a field (a newspaper photograph, " +
      "for one) is not counted there at all.",
  );
  out.push("");
  out.push("**Routes per field type — this is the bar for `VERIFIED_ABSENT`:**");
  out.push("");
  out.push("| Field | Routes that must be walked |");
  out.push("| --- | ---: |");
  for (const f of MANIFEST_FIELDS) out.push(`| ${FIELD_LABEL[f]} | ${counts[f]} |`);
  out.push("");
  out.push(`> ${MANIFEST_INCOMPLETENESS_NOTE}`);
  out.push("");

  for (const f of MANIFEST_FIELDS) {
    const routes = routesFor(f);
    out.push(`### ${FIELD_LABEL[f]} — ${routes.length} routes`);
    out.push("");
    out.push("| id | What it is | How it is reached | What it yields | Rung | Through |");
    out.push("| --- | --- | --- | --- | --- | --- |");
    for (const r of routes) {
      out.push(
        `| \`${r.id}\` | ${cell(r.what)} | ${cell(r.how)} | ${cell(r.yields)} | ${cell(r.rung)} | ${cell(r.through)} |`,
      );
    }
    out.push("");
  }

  out.push("### Whether each route travels — RULING 60");
  out.push("");
  out.push(
    "A branch proven in one place is proven for that shape, not for everywhere. " +
      "The route that reached a Newbury board will not reach a borough in Alaska, " +
      "an unincorporated county in Arizona, or a parish in Louisiana. This column " +
      "is what the project actually believes, and honest uncertainty is a legal " +
      "answer.",
  );
  out.push("");
  out.push("| id | Expected to travel |");
  out.push("| --- | --- |");
  for (const r of MANIFEST_ROUTES) out.push(`| \`${r.id}\` | ${cell(r.expectedToTravel)} |`);
  out.push("");

  const withSubs = MANIFEST_ROUTES.filter((r) => (r.subBranches ?? []).length > 0);
  out.push("### Sub-branches grown so far");
  out.push("");
  if (withSubs.length === 0) {
    out.push("None yet.");
  } else {
    out.push(
      "A route that failed somewhere new is never discarded — it grows a limb. " +
        "Each row is a place the parent route came back empty and the fact was " +
        "reached anyway.",
    );
    out.push("");
    out.push("| Parent route | Where | What failed | What reached it instead |");
    out.push("| --- | --- | --- | --- |");
    for (const r of withSubs) {
      for (const s of r.subBranches ?? []) {
        out.push(`| \`${r.id}\` | ${cell(s.where)} | ${cell(s.on)} | ${cell(s.instead)} |`);
      }
    }
  }
  out.push("");

  const retired = MANIFEST_ROUTES.filter((r) => r.retiredOn !== undefined);
  out.push("### Retired routes — kept, never deleted");
  out.push("");
  if (retired.length === 0) {
    out.push(
      "None. A route that stops working keeps its id and its place here with a " +
        "dated note, because the next jurisdiction may hit the same wall from a " +
        "different side.",
    );
  } else {
    out.push("| id | Retired | Because |");
    out.push("| --- | --- | --- |");
    for (const r of retired) {
      out.push(`| \`${r.id}\` | ${r.retiredOn} | ${cell(r.retiredBecause ?? "")} |`);
    }
  }

  return out.join("\n");
}

export function rendered(): string {
  const doc = readFileSync(DOC, "utf8");
  const start = doc.indexOf(BEGIN);
  const stop = doc.indexOf(END);
  if (start < 0 || stop < 0) {
    throw new Error(`docs/branch-manifest.md is missing its GENERATED ROUTES markers`);
  }
  return (
    doc.slice(0, start + BEGIN.length) + "\n\n" + generatedSection() + "\n\n" + doc.slice(stop)
  );
}

const invoked = process.argv[1]?.replace(/\\/g, "/").endsWith("branch-manifest-doc.mts");
if (invoked) {
  const next = rendered();
  const current = readFileSync(DOC, "utf8");
  if (process.argv.includes("--check")) {
    if (next !== current) {
      console.error(
        "docs/branch-manifest.md is behind lib/hunt/branch-manifest.ts.\n" +
          "Run: corepack pnpm manifest:doc",
      );
      process.exit(1);
    }
    console.log("docs/branch-manifest.md is current");
  } else {
    writeFileSync(DOC, next, "utf8");
    const counts = routeCounts();
    console.log(
      `docs/branch-manifest.md written — ${MANIFEST_ROUTES.length} routes, ` +
        MANIFEST_FIELDS.map((f) => `${f} ${counts[f]}`).join(" · "),
    );
  }
}
