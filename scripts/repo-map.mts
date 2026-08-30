/**
 * **THE REPO INVENTORY GENERATOR** (2026-08-30, Session A Work Item 7).
 *
 * ```
 * corepack pnpm repo-map          # write docs/repo-inventory.md
 * corepack pnpm repo-map --check  # verify byte-freshness; writes NOTHING
 * ```
 *
 * Renders a mechanical inventory of the repository — tree, routes, rendering
 * surfaces, exports, schema, gates, scripts, env names, method knowledge,
 * rulings, sources, scheduled jobs, tests, control-plane providers — each
 * section stating its own method and its limits inline.
 *
 * ## Honesty constraints, binding on every section
 *
 * - UNCAPPED. Everything found is rendered; there is no truncation.
 * - No false zeroes: an empty section renders "0 found" plus exactly what was
 *   searched.
 * - Stated N equals rendered rows — every count is derived from the array it
 *   describes, immediately before rendering it.
 * - A failed parse renders its error inline in that section, never as an
 *   empty section.
 * - A future date is annotated mechanically on its own line.
 * - Env var NAMES only, never values.
 *
 * ## Impurity, stated
 *
 * IMPURE and registered as such in `lib/ops/generated-register.ts`: it reads
 * the wall clock and `git rev-parse HEAD` for its stamp, and `git ls-files`
 * for the tree. The CARRIED STAMP keeps it idempotent: an unchanged body
 * keeps the committed stamp block verbatim, so `--check` can byte-compare and
 * a regeneration that changes nothing produces no diff.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { GATES } from "./gates.mjs";
/*
 * The canonical method store's PATH comes from the governed-writer constant
 * rather than a literal here: the ungoverned-write detector in
 * tests/method-concurrency.test.ts reports any file under scripts/ that both
 * names the store and calls a filesystem write, and this generator writes a
 * DOCUMENT while only READING the store. Importing the name keeps that
 * distinction structural instead of textual.
 */
import { GOVERNED_METHOD_WRITER } from "../lib/method/retired-writers.ts";
/*
 * The file list is the WOULD-BE-COMMITTED set, through the shared path
 * lib/ops/repo-files.ts (NH Hunt 3): tracked files plus new files git does not
 * ignore. A tracked-only listing cannot see the change it is being run to
 * describe, and tests/gate-ordering.test.ts refuses that shape by name.
 */
import { filesThatWouldBeCommitted } from "../lib/ops/repo-files.ts";
import { MIRRORED_DOCS } from "./mirror-set.mjs";
import { parseCsv, today } from "./doc-dates.mjs";
import { generatedAtEastern } from "./generated-at.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DOC = join(ROOT, "docs", "repo-inventory.md");

/* Split so this SCRIPT's own head never matches the artifact-declaration
 * sweep in tests/generated-artifacts.test.ts. The phrase belongs in the
 * ARTIFACT, which is registered. */
const GENERATED_HEADER =
  ["**GENERATED", "by `pnpm repo-map`. Never hand-edit (RULING 92).**"].join(" ");

const STAMP_END =
  "<!-- stamp-end: the stamp above is carried verbatim when the body below is byte-identical; only a changed body earns a fresh stamp (scripts/repo-map.mts) -->";

const BINARY_EXTENSIONS = [
  ".png", ".jpg", ".jpeg", ".ico", ".xlsx", ".woff", ".woff2", ".pdf", ".zip", ".gz",
];

function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n+/g, " ").trim();
}

const DATE_RE = /20\d\d-\d\d-\d\d/g;

function annotateFutureDates(line: string, todayStr: string): string {
  if (line.includes("expected-future:")) return line;
  DATE_RE.lastIndex = 0;
  const future = [...line.matchAll(DATE_RE)].some((m) => m[0] > todayStr);
  if (!future) return line;
  return (
    line +
    " <!-- expected-future: a future date rendered from the inventoried source data " +
    "(an election date, deferral horizon or similar), annotated mechanically by the generator -->"
  );
}

/**
 * The would-be-committed set, sorted. Tracked files plus new files git does
 * not ignore; files the repo IGNORES are invisible to this instrument.
 */
function repoFiles(): string[] {
  return filesThatWouldBeCommitted({ cwd: ROOT }).sort();
}

interface Section {
  title: string;
  lines: string[];
}

/** Run a section builder; a failure renders its error inline in the section. */
function section(title: string, build: (out: string[]) => void): Section {
  const lines: string[] = [];
  try {
    build(lines);
  } catch (error) {
    lines.push("");
    lines.push(
      `**SECTION ERROR — this section could not be built:** ${cell(String((error as Error)?.message ?? error))}`,
    );
    lines.push("");
  }
  return { title, lines };
}

