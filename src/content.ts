import { extractLinkedPlayerRows, extractTableData, getPositionProfile, normalizeCellText } from "./lib/parser";
import type { ExtractedData, ExportRow } from "./lib/types";

const extractionState = {
  runId: null as string | null,
  running: false,
  paused: false,
  stopRequested: false,
  runToken: 0
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message?.type) {
    return;
  }

  if (message.type === "startExtraction") {
    if (extractionState.running) {
      notifyError("An extraction is already in progress.", message.payload?.runId);
      sendResponse({ ok: false });
      return true;
    }

    const runToken = ++extractionState.runToken;
    extractionState.runId = message.payload.runId;
    extractionState.running = true;
    extractionState.paused = false;
    extractionState.stopRequested = false;

    void runExtraction(message.payload, runToken)
      .catch((error: Error) => {
        if (isRunActive(message.payload.runId, runToken)) {
          notifyError(error.message || "Unexpected extraction failure.", message.payload.runId);
        }
      })
      .finally(() => {
        if (isRunActive(message.payload.runId, runToken)) {
          extractionState.running = false;
          extractionState.paused = false;
          extractionState.stopRequested = false;
        }
      });

    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "pauseExtraction" && message.payload?.runId === extractionState.runId) {
    extractionState.paused = true;
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "resumeExtraction" && message.payload?.runId === extractionState.runId) {
    extractionState.paused = false;
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "stopExtraction" && message.payload?.runId === extractionState.runId) {
    extractionState.stopRequested = true;
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "resetExtraction" && message.payload?.runId === extractionState.runId) {
    extractionState.runToken += 1;
    extractionState.runId = null;
    extractionState.running = false;
    extractionState.paused = false;
    extractionState.stopRequested = true;
    sendResponse({ ok: true });
    return true;
  }
});

async function runExtraction(
  payload: { runId: string; mode: "visible" | "all-pages"; delayMs: number; dedupeRows: boolean },
  runToken: number
) {
  const pageDelayMs = Math.min(10000, Math.max(1000, Number(payload.delayMs) || 1500));
  const allRows: ExportRow[] = [];
  const rowFingerprints = new Set<string>();
  const pageSignatures = new Set<string>();
  let headers: string[] = [];
  let pageCount = 0;

  const diagnostics = getTableDiagnostics();
  notifyProgress({
    runId: payload.runId,
    headers: [],
    rows: [],
    sourceUrl: location.href,
    pageNumber: 0,
    message: `Searching the Yahoo page: found ${diagnostics.visibleTables} visible table${diagnostics.visibleTables === 1 ? "" : "s"}, ${diagnostics.playerTables} player-table candidate${diagnostics.playerTables === 1 ? "" : "s"}, and ${diagnostics.playerRows} linked player row${diagnostics.playerRows === 1 ? "" : "s"}.`
  });

  while (isRunActive(payload.runId, runToken)) {
    await waitWhilePaused(payload.runId, runToken);
    if (!isRunActive(payload.runId, runToken) || extractionState.stopRequested) {
      break;
    }

    const source = await waitForPlayerListSource(payload.runId, runToken);
    if (!source || !isRunActive(payload.runId, runToken)) {
      return;
    }

    const previousSignature = getSourceSignature(source);
    if (pageSignatures.has(previousSignature)) {
      notifyComplete({
        runId: payload.runId,
        headers,
        rows: allRows,
        pageCount,
        partial: true,
        sourceUrl: location.href
      });
      return;
    }

    pageSignatures.add(previousSignature);

    const extracted = source.type === "table"
      ? extractTableData(source.table, location.href)
      : extractLinkedPlayerRows(document, location.href);

    headers = extracted.headers;
    pageCount += 1;

    for (const row of extracted.rows) {
      const fingerprint = row.player_id ? `player:${row.player_id}` : JSON.stringify(row);
      if (!payload.dedupeRows || !rowFingerprints.has(fingerprint)) {
        rowFingerprints.add(fingerprint);
        allRows.push(row);
      }
    }

    notifyProgress({
      runId: payload.runId,
      headers,
      rows: allRows,
      sourceUrl: location.href,
      pageNumber: pageCount,
      message: `Captured page ${pageCount} with ${extracted.rows.length} visible rows. Running total: ${allRows.length}.`
    });

    if (payload.mode !== "all-pages") {
      break;
    }

    const nextControl = findNextControl();
    if (!nextControl || isNextDisabled(nextControl)) {
      notifyProgress({
        runId: payload.runId,
        headers,
        rows: allRows,
        sourceUrl: location.href,
        pageNumber: pageCount,
        message: "No additional Yahoo page was available. Exporting the rows collected so far."
      });
      break;
    }

    notifyProgress({
      runId: payload.runId,
      headers,
      rows: allRows,
      sourceUrl: location.href,
      pageNumber: pageCount,
      message: `Moving from page ${pageCount} to the next Yahoo player page.`
    });

    nextControl.click();
    await waitForDelay(pageDelayMs);
    const pageChanged = await waitForTableChange(previousSignature, payload.runId, runToken);
    if (!pageChanged) {
      notifyComplete({
        runId: payload.runId,
        headers,
        rows: allRows,
        pageCount,
        partial: true,
        sourceUrl: location.href
      });
      return;
    }
  }

  if (!isRunActive(payload.runId, runToken)) {
    return;
  }

  notifyComplete({
    runId: payload.runId,
    headers,
    rows: allRows,
    pageCount,
    stopped: extractionState.stopRequested,
    sourceUrl: location.href
  });
}

