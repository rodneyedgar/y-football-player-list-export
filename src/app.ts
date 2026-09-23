import { serializeDelimited } from "./lib/format";
import type { ExportRow } from "./lib/types";

type RunMode = "visible" | "all-pages";

const state = {
  targetTabId: Number.parseInt(new URLSearchParams(location.search).get("targetTabId") || "", 10) || null,
  activeTabId: null as number | null,
  isYahooTab: false,
  isRunning: false,
  isPaused: false,
  isStopping: false,
  runId: null as string | null,
  headers: [] as string[],
  rows: [] as ExportRow[],
  sourceUrl: "",
  watchdogId: null as number | null,
  progressPort: null as chrome.runtime.Port | null
};

const elements = {
  mainContent: document.getElementById("main-content") as HTMLElement,
  tabSummary: document.getElementById("tab-summary") as HTMLElement,
  liveStatus: document.getElementById("live-status") as HTMLElement,
  progressLog: document.getElementById("progress-log") as HTMLUListElement,
  delayMs: document.getElementById("delay-ms") as HTMLInputElement,
  targetTab: document.getElementById("target-tab") as HTMLSelectElement,
  dedupeRows: document.getElementById("dedupe-rows") as HTMLInputElement,
  showDebug: document.getElementById("show-debug") as HTMLInputElement,
  extractVisible: document.getElementById("extract-visible") as HTMLButtonElement,
  extractAll: document.getElementById("extract-all") as HTMLButtonElement,
  pauseRun: document.getElementById("pause-run") as HTMLButtonElement,
  stopRun: document.getElementById("stop-run") as HTMLButtonElement,
  resetExport: document.getElementById("reset-export") as HTMLButtonElement,
  refreshTargets: document.getElementById("refresh-targets") as HTMLButtonElement,
  downloadCsv: document.getElementById("download-csv") as HTMLButtonElement,
  downloadTsv: document.getElementById("download-tsv") as HTMLButtonElement,
  downloadJson: document.getElementById("download-json") as HTMLButtonElement,
  tableHead: document.querySelector("#results-table thead") as HTMLTableSectionElement,
  tableBody: document.querySelector("#results-table tbody") as HTMLTableSectionElement,
  results: document.getElementById("results") as HTMLElement
};

document.addEventListener("DOMContentLoaded", async () => {
  bindEvents();
  connectProgressPort();
  initializeNewRun();
  await refreshActiveYahooTab();
});

function bindEvents() {
  elements.extractVisible.addEventListener("click", () => startRun("visible"));
  elements.extractAll.addEventListener("click", () => startRun("all-pages"));
  elements.pauseRun.addEventListener("click", togglePause);
  elements.stopRun.addEventListener("click", stopRun);
  elements.resetExport.addEventListener("click", resetExport);
  elements.targetTab.addEventListener("change", selectTargetTab);
  elements.refreshTargets.addEventListener("click", refreshActiveYahooTab);
  elements.downloadCsv.addEventListener("click", () => downloadData("csv"));
  elements.downloadTsv.addEventListener("click", () => downloadData("tsv"));
  elements.downloadJson.addEventListener("click", () => downloadData("json"));
  elements.showDebug.addEventListener("change", toggleDebugDetails);
}

function initializeNewRun() {
  state.headers = [];
  state.rows = [];
  state.sourceUrl = "";
  clearLog();
  renderResults();
}

function toggleDebugDetails() {
  const visible = elements.showDebug.checked;
  elements.tabSummary.hidden = !visible;
  elements.progressLog.hidden = !visible;
  elements.results.hidden = !visible;
}

function connectProgressPort() {
  if (state.progressPort) {
    return;
  }

  const port = chrome.runtime.connect({ name: "yahoo-player-export-ui" });
  state.progressPort = port;
  port.onMessage.addListener(handleExtractionMessage);
  port.onDisconnect.addListener(() => {
    if (state.progressPort !== port) {
      return;
    }

    state.progressPort = null;
    setTimeout(connectProgressPort, 300);
  });
}

function handleExtractionMessage(message: { type?: string; payload?: any }) {
  if (!message?.type) {
    return;
  }

  if (message.type === "extractionProgress") {
    handleProgress(message.payload);
  }

  if (message.type === "extractionComplete") {
    void handleCompletion(message.payload);
  }

  if (message.type === "extractionError") {
    if (message.payload?.runId && message.payload.runId !== state.runId) {
      return;
    }
    handleError(message.payload?.message || "Unknown extraction error.");
  }
}

