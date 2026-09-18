"use strict";

const WAVI_HOST = "127.0.0.1";
const DEFAULT_LISTENER_PORT = 17654;
const MIN_LISTENER_PORT = 1024;
const MAX_LISTENER_PORT = 65535;
const WAVI_QUEUE_PATH = "/api/v1/queue";
const WAVI_AUTH_VERIFY_PATH = "/api/v1/auth/verify";
const REQUEST_TIMEOUT_MS = 135000;
const AUTH_VERIFY_TIMEOUT_MS = 10000;
const TOKEN_STORAGE_KEY = "waviPairingToken";
const PORT_STORAGE_KEY = "waviListenerPort";
const LAST_REQUEST_STORAGE_KEY = "waviLastRequest";
const VALID_ENGINES = new Set(["av", "gallery", "webpage"]);
const MAX_URL_LENGTH = 8192;

let activeRequestPromise = null;
let activeRequestId = "";

function normalizeToken(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isValidToken(value) {
  return /^[A-Za-z0-9_-]{20,256}$/.test(value);
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

function buildWaviUrl(port, path) {
  return `http://${WAVI_HOST}:${port}${path}`;
}

function isSupportedPageUrl(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_URL_LENGTH) {
    return false;
  }
  if (/\s|\\/.test(value)) {
    return false;
  }
  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      Boolean(parsed.hostname) &&
      !parsed.username &&
      !parsed.password
    );
  } catch (_error) {
    return false;
  }
}

function newRequestId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

function messageHasOnlyKeys(message, allowedKeys) {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return false;
  }
  const keys = Object.keys(message).sort();
  const expected = Array.from(allowedKeys).sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

async function getStoredToken() {
  const stored = await browser.storage.local.get(TOKEN_STORAGE_KEY);
  return normalizeToken(stored[TOKEN_STORAGE_KEY]);
}

async function getStoredPort() {
  const stored = await browser.storage.local.get(PORT_STORAGE_KEY);
  return normalizeListenerPort(stored[PORT_STORAGE_KEY]) || DEFAULT_LISTENER_PORT;
}

