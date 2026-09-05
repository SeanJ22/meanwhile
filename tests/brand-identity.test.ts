import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import test from "node:test";

/**
 * THE BRAND IDENTITY'S OWN GUARDS (ITEM J, 2026-09-01).
 *
 * These do not check that the lockup looks right — a capture does that, and
 * `docs/evidence/brand-2026-09-01/` holds them. What these refuse are the
 * three ways the identity comes apart silently:
 *
 * 1. `--mark` escaping the lockup and becoming a status colour somewhere.
 * 2. A Google font host appearing in the app tree, which would hand every
 *    reader's IP address to a third party on every page view.
 * 3. A `var(--token)` reference whose token is declared nowhere — the class
 *    of defect that had ten border declarations painting nothing at all.
 */

const ROOT = join(import.meta.dirname, "..");
const CSS = join(ROOT, "app", "globals.css");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      walk(path, out);
    } else out.push(path);
  }
  return out;
}

/** Every source file a reader's browser can be served styling or markup from. */
function styledSources(): string[] {
  return [join(ROOT, "app"), join(ROOT, "components"), join(ROOT, "hooks")]
    .flatMap((d) => (statSync(d).isDirectory() ? walk(d) : []))
    .filter((f) => /\.(css|tsx|ts)$/.test(f));
}

// ── 1. the mark stays inside the lockup ──────────────────────────────────────

/**
 * `--mark` is `--accent-state`, on purpose. That reuse is only honest while
 * the token cannot appear anywhere a reader could take it for a status: the
 * tier colours are learned from the map legend, and a teal fill on anything
 * BUT the logo is a tier claim as far as a reader is concerned.
 *
 * So there are exactly two legal references — the declaration, and the
 * square's fill.
 */