async function refreshActiveYahooTab() {
  const tabs = await chrome.tabs.query({});
  const yahooTabs = tabs
    .filter(isYahooPlayerListTab)
    .sort((left, right) => {
      const scoreDifference = getYahooTabScore(right) - getYahooTabScore(left);
      return scoreDifference || (right.lastAccessed || 0) - (left.lastAccessed || 0);
    });

  const tab = yahooTabs.find((candidate) => candidate.id === state.targetTabId) || yahooTabs[0];
  state.activeTabId = tab?.id ?? null;
  state.targetTabId = tab?.id ?? null;
  state.isYahooTab = Boolean(tab?.id);
  populateTargetTabs(yahooTabs);

  if (!tabs.length) {
    setTabSummary("No browser tabs were found. Open Yahoo Fantasy in another tab, then return here.", true);
    setControlsEnabled(false);
    return;
  }

  if (!tab?.id) {
    setTabSummary("No Yahoo Fantasy Player List tab was found. Open the list in any Chromium window, then return here.", true);
    setControlsEnabled(false);
    return;
  }

  setTabSummary(`Ready to export from: ${tab.title || tab.url}`, false);
  setControlsEnabled(true);
}

function populateTargetTabs(tabs: chrome.tabs.Tab[]) {
  const previousTargetId = state.targetTabId;
  elements.targetTab.replaceChildren();

  tabs.forEach((tab) => {
    if (!tab.id || !tab.url) {
      return;
    }

    const option = document.createElement("option");
    option.value = String(tab.id);
    option.textContent = describeYahooTab(tab);
    option.selected = tab.id === previousTargetId;
    elements.targetTab.appendChild(option);
  });

  elements.targetTab.disabled = !tabs.length || state.isRunning;
}

async function selectTargetTab() {
  state.targetTabId = Number.parseInt(elements.targetTab.value, 10) || null;
  await refreshActiveYahooTab();
  announce(`Target changed to ${elements.targetTab.selectedOptions[0]?.textContent || "Yahoo Player List"}.`);
}

function describeYahooTab(tab: chrome.tabs.Tab): string {
  const url = new URL(tab.url || "https://football.fantasysports.yahoo.com/");
  const position = url.searchParams.get("pos") || "O";
  const leagueId = url.pathname.split("/").filter(Boolean)[1] || "unknown league";
  return `League ${leagueId} · ${position} · ${tab.title || "Yahoo Player List"}`;
}

async function startRun(mode: RunMode) {
  announce("Looking for a Yahoo Fantasy Player List tab.");
  await refreshActiveYahooTab();
  if (!state.isYahooTab || !state.activeTabId) {
    announce("A Yahoo Fantasy tab is required before extraction can start.", true);
    return;
  }

  state.isRunning = true;
  state.isPaused = false;
  state.isStopping = false;
  state.runId = crypto.randomUUID();
  state.headers = [];
  state.rows = [];
  renderResults();
  syncButtons();
  clearLog();
  clearWatchdog();
  appendLog(`Started ${mode === "visible" ? "visible page" : "all pages"} extraction.`);
  announce(`Starting ${mode === "visible" ? "visible page" : "all pages"} extraction.`);

  try {
    const claim = await chrome.runtime.sendMessage({
      type: "claimExportRun",
      payload: {
        runId: state.runId,
        targetTabId: state.activeTabId
      }
    });
    if (!claim?.ok) {
      throw new Error("Another Yahoo export is already active.");
    }

    const response = await sendToYahooPage({
      type: "startExtraction",
      payload: {
        runId: state.runId,
        mode,
        delayMs: getConfiguredDelay(),
        dedupeRows: elements.dedupeRows.checked
      }
    });

    if (!response?.ok) {
      throw new Error("Yahoo did not accept the extraction request.");
    }

    announce("Connected to Yahoo. Reading visible player rows.");
    appendLog("Connected to the Yahoo page. Reading player rows.");
    state.watchdogId = window.setTimeout(() => {
      if (state.isRunning && state.runId) {
        void requestStop("Yahoo has not returned a player-table update. Stop requested; this Player List remains reserved until Yahoo confirms it has stopped.");
      }
    }, 25000);
  } catch (error) {
    await chrome.runtime.sendMessage({
      type: "releaseExportRun",
      payload: { runId: state.runId }
    });
    state.isRunning = false;
    syncButtons();
    handleError(error instanceof Error && error.message === "Another Yahoo export is already active."
      ? "Another Yahoo export is already running. Finish or reset it before starting a new one."
      : "Unable to start on the Yahoo page. Confirm that the Player List is open, then try again.");
  }
}

async function togglePause() {
  if (!state.isRunning || state.isStopping || !state.activeTabId || !state.runId) {
    return;
  }

  const nextPausedState = !state.isPaused;
  const type = nextPausedState ? "pauseExtraction" : "resumeExtraction";

  await sendToYahooPage({
    type,
    payload: {
      runId: state.runId
    }
  });

  state.isPaused = nextPausedState;
  syncButtons();
  announce(nextPausedState ? "Extraction paused." : "Extraction resumed.");
  appendLog(nextPausedState ? "Paused extraction." : "Resumed extraction.");
}

