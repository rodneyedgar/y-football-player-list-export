import type { ExtractedData, ExportRow, PositionProfile } from "./types";

export const OFFENSE_GRID_COLUMNS = [
  "player",
  "roster_status",
  "gp",
  "bye",
  "fan_pts",
  "preseason_rank",
  "actual_rank",
  "percent_rostered",
  "passing_yards",
  "passing_touchdowns",
  "interceptions",
  "rushing_attempts",
  "rushing_yards",
  "rushing_touchdowns",
  "targets",
  "receptions",
  "receiving_yards",
  "receiving_touchdowns",
  "return_touchdowns",
  "two_point_conversions",
  "lost_fumbles"
];

export const OFFENSE_EXPORT_HEADERS = [
  "player_name",
  "player_id",
  "team",
  "position",
  "matchup",
  "roster_status",
  "gp",
  "bye",
  "fan_pts",
  "preseason_rank",
  "actual_rank",
  "percent_rostered",
  "passing_yards",
  "passing_touchdowns",
  "interceptions",
  "rushing_attempts",
  "rushing_yards",
  "rushing_touchdowns",
  "targets",
  "receptions",
  "receiving_yards",
  "receiving_touchdowns",
  "return_touchdowns",
  "two_point_conversions",
  "lost_fumbles",
  "stat_column_22",
  "extracted_at"
];

export const KICKER_GRID_COLUMNS = [
  "player",
  "roster_status",
  "gp",
  "bye",
  "fan_pts",
  "preseason_rank",
  "actual_rank",
  "percent_rostered",
  "field_goals_made_0_19",
  "field_goals_made_20_29",
  "field_goals_made_30_39",
  "field_goals_made_40_49",
  "field_goals_made_50_plus",
  "pat_made"
];

export const KICKER_EXPORT_HEADERS = [
  "player_name",
  "player_id",
  "team",
  "position",
  "matchup",
  "roster_status",
  "gp",
  "bye",
  "fan_pts",
  "preseason_rank",
  "actual_rank",
  "percent_rostered",
  "field_goals_made_0_19",
  "field_goals_made_20_29",
  "field_goals_made_30_39",
  "field_goals_made_40_49",
  "field_goals_made_50_plus",
  "pat_made",
  "extracted_at"
];

export const DEFENSE_GRID_COLUMNS = [
  "player",
  "roster_status",
  "gp",
  "bye",
  "fan_pts",
  "preseason_rank",
  "actual_rank",
  "percent_rostered",
  "points_allowed",
  "sacks",
  "safeties",
  "interceptions",
  "fumble_recoveries",
  "defensive_touchdowns",
  "blocked_kicks",
  "return_touchdowns"
];

export const DEFENSE_EXPORT_HEADERS = [
  "player_name",
  "player_id",
  "team",
  "position",
  "matchup",
  "roster_status",
  "gp",
  "bye",
  "fan_pts",
  "preseason_rank",
  "actual_rank",
  "percent_rostered",
  "points_allowed",
  "sacks",
  "safeties",
  "interceptions",
  "fumble_recoveries",
  "defensive_touchdowns",
  "blocked_kicks",
  "return_touchdowns",
  "extracted_at"
];

export function extractTableData(
  table: HTMLTableElement,
  locationHref: string,
  extractedAt = new Date().toISOString()
): ExtractedData {
  const headers = buildHeaderKeys(table);
  const bodyRows = Array.from(table.querySelectorAll("tbody tr, tr"))
    .filter((row, index, rows) => rows.indexOf(row) === index)
    .filter((row) => isVisible(row) && row.querySelectorAll("td").length);

  const rows = bodyRows.map((row, index) => {
    const cells = Array.from(row.querySelectorAll("td"));
    const record: ExportRow = {};

    headers.forEach((header, cellIndex) => {
      record[header] = normalizeCellText(cells[cellIndex]?.textContent || "");
    });

    const playerLink = row.querySelector<HTMLAnchorElement>('a[href*="/player/"], a[href*="/nfl/players/"]');
    if (playerLink) {
      record.player_name = normalizeCellText(playerLink.textContent || record.player_name || "");
      record.player_url = playerLink.href;
      record.player_id = extractPlayerId(playerLink.href);
    }

    record.row_index = String(index + 1);
    record.source_url = locationHref;
    record.extracted_at = extractedAt;

    return record;
  });

  return {
    headers: mergeHeaders(headers, rows),
    rows
  };
}

