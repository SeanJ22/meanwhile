# Note for PK-01 from FX-01 (Oct 23, 5:05 AM Eastern)

Sean asked FX-01 to post this for the PK-01 session. FX-01 has pushed nothing for PK-01.

## Finding: tests/picks-sync-browser.test.ts is timing-dependent at READY 631d73603

- Fails 1 run in 6 here (and twice in a row under load): `8 !== 10` (sometimes `9 !== 10`) at "eight candidate taps, one unsure and one cleared race emit ten events".
- No event is lost by the code. The missing ones are the `fresh` page's taps still queued when the test calls `fresh.reload()`. The pagehide and visibilitychange beacons for that batch show `net::ERR_ABORTED` in Playwright. When they do arrive, it is only at `browser.close()`, after the count, sent twice and de-duplicated by batch id. The single `setImmediate` after `flushPicksEvents()` cannot wait for that.
- Flushing harder at the end does not fix it: a 10-second re-flush loop and counting after `browser.close()` both still came up short in 1 of 6 runs.

## Fix that made it deterministic (8 of 8 runs, plus 3 of 3 with the production replay)

Before each `fresh.reload()`, flush both pages until the server holds every tap so far: 6 before the first reload, 10 before the second. The final exact-10 check then still proves that save, restore and polling emit nothing.

With `PK01_REPLAY_BALLOT_FILE` from a fresh read-only capture of https://meanwhileusa.com/ballot?zip=85701 (24 contests, 09:02 UTC; run `PK-01-live@2026-10-23T09:02:23.377Z`), the patched test passed 3 of 3: emittedPicks 10, restore 203 to 318 ms.

```diff
diff --git a/tests/picks-sync-browser.test.ts b/tests/picks-sync-browser.test.ts
index a480f30c0..d6a64a551 100644
--- a/tests/picks-sync-browser.test.ts
+++ b/tests/picks-sync-browser.test.ts
@@ -114,6 +114,15 @@ test("two fresh browsers restore, sync in both directions, keep offline edits an
     privateOffline = false;
     await first.getByRole("button", { name: /Candidate E/, pressed: true }).waitFor({ timeout: 5000 });
     await fresh.getByRole("button", { name: labelA, exact: true, pressed: true }).waitFor({ timeout: 5000 });
+    // A reload must not race the event batch: flush both pages until the server holds every tap so far.
+    const delivered = async (count: number) => {
+      for (const deadline = Date.now() + 10_000; captured.filter(event => event.type === "BALLOT_PICK").length < count && Date.now() < deadline;) {
+        await first.evaluate("window.flushPicksEvents()");
+        await fresh.evaluate("window.flushPicksEvents()");
+        await first.waitForTimeout(50);
+      }
+    };
+    await delivered(6);
     // Reload under tomorrow's clock: ordinary mount/poll scheduling restores the same saved state.
     await fresh.clock.setFixedTime(new Date("2026-10-24T12:00:00Z"));
     await first.clock.setFixedTime(new Date("2026-10-24T12:00:00Z"));
@@ -132,6 +141,7 @@ test("two fresh browsers restore, sync in both directions, keep offline edits an
     await fresh.getByRole("button", { name: "Clear my picks", exact: true }).click();
     await fresh.getByRole("button", { name: "Clear", exact: true }).click();
     await first.getByRole("button", { name: "Candidate E", exact: true, pressed: false }).waitFor({ timeout: 3000 });
+    await delivered(10);
     await fresh.reload();
     await fresh.getByRole("status").filter({ hasText: "Your picks are saved" }).waitFor();
     assert.equal(await fresh.getByRole("button", { pressed: true }).count(), 0, "clear and unsure state sync without resurrecting picks on reload");
```
