/**
 * Party codes a state's own candidate list prints without the party's name, with the
 * name that same state publishes for the code. A code with no published expansion
 * stays a code; nothing here is inferred.
 *
 * FL: Division of Elections candidate list (PartyCode / PartyDesc columns).
 * MT: Secretary of State candidate roster key. NM: Secretary of State party list.
 * NV: Clark County candidate list abbreviations. UT: Lieutenant Governor's candidate list.
 */
const STATE_PARTY_CODES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  FL: { ASP: "American Solidarity Party of Florida", CPF: "Constitution Party of Florida", FFP: "Florida Forward Party",
    LPF: "Libertarian Party of Florida", NOP: "No Party Affiliation (nonpartisan offices)", WRI: "Write-In" },
  MT: { NON: "Non Partisan" },
  NM: { DTS: "No Party/Declined to Select", FWD: "Forward" },
  NV: { LPN: "Libertarian Party of Nevada" },
  UT: { CON: "Constitution Party" },
};

export function statePartyName(state: string | null | undefined, code: string): string | null {
  return (state ? STATE_PARTY_CODES[state]?.[code.trim().toUpperCase()] : undefined) ?? null;
}