export function extractLinkedPlayerRows(
  root: ParentNode,
  locationHref: string,
  extractedAt = new Date().toISOString()
): ExtractedData {
  const profile = getPositionProfile(locationHref);
  const rows = findLinkedPlayerRows(root, profile).map((row) => {
    const playerLink = getEntityLinks(row, profile)[0];
    const playerUrl = playerLink?.href || "";
    const cells = getGridCells(row, profile);
    const rawRecord: ExportRow = {};

    cells.forEach((cell, cellIndex) => {
      rawRecord[profile.gridColumns[cellIndex] || `stat_column_${cellIndex + 1}`] = normalizeCellText(cell.textContent || "");
    });

    const normalizedRecord = profile.isDefense
      ? normalizeDefenseGridRecord(rawRecord, profile.gridColumns)
      : rawRecord;
    return buildPositionExportRecord(profile, normalizedRecord, playerLink, playerUrl, extractedAt);
  });

  return {
    headers: profile.exportHeaders,
    rows
  };
}

export function getPositionProfile(locationHref: string): PositionProfile {
  const position = new URL(locationHref).searchParams.get("pos")?.toUpperCase();

  if (position === "K") {
    return {
      gridColumns: KICKER_GRID_COLUMNS,
      exportHeaders: KICKER_EXPORT_HEADERS,
      isDefense: false
    };
  }

  if (position === "DEF" || position === "D") {
    return {
      gridColumns: DEFENSE_GRID_COLUMNS,
      exportHeaders: DEFENSE_EXPORT_HEADERS,
      isDefense: true
    };
  }

  return {
    gridColumns: OFFENSE_GRID_COLUMNS,
    exportHeaders: OFFENSE_EXPORT_HEADERS,
    isDefense: false
  };
}

export function buildHeaderKeys(table: HTMLTableElement): string[] {
  const headerRows = getHeaderRows(table);
  if (!headerRows.length) {
    return Array.from(table.querySelectorAll("tbody tr:first-child td")).map((_, index) => `column_${index + 1}`);
  }

  const matrix: string[][] = [];
  let maxColumns = 0;

  headerRows.forEach((row, rowIndex) => {
    matrix[rowIndex] = matrix[rowIndex] || [];
    let columnIndex = 0;

    Array.from(row.children).forEach((cell) => {
      while (matrix[rowIndex][columnIndex]) {
        columnIndex += 1;
      }

      const label = normalizeCellText(cell.textContent || "");
      const colspan = parseInt(cell.getAttribute("colspan") || "1", 10);
      const rowspan = parseInt(cell.getAttribute("rowspan") || "1", 10);

      for (let y = 0; y < rowspan; y += 1) {
        const targetRow = rowIndex + y;
        matrix[targetRow] = matrix[targetRow] || [];
        for (let x = 0; x < colspan; x += 1) {
          matrix[targetRow][columnIndex + x] = label;
        }
      }

      columnIndex += colspan;
      maxColumns = Math.max(maxColumns, columnIndex);
    });
  });

  const keys: string[] = [];
  for (let column = 0; column < maxColumns; column += 1) {
    const parts: string[] = [];
    for (let row = 0; row < matrix.length; row += 1) {
      const label = matrix[row]?.[column];
      if (label && parts[parts.length - 1] !== label) {
        parts.push(label);
      }
    }

    const slug = slugify(parts.join(" "));
    keys.push(slug || `column_${column + 1}`);
  }

  return keys;
}

export function normalizeCellText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/%/g, " percent ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function extractPlayerId(url: string): string {
  const match = url.match(/players?\/(\d+)/i);
  return match ? match[1] : "";
}

function getHeaderRows(table: HTMLTableElement): HTMLTableRowElement[] {
  const theadRows = Array.from(table.querySelectorAll("thead tr"))
    .filter((row): row is HTMLTableRowElement => row.querySelectorAll("th").length > 0);

  if (theadRows.length) {
    return theadRows;
  }

  return Array.from(table.querySelectorAll("tr"))
    .filter((row): row is HTMLTableRowElement => row.querySelectorAll("th").length > 0)
    .slice(0, 3);
}

function mergeHeaders(headers: string[], rows: ExportRow[]): string[] {
  const allHeaders = new Set(headers);
  rows.forEach((row) => {
    Object.keys(row).forEach((key) => allHeaders.add(key));
  });
  return Array.from(allHeaders);
}

function findLinkedPlayerRows(root: ParentNode, profile: PositionProfile): HTMLElement[] {
  const rows = getEntityLinks(root, profile)
    .map((link) => findPlayerRowContainer(link, profile))
    .filter((row): row is HTMLElement => Boolean(row && isVisible(row)));

  return Array.from(new Set(rows));
}

