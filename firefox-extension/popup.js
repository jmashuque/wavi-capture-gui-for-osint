"use strict";

const LAST_REQUEST_STORAGE_KEY = "waviLastRequest";
const DEFAULT_LISTENER_PORT = 17654;
const MIN_LISTENER_PORT = 1024;
const MAX_LISTENER_PORT = 65535;

const ENGINE_LABELS = {
  av: "Audio / Video",
  gallery: "Gallery / Profile",
  webpage: "Webpage Capture"
};

const currentUrlElement = document.getElementById("current-url");
const tabHostElement = document.getElementById("tab-host");
const tabBadgeElement = document.getElementById("tab-badge");
const statusElement = document.getElementById("status");
const listenerPortInput = document.getElementById("listener-port");
const savePortButton = document.getElementById("save-port");
const pairingTokenInput = document.getElementById("pairing-token");
const saveTokenButton = document.getElementById("save-token");
const forgetTokenButton = document.getElementById("forget-token");
const managePairingButton = document.getElementById("manage-pairing");
const pairingEditor = document.getElementById("pairing-editor");
const pairingStateElement = document.getElementById("pairing-state");
const pairingDotElement = document.getElementById("pairing-dot");
const extensionVersionElement = document.getElementById("extension-version");
const localEndpointElement = document.getElementById("local-endpoint");
const engineButtons = Array.from(document.querySelectorAll("button[data-engine]"));

let currentUrl = "";
let hasPairingToken = false;
let pairingRejected = false;
let requestInProgress = false;
let pairingEditorManuallyOpened = false;
let activeRequestId = "";
let hasStoredRequestStatus = false;
let currentListenerPort = DEFAULT_LISTENER_PORT;

function setStatus(message, tone = "info") {
  statusElement.textContent = message || "";
  statusElement.className = `status ${tone}`;
}

function setPairingState(message, tone = "neutral") {
  pairingStateElement.textContent = message;
  pairingDotElement.className = `state-dot ${tone}`;
}

function setTabBadge(message, tone = "neutral") {
  tabBadgeElement.textContent = message;
  tabBadgeElement.className = `mini-badge ${tone}`;
}

function setPairingEditorVisible(visible) {
  pairingEditor.hidden = !visible;
  managePairingButton.textContent = visible ? "Close" : "Manage";
}

function isSupportedPageUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch (_error) {
    return false;
  }
}

function getHostLabel(value) {
  try {
    return new URL(value).hostname || value;
  } catch (_error) {
    return value || "Current tab URL is unavailable.";
  }
}

