import Link from "next/link";

import { PRODUCT_NAME } from "@/lib/brand";
import { ThemeToggle } from "@/components/theme-toggle";

/**
 * **BAL-10 (2026-08-25) — THE BALLOT PAGE SAYS IT IS WORKING.**
 *
 * The author: the ballot takes a while to load. It resolves a zip to a
 * centroid, that centroid to its divisions, the divisions to contests, and the
 * contests to candidates, cards, links and reaction targets — and until all of
 * it lands the reader sees the page they came FROM. A navigation that appears
 * to do nothing is the click-that-does-nothing defect, and the reader-friction
 * rule counts it with the same standing as a wrong number.
 *
 * **This is Next's own route-level loading boundary**, which is why it is a
 * file and not a spinner somebody has to remember to render: the framework
 * shows it the moment the navigation starts and swaps it for the page when the
 * server is done. There is no state to manage and no path that can forget it.
 *
 * ## It says what is happening, not just that something is
 *
 * A bare spinner tells a reader to wait without telling them what for. This
 * names the work — the ballot for their zip — which is the difference between
 * waiting and being kept informed, and it costs nothing.
 *
 * ## No skeleton of the contests, deliberately
 *
 * A grey outline of contest cards would draw a shape the answer may not take:
 * this zip may hold nine contests or ninety, and a skeleton showing three is a
 * claim about the ballot made before the ballot is known. The render-default
 * rule forbids a default that manufactures a claim, and a skeleton is a
 * default with a shape.
 */
/**
 * **BAL-25 (2026-08-28) — THE SKELETON MOVED THE HEADING TWICE ON HYDRATION.**
 *
 * This element read `max-w-3xl px-5 py-10 sm:py-14` while the page it hands
 * over to read `max-w-2xl px-4 py-8`. So the heading a reader was looking at
 * jumped 96px narrower, 4px left, AND up by the difference between `py-10`/
 * `sm:py-14` and `py-8` at the exact moment the ballot arrived — a layout
 * shift on the one screen whose whole purpose is to say "this is working".
 *
 * It is the page's container now, breakpoint for breakpoint, and the back-link
 * row above the eyebrow is the page's own row rather than a spacer guessing at
 * its height: `ThemeToggle` is the same component, reading and writing the
 * same `wtp.theme`, so the toggle is also live while the ballot loads instead
 * of appearing when it lands.
 */
export default function BallotLoading() {
  return (
    <main className="mx-auto min-h-dvh max-w-2xl px-4 py-8 text-paper lg:max-w-[68rem] lg:px-8 lg:py-10 xl:max-w-[76rem]">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[0.8125rem]">
          <Link
            href="/"
            className="text-link underline decoration-dotted underline-offset-2 hover:decoration-solid"
          >
            ← Back to the map
          </Link>
        </p>
        <ThemeToggle className="shrink-0" />
      </div>
      <p className="t-eyebrow mt-4 text-muted">{PRODUCT_NAME}</p>
      <h1 className="mt-1.5 text-2xl font-semibold tracking-tight">
        Finding what&apos;s on the ballot…
      </h1>
      <p className="mt-3 text-[0.8125rem] leading-relaxed text-voice lg:max-w-2xl">
        Working out which districts cover that zip, and which contests each one
        puts on a ballot. This takes a moment.
      </p>
      <div className="mt-8 flex items-center gap-3" role="status" aria-live="polite">
        <span className="ballot-loading-dot" aria-hidden="true" />
        <span className="text-[0.8125rem] text-muted">Loading the ballot</span>
      </div>
    </main>
  );
}
