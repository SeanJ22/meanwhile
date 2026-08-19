import Link from "next/link";
import { PRODUCT_NAME, titleFor } from "@/lib/brand";

/**
 * The transparency page — item 5b, shipped in the same change as the search
 * log it discloses. Scoped honestly to what this is today: an unlisted demo
 * shown to a handful of people. It gets rewritten before any public launch,
 * and that is expected.
 *
 * Every sentence here is checkable against the code: the search-log schema
 * (lib/db/schema.ts), the write path (lib/db/search-log.ts), and the guard
 * tests that make the claims structural rather than aspirational.
 *
 * **The subtraction diet, 2026-08-15 (the author's pass).** Every commitment
 * on this page survived; the words around them did not. What went:
 *
 * - **Meta-language about how plainly things are being said.** "Stated
 *   plainly", "we would rather say it plainly than have you wonder", "that
 *   property is the deal" — a page that keeps telling you it is being honest
 *   is spending the reader's attention on its own posture instead of on the
 *   commitment. The commitments are load-bearing; the narration was not.
 * - **The build-fails-on-a-new-column line, three times down to once.** It is
 *   one fact about how every "never" here is enforced, and repeating it per
 *   section made each instance read as smaller than it is.
 * - **The duplicate never-tells-you-how-to-vote line.** It belongs in the
 *   section named for it, once.
 *
 * One thing was ADDED rather than cut, because the diet found it: the
 * photographs section still described **two** doors after CLAUDE.md's rule
 * grew to four. A page about photographs of real people cannot be out of date
 * about which photographs it ships.
 */

