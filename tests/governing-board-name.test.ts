import assert from "node:assert/strict";
import test from "node:test";
import { governingBoardName, isGoverningBoardName, type GoverningContext } from "../lib/civic-data/governing-board-name.ts";

const AUTAUGA: GoverningContext = { name: "County of Autauga", county: true };
const city = (place: string): GoverningContext => ({ name: `City of ${place}` });
const school = (name: string): GoverningContext => ({ name, school: true });

test("a governing board is caught by any common name, with its place and without what a page hangs on it", () => {
  const cases: readonly (readonly [string, GoverningContext, string])[] = [
    ["Autauga County Commission", AUTAUGA, "Autauga County Commission"],
    ["County Commission", AUTAUGA, "County Commission"],
    ["Commission", AUTAUGA, "Commission"],
    ["Request to Address the Commission", AUTAUGA, "Commission"],
    ["Board of County Commissioners", { name: "Pike County", county: true }, "Board of County Commissioners"],
    ["Mayor and Council", city("Brundidge"), "Mayor and Council"],
    ["Mayor and City Council", city("Decatur"), "Mayor and City Council"],
    ["Mayor and Town Council", city("Dauphin Island"), "Mayor and Town Council"],
    ["Mayor and Board of Aldermen", city("Example"), "Mayor and Board of Aldermen"],
    ["Assembly", { name: "City and Borough of Sitka", county: true }, "Assembly"],
    ["Juneau Assembly", { name: "City and Borough of Juneau", county: true }, "Juneau Assembly"],
    ["Borough Assembly", { name: "Borough of Lake and Peninsula", county: true }, "Borough Assembly"],
    ["Board of Aldermen", city("Example"), "Board of Aldermen"],
    ["Board of Supervisors", { name: "County of Greenlee", county: true }, "Board of Supervisors"],
    ["Board of Selectmen", city("Example"), "Board of Selectmen"],
    ["Select Board", city("Example"), "Select Board"],
    ["Board of Chosen Freeholders", { name: "County of Example", county: true }, "Board of Chosen Freeholders"],
    ["Fiscal Court", { name: "County of Example", county: true }, "Fiscal Court"],
    ["Quorum Court", { name: "County of Example", county: true }, "Quorum Court"],
    ["Police Jury", { name: "Parish of Example", county: true }, "Police Jury"],
    ["Commissioners Court", { name: "County of Example", county: true }, "Commissioners Court"],
    ["Village Board", city("Example"), "Village Board"],
    ["Common Council", city("Example"), "Common Council"],
    ["Weaver City Council", city("Weaver"), "Weaver City Council"],
    ["Chatom Town Council", { name: "Town of Chatom" }, "Chatom Town Council"],
    ["The Fort Smith Board of Directors", city("Fort Smith"), "Fort Smith Board of Directors"],
    ["Board of Directors", { name: "Anniston Water Works and Sewer Board", special: true }, "Board of Directors"],
    ["Eufaula Housing Authority Board of Commissioners", { name: "Eufaula Housing Authority", special: true }, "Eufaula Housing Authority Board of Commissioners"],
    ["Board of Education", school("Huntsville City School District"), "Board of Education"],
    ["Board of Education Home", school("Huntsville City School District"), "Board of Education"],
    ["Our Governing Board", school("Kayenta Unified School District"), "Governing Board"],
    ["Our Board", school("Morgan County School District"), "Board"],
    ["The Board", school("Example School District"), "Board"],
    ["Education Board", school("Salt River Elementary"), "Education Board"],
    ["Conecuh County Board of Education", school("Conecuh County School District"), "Conecuh County Board of Education"],
    ["Gadsden City Board of Education", school("Gadsden City School District"), "Gadsden City Board of Education"],
    ["Bismarck School District School Board", school("Bismarck School District"), "Bismarck School District School Board"],
    ["Tucson Unified Governing Board", school("Tucson Unified School District"), "Tucson Unified Governing Board"],
    ["Cotter School Board", school("Cotter School District"), "Cotter School Board"],
    ["School Committee", city("Example"), "School Committee"],
    ["Notice of Board of Education Possible Quorum", school("Ketchikan Gateway Borough School District"), "Board of Education"],
    ["FY25 Budget Presentation to the Board of Education", school("Ketchikan Gateway Borough School District"), "Board of Education"],
    ["Personal Code of Conduct for Members of the City Council", city("Bell"), "City Council"],
    ["Function of the Tallapoosa County Commission", { name: "County of Tallapoosa", county: true }, "Tallapoosa County Commission"],
    ["Tips on Doing Business with Montgomery County Commission", { name: "County of Montgomery", county: true }, "Montgomery County Commission"],
    ["Council Members", city("Example"), "Council"],
    ["ALAMOGORDO COMMISSION", { name: "City Of Alamogordo" }, "ALAMOGORDO COMMISSION"],
    ["Bismarck School District School Board", school("Bismarck Sch Dist"), "Bismarck School District School Board"],
    ["City Council", {}, "City Council"],
    ["Council", {}, "Council"],
  ];
  for (const [name, context, shown] of cases) assert.equal(governingBoardName(name, context), shown, name);
});

