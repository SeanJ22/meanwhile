import type { OwnerAssignmentRow, OwnerAssignmentRows } from "./owner-assignment-rows.ts";
import type { AggregateRepository } from "./types.ts";
import type { StateTotals } from "../owner-snapshot-totals.ts";

/** Local fixture stores keep the same assignment boundaries as Postgres. */
export function storedOwnerAssignmentRows(store: AggregateRepository<OwnerAssignmentRow | null>, stateTotals: AggregateRepository<StateTotals>): OwnerAssignmentRows {
  const values = async () => (await store.list()).flatMap(row => row.value ? [row.value] : []);
  const write = async (id: string, value: OwnerAssignmentRow | null, now: string) => {
    const prior = await store.read(id);
    if (prior) await store.compareAndSet(id, prior.revision, value, now);
    else await store.put(id, value, now);
  };
  return {
    async read(ids) {
      const rows = store.readMany ? await store.readMany(ids) : (await Promise.all(ids.map(id => store.read(id)))).filter(row => row !== null);
      return rows.flatMap(row => row.value ? [row.value] : []).sort((a, b) => a.id.localeCompare(b.id));
    },
    async find(input) {
      const members = new Set(input.members), clauses = new Set(input.clauses);
      return (await values()).filter(row => row.group.members.some(id => members.has(id)) ||
        (row.group.clause !== null && clauses.has(row.group.clause)) ||
        (input.dueAt !== undefined && row.nextAt !== null && row.nextAt <= input.dueAt));
    },
    async save(rows, removed, states = []) {
      const now = rows[0]?.builtAt ?? new Date().toISOString();
      for (const id of removed) await write(id, null, now);
      for (const row of rows) await write(row.id, row, row.builtAt);
      for (const state of states) {
        if (state.expectedRevision === null) await stateTotals.put(state.id, state.value, state.value.builtAt);
        else await stateTotals.compareAndSet(state.id, state.expectedRevision, state.value, state.value.builtAt);
      }
    },
    async scopeMembers(identities) {
      const out = new Map<string,string[]>();
      for (const row of await values()) for (const mark of row.group.obligation?.assignments ?? []) {
        if (!identities.some(identity => identity.key === mark.assignmentKey && identity.ref === mark.ref)) continue;
        const key = `${mark.assignmentKey}\n${mark.ref}`;
        out.set(key,[...(out.get(key) ?? []),row.group.obligation!.subjectId]);
      }
      return out;
    },
    async publications(readbackOnly = false) {
      const items = (await values()).flatMap(row => row.group.publications);
      return items.filter(item => !readbackOnly || (item.publicationOutcome?.status !== 'HELD' && (
        ['official-filings','comment-access','everyday-routing','ballot-navigation'].includes(item.autonomousPlan?.publication?.contractId ?? '') ||
        (/^registry-runtime:[A-Z]{2}$/.test(item.autonomousPlan?.publication?.contractId ?? '') && item.autonomousPlan?.contract?.recordClass === 'OFFICIAL_ROSTER'))))
        .sort((a,b) => a.id.localeCompare(b.id));
    },
    async clear() {
      for (const row of await values()) await write(row.id, null, row.builtAt);
    },
  };
}
