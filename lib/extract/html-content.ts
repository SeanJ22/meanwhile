/**
 * One readable-content extractor for every HTML source class: reduces a page
 * to the region a reader would call its content, without site navigation,
 * menus, footers or interstitials. Three mechanisms, weakest assumption last:
 *
 * 1. Landmarks and ARIA roles, where a publisher provides them.
 * 2. A named platform chrome vocabulary (`elementor-location-header`,
 *    `nav-menu`, `menu-item`, `site-footer`, ...), never complete.
 * 3. Link density: a block whose text is mostly its own links is a menu.
 *
 * The vocabulary matches the `class` attribute only, never the whole tag, and
 * never reaches `<body>` or `<html>` (a body can class itself as chrome).
 *
 * A form is a control and removed whole, except an ASP.NET WebForms server
 * form (it carries `__VIEWSTATE`) holding most of the page's text: that one is
 * unwrapped and only its controls are removed.
 *
 * It never invents a description: a page that says nothing extracts as "".
 */

/** Elements that never contain readable content. Removed whole. */
const NON_CONTENT = new Set([
  "script",
  "style",
  "noscript",
  "svg",
  "template",
  "iframe",
  "head",
  "select",
  "option",
  "form",
]);

/**
 * A form's own controls, removed even from a page-wrapping form that is kept.
 * `<input>` is void and is removed by its tag (see `inputTags`); `<select>`
 * and `<option>` are already `NON_CONTENT`.
 */
const FORM_CONTROLS = new Set(["button", "label", "textarea"]);

/**
 * A form is the page, not a control on it, when it holds MORE than this share
 * of the page's text (controls excluded on both sides). A WebForms wrapper
 * holds nearly all of it; a search box or sign-in panel holds a sliver.
 */
const PAGE_FORM_SHARE = 0.5;

/** Structural landmarks that ARE chrome by definition. */
const CHROME_TAGS = new Set(["nav", "header", "footer", "aside"]);

/**
 * Containers the class vocabulary is allowed to judge. Excludes `body` and
 * `html`, and `a`, `link` and `img`, whose attributes often mention menus.
 */
const VOCAB_TAGS = new Set([
  "div",
  "section",
  "ul",
  "ol",
  "nav",
  "header",
  "footer",
  "aside",
]);

/** Class tokens that name page furniture, matched as whole hyphen/underscore-delimited tokens in `class` only. */
const CHROME_CLASS =
  /(?:^|[\s_-])(?:site-header|site-footer|main-nav|nav-menu|navmenu|navbar|menu-item|sub-menu|submenu|breadcrumb|breadcrumbs|skip-link|screen-reader-text|social-icons|sidebar|location-header|location-footer|site-navigation|main-navigation|footer-widgets|cookie-banner|cookie-notice)(?:[\s_-]|$)/i;

/** Region hints, for pages with no `<main>`. */
const REGION_IDS =
  /(?:^|[\s_-])(?:content|main-content|primary|entry-content|site-content|page-content)(?:[\s_-]|$)/i;

/** HTML void elements. They never open a range. */
const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

const TAG_RE = /<(\/?)([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;

function attr(attrs: string, name: string): string | null {
  const m = attrs.match(
    new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i"),
  );
  return m ? (m[2] ?? m[3] ?? "") : null;
}

interface HtmlElement {
  name: string;
  attrs: string;
  /** Index of the element's `<` in the source. */
  start: number;
  /** Index one past its `</name>`, or its own `>` when it never closes. */
  end: number;
}

/**
 * Every element in the document, with balanced ranges.
 *
 * Unclosed tags are normal in real HTML (`<li>`, `<p>`), so a close tag pops
 * back to its nearest matching open and discards what was left dangling, the
 * same recovery a browser performs. An element that never closes ends at its
 * own open tag, which makes it a no-op for removal rather than a range that
 * would swallow the rest of the page.
 */
function elementsOf(html: string): HtmlElement[] {
  const out: HtmlElement[] = [];
  const open: HtmlElement[] = [];
  TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;

  while ((m = TAG_RE.exec(html))) {
    const [full, closing, rawName, attrs, selfClose] = m;
    const name = rawName.toLowerCase();

    if (VOID_TAGS.has(name) || selfClose === "/") continue;

    if (!closing) {
      open.push({ name, attrs, start: m.index, end: m.index + full.length });
      continue;
    }

    for (let i = open.length - 1; i >= 0; i--) {
      if (open[i].name === name) {
        const el = open[i];
        el.end = m.index + full.length;
        out.push(el);
        // Anything still open inside it never closed; keep those as no-ops.
        for (let j = i + 1; j < open.length; j++) out.push(open[j]);
        open.length = i;
        break;
      }
    }
  }
  out.push(...open);
  return out;
}

/** Blank out the given ranges, keeping a space so words never fuse. */
function cut(html: string, ranges: readonly (readonly [number, number])[]): string {
  if (ranges.length === 0) return html;
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of sorted) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  let out = "";
  let prev = 0;
  for (const [s, e] of merged) {
    out += html.slice(prev, s) + " ";
    prev = e;
  }
  return out + html.slice(prev);
}

/** Tags to text, for internal measurement only. */
function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Every `<input>` tag, by the same quote-aware tokenizer `elementsOf` uses, so
 * an attribute value can never end the tag early and leak into text.
 */
function inputTags(html: string): { range: [number, number]; attrs: string }[] {
  const out: { range: [number, number]; attrs: string }[] = [];
  TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG_RE.exec(html))) {
    if (!m[1] && m[2].toLowerCase() === "input") {
      out.push({ range: [m.index, m.index + m[0].length], attrs: m[3] });
    }
  }
  return out;
}

