import { createHash } from "node:crypto";
import type { Page } from "playwright";
import type { PublicPageRead } from "./served-reader-collector.ts";

type Candidate = { readonly id: string; readonly candidateName: string };
/** Inspect only real controls. An absent candidate must not consume action and cleanup timeouts. */
export async function observeCampaignControls(page: Page, records: readonly Candidate[]): Promise<Pick<PublicPageRead, "openedLinks" | "failures">> {
  const openedLinks: NonNullable<PublicPageRead["openedLinks"]>[number][] = [];
  const failures: NonNullable<PublicPageRead["failures"]>[number][] = [];
  let cleanupFailed = false;
  for (const record of records) {
    if (cleanupFailed) {
      failures.push({ readerKey: record.id, reason: "Public readback not attempted: the previous candidate panel could not close. Repair reader controls before retrying this page." });
      continue;
    }
    const candidate = page.locator(`[data-candidate-target=${JSON.stringify(record.id)}]`);
    let phase = "locating the exact candidate";
    const dialog = page.getByRole("dialog", { name: record.candidateName, exact: true });
    try {
      const count = await candidate.count();
      if (count !== 1) {
        failures.push({ readerKey: record.id, reason: count === 0
          ? "Published record retained, but this exact candidate is absent from the current public ballot. Reconcile the current certified lineup before changing reader eligibility."
          : "Multiple public cards match this exact candidate. Repair the ambiguous reader identity before confirming delivery." });
        continue;
      }
      phase = "opening View Battlecard";
      await candidate.getByRole("button", { name: "View Battlecard", exact: true }).click();
      phase = "opening Sources in the exact candidate panel";
      await dialog.getByRole("button", { name: "Sources", exact: true }).click();
      phase = "reading the visible campaign link";
      const link = dialog.getByRole("link", { name: "campaign site", exact: true });
      if (await link.isVisible()) {
        const href = await link.getAttribute("href");
        if (href) openedLinks.push({ readerKey: record.id, href, domSha256: createHash("sha256").update(await dialog.evaluate(el => el.outerHTML)).digest("hex") });
        else failures.push({ readerKey: record.id, reason: "Campaign link is visible but has no destination. Repair the publication-to-reader connection." });
      } else failures.push({ readerKey: record.id, reason: "Candidate Battlecard and Sources opened, but the campaign link is absent. Publication-to-reader connection requires repair." });
    } catch {
      // Do not serialize browser exception text: it can contain page content or environment details.
      failures.push({ readerKey: record.id, reason: `Public readback failed while ${phase}. Repair this reader action; stored publication alone does not confirm delivery.` });
    } finally {
      // count()/isVisible() do not wait for a nonexistent Close button. Scope cleanup to this candidate.
      try {
        if (await dialog.count() > 0 && await dialog.isVisible()) {
          await dialog.getByRole("button", { name: "Close", exact: true }).click();
        }
      } catch {
        cleanupFailed = true;
        failures.push({ readerKey: record.id, reason: "The exact candidate panel could not close. Remaining controls on this page were not attempted." });
      }
    }
  }
  return { openedLinks, failures };
}
