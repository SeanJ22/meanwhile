/** Canonical complete publisher-shaped roster fixtures shared by parser and dispatched-runtime checks. */
function azRow(input: {
  chamber: "House" | "Senate";
  personId: number;
  district: number;
  name: string;
  inactive?: string;
}): string {
  const handle = input.name.replace(/[^A-Za-z]/g, "").toUpperCase();
  return `<tr class="${input.inactive ? "inactive" : ""}">
    <td><a href="https://www.azleg.gov/${input.chamber}/${input.chamber}-member/?legislature=57&session=130&legislator=${input.personId}" class="roster-tooltip">${input.name}<strong></strong><span></span></a></td>
    <td><a href="https://www.azleg.gov/images/LegislativeDistrictMaps/LegislativeDistrict${String(input.district).padStart(2, "0")}.pdf">${input.district}</a></td>
    <td><span title="${input.district % 2 ? "Republican" : "Democratic"}">${input.district % 2 ? "R" : "D"}</span></td>
    <td>${input.inactive ?? `<a href="https://www.azleg.gov/emailazleg/?legislatorId=${input.personId}">Email: ${handle}</a>`}</td>
    <td>${input.inactive ? "" : "Room 101"}</td><td>${input.inactive ? "" : "(602) 926-1234"}</td>
  </tr>`;
}

export function azFixture(): string {
  const house = Array.from({ length: 30 }, (_, district) => [
    azRow({ chamber: "House", personId: 1000 + district * 2 + 1, district: district + 1, name: `House One ${district + 1}` }),
    azRow({ chamber: "House", personId: 1000 + district * 2 + 2, district: district + 1, name: `House Two ${district + 1}` }),
  ]).flat();
  house.splice(5, 0,
    azRow({ chamber: "House", personId: 2299, district: 3, name: "Joseph Chaplik", inactive: "Resigned on 3/2 to run for Congress" }),
    azRow({ chamber: "House", personId: 2321, district: 7, name: "David Marshall, Sr.", inactive: "Resigned on 4/17 with no reason given" }),
  );
  const senate = Array.from({ length: 30 }, (_, district) =>
    azRow({ chamber: "Senate", personId: 2001 + district, district: district + 1, name: `Senate Member ${district + 1}` })
  );
  senate.splice(9, 0, azRow({ chamber: "Senate", personId: 2374, district: 9, name: "Eva Burch", inactive: "Resigned 03/14/2025" }));
  return `<html><table id="HouseRoster"><thead><tr><th>Legislator</th></tr></thead>${house.join("\n")}</table><table id="SenateRoster">${senate.join("\n")}</table></html>`;
}

export function njFixture(): string {
  const senate = Array.from({ length: 40 }, (_, district) => ({
    Full_Name: `Senator${district + 1}, Sample`, DisplayName: `Senator${district + 1}, Sample`,
    LegTitle: "Senator ", RosterHouseCode: "S", Roster_House: "Senate", Roster_District: district + 1,
    Party: district % 2 ? "D" : "R", PartyDescription: district % 2 ? "Democrat" : "Republican", Suffix: null,
    BioLink: `/legislative-roster/${300 + district}/senator-sample-${district + 1}`,
    Last_Name: `Senator${district + 1}`, First_Name: "Sample", Middle_Name: null, VacantSort: 0,
    ContactLink: `https://nj-${String(district + 1).padStart(2, "0")}-senate.web.fireside21.app/forms/writeyourrep/`,
  }));
  const assembly = Array.from({ length: 40 }, (_, district) => [0, 1].map((seat) => ({
    Full_Name: `Assembly${district + 1}${seat + 1}, Sample`, DisplayName: `Assembly${district + 1}${seat + 1}, Sample`,
    LegTitle: seat === 0 ? "Assemblyman " : "Assemblywoman ", RosterHouseCode: "A", Roster_House: "Assembly", Roster_District: district + 1,
    Party: district % 2 ? "D" : "R", PartyDescription: district % 2 ? "Democrat" : "Republican", Suffix: null,
    BioLink: `/legislative-roster/${400 + district * 2 + seat}/${seat === 0 ? "assemblyman" : "assemblywoman"}-sample-${district + 1}-${seat + 1}${district === 5 && seat === 0 ? "-jr." : ""}`,
    Last_Name: `Assembly${district + 1}${seat + 1}`, First_Name: "Sample", Middle_Name: null, VacantSort: 0,
    ContactLink: `https://nj-${String(district + 1).padStart(2, "0")}-assembly.web.fireside21.app/forms/writeyourrep/`,
  }))).flat();
  return `<html><footer>©<!-- -->2026<!-- --> New Jersey Office of Legislative Services</footer><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: { pageProps: { legrosterData: [[...senate, ...assembly], [], []] } },
    page: "/legislative-roster", query: {}, isFallback: false,
  })}</script></html>`;
}