const within = (range: readonly [number, number], outer: HtmlElement): boolean =>
  outer.start <= range[0] && range[1] <= outer.end;

/** The text of `html[start, end)` with the given ranges cut, for measurement. */
function textLengthWithout(
  html: string,
  start: number,
  end: number,
  exclusions: readonly (readonly [number, number])[],
): number {
  const inside = exclusions
    .filter(([s, e]) => start <= s && e <= end)
    .map(([s, e]): [number, number] => [s - start, e - start]);
  return stripTags(cut(html.slice(start, end), inside)).length;
}

/**
 * Remove every form that is a control, and unwrap the one that is the page.
 * Runs after the other `NON_CONTENT` elements are gone, and measures share
 * with every form's controls excluded. Both conditions are needed: share
 * alone would keep bot challenges and captchas, whose words live inside their
 * own form; `__VIEWSTATE` marks the WebForms server form that wraps a page.
 */
function removeForms(doc: string): { doc: string; removed: number; pageForms: number } {
  const els = elementsOf(doc);
  const forms = els.filter((el) => el.name === "form");
  if (forms.length === 0) return { doc, removed: 0, pageForms: 0 };

  const inputs = inputTags(doc).filter(({ range }) => forms.some((form) => within(range, form)));
  const controls: [number, number][] = [
    ...els
      .filter((el) => FORM_CONTROLS.has(el.name))
      .map((el): [number, number] => [el.start, el.end])
      .filter((range) => forms.some((form) => within(range, form))),
    ...inputs.map(({ range }) => range),
  ];

  const serverForms = forms.filter(
    (form) =>
      !forms.some((other) => other !== form && within([form.start, form.end], other)) &&
      inputs.some(({ range, attrs }) => within(range, form) && attr(attrs, "name") === "__VIEWSTATE"),
  );
  // `<head>` is already gone, so the whole document's text is the page's.
  const pageText = serverForms.length > 0 ? textLengthWithout(doc, 0, doc.length, controls) : 0;
  const pageForms = new Set(
    serverForms.filter(
      (form) => pageText > 0 && textLengthWithout(doc, form.start, form.end, controls) / pageText > PAGE_FORM_SHARE,
    ),
  );
  const widgets = forms.filter((form) => !pageForms.has(form));
  return {
    // A kept form loses its controls; a widget goes whole, controls and all.
    doc: cut(doc, [...controls, ...widgets.map((form): [number, number] => [form.start, form.end])]),
    removed: widgets.length,
    pageForms: pageForms.size,
  };
}

export type ContentRegion =
  | "main"
  | "role-main"
  | "article"
  | "content-id"
  | "document";

export interface ReadableContent {
  /** The content region's HTML, chrome removed. Entities are NOT decoded. */
  html: string;
  /** How the content region was chosen, for the record. */
  region: ContentRegion;
  /** Chrome removed, by mechanism. Denominators, never a boolean. */
  removed: {
    nonContent: number;
    landmark: number;
    vocabulary: number;
    linkDense: number;
  };
  /** Page-wrapping forms whose content was kept, controls removed. */
  pageForms: number;
}

/**
 * A block is a menu when most of its own text is its own links' text. 0.65,
 * not 0.5: an agenda listing every item as a link can be half links. Short
 * blocks are exempt.
 */
