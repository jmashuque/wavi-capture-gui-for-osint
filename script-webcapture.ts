/*
WAVI Capture GUI for OSINT - Webpage Capture helper

This helper intentionally uses only built-in Deno and Chromium capabilities.
It launches a selected installed Chromium-family browser with a unique app-owned
--user-data-dir, connects over loopback through the Chrome DevTools Protocol,
and never reads the user's normal browser profile or cookie databases. When
explicitly enabled, it may read a user-selected Netscape cookies.txt file and
inject either site-applicable cookies or the entire file into the isolated browser session.
*/

const SCRIPT_SCHEMA_VERSION = 1;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function nowIso() {
  return new Date().toISOString();
}

function stampUtc(date = new Date()) {
  const p = (value, width = 2) => String(value).padStart(width, "0");
  return `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}-${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}`;
}

function joinPath(...parts) {
  const separator = Deno.build.os === "windows" ? "\\" : "/";
  const filtered = parts
    .filter((part) => part !== undefined && part !== null && String(part) !== "")
    .map((part, index) => {
      let value = String(part);
      if (index > 0) value = value.replace(/^[\\/]+/, "");
      if (index < parts.length - 1) value = value.replace(/[\\/]+$/, "");
      return value;
    });
  return filtered.join(separator);
}

function basename(path) {
  return String(path || "").replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "";
}

function safeFileComponent(value, fallback = "untitled", maxLength = 120) {
  let text = String(value || "")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim();
  if (!text) text = fallback;
  if (text.length > maxLength) text = text.slice(0, maxLength).replace(/[. ]+$/g, "");
  return text || fallback;
}

