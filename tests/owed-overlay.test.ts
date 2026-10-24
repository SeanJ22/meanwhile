// Owner additions to and declines of what is owed reach a place's list on the next read and never hold back publishing.
import assert from "node:assert/strict";
import test from "node:test";

import { actionInput } from "../app/(admin)/_mw/admin-v6/contract.ts";
import { actionDef } from "../app/(admin)/_mw/admin-v6/actions.ts";
import type { ActionKind } from "../app/(admin)/_mw/admin-v6/model.ts";
import { owedKindUpdates } from "../lib/control-plane/admin-view/updates-read.ts";
import { ADMIN_CONFIG_ID, isAdminConfig } from "../lib/control-plane/gateway/admin-config.ts";
import { submit } from "../lib/control-plane/gateway/gateway.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import type { ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";
import { isCoreChecklistItem } from "../lib/coverage/place-percent.ts";
import { addableFamilies, setActiveOwedOverlay, type OwedOverlayRecord } from "../lib/coverage/owed-overlay.ts";
import { buildPlaceOwedList, type HeldPlaceField, type PlaceSubject } from "../lib/coverage/place-owed.ts";
import { placeMeasures } from "../lib/coverage/place-measures.ts";

const county = "ocd-division/country:us/state:az/county:cochise";
const now = "2026-10-05T12:00:00Z";
const divisions = [{ id: county, label: "Cochise County" }];
const body: PlaceSubject = { id: "body:board", kind: "body", divisionIds: [county], label: "Board of Supervisors" };
const held: HeldPlaceField = { subjectId: "body:board", checklistId: "GOV-01", state: "published", sourceUrl: "https://x.gov", checkedAt: "2026-10-04T08:00:00Z", freshUntil: "2026-10-20T00:00:00Z" };
const PLACE = "geo:az.county.04003";

async function send(repos: ControlPlaneRepositories, kind: ActionKind, target: string, extra: { option?: string; amount?: string; words?: string; payload?: Record<string, string> }, key: string, at: string) {
  const input = actionInput(kind, { target, scopeKey: target, option: extra.option ?? null, words: extra.words ?? "", amount: extra.amount ?? "", selected: [], payload: extra.payload });
  return submit({ type: actionDef(kind).gateway!.type, subject: target, input, stateVersion: null, idempotencyKey: key, caller: "OWNER_SESSION", actorRef: "owner-session" },
    { repos, now: () => at, currentStateVersion: null, codeSha: null });
}
async function overlayOf(repos: ControlPlaneRepositories): Promise<OwedOverlayRecord | undefined> {
  const row = await repos.adminConfig.read(ADMIN_CONFIG_ID);
  return row !== null && isAdminConfig(row.value) ? row.value.owedOverlay : undefined;
}
const rowsNow = () => buildPlaceOwedList({ divisions, subjects: [body], held: [held], now });

test("an item added in Admin is owed on the next read, counts in the score, and undoing it takes it away", async () => {
  const repos = createMemoryRepositories();
  setActiveOwedOverlay(null);
  const before = rowsNow();
  assert.equal(before.some((r) => r.checklistId.startsWith("GOV-X")), false);

  assert.equal(addableFamilies().some((f) => f.group === "GOV"), true);
  const added = await send(repos, "owed-add", "owed", { option: "GOV", amount: "Every body names its clerk", words: "Residents ask who to call" }, "owed-add-0001", "2026-10-05T13:00:00Z");
  assert.equal(added.ok, true, JSON.stringify(added));
  const overlay = await overlayOf(repos);
  assert.equal(overlay?.additions[0].id, "GOV-X1");
  assert.equal(overlay?.additions[0].reason, "Residents ask who to call");
  assert.equal(overlay?.additions[0].addedBy, "admin", "a person is never named");

  // The next read of a place builds its list with the overlay, with no release.
  setActiveOwedOverlay(overlay);
  const after = rowsNow();
  const mine = after.filter((r) => r.checklistId === "GOV-X1");
  assert.equal(mine.length, 1, "owed once, on the body the family applies to");
  assert.equal(mine[0].requirement, "Every body names its clerk");
  assert.equal(mine[0].state, "missing");
  assert.equal(isCoreChecklistItem("GOV-X1"), true);
  assert.equal(placeMeasures(after).completeness.of, placeMeasures(before).completeness.of + 1, "completeness honestly counts one more owed");

  const undone = await send(repos, "owed-undo", overlay!.additions[0].changeId, {}, "owed-undo-0001", "2026-10-05T14:00:00Z");
  assert.equal(undone.ok, true, JSON.stringify(undone));
  setActiveOwedOverlay(await overlayOf(repos));
  assert.equal(rowsNow().some((r) => r.checklistId === "GOV-X1"), false);
  assert.equal(placeMeasures(rowsNow()).completeness.of, placeMeasures(before).completeness.of);
  assert.equal((await send(repos, "owed-undo", overlay!.additions[0].changeId, {}, "owed-undo-0002", "2026-10-05T15:00:00Z")).ok, false, "a change is undone once");
  setActiveOwedOverlay(null);
});

