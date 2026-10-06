/**
 * **PAGE MEASUREMENTS ANYONE CAN RUN.** (FE-16.)
 *
 * Seven things a reader feels on a phone and no unit test sees: the page
 * jumping as it loads, sideways scroll, words cut off, buttons too small for a
 * thumb, type and spacing nobody named, and text too faint to read.
 *
 * Same division as `dom-evaluation.ts`: the browser is asked ONE question
 * ({@link collectPageObservation}, run inside the page) and every verdict is a
 * pure function of the value it returns. A failing issue can be reproduced
 * from the recorded observation alone, and nothing here touches a browser,
 * the network or a database.
 *
 * Usage from any harness holding a Playwright page:
 *
 * ```ts
 * const obs = await page.evaluate(collectPageObservation);
 * const report = measurePage(obs);   // report.issues lists each one with its element
 * ```
 *
 * A measurement that could not be taken (a background painted by an image, no
 * layout-shift entries because the browser does not report them) is listed
 * under `notMeasured` with the reason. It is never counted as a pass.
 */

import { SPACE_PX } from "../design/rhythm.ts";

/** Type scale in CSS px: display, title, heading, body, detail, caption. */
export const TYPE_SCALE_PX = [24, 18, 15, 14, 12, 11] as const;

/** Minimum tap target, CSS px. Compact controls are allowed 40. */
export const TAP_MIN_PX = 44;
export const TAP_MIN_COMPACT_PX = 40;

/** Cumulative layout shift above this is "poor" by the web-vitals bar. */
export const LAYOUT_SHIFT_BAR = 0.1;

/** WCAG AA for body text, and its large-text bar. */
export const CONTRAST_BAR = 4.5;
export const CONTRAST_BAR_LARGE = 3;

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface ObservedElement {
  /** A selector a person can paste into the console to find it. */
  selector: string;
  /** First words of its own text, for the report. Empty when it has none. */
  text: string;
  rect: { x: number; y: number; width: number; height: number };
  /** Interactive (link, button, input, role=button …). */
  interactive: boolean;
  /** Carries the compact-control class or attribute: 40px floor, not 44. */
  compact: boolean;
  /** Has text of its own (not only descendants'). */
  hasOwnText: boolean;
  fontSizePx: number;
  fontWeight: number;
  /** Computed padding/gap values, px, non-zero only. */
  spacingPx: { property: string; value: number }[];
  scrollWidth: number;
  clientWidth: number;
  scrollHeight: number;
  clientHeight: number;
  overflowX: string;
  overflowY: string;
  textOverflow: string;
  /** Computed foreground colour, alpha already applied to its backdrop. */
  color: Rgb | null;
  /** Backdrop composited from ancestors; null when an image/gradient paints it. */
  background: Rgb | null;
}

export interface PageObservation {
  url: string;
  viewport: { width: number; height: number };
  /** `document.documentElement.scrollWidth`. */
  documentScrollWidth: number;
  /** Layout-shift entries, or null when the browser reports none to read. */
  layoutShifts: { value: number; hadRecentInput: boolean }[] | null;
  elements: ObservedElement[];
  /** Visible card citations outside their Sources disclosure (FE-22). */
  sourceLeaks?: { selector: string; text: string; reason: string }[];
}

export type PageIssueKind =
  | "layout-shift"
  | "horizontal-overflow"
  | "cut-off-text"
  | "small-tap-target"
  | "off-scale-font-size"
  | "off-scale-spacing"
  | "low-contrast"
  | "source-outside-sources";

export interface PageIssue {
  kind: PageIssueKind;
  /** The element, as a selector. `"page"` for whole-page issues. */
  element: string;
  text: string;
  /** One plain sentence: what is wrong and by how much. */
  detail: string;
}

export interface PageReport {
  url: string;
  viewport: { width: number; height: number };
  issues: PageIssue[];
  /** Measurements that could not be taken, with the reason. Not passes. */
  notMeasured: { kind: PageIssueKind; reason: string }[];
}

const round = (n: number, places = 1): number => {
  const f = 10 ** places;
  return Math.round(n * f) / f;
};

// --- layout shift --------------------------------------------------------

/** Sum of layout shifts not caused by the reader's own input. */
export function layoutShiftScore(obs: PageObservation): number | null {
  if (!obs.layoutShifts) return null;
  return obs.layoutShifts.filter((s) => !s.hadRecentInput).reduce((sum, s) => sum + s.value, 0);
}

export function measureLayoutShift(obs: PageObservation, bar = LAYOUT_SHIFT_BAR): PageIssue[] {
  const score = layoutShiftScore(obs);
  if (score === null || score <= bar) return [];
  return [
    {
      kind: "layout-shift",
      element: "page",
      text: "",
      detail: `The page shifted by ${round(score, 3)} while loading (the bar is ${bar}).`,
    },
  ];
}

