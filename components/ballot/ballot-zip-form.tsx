"use client";

import { rememberZipChoice, useSavedZipChoice } from "@/hooks/use-stored-zip";

export function BallotZipForm() {
  const savedZip = useSavedZipChoice();
  return <form action="/ballot" method="get" className="my-6 flex flex-wrap items-end gap-3"
    onSubmit={event => {
      const zip = new FormData(event.currentTarget).get("zip");
      if (typeof zip === "string") rememberZipChoice(zip);
    }}>
    <label className="flex flex-col gap-1" htmlFor="ballot-zip">Your ZIP code
      <input key={savedZip ?? "empty"} id="ballot-zip" name="zip" type="text" inputMode="numeric"
        autoComplete="postal-code" pattern="[0-9]{5}" maxLength={5} required defaultValue={savedZip ?? ""}
        className="rounded border border-[var(--panel-border)] bg-[var(--panel-bg)] px-3 py-2" />
    </label>
    <button type="submit" className="voting-open-button">Show my ballot</button>
  </form>;
}