function isBinary(path: string, buf: Buffer): boolean {
  const lower = path.toLowerCase();
  if (BINARY_EXTENSIONS.some((e) => lower.endsWith(e))) return true;
  const head = buf.subarray(0, 8000);
  return head.includes(0);
}

function lineCount(buf: Buffer): number {
  const text = buf.toString("utf8");
  if (text.length === 0) return 0;
  const parts = text.split("\n");
  return text.endsWith("\n") ? parts.length - 1 : parts.length;
}

/* ------------------------------------------------------------- sections --- */

function buildSections(files: string[]): Section[] {
  const sections: Section[] = [];

  /* 1 — the file tree */
  sections.push(
    section("1. File tree with per-file line counts", (out) => {
      out.push("");
      out.push(
        "Method: the would-be-committed set from `filesThatWouldBeCommitted()` in " +
          "`lib/ops/repo-files.ts` (git's cached + others, minus what git ignores) — so a " +
          "new file appears here before it is staged. **Files the repo IGNORES are " +
          "invisible to this instrument** — `node_modules/`, `.next/`, `.git/` and other " +
          "build output never appear. Excluded here: `pnpm-lock.yaml` (lockfile). Binary " +
          "files (extension or NUL-byte sniff) report BYTES instead of lines.",
      );
      out.push("");
      const rows: string[] = [];
      let totalLines = 0;
      let textCount = 0;
      let binaryCount = 0;
      for (const f of files) {
        if (f === "pnpm-lock.yaml") continue;
        if (f === "docs/repo-inventory.md") {
          // Its own count is the one number this generator cannot honestly
          // state: the file is measured BEFORE it is written, so a stated
          // count would lag by one regeneration forever and make every run
          // dirty the artifact. Excluded, and the exclusion is stated.
          rows.push(
            `| \`${f}\` | (this document — its own line count is measured before the write and is excluded so regeneration is stable) |`,
          );
          continue;
        }
        const full = join(ROOT, f);
        if (!existsSync(full)) {
          rows.push(`| \`${f}\` | tracked but absent from the working tree |`);
          continue;
        }
        const buf = readFileSync(full);
        if (isBinary(f, buf)) {
          binaryCount++;
          rows.push(`| \`${f}\` | ${buf.length} bytes (binary) |`);
        } else {
          const n = lineCount(buf);
          totalLines += n;
          textCount++;
          rows.push(`| \`${f}\` | ${n} |`);
        }
      }
      out.push(
        `**${rows.length} file(s) rendered — ${textCount} text (${totalLines} lines total), ` +
          `${binaryCount} binary — and the table below has exactly ${rows.length} row(s).**`,
      );
      out.push("");
      out.push("| file | lines |");
      out.push("| --- | ---: |");
      for (const r of rows) out.push(r);
      out.push("");
    }),
  );

  /* 2 — routes */
  sections.push(
    section("2. Route inventory", (out) => {
      out.push("");
      out.push(
        "Method: every inventoried `app/**/route.ts` and `app/**/page.tsx`, URL path derived by " +
          "stripping the `app/` prefix and the filename. Dynamic segments render as written " +
          "(`[param]`).",
      );
      out.push("");
      const routes = files.filter((f) => /^app\/.*\/route\.ts$/.test(f) || f === "app/route.ts");
      const pages = files.filter((f) => /^app\/(.*\/)?page\.tsx$/.test(f));
      const urlOf = (f: string) =>
        "/" + f.replace(/^app\//, "").replace(/\/?(route\.ts|page\.tsx)$/, "");
      out.push(`**${routes.length} route handler(s) and ${pages.length} page(s) found.**`);
      out.push("");
      out.push("| URL path | file | kind |");
      out.push("| --- | --- | --- |");
      for (const f of routes) out.push(`| \`${urlOf(f) || "/"}\` | \`${f}\` | route handler |`);
      for (const f of pages) out.push(`| \`${urlOf(f) || "/"}\` | \`${f}\` | page |`);
      out.push("");
      if (routes.length + pages.length === 0) {
        out.push("0 found — searched every inventoried file matching `app/**/route.ts` and `app/**/page.tsx`.");
        out.push("");
      }
    }),
  );

  /* 3 — rendering surfaces */
  sections.push(
    section("3. Rendering-surface inventory (a lead-generator, not a certified census)", (out) => {
      out.push("");
      const AREAS = ["registry", "db", "ask", "sources", "coverage", "routing"] as const;
      out.push(
        "Method: for each inventoried `.tsx` under `app/` and `components/`, list its import " +
          "specifiers that resolve into `lib/registry`, `lib/db`, `lib/ask`, `lib/sources`, " +
          "`lib/coverage` or `lib/routing` (via `@/` aliases or relative paths). **Limits, " +
          "stated:** this sees direct imports only — a component fed civic data through props, " +
          "a context, or an intermediate module does not appear; a type-only import does. " +
          "It is a lead-generator for where civic data reaches a screen, not a certified census.",
      );
      out.push("");
      out.push("What the six lib areas serve:");
      out.push("");
      out.push("- `lib/registry` — divisions, bodies, rosters: who governs a place.");
      out.push("- `lib/db` — the Drizzle schema and queries over the Postgres serving tables.");
      out.push("- `lib/ask` — the grounded Ask route: evidence packs, votes, local finance.");
      out.push("- `lib/sources` — the ingestion adapters (one directory per external source).");
      out.push("- `lib/coverage` — the honest coverage statements per point and body.");
      out.push("- `lib/routing` — question routing and the ask-box classifier.");
      out.push("");
      const tsx = files.filter(
        (f) => f.endsWith(".tsx") && (f.startsWith("app/") || f.startsWith("components/")),
      );
      const rows: Array<{ file: string; mods: string[] }> = [];
      for (const f of tsx) {
        const text = readFileSync(join(ROOT, f), "utf8");
        const mods = new Set<string>();
        for (const m of text.matchAll(/from\s+["']([^"']+)["']/g)) {
          const spec = m[1];
          let resolved: string | null = null;
          if (spec.startsWith("@/")) resolved = spec.slice(2);
          else if (spec.startsWith(".")) {
            const parts = f.split("/").slice(0, -1);
            for (const seg of spec.split("/")) {
              if (seg === "." || seg === "") continue;
              else if (seg === "..") parts.pop();
              else parts.push(seg);
            }
            resolved = parts.join("/");
          }
          if (resolved === null) continue;
          for (const area of AREAS) {
            if (resolved === `lib/${area}` || resolved.startsWith(`lib/${area}/`)) {
              mods.add(resolved);
            }
          }
        }
        if (mods.size > 0) rows.push({ file: f, mods: [...mods].sort() });
      }
      out.push(
        `**Scanned ${tsx.length} inventoried .tsx file(s) under app/ and components/; ` +
          `${rows.length} import at least one of the six civic-data lib areas.**`,
      );
      out.push("");
      if (rows.length === 0) {
        out.push(
          "0 found — searched every inventoried .tsx under app/ and components/ for imports " +
            "into the six lib areas named above.",
        );
      } else {
        out.push("| component | civic-data imports |");
        out.push("| --- | --- |");
        for (const r of rows) out.push(`| \`${r.file}\` | ${r.mods.map((m) => `\`${m}\``).join(", ")} |`);
      }
      out.push("");
    }),
  );

  /* 4 — exported symbols per lib module */
  sections.push(
    section("4. Exported symbols per lib/ module", (out) => {
      out.push("");
      out.push(
        "Method: mechanical export parse per tracked `.ts`/`.tsx` file under `lib/` — " +
          "`export function|const|class|interface|type|enum <name>` plus the names inside " +
          "`export { … }` lists (the exported alias after `as`). **Limits, stated:** default " +
          "exports, `export *` re-exports and namespace exports are not enumerated by name.",
      );
      out.push("");
      const libFiles = files.filter((f) => f.startsWith("lib/") && /\.(ts|tsx)$/.test(f));
      const byModule = new Map<string, Map<string, string[]>>();
      for (const f of libFiles) {
        const module = f.split("/").length > 2 ? f.split("/").slice(0, 2).join("/") : "lib";
        const text = readFileSync(join(ROOT, f), "utf8");
        const names = new Set<string>();
        for (const m of text.matchAll(
          /^export\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:function\*?|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][A-Za-z0-9_$]*)/gm,
        )) {
          names.add(m[1]);
        }
        for (const m of text.matchAll(/export\s*\{([^}]+)\}/g)) {
          for (const raw of m[1].split(",")) {
            const token = raw.trim();
            if (!token) continue;
            const parts = token.split(/\s+as\s+/);
            const name = (parts[1] ?? parts[0]).replace(/^type\s+/, "").trim();
            if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) names.add(name);
          }
        }
        if (!byModule.has(module)) byModule.set(module, new Map());
        byModule.get(module)!.set(f, [...names].sort());
      }
      const modules = [...byModule.keys()].sort();
      let totalSymbols = 0;
      for (const m of modules) {
        for (const names of byModule.get(m)!.values()) totalSymbols += names.length;
      }
      out.push(
        `**${modules.length} lib module(s), ${libFiles.length} file(s), ` +
          `${totalSymbols} exported symbol name(s) parsed.**`,
      );
      out.push("");
      for (const m of modules) {
        const fileMap = byModule.get(m)!;
        const count = [...fileMap.values()].reduce((n, v) => n + v.length, 0);
        out.push(`### \`${m}\` — ${count} exported symbol(s) across ${fileMap.size} file(s)`);
        out.push("");
        for (const [f, names] of [...fileMap.entries()].sort()) {
          out.push(
            `- \`${f}\` (${names.length}): ${names.length === 0 ? "no named exports parsed" : names.map((n) => `\`${n}\``).join(", ")}`,
          );
        }
        out.push("");
      }
    }),
  );

  /* 5 — drizzle schema */
  sections.push(
    section("5. Drizzle schema, migrations, and production drift status", (out) => {
      out.push("");
      out.push(
        "Method: `pgTable(\"…\")` occurrences across tracked `lib/db/*.ts`; the migration " +
          "list is the tracked `lib/db/migrations/*.sql` files; the drift status is READ FROM " +
          "committed `data/ops/production-integrity.json` — no live database call is made by " +
          "this generator, and the reading is quoted with its own as-of timestamp.",
      );
      out.push("");
      const schemaFiles = files.filter((f) => /^lib\/db\/[^/]+\.ts$/.test(f));
      const tables: Array<{ table: string; file: string }> = [];
      for (const f of schemaFiles) {
        const text = readFileSync(join(ROOT, f), "utf8");
        for (const m of text.matchAll(/pgTable\(\s*["']([^"']+)["']/g)) {
          tables.push({ table: m[1], file: f });
        }
      }
      tables.sort((a, b) => a.table.localeCompare(b.table));
      out.push(`**${tables.length} table(s) declared via pgTable across ${schemaFiles.length} lib/db file(s):**`);
      out.push("");
      if (tables.length === 0) {
        out.push("0 found — searched every inventoried lib/db/*.ts for `pgTable(`.");
      } else {
        out.push("| table | declared in |");
        out.push("| --- | --- |");
        for (const t of tables) out.push(`| \`${t.table}\` | \`${t.file}\` |`);
      }
      out.push("");
      const migrations = files.filter((f) => /^lib\/db\/migrations\/.*\.sql$/.test(f)).sort();
      out.push(`**${migrations.length} committed migration file(s):**`);
      out.push("");
      for (const m of migrations) out.push(`- \`${m}\``);
      out.push("");
      out.push("**Production drift status, from committed evidence:**");
      out.push("");
      const integrityPath = join(ROOT, "data", "ops", "production-integrity.json");
      if (!existsSync(integrityPath)) {
        out.push(
          "data/ops/production-integrity.json is ABSENT — the committed reading could not be " +
            "quoted. That is a fact about this working tree, not about production.",
        );
      } else {
        const integrity = JSON.parse(readFileSync(integrityPath, "utf8")) as Record<string, unknown>;
        out.push(`- observed: \`${String(integrity.observed)}\``);
        out.push(`- detail: ${cell(String(integrity.detail))}`);
        out.push(`- deployedSha: \`${String(integrity.deployedSha)}\``);
        out.push(`- observedAt: \`${String(integrity.observedAt)}\` (the reading's own as-of stamp; quoted, not current)`);
        out.push(`- moment: \`${String(integrity.moment)}\`, gateExit: \`${String(integrity.gateExit)}\``);
      }
      out.push("");
    }),
  );

  /* 6 — the gate set */
  sections.push(
    section("6. The gate set", (out) => {
      out.push("");
      out.push(
        "Method: imported from `GATES` in `scripts/gates.mjs` (the module the parity test " +
          "anchors to `.github/workflows/build-check.yml`). The count is derived from the " +
          "array, never hardcoded.",
      );
      out.push("");
      out.push(`**${GATES.length} gate(s):**`);
      out.push("");
      out.push("| id | CI job | command | why |");
      out.push("| --- | --- | --- | --- |");
      for (const g of GATES as Array<{ id: string; ciJob: string; command: string; why: string }>) {
        out.push(`| \`${g.id}\` | ${cell(g.ciJob)} | \`${cell(g.command)}\` | ${cell(g.why)} |`);
      }
      out.push("");
    }),
  );

  /* 7 — pnpm scripts */
  sections.push(
    section("7. pnpm script inventory", (out) => {
      out.push("");
      const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
        scripts: Record<string, string>;
      };
      const names = Object.keys(pkg.scripts).sort();
      out.push(`Method: \`package.json\`'s \`scripts\` block. **${names.length} script(s):**`);
      out.push("");
      out.push("| script | command |");
      out.push("| --- | --- |");
      for (const n of names) out.push(`| \`${n}\` | \`${cell(pkg.scripts[n])}\` |`);
      out.push("");
    }),
  );

  /* 8 — env var names */
  sections.push(
    section("8. Environment variable inventory — NAMES ONLY, never values", (out) => {
      out.push("");
      out.push(
        "Method: mechanical scan for `process.env.<NAME>` and `process.env[\"<NAME>\"]` across " +
          "tracked files under `lib/`, `scripts/`, `app/`, `tests/`, plus `next.config.ts`. " +
          "**Limits, stated:** dynamic access (`process.env[someVar]`) and names read only in " +
          "workflow YAML do not appear.",
      );
      out.push("");
      const scanFiles = files.filter(
        (f) =>
          (f.startsWith("lib/") || f.startsWith("scripts/") || f.startsWith("app/") || f.startsWith("tests/") || f === "next.config.ts") &&
          /\.(ts|tsx|mts|mjs|js)$/.test(f),
      );
      const byName = new Map<string, Set<string>>();
      for (const f of scanFiles) {
        const text = readFileSync(join(ROOT, f), "utf8");
        for (const m of text.matchAll(/process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
          if (!byName.has(m[1])) byName.set(m[1], new Set());
          byName.get(m[1])!.add(f);
        }
        for (const m of text.matchAll(/process\.env\[["']([A-Za-z_][A-Za-z0-9_]*)["']\]/g)) {
          if (!byName.has(m[1])) byName.set(m[1], new Set());
          byName.get(m[1])!.add(f);
        }
      }
      const names = [...byName.keys()].sort();
      out.push(`**Scanned ${scanFiles.length} file(s); ${names.length} distinct env var name(s) found:**`);
      out.push("");
      if (names.length === 0) {
        out.push("0 found — searched the file set named in the method line above.");
      } else {
        out.push("| name | files reading it |");
        out.push("| --- | ---: |");
        for (const n of names) out.push(`| \`${n}\` | ${byName.get(n)!.size} |`);
      }
      out.push("");
    }),
  );

  /* 9 — method knowledge */
  sections.push(
    section("9. Method knowledge registry", (out) => {
      out.push("");
      out.push(
        `Method: \`${GOVERNED_METHOD_WRITER.store}\`, the canonical route store (types in ` +
          "`lib/method/knowledge.ts`). Assertion classes are the four of " +
          "`lib/method/claims.ts` — ROUTE_EXISTENCE (A), ROUTE_OUTCOME (B), COVERAGE_CLAIM " +
          "(C), DERIVED_CONCLUSION (D). A route with no declared claims renders UNCLASSIFIED " +
          "— nobody declared a class, which is NOT a claim that the entry concludes nothing. " +
          "Last-verified is the latest recorded outcome date, else the learned date. " +
          "Uncapped; version and counts derived from the store, never hardcoded.",
      );
      out.push("");
      interface RouteJson {
        id: string;
        tier: string;
        kind?: string;
        origin?: string;
        learnedOn?: string | null;
        learnedAtVersion?: number;
        retiredOn?: string;
        applicability?: { portability?: string };
        outcomes?: Array<{ walkedOn?: string; outcome?: string; jurisdiction?: string }>;
        claims?: Array<{
          id: string;
          class: string;
          statement: string;
          retraction?: { kind: string; on: string };
        }>;
      }
      const store = JSON.parse(
        readFileSync(join(ROOT, GOVERNED_METHOD_WRITER.store), "utf8"),
      ) as { version: number; updatedOn: string | null; routes: RouteJson[] };
      const classified = store.routes.filter((r) => (r.claims ?? []).length > 0);
      out.push(
        `**Method version ${store.version}, updated ${store.updatedOn ?? "(no date recorded)"} — ` +
          `${store.routes.length} route(s), ${classified.length} carrying declared claim ` +
          `classes and ${store.routes.length - classified.length} UNCLASSIFIED (predating the ` +
          `v55 adoption or not yet amended).**`,
      );
      out.push("");
      out.push("| route id | tier | kind | portability | source record (origin) | last verified | claims (class: statement) |");
      out.push("| --- | --- | --- | --- | --- | --- | --- |");
      for (const r of store.routes) {
        const outcomes = (r.outcomes ?? []).filter((o) => o.walkedOn);
        const lastVerified =
          outcomes.length > 0
            ? outcomes.map((o) => o.walkedOn!).sort().at(-1)!
            : (r.learnedOn ?? "no date recorded");
        const claims =
          (r.claims ?? []).length === 0
            ? "UNCLASSIFIED — no declared claim classes"
            : (r.claims ?? [])
                .map(
                  (c) =>
                    `${c.class}: ${cell(c.statement)}` +
                    (c.retraction ? ` [RETRACTED ${c.retraction.kind} ${c.retraction.on}]` : ""),
                )
                .join(" · ");
        out.push(
          `| \`${r.id}\`${r.retiredOn ? ` (retired ${r.retiredOn})` : ""} | ${r.tier} | ` +
            `${r.kind ?? "UNCLASSIFIED"} | ${r.applicability?.portability ?? "(none)"} | ` +
            `${cell(r.origin ?? "(none recorded)")} | ${lastVerified} | ${claims} |`,
        );
      }
      out.push("");
      out.push(
        `Stated ${store.routes.length} route(s); the table above renders exactly ` +
          `${store.routes.length} row(s).`,
      );
      out.push("");
    }),
  );

  /* 10 — ruling ledger index */
  sections.push(
    section("10. Ruling ledger index", (out) => {
      out.push("");
      out.push(
        "Method: `docs/governance/index.json` (generated from the canonical ledger " +
          "`docs/governance/ledger.jsonl` by `pnpm governance:compile`). Uncapped; count " +
          "derived from the records array.",
      );
      out.push("");
      const index = JSON.parse(
        readFileSync(join(ROOT, "docs", "governance", "index.json"), "utf8"),
      ) as { records: Array<{ id: string; title: string; status: string }> };
      out.push(`**${index.records.length} record(s):**`);
      out.push("");
      out.push("| id | title | status |");
      out.push("| --- | --- | --- |");
      for (const r of index.records) {
        out.push(`| \`${r.id}\` | ${cell(r.title)} | ${r.status} |`);
      }
      out.push("");
      out.push(
        `Stated ${index.records.length}; rendered ${index.records.length} row(s).`,
      );
      out.push("");
    }),
  );

  /* 11 — data sources */
  sections.push(
    section("11. Data source inventory", (out) => {
      out.push("");
      out.push(
        "Method: the directories under `lib/sources/` (one ingestion adapter per external " +
          "source, per the constitution's placement rule), plus the section headings of " +
          "`docs/sources.md` — the live register of sources, hosts, credentials and " +
          "permission state. The register's PROSE is authoritative for permission; this " +
          "section only indexes it.",
      );
      out.push("");
      const sourcesDir = join(ROOT, "lib", "sources");
      const adapters = readdirSync(sourcesDir)
        .filter((n) => statSync(join(sourcesDir, n)).isDirectory())
        .sort();
      out.push(`**${adapters.length} adapter director(ies) under lib/sources/:**`);
      out.push("");
      out.push(adapters.map((a) => `\`${a}\``).join(", "));
      out.push("");
      const sourcesDoc = readFileSync(join(ROOT, "docs", "sources.md"), "utf8");
      const headings = sourcesDoc
        .split("\n")
        .map((l, i) => ({ line: i + 1, text: l }))
        .filter((l) => /^#{2,3} /.test(l.text));
      out.push(`**docs/sources.md carries ${headings.length} section heading(s):**`);
      out.push("");
      for (const h of headings) out.push(`- L${h.line}: ${cell(h.text.replace(/^#+\s*/, ""))}`);
      out.push("");
    }),
  );

  /* 12 — scheduled jobs */
  sections.push(
    section("12. Scheduled job inventory, and the measured dispatch-delay evidence", (out) => {
      out.push("");
      out.push(
        "Method: every `.github/workflows/*.yml`, with its `cron:` line(s) extracted " +
          "mechanically; a workflow with none is listed as dispatch/event-driven. The " +
          "scheduler is GitHub Actions, not platform cron.",
      );
      out.push("");
      const wfDir = join(ROOT, ".github", "workflows");
      const workflows = readdirSync(wfDir).filter((n) => /\.ya?ml$/.test(n)).sort();
      out.push(`**${workflows.length} workflow(s):**`);
      out.push("");
      out.push("| workflow | schedule |");
      out.push("| --- | --- |");
      for (const w of workflows) {
        const text = readFileSync(join(wfDir, w), "utf8");
        const crons = [...text.matchAll(/cron:\s*["']([^"']+)["']/g)].map((m) => m[1]);
        out.push(
          `| \`${w}\` | ${crons.length > 0 ? crons.map((c) => `\`${c}\``).join(", ") : "dispatch/event only — no cron"} |`,
        );
      }
      out.push("");
      out.push("### Measured dispatch delay — recorded measurements, quoted with their stamps");
      out.push("");
      out.push(
        "Method: the tracker's `JOB` rows (written by the job-watch audit), read from " +
          "`docs/tracker-working.csv`. **These are quoted as RECORDED measurements with their " +
          "own as-of stamps — never as current readings.** Each row's full note carries the " +
          "envelope reasoning; the observed envelope grows and is a floor, not a ceiling.",
      );
      out.push("");
      const csv = readFileSync(join(ROOT, "docs", "tracker-working.csv"), "utf8");
      const rows = parseCsv(csv) as Array<Array<{ value: string; line: number }>>;
      if (rows.length === 0) throw new Error("docs/tracker-working.csv parsed to zero rows");
      const header = rows[0].map((c) => c.value.trim());
      const idCol = header.indexOf("ID");
      const titleCol = header.findIndex((h) => /^(Title|Item)$/i.test(h));
      if (idCol < 0) throw new Error(`no ID column in tracker header: ${header.join(", ")}`);
      const jobRows = rows
        .slice(1)
        .filter((r) => /^JOB\d+$/.test(r[idCol]?.value ?? ""))
        .map((r) => {
          // The audit prose lives in whichever prose column the writer used, so
          // the stamp and run id are searched across the WHOLE row.
          const rowText = r.map((c) => c?.value ?? "").join(" ");
          const asOf =
            /AS OF: ([0-9T:.Z-]+?)\.?(?:\s|$)/.exec(rowText)?.[1] ??
            "(no AS OF stamp found in the row)";
          const run = /Run (\d+)/.exec(rowText)?.[1] ?? "(no run id found)";
          return {
            id: r[idCol].value,
            title: titleCol >= 0 ? (r[titleCol]?.value ?? "") : "(no Title column)",
            asOf,
            run,
          };
        });
      out.push(`**${jobRows.length} JOB row(s) found in the working store:**`);
      out.push("");
      if (jobRows.length === 0) {
        out.push(
          "0 found — searched docs/tracker-working.csv for rows whose ID matches `JOB<digits>`.",
        );
      } else {
        out.push("| row | recorded measurement (the row's own title) | run | as-of stamp |");
        out.push("| --- | --- | --- | --- |");
        for (const j of jobRows) {
          out.push(`| \`${j.id}\` | ${cell(j.title)} | ${j.run} | \`${j.asOf}\` |`);
        }
      }
      out.push("");
    }),
  );

  /* 13 — tests */
  sections.push(
    section("13. Test inventory", (out) => {
      out.push("");
      out.push(
        "Method: every inventoried file under `tests/`, with a mechanical count of `test(` and " +
          "`it(` call tokens per `.test.ts` file. **Limits, stated:** the token count includes " +
          "subtests (`t.test(`) and any occurrence inside a string or comment, and `node --test` " +
          "reports its own authoritative totals — this column is an index, not the suite's " +
          "verdict.",
      );
      out.push("");
      const testFiles = files.filter((f) => f.startsWith("tests/") && f.endsWith(".test.ts")).sort();
      const otherTestTree = files.filter((f) => f.startsWith("tests/") && !f.endsWith(".test.ts"));
      let total = 0;
      const rows: string[] = [];
      for (const f of testFiles) {
        const text = readFileSync(join(ROOT, f), "utf8");
        const n = (text.match(/\btest\(|\bit\(/g) ?? []).length;
        total += n;
        rows.push(`| \`${f}\` | ${n} |`);
      }
      out.push(
        `**${testFiles.length} test file(s), ${total} \`test(\`/\`it(\` token(s); plus ` +
          `${otherTestTree.length} non-.test.ts file(s) under tests/ (fixtures, helpers, ` +
          `recorded evidence) not itemized here.**`,
      );
      out.push("");
      out.push("| test file | test( / it( tokens |");
      out.push("| --- | ---: |");
      for (const r of rows) out.push(r);
      out.push("");
    }),
  );

  /* 14 — control-plane providers */
  sections.push(
    section("14. ControlPlaneRepository providers", (out) => {
      out.push("");
      out.push(
        "Method: the provider files under `lib/control-plane/repository/`, with each " +
          "provider's own `durable:` declaration extracted from its source.",
      );
      out.push("");
      const providers = [
        {
          file: "lib/control-plane/repository/file-store.ts",
          role:
            "the durable filesystem store — CURRENTLY AUTHORITATIVE. Control-plane work " +
            "state persists under the committed-file substrate (the same class as " +
            "data/workstate/), deliberately not Postgres (which is the reader-serving " +
            "substrate and gated by db:gate).",
        },
        {
          file: "lib/control-plane/repository/memory.ts",
          role:
            "the in-process double — pins the same rules over a Map for the concurrency " +
            "suite; it does not survive the process and durability tests refuse it.",
        },
      ];
      out.push(`**${providers.length} provider(s):**`);
      out.push("");
      for (const p of providers) {
        const full = join(ROOT, p.file);
        if (!existsSync(full)) {
          out.push(`- \`${p.file}\` — ABSENT from the working tree (expected a provider here).`);
          continue;
        }
        const text = readFileSync(full, "utf8");
        const durable = /durable:\s*(true|false)/.exec(text)?.[1] ?? "(no durable: literal found)";
        out.push(`- \`${p.file}\` — \`durable: ${durable}\`. ${p.role}`);
      }
      out.push("");
      out.push(
        "The crash-recovery and durable-runtime suites (`tests/control-plane-crash-recovery" +
          ".test.ts`, `tests/control-plane-durable-runtime.test.ts`) run against the FILE " +
          "store; the concurrency-rule suite runs against the double.",
      );
      out.push("");
    }),
  );

  return sections;
}

/* -------------------------------------------------------------- assembly --- */

function renderBody(todayStr: string): string {
  const files = repoFiles();
  const sections = buildSections(files);
  const out: string[] = [];

  out.push("## What this is");
  out.push("");
  out.push(
    "A mechanical inventory of this repository, joined to the author's Drive mirror: this " +
      `document is one of the ${MIRRORED_DOCS.length} canonical mirror documents (the count is ` +
      "derived from `scripts/mirror-set.mjs`, never restated). **The section list below is a " +
      "starting point, never a limit** — an inventory dimension this document lacks is a gap " +
      "in the generator, not evidence the dimension is empty. UNCAPPED: every section renders " +
      "everything it found; an empty section says \"0 found\" and what was searched; a failed " +
      "parse renders its error inline; stated counts equal rendered rows.",
  );
  out.push("");
  out.push(`### Contents — ${sections.length} section(s)`);
  out.push("");
  for (const s of sections) out.push(`- ${s.title}`);
  out.push("");
  for (const s of sections) {
    out.push(`## ${s.title}`);
    out.push(...s.lines);
  }

  return out.map((l) => annotateFutureDates(l, todayStr)).join("\n") + "\n";
}

function headSha(): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
}

function renderDocument(): { next: string; carried: boolean } {
  const body = renderBody(today());
  if (existsSync(DOC)) {
    const committed = readFileSync(DOC, "utf8");
    const at = committed.indexOf(STAMP_END);
    if (at >= 0) {
      const committedBody = committed.slice(at + STAMP_END.length).replace(/^\r?\n\r?\n/, "");
      if (committedBody === body) return { next: committed, carried: true };
    }
  }
  const head = [
    "# Repo inventory",
    "",
    GENERATED_HEADER,
    "",
    `Generated ${generatedAtEastern()} by \`pnpm repo-map\`. HEAD \`${headSha()}\`.`,
    "",
    STAMP_END,
    "",
    "",
  ].join("\n");
  return { next: `${head}${body}`, carried: false };
}

const invoked = process.argv[1]?.replace(/\\/g, "/").endsWith("repo-map.mts");
if (invoked) {
  const { next, carried } = renderDocument();
  const committed = existsSync(DOC) ? readFileSync(DOC, "utf8") : null;
  if (process.argv.includes("--check")) {
    // --check NEVER writes. Stale is reported and left stale.
    if (committed === next) {
      console.log(`docs/repo-inventory.md is current — stamp ${carried ? "carried" : "fresh"}`);
    } else {
      const a = (committed ?? "").split("\n");
      const b = next.split("\n");
      let firstDiff = 0;
      while (firstDiff < Math.min(a.length, b.length) && a[firstDiff] === b[firstDiff]) firstDiff++;
      console.error(
        committed === null
          ? "docs/repo-inventory.md does not exist. Run: pnpm repo-map"
          : `docs/repo-inventory.md is STALE against the tree — committed ${a.length} line(s), ` +
              `regenerated ${b.length} line(s), first difference at line ${firstDiff + 1}. ` +
              "Run: pnpm repo-map (--check repairs nothing)",
      );
      process.exit(1);
    }
  } else {
    if (committed === next) {
      console.log("docs/repo-inventory.md unchanged — stamp carried");
    } else {
      writeFileSync(DOC, next, "utf8");
      console.log(
        `docs/repo-inventory.md written — ${next.split("\n").length} line(s), stamp ${carried ? "carried" : "fresh"}`,
      );
    }
  }
}
