"use client";

/**
 * **A FRAGMENT TARGET THAT ACTUALLY ARRIVES.** (9.6.26 owner feedback, ACLOSE-6.)
 *
 * The owner clicked **Open** on *"What is blocked?"* — `77 decisions and 27
 * stuck sources` — and nothing happened. Three separate defects stacked, and
 * fixing any two of them would still have left a control that looks actionable
 * and is not:
 *
 *   1. **The target did not exist.** The card's `where` was `#decisions`, and no
 *      element in the whole application carried that id. A fragment with no
 *      indicated part is not an error in any browser — it is a no-op, which is
 *      exactly why this survived review. (`#receipts` was dead the same way.)
 *   2. **The header would have covered it.** `.console-nav` is
 *      `position: sticky; top: 0`, and the repository had no `scroll-margin-top`
 *      anywhere, so even a live anchor lands underneath the navigation.
 *   3. **What he came to read was collapsed.** The decision queue opens closed
 *      by deliberate design (ADM-31), and each stuck-source group is a closed
 *      `<details>`. Arriving at a correct anchor would still have shown him a
 *      count and two shut disclosures.
 *
 * So this component owns all three. It is the destination, it takes focus, and
 * it opens what is inside it when it is the part being indicated.
 *
 * ## Why the link stays a plain `<a href="#...">`
 *
 * Because the router owns history. Same-document fragment navigation is the
 * browser's own, needs no `pushState`, keeps the back button meaningful, and is
 * keyboard-activatable for free — an `onClick` on a `<span>` would have been
 * three regressions traded for no gain. This component listens rather than
 * intercepts: it reacts to the hash the browser already set.
 *
 * ## Why `<details>` are opened through the DOM
 *
 * The disclosures inside this region belong to several components, one of which
 * is a server component with no state to lift. Opening them by setting `open`
 * on the elements actually present is the one mechanism that reaches all of
 * them without turning three sections into client components. A component that
 * owns its own open state — the decision queue — watches the hash itself
 * instead; this never fights it.
 */
import { useEffect, useRef, type ReactNode } from "react";

/** The hash, without its `#`, or the empty string. Safe before hydration. */
export function currentFragment(): string {
  if (typeof window === "undefined") return "";
  const raw = window.location.hash;
  return raw.startsWith("#") ? decodeURIComponent(raw.slice(1)) : "";
}

/**
 * Does the current fragment address this region — either the region itself, or
 * one of the extra ids it stands in for?
 *
 * `also` exists so a region can answer to the names other surfaces already use
 * for it. It is a list of exact strings, never a prefix match: a region that
 * claimed every id starting with its own would silently capture anchors that
 * belong to something else.
 */
export function addresses(id: string, also: readonly string[], fragment: string): boolean {
  return fragment === id || also.includes(fragment);
}

export function RevealTarget(props: {
  readonly id: string;
  /** Other fragment names that should land here. Exact matches only. */
  readonly also?: readonly string[];
  readonly children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const also = props.also ?? [];
  const id = props.id;

  useEffect(() => {
    const reveal = (): void => {
      if (!addresses(id, also, currentFragment())) return;
      const el = ref.current;
      if (el === null) return;
      // Open every disclosure inside, so what he came to read is readable
      // rather than counted. Setting `open` fires no event and loses no state.
      for (const disclosure of Array.from(el.querySelectorAll("details"))) disclosure.open = true;
      // `scroll-margin-top` on `.reveal-target` keeps this clear of the sticky
      // header; without it `start` puts the heading underneath the navigation.
      el.scrollIntoView({ block: "start", behavior: "auto" });
      // Focus, so the next Tab continues from here and a screen reader is
      // moved too. `tabIndex={-1}` makes this focusable without adding a stop.
      el.focus({ preventScroll: true });
    };
    reveal();
    window.addEventListener("hashchange", reveal);
    return () => window.removeEventListener("hashchange", reveal);
    // `also` is a literal at every call site; listing it would re-subscribe on
    // every render for no behavioural difference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  return (
    <div id={id} ref={ref} tabIndex={-1} className="reveal-target">
      {props.children}
    </div>
  );
}
