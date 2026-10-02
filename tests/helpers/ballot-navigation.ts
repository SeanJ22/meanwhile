import type { PollingPlaceLink } from "../../lib/ballot/polling-place-links.ts";
import type { RegistrationLink } from "../../lib/ballot/registration-links.ts";

/** Synthetic canonical records owned by tests, never a Reader fallback. */
export const POLLING_LINKS: PollingPlaceLink[] = [{
  state: "NY", label: "Find your polling place", url: "https://elections.example.gov/polls",
  sourceOrg: "Test election authority", note: "Search by address.",
  verification: "The saved test authority page links this polling tool.", verifiedAt: "2026-10-01",
}];
export const REGISTRATION_LINKS: RegistrationLink[] = [{
  state: "NY", label: "Check whether you're registered to vote", url: "https://elections.example.gov/registration",
  sourceOrg: "Test election authority", verification: "The saved test authority page links this registration tool.", verifiedAt: "2026-10-01",
}];
