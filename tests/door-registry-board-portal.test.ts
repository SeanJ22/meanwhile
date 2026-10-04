import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { boardPageUrl, boardPortalUrl, parsePastAgendaList, pastAgendaListUrl } from "../lib/sources/clerksboards/index.ts";

describe("DB-18: the board-portal kind takes its portal from the door", () => {
  it("a row without a portal reads the page the adapter was built on", () => {
    assert.equal(boardPageUrl("43"), "https://clerksboards.tucsonaz.gov/boards/?board=43");
    assert.equal(pastAgendaListUrl("43", {}), "https://clerksboards.tucsonaz.gov/boards/?run=pastagenda&board=43");
  });

  it("a row that names a portal reads that portal", () => {
    const config = { boardId: "7", portalUrl: "https://boards.example.invalid/clerk/boards" };
    assert.equal(boardPortalUrl(config), "https://boards.example.invalid/clerk/boards/");
    assert.equal(boardPageUrl("7", config), "https://boards.example.invalid/clerk/boards/?board=7");
    assert.equal(pastAgendaListUrl("7", config), "https://boards.example.invalid/clerk/boards/?run=pastagenda&board=7");
  });

  it("refuses a portal that is not HTTPS", () => {
    assert.throws(() => boardPortalUrl({ portalUrl: "http://boards.example.invalid/" }), /NOT_HTTPS/);
  });

  it("reads agenda links from the document host the door names, and only that host", () => {
    const html = `Past Agendas: <a href="https://docs.example.invalid/a.pdf">Agenda 01-02-26</a> <a href="https://assets.tucsonaz.gov/b.pdf">Agenda 01-09-26</a>`;
    assert.deepEqual(parsePastAgendaList(html, "docs.example.invalid").map((e) => e.pdfUrl), ["https://docs.example.invalid/a.pdf"]);
    assert.deepEqual(parsePastAgendaList(html).map((e) => e.pdfUrl), ["https://assets.tucsonaz.gov/b.pdf"]);
  });
});
