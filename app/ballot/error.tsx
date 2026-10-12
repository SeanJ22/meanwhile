"use client";
// @server-boundary-exempt Next.js injects { error, reset } into an error boundary; `reset` is a framework callback, never a prop a Server Component passes.

import Link from "next/link";
import { useEffect } from "react";

import { Logo } from "@/components/brand/logo";

export default function BallotError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Logged, never shown: the digest ties a reader's report to the server log
    // without putting an internal string on a reader surface.
    console.error("[ballot] render failed", error);
  }, [error]);

  return (
    <main className="mx-auto min-h-dvh max-w-2xl px-4 py-8 text-paper lg:max-w-[68rem] lg:px-8 lg:py-10 xl:max-w-[76rem]">
      <div className="mt-4">
        <Logo variant="wordmark" size={30} />
      </div>
      <h1 className="mt-1.5 text-xl font-semibold tracking-tight">
        This page didn&apos;t load.
      </h1>
      <p className="mt-3 text-[0.8125rem] leading-relaxed text-voice lg:max-w-2xl">
        Reload to try again, or go back to the map.
      </p>
      <div className="mt-8 flex items-center gap-4">
        <button
          type="button"
          onClick={() => reset()}
          className="cursor-pointer rounded-md border border-[var(--panel-border)] px-3 py-1.5 text-[0.8125rem] font-medium text-paper transition-colors hover:border-paper"
        >
          Reload
        </button>
        <Link
          href="/"
          className="text-[0.8125rem] text-link underline decoration-dotted underline-offset-2 hover:decoration-solid"
        >
          Back to the map
        </Link>
      </div>
    </main>
  );
}
