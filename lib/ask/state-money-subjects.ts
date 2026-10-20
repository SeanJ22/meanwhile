import { bindNamedEntity, type BindableEntity } from "../routing/named-entity.ts";
import { currentReaderSelection } from "../db/reader-route.ts";
import { normalizeName } from "../routing/exact-name.ts";
import { stateMoneySourceRecords } from "../funding/state-snapshot.ts";
import { stateMoneyRecordsForDisplay } from "../funding/state-money-reader.ts";
import { fecPersonName } from "./fec-national.ts";
import { moneyQuestionShape, raceWordsFitOffice } from "./money-answer.ts";
import type { StateCampaignFinanceJurisdiction } from "../funding/data-plane.ts";

/** Select a named filing itself. This does not assert that a same-name official
 * or a differently keyed ballot card is the filing's candidate. */
export function selectStateMoneyNames(question: string): string[] {
  const shape = moneyQuestionShape(question);
  const names = shape ? [shape.slot, ...shape.otherSlot ? [shape.otherSlot] : []] : [];
  for (const name of names) if (normalizeName(name).split(" ").length >= 2) {
    currentReaderSelection()?.keys.add(`ask-money-name:${normalizeName(name)}`);
  }
  return names;
}

export function requestedStateMoneySubjects(question: string, states: readonly StateCampaignFinanceJurisdiction[]): (BindableEntity & { officeTitle: string | null })[] {
  const names = selectStateMoneyNames(question);
  if (!names.length) return [];
  const race = moneyQuestionShape(question)?.raceWords;
  const entities = new Map<string, BindableEntity & { officeTitle: string | null }>();
  for (const row of stateMoneyRecordsForDisplay(stateMoneySourceRecords(states))) {
    if (race && !raceWordsFitOffice(race, row.officeSought)) continue;
    const id = row.targetKeys.find(key => key.startsWith("ballot-") && !key.includes("|")) ?? row.targetKeys[0];
    if (id) entities.set(id, { id, name: fecPersonName(row.candidateNameAsFiled), nameClass: "person", divisionType: "person", officeTitle: row.officeSought });
  }
  const selected = new Map<string, BindableEntity & { officeTitle: string | null }>();
  for (const name of names) {
    const binding = bindNamedEntity(name, [...entities.values()]);
    if (binding.kind !== "BOUND") return [];
    selected.set(binding.entity.id, entities.get(binding.entity.id)!);
  }
  return [...selected.values()];
}
