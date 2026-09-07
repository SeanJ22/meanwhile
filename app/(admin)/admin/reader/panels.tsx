/**
 * **THE READER-INTELLIGENCE CARDS.** (Admin Pass C, ADM-C12.)
 *
 * Separated from `page.tsx` for one reason: the page is the only thing that
 * opens a store, and a component that takes an already-read, already-audited
 * value can be RENDERED in a proof. Nothing here reads a store, the clock or
 * the environment, and nothing here computes a figure — every number arrives
 * inside a reading the page has already run its audits against.
 *
 * Every card is a `StatusBlock`, so every one of them answers the owner's four
 * questions in the same order: what am I looking at, what happened, what
 * happens next, does this need me. A card that wants a different shape is a
 * card that has not decided what it is telling him.
 */
import { displayNameOf } from "@/lib/control-plane/display-name.ts";
import { formatCalendarDate } from "@/lib/control-plane/eastern-time.ts";
import {
  READER_TOP_N,
  censusCountFor,
  readerWord,
  scopeSentence,
  share,
  topListSentence,
  type ActivityReading,
  type AskReading,
  type DemandReading,
  type ReactionReading,
  type ReaderRunClass,
  type TopList,
} from "@/lib/control-plane/reader-intel.ts";
import type { RunClassCensus } from "@/lib/signal/search-log-reads.ts";

import { BarChart, DayBars, StackedBar, type BarRow } from "../../charts.tsx";
import { GapNote, HeldNum } from "../../console-ui.tsx";
import { NEEDS_NOTHING, StatusBlock } from "../../status-ui.tsx";

/** Where a queued gap says it came from, and where a queue button returns to. */
export const HERE = "/admin/reader";

/* ------------------------------------------------------------------ *
 * SMALL PIECES
 * ------------------------------------------------------------------ */

/**
 * A stored constant on the face: the owner's words, with the raw key and the
 * sentence that defines it on the hover. The reader domain's dictionary, beside
 * the shared one `Code` reads for the control plane's constants.
 */
export function Word({ raw }: { raw: string }) {
  const word = readerWord(raw);
  const hover = word.means === "" ? raw : `${raw} — ${word.means}`;
  return (
    <span className="plain-code" title={hover}>
      {word.label}
    </span>
  );
}

/**
 * One ranked list as bars, with the line that says what it left out.
 *
 * `asName` is for a list whose keys are government, meeting, official or
 * candidate ids. Those render as the display name with the id directly beneath
 * it (ADM-12: a human name on the face, the raw key never hidden and never
 * leading) — and the projection is honest about what it could not recognise,
 * so a key it cannot place comes back as its own segments in words rather than
 * as an invented name.
 */
export function TopBars({
  list,
  caption,
  one,
  many,
  asName,
}: {
  list: TopList;
  caption: string;
  /** The thing being counted, singular and plural, for the line under the bars. */
  one: string;
  many: string;
  /** Render each key through the display-name projection rather than as words. */
  asName?: boolean;
}) {
  if (list.rows.length === 0) {
    return (
      <figure className="chart">
        <figcaption>{caption}</figcaption>
        <p>
          <GapNote
            gap={{
              whose: "OURS",
              says: `No ${one} was named by any event in this window. The store answered and holds none.`,
            }}
            where={`Reader intelligence · ${caption}`}
            returnTo={HERE}
          />
        </p>
      </figure>
    );
  }
  const widest = list.rows[0].count;
  const rows: BarRow[] = list.rows.map((row) => {
    const named = asName ? displayNameOf(row.key) : null;
    return {
      label: named === null ? row.label : named.name,
      value: row.count,
      max: widest,
      shown: `${row.count} of ${list.keyed}`,
      // The id under the name: never hidden, never leading. A key the
      // projection could not place is marked, because words assembled from a
      // key's own segments are a reading of the key and not a recorded name.
      hint: named === null ? undefined : row.key,
      className: named !== null && !named.recognised ? "name-unrecognised" : undefined,
    };
  });
  return (
    <>
      <BarChart rows={rows} caption={caption} />
      <p className="note">{topListSentence(list, one, many)}</p>
    </>
  );
}