test("a committee, commission or board of something else is not the governing board", () => {
  const none: readonly (readonly [string, GoverningContext])[] = [
    ["Planning Commission", AUTAUGA], ["Planning and Zoning Commission", city("Cordova")], ["Board of Equalization", AUTAUGA], ["Board of Zoning Adjustments", city("Hueytown")],
    ["Student Council", school("Example School District")], ["Site Council", school("Example School District")], ["Montevallo Junior City Council", city("Montevallo")],
    ["Library Board", city("Hueytown")], ["Personnel Board", city("Montevallo")], ["Advisory Board", school("Example School District")], ["Parent Committee", school("Example School District")],
    ["Alabama Ethics Commission", city("Oneonta")], ["Higher Learning Commission (HLC)", school("Example School District")], ["Bay Conservation and Development Commission", city("Benicia")],
    ["Police Accountability Board", city("Berkeley")], ["Commission on Disability", city("Berkeley")], ["Zero Waste Commission", city("Berkeley")], ["Design Review Committee", city("Berkeley")],
    ["Bulletin Board", school("Example School District")], ["Industrial Development Board", city("Hueytown")],
    ["Parks and Recreation Board", city("Hueytown")], ["Utilities Board", city("Andalusia")], ["Municipal Court", city("Example")], ["County Court", AUTAUGA], ["General Assembly", AUTAUGA],
    ["Board of Education and Borough Assembly Joint Work Session", school("Ketchikan Gateway Borough School District")], ["CCMC Hospital Services Board", city("Cordova")],
    ["Morgan County Commission", { name: "Port Authority of Decatur", special: true }], ["Commission", city("Example")], ["Board", city("Example")],
    ["Housing Advisory Commission", city("Berkeley")], ["Youth Commission", city("Berkeley")], ["Senior Citizens Council", city("Example")],
  ];
  for (const [name, context] of none) assert.equal(isGoverningBoardName(name, context), false, name);
});

// Names as the production Box carries them today (AK, AL, AR, AZ, CA, CO), government names as registered.
type Real = readonly [name: string, government: string, kind: "city" | "county" | "school" | "special"];
const flags = (government: string, kind: Real[2]): GoverningContext => ({ name: government, school: kind === "school", special: kind === "special", county: kind === "county" });

