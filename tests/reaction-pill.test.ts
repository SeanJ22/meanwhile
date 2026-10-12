import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  REACTION_LABELS,
  REACTION_TONE,
  isSettled,
  reactionChoiceClass,
} from "../lib/reactions/pill.ts";
import {
  SCALE_V1,
  SCALE_V2_FUNDING,
  type ReactionValue,
} from "../lib/signal/reactions.ts";

/**
 * Resolves each settled pill's class list through the stylesheet (specificity
 * and source order) to a literal colour in both themes, so a captured reaction
 * that cannot be seen fails here.
 */

const ROOT = process.cwd();
const CSS = readFileSync(join(ROOT, "app", "globals.css"), "utf8");

// ── A small, deliberately narrow cascade model ───────────────────────────

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Top-level `selector { body }` rules; @-blocks are skipped whole. */
function topLevelRules(css: string): { selector: string; body: string }[] {
  const source = stripComments(css);
  const rules: { selector: string; body: string }[] = [];
  let i = 0;
  while (i < source.length) {
    const open = source.indexOf("{", i);
    if (open === -1) break;
    // A statement at-rule (`@import …;`) sits in the prelude of the next
    // rule; the selector is what follows the last one.
    const selector = (source.slice(i, open).split(";").pop() ?? "").trim();
    // Walk to the matching close brace so nested blocks stay together.
    let depth = 1;
    let j = open + 1;
    while (j < source.length && depth > 0) {
      if (source[j] === "{") depth++;
      else if (source[j] === "}") depth--;
      j++;
    }
    if (!selector.startsWith("@")) {
      rules.push({ selector, body: source.slice(open + 1, j - 1) });
    }
    i = j;
  }
  return rules;
}

const RULES = topLevelRules(CSS);

function declarations(body: string): Map<string, string> {
  const out = new Map<string, string>();
  // Only top-level declarations of the block — enough for the flat rules
  // this model covers, and every rule it covers is asserted flat below.
  for (const part of body.split(";")) {
    const idx = part.indexOf(":");
    if (idx === -1) continue;
    const prop = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!prop || prop.includes("{") || prop.includes("}")) continue;
    out.set(prop, value);
  }
  return out;
}

function tokensFor(theme: "dark" | "light"): Map<string, string> {
  const tokens = new Map<string, string>();
  const selectors = theme === "dark" ? [":root"] : [":root", '[data-theme="light"]'];
  for (const selector of selectors) {
    for (const rule of RULES) {
      if (rule.selector !== selector) continue;
      for (const [prop, value] of declarations(rule.body)) {
        if (prop.startsWith("--")) tokens.set(prop, value);
      }
    }
  }
  return tokens;
}

/** Resolve a value through `var()` chains; null when a reference dead-ends. */
function resolve(
  value: string,
  tokens: Map<string, string>,
  local: Map<string, string>,
  depth = 0,
): string | null {
  if (depth > 12) return null;
  const match = /^var\(\s*(--[a-z0-9-]+)\s*(?:,([\s\S]+))?\)$/i.exec(value.trim());
  if (!match) return value.trim();
  const [, name, fallback] = match;
  const declared = local.get(name) ?? tokens.get(name);
  if (declared !== undefined) {
    const resolved = resolve(declared, tokens, local, depth + 1);
    if (resolved !== null) return resolved;
  }
  return fallback === undefined ? null : resolve(fallback, tokens, local, depth + 1);
}

/** Specificity for the flat class selectors this model accepts. */
function classesOf(selector: string): string[] | null {
  if (!/^(\.[A-Za-z0-9_-]+)+$/.test(selector)) return null;
  return selector.split(".").filter(Boolean);
}

/** What the browser would compute for `classList`; later rules win at equal specificity. */
function computeFor(
  classList: string[],
  theme: "dark" | "light",
  properties: string[],
): Map<string, string | null> {
  const tokens = tokensFor(theme);
  const have = new Set(classList);
  const local = new Map<string, string>();
  const winners = new Map<string, { specificity: number; value: string }>();

  RULES.forEach((rule) => {
    for (const selector of rule.selector.split(",")) {
      const classes = classesOf(selector.trim());
      if (!classes || !classes.every((c) => have.has(c))) continue;
      const specificity = classes.length;
      for (const [prop, value] of declarations(rule.body)) {
        if (prop.startsWith("--")) {
          local.set(prop, value);
          continue;
        }
        const current = winners.get(prop);
        // `<=`: source order breaks a specificity tie in favour of the later rule.
        if (!current || current.specificity <= specificity) {
          winners.set(prop, { specificity, value });
        }
      }
    }
  });

  const out = new Map<string, string | null>();
  for (const prop of properties) {
    const winner = winners.get(prop);
    out.set(prop, winner ? resolve(winner.value, tokens, local) : null);
  }
  return out;
}