/**
 * The sentence a panel shows when the class the owner selected holds nothing
 * but the window holds something.
 *
 * This is the misreading the architecture map warns about: the reaction, speak
 * and demand stores default `run_class` to UNKNOWN, so an ORGANIC view of older
 * rows is legitimately close to empty — and letting that read as "nobody
 * reacted" would be the product making a false claim about its own readers.
 */
export function ClassEmptyNote({
  runClass,
  inClass,
  windowTotal,
  what,
  where,
}: {
  runClass: ReaderRunClass;
  inClass: number;
  windowTotal: number;
  what: string;
  where: string;
}) {
  if (inClass > 0 || windowTotal === 0) return null;
  return (
    <p>
      <GapNote
        gap={{
          whose: "OURS",
          says:
            `No ${what} in this window is counted as ${readerWord(runClass).label.toLowerCase()}, but ` +
            `${windowTotal} ${windowTotal === 1 ? "row is" : "rows are"} here under another class. This ` +
            "store marks a row unattributable unless the writer declares itself, so a reader-only view of " +
            "older rows is legitimately close to empty. Change the class above to see where they went.",
        }}
        where={where}
        returnTo={HERE}
      />
    </p>
  );
}

/* ------------------------------------------------------------------ *
 * THE CARDS
 * ------------------------------------------------------------------ */

/** Whose traffic every figure below came from, drawn so the excluded part is visible. */
export function TrafficCensusPanel({
  census,
  reconciles,
  runClass,
}: {
  census: RunClassCensus;
  reconciles: boolean;
  runClass: ReaderRunClass;
}) {
  const classWords = readerWord(runClass).label;
  const inClass = censusCountFor(census, runClass);
  const accounted = census.organic + census.author + census.synthetic + census.unknown;
  return (
    <StatusBlock
      what={
        <>
          <strong>Every row in the window, split by who wrote it.</strong> Only the first group is ever a
          figure about demand.
        </>
      }
      happened={
        census.total === 0 ? (
          <>Nothing at all was recorded in this window — no readers, and no automated runs either.</>
        ) : (
          <>
            {census.total} {census.total === 1 ? "row" : "rows"} in the window, of which {inClass}{" "}
            {inClass === 1 ? "is" : "are"} {classWords.toLowerCase()}.
          </>
        )
      }
      next={
        reconciles ? (
          <>Every row is accounted for by one of the four groups.</>
        ) : (
          <>
            The four groups do not add up to the total, so at least one row carries a class this page has no
            name for. That is a thing to fix, not a rounding difference.
          </>
        )
      }
      needsYou={
        reconciles
          ? NEEDS_NOTHING
          : { needed: true, action: "a row carries an unrecognised traffic class — it needs a name" }
      }
      detail={<p className="note">{scopeSentence(runClass, census)}</p>}
    >
      {census.total > 0 && (
        <StackedBar
          total={census.total}
          caption="Every row in the window"
          parts={[
            { label: readerWord("ORGANIC").label, value: census.organic, className: "part-readers" },
            { label: readerWord("AUTHOR").label, value: census.author, className: "part-author" },
            { label: readerWord("SYNTHETIC").label, value: census.synthetic, className: "part-automated" },
            { label: readerWord("UNKNOWN").label, value: census.unknown, className: "part-unattributed" },
          ]}
        />
      )}
      {!reconciles && (
        <p>
          <GapNote
            gap={{
              whose: "OURS",
              says: `The four named groups account for ${accounted} of ${census.total} rows. The rest carry a traffic class nothing in the code names.`,
            }}
            where="Reader intelligence · traffic census"
            returnTo={HERE}
          />
        </p>
      )}
    </StatusBlock>
  );
}

