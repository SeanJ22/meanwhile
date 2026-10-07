import { test } from "node:test";
import assert from "node:assert/strict";
import { detectTenancy } from "../lib/hunt/platform-tenancy.ts";
import { foldEntries, newFieldManualEntry } from "../lib/control-plane/field-manual.ts";
import { platformFingerprintEntries } from "../lib/control-plane/platform-fingerprints.ts";

test("a platform added as Bank data is detected on the next saved-page walk", () => {
  const row = newFieldManualEntry("test", "new-platform", { role: "SHARED", kind: "PLATFORM_FINGERPRINT", title: "Portal", summary: "Data fingerprint", outcome: "REFERENCE",
    payload: { id: "new-platform", label: "New platform", hostPattern: "portal\\.example$", haveAdapter: false,
      markup: [{ pattern: "new-platform-assets", why: "portal assets" }] } });
  const store = { entries: foldEntries([...platformFingerprintEntries(), row]) };
  assert.equal(detectTenancy('<a href="https://tenant.portal.example/meetings">Agenda</a>', "https://example.gov", store.entries)[0]!.platform, "new-platform");
  assert.ok(detectTenancy('<script src="new-platform-assets.js"></script>', "https://example.gov", store.entries).some(hit => hit.platform === "new-platform" && hit.strength === "SERVED_BY"));
  assert.equal(detectTenancy('<a href="https://tenant.portal.example/meetings">Agenda</a>', "https://example.gov").length, 0);
});

test("editing an existing fingerprint replaces the pattern without losing other platforms", () => {
  const seeded = platformFingerprintEntries();
  const original = seeded.find(row => row.platforms.includes("legistar"))!;
  const changed = { ...original, payload: { ...(original.payload as object), hostPattern: "other-vendor\\.example$" } };
  assert.ok(!detectTenancy("https://old.legistar.com/", "https://example.gov", [changed]).some(hit => hit.platform === "legistar"));
  assert.ok(detectTenancy("https://new.other-vendor.example/", "https://example.gov", [changed]).some(hit => hit.platform === "legistar"));
  assert.ok(detectTenancy("https://meetings.boardbook.org/", "https://example.gov", [changed]).some(hit => hit.platform === "boardbook"));
  const edited = { ...changed, id: "older-seed-key", observedAt: "2026-10-04T00:00:00Z" };
  assert.ok(detectTenancy("https://new.other-vendor.example/", "https://example.gov", [edited, ...seeded]).some(hit => hit.platform === "legistar"), "a later-in-array seed never erases a dated Bank edit");
});
