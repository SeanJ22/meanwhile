import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { resolveTheme, themeBootstrapScript, updatedReviewThemeUrl } from "../lib/state/theme.ts";

test("theme precedence honors explicit choices before system preference and light fallback", () => {
  for (const system of [true, false, undefined]) {
    assert.equal(resolveTheme("light", system), "light");
    assert.equal(resolveTheme("dark", system), "dark");
  }
  assert.equal(resolveTheme(null, true), "dark");
  assert.equal(resolveTheme(null, false), "light");
  assert.equal(resolveTheme("invalid", undefined), "light");
});

function paint(saved: string | null, dark: boolean | undefined, blockedStorage = false, search = "", staging = false) {
  const attributes = new Map<string, string>();
  const style = { colorScheme: "" };
  let stored = saved;
  vm.runInNewContext(themeBootstrapScript(staging), {
    document: { documentElement: { setAttribute: (key: string, value: string) => attributes.set(key, value), style } },
    localStorage: {
      getItem: () => { if (blockedStorage) throw new Error("disabled"); return stored; },
      setItem: (_key: string, value: string) => { if (blockedStorage) throw new Error("disabled"); stored = value; },
    },
    matchMedia: dark === undefined ? undefined : () => ({ matches: dark }),
    location: { search }, URLSearchParams,
  });
  return { theme: attributes.get("data-theme"), style: style.colorScheme, stored, choice: attributes.get("data-theme-choice") };
}

test("the synchronous first-paint script works for first-time light/dark systems and unavailable storage or media", () => {
  for (const blocked of [false, true]) for (const system of [true, false, undefined]) {
    const result = paint(null, system, blocked);
    assert.equal(result.theme, system ? "dark" : "light");
    assert.equal(result.style, result.theme);
  }
  assert.equal(paint("dark", false).theme, "dark");
  assert.equal(paint("light", true).theme, "light");
});

test("shared staging theme URLs are explicit choices that survive reload, while production ignores review overrides", () => {
  const choice = paint("dark", true, false, "?theme=light", true);
  assert.equal(choice.theme, "light");
  assert.equal(paint(choice.stored, true).theme, "light");
  assert.equal(paint("dark", true, false, "?theme=light", false).theme, "dark");
  const refused = paint(null, true, true, "?theme=light", true);
  assert.equal(refused.theme, "light");
  assert.equal(refused.choice, "light");
});

test("a toggle on a shared review link survives reload and preserves its popup and raised-state selection", () => {
  for (const before of ["light", "dark"] as const) {
    const next = before === "light" ? "dark" : "light";
    const href = `https://test.meanwhileusa.com/?zip=07866&popup=body&raisedState=B_MATERIAL_LIFT&theme=${before}#review`;
    const updated = new URL(updatedReviewThemeUrl(href, next, true)!);
    assert.equal(updated.searchParams.get("zip"), "07866");
    assert.equal(updated.searchParams.get("popup"), "body");
    assert.equal(updated.searchParams.get("raisedState"), "B_MATERIAL_LIFT");
    assert.equal(updated.hash, "#review");
    for (const blocked of [false, true]) assert.equal(paint(next, before === "dark", blocked, updated.search, true).theme, next);
    assert.equal(updatedReviewThemeUrl(updated.href, next, true), null, "no redundant history mutation");
    assert.equal(updatedReviewThemeUrl(href, next, false), null, "production URLs are untouched");
  }
  assert.equal(updatedReviewThemeUrl("https://test.meanwhileusa.com/?zip=85701", "dark", true), null);
});
