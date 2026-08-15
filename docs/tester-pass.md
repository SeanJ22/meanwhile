# Tester pass — 2026-08-14 (sixth session of 2026-08-14), phone width, walked as a stranger

Supersedes the third-session pass. This session executed the outside
tester's **mobile** pass. Every changed surface walked at 390×844, cold
entry through the welcome overlay, all four covered zips. Driver:
`scripts/tester-walk-0814e.mts` — the PASS counts below are its output;
screenshots `screenshots/walk0814e-<zip>-*.png`. All dates in this
document are wall clock.

**72 checks green, 0 failed: 03255 18/18 · 07866 18/18 · 85701 18/18 ·
85641 18/18.**

## The item-1 gate, passed with the screenshot

At 03255, the library question (`walk0814e-03255-library-GATE.png`):
**"Libraries — City libraries are city budget lines... Newbury town... We
haven't sourced who sits on this body yet."** Zero Arizona references
anywhere on the card. The two links in the answer resolve to
**newbury.nh.gov** and **merrimackcounty.net** — both New Hampshire,
checked by the walk and read off the screenshot by eye.

The same gate at the other three zips: 07866 links to
rockawaytownship.org and morriscountynj.gov; 85701 to tucsonaz.gov and
pima.gov; 85641 to pima.gov. **Pima's sourced fact still renders for
Pima readers** — the Arizona answer reads "Here the library system is a
county library district, and the county Board of Supervisors sits as its
board", and New Hampshire's reads the neutral "in some places". The
place-specific truth was kept and confined, not deleted.

The cause was the topic explainer template carrying one county's fact at
every zip. A 4-zip × 16-topic audit of every rendered sentence and every
rendered link found exactly two contaminations, both that one template;
every link target already resolved correctly from the reader's own
coverage. `tests/jurisdiction-content.test.ts` now audits templates AND
link targets with the denominator asserted, and the regression fails it
three ways.

## Item 2, the tester's own complaint, gated the same way

Her words: the floater never appears on her phone, and the only entry
was at the very bottom under the browser chrome — "I don't think I would
have found that without knowing it existed."

At every zip: **a "What's on the ballot →" entry renders at y=180**, in
the who-governs card's pinned head; it stays at y=180 after the card's
body is scrolled 298px (it is pinned, not a row that scrolls away);
**one tap reaches `/ballot?zip=<zip>`** with the zip attached, no
interstitial. The floater was not retired — it was un-buried, and the
screenshot shows "BALLOT · 03255" sitting clear at the top of the map.

## Item 3, measured rather than eyeballed

At every zip the walk asserts, in the page: **no fixed control overlaps
the who-governs card**, and **nothing on the overlay stack runs off the
top of the screen**. Both were false before this session — the card's top
sat at y = −113, with the hamburger at (12,12,44×44) and MapLibre's zoom
column at (349,0,41×70) on top of its text, the count badge at y = −166
and the card's own minimize control at y = −104.

## What each zip proved

Per zip, all four: the library gate above; the ballot entry pinned and
one tap away; no control over content and nothing off the top; **all six
district types checked on a fresh device AND on a device carrying the
pre-fix `wtp.show_districts=1` preference**; the state's governor named
on who-governs with their **official portrait rendering from our
origin** on the full card (03255 `/officials/statewide-nh-governor.png`
227×340, 07866 `/officials/statewide-nj-governor.jpg` 1000×1250,
85701/85641 `/officials/statewide-az-governor.jpg` 284×354); a thin
candidate's honesty line present, with no apology and no
characterization; and the funding section's committee labels
differentiated with one explainer opened.

Zip-specific on item 6: 07866's ballot page carries six distinct labels
in one view — "a joint fundraising committee", "a PAC connected to a
trade association", "a PAC connected to a corporation", "a leadership
PAC", "another candidate's campaign committee", "a hybrid PAC" — which
is the whole point of the item. 85701 carries "a leadership PAC" and "a
PAC connected to a membership organization". Every label taps open two
sentences ending in a link to the FEC's own definition.

## Photos, verified twice

The three governors were each **eyeballed as images** before shipping,
and all three replaced a wrong-in-kind predecessor (Hobbs an event
candid, Ayotte her fourteen-year-old U.S. Senate portrait, Sherrill a
Commons headshot).

The chamber tier was verified in two passes: a **22-face contact sheet**
of staged images across all three chambers (azleg 7, gc.nh.gov 7, njleg
8) before shipping, and a **20-face contact sheet of the committed
files** afterwards, each of which was also confirmed to serve 200 with
real bytes from our own origin (20 of 20). Every face on both sheets is
a clean solo portrait of one person. Sampling is stated as sampling:
278 portraits shipped, 42 face-checked across the two sheets.

## Honest notes

- The walk runs headless under Playwright, which renders and screenshots
  for real; the gate images were read by eye in the session log. The
  in-app Browser pane was used for the *diagnosis* phase, where its
  hidden-pane limits apply (compositor transitions do not advance, so
  the sidebar drawer had to be measured with its transition disabled —
  a harness artifact, not an app defect).
- Two walk-script bugs were found and fixed rather than reported as app
  failures: `[data-ask-box]` matches the rail's hidden copy first at
  phone width, and a one-level ancestor of the input captures only the
  word "Ask". Both would have read as red on a working app.
- The tester's item 4 could not be reproduced and is not a defect — see
  `docs/state.md` §22; she was on the deploy that predated the all-on
  default by four hours.
- Console: unchanged from the previous pass — the only errors during
  walks are MapLibre WebGL performance warnings, pre-existing.