function findPlayerListSource() {
  const table = findPlayerTable();
  if (table) {
    return { type: "table" as const, table };
  }

  const profile = getPositionProfile(location.href);
  const links = Array.from(document.querySelectorAll("a")).filter((link) => {
    const href = (link as HTMLAnchorElement).href || "";
    return profile.isDefense ? /\/nfl\/teams\//i.test(href) : /\/(?:player|nfl\/players)\//i.test(href);
  });

  return links.length ? { type: "linked-player-rows" as const } : null;
}

function findPlayerTable(): HTMLTableElement | null {
  const tables = Array.from(document.querySelectorAll("table")).filter((table) => isVisible(table));
  const candidates = tables
    .map((table) => ({ table, score: getPlayerTableScore(table) }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score);

  return candidates[0]?.table || null;
}

function getTableDiagnostics() {
  const visibleTables = Array.from(document.querySelectorAll("table")).filter((table) => isVisible(table));
  const playerTables = visibleTables.filter((table) => getPlayerTableScore(table) > 0);
  const extracted = extractLinkedPlayerRows(document, location.href);

  return {
    visibleTables: visibleTables.length,
    playerTables: playerTables.length,
    playerRows: extracted.rows.length
  };
}

function getPlayerTableScore(table: HTMLTableElement): number {
  const headerText = normalizeCellText(Array.from(table.querySelectorAll("th")).map((cell) => cell.textContent || "").join(" "));
  const rowCount = Array.from(table.querySelectorAll("tr"))
    .filter((row) => isVisible(row) && row.querySelectorAll("td").length)
    .length;

  if (!/\bplayer\b/i.test(headerText) || rowCount === 0) {
    return 0;
  }

  let score = rowCount;
  if (/\b(fan pts|fpts|bye|rostered|rank|status|opponent)\b/i.test(headerText)) {
    score += 100;
  }
  if (table.querySelector('a[href*="/player/"], a[href*="/nfl/players/"]')) {
    score += 200;
  }

  return score;
}

function findNextControl(): HTMLElement | null {
  const playerPageLink = findYahooPlayerPageLink();
  if (playerPageLink) {
    return playerPageLink;
  }

  const paginationRoot = findPlayerListPaginationRoot();
  if (!paginationRoot) {
    return null;
  }

  return findNextControlIn(paginationRoot);
}

function findNextControlIn(root: ParentNode): HTMLElement | null {
  const selectors = [
    'button[aria-label*="Next" i]',
    'a[aria-label*="Next" i]',
    'button[title*="Next" i]',
    'a[title*="Next" i]',
    'a[rel="next"]',
    '[data-test-id*="next" i]',
    '[data-testid*="next" i]',
    '[data-tst*="next" i]',
    '.Next a',
    '.next a',
    '[class*="next" i] button',
    '[class*="next" i] a'
  ];

  for (const selector of selectors) {
    const found = Array.from(root.querySelectorAll<HTMLElement>(selector)).find((element) => isVisible(element));
    if (found) {
      return found;
    }
  }

  return Array.from(root.querySelectorAll<HTMLElement>("button, a, [role=button]")).find((element) => {
    const text = normalizeCellText(element.textContent || "");
    const label = normalizeCellText(element.getAttribute("aria-label") || "");
    return isVisible(element) && (/\bnext\b/i.test(text) || /\b(next|forward)\b/i.test(label));
  }) || null;
}

function findYahooPlayerPageLink(): HTMLAnchorElement | null {
  const currentUrl = new URL(location.href);
  const currentOffset = Number.parseInt(currentUrl.searchParams.get("count") || "0", 10) || 0;

  const pageLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"))
    .map((link) => {
      const url = new URL(link.href, location.href);
      const offset = Number.parseInt(url.searchParams.get("count") || "", 10);
      return { link, url, offset };
    })
    .filter(({ link, url, offset }) => {
      return isVisible(link)
        && url.origin === currentUrl.origin
        && url.pathname === currentUrl.pathname
        && Number.isFinite(offset)
        && offset > currentOffset
        && hasMatchingPlayerListFilters(currentUrl, url);
    })
    .sort((left, right) => left.offset - right.offset);

  return pageLinks[0]?.link || null;
}

function hasMatchingPlayerListFilters(currentUrl: URL, candidateUrl: URL): boolean {
  const filterKeys = ["status", "eteam", "fteam", "pos", "cut_type", "stat1", "myteam", "sort", "sdir"];
  return filterKeys.every((key) => {
    return !currentUrl.searchParams.has(key)
      || currentUrl.searchParams.get(key) === candidateUrl.searchParams.get(key);
  });
}

function findPlayerListPaginationRoot(): HTMLElement | null {
  const currentUrl = new URL(location.href);
  const roots = Array.from(document.querySelectorAll<HTMLElement>('nav, [role="navigation"], [aria-label*="pagination" i], [class*="pagination" i]'))
    .filter((root) => isVisible(root));

  return roots.find((root) => Array.from(root.querySelectorAll<HTMLAnchorElement>("a[href]")).some((link) => {
    const url = new URL(link.href, location.href);
    return url.origin === currentUrl.origin
      && url.pathname === currentUrl.pathname
      && url.searchParams.has("count")
      && hasMatchingPlayerListFilters(currentUrl, url);
  })) || null;
}

function isNextDisabled(element: HTMLElement): boolean {
  return element.hasAttribute("disabled")
    || element.getAttribute("aria-disabled") === "true"
    || element.classList.contains("disabled")
    || Boolean(element.closest('[aria-disabled="true"]'));
}

async function waitForPlayerListSource(runId: string, runToken: number, timeoutMs = 15000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (!isRunActive(runId, runToken) || extractionState.stopRequested) {
      return null;
    }

    const source = findPlayerListSource();
    if (source) {
      return source;
    }

    await waitForDelay(250);
  }

  throw new Error("No player rows were found. Open Yahoo Fantasy's Players page with player rows visible, then try again.");
}