// --- horizontal overflow -------------------------------------------------

/** The page scrolls sideways, or an element sticks out past the viewport edge. */
export function measureHorizontalOverflow(obs: PageObservation): PageIssue[] {
  const out: PageIssue[] = [];
  const vw = obs.viewport.width;
  if (obs.documentScrollWidth > vw + 1) {
    out.push({
      kind: "horizontal-overflow",
      element: "page",
      text: "",
      detail: `The page is ${obs.documentScrollWidth}px wide in a ${vw}px window, so it scrolls sideways.`,
    });
  }
  for (const el of obs.elements) {
    const right = el.rect.x + el.rect.width;
    if (el.rect.width > 0 && (right > vw + 1 || el.rect.x < -1) && el.overflowX !== "scroll" && el.overflowX !== "auto") {
      out.push({
        kind: "horizontal-overflow",
        element: el.selector,
        text: el.text,
        detail: `Sticks out of the window: spans ${round(el.rect.x)}px to ${round(right)}px in a ${vw}px window.`,
      });
    }
  }
  return out;
}

// --- cut-off text --------------------------------------------------------

/**
 * Text whose box is smaller than its content and is hidden or ellipsised.
 * A scroller (`overflow: auto|scroll`) is not cut off; it is meant to scroll.
 */
export function measureCutOffText(obs: PageObservation): PageIssue[] {
  const out: PageIssue[] = [];
  for (const el of obs.elements) {
    if (!el.hasOwnText || el.rect.width === 0) continue;
    const hidesX = el.overflowX === "hidden" || el.overflowX === "clip" || el.textOverflow === "ellipsis";
    const hidesY = el.overflowY === "hidden" || el.overflowY === "clip";
    const cutX = hidesX && el.scrollWidth > el.clientWidth + 1;
    const cutY = hidesY && el.scrollHeight > el.clientHeight + 1;
    if (!cutX && !cutY) continue;
    const parts: string[] = [];
    if (cutX) parts.push(`${el.scrollWidth - el.clientWidth}px too wide`);
    if (cutY) parts.push(`${el.scrollHeight - el.clientHeight}px too tall`);
    out.push({
      kind: "cut-off-text",
      element: el.selector,
      text: el.text,
      detail: `Text is cut off: ${parts.join(" and ")} for its box.`,
    });
  }
  return out;
}

// --- tap targets ---------------------------------------------------------

export function measureTapTargets(obs: PageObservation): PageIssue[] {
  const out: PageIssue[] = [];
  for (const el of obs.elements) {
    if (!el.interactive || el.rect.width === 0 || el.rect.height === 0) continue;
    const min = el.compact ? TAP_MIN_COMPACT_PX : TAP_MIN_PX;
    if (el.rect.width + 0.5 >= min && el.rect.height + 0.5 >= min) continue;
    out.push({
      kind: "small-tap-target",
      element: el.selector,
      text: el.text,
      detail: `${round(el.rect.width)} × ${round(el.rect.height)}px; a thumb needs at least ${min} × ${min}px.`,
    });
  }
  return out;
}

// --- type and spacing off the token scales -------------------------------

export function measureFontSizes(obs: PageObservation): PageIssue[] {
  const scale = new Set<number>(TYPE_SCALE_PX);
  const out: PageIssue[] = [];
  for (const el of obs.elements) {
    if (!el.hasOwnText || el.rect.width === 0) continue;
    if (scale.has(round(el.fontSizePx, 2))) continue;
    out.push({
      kind: "off-scale-font-size",
      element: el.selector,
      text: el.text,
      detail: `Type is ${round(el.fontSizePx, 2)}px; the scale is ${TYPE_SCALE_PX.join(", ")}.`,
    });
  }
  return out;
}

export function measureSpacing(obs: PageObservation): PageIssue[] {
  const scale = new Set<number>(SPACE_PX);
  const out: PageIssue[] = [];
  for (const el of obs.elements) {
    if (el.rect.width === 0) continue;
    const off = el.spacingPx.filter((s) => s.value !== 0 && !scale.has(round(s.value, 2)));
    if (!off.length) continue;
    out.push({
      kind: "off-scale-spacing",
      element: el.selector,
      text: el.text,
      detail: `${off.map((s) => `${s.property} ${round(s.value, 2)}px`).join(", ")}; the scale is ${SPACE_PX.join(", ")}.`,
    });
  }
  return out;
}

// --- contrast ------------------------------------------------------------

function channelToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(c: Rgb): number {
  return 0.2126 * channelToLinear(c.r) + 0.7152 * channelToLinear(c.g) + 0.0722 * channelToLinear(c.b);
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Large text: 24px, or 18.66px and bold. */
export function isLargeText(fontSizePx: number, fontWeight: number): boolean {
  return fontSizePx >= 24 || (fontSizePx >= 18.66 && fontWeight >= 700);
}

export function measureContrast(obs: PageObservation, bar = CONTRAST_BAR, largeBar = CONTRAST_BAR_LARGE): {
  issues: PageIssue[];
  unmeasured: number;
} {
  const issues: PageIssue[] = [];
  let unmeasured = 0;
  for (const el of obs.elements) {
    if (!el.hasOwnText || el.rect.width === 0) continue;
    if (!el.color || !el.background) {
      unmeasured++;
      continue;
    }
    const ratio = contrastRatio(el.color, el.background);
    const need = isLargeText(el.fontSizePx, el.fontWeight) ? largeBar : bar;
    if (ratio + 0.005 >= need) continue;
    issues.push({
      kind: "low-contrast",
      element: el.selector,
      text: el.text,
      detail: `Contrast is ${round(ratio, 2)}:1; it needs ${need}:1.`,
    });
  }
  return { issues, unmeasured };
}

// --- the whole report ----------------------------------------------------

export function measurePage(obs: PageObservation): PageReport {
  const notMeasured: PageReport["notMeasured"] = [];
  if (obs.layoutShifts === null) {
    notMeasured.push({ kind: "layout-shift", reason: "No layout-shift recorder was running while the page loaded." });
  }
  const contrast = measureContrast(obs);
  if (contrast.unmeasured > 0) {
    notMeasured.push({
      kind: "low-contrast",
      reason: `${contrast.unmeasured} text element(s) sit on an image or gradient, so their contrast was not measured.`,
    });
  }
  return {
    url: obs.url,
    viewport: obs.viewport,
    issues: [
      ...measureLayoutShift(obs),
      ...measureHorizontalOverflow(obs),
      ...measureCutOffText(obs),
      ...measureTapTargets(obs),
      ...measureFontSizes(obs),
      ...measureSpacing(obs),
      ...contrast.issues,
      ...(obs.sourceLeaks ?? []).map(leak => ({ kind: "source-outside-sources" as const, element: leak.selector, text: leak.text, detail: leak.reason })),
    ],
    notMeasured,
  };
}

// --- the one question asked inside the page ------------------------------

/**
 * Install before navigation (`page.addInitScript(LAYOUT_SHIFT_INIT_SCRIPT)`) so
 * layout shifts during load are recorded. Without it the shift measurement is
 * reported as not measured.
 */
export const LAYOUT_SHIFT_INIT_SCRIPT = `(() => {
  window.__wtpLayoutShifts = [];
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__wtpLayoutShifts.push({ value: e.value, hadRecentInput: e.hadRecentInput });
    }).observe({ type: "layout-shift", buffered: true });
  } catch {}
})();`;

/**
 * Runs INSIDE the browser (`page.evaluate(collectPageObservation)`). It must
 * stay self-contained: no imports, no closure over module values, because the
 * function is serialised and sent to the page.
 *
 *  */
export function collectPageObservation(): PageObservation {
  const MAX_ELEMENTS = 4000;

  const parse = (value: string): { r: number; g: number; b: number; a: number } | null => {
    const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)$/.exec(value.trim());
    if (!m) return null;
    let a = 1;
    if (m[4] !== undefined) a = m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a };
  };

  const over = (top: { r: number; g: number; b: number; a: number }, under: { r: number; g: number; b: number }) => ({
    r: top.r * top.a + under.r * (1 - top.a),
    g: top.g * top.a + under.g * (1 - top.a),
    b: top.b * top.a + under.b * (1 - top.a),
  });

  /** Walk up compositing backgrounds; null when an image paints one. */
  const backdrop = (el: Element): { r: number; g: number; b: number } | null => {
    const layers: { r: number; g: number; b: number; a: number }[] = [];
    let node: Element | null = el;
    while (node) {
      const cs = getComputedStyle(node);
      if (cs.backgroundImage && cs.backgroundImage !== "none") return null;
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0) {
        layers.push(c);
        if (c.a >= 1) break;
      }
      node = node.parentElement;
    }
    let base = { r: 255, g: 255, b: 255 };
    for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i], base);
    return base;
  };

  const selectorOf = (el: Element): string => {
    if (el.id) return `#${CSS.escape(el.id)}`;
    const parts: string[] = [];
    let node: Element | null = el;
    while (node && node.nodeType === 1 && parts.length < 4) {
      let part = node.tagName.toLowerCase();
      const testId = node.getAttribute("data-testid");
      if (testId) {
        parts.unshift(`${part}[data-testid="${testId}"]`);
        break;
      }
      const cls = (node.getAttribute("class") || "").split(/\s+/).filter(Boolean).slice(0, 2);
      if (cls.length) part += "." + cls.map((c) => CSS.escape(c)).join(".");
      const parent: Element | null = node.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter((c) => c.tagName === node!.tagName);
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      node = parent;
    }
    return parts.join(" > ");
  };

  const INTERACTIVE = 'a[href], button, input, select, textarea, summary, [role="button"], [role="link"], [role="tab"], [tabindex]:not([tabindex="-1"])';
  const SPACING_PROPS = [
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "rowGap",
    "columnGap",
  ] as const;

  const sourceLeaks: NonNullable<PageObservation["sourceLeaks"]> = [];
  // Do not confuse the meeting's date or a reporting period with a read stamp.
  const readStamp = /\b(?:read|checked|retrieved|collected)(?:\s+on)?\s+(?:\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4}|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?\b)/i;
  const hostname = /(?<![@\w.-])\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:gov|com|org|net|edu|us|io)\b/i;
  const sourceHosts = new WeakMap<Element, string[]>();
  const cards = '.reader-card, [data-card-id], .candidate-row, .account-modal, .popup-card, [data-official-filing], [data-contest-id], [data-meeting-card], [data-ask-panel], [data-ballot-ask]';
  const elements: ObservedElement[] = [];
  const all = document.body ? Array.from(document.body.querySelectorAll("*")) : [];
  for (const el of all) {
    if (elements.length >= MAX_ELEMENTS) break;
    const rect = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") continue;
    if (["SCRIPT", "STYLE", "NOSCRIPT", "SVG", "PATH"].includes(el.tagName.toUpperCase())) continue;

    const ownText = Array.from(el.childNodes)
      .filter((n) => n.nodeType === 3)
      .map((n) => (n.textContent || "").replace(/\s+/g, " ").trim())
      .join(" ")
      .trim();
    const inSources = el.closest('[data-card-sources]');
    if (ownText && rect.width > 0 && rect.height > 0 && el.closest(cards) && !inSources) {
      const card = el.closest(cards)!;
      let hosts = sourceHosts.get(card);
      if (!hosts) {
        hosts = Array.from(card.querySelectorAll('[data-card-sources] a[href]')).flatMap(link => { try { return [new URL(link.getAttribute('href')!, location.href).host.toLowerCase()]; } catch { return []; } });
        sourceHosts.set(card, hosts);
      }
      const sourceText = el.matches("p, a, span, dt, dd") ? (el.textContent ?? ownText) : ownText;
      const reason = readStamp.test(sourceText) ? "A source read date is visible outside Sources." : hostname.test(sourceText) || hosts.some(host => new RegExp(`(?<![@\\w.-])${host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w.-])`, "i").test(sourceText)) ? "A source hostname is visible outside Sources." : null;
      if (reason) sourceLeaks.push({ selector: selectorOf(el), text: sourceText.trim(), reason });
    }
    const interactive = el.matches(INTERACTIVE);
    const spacing: { property: string; value: number }[] = [];
    for (const p of SPACING_PROPS) {
      const v = parseFloat(cs[p]);
      if (Number.isFinite(v) && v > 0) spacing.push({ property: p.replace(/([A-Z])/g, "-$1").toLowerCase(), value: v });
    }
    if (!interactive && !ownText && !spacing.length && el.scrollWidth <= el.clientWidth) continue;

    const fg = parse(cs.color);
    const bg = backdrop(el);
    elements.push({
      selector: selectorOf(el),
      text: ownText.slice(0, 60),
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      interactive,
      compact: el.matches('[data-compact], .compact, [class*="compact"]'),
      hasOwnText: ownText.length > 0,
      fontSizePx: parseFloat(cs.fontSize),
      fontWeight: Number(cs.fontWeight) || 400,
      spacingPx: spacing,
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      overflowX: cs.overflowX,
      overflowY: cs.overflowY,
      textOverflow: cs.textOverflow,
      color: fg && bg ? over(fg, bg) : null,
      background: bg,
    });
  }

  // Layout shifts are only readable from an observer that was running while
  // the page loaded; see LAYOUT_SHIFT_INIT_SCRIPT. Absent means not measured.
  const recorded = (window as unknown as { __wtpLayoutShifts?: { value: number; hadRecentInput: boolean }[] })
    .__wtpLayoutShifts;
  const shifts = Array.isArray(recorded) ? recorded.map((e) => ({ value: e.value, hadRecentInput: e.hadRecentInput })) : null;

  return {
    url: location.href,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    documentScrollWidth: document.documentElement.scrollWidth,
    layoutShifts: shifts,
    elements,
    sourceLeaks,
  };
}
