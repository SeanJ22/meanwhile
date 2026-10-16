# Oversight instructions (overnight, Oct 15 to 16)

Sean, 11:17 PM Arizona: "I want you (or someone) being able to direct things while I'm asleep." This file is that channel. Only Sean's oversight session writes it.

Read it every 10 minutes:
  git fetch origin board/oversight && git show origin/board/oversight:instructions.md

Scope: SB-01 only, until it is live and verified. Nothing here adds work outside SB-01, and no lane takes on anything beyond its SB-01 paste because of this file.

Newest entries at the top. Each entry names the session it is for. Act on entries for you at once.

## 11:31 PM Arizona (06:31Z): River release, same discipline
- Read this file at the start of each of your normal fold passes, not on a separate 10-minute loop.
- Between passes, idle cheaply: one git fetch of stream/ballot-three-states to see whether a READY landed, nothing else.

## 11:32 PM Arizona (06:32Z): BL-30 lane, spend tokens only where they move SB-01
- Do not poll board/oversight or board/river while you are building. Check them only after you push a READY, and then every 10 minutes until River folds it.
- While building, run the focused tests for the files you change. Run the full `pnpm gates` once, on the merged head, immediately before each READY.
- Run the real-data at-scale measurements once per READY, after the code is final; do not re-run them for intermediate edits.
- Read only the files SB-01 touches; do not survey the rest of the repository.

## 11:20 PM Arizona (06:20Z): standing orders for SB-01
- BL-30 lane: build SB-01A, then SB-01B, as pasted. Do not end your turn until River confirms SB-01B is live. Check returns/ballot-three-states.md on board/river and this file every 10 minutes; fix any return and re-READY immediately. When a choice comes up that the brief does not settle, take the option that keeps every record and read to one state and the change smallest, and state it in the READY.
- River release: fold and ship SB-01A alone the moment it is READY, then SB-01B alone, as pasted. Check this file every 10 minutes. Write any return for ballot-three-states with the exact fix, not only the finding.