function findPlayerRowContainer(link: HTMLAnchorElement, profile: PositionProfile): HTMLElement | null {
  let bestMatch: HTMLElement | null = link.parentElement;
  let current = link.parentElement;
  const body = link.ownerDocument.body;

  while (current && current !== body) {
    const rect = current.getBoundingClientRect();
    const playerCount = getUniqueEntityCount(current, profile);

    if (playerCount > 1) {
      break;
    }

    if (playerCount === 1 && rect.width >= 500 && rect.height >= 40 && rect.height <= 400) {
      bestMatch = current;
    }

    current = current.parentElement;
  }

  return bestMatch;
}

function getUniqueEntityCount(root: ParentNode, profile: PositionProfile): number {
  const targets = getEntityLinks(root, profile)
    .map((link) => new URL(link.href).pathname);
  return new Set(targets).size;
}

function getPlayerLinks(root: ParentNode): HTMLAnchorElement[] {
  return Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href*="/player/"], a[href*="/nfl/players/"]'))
    .filter((link) => isVisible(link));
}

function getPrimaryPlayerLinks(root: ParentNode): HTMLAnchorElement[] {
  return getPlayerLinks(root).filter((link) => /\/nfl\/players\/\d+\/?$/i.test(link.href) || /\/player\/\d+\/?$/i.test(link.href));
}

function getDefenseLinks(root: ParentNode): HTMLAnchorElement[] {
  return Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href*="/nfl/teams/"]'))
    .filter((link) => isVisible(link) && /\/nfl\/teams\/[^/]+\/?$/i.test(new URL(link.href).pathname));
}

function getEntityLinks(root: ParentNode, profile: PositionProfile): HTMLAnchorElement[] {
  return profile.isDefense ? getDefenseLinks(root) : getPrimaryPlayerLinks(root);
}

function getGridCells(row: HTMLElement, profile: PositionProfile): HTMLElement[] {
  const cells = Array.from(row.children).filter((cell): cell is HTMLElement => {
    const element = cell as HTMLElement;
    const rect = element.getBoundingClientRect();
    return isVisible(element) && rect.width > 0 && rect.height > 0;
  });

  if (cells.length < 3) {
    return [row];
  }

  const playerCellIndex = cells.findIndex((cell) => getEntityLinks(cell, profile).length > 0);
  return playerCellIndex >= 0 ? cells.slice(playerCellIndex) : cells;
}

function normalizeDefenseGridRecord(rawRecord: ExportRow, gridColumns: string[]): ExportRow {
  const teamMarker = rawRecord.roster_status || "";
  if (!/\b[A-Za-z]{2,3}\s*-\s*DEF\b/i.test(teamMarker)) {
    return rawRecord;
  }

  const normalizedRecord: ExportRow = {
    player: `${rawRecord.player || ""} ${teamMarker}`.trim()
  };
  for (let index = 1; index < gridColumns.length; index += 1) {
    normalizedRecord[gridColumns[index]] = rawRecord[gridColumns[index + 1]] || "";
  }

  return normalizedRecord;
}

function buildPositionExportRecord(
  profile: PositionProfile,
  rawRecord: ExportRow,
  playerLink: HTMLAnchorElement | undefined,
  playerUrl: string,
  extractedAt: string
): ExportRow {
  const playerName = normalizeCellText(playerLink?.textContent || "");
  const details = parsePlayerDetails(rawRecord.player || "", playerName);
  const record: ExportRow = {
    player_name: playerName,
    player_id: extractEntityId(playerUrl, profile),
    team: details.team,
    position: details.position,
    matchup: details.matchup
  };

  profile.exportHeaders.slice(5).forEach((header) => {
    record[header] = header === "extracted_at" ? extractedAt : (rawRecord[header] || "");
  });

  return record;
}

function parsePlayerDetails(playerText: string, playerName: string) {
  const noteText = normalizeCellText(playerText)
    .replace(playerName, "")
    .replace(/video\s*forecast|player\s*note|no new player notes?/gi, " ")
    .trim();
  const match = noteText.match(/\b([A-Za-z]{2,3})\s*-\s*(QB|RB|WR|TE|K|DEF)\b\s*(.*)$/i);

  return {
    team: match?.[1] || "",
    position: match?.[2]?.toUpperCase() || "",
    matchup: normalizeCellText(match?.[3] || "")
  };
}

function extractEntityId(url: string, profile: PositionProfile): string {
  const playerId = extractPlayerId(url);
  if (playerId || !profile.isDefense) {
    return playerId;
  }

  const teamSlug = new URL(url).pathname.split("/").filter(Boolean).pop() || "";
  return teamSlug ? `def_${teamSlug}` : "";
}

function isVisible(element: Element | null): boolean {
  if (!element) {
    return false;
  }

  const node = element as HTMLElement;
  if (typeof node.getClientRects === "function" && node.getClientRects().length > 0) {
    return true;
  }

  return !node.hasAttribute("hidden");
}