async function stopRun() {
  await requestStop("Stop requested. Waiting for the current page step to finish.");
}

async function resetExport() {
  const runId = state.runId;
  if (runId && state.activeTabId) {
    try {
      await sendToYahooPage({
        type: "resetExtraction",
        payload: { runId }
      });
    } catch {
      // No-op if the content script is unavailable.
    }
  }

  if (runId) {
    await chrome.runtime.sendMessage({
      type: "releaseExportRun",
      payload: { runId }
    });
  }

  state.isRunning = false;
  state.isPaused = false;
  state.isStopping = false;
  state.runId = null;
  state.headers = [];
  state.rows = [];
  state.sourceUrl = "";
  clearWatchdog();
  clearLog();
  renderResults();
  await refreshActiveYahooTab();
  syncButtons();
  announce("Export reset. Choose the Yahoo Player List you want, then start a new export.");
  appendLog("Reset completed. Ready for a new Yahoo Player List.");
}

function handleProgress(payload: { runId: string; headers?: string[]; rows?: ExportRow[]; sourceUrl?: string; message?: string; pageNumber?: number }) {
  if (payload.runId !== state.runId) {
    return;
  }

  if (payload.headers?.length) {
    state.headers = payload.headers;
  }

  if (Array.isArray(payload.rows)) {
    state.rows = payload.rows;
  }

  if (payload.sourceUrl) {
    state.sourceUrl = payload.sourceUrl;
  }

  renderResults();
  clearWatchdog();

  const statusText = payload.message || `Processed page ${payload.pageNumber || 1}.`;
  announce(statusText);
  appendLog(statusText);
}

async function handleCompletion(payload: { runId: string; headers?: string[]; rows?: ExportRow[]; sourceUrl?: string; pageCount?: number; partial?: boolean; stopped?: boolean }) {
  if (payload.runId !== state.runId) {
    return;
  }

  state.isRunning = false;
  state.isPaused = false;
  state.isStopping = false;
  state.headers = payload.headers || state.headers;
  state.rows = payload.rows || state.rows;
  state.sourceUrl = payload.sourceUrl || state.sourceUrl;
  clearWatchdog();
  syncButtons();
  renderResults();

  const summary = payload.stopped
    ? `Stopped after extracting ${state.rows.length} player records.`
    : payload.partial
      ? `Stopped early after extracting ${state.rows.length} player records because Yahoo did not load the next page.`
      : `Finished. Extracted ${state.rows.length} player records across ${payload.pageCount || 1} page${payload.pageCount === 1 ? "" : "s"}.`;

  announce(summary);
  appendLog(summary);

  if (state.runId) {
    await chrome.runtime.sendMessage({
      type: "releaseExportRun",
      payload: { runId: state.runId }
    });
  }
}

function handleError(message: string) {
  const failedRunId = state.runId;
  state.isRunning = false;
  state.isPaused = false;
  state.isStopping = false;
  clearWatchdog();
  syncButtons();
  if (failedRunId) {
    void chrome.runtime.sendMessage({
      type: "releaseExportRun",
      payload: { runId: failedRunId }
    });
  }
  announce(message, true);
  appendLog(message, true);
}

function getConfiguredDelay(): number {
  const requestedDelay = Number.parseInt(elements.delayMs.value, 10);
  const safeDelay = Number.isFinite(requestedDelay) ? requestedDelay : 1500;
  return Math.min(10000, Math.max(1000, safeDelay));
}

async function requestStop(message: string) {
  if (!state.isRunning || state.isStopping || !state.activeTabId || !state.runId) {
    return;
  }

  state.isStopping = true;
  state.isPaused = false;
  clearWatchdog();
  syncButtons();
  announce(message);
  appendLog(message);

  try {
    await sendToYahooPage({
      type: "stopExtraction",
      payload: { runId: state.runId }
    });
    const stoppingRunId = state.runId;
    state.watchdogId = window.setTimeout(() => {
      void forceResetAfterStopTimeout(stoppingRunId);
    }, 20000);
  } catch {
    handleError("Lost contact with the Yahoo Player List while stopping the export.");
  }
}

async function forceResetAfterStopTimeout(runId: string) {
  if (!state.isRunning || !state.isStopping || state.runId !== runId) {
    return;
  }

  try {
    await sendToYahooPage({
      type: "resetExtraction",
      payload: { runId }
    });
    handleError("Yahoo did not confirm the stop request. The export was reset before allowing another run.");
  } catch {
    handleError("Lost contact with the Yahoo Player List while resetting the stopped export.");
  }
}