function csvQuote(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function redactSensitiveHeaders(headers) {
  const output = {};
  const sensitive = new Set(["authorization", "proxy-authorization", "cookie", "set-cookie"]);
  for (const [name, value] of Object.entries(headers || {})) {
    output[name] = sensitive.has(String(name).toLowerCase()) ? "<redacted>" : value;
  }
  return output;
}

function bytesFromBase64(value) {
  const binary = atob(String(value || ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function sha256Bytes(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
}

async function sha256File(path) {
  return sha256Bytes(await Deno.readFile(path));
}

async function pathExists(path) {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}


function emptyCookieJar() {
  return {
    enabled: false,
    source_filename: "",
    entries: [],
    stats: {
      valid_cookie_rows: 0,
      usable_cookie_rows: 0,
      expired_rows_skipped: 0,
      invalid_rows_skipped: 0,
      domain_count: 0,
    },
  };
}

async function loadNetscapeCookieFile(path) {
  const cookiePath = String(path || "").trim();
  if (!cookiePath) throw new Error("Cookies file use is enabled, but no cookies file path was provided.");

  const fileInfo = await Deno.stat(cookiePath);
  if (!fileInfo.isFile) throw new Error("The selected Webpage Capture cookies path is not a file.");
  if (fileInfo.size <= 0) throw new Error("The selected Webpage Capture cookies file is empty.");
  if (fileInfo.size > 64 * 1024 * 1024) throw new Error("The selected Webpage Capture cookies file exceeds the 64 MB safety limit.");

  const text = (await Deno.readTextFile(cookiePath)).replace(/^\uFEFF/, "");
  const entries = [];
  const domains = new Set();
  const nowSeconds = Math.floor(Date.now() / 1000);
  let headerSeen = false;
  let validRows = 0;
  let expiredRows = 0;
  let invalidRows = 0;

  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine;
    if (!line.trim()) continue;
    const lowered = line.toLowerCase();
    if (lowered.startsWith("#") && !lowered.startsWith("#httponly_")) {
      if (lowered.includes("http cookie file")) headerSeen = true;
      continue;
    }

    let httpOnly = false;
    if (lowered.startsWith("#httponly_")) {
      line = line.slice("#HttpOnly_".length);
      httpOnly = true;
    }

    const fields = line.split("\t");
    if (fields.length < 7) {
      invalidRows += 1;
      continue;
    }

    const rawDomain = String(fields[0] || "").trim();
    const includeValue = String(fields[1] || "").trim().toUpperCase();
    const cookiePathValue = String(fields[2] || "").trim() || "/";
    const secureValue = String(fields[3] || "").trim().toUpperCase();
    const expiryText = String(fields[4] || "").trim() || "0";
    const name = String(fields[5] || "");
    const value = fields.slice(6).join("\t");
    const domain = rawDomain.replace(/^\.+/, "").replace(/\.+$/, "").toLowerCase();
    const expires = Number(expiryText);

    if (
      !domain ||
      domain.includes("://") ||
      /[\\/\s]/.test(domain) ||
      !["TRUE", "FALSE"].includes(includeValue) ||
      !["TRUE", "FALSE"].includes(secureValue) ||
      !cookiePathValue.startsWith("/") ||
      !name ||
      !Number.isSafeInteger(expires) ||
      expires < 0
    ) {
      invalidRows += 1;
      continue;
    }

    validRows += 1;
    if (expires > 0 && expires <= nowSeconds) {
      expiredRows += 1;
      continue;
    }

    const includeSubdomains = includeValue === "TRUE" || rawDomain.startsWith(".");
    entries.push({
      domain,
      domain_for_cdp: includeSubdomains ? `.${domain}` : domain,
      host_only: !includeSubdomains,
      path: cookiePathValue,
      secure: secureValue === "TRUE",
      http_only: httpOnly,
      expires,
      name,
      value,
    });
    domains.add(domain);
    if (entries.length > 20000) throw new Error("The selected cookies file contains more than 20,000 usable cookie rows.");
  }

  if (!headerSeen) throw new Error("The selected cookies file is not in Netscape cookies.txt format (header not found).");
  if (validRows === 0) throw new Error("The selected cookies file contains no valid Netscape cookie rows.");
  if (entries.length === 0) throw new Error("The selected cookies file contains no unexpired/session cookies that can be imported.");

  return {
    enabled: true,
    source_filename: basename(cookiePath),
    entries,
    stats: {
      valid_cookie_rows: validRows,
      usable_cookie_rows: entries.length,
      expired_rows_skipped: expiredRows,
      invalid_rows_skipped: invalidRows,
      domain_count: domains.size,
    },
  };
}

function normalizeCookieScope(value) {
  return String(value || "").trim() === "entire_file" ? "entire_file" : "site_only";
}

function cookieScopeLabel(value) {
  return normalizeCookieScope(value) === "entire_file" ? "Entire cookies file" : "Requested site only";
}

function cookieMatchesHostname(cookie, hostname) {
  const host = String(hostname || "").toLowerCase().replace(/\.+$/, "");
  const domain = String(cookie?.domain || "").toLowerCase().replace(/\.+$/, "");
  if (!host || !domain) return false;
  if (host === domain) return true;
  return !cookie.host_only && host.endsWith(`.${domain}`);
}

function cookieToCdpParam(cookie) {
  const output = {
    name: cookie.name,
    value: cookie.value,
    path: cookie.path || "/",
    secure: Boolean(cookie.secure),
    httpOnly: Boolean(cookie.http_only),
  };
  if (Number(cookie.expires) > 0) output.expires = Number(cookie.expires);
  if (cookie.host_only) {
    output.url = `${cookie.secure ? "https" : "http"}://${cookie.domain}/`;
  } else {
    output.domain = cookie.domain_for_cdp || `.${cookie.domain}`;
  }
  return output;
}

async function setCookiesInBatches(client, entries) {
  const batchSize = 250;
  let accepted = 0;
  let failed = 0;
  for (let offset = 0; offset < entries.length; offset += batchSize) {
    const batch = entries.slice(offset, offset + batchSize);
    try {
      await client.send("Network.setCookies", { cookies: batch.map(cookieToCdpParam) }, 30000);
      accepted += batch.length;
    } catch {
      // A single malformed or browser-rejected cookie should not prevent the
      // remaining cookies in the selected scope from being loaded.
      for (const cookie of batch) {
        try {
          await client.send("Network.setCookies", { cookies: [cookieToCdpParam(cookie)] }, 15000);
          accepted += 1;
        } catch {
          failed += 1;
        }
      }
    }
  }
  return { accepted, failed };
}

async function importCookiesForUrl(client, cookieJar, targetUrl, requestedScope) {
  const scope = normalizeCookieScope(requestedScope);
  if (!cookieJar?.enabled) {
    return {
      enabled: false,
      scope,
      scope_label: cookieScopeLabel(scope),
      source_filename: "",
      parsed_cookie_count: 0,
      selected_cookie_count: 0,
      accepted_cookie_count: 0,
      failed_cookie_count: 0,
      site_applicable_cookie_count: 0,
      browser_visible_cookie_count: 0,
      selected_domain_count: 0,
      site_applicable_domain_count: 0,
      expired_rows_skipped: 0,
      invalid_rows_skipped: 0,
    };
  }

  const parsedUrl = new URL(targetUrl);
  const hostname = parsedUrl.hostname.toLowerCase().replace(/\.+$/, "");
  const siteApplicable = cookieJar.entries.filter((cookie) => cookieMatchesHostname(cookie, hostname));
  const selected = scope === "entire_file" ? cookieJar.entries.slice() : siteApplicable;
  const selectedDomains = new Set(selected.map((cookie) => cookie.domain));
  const siteApplicableDomains = new Set(siteApplicable.map((cookie) => cookie.domain));

  // Each URL begins with a clean cookie store. Site-only mode loads only
  // cookies applicable to the submitted hostname. Entire-file mode loads all
  // valid rows so Chromium can carry authentication through redirects and SSO.
  await client.send("Network.clearBrowserCookies", {}, 15000);
  const loadResult = selected.length
    ? await setCookiesInBatches(client, selected)
    : { accepted: 0, failed: 0 };

  let browserVisibleCookieCount = 0;
  try {
    const visible = await client.send("Network.getCookies", { urls: [targetUrl] }, 15000);
    browserVisibleCookieCount = Array.isArray(visible.cookies) ? visible.cookies.length : 0;
  } catch {
    // Verification is best effort; successful Network.setCookies remains authoritative.
  }

  return {
    enabled: true,
    scope,
    scope_label: cookieScopeLabel(scope),
    source_filename: cookieJar.source_filename,
    parsed_cookie_count: Number(cookieJar.stats?.usable_cookie_rows) || 0,
    selected_cookie_count: selected.length,
    accepted_cookie_count: loadResult.accepted,
    failed_cookie_count: loadResult.failed,
    site_applicable_cookie_count: siteApplicable.length,
    browser_visible_cookie_count: browserVisibleCookieCount,
    selected_domain_count: selectedDomains.size,
    site_applicable_domain_count: siteApplicableDomains.size,
    expired_rows_skipped: Number(cookieJar.stats?.expired_rows_skipped) || 0,
    invalid_rows_skipped: Number(cookieJar.stats?.invalid_rows_skipped) || 0,
  };
}

async function uniqueOutputPath(folder, baseName, extension) {
  let attempt = 1;
  while (attempt < 10000) {
    const suffix = attempt === 1 ? "" : `_${attempt}`;
    const candidate = joinPath(folder, `${baseName}${suffix}${extension}`);
    if (!(await pathExists(candidate))) return candidate;
    attempt += 1;
  }
  throw new Error("Could not create a unique output filename.");
}

function renderFilenameTemplate(template, context) {
  const date = context.date;
  const p = (value, width = 2) => String(value).padStart(width, "0");
  const tags = {
    "%date%": `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}`,
    "%time%": `${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}`,
    "%datetime%": stampUtc(date),
    "%domain%": safeFileComponent(context.domain, "unknown-domain", 90),
    "%title%": safeFileComponent(context.title, "untitled", 120),
    "%index%": String(context.index).padStart(3, "0"),
    "%mode%": context.mode === "viewport" ? "viewport" : "full-page",
    "%case%": safeFileComponent(context.caseName, "case", 120),
  };
  let output = String(template || "%datetime%_%domain%_%title%");
  for (const [tag, value] of Object.entries(tags)) output = output.split(tag).join(value);
  output = output.replace(/[\\/]+/g, "_");
  return safeFileComponent(output, `${tags["%datetime%"]}_${tags["%domain%"]}`, 220);
}

function htmlEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderPdfTemplate(template, context) {
  let output = String(template || "");
  const replacements = {
    "%requested_url%": htmlEscape(context.requested_url || ""),
    "%final_url%": htmlEscape(context.final_url || ""),
    "%page_title%": htmlEscape(context.page_title || ""),
    "%capture_utc%": htmlEscape(context.capture_utc || ""),
  };
  for (const [tag, value] of Object.entries(replacements)) output = output.split(tag).join(value);
  return output;
}

function normalizePdfPageBehavior(value) {
  const behavior = String(value || "preserve_layout").trim();
  if (["preserve_layout", "neutralize_fixed_sticky", "hide_likely_navigation_overlays"].includes(behavior)) {
    return behavior;
  }
  return "preserve_layout";
}

function normalizePdfCaptureMode(value) {
  const mode = String(value || "live_webpage").trim();
  if (["live_webpage", "paginated_png"].includes(mode)) return mode;
  return "live_webpage";
}

async function applyPdfPageBehavior(client, behavior) {
  const normalized = normalizePdfPageBehavior(behavior);
  if (normalized === "preserve_layout") {
    return {
      behavior: normalized,
      applied: false,
      matched_elements: 0,
      modified_elements: 0,
      hidden_elements: 0,
      note: "Preserved webpage layout for PDF output.",
      sample_elements: [],
    };
  }

  const expression = `(() => {
    const MODE = ${JSON.stringify(normalized)};
    const STYLE_ID = "__wavi_pdf_behavior_style__";
    const ATTR = "data-wavi-pdf-behavior-id";
    const oldStyle = document.getElementById(STYLE_ID);
    if (oldStyle) oldStyle.remove();
    for (const node of document.querySelectorAll("[" + ATTR + "]")) node.removeAttribute(ATTR);

    const viewportWidth = Math.max(window.innerWidth || 0, document.documentElement?.clientWidth || 0, 1);
    const viewportHeight = Math.max(window.innerHeight || 0, document.documentElement?.clientHeight || 0, 1);
    const keywordPattern = /(nav|header|menu|toolbar|masthead|topbar|banner|cookie|consent)/i;

    const matched = [];
    const selected = [];
    let nextId = 1;
    for (const el of document.body ? document.body.querySelectorAll("*") : []) {
      if (!(el instanceof HTMLElement)) continue;
      const style = getComputedStyle(el);
      if (style.position !== "fixed" && style.position !== "sticky") continue;
      const rect = el.getBoundingClientRect();
      if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height) || rect.width < 1 || rect.height < 1) continue;

      const descriptor = {
        tag: (el.tagName || "").toLowerCase(),
        role: (el.getAttribute("role") || "").toLowerCase(),
        aria_label: (el.getAttribute("aria-label") || "").toLowerCase(),
        class_name: String(el.className || "").toLowerCase(),
        element_id: (el.id || "").toLowerCase(),
        top: Math.round(rect.top),
        bottom: Math.round(rect.bottom),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
      matched.push(descriptor);

      let shouldSelect = true;
      if (MODE === "hide_likely_navigation_overlays") {
        const isTopAnchored = rect.top <= Math.max(140, viewportHeight * 0.18) && rect.bottom >= 0;
        const isWideEnough = rect.width >= Math.max(320, viewportWidth * 0.40);
        const isReasonableHeight = rect.height <= Math.max(280, viewportHeight * 0.45);
        const looksLikeOverlay = keywordPattern.test(descriptor.tag) || keywordPattern.test(descriptor.role) || keywordPattern.test(descriptor.aria_label) || keywordPattern.test(descriptor.class_name) || keywordPattern.test(descriptor.element_id);
        shouldSelect = isTopAnchored && isWideEnough && isReasonableHeight && (looksLikeOverlay || rect.height <= Math.max(160, viewportHeight * 0.22));
      }

      if (!shouldSelect) continue;
      const id = String(nextId++);
      el.setAttribute(ATTR, id);
      selected.push({ ...descriptor, id });
      if (selected.length >= 800) break;
    }

    if (!selected.length) {
      return {
        behavior: MODE,
        applied: false,
        matched_elements: matched.length,
        modified_elements: 0,
        hidden_elements: 0,
        note: MODE === "hide_likely_navigation_overlays"
          ? "No likely top navigation overlays qualified for suppression."
          : "No fixed/sticky elements qualified for neutralization.",
        sample_elements: [],
      };
    }

    const cssRules = selected.map((item) => {
      const selector = "[" + ATTR + "=\"" + item.id + "\"]";
      return MODE === "hide_likely_navigation_overlays"
        ? selector + "{display:none !important; visibility:hidden !important;}"
        : selector + "{position:static !important; top:auto !important; right:auto !important; bottom:auto !important; left:auto !important; inset:auto !important; transform:none !important;}";
    });
    const styleTag = document.createElement("style");
    styleTag.id = STYLE_ID;
    styleTag.textContent = cssRules.join("\n");
    (document.head || document.documentElement).appendChild(styleTag);

    return {
      behavior: MODE,
      applied: true,
      matched_elements: matched.length,
      modified_elements: selected.length,
      hidden_elements: MODE === "hide_likely_navigation_overlays" ? selected.length : 0,
      note: MODE === "hide_likely_navigation_overlays"
        ? "Hid likely top navigation overlays for PDF output."
        : "Neutralized fixed/sticky positioning for PDF output.",
      sample_elements: selected.slice(0, 12).map((item) => ({
        tag: item.tag,
        role: item.role,
        top: item.top,
        width: item.width,
        height: item.height,
        element_id: item.element_id,
        class_name: item.class_name,
      })),
    };
  })()`;
  return await evaluate(client, expression, 30000);
}

async function cleanupPdfPageBehavior(client) {
  try {
    return await evaluate(client, `(() => {
      const STYLE_ID = "__wavi_pdf_behavior_style__";
      const ATTR = "data-wavi-pdf-behavior-id";
      const styleTag = document.getElementById(STYLE_ID);
      if (styleTag) styleTag.remove();
      let cleaned = 0;
      for (const node of document.querySelectorAll("[" + ATTR + "]")) {
        node.removeAttribute(ATTR);
        cleaned += 1;
      }
      return { cleaned };
    })()`, 10000);
  } catch {
    return { cleaned: 0 };
  }
}

class CdpClient {
  constructor(webSocket) {
    this.webSocket = webSocket;
    this.nextId = 1;
    this.pending = new Map();
    this.eventWaiters = new Map();
    this.eventBacklog = new Map();
    this.listeners = [];

    webSocket.onmessage = (event) => {
      let message;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }

      if (message.id !== undefined) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(`${message.error.message || "CDP error"} (${message.error.code ?? "unknown"})`));
        else pending.resolve(message.result || {});
        return;
      }

      if (!message.method) return;
      for (const listener of this.listeners) {
        try {
          listener(message.method, message.params || {});
        } catch {
          // Event observers must not break protocol processing.
        }
      }

      const waiters = this.eventWaiters.get(message.method) || [];
      if (waiters.length) {
        const waiter = waiters.shift();
        if (!waiters.length) this.eventWaiters.delete(message.method);
        clearTimeout(waiter.timer);
        waiter.resolve(message.params || {});
      } else {
        const backlog = this.eventBacklog.get(message.method) || [];
        backlog.push(message.params || {});
        if (backlog.length > 20) backlog.shift();
        this.eventBacklog.set(message.method, backlog);
      }
    };

    const failAll = (reason) => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error(reason));
      }
      this.pending.clear();
      for (const waiters of this.eventWaiters.values()) {
        for (const waiter of waiters) {
          clearTimeout(waiter.timer);
          waiter.reject(new Error(reason));
        }
      }
      this.eventWaiters.clear();
    };

    webSocket.onerror = () => failAll("DevTools WebSocket error.");
    webSocket.onclose = () => failAll("DevTools WebSocket closed.");
  }

  addEventListener(listener) {
    this.listeners.push(listener);
  }

  removeEventListener(listener) {
    this.listeners = this.listeners.filter((item) => item !== listener);
  }

  send(method, params = {}, timeoutMs = 30000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for CDP command: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.webSocket.send(JSON.stringify({ id, method, params }));
    });
  }

  waitForEvent(method, timeoutMs = 30000) {
    const backlog = this.eventBacklog.get(method) || [];
    if (backlog.length) {
      const value = backlog.shift();
      if (!backlog.length) this.eventBacklog.delete(method);
      return Promise.resolve(value);
    }

    return new Promise((resolve, reject) => {
      const waiters = this.eventWaiters.get(method) || [];
      const timer = setTimeout(() => {
        const current = this.eventWaiters.get(method) || [];
        const index = current.findIndex((item) => item.resolve === resolve);
        if (index >= 0) current.splice(index, 1);
        if (!current.length) this.eventWaiters.delete(method);
        reject(new Error(`Timed out waiting for CDP event: ${method}`));
      }, timeoutMs);
      waiters.push({ resolve, reject, timer });
      this.eventWaiters.set(method, waiters);
    });
  }

  close() {
    try {
      this.webSocket.close();
    } catch {
      // Best effort.
    }
  }
}