test("real governing boards under other names are caught, in every state, and real committees are not", () => {
  const governing: readonly Real[] = [
    ["assembly", "City And Borough Of Sitka", "county"], ["borough assembly", "Borough Of Lake And Peninsula", "county"], ["assembly", "Borough Of Northwest Arctic", "county"],
    ["mayor and council", "City Of Brundidge", "city"], ["mayor and city council", "City Of Decatur", "city"], ["decatur city council", "City Of Decatur", "city"], ["troy city council", "City Of Troy", "city"],
    ["chatom town council", "Town Of Chatom", "city"], ["mayor and town council", "Town Of Dauphin Island", "city"], ["mayor and council", "City Of Calexico", "city"], ["mayor and city council", "City Of Black Hawk", "city"],
    ["glenwood springs city council", "City Of Glenwood Springs", "city"], ["autauga county commission", "County Of Autauga", "county"], ["cullman county commission", "County Of Cullman", "county"],
    ["request to address the commission", "County Of Randolph", "county"], ["function of the tallapoosa county commission", "County Of Tallapoosa", "county"],
    ["joint statement from the montgomery county commission", "County Of Montgomery", "county"], ["conecuh county board of education", "Conecuh County School District", "school"],
    ["board of education home", "Guntersville City School District", "school"], ["hale county board", "Hale County School District", "school"], ["our board", "Morgan County School District", "school"],
    ["our school board", "Lake And Peninsula Borough Schools", "school"], ["school board of education", "Scottsboro City School District", "school"], ["bismarck school district school board", "Bismarck Sch Dist", "school"],
    ["cabot school board", "Cabot School District", "school"], ["tucson unified governing board", "Tucson Unified District", "school"], ["our governing board", "Kayenta Unified School District", "school"],
    ["notice of board of education possible quorum", "Kodiak Island Borough School District", "school"], ["submit your questions to the sisd board of education", "Southeast Island School District", "school"],
    ["education board", "Salt River Elementary School", "school"], ["board of directors", "Mobile Airport Authority", "special"], ["board of directors", "Anniston Water Works And Sewer Board", "special"],
    ["board of directors", "Greene County Conservation District", "special"], ["cws board of directors", "Community Water System Public Water Authority", "special"],
    ["board of commissioners vbha", "Van Buren City Housing Authority", "special"], ["eufaula housing authority board of commissioners", "Eufaula Housing Authority", "special"],
    ["the fort smith board of directors", "City Of Fort Smith", "city"], ["board of directors", "City Of Hot Springs", "city"], ["current board", "Calhoun County 9-1-1 District", "special"],
  ];
  for (const [name, government, kind] of governing) assert.ok(isGoverningBoardName(name, flags(government, kind)), `${name} (${government})`);
  const committees: readonly Real[] = [
    ["planning and zoning commission", "City Of Cordova", "city"], ["planning commission", "City Of Talladega", "city"], ["library board", "City Of Hueytown", "city"], ["industrial development board", "City Of Jasper", "city"],
    ["board of zoning adjustments", "City Of Millbrook", "city"], ["personnel board", "City Of Montevallo", "city"], ["montevallo junior city council", "City Of Montevallo", "city"], ["alabama ethics commission", "City Of Oneonta", "city"],
    ["advisory council", "City Of Montgomery", "city"], ["youth commission", "City Of Berkeley", "city"], ["commission on aging", "City Of Berkeley", "city"], ["police accountability board", "City Of Berkeley", "city"],
    ["oversight board", "City Of Calexico", "city"], ["camarillo council on aging", "City Of Camarillo", "city"], ["ward 3 needs you on the city council", "City Of Holiday Island", "city"],
    ["board of equalization", "County Of Montgomery", "county"], ["board of registrars", "County Of Bullock", "county"], ["colbert county board of registrars", "County Of Colbert", "county"], ["special tax board", "County Of Tuscaloosa", "county"],
    ["morgan county commission", "Decatur-Morgan County Port Authority", "special"], ["rural morgan county industrial development board", "Decatur-Morgan County Port Authority", "special"],
    ["board of commissioners oha", "Van Buren City Housing Authority", "special"], ["patient family advisory council", "Huntsville Health Care Authority", "special"], ["tribal intergovernmental advisory committee", "Brinkley City Housing Authority", "special"],
    ["student council", "Strong-Huttig School District", "school"], ["site council", "Edkey Inc. - Redwood Academy", "school"], ["parent committee", "Madison County School District", "school"], ["advisory board", "Mount Edgecumbe High School Agency", "school"],
    ["community bulletin board", "Madison County School District", "school"], ["higher learning commission hlc", "Ark Tech Univeristy Career Center", "school"], ["board of visitors", "East Arkansas Career Center", "school"],
    ["board of education and borough assembly joint work session", "Kodiak Island Borough School District", "school"], ["employee benefit trust board", "Sunnyside Unified District", "school"],
  ];
  for (const [name, government, kind] of committees) assert.equal(isGoverningBoardName(name, flags(government, kind)), false, `${name} (${government})`);
});