function normalizeToken(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeListenerPort(value) {
  const text = String(value ?? "").trim();
  if (!/^\d{1,5}$/.test(text)) {
    return null;
  }
  const port = Number.parseInt(text, 10);
  if (!Number.isInteger(port) || port < MIN_LISTENER_PORT || port > MAX_LISTENER_PORT) {
    return null;
  }
  return port;
}

function setListenerPortUi(port) {
  const normalized = normalizeListenerPort(port) || DEFAULT_LISTENER_PORT;
  currentListenerPort = normalized;
  listenerPortInput.value = String(normalized);
  localEndpointElement.textContent = `Local connection: 127.0.0.1:${normalized}`;
}

function updateButtonsState() {
  const enabled =
    !requestInProgress &&
    isSupportedPageUrl(currentUrl) &&
    hasPairingToken &&
    !pairingRejected;
  for (const button of engineButtons) {
    button.disabled = !enabled;
  }
  managePairingButton.disabled = requestInProgress;
  savePortButton.disabled = requestInProgress;
  saveTokenButton.disabled = requestInProgress;
  forgetTokenButton.disabled = requestInProgress || !hasPairingToken;
}

function setBusyEngine(engine) {
  for (const button of engineButtons) {
    const action = button.querySelector(".engine-action");
    const isActive = Boolean(engine) && button.dataset.engine === engine;
    button.classList.toggle("is-sending", isActive);
    button.setAttribute("aria-busy", isActive ? "true" : "false");
    if (action) {
      action.textContent = isActive ? "Waiting…" : "Send";
    }
  }
}

function setPairedUi(paired) {
  hasPairingToken = Boolean(paired);
  pairingTokenInput.value = "";
  pairingTokenInput.placeholder = hasPairingToken
    ? "Paste a new token to replace the saved token"
    : "Paste token from WAVI";

  if (!hasPairingToken) {
    pairingRejected = false;
    setPairingState("Pairing required", "warning");
    setPairingEditorVisible(true);
  } else if (!pairingRejected) {
    setPairingState("Token saved", "neutral");
    if (!pairingEditorManuallyOpened) {
      setPairingEditorVisible(false);
    }
  }
  updateButtonsState();
}

function applyRequestResult(result) {
  requestInProgress = false;
  activeRequestId = "";
  setBusyEngine("");

  if (!result || typeof result !== "object") {
    setPairingState("Check WAVI", "warning");
    setStatus("The Firefox background process returned an unreadable result.", "warning");
    updateButtonsState();
    return;
  }

  if (result.ok === true && result.queued === true) {
    pairingRejected = false;
    setPairingState("Connected", "success");
    const engineLabel = ENGINE_LABELS[result.engine] || result.engineLabel || "capture";
    const jobId = typeof result.jobId === "string" ? result.jobId : "";
    setStatus(`Queued in WAVI: ${engineLabel}.${jobId ? ` Job ${jobId}.` : ""}`, "success");
    updateButtonsState();
    return;
  }

  const errorCode = typeof result.error === "string" ? result.error : "";
  const serverMessage = typeof result.message === "string" ? result.message : "";

  if (errorCode === "pairing_required" || errorCode === "authentication_required") {
    pairingRejected = false;
    hasPairingToken = false;
    pairingEditorManuallyOpened = false;
    setPairingEditorVisible(true);
    setPairingState("Pairing required", "warning");
    setStatus("WAVI requires a pairing token. Copy the token from WAVI and save it here.", "warning");
  } else if (errorCode === "authentication_failed") {
    pairingRejected = true;
    pairingEditorManuallyOpened = false;
    setPairingEditorVisible(true);
    setPairingState("Token rejected", "error");
    setStatus("Pairing token rejected. Copy the current token from WAVI and save it again.", "error");
  } else if (errorCode === "invalid_url") {
    setStatus("WAVI rejected this URL.", "error");
  } else if (errorCode === "invalid_engine") {
    setStatus("WAVI rejected the selected capture engine.", "error");
  } else if (errorCode === "handoff_queue_full" || errorCode === "extension_request_busy") {
    setPairingState("WAVI busy", "warning");
    setStatus(serverMessage || "Another WAVI request is still in progress. Try again shortly.", "warning");
  } else if (errorCode === "gui_handoff_timeout" || errorCode === "request_timeout") {
    setPairingState("Check WAVI", "warning");
    setStatus("WAVI did not finish in time. Check its window and Job Queue before retrying.", "warning");
  } else if (errorCode === "job_creation_failed" || errorCode === "job_creation_error") {
    setPairingState("Connected", "success");
    setStatus(serverMessage || "WAVI could not create the queued job. Check the WAVI window for details.", "error");
  } else if (errorCode === "wavi_unreachable") {
    setPairingState("WAVI unavailable", "error");
    setStatus("Unable to reach WAVI. Make sure the Browser Integration API is enabled and the listener port matches WAVI.", "error");
  } else if (errorCode === "storage_error") {
    setPairingState("Extension storage error", "error");
    setStatus(serverMessage || "Firefox could not access the saved WAVI extension state.", "error");
  } else {
    setStatus(serverMessage || "WAVI rejected the request.", "error");
  }
  updateButtonsState();
}

function applyStoredRequest(lastRequest) {
  if (!lastRequest || typeof lastRequest !== "object") {
    return;
  }
  hasStoredRequestStatus = true;
  if (lastRequest.state === "pending") {
    requestInProgress = true;
    activeRequestId = typeof lastRequest.requestId === "string" ? lastRequest.requestId : "";
    const engine = typeof lastRequest.engine === "string" ? lastRequest.engine : "";
    setBusyEngine(engine);
    setStatus(`Waiting for WAVI to queue ${ENGINE_LABELS[engine] || "the capture"}…`, "info");
    updateButtonsState();
    return;
  }
  if (lastRequest.state === "complete" && lastRequest.result) {
    const requestId = typeof lastRequest.requestId === "string" ? lastRequest.requestId : "";
    if (!activeRequestId || !requestId || activeRequestId === requestId || !requestInProgress) {
      applyRequestResult(lastRequest.result);
    }
  }
}

async function loadBackgroundState() {
  try {
    const state = await browser.runtime.sendMessage({ action: "getState" });
    if (!state || state.ok !== true) {
      throw new Error(state && state.message ? state.message : "Unable to read extension state.");
    }
    setListenerPortUi(state.listenerPort);
    setPairedUi(state.paired);
    applyStoredRequest(state.lastRequest);
    if (!state.paired && !state.lastRequest) {
      setStatus("Copy the pairing token from WAVI, paste it here, and save it.", "warning");
    }
  } catch (_error) {
    hasPairingToken = false;
    setPairingState("Extension unavailable", "error");
    setPairingEditorVisible(true);
    setStatus("Unable to communicate with the Firefox background process.", "error");
    updateButtonsState();
  }
}

async function saveListenerPort({ quiet = false } = {}) {
  const port = normalizeListenerPort(listenerPortInput.value);
  if (port === null) {
    if (!quiet) {
      setStatus(`Listener port must be between ${MIN_LISTENER_PORT} and ${MAX_LISTENER_PORT}.`, "warning");
    }
    return false;
  }

  savePortButton.disabled = true;
  try {
    const result = await browser.runtime.sendMessage({ action: "savePort", port });
    if (!result || result.ok !== true) {
      if (!quiet) {
        setStatus((result && result.message) || "Unable to save the WAVI listener port.", "error");
      }
      return false;
    }
    setListenerPortUi(result.listenerPort || port);
    hasStoredRequestStatus = false;
    if (hasPairingToken) {
      pairingRejected = false;
      setPairingState("Token saved", "neutral");
    }
    if (!quiet) {
      setStatus(result.message || `Listener port saved: ${port}.`, "success");
    }
    return true;
  } catch (_error) {
    if (!quiet) {
      setStatus("Unable to save the WAVI listener port in Firefox.", "error");
    }
    return false;
  } finally {
    savePortButton.disabled = false;
    updateButtonsState();
  }
}

async function savePairingToken() {
  const requestedPort = normalizeListenerPort(listenerPortInput.value);
  if (requestedPort === null) {
    setStatus(`Listener port must be between ${MIN_LISTENER_PORT} and ${MAX_LISTENER_PORT}.`, "warning");
    return;
  }
  if (requestedPort !== currentListenerPort) {
    const portSaved = await saveListenerPort({ quiet: true });
    if (!portSaved) {
      setStatus("Save a valid listener port before pairing with WAVI.", "error");
      return;
    }
  }

  const token = normalizeToken(pairingTokenInput.value);
  if (!token) {
    setStatus("Paste the pairing token from WAVI before saving.", "warning");
    return;
  }

  saveTokenButton.disabled = true;
  try {
    const result = await browser.runtime.sendMessage({ action: "saveToken", token });
    if (!result || result.ok !== true) {
      setPairingState("Save failed", "error");
      setStatus((result && result.message) || "Unable to save the WAVI pairing token in Firefox.", "error");
      return;
    }
    pairingRejected = false;
    hasStoredRequestStatus = false;
    pairingEditorManuallyOpened = false;
    setPairedUi(true);
    setPairingState("Connected", "success");
    setStatus((result && result.message) || "Pairing token verified and saved.", "success");
  } catch (_error) {
    setPairingState("Save failed", "error");
    setStatus("Unable to save the WAVI pairing token in Firefox.", "error");
  } finally {
    saveTokenButton.disabled = false;
    updateButtonsState();
  }
}

async function forgetPairingToken() {
  try {
    const result = await browser.runtime.sendMessage({ action: "forgetToken" });
    if (!result || result.ok !== true) {
      setStatus((result && result.message) || "Unable to remove the saved WAVI pairing token.", "error");
      return;
    }
    hasStoredRequestStatus = false;
    pairingEditorManuallyOpened = false;
    setPairedUi(false);
    setStatus("Saved pairing token removed from Firefox.", "warning");
  } catch (_error) {
    setStatus("Unable to remove the saved WAVI pairing token.", "error");
  }
  updateButtonsState();
}

async function loadCurrentTab() {
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    const tabUrl = tab && typeof tab.url === "string" ? tab.url : "";

    currentUrl = tabUrl;
    currentUrlElement.textContent = tabUrl || "Current tab URL is unavailable.";
    currentUrlElement.title = tabUrl;
    tabHostElement.textContent = getHostLabel(tabUrl);

    if (!isSupportedPageUrl(tabUrl)) {
      setTabBadge("Unsupported", "warning");
      setStatus("Only HTTP and HTTPS tabs can be sent to WAVI.", "warning");
    } else {
      setTabBadge("Ready", "ready");
      if (hasPairingToken && !requestInProgress && !pairingRejected && !hasStoredRequestStatus) {
        setStatus("Choose a capture engine to queue this tab in WAVI.", "info");
      }
    }
  } catch (_error) {
    currentUrl = "";
    currentUrlElement.textContent = "Current tab URL is unavailable.";
    currentUrlElement.title = "";
    tabHostElement.textContent = "Current tab unavailable";
    setTabBadge("Unavailable", "warning");
    setStatus("Unable to read the current Firefox tab.", "error");
  }
  updateButtonsState();
}