async function connectWebSocket(url, timeoutMs = 15000) {
  return await new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timer = setTimeout(() => {
      try { socket.close(); } catch { /* ignore */ }
      reject(new Error("Timed out connecting to the browser DevTools WebSocket."));
    }, timeoutMs);
    socket.onopen = () => {
      clearTimeout(timer);
      resolve(new CdpClient(socket));
    };
    socket.onerror = () => {
      clearTimeout(timer);
      reject(new Error("Could not connect to the browser DevTools WebSocket."));
    };
  });
}

async function waitForDevTools(profileRoot, childStatusPromise, timeoutMs = 20000) {
  const activePortPath = joinPath(profileRoot, "DevToolsActivePort");
  let childStatus = null;
  childStatusPromise.then((status) => { childStatus = status; }).catch(() => {});
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (childStatus) {
      throw new Error(`Browser exited before DevTools became available (code ${childStatus.code}).`);
    }
    try {
      const text = await Deno.readTextFile(activePortPath);
      const lines = text.trim().split(/\r?\n/);
      const port = Number(lines[0]);
      if (Number.isInteger(port) && port > 0) return port;
    } catch {
      // File is created after the browser initializes the custom profile.
    }
    await delay(100);
  }

  throw new Error("Browser DevTools endpoint did not become available. Remote debugging may be blocked by policy.");
}

async function getPageTarget(port) {
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/json/list`);
      if (response.ok) {
        const targets = await response.json();
        const page = Array.isArray(targets)
          ? targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl)
          : null;
        if (page) return page;
      }
    } catch {
      // Browser endpoint may still be initializing.
    }
    await delay(100);
  }

  try {
    const response = await fetch(`${base}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" });
    if (response.ok) {
      const page = await response.json();
      if (page?.webSocketDebuggerUrl) return page;
    }
  } catch {
    // Fall through to the explicit error below.
  }

  throw new Error("Browser started, but no debuggable page target was available.");
}

async function getBrowserVersion(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`);
    if (!response.ok) return {};
    return await response.json();
  } catch {
    return {};
  }
}

async function waitForNetworkQuiet(state, quietMs = 750, maximumMs = 5000) {
  const deadline = Date.now() + maximumMs;
  while (Date.now() < deadline) {
    if (state.inflight.size === 0 && Date.now() - state.lastActivity >= quietMs) return true;
    await delay(100);
  }
  return false;
}

async function evaluate(client, expression, timeoutMs = 30000) {
  const result = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: false,
  }, timeoutMs);
  if (result.exceptionDetails) {
    const description = result.exceptionDetails.exception?.description || result.exceptionDetails.text || "JavaScript evaluation failed.";
    throw new Error(description);
  }
  return result.result?.value;
}

async function performLazyScroll(client, config) {
  if (!config.lazy_scroll) {
    await evaluate(client, "window.scrollTo(0, 0); true;");
    return { performed: false, iterations: 0, timed_out: false, final_height: 0 };
  }

  const maxMs = Math.max(1000, Number(config.max_scroll_seconds || 60) * 1000);
  const waitMs = Math.max(50, Math.min(5000, Number(config.scroll_wait_ms || 400)));
  const stableChecks = Math.max(1, Math.min(20, Number(config.stable_height_checks || 3)));
  const script = `
    (async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const getHeight = () => Math.max(
        document.body ? document.body.scrollHeight : 0,
        document.documentElement ? document.documentElement.scrollHeight : 0,
        document.body ? document.body.offsetHeight : 0,
        document.documentElement ? document.documentElement.offsetHeight : 0,
        window.innerHeight || 0
      );
      const started = Date.now();
      let lastHeight = getHeight();
      let stable = 0;
      let iterations = 0;
      let timedOut = false;
      window.scrollTo(0, 0);
      await sleep(Math.min(500, ${waitMs}));
      while (iterations < 2000) {
        const height = getHeight();
        const step = Math.max(240, Math.floor((window.innerHeight || 900) * 0.8));
        const nextY = Math.min(window.scrollY + step, Math.max(0, height - (window.innerHeight || 900)));
        window.scrollTo(0, nextY);
        await sleep(${waitMs});
        const newHeight = getHeight();
        const atBottom = window.scrollY + (window.innerHeight || 0) >= newHeight - 4;
        if (newHeight === lastHeight) stable += 1; else stable = 0;
        lastHeight = newHeight;
        iterations += 1;
        if (atBottom && stable >= ${stableChecks}) break;
        if (Date.now() - started >= ${maxMs}) { timedOut = true; break; }
      }
      window.scrollTo(0, 0);
      await sleep(Math.min(1000, ${waitMs} * 2));
      return { performed: true, iterations, timed_out: timedOut, final_height: getHeight() };
    })()
  `;
  return await evaluate(client, script, maxMs + 10000);
}

async function writePng(path, base64Data) {
  const bytes = bytesFromBase64(base64Data);
  await Deno.writeFile(path, bytes);
  return { bytes: bytes.length, sha256: await sha256Bytes(bytes) };
}

async function writePdf(path, base64Data) {
  const bytes = bytesFromBase64(base64Data);
  await Deno.writeFile(path, bytes);
  return { bytes: bytes.length, sha256: await sha256Bytes(bytes) };
}

function filePathToFileUrl(filePath) {
  let normalized = String(filePath || "").replaceAll("\\", "/");
  if (/^[A-Za-z]:/.test(normalized)) normalized = "/" + normalized;
  if (!normalized.startsWith("/")) normalized = "/" + normalized;
  return encodeURI(`file://${normalized}`);
}

function getPdfGeometry(config) {
  let paperWidthIn = Number(config.pdf_paper_width_in) || 8.5;
  let paperHeightIn = Number(config.pdf_paper_height_in) || 11;
  if (config.pdf_landscape) [paperWidthIn, paperHeightIn] = [paperHeightIn, paperWidthIn];
  const marginTopIn = Number(config.pdf_margin_top_in) || 0;
  const marginBottomIn = Number(config.pdf_margin_bottom_in) || 0;
  const marginLeftIn = Number(config.pdf_margin_left_in) || 0;
  const marginRightIn = Number(config.pdf_margin_right_in) || 0;
  return {
    paperWidthIn,
    paperHeightIn,
    marginTopIn,
    marginBottomIn,
    marginLeftIn,
    marginRightIn,
    contentWidthIn: Math.max(0.1, paperWidthIn - marginLeftIn - marginRightIn),
    contentHeightIn: Math.max(0.1, paperHeightIn - marginTopIn - marginBottomIn),
    scale: Math.max(0.1, Number(config.pdf_scale) || 1),
  };
}

function getPaginatedPngSourceArtifacts(capture) {
  return (capture?.artifacts || [])
    .filter((artifact) => String(artifact.kind || "").includes("png"))
    .sort((a, b) => (Number(a.y_css_px) || 0) - (Number(b.y_css_px) || 0));
}