const LINK_DENSITY_LIMIT = 0.65;
const LINK_DENSITY_MIN_CHARS = 120;

/**
 * Reduce an HTML document to the region a reader would call its content.
 * Never throws; a document it cannot make sense of degrades to the whole document.
 */
export function readableContent(html: string): ReadableContent {
  const removed = { nonContent: 0, landmark: 0, vocabulary: 0, linkDense: 0 };

  // ---- 1. elements that are never content -------------------------------
  let doc = html;
  let pageForms = 0;
  {
    const ranges: [number, number][] = [];
    for (const el of elementsOf(doc)) {
      // Forms are judged below, once nothing that is never content is left
      // inside them to inflate their share of the page.
      if (NON_CONTENT.has(el.name) && el.name !== "form") {
        ranges.push([el.start, el.end]);
        removed.nonContent++;
      }
    }
    doc = cut(doc, ranges);
    const forms = removeForms(doc);
    doc = forms.doc;
    removed.nonContent += forms.removed;
    pageForms = forms.pageForms;
  }

  // ---- 2. chrome: landmarks, roles, aria-hidden, then the vocabulary -----
  {
    const ranges: [number, number][] = [];
    for (const el of elementsOf(doc)) {
      const role = attr(el.attrs, "role");
      const landmark =
        CHROME_TAGS.has(el.name) ||
        (role !== null &&
          /^(navigation|banner|contentinfo|search|menu|menubar|complementary)$/i.test(
            role.trim(),
          )) ||
        /\saria-hidden\s*=\s*["']true["']/i.test(el.attrs);

      if (landmark) {
        ranges.push([el.start, el.end]);
        removed.landmark++;
        continue;
      }

      // Containers only, `class` attribute only. Both guards are load-bearing.
      if (!VOCAB_TAGS.has(el.name)) continue;
      const cls = attr(el.attrs, "class");
      if (cls && CHROME_CLASS.test(cls)) {
        ranges.push([el.start, el.end]);
        removed.vocabulary++;
      }
    }
    doc = cut(doc, ranges);
  }

  // ---- 3. the content region --------------------------------------------
  let region: ContentRegion = "document";
  {
    const els = elementsOf(doc);
    const pick = (
      test: (el: HtmlElement) => boolean,
      named: ContentRegion,
    ): boolean => {
      // The widest match wins: a page can nest `<article>` inside `<article>`.
      const hits = els
        .filter(test)
        .sort((a, b) => b.end - b.start - (a.end - a.start));
      const best = hits[0];
      if (!best) return false;
      const slice = doc.slice(best.start, best.end);
      // An empty region is not a region. Falling through to the next hint
      // beats handing a caller a confidently-chosen nothing.
      if (stripTags(slice).length === 0) return false;
      doc = slice;
      region = named;
      return true;
    };

    pick((e) => e.name === "main", "main") ||
      pick(
        (e) => (attr(e.attrs, "role") ?? "").trim().toLowerCase() === "main",
        "role-main",
      ) ||
      pick((e) => e.name === "article", "article") ||
      pick((e) => {
        const id = attr(e.attrs, "id");
        return id !== null && REGION_IDS.test(id);
      }, "content-id");
  }

  // ---- 4. link-dense blocks ---------------------------------------------
  {
    const candidates: [number, number][] = [];
    for (const el of elementsOf(doc)) {
      if (!VOCAB_TAGS.has(el.name) && el.name !== "li") continue;
      // Never the region root itself: cutting it would return "" as a false absence.
      if (el.start === 0 && el.end >= doc.length) continue;
      const block = doc.slice(el.start, el.end);
      const text = stripTags(block);
      if (text.length < LINK_DENSITY_MIN_CHARS) continue;
      let linkChars = 0;
      for (const a of block.matchAll(/<a[\s>][\s\S]*?<\/a>/gi)) {
        linkChars += stripTags(a[0]).length;
      }
      if (linkChars / text.length > LINK_DENSITY_LIMIT) {
        candidates.push([el.start, el.end]);
      }
    }

    /*
     * Innermost only: a menu makes every ancestor look link-dense too, so
     * cutting every match would remove the surrounding content with it.
     */
    const innermost = candidates.filter(
      ([s, e]) =>
        !candidates.some(([s2, e2]) => (s2 > s && e2 <= e) || (s2 >= s && e2 < e)),
    );
    removed.linkDense = innermost.length;
    doc = cut(doc, innermost);
  }

  return { html: doc, region, removed, pageForms };
}
