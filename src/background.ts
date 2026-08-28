const exporterPagePorts = new Set<chrome.runtime.Port>();
let activeRun: { runId: string; targetTabId: number | null } | null = null;
let runOperation: Promise<unknown> = Promise.resolve();

chrome.action.onClicked.addListener(async (tab) => {
  const targetTabId = isYahooPlayerListTab(tab) ? String(tab.id) : "";
  const targetQuery = targetTabId ? `?targetTabId=${encodeURIComponent(targetTabId)}` : "";
  await chrome.tabs.create({
    url: chrome.runtime.getURL(`app.html${targetQuery}`)
  });
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "yahoo-player-export-ui") {
    return;
  }

  exporterPagePorts.add(port);
  port.onDisconnect.addListener(() => {
    exporterPagePorts.delete(port);
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void serializeRunOperation(async () => {
    activeRun = activeRun || (await getStoredActiveRun());
    if (activeRun && String(activeRun.targetTabId) === String(tabId)) {
      return releaseRun(activeRun.runId);
    }
    return { ok: true };
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "claimExportRun") {
    void serializeRunOperation(() => claimRun(message.payload)).then(sendResponse);
    return true;
  }

  if (message?.type === "releaseExportRun") {
    void serializeRunOperation(() => releaseRun(message.payload?.runId)).then(sendResponse);
    return true;
  }

  if (message?.type?.startsWith("extraction")) {
    if (message.payload?.runId && ["extractionComplete", "extractionError"].includes(message.type)) {
      void serializeRunOperation(() => releaseRun(message.payload.runId));
    }
    exporterPagePorts.forEach((port) => port.postMessage(message));
  }
});

function serializeRunOperation<T>(operation: () => Promise<T> | T): Promise<T> {
  const result = runOperation.then(operation, operation) as Promise<T>;
  runOperation = result.then(() => undefined, () => undefined);
  return result;
}

async function claimRun(payload: { runId: string; targetTabId: number | null }) {
  activeRun = activeRun || (await getStoredActiveRun());

  if (activeRun && activeRun.runId !== payload.runId) {
    return { ok: false, activeRun };
  }

  activeRun = {
    runId: payload.runId,
    targetTabId: payload.targetTabId
  };
  await chrome.storage.session.set({ activeRun });
  return { ok: true };
}

async function releaseRun(runId?: string) {
  activeRun = activeRun || (await getStoredActiveRun());

  if (!activeRun || activeRun.runId === runId) {
    activeRun = null;
    await chrome.storage.session.remove("activeRun");
  }

  return { ok: true };
}

function isYahooPlayerListTab(tab?: chrome.tabs.Tab): boolean {
  return Boolean(tab?.id && /^https:\/\/.*\.fantasysports\.yahoo\.com\/.*\/players(?:[/?#]|$)/i.test(tab.url || ""));
}

async function getStoredActiveRun(): Promise<{ runId: string; targetTabId: number | null } | null> {
  const stored = await chrome.storage.session.get("activeRun");
  const candidate = stored.activeRun;

  if (
    candidate
    && typeof candidate === "object"
    && ("targetTabId" in candidate)
    && ("runId" in candidate)
    && typeof (candidate as Record<string, unknown>).runId === "string"
  ) {
    return {
      runId: (candidate as Record<string, unknown>).runId as string,
      targetTabId: typeof (candidate as Record<string, unknown>).targetTabId === "number"
        ? ((candidate as Record<string, unknown>).targetTabId as number)
        : null
    };
  }

  return null;
}