function buildPaginatedPngPdfHtml(config, capture, sourceArtifacts, sourceUrlForIndex) {
  const geometry = getPdfGeometry(config);
  if (!sourceArtifacts.length) throw new Error("No PNG capture artifacts were available for paginated PDF output.");

  const pageWidthCssPx = Math.max(1, Math.ceil(Number(capture.page_width) || Number(sourceArtifacts[0].width_css_px) || 1));
  const totalHeightCssPx = Math.max(1, Math.ceil(Number(capture.page_height) || 0));
  const sliceHeightCssPx = Math.max(1, Math.floor(pageWidthCssPx * geometry.contentHeightIn / geometry.contentWidthIn));
  const pageCount = Math.max(1, Math.ceil(totalHeightCssPx / sliceHeightCssPx));
  const cssPageWidthIn = geometry.contentWidthIn / geometry.scale;
  const cssPageHeightIn = geometry.contentHeightIn / geometry.scale;

  const metadata = {
    pageWidthCssPx,
    totalHeightCssPx,
    sliceHeightCssPx,
    pageCount,
    cssPageWidthIn,
    cssPageHeightIn,
    sources: sourceArtifacts.map((artifact, index) => ({
      src: sourceUrlForIndex(index),
      widthCssPx: Math.max(1, Math.ceil(Number(artifact.width_css_px) || pageWidthCssPx)),
      heightCssPx: Math.max(1, Math.ceil(Number(artifact.height_css_px) || 1)),
      yCssPx: Math.max(0, Math.ceil(Number(artifact.y_css_px) || 0)),
    })),
  };
  const metadataJson = JSON.stringify(metadata).replace(/</g, "\\u003c");
  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>WAVI paginated PNG PDF</title>
<style>
  /* Do not set @page margins here. Chromium's Page.printToPDF margin values
     define the printable area and reserve space for WAVI's header/footer. */
  html, body { margin: 0; padding: 0; background: #ffffff; }
  body { font-family: Arial, sans-serif; }
  #status { padding: 0.5rem 0.75rem; font-size: 12px; color: #444; }
  #pages { margin: 0; padding: 0; width: ${cssPageWidthIn}in; }
  .page {
    position: relative;
    width: ${cssPageWidthIn}in;
    height: ${cssPageHeightIn}in;
    margin: 0;
    padding: 0;
    box-sizing: border-box;
    overflow: hidden;
    background: #ffffff;
    break-inside: avoid;
    page-break-inside: avoid;
    break-after: page;
    page-break-after: always;
  }
  .page:last-child { break-after: auto; page-break-after: auto; }
  .page img {
    position: absolute;
    left: 0;
    display: block;
    width: 100%;
    max-width: none;
    height: auto;
    margin: 0;
    padding: 0;
    border: 0;
  }
  body.ready #status { display: none; }
  body.error #status { color: #b00020; white-space: pre-wrap; }
</style>
<script>
const meta = ${metadataJson};
window.__waviPdfReady = false;
window.__waviPdfError = "";
window.__waviPdfInfo = null;
window.__waviPdfProgress = {
  stage: "initializing",
  page_count: meta.pageCount,
  pages_created: 0,
  total_images: 0,
  loaded_images: 0,
  failed_images: 0,
};
</script>
</head>
<body>
<div id="status">Preparing paginated PNG PDF…</div>
<div id="pages"></div>
<script>
(async () => {
  try {
    const container = document.getElementById("pages");
    const imagePromises = [];
    window.__waviPdfProgress.stage = "building-pages";

    for (let pageIndex = 0; pageIndex < meta.pageCount; pageIndex += 1) {
      const sliceStart = pageIndex * meta.sliceHeightCssPx;
      const sliceEnd = Math.min(meta.totalHeightCssPx, sliceStart + meta.sliceHeightCssPx);
      const page = document.createElement("div");
      page.className = "page";
      page.dataset.page = String(pageIndex + 1);

      for (const source of meta.sources) {
        const sourceStart = source.yCssPx;
        const sourceEnd = source.yCssPx + source.heightCssPx;
        const overlapStart = Math.max(sliceStart, sourceStart);
        const overlapEnd = Math.min(sliceEnd, sourceEnd);
        if (overlapEnd <= overlapStart) continue;

        const image = document.createElement("img");
        image.alt = "";
        image.decoding = "async";
        image.loading = "eager";
        const offsetCssPx = sourceStart - sliceStart;
        const offsetIn = offsetCssPx * meta.cssPageWidthIn / meta.pageWidthCssPx;
        image.style.top = offsetIn + "in";
        image.src = source.src;
        window.__waviPdfProgress.total_images += 1;

        imagePromises.push(new Promise((resolve, reject) => {
          let settled = false;
          const finish = (ok, error) => {
            if (settled) return;
            settled = true;
            if (ok) {
              window.__waviPdfProgress.loaded_images += 1;
              resolve(true);
            } else {
              window.__waviPdfProgress.failed_images += 1;
              reject(error || new Error("Image failed to load: " + source.src));
            }
          };
          image.addEventListener("load", () => finish(true), { once: true });
          image.addEventListener("error", () => finish(false, new Error("Image failed to load: " + source.src)), { once: true });
          setTimeout(() => finish(false, new Error("Image load timed out: " + source.src)), 90000);
          if (image.complete) queueMicrotask(() => finish(image.naturalWidth > 0));
        }));
        page.appendChild(image);
      }

      container.appendChild(page);
      window.__waviPdfProgress.pages_created = pageIndex + 1;
    }

    if (!window.__waviPdfProgress.total_images) {
      throw new Error("No captured PNG image slices were assigned to the generated PDF pages.");
    }

    window.__waviPdfProgress.stage = "loading-images";
    await Promise.all(imagePromises);
    window.__waviPdfProgress.stage = "finalizing";
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    document.body.classList.add("ready");
    window.__waviPdfInfo = {
      page_count: meta.pageCount,
      slice_height_css_px: meta.sliceHeightCssPx,
      page_width_css_px: meta.pageWidthCssPx,
      total_height_css_px: meta.totalHeightCssPx,
      source_image_count: meta.sources.length,
      rendered_image_count: window.__waviPdfProgress.total_images,
    };
    window.__waviPdfProgress.stage = "ready";
    window.__waviPdfReady = true;
  } catch (error) {
    const message = String(error && error.message ? error.message : error);
    document.body.classList.add("error");
    document.getElementById("status").textContent = "Paginated PNG PDF preparation failed:\\n" + message;
    window.__waviPdfProgress.stage = "error";
    window.__waviPdfError = message;
    window.__waviPdfReady = true;
  }
})();
</script>
</body>
</html>`;

  return {
    html,
    info: {
      page_count: pageCount,
      slice_height_css_px: sliceHeightCssPx,
      page_width_css_px: pageWidthCssPx,
      total_height_css_px: totalHeightCssPx,
      paper_width_in: geometry.paperWidthIn,
      paper_height_in: geometry.paperHeightIn,
      margin_top_in: geometry.marginTopIn,
      margin_bottom_in: geometry.marginBottomIn,
      margin_left_in: geometry.marginLeftIn,
      margin_right_in: geometry.marginRightIn,
      content_width_in: geometry.contentWidthIn,
      content_height_in: geometry.contentHeightIn,
      css_page_width_in: cssPageWidthIn,
      css_page_height_in: cssPageHeightIn,
      margin_application: "chromium_print_to_pdf",
      image_delivery: "ephemeral_loopback_http",
      source_artifacts: sourceArtifacts.map((artifact) => ({
        path: artifact.path,
        y_css_px: Number(artifact.y_css_px) || 0,
        width_css_px: Number(artifact.width_css_px) || pageWidthCssPx,
        height_css_px: Number(artifact.height_css_px) || 0,
      })),
    },
  };
}

async function startPaginatedPngPdfServer(config, capture) {
  const sourceArtifacts = getPaginatedPngSourceArtifacts(capture);
  if (!sourceArtifacts.length) throw new Error("No PNG capture artifacts were available for paginated PDF output.");

  const token = crypto.randomUUID().replaceAll("-", "");
  const abortController = new AbortController();
  let documentHtml = "";
  const server = Deno.serve({
    hostname: "127.0.0.1",
    port: 0,
    signal: abortController.signal,
    onListen: () => {},
  }, async (request) => {
    try {
      const url = new URL(request.url);
      const prefix = `/${token}/`;
      if (!url.pathname.startsWith(prefix)) return new Response("Not found", { status: 404 });
      const route = url.pathname.slice(prefix.length);
      if (route === "document") {
        return new Response(documentHtml, {
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
          },
        });
      }
      const match = /^image\/(\d+)$/.exec(route);
      if (!match) return new Response("Not found", { status: 404 });
      const index = Number(match[1]);
      if (!Number.isInteger(index) || index < 0 || index >= sourceArtifacts.length) {
        return new Response("Not found", { status: 404 });
      }
      const bytes = await Deno.readFile(sourceArtifacts[index].path);
      return new Response(bytes, {
        status: 200,
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "private, max-age=300, immutable",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch (error) {
      return new Response(`Paginated PNG server error: ${error?.message || error}`, { status: 500 });
    }
  });

  const port = Number(server.addr?.port);
  if (!Number.isInteger(port) || port <= 0) {
    abortController.abort();
    throw new Error("Could not determine the temporary paginated PNG server port.");
  }

  const baseUrl = `http://127.0.0.1:${port}/${token}`;
  const built = buildPaginatedPngPdfHtml(
    config,
    capture,
    sourceArtifacts,
    (index) => `${baseUrl}/image/${index}`,
  );
  documentHtml = built.html;

  return {
    documentUrl: `${baseUrl}/document`,
    sourceInfo: {
      ...built.info,
      loopback_host: "127.0.0.1",
      loopback_port: port,
    },
    async close() {
      let closedByShutdown = false;
      if (typeof server.shutdown === "function") {
        try {
          await server.shutdown();
          closedByShutdown = true;
        } catch {
          closedByShutdown = false;
        }
      }
      if (!closedByShutdown) {
        try { abortController.abort(); } catch { /* ignore */ }
      }
      try { await Promise.race([server.finished.catch(() => {}), delay(3000)]); } catch { /* ignore */ }
    },
  };
}

async function navigateToPaginatedPdfDocument(client, documentUrl) {
  const loadPromise = client.waitForEvent("Page.loadEventFired", 30000);
  loadPromise.catch(() => {});
  const navigation = await client.send("Page.navigate", { url: documentUrl }, 30000);
  if (navigation.errorText) throw new Error(`Navigation failed: ${navigation.errorText}`);
  await loadPromise;

  const deadline = Date.now() + 120000;
  let lastStatus = null;
  while (Date.now() < deadline) {
    try {
      lastStatus = await evaluate(client, `({
        ready: Boolean(window.__waviPdfReady),
        error: String(window.__waviPdfError || ""),
        info: window.__waviPdfInfo || null,
        progress: window.__waviPdfProgress || null,
        document_ready_state: document.readyState,
        status_text: String(document.getElementById("status")?.textContent || "").slice(0, 1000)
      })`, 10000);
    } catch (error) {
      lastStatus = { evaluate_error: String(error?.message || error) };
    }

    if (lastStatus?.ready) {
      if (lastStatus.error) throw new Error(lastStatus.error);
      await delay(500);
      return {
        ...(lastStatus.info || {}),
        preparation_progress: lastStatus.progress || null,
      };
    }
    await delay(250);
  }

  const progress = lastStatus?.progress || {};
  const progressText = [
    progress.stage ? `stage=${progress.stage}` : "",
    Number.isFinite(progress.pages_created) ? `pages=${progress.pages_created}/${progress.page_count || "?"}` : "",
    Number.isFinite(progress.loaded_images) ? `images=${progress.loaded_images}/${progress.total_images || "?"}` : "",
    Number.isFinite(progress.failed_images) ? `failed=${progress.failed_images}` : "",
    lastStatus?.document_ready_state ? `document=${lastStatus.document_ready_state}` : "",
    lastStatus?.evaluate_error ? `evaluate=${lastStatus.evaluate_error}` : "",
  ].filter(Boolean).join(", ");
  throw new Error(`Timed out while preparing the paginated PNG PDF document${progressText ? ` (${progressText})` : ""}.`);
}

async function capturePdf(client, config, outputFolder, baseName, pdfContext, capture) {
  const outputPath = await uniqueOutputPath(outputFolder, `${baseName}_print`, ".pdf");
  const captureMode = normalizePdfCaptureMode(config.pdf_capture_mode);
  const params = {
    landscape: Boolean(config.pdf_landscape),
    displayHeaderFooter: Boolean(config.pdf_display_header_footer),
    printBackground: Boolean(config.pdf_print_background),
    scale: Number(config.pdf_scale) || 1,
    paperWidth: Number(config.pdf_paper_width_in) || 8.5,
    paperHeight: Number(config.pdf_paper_height_in) || 11,
    marginTop: Number(config.pdf_margin_top_in) || 0,
    marginBottom: Number(config.pdf_margin_bottom_in) || 0,
    marginLeft: Number(config.pdf_margin_left_in) || 0,
    marginRight: Number(config.pdf_margin_right_in) || 0,
    pageRanges: String(config.pdf_page_ranges || "").trim(),
    preferCSSPageSize: Boolean(config.pdf_prefer_css_page_size),
    headerTemplate: renderPdfTemplate(config.pdf_header_template, pdfContext),
    footerTemplate: renderPdfTemplate(config.pdf_footer_template, pdfContext),
  };
  if (!params.pageRanges) delete params.pageRanges;

  if (captureMode === "paginated_png") {
    const pngServer = await startPaginatedPngPdfServer(config, capture);
    try {
      const preparedInfo = await navigateToPaginatedPdfDocument(client, pngServer.documentUrl);
      delete params.pageRanges;
      params.preferCSSPageSize = false;
      const result = await client.send("Page.printToPDF", params, 180000);
      const record = await writePdf(outputPath, result.data);
      return {
        artifacts: [{
          kind: "web_page_pdf",
          path: outputPath,
          sha256: record.sha256,
          size_bytes: record.bytes,
          landscape: Boolean(config.pdf_landscape),
          display_header_footer: Boolean(config.pdf_display_header_footer),
          print_background: Boolean(config.pdf_print_background),
          paper_width_in: Number(config.pdf_paper_width_in) || 8.5,
          paper_height_in: Number(config.pdf_paper_height_in) || 11,
          scale: Number(config.pdf_scale) || 1,
          source_mode: captureMode,
        }],
        behavior: {
          behavior: normalizePdfPageBehavior(config.pdf_page_behavior),
          applied: false,
          matched_elements: 0,
          modified_elements: 0,
          hidden_elements: 0,
          note: "PDF generated by paginating the captured PNG; live webpage behavior adjustments were not applied.",
          sample_elements: [],
        },
        capture_mode: captureMode,
        source_info: { ...pngServer.sourceInfo, ...preparedInfo },
      };
    } finally {
      await pngServer.close();
    }
  }

  const behaviorInfo = await applyPdfPageBehavior(client, config.pdf_page_behavior);
  try {
    const result = await client.send("Page.printToPDF", params, 180000);
    const record = await writePdf(outputPath, result.data);
    return {
      artifacts: [{
        kind: "web_page_pdf",
        path: outputPath,
        sha256: record.sha256,
        size_bytes: record.bytes,
        landscape: Boolean(config.pdf_landscape),
        display_header_footer: Boolean(config.pdf_display_header_footer),
        print_background: Boolean(config.pdf_print_background),
        paper_width_in: Number(config.pdf_paper_width_in) || 8.5,
        paper_height_in: Number(config.pdf_paper_height_in) || 11,
        scale: Number(config.pdf_scale) || 1,
        source_mode: captureMode,
      }],
      behavior: behaviorInfo,
      capture_mode: captureMode,
      source_info: null,
    };
  } finally {
    await cleanupPdfPageBehavior(client);
  }
}

async function capturePage(client, config, outputFolder, baseName, layout) {
  const artifacts = [];
  const mode = config.capture_mode === "viewport" ? "viewport" : "full_page";
  const width = Math.max(1, Math.ceil(Number(layout.width) || Number(config.viewport_width) || 1440));
  const height = Math.max(1, Math.ceil(Number(layout.height) || Number(config.viewport_height) || 900));

  if (mode === "viewport") {
    const outputPath = await uniqueOutputPath(outputFolder, `${baseName}_viewport`, ".png");
    const result = await client.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
    }, 120000);
    const record = await writePng(outputPath, result.data);
    artifacts.push({
      kind: "viewport_png",
      path: outputPath,
      sha256: record.sha256,
      size_bytes: record.bytes,
      x_css_px: 0,
      y_css_px: 0,
      width_css_px: Number(config.viewport_width) || 1440,
      height_css_px: Number(config.viewport_height) || 900,
    });
    return { artifacts, segmented: false, page_width: width, page_height: height };
  }

  const maximumSingleDimension = Math.max(8000, Number(config.maximum_single_dimension || 30000));
  const maximumSinglePixels = Math.max(20_000_000, Number(config.maximum_single_pixels || 150_000_000));
  const shouldSegment = height > maximumSingleDimension || width > maximumSingleDimension || width * height > maximumSinglePixels;

  if (!shouldSegment) {
    try {
      const outputPath = await uniqueOutputPath(outputFolder, `${baseName}_full`, ".png");
      const result = await client.send("Page.captureScreenshot", {
        format: "png",
        fromSurface: true,
        captureBeyondViewport: true,
        clip: { x: 0, y: 0, width, height, scale: 1 },
      }, 180000);
      const record = await writePng(outputPath, result.data);
      artifacts.push({
        kind: "full_page_png",
        path: outputPath,
        sha256: record.sha256,
        size_bytes: record.bytes,
        x_css_px: 0,
        y_css_px: 0,
        width_css_px: width,
        height_css_px: height,
      });
      return { artifacts, segmented: false, page_width: width, page_height: height };
    } catch (error) {
      console.log(`Single-image capture failed; using segmented fallback: ${error.message || error}`);
    }
  }

  const segmentHeight = Math.max(2000, Math.min(16000, Number(config.segment_height || 12000)));
  const partCount = Math.ceil(height / segmentHeight);
  for (let part = 0; part < partCount; part += 1) {
    const y = part * segmentHeight;
    const partHeight = Math.min(segmentHeight, height - y);
    const outputPath = await uniqueOutputPath(
      outputFolder,
      `${baseName}_full_part-${String(part + 1).padStart(3, "0")}`,
      ".png",
    );
    const result = await client.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: true,
      clip: { x: 0, y, width, height: partHeight, scale: 1 },
    }, 180000);
    const record = await writePng(outputPath, result.data);
    artifacts.push({
      kind: "full_page_png_segment",
      part: part + 1,
      parts_total: partCount,
      path: outputPath,
      sha256: record.sha256,
      size_bytes: record.bytes,
      x_css_px: 0,
      y_css_px: y,
      width_css_px: width,
      height_css_px: partHeight,
    });
  }
  return { artifacts, segmented: true, page_width: width, page_height: height };
}