test("declining an added item removes it from that place's list, the log shows why, and Undo brings it back", async () => {
  const repos = createMemoryRepositories();
  await send(repos, "owed-add", "owed", { option: "GOV", amount: "Every body names its clerk", words: "Residents ask who to call" }, "owed-add-0002", "2026-10-05T13:00:00Z");
  setActiveOwedOverlay(await overlayOf(repos));
  const row = rowsNow().find((r) => r.checklistId === "GOV-X1")!;

  const noReason = await send(repos, "owed-decline", PLACE, { words: "", payload: { rows: JSON.stringify([{ rowId: row.id, subjectLabel: row.subject.label, requirement: row.requirement }]) } }, "owed-decl-0001", "2026-10-05T15:00:00Z");
  assert.equal(noReason.ok, false, "a decline needs its reason");
  const declined = await send(repos, "owed-decline", PLACE, { words: "Not a duty of a county board", payload: { rows: JSON.stringify([{ rowId: row.id, subjectLabel: row.subject.label, requirement: row.requirement }]) } }, "owed-decl-0002", "2026-10-05T15:05:00Z");
  assert.equal(declined.ok, true, JSON.stringify(declined));
  const overlay = await overlayOf(repos);
  setActiveOwedOverlay(overlay);
  assert.equal(rowsNow().some((r) => r.checklistId === "GOV-X1"), false, "declined, so no longer owed");
  assert.ok(rowsNow().some((r) => r.checklistId === "GOV-01"), "everything else is still owed");

  assert.equal(overlay?.declines.filter(row => row.undone === null).length, 1);
  assert.equal(overlay?.declines[0].reason, "Not a duty of a county board");

  const undo = await send(repos, "owed-undo", overlay!.declines[0].changeId, {}, "owed-undo-0003", "2026-10-05T16:00:00Z");
  assert.equal(undo.ok, true, JSON.stringify(undo));
  setActiveOwedOverlay(await overlayOf(repos));
  assert.ok(rowsNow().some((r) => r.checklistId === "GOV-X1"), "undoing the decline owes it again");
  setActiveOwedOverlay(null);
});

test("what cannot be owed is refused, and a replayed order changes nothing twice", async () => {
  const repos = createMemoryRepositories();
  assert.equal((await send(repos, "owed-add", "owed", { option: "GATE", amount: "Something operational", words: "x" }, "owed-add-0003", "2026-10-05T13:00:00Z")).ok, false, "only a civic family can be added to");
  assert.equal((await send(repos, "owed-add", "owed", { option: "GOV", amount: "ab", words: "x" }, "owed-add-0004", "2026-10-05T13:00:00Z")).ok, false);
  assert.equal((await send(repos, "owed-add", "owed", { option: "GOV", amount: "A real requirement", words: "" }, "owed-add-0005", "2026-10-05T13:00:00Z")).ok, false);
  const first = await send(repos, "owed-add", "owed", { option: "GOV", amount: "A real requirement", words: "Because" }, "owed-add-0006", "2026-10-05T13:00:00Z");
  assert.equal(first.ok, true);
  assert.equal((await send(repos, "owed-add", "owed", { option: "GOV", amount: "a real requirement", words: "Because" }, "owed-add-0007", "2026-10-05T13:01:00Z")).ok, false, "the same item is not owed twice");
  assert.equal((await overlayOf(repos))?.additions.length, 1);
  setActiveOwedOverlay(null);
});

test("the Decline on a new-find update names the rows it removes", () => {
  const rows = buildPlaceOwedList({ divisions, subjects: [body], held: [held], now });
  const updates = owedKindUpdates({ placeKey: PLACE, placeLabel: "Cochise County", rows, missionStart: "2026-10-03T00:00:00Z" });
  const bodies = updates.find((u) => u.id.endsWith(":body"))!;
  assert.equal(bodies.decline?.placeKey, PLACE);
  assert.ok(bodies.decline!.rows.length > 0 && bodies.decline!.rows.every((r) => r.rowId.startsWith('["body:board"')));
});
