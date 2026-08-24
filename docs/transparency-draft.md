# The transparency page — DRAFT for Sean's approval

**Status: NOT SHIPPED. Nothing here renders to anybody.** (`T01`, drafted
2026-08-24.)

This is a draft of the page a reader would see at `/transparency` when this
product goes public. The page live today is the DEMO version — it describes the
unlisted demo and says in its own words that it will be rewritten and dated
before the product is offered to the public. **It does not mention selling at
all**, which is the gap this draft fills.

**It renders nothing until Sean approves it.** The ripcord doctrine also
applies: the transparency page changes in the same commit that ships the
feature it describes.

## What is owed here, and why the wording matters

Every "never" on this page is enforced in the database schema and in automated
tests — the build fails if a column, or a route that could write one, is ever
added. So the page is not a promise; it is a description of a mechanism. That
is the only kind of privacy claim worth printing, and it is why the wording has
to be exact.

Three things must be said plainly, and the third is the one nobody enjoys
writing:

1. what is collected,
2. how it is used,
3. **that anonymous totals may be sold.**

---

# DRAFT COPY BEGINS

## What we collect, what we do with it, and what we sell

We are going to be direct about this, because a privacy page that buries the
important sentence is not a privacy page.

### What we collect

**Your zip code, or your street address if you give us one.** The zip orients
the map. It is stored as an approximate location — it is never treated as your
address and never used to work out your ballot, because a zip code genuinely
cannot do that: zip areas cross city, county, school district and legislative
lines. If you want your actual ballot, we ask for a street address, and we tell
you why at the moment we ask.

**An email address, if you make an account.** That is how you sign in. There is
no password — we email you a link.

**What was asked, and roughly where.** When somebody looks something up, we
record what was looked up and the approximate area. **We do not record who.**

**Your reactions, if you tap one.** A reaction is attached to a specific
sourced position — "would you vote for someone who holds this position" — and
never to a person as a whole. You can add a comment; you never have to.

### What we do not collect, ever

The two records above — what was searched, and what was reacted to — carry **no
identity of any kind**. No account. No device ID. No fingerprint. No stored IP
address. No session key that outlives the session. Nothing that points at
another table.

**They are not connected to your account, or to each other, or to anything.**
There is no table anywhere that links them, and the tests fail the build if one
is ever added.

If you sign up for notifications, we hold your email, your zip, and the topics
you told us you care about — **and no history of what you did on the site.** We
notify you about things you asked about, not things we worked out by watching
you. That makes for a slightly worse notification product. It is the only
version we are willing to run.

### What we sell

**We sell anonymous totals.** Political organisations pay for counts — how many
people in an area reacted which way to a specific position. That is the
business, and it is what keeps the product free for you.

Here is what that means concretely:

- **We sell numbers, never people.** A buyer receives counts. There is nothing
  in what we sell that could be traced back to any individual, because there is
  nothing in what we STORE that could be.
- **We could not identify you if we wanted to, and neither could a buyer, and
  neither could anyone who stole the database.** That is not a policy. It is a
  consequence of the records carrying no identity in the first place.
- **We never sell to one buyer only.** The same data is offered on the same
  terms to anyone who wants it. We will not give one side an exclusive.
- **Every sale states its own confidence.** We tell buyers how many responses
  were verified and how, rather than handing over a single clean-looking number
  that hides how much of it is solid.

### What you never see

You will never see anyone else's answers, or any total, anywhere on this site.

That is deliberate and it is not squeamishness: if we showed you how other
people had answered, it would change how you answer, and then the numbers would
be worth nothing to anybody — including to you, as a description of what your
neighbours actually think.

### What this site will never do

- **It will never tell you how to vote.** No scores, no rankings, no "best
  match", no recommended ballot. Candidates appear in a neutral order and that
  is all.
- **It will never make up a position.** Everything we say a candidate thinks
  points at something they actually said, voted for, or filed. Where we have
  found nothing, we say we have found nothing — we do not guess from their
  party.
- **It will never show your input back to anybody.** No comments, no feeds, no
  profiles, no shared slates.

### Free text, and the one thing we remove

If you write a comment, we read it before anything is counted. **Threats of
violence are removed and may be reported to law enforcement.** We say "may"
rather than "will" on purpose: a promise we could not keep every single time
would be worse than a stated reserved right.

### Changing your mind

Your reactions can be changed. Your browser holds a random key — stored only as
a one-way hash — that lets your own answers be corrected. It relates your
answers to each other and to nothing else. It is on no other table, and it is
in nothing we sell.

# DRAFT COPY ENDS

---

## Notes for Sean, not for the page

- **The selling section is the whole point of this draft**, and it is placed
  where a reader will actually reach it rather than at the bottom. Burying it
  would be the friction rule pointed the wrong way.
- **"We never sell to one buyer only"** is RULING 120 written for a reader. His
  words were *"We will never sell exclusively. I will solicit equally."* The
  equal-solicitation half is deliberately NOT promised on this page — it is a
  real obligation, but it is a promise about our sales conduct rather than a
  fact about the reader's data, and mixing the two weakens both.
- **Nothing here is dated yet.** The live demo page carries a dated note saying
  it will be rewritten; whichever version ships should carry the date it became
  true, from `pnpm stamp`.
- **Two things are deliberately absent** and need his call: whether to name the
  price or the buyer types, and whether to link the gap ledger from here.