async function captureUrl(client, config, url, index, browserVersion, runContext) {
  const startedAt = nowIso();
  const warnings = [];
  const consoleErrors = [];
  const networkState = {
    inflight: new Set(),
    lastActivity: Date.now(),
    documentResponses: [],
    redirects: [],
  };
  let mainFrameId = "";
  let cookieImport = {
    enabled: Boolean(config.use_cookies_file),
    scope: normalizeCookieScope(config.cookie_scope),
    scope_label: cookieScopeLabel(config.cookie_scope),
    source_filename: config.cookie_jar?.source_filename || "",
    parsed_cookie_count: Number(config.cookie_jar?.stats?.usable_cookie_rows) || 0,
    selected_cookie_count: 0,
    accepted_cookie_count: 0,
    failed_cookie_count: 0,
    site_applicable_cookie_count: 0,
    browser_visible_cookie_count: 0,
    selected_domain_count: 0,
    site_applicable_domain_count: 0,
    expired_rows_skipped: Number(config.cookie_jar?.stats?.expired_rows_skipped) || 0,
    invalid_rows_skipped: Number(config.cookie_jar?.stats?.invalid_rows_skipped) || 0,
  };

  const eventListener = (method, params) => {
    if (method === "Network.requestWillBeSent") {
      networkState.inflight.add(params.requestId);
      networkState.lastActivity = Date.now();
      if (params.type === "Document" && params.redirectResponse && (!mainFrameId || params.frameId === mainFrameId)) {
        networkState.redirects.push({
          from_url: params.redirectResponse.url || "",
          to_url: params.request?.url || "",
          status: Number(params.redirectResponse.status) || null,
          status_text: params.redirectResponse.statusText || "",
        });
      }
    } else if (method === "Network.loadingFinished" || method === "Network.loadingFailed") {
      networkState.inflight.delete(params.requestId);
      networkState.lastActivity = Date.now();
    } else if (method === "Network.responseReceived" && params.type === "Document" && (!mainFrameId || params.frameId === mainFrameId)) {
      networkState.documentResponses.push(params.response || {});
      networkState.lastActivity = Date.now();
    } else if (method === "Runtime.consoleAPICalled" && (params.type === "error" || params.type === "warning")) {
      const text = (params.args || []).map((arg) => arg.value ?? arg.description ?? "").join(" ").trim();
      if (text && consoleErrors.length < 100) consoleErrors.push({ type: params.type, text });
    } else if (method === "Log.entryAdded") {
      const entry = params.entry || {};
      if ((entry.level === "error" || entry.level === "warning") && consoleErrors.length < 100) {
        consoleErrors.push({ type: entry.level, text: entry.text || "" });
      }
    }
  };
  client.addEventListener(eventListener);

  try {
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    await client.send("Network.enable", { maxTotalBufferSize: 10_000_000, maxResourceBufferSize: 5_000_000 });
    cookieImport = await importCookiesForUrl(client, config.cookie_jar, url, config.cookie_scope);
    if (cookieImport.enabled) {
      console.log(
        `WEB_CAPTURE_COOKIES_APPLIED	${index}	${cookieImport.scope}	${cookieImport.selected_cookie_count}	` +
        `${cookieImport.accepted_cookie_count}	${cookieImport.browser_visible_cookie_count}	${cookieImport.selected_domain_count}`,
      );
      if (cookieImport.selected_cookie_count === 0) {
        warnings.push("No cookies from the selected file were applicable to this URL hostname.");
      }
      if (cookieImport.failed_cookie_count > 0) {
        warnings.push(`${cookieImport.failed_cookie_count} selected cookie(s) were rejected by Chromium.`);
      }
    }
    try { await client.send("Log.enable"); } catch { /* optional */ }
    await client.send("Emulation.setDeviceMetricsOverride", {
      width: Number(config.viewport_width) || 1440,
      height: Number(config.viewport_height) || 900,
      deviceScaleFactor: 1,
      mobile: false,
      screenWidth: Number(config.viewport_width) || 1440,
      screenHeight: Number(config.viewport_height) || 900,
    });

    const loadTimeoutMs = Math.max(5000, Number(config.page_load_timeout_seconds || 45) * 1000);
    const loadPromise = client.waitForEvent("Page.loadEventFired", loadTimeoutMs);
    loadPromise.catch(() => {});
    const navigation = await client.send("Page.navigate", { url }, loadTimeoutMs);
    if (navigation.errorText) throw new Error(`Navigation failed: ${navigation.errorText}`);
    mainFrameId = navigation.frameId || mainFrameId;

    try {
      await loadPromise;
    } catch (error) {
      warnings.push(`Page load event timeout: ${error.message || error}`);
      try { await client.send("Page.stopLoading"); } catch { /* best effort */ }
    }

    const networkQuiet = await waitForNetworkQuiet(networkState, 750, Math.min(10000, Math.max(2000, loadTimeoutMs / 4)));
    if (!networkQuiet) warnings.push("Network activity did not fully settle before capture.");

    const additionalWaitMs = Math.max(0, Math.min(60000, Number(config.additional_wait_seconds || 2) * 1000));
    if (additionalWaitMs) await delay(additionalWaitMs);

    const scrollResult = await performLazyScroll(client, config);
    if (scrollResult?.timed_out) warnings.push("Lazy-load scrolling reached its configured time limit.");

    const pageInfo = await evaluate(client, `({
      title: document.title || "",
      final_url: location.href,
      language: document.documentElement ? (document.documentElement.lang || "") : "",
      content_type: document.contentType || "",
      ready_state: document.readyState || "",
      viewport_width: window.innerWidth || 0,
      viewport_height: window.innerHeight || 0
    })`);

    const metrics = await client.send("Page.getLayoutMetrics");
    const contentSize = metrics.cssContentSize || metrics.contentSize || {};
    const layout = {
      width: Math.max(Number(contentSize.width) || 0, Number(config.viewport_width) || 1440),
      height: Math.max(Number(contentSize.height) || 0, Number(config.viewport_height) || 900),
    };

    let domain = "unknown-domain";
    try { domain = new URL(pageInfo.final_url || url).hostname || "unknown-domain"; } catch { /* keep fallback */ }
    const captureDate = new Date();
    const baseName = renderFilenameTemplate(config.filename_template, {
      date: captureDate,
      domain,
      title: pageInfo.title,
      index,
      mode: config.capture_mode,
      caseName: config.case_name || "",
    });

    const capture = await capturePage(client, config, runContext.webMediaFolder, baseName, layout);
    const pdfArtifacts = [];
    let pdfError = "";
    let pdfBehaviorInfo = {
      behavior: normalizePdfPageBehavior(config.pdf_page_behavior),
      applied: false,
      matched_elements: 0,
      modified_elements: 0,
      hidden_elements: 0,
      note: normalizePdfCaptureMode(config.pdf_capture_mode) === "paginated_png"
        ? "PDF will be generated by paginating the captured PNG."
        : "",
      sample_elements: [],
    };
    let pdfCaptureMode = normalizePdfCaptureMode(config.pdf_capture_mode);
    let pdfSourceInfo = null;
    if (config.create_pdf) {
      try {
        const pdfCapture = await capturePdf(client, config, runContext.webMediaFolder, baseName, {
          requested_url: url,
          final_url: pageInfo.final_url || url,
          page_title: pageInfo.title || "",
          capture_utc: startedAt,
        }, capture);
        pdfArtifacts.push(...pdfCapture.artifacts);
        pdfBehaviorInfo = pdfCapture.behavior || pdfBehaviorInfo;
        pdfCaptureMode = normalizePdfCaptureMode(pdfCapture.capture_mode || config.pdf_capture_mode);
        pdfSourceInfo = pdfCapture.source_info || null;
      } catch (error) {
        pdfError = `PDF capture failed: ${error.message || error}`;
        warnings.push(pdfError);
        console.log(pdfError);
      }
    }

    const mainResponse = networkState.documentResponses.length
      ? networkState.documentResponses[networkState.documentResponses.length - 1]
      : {};

    const allArtifacts = [...capture.artifacts, ...pdfArtifacts];
    const sidecar = {
      type: "avi-capture-gui-web-page-capture",
      schema_version: SCRIPT_SCHEMA_VERSION,
      app_version: config.app_version || "",
      launcher_script: basename(config.wrapper_script_path || "script-webcapture.ps1"),
      helper_script: basename(config.script_path || "script-webcapture.ts"),
      job_id: config.job_id || "",
      capture_index: index,
      capture_started_utc: startedAt,
      capture_completed_utc: nowIso(),
      requested_url: url,
      final_url: pageInfo.final_url || url,
      page_title: pageInfo.title || "",
      page_language: pageInfo.language || "",
      document_content_type: pageInfo.content_type || mainResponse.mimeType || "",
      document_ready_state: pageInfo.ready_state || "",
      http_status: Number(mainResponse.status) || null,
      http_status_text: mainResponse.statusText || "",
      main_response_url: mainResponse.url || "",
      main_response_headers: redactSensitiveHeaders(mainResponse.headers || {}),
      redirect_chain: networkState.redirects,
      browser_product: browserVersion.Browser || "",
      browser_user_agent: browserVersion["User-Agent"] || "",
      browser_protocol_version: browserVersion["Protocol-Version"] || "",
      browser_executable: config.browser_path,
      browser_profile_mode: "ephemeral app-owned user-data-dir",
      normal_browser_profile_accessed: false,
      cookies_imported: cookieImport.accepted_cookie_count > 0,
      cookie_import: {
        enabled: cookieImport.enabled,
        scope: cookieImport.scope,
        scope_label: cookieImport.scope_label,
        source_filename: cookieImport.source_filename,
        parsed_cookie_count: cookieImport.parsed_cookie_count,
        selected_cookie_count: cookieImport.selected_cookie_count,
        accepted_cookie_count: cookieImport.accepted_cookie_count,
        failed_cookie_count: cookieImport.failed_cookie_count,
        site_applicable_cookie_count: cookieImport.site_applicable_cookie_count,
        browser_visible_cookie_count: cookieImport.browser_visible_cookie_count,
        selected_domain_count: cookieImport.selected_domain_count,
        site_applicable_domain_count: cookieImport.site_applicable_domain_count,
        matching_cookie_count: cookieImport.site_applicable_cookie_count,
        matched_domain_count: cookieImport.site_applicable_domain_count,
        expired_rows_skipped: cookieImport.expired_rows_skipped,
        invalid_rows_skipped: cookieImport.invalid_rows_skipped,
        note: cookieImport.enabled
          ? (cookieImport.scope === "entire_file"
            ? "All valid cookie rows from the selected Netscape file were selected for loading into the isolated browser for redirect and SSO compatibility."
            : "Only cookies applicable to the submitted hostname were injected into the isolated browser profile.")
          : "Cookie-file use was disabled.",
      },
      viewport_width_css_px: Number(pageInfo.viewport_width) || Number(config.viewport_width) || 1440,
      viewport_height_css_px: Number(pageInfo.viewport_height) || Number(config.viewport_height) || 900,
      page_width_css_px: capture.page_width,
      page_height_css_px: capture.page_height,
      capture_mode: config.capture_mode === "viewport" ? "viewport" : "full_page",
      segmented: capture.segmented,
      lazy_scroll: scrollResult || {},
      load_timeout_seconds: Number(config.page_load_timeout_seconds) || 45,
      additional_wait_seconds: Number(config.additional_wait_seconds) || 0,
      proxy_used: Boolean(config.proxy_server),
      proxy_server: config.proxy_server ? String(config.proxy_server).replace(/:\/\/[^/@]+@/, "://***@") : "",
      universal_archive: {
        enabled: Boolean(config.universal_archive?.enabled),
        filename: String(config.universal_archive?.filename || ""),
        prior_match: false,
        record_requested_on_success: Boolean(config.universal_archive?.enabled),
        note: config.universal_archive?.enabled
          ? "The GUI records the requested and final URL in the app-level Webpage Capture SQLite archive after this capture completes successfully."
          : "The app-level Universal Download Archive setting was disabled for this run.",
      },
      pdf_options: {
        enabled: Boolean(config.create_pdf),
        landscape: Boolean(config.pdf_landscape),
        print_background: Boolean(config.pdf_print_background),
        display_header_footer: Boolean(config.pdf_display_header_footer),
        scale: Number(config.pdf_scale) || 1,
        paper_width_in: Number(config.pdf_paper_width_in) || 8.5,
        paper_height_in: Number(config.pdf_paper_height_in) || 11,
        margin_top_in: Number(config.pdf_margin_top_in) || 0,
        margin_bottom_in: Number(config.pdf_margin_bottom_in) || 0,
        margin_left_in: Number(config.pdf_margin_left_in) || 0,
        margin_right_in: Number(config.pdf_margin_right_in) || 0,
        page_ranges: String(config.pdf_page_ranges || ""),
        prefer_css_page_size: Boolean(config.pdf_prefer_css_page_size),
        header_template: String(config.pdf_header_template || ""),
        footer_template: String(config.pdf_footer_template || ""),
        capture_mode: pdfCaptureMode,
        page_behavior: normalizePdfPageBehavior(config.pdf_page_behavior),
        behavior_result: pdfBehaviorInfo,
        paginated_png_result: pdfSourceInfo,
        completed: !pdfError,
        error: pdfError,
      },
      warnings,
      browser_console_warnings_and_errors: consoleErrors,
      artifacts: allArtifacts.map((artifact) => ({
        ...artifact,
        path: artifact.path.startsWith(runContext.caseFolder)
          ? artifact.path.slice(runContext.caseFolder.length).replace(/^[\\/]+/, "")
          : artifact.path,
      })),
      statement: "Rendered visual capture of the webpage as presented by the selected browser at the recorded time.",
    };

    const sidecarPath = await uniqueOutputPath(runContext.webMediaFolder, baseName, ".webcapture.json");
    await Deno.writeTextFile(sidecarPath, JSON.stringify(sidecar, null, 2) + "\n");
    const sidecarInfo = await Deno.stat(sidecarPath);
    allArtifacts.push({
      kind: "capture_metadata_json",
      path: sidecarPath,
      sha256: await sha256File(sidecarPath),
      size_bytes: sidecarInfo.size,
    });

    return {
      artifacts: allArtifacts,
      sidecarPath,
      finalUrl: pageInfo.final_url || url,
      title: pageInfo.title || "",
      warnings,
      cookieImport,
      complete: !pdfError,
      error: pdfError,
    };
  } finally {
    client.removeEventListener(eventListener);
  }
}