export const metadata = {
  title: titleFor("What this site collects"),
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
          {PRODUCT_NAME}
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-paper">
          What this site collects, and what it doesn&apos;t
        </h1>

        <p className="mt-4 text-[0.9375rem] leading-relaxed text-paper-dim">
          This is an unlisted demo, shared with a handful of people by the
          person who built it. This page describes what it records today, and
          will be rewritten — and dated — before this product is offered to
          the public.
        </p>

        <Section title="What is collected">
          <p>
            When you search a zip code or tap around the map, the site logs
            the event: the zip you entered, which districts and government
            bodies the answer involved, which meeting, body, or
            official&apos;s card you opened, which filters you used, and when.
            That&apos;s the whole row.
          </p>
          <p>
            The zip is stored as an approximate location. It orients the map;
            it is never treated as your address and never used to work out
            your ballot.
          </p>
          {/* C05 (2026-08-17). Ships in the same commit as the run_class
              column and the exclusion filter, per the coupling rule — a
              collection change that reaches this page later is a collection
              change nobody disclosed. */}
          <p>
            Some of the rows in that log are ours. We run automated tests
            against the live site every day, and each one leaves the same kind
            of row a reader would. Every row now says which it is — a reader,
            one of our own test runs, or unknown — and our test runs mark
            themselves as they write, rather than being guessed at afterwards.
          </p>
          <p>
            Only rows marked as readers are ever counted in anything we
            publish or license. Rows we cannot tell apart are counted as unknown
            and left out too — we would rather report a smaller number than a
            flattering one. Every row written before 17 August 2026 is unknown,
            which means the log&apos;s whole history is excluded, and any figure
            we report says how many rows it left out and why.
          </p>
          <p>
            The &quot;Who do I talk to about…?&quot; box matches your question
            against a fixed list of topics on your device. When that match
            doesn&apos;t decide, the question is sent to Anthropic&apos;s
            Claude to pick which of those same topics it belongs to — that,
            and nothing else.{" "}
            {/* Kept on one source line: the guard in tests/ask-box.test.ts
                pins this exact phrase, and a reflow that split it would
                retire the no-AI guarantee by accident. */}
            No AI writes the answer, and every answer comes from the same
            sourced records the rest of the site shows. A question that routes
            records the topic (like &quot;libraries&quot;), not your words. A
            question we can&apos;t route records its text, up to 200
            characters, so we can learn to answer it — with nothing about who
            asked. Anything shaped like a phone number, an email address, or a
            street address is automatically blanked out first. Even so, please
            don&apos;t put personal details in a question.
          </p>
        </Section>

        <Section title="What is not collected">
          <p>
            There are no accounts here, and the log has no identity in it: no
            name, no email, no phone number, no device identifier, no
            fingerprint, no IP address kept, no cookie that tracks you, and no
            ID that links one of your visits to another. The table these
            events land in has no column that could hold any of it.
          </p>
          <p>
            Every &quot;never&quot; on this page is enforced in the database
            schema and in automated tests: the build fails if a column, or a
            route that could write one, is ever added.
          </p>
          <p>
            Your zip, your display preferences, and any narrowing to a
            municipality, school district, or street stay in your own
            browser&apos;s storage. Only the zip is sent, when the site
            fetches the meetings near it.
          </p>
          <p>
            A street you type is first matched against a list downloaded to
            your device. To put it on the map as an actual point, your address
            passes through our server to the U.S. Census Bureau&apos;s free
            address lookup, which returns the matching point. It is not tied to
            an account.
          </p>
          <p>
            If you mark how you&apos;d vote on the ballot page (&quot;my
            picks&quot;), those picks are saved only in your browser&apos;s
            storage, and are never sent anywhere, never logged, never
            aggregated. The picks card image is drawn on your device from that
            same local list; creating, screenshotting, or downloading it sends
            nothing to us. This is different from the reaction buttons, which
            do join anonymous local totals and say so where you tap them.
          </p>
        </Section>

        <Section title="Reactions to votes and candidates">
          <p>
            Some vote records ask &quot;Do you like this vote?&quot; and
            ballot candidates ask &quot;Would you vote for them?&quot; — each
            with Yes, No, and Unsure. Where a race has only one candidate on
            the ballot, a fourth button — &quot;Someone else&quot; — appears
            as well, because in a race with no choice the other three
            can&apos;t tell us whether you actually wanted this person. That
            fourth answer is offered, and accepted, only in those
            one-candidate races.
          </p>
          <p>
            The first time you ever answer, a one-time notice explains this
            and asks you to OK it before anything is recorded; it never
            repeats. Each answer stores your answer, which vote or candidate
            it was about, roughly where you were looking (the districts around
            the zip or map area — never an address), the time, and a
            verification tier. Today every answer is stored as
            unverified-anonymous; if we ever add ways to verify answers,
            verified and unverified counts will always be reported separately.
          </p>
          <p>
            So you can change an answer later, your browser makes up a random
            key the first time you react and sends it with each answer. We
            store only a scrambled (hashed) form of it. That key relates your
            browser&apos;s answers to each other and to nothing else: it is
            not tied to any account, appears in no other table, and is never
            included in anything shared or licensed. If you clear your
            browser&apos;s storage, your earlier answers simply can&apos;t be
            edited any more — they remain as anonymous rows.
          </p>
          <p>
            Nobody&apos;s answers — including totals — are ever shown to
            anyone on this site, and your answers never affect how candidates
            are shown, to you or to anyone. Area-level totals, split by
            verification tier, may be licensed to political organizations;
            that&apos;s what keeps this free to use. Never anything containing
            or traceable to a person.
          </p>
          <p>
            Ballot measures are broken into their parts — the money, what it
            does, who checks it, when it starts, when it ends — and each part
            carries its own buttons. You answer about a part you have just
            read about, never about the measure as a whole, and never about
            how you intend to vote.
          </p>
          <p>
            After you answer, you can add a comment if you want to. It is
            always optional, and an answer with no comment is a complete
            answer. Comments are read by a person before anything built from
            this data leaves here, and they never go into the totals that may
            be licensed — the totals are counts of the buttons, and there is
            no place in them for what you wrote. Threats of violence are
            removed and may be reported to law enforcement.
          </p>
          <p>
            We can turn comments off without changing the site. If that
            happens while you are typing, your button answer still counts and
            we tell you plainly that your words were not saved. Comments
            already stored are left alone.
          </p>
          <p>
            To keep those totals honest, the site limits how fast and how
            often one device can submit answers. Submissions faster than any
            person could tap are refused, and answers that arrive at a
            suspicious pace are stored but set aside — they never enter any
            total. You would only notice these limits if you were running a
            script. The counters that enforce them are kept apart from your
            answers in a form that can&apos;t be connected to them, hold
            nothing but how often — never what or who — and are deleted within
            two days.
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
            Funding displays carry reaction buttons: &quot;How do you feel
            about how this campaign is funded?&quot; — love it, like it,
            don&apos;t like it, hate it, don&apos;t care. Your answer is
            stored anonymously, is never shown back to you or anyone else,
            and may inform aggregate research products. What is ever licensed
            is what readers felt about a display — never the campaign-finance
            data itself, which is the FEC&apos;s and is public already.
          </p>
          <p>
            These buttons asked a yes/no/unsure question until 15 August
            2026. Answers from before that date are kept separately and are
            never combined with answers from after it: the question changed,
            so the two are not the same measurement.
          </p>
          <p>
            Under the list of contributions we show a few figures about
            those contributions: how much of the money was filed from inside
            the candidate&apos;s own state, how it split between committees
            and individual people, and how much the single largest one
            accounts for. Each of those sentences says what it is counting —
            the biggest contributions the campaign reported, which is not
            everything it raised.
          </p>
          <p>
            Two things we deliberately do not do here. We do not say what
            share came from inside a candidate&apos;s district: the filings
            give a state, not a district, and a zip code cannot stand in for
            one. And we do not sort donors into industries, sectors or
            causes — the FEC publishes no such classification, so any we
            showed would be ours, and deciding what kind of group something
            is is exactly what this site never does.
          </p>
          <p>
            Where a contributor is itself a committee, its label — a super
            PAC, a leadership PAC, a PAC connected to a corporation, a union,
            a trade association — comes only from the codes that committee
            filed with the FEC, and tapping the label shows the FEC&apos;s own
            definition. We never decide what kind of group something is from
            its name, and where the FEC does not classify a committee, the
            label stays general.
          </p>
        </Section>

        {/* The photo rule's four doors (CLAUDE.md, 2026-08-13 through
            2026-08-15). The posture has to be written down where the person
            pictured can find it, which is here. */}
        <Section title="Photographs of officials">
          <p>
            Every photograph records where it came from, and it has to be one
            of four things: an explicitly licensed image (a public-domain
            government work, or an openly licensed one with its licence
            recorded); the official portrait a government body publishes to
            identify its own member, credited to that body; a portrait the
            campaign publishes of its own candidate on its own site; or, as a
            last resort, a portrait published on a .gov site. Photographs a
            working photographer is likely to own — press pictures, wire
            images, anything carrying a photographer&apos;s credit — are only
            ever used with an explicit licence, and social-media images never
            are.
          </p>
          <p>
            If you are pictured here and would like your photograph removed,
            say so on the{" "}
            <Link
              href="/feedback"
              className="underline decoration-dotted underline-offset-2"
            >
              feedback form
            </Link>{" "}
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
            Because the log holds no identity, there is nothing anyone —
            including us — could use to trace a row back to you.
          </p>
        </Section>

        <Section title="What this site will never do">
          <p>
            It never tells you how to vote. It never ranks candidates, never
            scores how well anyone &quot;matches&quot; you, and never orders
            candidates by anything except a neutral order like the
            ballot&apos;s own. Ballot information is shown as filed with
            election authorities, and positions are always sourced to a
            specific statement, vote, or filing — where no source exists, it
            says so instead of guessing.
          </p>
        </Section>

        {/*
          R40 (2026-08-17). The two `mailto:` links to the author's personal
          address are gone from this page and from the sidebar; the feedback
          form replaced them. The coupling rule applies as it does to every
          other capture on this site: the form's store is disclosed in the
          same commit that shipped it, immediately below.
        */}
        <Section title="Feedback">
          <p>
            The{" "}
            <Link
              href="/feedback"
              className="text-paper underline decoration-dotted underline-offset-2 hover:text-signal"
            >
              feedback form
            </Link>{" "}
            stores what you write, and the time, in a store of its own. It is
            read by the person who built this and never enters anything that
            is aggregated or licensed. It holds no name, no zip, and nothing
            that could connect it to your searches or your reactions — and,
            like the question box, the message itself is stripped of anything
            shaped like a phone number, an email address, or a street address
            before it is stored.
          </p>
          {/*
            R41 (2026-08-17, the author's ruling A). The form gained one
            optional field; the coupling rule says this page changes in the
            same commit, and it says what the field is for, what it is never
            used for, and how long it lasts.
          */}
          <p>
            The form has one optional box for your email address. Leaving it
            blank is the default and sends fine — it only exists so that a
            question can be answered or a request confirmed. If you do fill it
            in, it is kept exactly as you typed it, next to that one message
            and nowhere else: it is never added to a mailing list, never used
            to contact you about anything but that message, never connected to
            your searches or reactions, and it goes when the message goes.
          </p>
          <p>
            The first time you send feedback, your browser makes up a random
            string. It exists to stop one browser flooding the form and for
            nothing else: it is never stored with your message, and the only
            trace it leaves anywhere is a counter that expires within 48
            hours.
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
