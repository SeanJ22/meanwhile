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
            which official&apos;s card you opened, which filters you used,
            and when. That&apos;s the whole row.
          </p>
          <p>
            The zip is stored as an approximate location — it orients the
            map, and it is never treated as your address or used to work out
            your ballot.
          </p>
          <p>
            The &quot;Who do I talk to about…?&quot; box works the same way.
            Your question is matched against a fixed list of topics on your
            device — no AI writes the answer, and every answer comes from
            the same sourced records the rest of the site shows. When a
            question routes to a topic, the log records the topic (like
            &quot;libraries&quot;), not your words. When we can&apos;t route
            a question, the log records the question&apos;s text (up to 200
            characters) so we can learn to answer it — with nothing about
            who asked, like every other row. Before a question is stored,
            anything shaped like a phone number, an email address, or a
            street address is automatically blanked out. Even so, please
            don&apos;t put personal details in a question.
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
          <p>
            If you narrow your zip to your municipality, school district, or
            street, that choice is also kept only in your browser&apos;s
            storage. The street you type is matched against a list downloaded
            to your device — it is never sent anywhere, never logged, and
            never tied to an account.
          </p>
          <p>
            If you mark how you&apos;d vote on the ballot page (&quot;my
            picks&quot;), those picks are saved only in your browser&apos;s
            storage on your device. They are never sent anywhere, never
            logged, never aggregated, and the database has no column that
            could hold them — an automated test fails the build if one is
            ever added. This is different from the yes/no/unsure reaction
            buttons, which do join anonymous local totals and say so where
            you tap them.
          </p>
          <p>
            The &quot;my picks card&quot; image is drawn on your device from
            that same local list. Creating, screenshotting, or downloading
            it sends nothing to us.
          </p>
        </Section>

        <Section title="Reactions to votes and candidates">
          <p>
            Some vote records ask &quot;Do you like this vote?&quot; and
            ballot candidates ask &quot;Would you vote for them?&quot; — each
            with Yes, No, and Unsure buttons. The first time you ever answer,
            a one-time notice explains this and asks you to OK it before
            anything is recorded; it never repeats after that. When you
            answer, the site stores: your answer, which vote or candidate it
            was about, roughly where you were looking (the districts around
            the zip or map area — never an address), the time, and a
            verification tier. Your answers never affect how candidates are
            shown, to you or anyone — nothing here ranks or recommends. Today every answer
            is stored as unverified-anonymous; if we ever add ways to verify
            answers, verified and unverified counts will always be reported
            separately.
          </p>
          <p>
            So you can change your answer later, your browser makes up a
            random key the first time you react (kept in your browser&apos;s
            own storage) and sends it with each answer. We store only a
            scrambled (hashed) form of it. That key relates your
            browser&apos;s answers to each other and to nothing else: it is
            not tied to any account, appears in no other table, and is never
            included in anything shared or licensed. If you clear your
            browser&apos;s storage, your earlier answers simply can&apos;t be
            edited any more — they remain as anonymous rows. This is the
            difference between a device-continuity token and tracking, and we
            would rather say it plainly than have you wonder.
          </p>
          <p>
            Nobody&apos;s answers — including totals — are ever shown to
            anyone on this site. Area-level totals of answers, split by
            verification tier, may be licensed to political organizations —
            that&apos;s what keeps this free to use; never anything containing
            or traceable to a person.
          </p>
          <p>
            To keep those totals honest, the site limits how fast and how
            often one device can submit answers. Submissions faster than any
            person could tap are refused, and answers that arrive at a
            suspicious pace are stored but set aside — they never enter any
            total. You would only ever notice these limits if you were
            running a script. The counters that enforce them are kept apart
            from your answers in a form that can&apos;t be connected to
            them, hold nothing but how often — never what or who — and are
            deleted within two days.
          </p>
        </Section>

        <Section title="Campaign money">
          <p>
            Some candidates and members of Congress show a &quot;Campaign
            money&quot; section: how much their campaign raised and spent,
            what it has on hand, roughly what share came from small donors,
            and the largest contributions the campaign reported. All of it is
            public data the campaigns themselves file with the Federal
            Election Commission, shown as filed and linked to the FEC&apos;s
            own records. We add nothing to it and characterize nobody by it.
          </p>
          <p>
            The funding displays have the same yes/no/unsure reaction buttons
            as votes and candidates, and the same rules apply — stored
            anonymously, never shown back to anyone. One difference, stated
            plainly: while a legal question about commercial use of FEC
            contributor data is open, <strong>reactions to funding displays
            are excluded from anything licensed to anyone</strong>. That
            exclusion is enforced by a named switch in the code, and only
            counsel can close it. If it closes, this page changes in the
            same release.
          </p>
          <p>
            Where a contributor is itself a committee, its label — a super
            PAC, a leadership PAC, a PAC connected to a corporation, a
            union, a trade association — comes only from the codes that
            committee filed with the FEC, and tapping the label shows the
            FEC&apos;s own definition. We never decide what kind of group
            something is from its name, and where the FEC does not classify
            a committee, the label stays general.
          </p>
        </Section>

        {/* Door 2 of the photo rule (2026-08-14): an official
            government-published portrait ships with attribution and a
            documented remove-on-request posture. The posture has to be
            written down where the person pictured can find it, which is
            here — the rule and this paragraph land in the same commit. */}
        <Section title="Photographs of officials">
          <p>
            Photographs of officials and candidates come from one of two
            places, and we record which for every single one. Either the
            photo carries an explicit licence — a public-domain government
            work, or an openly licensed image with its licence and
            photographer recorded — or it is the official portrait a
            government body publishes to identify its own member, used with
            a link to the page it came from and credit to that body.
            Photographs a working photographer is likely to own — campaign
            headshots, press pictures, wire images — are only ever used with
            an explicit licence.
          </p>
          <p>
            If you are pictured here and would like your photograph removed,
            write to{" "}
            <a
              href="mailto:seanj22@gmail.com"
              className="underline decoration-dotted underline-offset-2"
            >
              seanj22@gmail.com
            </a>{" "}
            and we will take it down. You do not have to give a reason, and
            the rest of the entry stays as it is — the page will simply show
            initials instead.
          </p>
        </Section>

        <Section title="What happens to the data">
          <p>
            The plan for this product is to aggregate what people look up —
            never who looked it up — and those aggregates may be licensed to
            political organizations: counts like &quot;how many searches
            touched this district this week.&quot; That&apos;s what keeps this
            free to use. No aggregate of this demo&apos;s data has been
            licensed to anyone; if that changes, this page changes first.
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
          <p className="mt-3">
            Ballot information is presented as filed with election
            authorities; we never suggest how to vote.
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