async function launchBrowser(config) {
  await Deno.mkdir(config.profile_root, { recursive: true });
  const args = [
    "--headless=new",
    "--remote-debugging-address=127.0.0.1",
    "--remote-debugging-port=0",
    `--user-data-dir=${config.profile_root}`,
    `--window-size=${Number(config.viewport_width) || 1440},${Number(config.viewport_height) || 900}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-sync",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-extensions",
    "--disable-features=Translate,MediaRouter,OptimizationHints",
    "--allow-file-access-from-files",
    "--new-window",
  ];
  if (config.proxy_server) args.push(`--proxy-server=${config.proxy_server}`);
  args.push("about:blank");

  const child = new Deno.Command(config.browser_path, {
    args,
    stdin: "null",
    stdout: "null",
    stderr: "null",
  }).spawn();
  const statusPromise = child.status;
  const port = await waitForDevTools(config.profile_root, statusPromise, Number(config.browser_start_timeout_seconds || 20) * 1000);
  const pageTarget = await getPageTarget(port);
  const client = await connectWebSocket(pageTarget.webSocketDebuggerUrl, 15000);
  const version = await getBrowserVersion(port);
  return { child, statusPromise, port, client, version };
}

async function closeBrowser(browser) {
  if (!browser) return;
  try {
    await browser.client.send("Browser.close", {}, 5000);
  } catch {
    // Browser.close is best effort; process termination follows if needed.
  }
  try { browser.client.close(); } catch { /* ignore */ }

  let exited = false;
  await Promise.race([
    browser.statusPromise.then(() => { exited = true; }).catch(() => { exited = true; }),
    delay(5000),
  ]);
  if (!exited) {
    try { browser.child.kill("SIGTERM"); } catch { /* ignore */ }
    await Promise.race([browser.statusPromise.catch(() => {}), delay(3000)]);
  }
}

async function removeProfile(profileRoot) {
  if (!profileRoot) return true;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await Deno.remove(profileRoot, { recursive: true });
      return true;
    } catch {
      await delay(300);
    }
  }
  return false;
}

async function loadConfig() {
  const index = Deno.args.indexOf("--config");
  if (index < 0 || !Deno.args[index + 1]) throw new Error("Missing --config path.");
  const configPath = Deno.args[index + 1];
  const config = JSON.parse(await Deno.readTextFile(configPath));
  config.config_path = configPath;
  if (!config.browser_path) throw new Error("Browser path is missing.");
  if (!config.profile_root) throw new Error("Temporary browser profile path is missing.");
  return config;
}

async function main() {
  const config = await loadConfig();
  const cookieJar = config.use_cookies_file
    ? await loadNetscapeCookieFile(config.cookies_file)
    : emptyCookieJar();
  config.cookie_scope = normalizeCookieScope(config.cookie_scope);
  config.cookie_jar = cookieJar;
  let browser = null;
  let profileCleanupSucceeded = false;
  let failed = 0;
  let completed = 0;
  let skipped = 0;
  let logPath = "";
  const manifestRecords = [];
  const universalArchiveSkipRecords = [];

  const log = async (message) => {
    const line = `[${nowIso()}] ${String(message)}`;
    console.log(line);
    if (logPath) await Deno.writeTextFile(logPath, line + "\n", { append: true });
  };

  try {
    browser = await launchBrowser(config);
    console.log(`WEB_CAPTURE_BROWSER_READY\t${browser.version.Browser || basename(config.browser_path)}`);

    if (config.preflight_only) {
      if (cookieJar.enabled) {
        console.log(
          `WEB_CAPTURE_COOKIES_OK\t${cookieJar.stats.usable_cookie_rows}\t` +
          `${cookieJar.stats.domain_count}\t${cookieJar.source_filename}`,
        );
      }
      console.log(`WEB_CAPTURE_PREFLIGHT_OK\t${browser.version.Browser || basename(config.browser_path)}`);
      return 0;
    }

    const caseFolder = config.case_folder;
    const webMediaFolder = config.web_media_folder || joinPath(caseFolder, "media", "web");
    const logsFolder = config.logs_folder || joinPath(caseFolder, "logs");
    const manifestsFolder = config.manifests_folder || joinPath(caseFolder, "manifests");
    if (!caseFolder) throw new Error("Case folder is missing.");
    await Deno.mkdir(webMediaFolder, { recursive: true });
    await Deno.mkdir(logsFolder, { recursive: true });
    await Deno.mkdir(manifestsFolder, { recursive: true });

    const runStamp = stampUtc();
    logPath = joinPath(logsFolder, `web-capture_${runStamp}.log`);
    await Deno.writeTextFile(logPath, "");
    const manifestPath = joinPath(manifestsFolder, `sha256-manifest-web_${runStamp}.csv`);
    const runContext = { caseFolder, webMediaFolder, logsFolder, manifestsFolder, manifestPath };

    await log("Webpage Capture started.");
    await log(`Browser: ${browser.version.Browser || basename(config.browser_path)}`);
    await log(`Browser executable: ${config.browser_path}`);
    await log(`Profile: ephemeral app-owned profile (${config.profile_root})`);
    if (cookieJar.enabled) {
      await log(
        `Cookies file: enabled (${cookieJar.stats.usable_cookie_rows} usable cookie row(s) across ` +
        `${cookieJar.stats.domain_count} domain(s); ${cookieJar.source_filename}).`,
      );
      await log(`Cookie scope: ${cookieScopeLabel(config.cookie_scope)}.`);
      await log("Normal browser profiles and their stored cookies were not accessed.");
    } else {
      await log("Cookies file: disabled.");
    }
    if (config.universal_archive?.enabled) {
      await log(`Universal Webpage archive: enabled (${String(config.universal_archive.filename || "universal-webcapture-archive.sqlite3")}).`);
    } else {
      await log("Universal Webpage archive: disabled.");
    }
    await log(`Capture mode: ${config.capture_mode === "viewport" ? "viewport" : "full page"}`);
    await log(`Submitted URLs: ${(config.urls || []).length}`);

    const urls = Array.isArray(config.urls) ? config.urls : [];
    for (let i = 0; i < urls.length; i += 1) {
      const url = String(urls[i] || "").trim();
      if (!/^https?:\/\//i.test(url)) {
        failed += 1;
        await log(`URL ${i + 1}/${urls.length} rejected because it is not HTTP/HTTPS: ${url}`);
        console.log(`GUI_QUEUE_URL_INCOMPLETE\t${i + 1}\t${urls.length}\t${url}`);
        continue;
      }

      const archiveSkip = config.universal_archive?.enabled
        ? config.universal_archive?.skips?.[String(i + 1)]
        : null;
      if (archiveSkip) {
        skipped += 1;
        const archiveId = String(archiveSkip.archive_id || "web:unknown").replace(/[\t\r\n]+/g, " ");
        const safeUrl = url.replace(/[\t\r\n]+/g, " ");
        const skipRecord = {
          url_index: i + 1,
          url_total: urls.length,
          archive_id: archiveId,
          submitted_url: url,
          matched_role: String(archiveSkip.matched_role || ""),
          previous_requested_url: String(archiveSkip.requested_url || ""),
          previous_final_url: String(archiveSkip.final_url || ""),
          previous_capture_utc: String(archiveSkip.captured_at_utc || ""),
          previous_case_name: String(archiveSkip.case_name || ""),
        };
        universalArchiveSkipRecords.push(skipRecord);
        await log(
          `URL ${i + 1}/${urls.length} skipped by Universal Webpage archive: ${archiveId} | ${url}`,
        );
        console.log(`GUI_UNIVERSAL_ARCHIVE_SKIP\t${i + 1}\t${urls.length}\t${archiveId}\t${safeUrl}`);
        console.log(`GUI_QUEUE_URL_COMPLETE\t${i + 1}\t${urls.length}\t${safeUrl}`);
        continue;
      }

      await log(`URL ${i + 1}/${urls.length}: ${url}`);
      try {
        const result = await captureUrl(browser.client, config, url, i + 1, browser.version, runContext);
        for (const artifact of result.artifacts) manifestRecords.push(artifact);
        await log(`Captured: ${result.finalUrl}`);
        await log(`Title: ${result.title || "(untitled)"}`);
        if (result.cookieImport?.enabled) {
          await log(
            `Cookies for URL (${result.cookieImport.scope_label}): ${result.cookieImport.accepted_cookie_count} of ` +
            `${result.cookieImport.selected_cookie_count} selected cookie(s) loaded from ` +
            `${result.cookieImport.selected_domain_count} domain(s); ` +
            `${result.cookieImport.browser_visible_cookie_count} visible to the submitted URL.`,
          );
        }
        if (result.warnings.length) await log(`Warnings: ${result.warnings.join(" | ")}`);
        if (result.complete) {
          completed += 1;
          if (config.universal_archive?.enabled) {
            const capturedAtUtc = nowIso();
            const eventSeed = [
              String(config.job_id || ""),
              String(i + 1),
              url,
              String(result.finalUrl || url),
              String(result.sidecarPath || ""),
              capturedAtUtc,
            ].join("\n");
            const archivePayload = {
              event_id: await sha256Bytes(new TextEncoder().encode(eventSeed)),
              requested_url: url,
              final_url: result.finalUrl || url,
              captured_at_utc: capturedAtUtc,
              case_name: String(config.case_name || ""),
              job_id: String(config.job_id || ""),
              sidecar_path: String(result.sidecarPath || ""),
            };
            console.log(`GUI_WEB_UNIVERSAL_ARCHIVE_RECORD\t${JSON.stringify(archivePayload)}`);
          }
          console.log(`GUI_QUEUE_URL_COMPLETE\t${i + 1}\t${urls.length}\t${url}`);
        } else {
          failed += 1;
          await log(`ERROR: ${result.error || "A requested Webpage Capture artifact was not created."}`);
          console.log(`GUI_QUEUE_URL_INCOMPLETE\t${i + 1}\t${urls.length}\t${url}`);
        }
      } catch (error) {
        failed += 1;
        await log(`ERROR capturing ${url}: ${error?.stack || error?.message || error}`);
        console.log(`GUI_QUEUE_URL_INCOMPLETE\t${i + 1}\t${urls.length}\t${url}`);
      }
    }

    await log(`Captured URLs: ${completed}`);
    await log(`Universal archive skipped URLs: ${skipped}`);
    await log(`Failed URLs: ${failed}`);
    await log(`Case folder: ${caseFolder}`);

    if (universalArchiveSkipRecords.length > 0) {
      const skipJsonPath = joinPath(manifestsFolder, `universal-webcapture-archive-skips_${runStamp}.json`);
      const skipCsvPath = joinPath(manifestsFolder, `universal-webcapture-archive-skips_${runStamp}.csv`);
      await Deno.writeTextFile(
        skipJsonPath,
        JSON.stringify({
          type: "wavi-webpage-universal-archive-skips",
          schema_version: 1,
          generated_utc: nowIso(),
          archive_filename: String(config.universal_archive?.filename || ""),
          skipped_count: universalArchiveSkipRecords.length,
          records: universalArchiveSkipRecords,
        }, null, 2) + "\n",
      );
      const skipCsvRows = [
        [
          "URL Index", "URL Total", "Archive ID", "Submitted URL", "Matched Role",
          "Previous Requested URL", "Previous Final URL", "Previous Capture UTC", "Previous Case Name",
        ].map(csvQuote).join(","),
      ];
      for (const record of universalArchiveSkipRecords) {
        skipCsvRows.push([
          record.url_index,
          record.url_total,
          record.archive_id,
          record.submitted_url,
          record.matched_role,
          record.previous_requested_url,
          record.previous_final_url,
          record.previous_capture_utc,
          record.previous_case_name,
        ].map(csvQuote).join(","));
      }
      await Deno.writeTextFile(skipCsvPath, skipCsvRows.join("\n") + "\n");
      for (const [kind, path] of [
        ["universal_archive_skip_json", skipJsonPath],
        ["universal_archive_skip_csv", skipCsvPath],
      ]) {
        const info = await Deno.stat(path);
        manifestRecords.push({ kind, path, sha256: await sha256File(path), size_bytes: info.size });
      }
      console.log(
        `GUI_UNIVERSAL_ARCHIVE_SKIP_SUMMARY\t${universalArchiveSkipRecords.length}\t${skipJsonPath}\t${skipCsvPath}`,
      );
    }

    const logInfo = await Deno.stat(logPath);
    manifestRecords.push({ kind: "run_log", path: logPath, sha256: await sha256File(logPath), size_bytes: logInfo.size });

    const rows = ['"Algorithm","Hash","Path"'];
    const seen = new Set();
    for (const record of manifestRecords) {
      if (!record?.path || seen.has(record.path)) continue;
      seen.add(record.path);
      const hash = record.sha256 || await sha256File(record.path);
      rows.push([csvQuote("SHA256"), csvQuote(hash), csvQuote(record.path)].join(","));
    }
    await Deno.writeTextFile(manifestPath, rows.join("\n") + "\n");
    console.log(`WEB_CAPTURE_MANIFEST\t${manifestPath}`);
    console.log(`WEB_CAPTURE_SUMMARY\tcaptured=${completed}\tskipped=${skipped}\tfailed=${failed}`);
    return failed > 0 ? 1 : 0;
  } finally {
    await closeBrowser(browser);
    profileCleanupSucceeded = await removeProfile(config.profile_root);
    console.log(`WEB_CAPTURE_PROFILE_CLEANUP\t${profileCleanupSucceeded ? "complete" : "incomplete"}\t${config.profile_root}`);
  }
}

try {
  const exitCode = await main();
  Deno.exit(exitCode);
} catch (error) {
  console.error(`WEB_CAPTURE_FATAL\t${error?.stack || error?.message || error}`);
  Deno.exit(2);
}