test("--mark is referenced only by its declaration and the logo square", () => {
  const css = readFileSync(CSS, "utf8");

  const declarations = [...css.matchAll(/(^|[;{\s])--mark\s*:/g)];
  assert.equal(
    declarations.length,
    1,
    "--mark must be declared exactly once — its value is a reference to " +
      "--accent-state, which already carries its own light override.",
  );

  const offenders: string[] = [];
  for (const file of styledSources()) {
    const source = readFileSync(file, "utf8");
    const lines = source.split(/\r?\n/);
    lines.forEach((line, i) => {
      if (!/var\(\s*--mark\s*[),]/.test(line)) return;
      const where = `${relative(ROOT, file).split(sep).join("/")}:${i + 1}`;
      // The only legal consumer: the square's fill in the lockup's own block.
      if (where.startsWith("app/globals.css") && /^\s*fill:\s*var\(--mark\);\s*$/.test(line)) {
        return;
      }
      offenders.push(`${where}  ${line.trim()}`);
    });
  }

  assert.deepEqual(
    offenders,
    [],
    "--mark left the lockup. It may not be a fill, border, text colour, glow " +
      "or tint on any other element, at any time — the moment it is, a reader " +
      "cannot tell the brand from a tier claim:\n  " +
      offenders.join("\n  "),
  );
});

test("the brand square is filled, and no brand rule makes it hollow or dashed", () => {
  const css = readFileSync(CSS, "utf8");
  const logoRules = css
    .split(/\n(?=[.#@a-zA-Z:\[])/)
    .filter((block) => /^\.wtp-logo/.test(block.trim()));

  assert.ok(logoRules.length > 0, "the lockup's own rules are missing from globals.css");

  for (const block of logoRules) {
    assert.ok(
      !/border-style:\s*dashed/.test(block),
      `a dashed brand rule would read as "unsourced":\n${block}`,
    );
    assert.ok(
      !/fill:\s*(none|transparent)/.test(block),
      `a hollow brand square would read as "concluded":\n${block}`,
    );
  }

  assert.match(
    css,
    /\.wtp-logo-square\s*\{[^}]*fill:\s*var\(--mark\);/,
    "the square must be FILLED with --mark",
  );
});

// ── 2. no reader's IP address reaches a font host ────────────────────────────

/**
 * `next/font` self-hosts the font files at build time. A stylesheet `<link>`
 * or an `@import` to Google's CSS does the opposite: it hands Google the IP,
 * the User-Agent and the Referer of every person who opens the site, on every
 * page view — while `app/transparency/page.tsx` tells them we collect almost
 * nothing. The claim and the network tab have to agree.
 *
 * Comments in `app/layout.tsx` explain exactly this, so the guard reads code
 * with comments stripped: an explanation of the rule is not a breach of it.
 */
test("no Google font host is reachable from the app tree", () => {
  const hosts = ["fonts.googleapis.com", "fonts.gstatic.com"];
  const offenders: string[] = [];
  for (const file of styledSources()) {
    const raw = readFileSync(file, "utf8");
    const code = raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
      .join("\n");
    for (const host of hosts) {
      if (code.includes(host)) {
        offenders.push(`${relative(ROOT, file).split(sep).join("/")} → ${host}`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `a third-party font request on every page view contradicts this site's own ` +
      `collection claim. Load fonts through next/font/google, which self-hosts ` +
      `them:\n  ${offenders.join("\n  ")}`,
  );
});

test("the record face is loaded through next/font and exposed as --font-record", () => {
  const layout = readFileSync(join(ROOT, "app", "layout.tsx"), "utf8");
  assert.match(layout, /EB_Garamond/, "EB Garamond must be declared in the layout");
  assert.match(layout, /from "next\/font\/google"/, "fonts come from next/font/google");
  assert.match(
    layout,
    /variable:\s*"--font-eb-garamond"/,
    "the face must be exposed as a CSS variable, not applied by class",
  );
  assert.match(layout, /weight:\s*\["500"\]/, "weight 500, and only 500");
  assert.match(
    layout,
    /ebGaramond\.variable/,
    "the variable has to actually reach <html>, or --font-record resolves to nothing",
  );

  const css = readFileSync(CSS, "utf8");
  assert.match(
    css,
    /--font-record:\s*var\(--font-eb-garamond\)/,
    "--font-record is the serif token's name; --font-voice would collide with " +
      "the --voice COLOUR and --font-display is DM Sans",
  );
  /* A DECLARATION, not a mention: the token comment beside --font-record
     explains why the serif token is NOT called --font-voice, and a guard that
     greps raw text reads that explanation as the defect it describes. */
  assert.ok(
    !/(^|[;{\s])--font-voice\s*:/.test(css),
    "--font-voice must not be declared: --voice is already a colour in this " +
      "file, and the pair is a collision waiting to be misread",
  );
});

// ── 3. every var(--token) resolves to something ─────────────────────────────

/**
 * A `var(--token)` whose token is declared nowhere is invalid at
 * computed-value time. What that does depends on the declaration:
 *
 * - `border: 1px solid var(--border)` — the whole SHORTHAND is dropped, so
 *   `border-style` falls to `none` and **no border is painted at all**.
 * - `border-color: var(--border)` on an element that sets its style
 *   elsewhere — only the colour resets, to `currentColor`, so the border
 *   paints in the TEXT colour, much heavier than intended.
 *
 * Both shipped. Ten declarations referenced `--border`, which this stylesheet
 * has never declared; four component call sites referenced `--rule`, one
 * referenced `--paper` and two referenced `--destructive`. Same shape as the
 * `--muted` defect fixed under BAL-26, which is why this is a class guard and
 * not nine one-line fixes.
 */

/**
 * Tokens set at RUNTIME by the component that owns them, rather than in a
 * theme block. Each one is named with its setter, because an allowlist
 * without a reason is how the next undeclared token gets waved through.
 */
const RUNTIME_DECLARED: Record<string, string> = {
  "--tier-accent": "components/shell/tier-style.ts + components/map/legend.tsx",
  "--tier-glow": "components/shell/tier-style.ts + components/map/legend.tsx",
  "--chip-accent": "components/shell/filters-area.tsx",
  "--chip-fill": "components/officials/person-identity.tsx (guarded by [data-fill])",
  "--ask-expansion-top": "components/shell/pill-cluster.tsx (initialized state, set on the expansion's ancestor every render)",
  "--pin-color": "lib/map/marker-pool.ts",
  "--pin-glow": "lib/map/marker-pool.ts",
  "--spider-len": "lib/map/marker-pool.ts",
  "--spider-angle": "lib/map/marker-pool.ts",
  "--wtp-logo-size": "components/brand/logo.tsx",
  "--wtp-logo-beat": "app/globals.css (.wtp-logo / .wtp-logo--mark)",
  /* next/font writes these onto <html> through the layout's className. */
  "--font-dm-sans": "app/layout.tsx (next/font)",
  "--font-jetbrains-mono": "app/layout.tsx (next/font)",
  "--font-eb-garamond": "app/layout.tsx (next/font)",
};

test("the Ask positioning token is set on its cluster from initialized state", () => {
  const cluster = readFileSync(join(ROOT, "components", "shell", "pill-cluster.tsx"), "utf8");
  assert.match(cluster, /const \[expansionTop, setExpansionTop\] = useState\(0\)/,
    "the runtime token must have a value even before layout measurement");
  assert.match(cluster, /data-pill-cluster=\{placement\}[^>]*style=\{\{\s*"--ask-expansion-top":\s*`\$\{expansionTop\}px`\s*\} as CSSProperties\}/,
    "the token must be set in pixels on the ancestor that contains .ask-expansion");
});

function declaredCssTokens(css: string): Set<string> {
  const declared = new Set<string>();
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(^|[;{\s])(--[a-zA-Z0-9_-]+)\s*:/g)) declared.add(m[2]);
  return declared;
}

test("CSS Module declarations resolve locally without lending tokens to unrelated modules", () => {
  const moduleCss = ".card { --local-rim: white; box-shadow: inset 0 0 0 1px var(--local-rim); color: var(--misspelled); }";
  const declared = declaredCssTokens(moduleCss);
  const missing = [...moduleCss.matchAll(/var\((--[\w-]+)\)/g)].map(match => match[1]).filter(token => !declared.has(token));
  assert.deepEqual(missing, ["--misspelled"], "an undeclared reference still fails inside a CSS Module");
  assert.equal(declaredCssTokens(".other { color: var(--local-rim); }").has("--local-rim"), false,
    "a token declared by a different module cannot hide an unresolved local reference");
  assert.equal(declaredCssTokens("/* --only-in-comment: white; */").size, 0);
});

test("every var(--token) reference resolves to a declared token", () => {
  /*
   * Two theme sources, not one. The reader's tokens live in `app/globals.css`;
   * the owner control centre carries its OWN dark and light blocks in
   * `app/(admin)/layout.tsx` (the Lumen Edge pass, ADM-21, 2026-09-05), and
   * keeps them out of the reader stylesheet on purpose — the console is not
   * the product. A token declared in either place resolves; one declared in
   * neither is the defect this guard exists for.
   */
  const declared = new Set<string>([
    ...declaredCssTokens(readFileSync(CSS, "utf8")),
    ...declaredCssTokens(readFileSync(join(ROOT, "app", "(admin)", "layout.tsx"), "utf8")),
  ]);

  const offenders: string[] = [];
  for (const file of styledSources()) {
    const raw = readFileSync(file, "utf8");
    /* Comments quote the tokens they explain — including the ones this test
       exists because of — so they are stripped before the sweep. */
    const code = raw
      .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/\S/g, " "))
      .split("\n")
      .map((l) => (l.trim().startsWith("//") || l.trim().startsWith("*") ? "" : l))
      .join("\n");
    // CSS Modules own scoped design tokens. Read declarations from the SAME
    // module only; collecting every module's tokens globally would mask leaks.
    const localDeclared = file.endsWith(".module.css") ? declaredCssTokens(code) : new Set<string>();
    code.split(/\r?\n/).forEach((line, i) => {
      for (const m of line.matchAll(/var\(\s*(--[a-zA-Z0-9_-]+)\s*([,)])/g)) {
        const token = m[1];
        if (declared.has(token) || localDeclared.has(token)) continue;
        if (token in RUNTIME_DECLARED) continue;
        if (token.startsWith("--tw-")) continue;
        /* A var() carrying its own fallback still renders something. It is
           weaker than a declared token and it is not this guard's subject. */
        if (m[2] === ",") continue;
        offenders.push(
          `${relative(ROOT, file).split(sep).join("/")}:${i + 1}  ${token}  ${line.trim()}`,
        );
      }
    });
  }

  assert.deepEqual(
    offenders,
    [],
    "these var() references name a token declared in neither the theme CSS nor its own CSS Module and " +
      "carry no fallback. A shorthand containing one drops entirely (no border " +
      "at all); a longhand falls back to currentColor (the border paints in the " +
      "text colour). Fix at the shared point — usually --panel-border:\n  " +
      offenders.join("\n  "),
  );
});

// ── 4. the icon assets track the palette ────────────────────────────────────

/**
 * `app/icon.svg` is served standalone, so it cannot use a custom property:
 * nothing is in scope. The values are therefore literal, and a literal is a
 * copy that can go stale — so it is pinned to the stylesheet it copied.
 */
test("app/icon.svg carries the dark theme's --bg and --mark, and the square is filled", () => {
  const svg = readFileSync(join(ROOT, "app", "icon.svg"), "utf8");
  const css = readFileSync(CSS, "utf8");

  const bg = /:root\s*\{[\s\S]*?--bg:\s*(#[0-9a-fA-F]{6});/.exec(css)?.[1];
  const state = /:root\s*\{[\s\S]*?--accent-state:\s*(#[0-9a-fA-F]{6});/.exec(css)?.[1];
  assert.ok(bg && state, "could not read --bg / --accent-state out of the dark block");

  assert.ok(
    svg.includes(`fill="${bg}"`),
    `the icon's ground must be the dark theme's --bg (${bg})`,
  );
  assert.ok(
    svg.includes(`fill="${state}"`),
    `the icon's square must be --mark, which resolves to --accent-state (${state})`,
  );
  assert.ok(
    !/fill="none"/.test(svg) && !/stroke=/.test(svg),
    "the mark is a FILLED square — an outline would read as concluded",
  );
});

/**
 * `app/favicon.ico` was the create-next-app DEFAULT — a black circle with a
 * white triangle — and Next lists it AHEAD of `icon.svg` in `<head>`, so it
 * was what a reader's browser tab actually showed. Shipping `icon.svg` alone
 * would have left the scaffolding icon winning in every browser that prefers
 * `.ico`, which is most of them.
 *
 * The ICO cannot be read for a colour here (its entries are PNG-encoded), so
 * what is asserted is its SHAPE: the three sizes this repo generates, and not
 * the four the scaffolding shipped.
 */
test("app/favicon.ico is the generated mark, not the create-next-app default", () => {
  const ico = readFileSync(join(ROOT, "app", "favicon.ico"));
  assert.equal(ico.readUInt16LE(0), 0, "byte 0-1 of an ICO is a zero reserved field");
  assert.equal(ico.readUInt16LE(2), 1, "type 1 is an icon");

  const count = ico.readUInt16LE(4);
  const sizes = Array.from({ length: count }, (_, i) => ico[6 + i * 16] || 256);
  assert.deepEqual(
    sizes,
    [16, 32, 48],
    "the scaffolding default carried 16/32/48/256 and a Next.js glyph. " +
      "Regenerate with `pnpm exec tsx scripts/brand-assets-0901.mts`.",
  );

  /* Every entry is a PNG (89 50 4E 47) at the offset its directory row names —
     a directory that points at nothing would still satisfy the sizes above. */
  for (let i = 0; i < count; i += 1) {
    const at = ico.readUInt32LE(6 + i * 16 + 12);
    assert.equal(
      ico.subarray(at, at + 4).toString("hex"),
      "89504e47",
      `ICO entry ${i} does not point at a PNG`,
    );
  }
});