export function ActivityPanel({
  a,
  runClass,
  days,
}: {
  a: ActivityReading;
  runClass: ReaderRunClass;
  days: number;
}) {
  const classWords = readerWord(runClass).label;
  const widest = Math.max(...a.byEvent.map((e) => e.count), 1);
  const eventRows: BarRow[] = a.byEvent.map((event) => ({
    label: event.label,
    value: event.count,
    max: widest,
    shown: `${event.count} of ${a.total}`,
    hint: readerWord(event.key).means,
  }));
  const busiest = a.byDay.reduce((best, day) => (day.count > best.count ? day : best), { day: "", count: 0 });
  return (
    <StatusBlock
      what={
        <>
          <strong>What people did.</strong> Every recorded interaction on the map and the ballot over the
          last {days} days, counted as <Word raw={runClass} />.
        </>
      }
      happened={
        <>
          {a.total} {a.total === 1 ? "event" : "events"} of the {a.census.total} recorded in this window.
          {busiest.count > 0 && (
            <> The busiest day was {formatCalendarDate(busiest.day)}, with {busiest.count}.</>
          )}
        </>
      }
      next={
        <>
          Nothing here changes on its own. The next event lands when somebody next uses the site, and this
          page re-reads the store every time you open it.
        </>
      }
      needsYou={NEEDS_NOTHING}
      detail={
        <>
          <p className="note">
            Counted from the search log over the half-open window. Every figure is a count of events: there
            is no person, session or device in this store, so there is no such thing here as a user, a visit
            or a return.
          </p>
          <table>
            <thead>
              <tr>
                <th>Event as stored</th>
                <th className="n">Events</th>
                <th>What it means</th>
              </tr>
            </thead>
            <tbody>
              {a.byEvent.map((event) => (
                <tr key={event.key}>
                  <td>
                    <code>{event.key}</code>
                  </td>
                  <td className="n">{event.count}</td>
                  <td>{readerWord(event.key).means}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      }
    >
      <ClassEmptyNote
        runClass={runClass}
        inClass={a.total}
        windowTotal={a.census.total}
        what="event"
        where="Reader intelligence · activity"
      />
      <div className="chart-row">
        <BarChart rows={eventRows} caption={`What ${classWords.toLowerCase()} did — ${a.total} events`} />
        {a.byDay.length > 0 && (
          <DayBars
            days={a.byDay.map((day) => ({ label: formatCalendarDate(day.day), value: day.count }))}
            caption="Events per day, Eastern"
          />
        )}
      </div>
      <p className="note">
        A day with no event is absent from the strip rather than drawn at zero. The store records what
        happened; a day it holds nothing for is a day nobody used the site, not a day that was measured and
        found empty.
      </p>
    </StatusBlock>
  );
}

export function DemandPanel({
  a,
  runClass,
  days,
}: {
  a: ActivityReading;
  runClass: ReaderRunClass;
  days: number;
}) {
  return (
    <StatusBlock
      what={
        <>
          <strong>Which places, governments, meetings and people were looked at.</strong> Counted as{" "}
          <Word raw={runClass} />, over the last {days} days.
        </>
      }
      happened={
        <>
          {a.topZips.distinct} distinct {a.topZips.distinct === 1 ? "ZIP was" : "ZIPs were"} entered, and{" "}
          {a.topDivisions.distinct} distinct{" "}
          {a.topDivisions.distinct === 1 ? "district was" : "districts were"} touched.
        </>
      }
      next={<>Nothing here needs a decision from you. It is the map of what to cover next.</>}
      needsYou={NEEDS_NOTHING}
      detail={
        <p className="note">
          A ZIP is a place and not a person: the store keeps it as orientation only and never resolves it to
          anybody. One event that touched six overlapping districts is counted once in each of the six, so
          district counts add up to more than the events behind them — the total of those touches is stated
          below rather than left to be inferred. The coarse grouping is the first three digits of a ZIP,
          which is a region and never a neighbourhood.
        </p>
      }
    >
      <ClassEmptyNote
        runClass={runClass}
        inClass={a.total}
        windowTotal={a.census.total}
        what="event"
        where="Reader intelligence · demand"
      />
      <TopBars list={a.topZips} caption="Most-entered ZIPs" one="ZIP" many="ZIPs" />
      <TopBars
        list={a.topZipAreas}
        caption="Most-entered regions — the first three digits of the ZIP"
        one="region"
        many="regions"
      />
      <TopBars list={a.topDivisions} caption="Most-touched districts" one="district" many="districts" asName />
      <p className="note">
        Those {a.divisionTouches} district touches come from {a.total} events. One event that touched
        several overlapping districts is counted in each of them, so these do not sum to the events.
      </p>
      <TopBars list={a.topBodies} caption="Most-opened governing bodies" one="body" many="bodies" asName />
      <TopBars list={a.topMeetings} caption="Most-opened meetings" one="meeting" many="meetings" asName />
      <TopBars list={a.topOfficials} caption="Most-opened officials" one="official" many="officials" asName />
      <TopBars list={a.topFilters} caption="What people narrowed the map by" one="filter" many="filters" />
      <h3>How deep the coverage was where they looked</h3>
      {a.byTier.length === 0 ? (
        <p>
          <GapNote
            gap={{ whose: "OURS", says: "No event in this window recorded a coverage tier." }}
            where="Reader intelligence · coverage tier"
            returnTo={HERE}
          />
        </p>
      ) : (
        <ul>
          {a.byTier.map((tier) => (
            <li key={tier.key}>
              <Word raw={tier.key} />{" "}
              <HeldNum
                h={share(
                  tier.count,
                  a.total,
                  "Events whose place was covered at this tier, out of every event in this class in the window.",
                  "the search log over this window",
                )}
                where="Reader intelligence · coverage tier"
                returnTo={HERE}
              />
            </li>
          ))}
        </ul>
      )}
      <p className="note">
        Only the floor tier is shown. The per-government distribution is stored on every row and has never
        appeared on any surface; putting it on one is a decision for you, not something a page should start
        doing on its own.
      </p>
    </StatusBlock>
  );
}

export function QuestionsPanel({
  a,
  runClass,
  days,
}: {
  a: ActivityReading;
  runClass: ReaderRunClass;
  days: number;
}) {
  const refused = a.topAskTopics.rows.find((row) => row.key === "NO_ROUTE");
  const unanswered = refused === undefined ? 0 : refused.count;
  return (
    <StatusBlock
      what={
        <>
          <strong>Questions typed into the ask box, by topic.</strong> Counted as <Word raw={runClass} />,
          over the last {days} days.
        </>
      }
      happened={
        <>
          {a.topAskTopics.keyed} {a.topAskTopics.keyed === 1 ? "question was" : "questions were"} asked with
          a recorded topic, across {a.topAskTopics.distinct} distinct{" "}
          {a.topAskTopics.distinct === 1 ? "topic" : "topics"}.
          {unanswered > 0 && <> {unanswered} of them reached the box and nothing could answer.</>}
        </>
      }
      next={
        <>
          The topics nothing could answer are the roadmap: each one is a question a reader brought that this
          product could not take.
        </>
      }
      needsYou={
        unanswered > 0
          ? {
              needed: true,
              action: "decide which of the unanswerable question topics this product should learn to answer",
            }
          : NEEDS_NOTHING
      }
      detail={
        <p className="note">
          What a reader typed is not read here. A routed question records only its topic; a question nothing
          could answer records the capped, scrubbed text on its own row, and this page counts those by
          category and never selects that text. The ask store — which would hold a question beside the
          answer it got — is switched off, so it is the source of nothing above.
        </p>
      }
    >
      <TopBars list={a.topAskTopics} caption="Question topics" one="topic" many="topics" />
    </StatusBlock>
  );
}

export function ReactionPanel({
  r,
  runClass,
  days,
}: {
  r: ReactionReading;
  runClass: ReaderRunClass;
  days: number;
}) {
  const instruments: { key: string; answers: ReactionReading["byAnswer"] }[] = [];
  for (const answer of r.byAnswer) {
    const key = `${answer.targetType}|${answer.scaleVersion}`;
    const existing = instruments.find((i) => i.key === key);
    if (existing === undefined) instruments.push({ key, answers: [answer] });
    else existing.answers = [...existing.answers, answer];
  }
  return (
    <StatusBlock
      what={
        <>
          <strong>What people said.</strong> Answers readers gave on votes, candidates, measures and money
          over the last {days} days, counted as <Word raw={runClass} />.
        </>
      }
      happened={
        <>
          {r.clean} {r.clean === 1 ? "answer stands" : "answers stand"} out of the {r.total} in this class,
          from {r.census.total} recorded in the window.{" "}
          {r.quarantined > 0
            ? `${r.quarantined} more ${r.quarantined === 1 ? "was" : "were"} held back by the rate limiter and ${r.quarantined === 1 ? "counts" : "count"} towards nothing.`
            : "None was held back by the rate limiter."}
        </>
      }
      next={
        <>
          An answer changed replaces the answer before it, so this count moves when a reader changes their
          mind as well as when a new reader answers.
        </>
      }
      needsYou={NEEDS_NOTHING}
      detail={
        <p className="note">
          Counted from the reaction store, which is an overwrite and not a log: a count here is current
          positions last changed in this window, never taps. Answers are grouped by the exact question that
          was asked — versions 1, 2 and 3 of an instrument are different questions and are never pooled,
          because a pooled number would move because the wording changed and nothing else. Quarantined rows
          are stored, excluded from every group above, shown beside and never merged in. Campaign-finance
          answers render here for you and enter nothing that is sold.
        </p>
      }
    >
      <ClassEmptyNote
        runClass={runClass}
        inClass={r.total}
        windowTotal={r.census.total}
        what="answer"
        where="Reader intelligence · reactions"
      />
      {instruments.map((instrument) => {
        const first = instrument.answers[0];
        const widest = Math.max(...instrument.answers.map((a) => a.count), 1);
        return (
          <div key={instrument.key}>
            <BarChart
              rows={instrument.answers.map((answer) => ({
                label: answer.choiceLabel,
                value: answer.count,
                max: widest,
                shown: `${answer.count} of ${r.clean}`,
              }))}
              caption={readerWord(first.targetType).label}
            />
            <p className="note">
              The question these answered, word for word: &ldquo;{first.question}&rdquo; — instrument
              version {first.scaleVersion}.
            </p>
          </div>
        );
      })}
      {instruments.length === 0 && r.total > 0 && (
        <p>
          <GapNote
            gap={{
              whose: "OURS",
              says: "Rows are here in this class, and every one of them is held by the rate limiter, so none may be counted.",
            }}
            where="Reader intelligence · reaction answers"
            returnTo={HERE}
          />
        </p>
      )}
      <h3>How much was checked about the person answering</h3>
      <ul>
        {r.byTier.map((tier) => (
          <li key={tier.key}>
            <Word raw={tier.key} /> — {tier.count} of {r.clean}. {readerWord(tier.key).means}
          </li>
        ))}
      </ul>
      {r.topTargets.map((group) => (
        <TopBars
          key={group.targetType}
          list={group.list}
          caption={`Most answered — ${readerWord(group.targetType).label}`}
          one="target"
          many="targets"
          asName
        />
      ))}
    </StatusBlock>
  );
}

export function WantedSoonerPanel({ d, runClass }: { d: DemandReading; runClass: ReaderRunClass }) {
  return (
    <StatusBlock
      what={
        <>
          <strong>The &ldquo;get this sooner&rdquo; button, by what it named.</strong> Counted as{" "}
          <Word raw={runClass} />.
        </>
      }
      happened={
        <>
          {d.total} of the {d.census.total} {d.census.total === 1 ? "request" : "requests"} recorded in this
          window.
        </>
      }
      next={<>Each one names a body or a candidate somebody wants covered sooner than it currently is.</>}
      needsYou={NEEDS_NOTHING}
      detail={
        <p className="note">
          Counted from the demand-signal store. Readers never see any of this back: the button confirms the
          ask and reports no total, and nothing here has ever been rendered to anybody but you.
        </p>
      }
    >
      <ClassEmptyNote
        runClass={runClass}
        inClass={d.total}
        windowTotal={d.census.total}
        what="request"
        where="Reader intelligence · wanted sooner"
      />
      <TopBars list={d.topSubjects} caption="Most asked for sooner" one="subject" many="subjects" asName />
    </StatusBlock>
  );
}

/**
 * The Ask store, whose emptiness is a fact about a switch.
 *
 * Capture ships pulled pending the disclosure copy, so an empty table is
 * expected. Rendering that as "no reader asked anything" would be a false claim
 * about readers who ARE asking — their questions are counted in the panel
 * above, from the search log.
 */
export function AskStorePanel({ ask }: { ask: AskReading }) {
  return (
    <StatusBlock
      what={
        <>
          <strong>The store that would keep a question beside the answer it got.</strong> Built, wired, and
          switched off.
        </>
      }
      happened={
        ask.capturePulled ? (
          <>
            Capture is off, so the store holds {ask.rowsInWindow} {ask.rowsInWindow === 1 ? "row" : "rows"}{" "}
            for this window. That is a fact about a switch and not about readers: questions are being asked,
            and they are counted above from the search log.
          </>
        ) : (
          <>
            Capture is on, and the store holds {ask.rowsInWindow}{" "}
            {ask.rowsInWindow === 1 ? "row" : "rows"} for this window across every traffic class.
          </>
        )
      }
      next={
        ask.capturePulled ? (
          <>
            Turning it on is three things together — the line a reader sees before they type, the switch,
            and minting the continuity key. Doing two of the three records nothing.
          </>
        ) : (
          <>Rows accumulate as readers ask.</>
        )
      }
      needsYou={
        ask.capturePulled
          ? { needed: true, action: "decide the line a reader must see before a question and its answer may be kept" }
          : NEEDS_NOTHING
      }
    />
  );
}

/** The boundary this page is built on, stated rather than assumed. */
export function BoundaryPanel() {
  return (
    <StatusBlock
      what={<strong>The boundary this page is built on, stated rather than assumed.</strong>}
      happened={
        <>
          Reader feedback is not read here at all. A feedback row carries a random reference for replying to
          somebody, and joining that reference to search behaviour, ask activity, reaction history or ZIP
          usage is forbidden by name — so this page never holds both halves at once.
        </>
      }
      next={
        <>
          Feedback has its own inbox. Nothing on this page is ever rendered back to a reader, in aggregate
          or otherwise.
        </>
      }
      needsYou={NEEDS_NOTHING}
      detail={
        <ul>
          <li>No identity is joined, because no identity is stored to join.</li>
          <li>
            No session, device or person is tracked, and no such rollup is derivable: each store keeps its
            run identifier in its own namespace, so two stores cannot be lined up against each other even
            deliberately.
          </li>
          <li>
            Every list is cut at {READER_TOP_N} inside the database and states how many exist behind it, so
            no card ever loads a whole collection.
          </li>
          <li>Nothing collected before the line in the sand is ever sold.</li>
        </ul>
      }
    />
  );
}

/**
 * A panel whose store did not answer, or answered and held nothing.
 *
 * The two are different facts and must never come out as one sentence: "the
 * store is empty" is about readers, "the store could not be reached" is about
 * this machine, and an owner told the wrong one goes looking in the wrong place.
 */
export function UnreadPanel({
  what,
  detail,
  reached,
  whenEmpty,
  whenUnreachable,
}: {
  what: React.ReactNode;
  detail: string;
  /** True when the store answered and holds nothing; false when it could not be asked. */
  reached: boolean;
  whenEmpty: React.ReactNode;
  whenUnreachable: string;
}) {
  return (
    <StatusBlock
      what={what}
      happened={detail}
      next={reached ? whenEmpty : <>Nothing is being said about this until the store answers. Reload to ask again.</>}
      needsYou={reached ? NEEDS_NOTHING : { needed: true, action: whenUnreachable }}
    />
  );
}