async function waitForTableChange(previousSignature: string, runId: string, runToken: number, timeoutMs = 15000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    await waitWhilePaused(runId, runToken);
    if (!isRunActive(runId, runToken) || extractionState.stopRequested) {
      return false;
    }

    const source = findPlayerListSource();
    if (source) {
      const nextSignature = getSourceSignature(source);
      if (nextSignature && nextSignature !== previousSignature) {
        return true;
      }
    }

    await waitForDelay(300);
  }

  return false;
}

function getSourceSignature(source: { type: "table"; table: HTMLTableElement } | { type: "linked-player-rows" }) {
  const root = source.type === "table" ? source.table : document;
  const profile = getPositionProfile(location.href);
  const selector = profile.isDefense ? 'a[href*="/nfl/teams/"]' : 'a[href*="/player/"], a[href*="/nfl/players/"]';
  const entityPaths = Array.from(root.querySelectorAll<HTMLAnchorElement>(selector))
    .map((link) => new URL(link.href).pathname)
    .filter((path, index, paths) => paths.indexOf(path) === index)
    .slice(0, 5);
  const pageOffset = new URL(location.href).searchParams.get("count") || "0";
  return `${pageOffset}|${entityPaths.join("|")}`;
}

async function waitWhilePaused(runId: string, runToken: number) {
  while (isRunActive(runId, runToken) && extractionState.paused && !extractionState.stopRequested) {
    await waitForDelay(250);
  }
}

function isRunActive(runId: string, runToken: number): boolean {
  return extractionState.running
    && extractionState.runId === runId
    && extractionState.runToken === runToken;
}

function waitForDelay(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function notifyProgress(payload: { runId: string; headers: string[]; rows: ExportRow[]; sourceUrl: string; pageNumber: number; message: string }) {
  chrome.runtime.sendMessage({
    type: "extractionProgress",
    payload
  });
}

function notifyComplete(payload: {
  runId: string;
  headers: string[];
  rows: ExportRow[];
  pageCount: number;
  partial?: boolean;
  stopped?: boolean;
  sourceUrl: string;
}) {
  chrome.runtime.sendMessage({
    type: "extractionComplete",
    payload
  });
}

function notifyError(message: string, runId = extractionState.runId) {
  chrome.runtime.sendMessage({
    type: "extractionError",
    payload: {
      message,
      runId
    }
  });
}

function isVisible(element: Element | null): boolean {
  return Boolean(element && (element as HTMLElement).getClientRects().length);
}