function renderResults() {
  const headers = state.headers.length ? state.headers : inferHeaders(state.rows);
  const previewRows = state.rows.slice(0, 100);

  elements.tableHead.innerHTML = "";
  elements.tableBody.innerHTML = "";

  if (!headers.length) {
    toggleDownloads(false);
    return;
  }

  const headerRow = document.createElement("tr");
  headers.forEach((header) => {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = header;
    headerRow.appendChild(th);
  });
  elements.tableHead.appendChild(headerRow);

  previewRows.forEach((row) => {
    const tr = document.createElement("tr");
    headers.forEach((header) => {
      const td = document.createElement("td");
      td.textContent = row[header] ?? "";
      tr.appendChild(td);
    });
    elements.tableBody.appendChild(tr);
  });

  toggleDownloads(state.rows.length > 0);
}

function inferHeaders(rows: ExportRow[]): string[] {
  return rows.length ? Object.keys(rows[0]) : [];
}

function syncButtons() {
  elements.mainContent.setAttribute("aria-busy", String(state.isRunning));
  const canStart = state.isYahooTab && !state.isRunning;
  elements.extractVisible.disabled = !canStart;
  elements.extractAll.disabled = !canStart;
  elements.pauseRun.disabled = !state.isRunning || state.isStopping;
  elements.stopRun.disabled = !state.isRunning || state.isStopping;
  elements.pauseRun.textContent = state.isPaused ? "Resume" : "Pause";
  elements.targetTab.disabled = state.isRunning || !elements.targetTab.options.length;
  elements.refreshTargets.disabled = state.isRunning;
}

function setControlsEnabled(enabled: boolean) {
  if (!state.isRunning) {
    elements.extractVisible.disabled = !enabled;
    elements.extractAll.disabled = !enabled;
  }
}

function toggleDownloads(enabled: boolean) {
  elements.downloadCsv.disabled = !enabled;
  elements.downloadTsv.disabled = !enabled;
  elements.downloadJson.disabled = !enabled;
}

function setTabSummary(text: string, isError: boolean) {
  elements.tabSummary.hidden = false;
  elements.tabSummary.textContent = text;
  elements.tabSummary.classList.toggle("text-danger", isError);
}

async function sendToYahooPage(message: { type: string; payload: Record<string, unknown> }) {
  try {
    return await chrome.tabs.sendMessage(state.activeTabId!, message);
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId: state.activeTabId! },
      files: ["content.js"]
    });
    return chrome.tabs.sendMessage(state.activeTabId!, message);
  }
}

function isYahooFantasyUrl(url = ""): boolean {
  return /^https:\/\/.*\.fantasysports\.yahoo\.com\//i.test(url);
}

function isYahooPlayerListTab(tab?: chrome.tabs.Tab): boolean {
  return Boolean(tab?.id && isYahooFantasyUrl(tab.url) && /\/players(?:[/?#]|$)/i.test(tab.url || ""));
}

function getYahooTabScore(tab: chrome.tabs.Tab): number {
  const url = tab.url || "";
  const title = tab.title || "";
  let score = 0;

  if (/\/players(?:[/?#]|$)/i.test(url)) {
    score += 100;
  }
  if (/\bplayer list\b|\bplayers\b/i.test(title)) {
    score += 25;
  }
  if (/fantasysports\.yahoo\.com/i.test(url)) {
    score += 10;
  }

  return score;
}

function announce(text: string, isError = false) {
  elements.liveStatus.setAttribute("aria-live", isError ? "assertive" : "polite");
  elements.liveStatus.textContent = text;
  elements.liveStatus.classList.toggle("text-danger", isError);
}

function appendLog(text: string, isError = false) {
  const item = document.createElement("li");
  item.textContent = `${new Date().toLocaleTimeString()}: ${text}`;
  if (isError) {
    item.classList.add("text-danger");
  }
  elements.progressLog.prepend(item);
}

function clearLog() {
  elements.progressLog.innerHTML = "";
}

function clearWatchdog() {
  if (state.watchdogId) {
    clearTimeout(state.watchdogId);
    state.watchdogId = null;
  }
}

async function downloadData(format: "csv" | "tsv" | "json") {
  const headers = state.headers.length ? state.headers : inferHeaders(state.rows);
  if (!headers.length || !state.rows.length) {
    announce("There is no data to download yet.", true);
    return;
  }

  const fileBase = `yahoo-fantasy-export-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  let blob: Blob;
  let extension: string;

  if (format === "json") {
    blob = new Blob([JSON.stringify(state.rows, null, 2)], { type: "application/json" });
    extension = "json";
  } else {
    const delimiter = format === "tsv" ? "\t" : ",";
    const mimeType = format === "tsv" ? "text/tab-separated-values" : "text/csv";
    blob = new Blob([serializeDelimited(headers, state.rows, delimiter)], { type: mimeType });
    extension = format;
  }

  const url = URL.createObjectURL(blob);
  await chrome.downloads.download({
    url,
    filename: `${fileBase}.${extension}`,
    saveAs: true
  });
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
