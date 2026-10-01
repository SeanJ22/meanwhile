import assert from "node:assert/strict";
import { test } from "node:test";
import { projectPublicationStatus } from "../lib/civic-data/publication-status.ts";
import { PUBLICATION_EXCEPTION_LIMIT, publicationView } from "../lib/control-plane/admin-view/v6-publication-read.ts";

const contract = (n: number, projection: unknown | null = {}) => ({ id: `meetings%3Ax${n}`, sourceId: `s${n}`, recordClass: "MEETING", scope: `scope-${n}`, readerProjection: projection });
const promoted = (n: number, at: string) => ({ key: `k${n}`, sourceId: `s${n}`, recordClass: "MEETING", scope: `scope-${n}`, currentVersionId: `v${n}`, promotedAt: at });

test("every contract is counted and only the ones a reader cannot see are listed, most recently promoted first", () => {
  const view = projectPublicationStatus([contract(1), contract(2), contract(3, null), contract(4)],
    { promotions: [promoted(1, "2026-09-30T10:00:00.000Z"), promoted(2, "2026-09-30T12:00:00.000Z"), promoted(3, "2026-09-30T11:00:00.000Z")], latestAttempts: [], readbacks: [] });
  const out = publicationView(view);
  assert.equal(out.total, 4);
  assert.equal(out.counts.reduce((n, c) => n + c.count, 0), 4, "the counts cover every contract");
  assert.deepEqual(out.notVisible.map((r) => r.contract), ["meetings:x2", "meetings:x1", "meetings:x4"], "the contract id is decoded for reading, newest promotion first, never-published last");
  assert.equal(out.notVisible[2].verdict, "NOT_PUBLISHED");
  assert.equal(out.notVisible[2].publishedAt, null);
});

test("a long list of unseen contracts is bounded and says how many are not shown", () => {
  const many = Array.from({ length: PUBLICATION_EXCEPTION_LIMIT + 7 }, (_, i) => contract(i));
  const out = publicationView(projectPublicationStatus(many, { promotions: [], latestAttempts: [], readbacks: [] }));
  assert.equal(out.notVisible.length, PUBLICATION_EXCEPTION_LIMIT);
  assert.equal(out.notVisibleHidden, 7);
  assert.equal(out.counts.find((c) => c.verdict === "NOT_PUBLISHED")?.count, PUBLICATION_EXCEPTION_LIMIT + 7);
});
