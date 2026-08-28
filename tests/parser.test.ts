import { readFileSync } from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { buildHeaderKeys, extractLinkedPlayerRows, extractTableData } from "../src/lib/parser";

function loadFixture(name: string, url: string) {
  const fixturePath = path.join(process.cwd(), "fixtures", name);
  const html = readFileSync(fixturePath, "utf8");
  const dom = new JSDOM(html, { url });
  Object.defineProperty(dom.window.HTMLElement.prototype, "getClientRects", {
    configurable: true,
    value() {
      return [{ width: 960, height: 48 }];
    }
  });
  Object.defineProperty(dom.window.HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value() {
      return {
        width: 960,
        height: 48,
        top: 0,
        left: 0,
        right: 960,
        bottom: 48,
        x: 0,
        y: 0,
        toJSON() {
          return this;
        }
      };
    }
  });
  return dom.window.document;
}

describe("parser", () => {
  it("builds grouped headers for Yahoo-style tables", () => {
    const document = loadFixture(
      "yahoo-player-list-offense.html",
      "https://football.fantasysports.yahoo.com/f1/12345/players?pos=O"
    );
    const table = document.querySelector("table");

    expect(table).not.toBeNull();
    expect(buildHeaderKeys(table as HTMLTableElement)).toEqual([
      "player",
      "gp",
      "bye",
      "fan_pts",
      "passing_yds",
      "passing_td",
      "passing_int",
      "rushing_att",
      "rushing_yds",
      "rushing_td"
    ]);
  });

  it("extracts table rows with player metadata", () => {
    const locationHref = "https://football.fantasysports.yahoo.com/f1/12345/players?pos=O";
    const document = loadFixture("yahoo-player-list-offense.html", locationHref);
    const table = document.querySelector("table") as HTMLTableElement;

    const result = extractTableData(table, locationHref, "2026-08-28T12:00:00.000Z");

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      player_name: "Jordan Lake",
      player_id: "30123",
      source_url: locationHref,
      extracted_at: "2026-08-28T12:00:00.000Z"
    });
  });

  it("extracts kicker rows from non-table Yahoo layouts", () => {
    const locationHref = "https://football.fantasysports.yahoo.com/f1/12345/players?pos=K";
    const document = loadFixture("yahoo-player-list-kicker.html", locationHref);

    const result = extractLinkedPlayerRows(document, locationHref, "2026-08-28T12:00:00.000Z");

    expect(result.rows).toHaveLength(2);
    expect(result.headers).toContain("field_goals_made_40_49");
    expect(result.rows[0]).toMatchObject({
      player_name: "Avery Stone",
      player_id: "8888",
      team: "ATL",
      position: "K",
      matchup: "@ CAR",
      field_goals_made_50_plus: "4",
      pat_made: "37"
    });
  });
});
