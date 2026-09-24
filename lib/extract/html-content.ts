/**
 * **ONE READABLE-CONTENT EXTRACTOR, FOR EVERY HTML SOURCE CLASS.**
 * (DATA-1, the 2026-08-28 reader-feedback sweep.)
 *
 * ## The defect this exists to end
 *
 * A reader opened a CAWCD meeting and the field headed "WHAT THIS MEETING IS
 * ABOUT" read:
 *
 * ```
 * CAP Board Meetings Skip to content Know Your Water News En Espanol
 * Facebook-f X-twitter Youtube Instagram Board Board Members Ylenia Aguilar ...
 * ```
 *
 * 9,007 characters of site navigation, the whole menu tree, the footer and
 * four copies of an external-link interstitial, presented as the substantive
 * description of a public meeting. It is navigation chrome wearing the clothes
 * of civic content, which is a false claim about a government in exactly the
 * way `CLAUDE.md` forbids.
 *
 * ## Why this is a CLASS and not a CAWCD row
 *
 * There were TWO naive extractors in this repository, written months apart,
 * neither aware of the other:
 *
 * - `extractHtmlText` in `lib/meetings/agenda-documents.ts` preferred the
 *   page's own `<main>` and fell back to THE ENTIRE DOCUMENT when there was
 *   none. That fallback is what produced the CAWCD text.
 * - `extractText` in `scripts/fetch-corpus.mts` had no region preference at
 *   all. It is why `data/corpus/statements.json` holds a candidate "statement"
 *   that opens `Juan Ciscomani for Congress DONATE DONATE 635ms 0vh 0 Skip to
 *   Content Meet Juan News Media Kit ...` and another that is the whole of a
 *   campaign site's menu. That corpus feeds candidate positions.
 *
 * Two copies of one job is how the two disagreed, and fixing the meeting one
 * alone would have left the candidate one to be re-found by a later session.
 * Both now call this module and there is one place where the rule lives.
 *
 * ## Why landmarks alone were not enough, measured rather than assumed
 *
 * The obvious repair is "prefer `<main>`, strip `<nav>`/`<header>`/`<footer>`".
 * Measured against the actual page on 2026-08-28, `www.cap-az.com` contains:
 *
 * ```
 * <main> 0   <nav> 0   <header> 0   <footer> 0   <aside> 0
 * role="main" 0        role="navigation" 0
 * ```
 *
 * Zero semantic landmarks. It is Elementor/WordPress div soup, which is what a
 * great many public bodies actually publish. A landmark-only repair would have
 * passed its own test and changed nothing for the reader who reported it.
 *
 * So there are three mechanisms, weakest assumption last:
 *
 * 1. LANDMARKS AND ARIA ROLES, free and exact where a publisher provides them.
 * 2. A NAMED PLATFORM CHROME VOCABULARY: `elementor-location-header`,
 *    `nav-menu`, `menu-item`, `site-footer` and friends. This is a PLATFORM
 *    TAXONOMY in the `CLAUDE.md` sense: it represents what the project knows
 *    now, is never complete, and grows as sources are met.
 * 3. LINK DENSITY, vendor-neutral and the reason this generalises. A block
 *    whose text is mostly the text of its own links is a menu, whatever it is
 *    called. Nothing about it is specific to CAP, to Elementor, or to meetings.
 *
 * ## Two guards learned by getting it wrong first
 *
 * The first draft of the vocabulary pass matched the attribute blob of every
 * element and cut the document to ZERO characters. Both causes are now guards
 * with tests behind them:
 *
 * - MATCH THE `class` ATTRIBUTE, NEVER THE WHOLE TAG. The blob carries hrefs,
 *   titles and stylesheet URLs: `<a title="Skip to content">` and a `<link>`
 *   in the head named `widget-nav-menu-css` both matched, and neither is a
 *   region of the page.
 * - NEVER LET THE VOCABULARY REACH `<body>` OR `<html>`. CAP's body carries
 *   `page-template-elementor_header_footer`, so the page classed itself as
 *   chrome and the extractor believed it.
 *
 * ## A form is a control, until it is the page (2026-09-23)
 *
 * `form` sits in `NON_CONTENT` because a search box, a sign-in panel or a
 * newsletter field is a control, not content. But an ASP.NET WebForms page
 * opens ONE `<form id="aspnetForm">` straight after `<body>` and closes it at
 * the end: the whole page is inside it. Diligent Community's meeting pages are
 * built that way, and removing the form whole left exactly what sat outside
 * it — "Skip Navigation Jump to SideBar Tucson Unified School District", 62
 * characters — stored 2,308 times across 18 sittings as though it were each
 * one's agenda.
 *
 * So the WebForms server form — the one carrying `__VIEWSTATE` — is unwrapped
 * instead of cut when it holds MOST of the page's text: its content goes on to
 * the landmark, vocabulary and region passes like any other markup, and its
 * controls are still removed — every `<input>` (the hidden ones carry
 * `__VIEWSTATE`, `__EVENTVALIDATION` and toolkit tokens, which must never
 * reach text), `<button>`, `<label>` and `<textarea>`. Share is measured with
 * those controls already gone, so field labels cannot make a form look like
 * the page. Every other form is still a control and still removed whole,
 * including one nested inside the page's form. `removeForms` records why the
 * rule needs both conditions. A page with no such form extracts exactly as it
 * did before.
 *
 * ## What this deliberately does NOT do
 *
 * It never invents a description. A page that genuinely says nothing extracts
 * as the empty string, and the caller records that as what it is. Removing
 * chrome is not permission to synthesise content in its place.
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
 * Containers the class vocabulary is allowed to judge.
 *
 * Deliberately excludes `body` and `html` (see the guard note above) and
 * excludes `a`, `link` and `img`, whose attributes routinely mention menus
 * without being one.
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

/**
 * Class tokens that name page furniture.
 *
 * Matched as whole hyphen/underscore-delimited tokens against the `class`
 * attribute only. `elementor-location-header` is Elementor's own name for the
 * header region and appears on every site built with it.
 */
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
 *
 * Runs after the other `NON_CONTENT` elements are gone, so scripts and styles
 * inside a form never count toward its share, and measures that share with
 * every form's controls excluded.
 *
 * **Two conditions, both measured against stored pages before they were
 * adopted (2026-09-23).** Share alone was tried first over the 1,569 HTML
 * bodies in the runtime evidence vault: 40 changed, and 36 of those were a
 * search engine's bot challenge and a parked domain's captcha — walls whose
 * words live inside their own form. Keeping those would turn a wall into
 * content. So the form must ALSO carry `__VIEWSTATE`, the hidden field ASP.NET
 * WebForms renders inside the one server form that wraps its page, and which a
 * challenge or a sign-in widget never has. With both, 4 of those 1,569 bodies
 * change — an IQM2 meeting page, a Legistar meeting-detail page, a candidate
 * profile and a state senate roster, each a WebForms page that had extracted
 * to nothing or to a skip link and now yields its own content — and so do the
 * nine WebForms calendar fixtures under `tests/fixtures`. No other page does.
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
  /**
   * Page-wrapping forms whose content was kept, controls removed. Zero on a
   * page with no such form, which is nearly every page.
   */
  pageForms: number;
}

/**
 * A block is a menu when most of its own text is its own links' text.
 *
 * 0.65 rather than 0.5: a genuine paragraph of civic prose can be half links
 * (an agenda listing every item as a document link is exactly that), and
 * losing one of those is a worse failure than keeping a menu. Short blocks are
 * exempt entirely: a two-link footer line is not worth the risk of cutting a
 * one-sentence notice.
 */
const LINK_DENSITY_LIMIT = 0.65;
const LINK_DENSITY_MIN_CHARS = 120;

/**
 * Reduce an HTML document to the region a reader would call its content.
 *
 * Never throws. A document it cannot make sense of degrades to the whole
 * document, which is what every caller did before this module existed.
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
      // Never the region root itself. A content region that happens to be
      // link-heavy is still the content region, and cutting it returns the
      // empty string — which reads to a caller as "this body published
      // nothing", the exact false absence this module exists to prevent.
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
     * INNERMOST ONLY.
     *
     * A menu makes every ancestor that contains it look link-dense too, so
     * cutting every match takes the article out with the navigation — a `<div
     * id="content">` holding one menu and one paragraph measured dense and
     * removed the paragraph. Dropping only blocks that contain no other
     * qualifying block cuts the menu and leaves what surrounds it.
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