async function getLastRequest() {
  const stored = await browser.storage.local.get(LAST_REQUEST_STORAGE_KEY);
  const value = stored[LAST_REQUEST_STORAGE_KEY];
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

async function setLastRequest(value) {
  await browser.storage.local.set({ [LAST_REQUEST_STORAGE_KEY]: value });
}

async function clearLastRequest() {
  await browser.storage.local.remove(LAST_REQUEST_STORAGE_KEY);
}

function normalizeServerResult(response, payload, engine, requestId) {
  if (response.ok && payload && payload.ok === true && payload.queued === true) {
    return {
      ok: true,
      queued: true,
      engine,
      engineLabel: typeof payload.engine_label === "string" ? payload.engine_label : "",
      jobId: typeof payload.job_id === "string" ? payload.job_id : "",
      message: typeof payload.message === "string" ? payload.message : "Queued in WAVI.",
      requestId
    };
  }

  return {
    ok: false,
    queued: false,
    engine,
    error: payload && typeof payload.error === "string" ? payload.error : "request_rejected",
    message: payload && typeof payload.message === "string" ? payload.message : "WAVI rejected the request.",
    httpStatus: response.status,
    requestId
  };
}

async function performQueueRequest(url, engine, token, port, requestId) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(buildWaviUrl(port, WAVI_QUEUE_PATH), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({ url, engine }),
      cache: "no-store",
      credentials: "omit",
      signal: controller.signal
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch (_error) {
      payload = null;
    }

    if (!payload) {
      return {
        ok: false,
        queued: false,
        engine,
        error: "invalid_response",
        message: "WAVI returned an unreadable response.",
        httpStatus: response.status,
        requestId
      };
    }

    return normalizeServerResult(response, payload, engine, requestId);
  } catch (error) {
    if (error && error.name === "AbortError") {
      return {
        ok: false,
        queued: false,
        engine,
        error: "request_timeout",
        message: "WAVI did not respond in time. Check its window and Job Queue before retrying.",
        requestId
      };
    }
    return {
      ok: false,
      queued: false,
      engine,
      error: "wavi_unreachable",
      message: "Unable to reach WAVI. Make sure the browser integration API is enabled and the listener port matches WAVI.",
      requestId
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function verifyPairingToken(token, port) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AUTH_VERIFY_TIMEOUT_MS);

  try {
    const response = await fetch(buildWaviUrl(port, WAVI_AUTH_VERIFY_PATH), {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`
      },
      cache: "no-store",
      credentials: "omit",
      signal: controller.signal
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch (_error) {
      payload = null;
    }

    if (response.ok && payload && payload.ok === true && payload.authenticated === true) {
      return { ok: true, authenticated: true };
    }

    if (response.status === 401) {
      return {
        ok: false,
        error: payload && typeof payload.error === "string" ? payload.error : "authentication_failed",
        message: "Pairing token rejected by WAVI."
      };
    }

    return {
      ok: false,
      error: payload && typeof payload.error === "string" ? payload.error : "verification_failed",
      message: payload && typeof payload.message === "string"
        ? payload.message
        : "WAVI could not verify the pairing token."
    };
  } catch (error) {
    if (error && error.name === "AbortError") {
      return {
        ok: false,
        error: "verification_timeout",
        message: "WAVI did not respond while verifying the pairing token."
      };
    }
    return {
      ok: false,
      error: "wavi_unreachable",
      message: "Unable to reach WAVI to verify the pairing token. Make sure the API is enabled and the listener port matches WAVI."
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function handleQueue(message) {
  if (!messageHasOnlyKeys(message, ["action", "url", "engine"])) {
    return { ok: false, error: "invalid_message", message: "Invalid extension request." };
  }

  const { url, engine } = message;
  if (!VALID_ENGINES.has(engine)) {
    return { ok: false, error: "invalid_engine", message: "Invalid WAVI capture engine." };
  }
  if (!isSupportedPageUrl(url)) {
    return { ok: false, error: "invalid_url", message: "Only valid HTTP and HTTPS URLs can be sent to WAVI." };
  }

  if (activeRequestPromise) {
    return {
      ok: false,
      error: "extension_request_busy",
      message: "Another WAVI request is still waiting for a result.",
      requestId: activeRequestId
    };
  }

  const requestId = newRequestId();
  activeRequestId = requestId;

  // Assign the promise before the first await so two popup instances cannot
  // race past the busy check and create concurrent WAVI submissions.
  activeRequestPromise = (async () => {
    let token;
    let port;
    try {
      [token, port] = await Promise.all([getStoredToken(), getStoredPort()]);
    } catch (_error) {
      return { ok: false, error: "storage_error", message: "Unable to read the saved WAVI browser-integration settings.", requestId };
    }
    if (!token) {
      return { ok: false, error: "pairing_required", message: "Pair WAVI before sending a capture.", requestId };
    }

    const pendingState = {
      requestId,
      state: "pending",
      engine,
      startedAt: new Date().toISOString()
    };
    try {
      await setLastRequest(pendingState);
    } catch (_error) {
      // The request may still proceed; storage status is best-effort here.
    }

    const result = await performQueueRequest(url, engine, token, port, requestId);
    const completedState = {
      requestId,
      state: "complete",
      engine,
      completedAt: new Date().toISOString(),
      result
    };
    try {
      await setLastRequest(completedState);
    } catch (_error) {
      // Returning the result to a still-open popup is still useful.
    }
    return result;
  })();

  try {
    return await activeRequestPromise;
  } finally {
    activeRequestPromise = null;
    activeRequestId = "";
  }
}

async function handleMessage(message, sender) {
  if (sender && sender.id && sender.id !== browser.runtime.id) {
    return { ok: false, error: "unauthorized_sender", message: "Unauthorized extension message sender." };
  }
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return { ok: false, error: "invalid_message", message: "Invalid extension request." };
  }

  if (message.action === "queue") {
    return handleQueue(message);
  }

  if (message.action === "getState") {
    if (!messageHasOnlyKeys(message, ["action"])) {
      return { ok: false, error: "invalid_message", message: "Invalid extension request." };
    }
    try {
      const [token, port, lastRequest] = await Promise.all([getStoredToken(), getStoredPort(), getLastRequest()]);
      return { ok: true, paired: Boolean(token), listenerPort: port, lastRequest };
    } catch (_error) {
      return { ok: false, error: "storage_error", message: "Unable to read WAVI extension state." };
    }
  }

  if (message.action === "saveToken") {
    if (!messageHasOnlyKeys(message, ["action", "token"])) {
      return { ok: false, error: "invalid_message", message: "Invalid extension request." };
    }
    const token = normalizeToken(message.token);
    if (!isValidToken(token)) {
      return { ok: false, error: "invalid_token", message: "The pairing token format is invalid." };
    }

    let port;
    try {
      port = await getStoredPort();
    } catch (_error) {
      return { ok: false, error: "storage_error", message: "Unable to read the saved WAVI listener port." };
    }

    const verification = await verifyPairingToken(token, port);
    if (!verification.ok) {
      return verification;
    }

    try {
      await browser.storage.local.set({ [TOKEN_STORAGE_KEY]: token });
      await clearLastRequest();
      return {
        ok: true,
        paired: true,
        verified: true,
        message: "Pairing token verified and saved."
      };
    } catch (_error) {
      return { ok: false, error: "storage_error", message: "The token was verified, but Firefox could not save it." };
    }
  }

  if (message.action === "savePort") {
    if (!messageHasOnlyKeys(message, ["action", "port"])) {
      return { ok: false, error: "invalid_message", message: "Invalid extension request." };
    }
    if (activeRequestPromise) {
      return { ok: false, error: "extension_request_busy", message: "Wait for the current WAVI request to finish before changing the listener port." };
    }
    const port = normalizeListenerPort(message.port);
    if (port === null) {
      return {
        ok: false,
        error: "invalid_port",
        message: `Listener port must be between ${MIN_LISTENER_PORT} and ${MAX_LISTENER_PORT}.`
      };
    }
    try {
      await browser.storage.local.set({ [PORT_STORAGE_KEY]: port });
      await clearLastRequest();
      return { ok: true, listenerPort: port, message: `Listener port saved: ${port}.` };
    } catch (_error) {
      return { ok: false, error: "storage_error", message: "Firefox could not save the WAVI listener port." };
    }
  }

  if (message.action === "forgetToken") {
    if (!messageHasOnlyKeys(message, ["action"])) {
      return { ok: false, error: "invalid_message", message: "Invalid extension request." };
    }
    try {
      await browser.storage.local.remove(TOKEN_STORAGE_KEY);
      await clearLastRequest();
      return { ok: true, paired: false };
    } catch (_error) {
      return { ok: false, error: "storage_error", message: "Unable to remove the WAVI pairing token." };
    }
  }

  return { ok: false, error: "unknown_action", message: "Unknown extension request." };
}

browser.runtime.onMessage.addListener((message, sender) => handleMessage(message, sender));
