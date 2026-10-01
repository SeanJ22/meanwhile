import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { titleFor } from "@/lib/brand";

/**
 * "What this site collects" — the ONE place the site says what it collects
 * (Sean, October 1, 2026). Every other notice (the Ask box, the reaction
 * capture note, the ballot-pick lines) was removed so a reader finds one
 * statement, and it is this one. If what the site collects changes, this
 * paragraph changes in the same release; nothing else on the site makes a
 * collection claim.
 */

export const metadata = {
  title: titleFor("What this site collects"),
};

export default function TransparencyPage() {
  return (
    <main className="mw-page min-h-dvh overflow-y-auto bg-[var(--bg)]">
      <div className="mx-auto max-w-2xl px-5 py-10 sm:py-14">
        <div>
          <Logo variant="wordmark" size={30} />
        </div>
        <h1 className="mt-2 text-xl font-semibold text-paper">What this site collects</h1>

        <p className="mt-4 text-[0.9375rem] leading-relaxed text-paper-dim">
          We collect how people use this site: what they look at, search, type and react to.
          It&apos;s anonymized. We never store or share anything that identifies you personally.
          What people tell us may be shared in summarized or anonymous form.
        </p>

        <p className="mt-10 text-[0.8125rem]">
          <Link href="/" className="mw-back-pill">
            ← Back to the map
          </Link>
        </p>
      </div>
    </main>
  );
}
