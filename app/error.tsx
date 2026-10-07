"use client";
// @server-boundary-exempt Next.js injects { error, reset } into an error boundary; `reset` is a framework callback, never a prop a Server Component passes.

import Link from "next/link";
import { useEffect } from "react";

import { Logo } from "@/components/brand/logo";

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app] render failed", error);
  }, [error]);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-4 text-center text-paper">
      <Logo variant="wordmark" size={30} />
      <div>
        <h1 className="text-xl font-semibold tracking-tight">This page didn&apos;t load.</h1>
        <p className="mt-3 text-[0.8125rem] leading-relaxed text-voice">
          Reload to try again, or go back to the map.
        </p>
      </div>
      <div className="flex items-center gap-4">
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
