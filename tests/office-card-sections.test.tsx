import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PersonCard } from "../components/ui/person-card.tsx";
import { officeCardSections, officeFamily, officeHasActions } from "../lib/officials/office-sections.ts";

const COUNTRY = "ocd-division/country:us";
const president = { id: "white-house:donald-trump", officeTitle: "President of the United States", officeJurisdictionOcdId: COUNTRY };
const vicePresident = { id: "white-house:jd-vance", officeTitle: "Vice President of the United States", officeJurisdictionOcdId: COUNTRY };
const secretary = { id: "white-house:marco-rubio", officeTitle: "Secretary of State", officeJurisdictionOcdId: COUNTRY };
const statewideSecretary = { id: "statewide:az/secretary-of-state", officeTitle: "Secretary of State", officeJurisdictionOcdId: "ocd-division/country:us/state:az" };

const gapLine = (holder: Parameters<typeof officeCardSections>[0]) => {
  const html = renderToStaticMarkup(<PersonCard title="Person" identity={<p>Person</p>} contact={<p>Contact</p>}
    sectionIds={officeCardSections(holder)} sections={{}} subject={{ type: "CANDIDATE", id: holder.id }} />);
  return /Still gathering: ([^<]*?)\./.exec(html)?.[1] ?? "";
};

test("the President and Vice President have no voting record, committees or offices near you", () => {
  for (const holder of [president, vicePresident]) {
    assert.equal(officeFamily(holder), "president");
    const gap = gapLine(holder);
    assert.doesNotMatch(gap, /voting record|committees|offices near you|confirmation/);
    assert.match(gap, /what this office does/);
    assert.match(gap, /campaign money/);
  }
});

test("a Cabinet secretary has a department, a confirmation and official actions, and nothing else to gather", () => {
  assert.equal(officeFamily(secretary), "cabinet");
  assert.deepEqual(officeCardSections(secretary), ["office", "confirmation", "sources"]);
  assert.equal(gapLine(secretary), "what this office does, confirmation");
  assert.equal(officeHasActions(secretary), true);
});

test("a state's Secretary of State is a state executive, not a Cabinet secretary", () => {
  assert.equal(officeFamily(statewideSecretary), "executive");
  assert.equal(officeFamily({ id: "x", officeTitle: "Secretary of State" }), "executive");
});

test("governors, mayors and sheriffs have no voting record, committees or offices near you", () => {
  for (const officeTitle of ["Governor", "Mayor", "County Sheriff", "Attorney General", "Lieutenant Governor", "County Clerk"]) {
    const holder = { id: `local:${officeTitle}`, officeTitle };
    assert.equal(officeFamily(holder), "executive", officeTitle);
    assert.doesNotMatch(gapLine(holder), /voting record|committees|offices near you|confirmation/, officeTitle);
  }
});

test("every legislative office keeps voting record, committees and offices near you", () => {
  for (const [id, officeTitle] of [["congress:S000001", "U.S. Senator"], ["congress:H000001", "U.S. Representative"], ["plural:az-1", "State Senator"],
    ["plural:az-2", "State Representative"], ["local:1", "City Council"], ["local:2", "County Commissioner"], ["local:3", "Board of Education"]]) {
    const holder = { id, officeTitle };
    assert.equal(officeFamily(holder), "legislative", officeTitle);
    assert.match(gapLine(holder), /committees, offices near you, campaign money, voting record/, officeTitle);
    assert.equal(officeHasActions(holder), false, officeTitle);
  }
});

test("an office this guide cannot classify keeps the usual seven, so 'still gathering' is never hidden by a guess", () => {
  const holder = { id: "local:judge", officeTitle: "Municipal Court Judge" };
  assert.equal(officeFamily(holder), "other");
  assert.deepEqual(officeCardSections(holder), ["office", "positions", "committees", "offices", "money", "record", "sources"]);
});

test("a card without sectionIds keeps its usual seven sections and no confirmation", () => {
  const html = renderToStaticMarkup(<PersonCard title="Person" identity={<p>Person</p>} contact={<p>c</p>} sections={{}} subject={{ type: "CANDIDATE", id: "x" }} />);
  assert.match(html, /Still gathering: what this office does, positions, committees, offices near you, campaign money, voting record\./);
});

test("a held section for a Cabinet office still renders when its data arrives", () => {
  const html = renderToStaticMarkup(<PersonCard title="Person" identity={<p>Person</p>} contact={<p>c</p>} sectionIds={officeCardSections(secretary)}
    sections={{ office: <p>Runs the department</p>, confirmation: <p>Confirmed 53–47</p> }} subject={{ type: "CANDIDATE", id: secretary.id }} />);
  assert.doesNotMatch(html, /Still gathering/);
  assert.ok(html.indexOf("Runs the department") < html.indexOf("Confirmed 53"));
  assert.match(html, /Confirmation/);
});
