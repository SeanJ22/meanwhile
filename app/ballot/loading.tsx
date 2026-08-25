import { PRODUCT_NAME } from "@/lib/brand";

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
export default function BallotLoading() {
  return (
    <main className="mx-auto min-h-dvh max-w-3xl px-5 py-10 sm:py-14">
      <p className="t-eyebrow mt-4 text-muted">{PRODUCT_NAME}</p>
      <h1 className="mt-1.5 text-2xl font-semibold tracking-tight">
        Finding what&apos;s on the ballot…
      </h1>
      <p className="mt-3 text-[0.8125rem] leading-relaxed text-voice">
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
