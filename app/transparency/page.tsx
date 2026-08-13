import Link from "next/link";

/**
 * The transparency page — item 5b, shipped in the same change as the search
 * log it discloses. Scoped honestly to what this is today: an unlisted demo
 * shown to a handful of people. It gets rewritten before any public launch,
 * and that is expected.
 *
 * Every sentence here is checkable against the code: the search-log schema
 * (lib/db/schema.ts), the write path (lib/db/search-log.ts), and the guard
 * tests that make the claims structural rather than aspirational.
 */

export const metadata = {
  title: "What this site collects — We the People",
};

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8">
      <h2 className="font-mono text-[0.6875rem] uppercase tracking-[0.2em] text-signal">
        {title}
      </h2>
      <div className="mt-2.5 space-y-3 text-[0.9375rem] leading-relaxed text-paper-dim">
        {children}
      </div>
    </section>
  );
}

export default function TransparencyPage() {
  return (
    <main className="min-h-dvh overflow-y-auto bg-[var(--bg,#101014)]">
      <div className="mx-auto max-w-2xl px-5 py-10 sm:py-14">
        <p className="font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted">
          We the People
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-paper">
          What this site collects, and what it doesn&apos;t
        </h1>

        <p className="mt-4 text-[0.9375rem] leading-relaxed text-paper-dim">
          This is an unlisted demo, shared with a handful of people by the
          person who built it. This page describes exactly what it records
          today. It is short because the demo is small; it will be rewritten —
          and dated — before this product is offered to the public.
        </p>

        <Section title="What is collected">
          <p>
            When you search a zip code or tap around the map, the site logs
            the event: the zip you entered, which districts and government
            bodies the answer involved, which meeting or body you opened,
            which filters you used, and when. That&apos;s the whole row.
          </p>
          <p>
            The zip is stored as an approximate location — it orients the
            map, and it is never treated as your address or used to work out
            your ballot.
          </p>
        </Section>

        <Section title="What is not collected">
          <p>
            There are no accounts here, and the log has no identity in it: no
            name, no email, no phone number, no device identifier, no
            fingerprint, no IP address kept, no cookie that tracks you, and
            no ID that links one of your visits to another. The database
            table these events land in has no column that could hold any of
            that — and an automated test fails the build if one is ever
            added.
          </p>
          <p>
            Your zip and display preferences are kept in your own
            browser&apos;s storage so the map remembers where you were. They
            stay on your device; only the zip itself is sent when the site
            fetches the meetings near it.
          </p>
        </Section>

        <Section title="What happens to the data">
          <p>
            The plan for this product is to aggregate what people look up —
            never who looked it up — and sell those aggregates to political
            organizations: counts like &quot;how many searches touched this
            district this week.&quot; That is how the product would stay free
            to use. No aggregate of this demo&apos;s data has been sold to
            anyone; if that changes, this page changes first.
          </p>
          <p>
            Because the log has no identity in it, there is nothing anyone —
            including us — could use to trace a row back to you. That
            property is the deal, and it is enforced in the schema, not just
            promised here.
          </p>
        </Section>

        <Section title="What this site will never do">
          <p>
            It never tells you how to vote. It never ranks candidates, never
            scores how well anyone &quot;matches&quot; you, and never orders
            candidates by anything except neutral order like the ballot&apos;s
            own. Positions shown are always sourced to a specific statement,
            vote, or filing — where no source exists, it says so instead of
            guessing.
          </p>
        </Section>

        <Section title="Questions">
          <p>
            Write to{" "}
            <a
              href="mailto:seanj22@gmail.com"
              className="text-paper underline decoration-dotted underline-offset-2 hover:text-signal"
            >
              seanj22@gmail.com
            </a>
            . This demo is run by one person; you&apos;ll get an answer from
            the person who built it.
          </p>
        </Section>

        <p className="mt-10 text-[0.8125rem]">
          <Link
            href="/"
            className="text-muted underline decoration-dotted underline-offset-2 hover:text-signal"
          >
            ← Back to the map
          </Link>
        </p>
      </div>
    </main>
  );
}