// ── Contrast, so "visible" is a number ───────────────────────────────────

function channel(component: number): number {
  const c = component / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const value = hex.trim().replace("#", "");
  const full =
    value.length === 3
      ? value
          .split("")
          .map((c) => c + c)
          .join("")
      : value.slice(0, 6);
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const ALL_VALUES: ReactionValue[] = [
  ...new Set([...SCALE_V1.values, ...SCALE_V2_FUNDING.values]),
];

// ── The taps ─────────────────────────────────────────────────────────────

test("every value on every scale is offered, labelled, and toned", () => {
  assert.ok(ALL_VALUES.length >= 9, "both scales' values should be covered");
  for (const value of ALL_VALUES) {
    assert.ok(REACTION_LABELS[value], `${value} has no label`);
    assert.ok(REACTION_TONE[value], `${value} has no tone`);
  }
});

test("tapping any value renders a settled pill carrying that value's tone", () => {
  for (const value of ALL_VALUES) {
    // The tap: selected, and the server answered 204.
    const counted = reactionChoiceClass(value, true, "COUNTED");
    assert.ok(
      counted.includes("reaction-choice--settled"),
      `${value}: a counted tap does not render as settled`,
    );
    assert.ok(
      counted.includes(`vote-pill--${REACTION_TONE[value]}`),
      `${value}: a counted tap carries no tone class`,
    );
    // The device's own memory, no tap this session, is settled too.
    const remembered = reactionChoiceClass(value, true, null);
    assert.equal(remembered, counted);
  }
});

test("a write that did not land never wears the pill", () => {
  for (const value of ALL_VALUES) {
    for (const outcome of ["SAVING", "NOT_COUNTED"] as const) {
      assert.equal(isSettled(true, outcome), false);
      const cls = reactionChoiceClass(value, true, outcome);
      assert.ok(
        !cls.includes("reaction-choice--settled"),
        `${value}/${outcome}: an unlanded write borrowed the settled pill`,
      );
      assert.ok(
        !/vote-pill--/.test(cls),
        `${value}/${outcome}: an unlanded write borrowed a position colour`,
      );
    }
  }
});

// ── The screen ───────────────────────────────────────────────────────────

const EXPECTED_FILL: Record<string, string> = {
  yes: "--vote-yes",
  no: "--vote-no",
  neutral: "--vote-neutral",
  "yes-strong": "--vote-yes-strong",
  "no-strong": "--vote-no-strong",
};

for (const theme of ["dark", "light"] as const) {
  test(`a captured reaction is legible on screen — ${theme} theme`, () => {
    const tokens = tokensFor(theme);
    for (const value of ALL_VALUES) {
      const classList = reactionChoiceClass(value, true, "COUNTED")
        .split(/\s+/)
        .filter(Boolean);
      const computed = computeFor(classList, theme, ["background", "color"]);
      const background = computed.get("background");
      const color = computed.get("color");

      assert.ok(background, `${value}: the settled pill resolves no background`);
      assert.ok(color, `${value}: the settled pill resolves no text colour`);

      const expected = tokens.get(EXPECTED_FILL[REACTION_TONE[value]]);
      assert.equal(
        background,
        expected,
        `${value} (${theme}): the pill's background is ${background}, not the ` +
          `${EXPECTED_FILL[REACTION_TONE[value]]} fill ${expected} — the base ` +
          `control has taken the fill back`,
      );

      const ratio = contrast(color!, background!);
      assert.ok(
        ratio >= 4.5,
        `${value} (${theme}): the captured answer reads at ${ratio.toFixed(2)}:1 — ` +
          `a reader cannot see what they tapped`,
      );
    }
  });
}

test("no rule this model cannot see repaints the reaction control", () => {
  // The model reads flat class selectors only; fail if any other selector paints the control.
  for (const rule of RULES) {
    for (const selector of rule.selector.split(",")) {
      const trimmed = selector.trim();
      if (!trimmed.includes("reaction-choice")) continue;
      if (classesOf(trimmed)) continue;
      const decls = declarations(rule.body);
      for (const prop of ["background", "background-color", "color"]) {
        assert.ok(
          !decls.has(prop),
          `selector "${trimmed}" sets ${prop} on the reaction control and the ` +
            `cascade model in this test cannot see it — teach the model`,
        );
      }
    }
  }
});