async function sendToWavi(engine) {
  if (requestInProgress || !isSupportedPageUrl(currentUrl)) {
    return;
  }
  if (!hasPairingToken || pairingRejected) {
    pairingEditorManuallyOpened = false;
    setPairingEditorVisible(true);
    setPairingState(pairingRejected ? "Token rejected" : "Pairing required", pairingRejected ? "error" : "warning");
    setStatus("Pair WAVI first by saving the current token shown in WAVI.", "warning");
    updateButtonsState();
    return;
  }

  requestInProgress = true;
  hasStoredRequestStatus = true;
  activeRequestId = "";
  updateButtonsState();
  setBusyEngine(engine);
  setStatus(`Waiting for WAVI to queue ${ENGINE_LABELS[engine] || "the capture"}…`, "info");

  try {
    const result = await browser.runtime.sendMessage({ action: "queue", url: currentUrl, engine });
    applyRequestResult(result);
  } catch (_error) {
    requestInProgress = false;
    setBusyEngine("");
    setPairingState("Extension unavailable", "error");
    setStatus("Unable to communicate with the Firefox background process.", "error");
    updateButtonsState();
  }
}

managePairingButton.addEventListener("click", () => {
  pairingEditorManuallyOpened = pairingEditor.hidden;
  setPairingEditorVisible(pairingEditorManuallyOpened);
  if (!pairingEditor.hidden) {
    pairingTokenInput.focus();
  }
});

savePortButton.addEventListener("click", () => {
  void saveListenerPort();
});

saveTokenButton.addEventListener("click", () => {
  void savePairingToken();
});

forgetTokenButton.addEventListener("click", () => {
  void forgetPairingToken();
});

listenerPortInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    void saveListenerPort();
  }
});

pairingTokenInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    void savePairingToken();
  }
});

for (const button of engineButtons) {
  button.addEventListener("click", () => {
    void sendToWavi(button.dataset.engine);
  });
}

browser.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes[LAST_REQUEST_STORAGE_KEY]) {
    return;
  }
  const lastRequest = changes[LAST_REQUEST_STORAGE_KEY].newValue;
  if (lastRequest) {
    applyStoredRequest(lastRequest);
  } else {
    hasStoredRequestStatus = false;
  }
});

try {
  const manifest = browser.runtime.getManifest();
  extensionVersionElement.textContent = manifest && manifest.version ? `v${manifest.version}` : "";
} catch (_error) {
  extensionVersionElement.textContent = "";
}

void (async () => {
  await loadBackgroundState();
  await loadCurrentTab();
})();
