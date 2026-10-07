import Link from "next/link";

import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme-toggle";

/** No skeleton of the contests: a shape drawn before the ballot is known is a claim about it. */
/** The page's own container, breakpoint for breakpoint, so the heading does not shift when the ballot arrives. */
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
      <div className="mt-4">
        {/* Mirrors the ballot page's logo-first hierarchy so nothing shifts on hydration. */}
        <Logo variant="wordmark" size={30} />
      </div>
      <h1 className="mt-1.5 text-xl font-semibold tracking-tight">
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
