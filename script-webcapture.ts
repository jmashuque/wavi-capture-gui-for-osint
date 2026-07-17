/*
WAVI Capture GUI for OSINT - Webpage Capture helper

This helper intentionally uses only built-in Deno and Chromium capabilities.
It launches a selected installed Chromium-family browser with a unique app-owned
--user-data-dir, connects over loopback through the Chrome DevTools Protocol,
and never reads the user's normal browser profile or cookie databases. When
explicitly enabled, it may read a user-selected Netscape cookies.txt file and
inject either site-applicable cookies or the entire file into the isolated browser session.
*/

const SCRIPT_SCHEMA_VERSION = 6;

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

async function importCookiesForUrl(client, cookieJar, targetUrl, requestedScope, options = {}) {
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

  // Cookie clearing is normally performed by the Environment & State preparation
  // stage before import. Keep the historical default here for direct helper use.
  if (options.clear_first !== false) {
    await client.send("Network.clearBrowserCookies", {}, 15000);
  }
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
    "%engine%": "webpage",
    "%domain%": safeFileComponent(context.domain, "unknown-domain", 90),
    "%title%": safeFileComponent(context.title, "untitled", 120),
    "%index%": String(context.index).padStart(3, "0"),
    "%mode%": context.mode === "viewport" ? "viewport" : (context.mode === "both" ? "full-page-and-viewport" : "full-page"),
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

function normalizeCaptureMode(value) {
  const mode = String(value || "full_page").trim();
  if (["full_page", "viewport", "both"].includes(mode)) return mode;
  return "full_page";
}

function normalizeImageFormat(value) {
  const format = String(value || "png").trim().toLowerCase();
  if (["png", "jpeg", "webp"].includes(format)) return format;
  return "png";
}

function normalizeImageQuality(value) {
  return Math.max(1, Math.min(100, Math.round(Number(value) || 90)));
}

function normalizeOrientation(value) {
  return String(value || "landscape").trim() === "portrait" ? "portrait" : "landscape";
}

function normalizeColorScheme(value) {
  const scheme = String(value || "default").trim().toLowerCase();
  return ["default", "light", "dark"].includes(scheme) ? scheme : "default";
}

function normalizeStorageClearMode(value) {
  const mode = String(value || "none").trim();
  return ["none", "requested_origin", "all_visited_origins"].includes(mode) ? mode : "none";
}

function normalizeLocale(value) {
  const locale = String(value || "default").trim();
  return !locale || locale.toLowerCase() === "default" ? "default" : locale;
}

function normalizeTimezone(value) {
  const timezone = String(value || "default").trim();
  return !timezone || timezone.toLowerCase() === "default" ? "default" : timezone;
}

function environmentPresetLabel(value) {
  return {
    desktop_1920x1080: "Desktop 1920 × 1080",
    desktop_1440x900: "Desktop 1440 × 900",
    desktop_1366x768: "Desktop 1366 × 768",
    tablet_portrait: "Tablet portrait",
    tablet_landscape: "Tablet landscape",
    mobile_portrait: "Mobile portrait",
    mobile_landscape: "Mobile landscape",
    custom: "Custom",
  }[String(value || "custom").trim()] || "Custom";
}

function storageClearModeLabel(value) {
  return {
    none: "Keep site storage",
    requested_origin: "Clear requested origin",
    all_visited_origins: "Clear all visited origins",
  }[normalizeStorageClearMode(value)];
}

function safeHttpOrigin(value) {
  try {
    const parsed = new URL(String(value || ""));
    return /^https?:$/.test(parsed.protocol) ? parsed.origin : "";
  } catch {
    return "";
  }
}

function normalizeReadinessEvent(value) {
  return String(value || "load").trim() === "dom_content_loaded" ? "dom_content_loaded" : "load";
}

function readinessEventMethod(value) {
  return normalizeReadinessEvent(value) === "dom_content_loaded"
    ? "Page.domContentEventFired"
    : "Page.loadEventFired";
}

function readinessEventLabel(value) {
  return normalizeReadinessEvent(value) === "dom_content_loaded"
    ? "DOM content loaded"
    : "Full page load";
}

function normalizeReadinessTimeoutAction(value) {
  const action = String(value || "capture_warning").trim();
  if (["capture_warning", "stop_and_capture", "fail"].includes(action)) return action;
  return "capture_warning";
}

function readinessTimeoutActionLabel(value) {
  return {
    capture_warning: "Capture with warning",
    stop_and_capture: "Stop loading and capture",
    fail: "Fail URL",
  }[normalizeReadinessTimeoutAction(value)];
}

function normalizeGrowthLimitAction(value) {
  const action = String(value || "capture_partial").trim();
  if (["capture_partial", "capture_warning", "fail"].includes(action)) return action;
  return "capture_partial";
}

function growthLimitActionLabel(value) {
  return {
    capture_partial: "Capture partial",
    capture_warning: "Capture with warning",
    fail: "Fail URL",
  }[normalizeGrowthLimitAction(value)];
}

function normalizeCaptureFixedStickyBehavior(value) {
  return normalizePdfPageBehavior(value);
}

function buildCaptureCompleteness(partialReasons, warningReasons, warnings, requestedArtifactErrors, visualArtifactCount) {
  const partial = [...new Set(Array.isArray(partialReasons) ? partialReasons : [])];
  const warning = [...new Set(Array.isArray(warningReasons) ? warningReasons : [])];
  const requestedErrors = Array.isArray(requestedArtifactErrors)
    ? requestedArtifactErrors.filter((entry) => entry && String(entry.error || entry).trim())
    : [];
  const hasWarnings = warning.length > 0 || (Array.isArray(warnings) && warnings.length > 0);
  const classification = requestedErrors.length
    ? "failed"
    : (partial.length ? "partial" : (hasWarnings ? "complete_with_warnings" : "complete"));
  return {
    classification,
    visual_capture_complete: Number(visualArtifactCount) > 0,
    requested_artifacts_complete: requestedErrors.length === 0,
    requested_artifact_errors: requestedErrors,
    partial_reasons: partial,
    warning_reasons: warning,
    note: classification === "partial"
      ? "The bounded capture completed, but one or more configured limits prevented full-page completeness."
      : (classification === "failed"
        ? "One or more requested outputs failed even though partial artifacts may exist."
        : "The requested bounded capture completed."),
  };
}

function normalizeNetworkQueryMode(value) {
  return String(value || "redact_values").trim() === "include_full" ? "include_full" : "redact_values";
}

function sanitizeEvidenceUrl(value, queryMode = "redact_values") {
  const text = String(value || "");
  try {
    const parsed = new URL(text);
    parsed.username = "";
    parsed.password = "";
    parsed.hash = "";
    if (normalizeNetworkQueryMode(queryMode) !== "include_full" && parsed.search) {
      const sanitized = new URLSearchParams();
      for (const [name] of parsed.searchParams.entries()) sanitized.append(name, "<redacted>");
      parsed.search = sanitized.toString();
    }
    return parsed.toString();
  } catch {
    return text.replace(/([?&][^=&#\s]+)=([^&#\s]*)/g, "$1=<redacted>").replace(/#.*$/, "");
  }
}

function boundedText(value, maximum = 4000) {
  const text = String(value ?? "");
  return text.length > maximum ? `${text.slice(0, maximum)}…<truncated>` : text;
}

function safeConsoleArgument(arg) {
  if (!arg || typeof arg !== "object") return boundedText(arg);
  if (arg.value !== undefined) {
    try { return boundedText(typeof arg.value === "string" ? arg.value : JSON.stringify(arg.value)); }
    catch { return boundedText(arg.value); }
  }
  return boundedText(arg.description || arg.className || arg.type || "");
}

async function addTextArtifact(artifacts, kind, folder, baseName, suffix, extension, content) {
  const path = await uniqueOutputPath(folder, `${baseName}${suffix}`, extension);
  await Deno.writeTextFile(path, String(content ?? ""));
  const info = await Deno.stat(path);
  artifacts.push({ kind, path, sha256: await sha256File(path), size_bytes: info.size });
  return path;
}

async function addBytesArtifact(artifacts, kind, folder, baseName, suffix, extension, bytes) {
  const path = await uniqueOutputPath(folder, `${baseName}${suffix}`, extension);
  await Deno.writeFile(path, bytes);
  const info = await Deno.stat(path);
  artifacts.push({ kind, path, sha256: await sha256File(path), size_bytes: info.size });
  return path;
}

async function addJsonArtifact(artifacts, kind, folder, baseName, suffix, payload) {
  return await addTextArtifact(artifacts, kind, folder, baseName, suffix, ".json", JSON.stringify(payload, null, 2) + "\n");
}

function sanitizeNetworkRecord(record, queryMode) {
  return {
    request_id: String(record.request_id || ""),
    url: sanitizeEvidenceUrl(record.url, queryMode),
    document_url: sanitizeEvidenceUrl(record.document_url, queryMode),
    method: String(record.method || ""),
    resource_type: String(record.resource_type || ""),
    frame_id: String(record.frame_id || ""),
    timestamp: Number(record.timestamp) || null,
    wall_time: Number(record.wall_time) || null,
    initiator_type: String(record.initiator_type || ""),
    has_post_data: Boolean(record.has_post_data),
    request_headers: redactSensitiveHeaders(record.request_headers || {}),
    response: record.response ? {
      url: sanitizeEvidenceUrl(record.response.url, queryMode),
      status: Number(record.response.status) || null,
      status_text: String(record.response.statusText || ""),
      mime_type: String(record.response.mimeType || ""),
      protocol: String(record.response.protocol || ""),
      remote_ip_address: String(record.response.remoteIPAddress || ""),
      remote_port: Number(record.response.remotePort) || null,
      from_disk_cache: Boolean(record.response.fromDiskCache),
      from_service_worker: Boolean(record.response.fromServiceWorker),
      from_prefetch_cache: Boolean(record.response.fromPrefetchCache),
      encoded_data_length: Number(record.response.encodedDataLength) || null,
      response_headers: redactSensitiveHeaders(record.response.headers || {}),
    } : null,
    completed: Boolean(record.completed),
    encoded_data_length: Number(record.encoded_data_length) || null,
    failed: Boolean(record.failed),
    canceled: Boolean(record.canceled),
    error_text: String(record.error_text || ""),
    blocked_reason: String(record.blocked_reason || ""),
    cors_error_status: record.cors_error_status || null,
    redirect: record.redirect ? {
      status: Number(record.redirect.status) || null,
      status_text: String(record.redirect.statusText || ""),
      from_url: sanitizeEvidenceUrl(record.redirect.url, queryMode),
      to_url: sanitizeEvidenceUrl(record.url, queryMode),
    } : null,
  };
}

function sanitizeConsoleStackTrace(stackTrace, queryMode) {
  if (!stackTrace || typeof stackTrace !== "object") return stackTrace || null;
  const output = { ...stackTrace };
  if (Array.isArray(stackTrace.callFrames)) {
    output.callFrames = stackTrace.callFrames.map((frame) => ({
      ...frame,
      url: sanitizeEvidenceUrl(frame?.url || "", queryMode),
    }));
  }
  if (stackTrace.parent) output.parent = sanitizeConsoleStackTrace(stackTrace.parent, queryMode);
  return output;
}

function sanitizeConsoleEntry(entry, queryMode) {
  return {
    ...(entry || {}),
    url: sanitizeEvidenceUrl(entry?.url || "", queryMode),
    stack_trace: sanitizeConsoleStackTrace(entry?.stack_trace, queryMode),
  };
}

async function getCurrentSecurityMetadata(client, pageInfo, mainResponse, securityState, queryMode = "redact_values") {
  let pageSecurity = {};
  try {
    pageSecurity = await evaluate(client, `({
      is_secure_context: Boolean(window.isSecureContext),
      origin: location.origin || "",
      protocol: location.protocol || "",
      cross_origin_isolated: Boolean(window.crossOriginIsolated)
    })`, 10000);
  } catch { /* best effort */ }
  const details = mainResponse?.securityDetails || {};
  const latestVisible = Array.isArray(securityState?.visible) && securityState.visible.length
    ? securityState.visible[securityState.visible.length - 1]
    : null;
  const latestLegacy = Array.isArray(securityState?.legacy) && securityState.legacy.length
    ? securityState.legacy[securityState.legacy.length - 1]
    : null;
  return {
    page: pageSecurity,
    main_response: {
      url: sanitizeEvidenceUrl(mainResponse?.url || pageInfo?.final_url || "", queryMode),
      protocol: String(mainResponse?.protocol || ""),
      security_state: String(mainResponse?.securityState || latestLegacy?.securityState || ""),
      certificate_subject: String(details.subjectName || ""),
      certificate_issuer: String(details.issuer || ""),
      certificate_valid_from_utc: details.validFrom ? new Date(Number(details.validFrom) * 1000).toISOString() : "",
      certificate_valid_to_utc: details.validTo ? new Date(Number(details.validTo) * 1000).toISOString() : "",
      certificate_protocol: String(details.protocol || ""),
      key_exchange: String(details.keyExchange || ""),
      key_exchange_group: String(details.keyExchangeGroup || ""),
      cipher: String(details.cipher || ""),
      certificate_transparency_compliance: String(details.certificateTransparencyCompliance || ""),
      encrypted_client_hello: Boolean(details.encryptedClientHello),
    },
    visible_security_state: latestVisible,
    legacy_security_state: latestLegacy,
    certificate_errors: Array.isArray(securityState?.certificateErrors)
      ? securityState.certificateErrors.map((entry) => ({
        ...entry,
        request_url: sanitizeEvidenceUrl(entry?.request_url || "", queryMode),
      }))
      : [],
    note: "Security details are browser-reported metadata. Certificate errors were not bypassed.",
  };
}

async function captureSupplementalEvidence(client, config, context) {
  const artifacts = [];
  const errors = [];
  const results = {};
  const requested = {
    mhtml: Boolean(config.save_mhtml),
    response_html: Boolean(config.save_response_html),
    rendered_dom: Boolean(config.save_rendered_dom),
    network_report: Boolean(config.save_network_report),
    console_report: Boolean(config.save_console_report),
    failed_request_report: Boolean(config.save_failed_request_report),
    security_report: Boolean(config.save_security_report),
  };
  const run = async (name, fn) => {
    if (!requested[name]) return;
    try { results[name] = { requested: true, completed: true, path: await fn() }; }
    catch (error) {
      const message = String(error?.message || error);
      errors.push({ artifact: name, error: message });
      results[name] = { requested: true, completed: false, error: message };
    }
  };

  await run("mhtml", async () => {
    const snapshot = await client.send("Page.captureSnapshot", { format: "mhtml" }, 60000);
    if (!snapshot?.data) throw new Error("Chromium returned an empty MHTML snapshot.");
    return await addTextArtifact(artifacts, "webpage_mhtml", context.folder, context.baseName, "", ".mhtml", snapshot.data);
  });

  await run("response_html", async () => {
    const requestId = String(context.mainDocumentEntry?.request_id || "");
    const mimeType = String(context.mainResponse?.mimeType || context.pageInfo?.content_type || "").toLowerCase();
    if (!requestId) throw new Error("The final main-document request ID was unavailable.");
    if (mimeType && !mimeType.includes("html") && !mimeType.includes("xhtml")) {
      throw new Error(`The final main document was not HTML (${mimeType}).`);
    }
    const body = await client.send("Network.getResponseBody", { requestId }, 30000);
    if (body?.base64Encoded) {
      return await addBytesArtifact(artifacts, "final_response_html", context.folder, context.baseName, ".response", ".html", bytesFromBase64(body.body || ""));
    }
    return await addTextArtifact(artifacts, "final_response_html", context.folder, context.baseName, ".response", ".html", body?.body || "");
  });

  await run("rendered_dom", async () => {
    const html = await evaluate(client, `(() => {
      const doctype = document.doctype
        ? "<!DOCTYPE " + document.doctype.name + (document.doctype.publicId ? ' PUBLIC "' + document.doctype.publicId + '"' : '') + (document.doctype.systemId ? ' "' + document.doctype.systemId + '"' : '') + ">\\n"
        : "";
      return doctype + (document.documentElement ? document.documentElement.outerHTML : "");
    })()`, 30000);
    return await addTextArtifact(artifacts, "rendered_dom_html", context.folder, context.baseName, ".rendered", ".html", html || "");
  });

  await run("network_report", async () => {
    const queryMode = normalizeNetworkQueryMode(config.network_query_mode);
    const active = Array.from(context.networkState.requests.values());
    const records = [...context.networkState.records, ...active].slice(0, 5000).map((entry) => sanitizeNetworkRecord(entry, queryMode));
    return await addJsonArtifact(artifacts, "sanitized_network_report", context.folder, context.baseName, ".network", {
      type: "wavi-webpage-network-report",
      schema_version: 1,
      generated_utc: nowIso(),
      requested_url: sanitizeEvidenceUrl(context.requestedUrl, queryMode),
      final_url: sanitizeEvidenceUrl(context.pageInfo?.final_url, queryMode),
      query_handling: queryMode,
      sensitive_headers_redacted: ["Authorization", "Proxy-Authorization", "Cookie", "Set-Cookie"],
      request_bodies_recorded: false,
      record_limit: 5000,
      records_truncated: Number(context.networkState.records_dropped || 0) > 0 || context.networkState.records.length + active.length > 5000,
      records_dropped: Number(context.networkState.records_dropped || 0),
      record_count: records.length,
      records,
    });
  });

  await run("console_report", async () => {
    const queryMode = normalizeNetworkQueryMode(config.network_query_mode);
    const entries = context.consoleEntries.slice(0, 500).map((entry) => sanitizeConsoleEntry(entry, queryMode));
    return await addJsonArtifact(artifacts, "browser_console_report", context.folder, context.baseName, ".console", {
      type: "wavi-webpage-console-report",
      schema_version: 1,
      generated_utc: nowIso(),
      query_handling: queryMode,
      entry_limit: 500,
      entries_truncated: Number(context.consoleEntriesDropped || 0) > 0,
      entries_dropped: Number(context.consoleEntriesDropped || 0),
      entry_count: entries.length,
      page_supplied_messages_may_contain_sensitive_content: true,
      entries,
    });
  });

  await run("failed_request_report", async () => {
    const queryMode = normalizeNetworkQueryMode(config.network_query_mode);
    const entries = context.networkState.failedRequests.slice(0, 1000).map((entry) => sanitizeNetworkRecord(entry, queryMode));
    return await addJsonArtifact(artifacts, "failed_request_report", context.folder, context.baseName, ".failed-requests", {
      type: "wavi-webpage-failed-request-report",
      schema_version: 1,
      generated_utc: nowIso(),
      query_handling: queryMode,
      entry_limit: 1000,
      entries_truncated: Number(context.networkState.failed_requests_dropped || 0) > 0,
      entries_dropped: Number(context.networkState.failed_requests_dropped || 0),
      entry_count: entries.length,
      entries,
    });
  });

  await run("security_report", async () => {
    const security = await getCurrentSecurityMetadata(
      client, context.pageInfo, context.mainResponse, context.securityState, config.network_query_mode,
    );
    return await addJsonArtifact(artifacts, "browser_security_report", context.folder, context.baseName, ".security", {
      type: "wavi-webpage-security-report",
      schema_version: 1,
      generated_utc: nowIso(),
      requested_url: sanitizeEvidenceUrl(context.requestedUrl, config.network_query_mode),
      final_url: sanitizeEvidenceUrl(context.pageInfo?.final_url || context.requestedUrl, config.network_query_mode),
      ...security,
    });
  });

  return { requested, results, errors, artifacts };
}

async function captureFailureEvidence(client, config, url, index, browserVersion, runContext, error) {
  if (!config.save_failure_screenshot) return { artifacts: [], metadataPath: "", screenshotPath: "" };
  const artifacts = [];
  let pageInfo = { title: "", final_url: url, content_type: "", ready_state: "" };
  try {
    pageInfo = await evaluate(client, `({
      title: document.title || "",
      final_url: location.href || "",
      content_type: document.contentType || "",
      ready_state: document.readyState || ""
    })`, 10000);
  } catch { /* best effort */ }
  let domain = "unknown-domain";
  try { domain = new URL(pageInfo.final_url || url).hostname || domain; } catch { /* fallback */ }
  const baseName = renderFilenameTemplate(config.filename_template, {
    date: new Date(), domain, title: pageInfo.title || "capture-failure", index,
    mode: normalizeCaptureMode(config.capture_mode), caseName: config.case_name || "",
  });
  let screenshotPath = "";
  let screenshotError = "";
  try {
    const screenshot = await client.send("Page.captureScreenshot", { format: "png", fromSurface: true }, 30000);
    if (!screenshot?.data) throw new Error("Chromium returned no screenshot data.");
    screenshotPath = await addBytesArtifact(artifacts, "failure_screenshot", runContext.webMediaFolder, baseName, ".failure", ".png", bytesFromBase64(screenshot.data));
  } catch (screenshotFailure) {
    screenshotError = String(screenshotFailure?.message || screenshotFailure);
  }
  let security = {};
  try { security = await getCurrentSecurityMetadata(client, pageInfo, {}, { visible: [], legacy: [], certificateErrors: [] }); }
  catch { /* best effort */ }
  const metadataPath = await addJsonArtifact(artifacts, "failure_metadata_json", runContext.webMediaFolder, baseName, ".webcapture-failure", {
    type: "wavi-webpage-capture-failure",
    schema_version: 1,
    app_version: config.app_version || "",
    capture_failed_utc: nowIso(),
    requested_url: url,
    final_url: pageInfo.final_url || url,
    page_title: pageInfo.title || "",
    document_content_type: pageInfo.content_type || "",
    document_ready_state: pageInfo.ready_state || "",
    browser_product: browserVersion?.Browser || "",
    browser_executable: config.browser_path || "",
    normal_browser_profile_accessed: false,
    capture_completeness: { classification: "failed", requested_artifacts_complete: false },
    error: String(error?.stack || error?.message || error),
    failure_screenshot: {
      requested: true,
      completed: Boolean(screenshotPath),
      path: screenshotPath ? screenshotPath.slice(runContext.caseFolder.length).replace(/^[\/]+/, "") : "",
      error: screenshotError,
    },
    security,
  });
  return { artifacts, metadataPath, screenshotPath };
}

function getImageEncoding(config) {
  const format = normalizeImageFormat(config.image_format);
  const quality = normalizeImageQuality(config.image_quality);
  return {
    format,
    quality,
    extension: format === "jpeg" ? ".jpg" : `.${format}`,
    cdpOptions: format === "png" ? { format } : { format, quality },
  };
}

class CaptureStageError extends Error {
  constructor(message, cause = null) {
    super(message);
    this.name = "CaptureStageError";
    this.stage = "capture";
    this.cause = cause;
  }
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

async function applyCaptureStabilization(client, config) {
  const behavior = normalizeCaptureFixedStickyBehavior(config.fixed_sticky_behavior);
  const disableAnimations = Boolean(config.disable_animations);
  const disableTransitions = Boolean(config.disable_transitions);
  const hideScrollbars = Boolean(config.hide_scrollbars);
  if (!disableAnimations && !disableTransitions && !hideScrollbars && behavior === "preserve_layout") {
    return {
      applied: false,
      disable_animations: false,
      disable_transitions: false,
      hide_scrollbars: false,
      fixed_sticky_behavior: behavior,
      matched_elements: 0,
      modified_elements: 0,
      hidden_elements: 0,
      note: "No visual stabilization changes were requested.",
      sample_elements: [],
    };
  }

  const expression = `(() => {
    const DISABLE_ANIMATIONS = ${JSON.stringify(disableAnimations)};
    const DISABLE_TRANSITIONS = ${JSON.stringify(disableTransitions)};
    const HIDE_SCROLLBARS = ${JSON.stringify(hideScrollbars)};
    const MODE = ${JSON.stringify(behavior)};
    const STYLE_ID = "__wavi_capture_stability_style__";
    const ATTR = "data-wavi-capture-stability-id";
    const oldStyle = document.getElementById(STYLE_ID);
    if (oldStyle) oldStyle.remove();
    for (const node of document.querySelectorAll("[" + ATTR + "]")) node.removeAttribute(ATTR);

    const viewportWidth = Math.max(window.innerWidth || 0, document.documentElement?.clientWidth || 0, 1);
    const viewportHeight = Math.max(window.innerHeight || 0, document.documentElement?.clientHeight || 0, 1);
    const keywordPattern = /(nav|header|menu|toolbar|masthead|topbar|banner|cookie|consent)/i;
    const matched = [];
    const selected = [];
    let nextId = 1;

    if (MODE !== "preserve_layout") {
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
    }

    const cssRules = [];
    if (DISABLE_ANIMATIONS) cssRules.push("*,*::before,*::after{animation:none !important;animation-delay:0s !important;animation-duration:0s !important;animation-iteration-count:1 !important;}");
    if (DISABLE_TRANSITIONS) cssRules.push("*,*::before,*::after{transition:none !important;transition-delay:0s !important;transition-duration:0s !important;}");
    if (HIDE_SCROLLBARS) cssRules.push("html,body{scrollbar-width:none !important;}html::-webkit-scrollbar,body::-webkit-scrollbar,*::-webkit-scrollbar{width:0 !important;height:0 !important;display:none !important;}");
    for (const item of selected) {
      const selector = "[" + ATTR + "=\\\"" + item.id + "\\\"]";
      cssRules.push(MODE === "hide_likely_navigation_overlays"
        ? selector + "{display:none !important;visibility:hidden !important;}"
        : selector + "{position:static !important;top:auto !important;right:auto !important;bottom:auto !important;left:auto !important;inset:auto !important;transform:none !important;}");
    }
    if (cssRules.length) {
      const styleTag = document.createElement("style");
      styleTag.id = STYLE_ID;
      styleTag.textContent = cssRules.join("\\n");
      (document.head || document.documentElement).appendChild(styleTag);
    }
    return {
      applied: cssRules.length > 0,
      disable_animations: DISABLE_ANIMATIONS,
      disable_transitions: DISABLE_TRANSITIONS,
      hide_scrollbars: HIDE_SCROLLBARS,
      fixed_sticky_behavior: MODE,
      matched_elements: matched.length,
      modified_elements: selected.length,
      hidden_elements: MODE === "hide_likely_navigation_overlays" ? selected.length : 0,
      note: cssRules.length ? "Applied explicit visual stabilization settings for image capture." : "No visual stabilization rules were applied.",
      sample_elements: selected.slice(0, 12).map((item) => ({
        tag: item.tag, role: item.role, top: item.top, width: item.width, height: item.height,
        element_id: item.element_id, class_name: item.class_name,
      })),
    };
  })()`;
  return await evaluate(client, expression, 30000);
}

async function cleanupCaptureStabilization(client) {
  try {
    return await evaluate(client, `(() => {
      const STYLE_ID = "__wavi_capture_stability_style__";
      const ATTR = "data-wavi-capture-stability-id";
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

  clearEventBacklog(method) {
    this.eventBacklog.delete(method);
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
  const startedAt = Date.now();
  const boundedQuietMs = Math.max(100, Math.min(10000, Number(quietMs) || 750));
  const boundedMaximumMs = Math.max(0, Math.min(300000, Number(maximumMs) || 0));
  if (boundedMaximumMs === 0) {
    return {
      enabled: false,
      settled: null,
      quiet_ms: boundedQuietMs,
      maximum_ms: 0,
      elapsed_ms: 0,
      inflight_at_end: state.inflight.size,
      maximum_inflight: Number(state.maximumInflight) || state.inflight.size,
      reason: "Network settling was disabled.",
    };
  }

  const deadline = startedAt + boundedMaximumMs;
  while (Date.now() < deadline) {
    if (state.inflight.size === 0 && Date.now() - state.lastActivity >= boundedQuietMs) {
      return {
        enabled: true,
        settled: true,
        quiet_ms: boundedQuietMs,
        maximum_ms: boundedMaximumMs,
        elapsed_ms: Date.now() - startedAt,
        inflight_at_end: 0,
        maximum_inflight: Number(state.maximumInflight) || 0,
        reason: "The network remained quiet for the configured duration.",
      };
    }
    await delay(100);
  }
  return {
    enabled: true,
    settled: false,
    quiet_ms: boundedQuietMs,
    maximum_ms: boundedMaximumMs,
    elapsed_ms: Date.now() - startedAt,
    inflight_at_end: state.inflight.size,
    maximum_inflight: Number(state.maximumInflight) || state.inflight.size,
    reason: "Network activity did not remain quiet before the maximum settling duration elapsed.",
  };
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

async function waitForPageConditions(client, config) {
  const selectorEnabled = Boolean(config.wait_selector_enabled);
  const textEnabled = Boolean(config.wait_text_enabled);
  const selector = String(config.wait_selector || "");
  const selectorState = String(config.wait_selector_state || "visible") === "exists" ? "exists" : "visible";
  const text = String(config.wait_text || "");
  const textScope = String(config.wait_text_scope || "visible") === "dom" ? "dom" : "visible";
  const maximumMs = Math.max(1000, Math.min(300000, Number(config.condition_timeout_seconds || 15) * 1000));
  const startedAt = Date.now();

  if (!selectorEnabled && !textEnabled) {
    return {
      enabled: false,
      completed: true,
      elapsed_ms: 0,
      maximum_ms: maximumMs,
      selector: { enabled: false, selector: "", required_state: selectorState, matched: null },
      text: { enabled: false, text: "", scope: textScope, matched: null },
      unmet_conditions: [],
      reason: "No selector or text readiness conditions were enabled.",
    };
  }

  const expression = `(() => {
    const selectorEnabled = ${JSON.stringify(selectorEnabled)};
    const selector = ${JSON.stringify(selector)};
    const selectorState = ${JSON.stringify(selectorState)};
    const textEnabled = ${JSON.stringify(textEnabled)};
    const text = ${JSON.stringify(text)};
    const textScope = ${JSON.stringify(textScope)};
    let selectorMatched = !selectorEnabled;
    let selectorError = "";
    if (selectorEnabled) {
      try {
        const element = document.querySelector(selector);
        if (selectorState === "exists") {
          selectorMatched = Boolean(element);
        } else if (element) {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          selectorMatched = style.display !== "none" && style.visibility !== "hidden" &&
            Number(style.opacity || 1) > 0 && rect.width > 0 && rect.height > 0;
        } else {
          selectorMatched = false;
        }
      } catch (error) {
        selectorError = String(error && (error.message || error) || "Invalid selector");
      }
    }
    let textMatched = !textEnabled;
    if (textEnabled) {
      const haystack = textScope === "dom"
        ? String(document.documentElement ? (document.documentElement.textContent || "") : "")
        : String(document.body ? (document.body.innerText || "") : "");
      textMatched = haystack.includes(text);
    }
    return { selectorMatched, selectorError, textMatched };
  })()`;

  let lastResult = { selectorMatched: !selectorEnabled, selectorError: "", textMatched: !textEnabled };
  while (Date.now() - startedAt < maximumMs) {
    lastResult = await evaluate(client, expression, Math.min(10000, maximumMs));
    if (lastResult?.selectorError) {
      throw new Error(`Invalid CSS selector: ${lastResult.selectorError}`);
    }
    if (lastResult?.selectorMatched && lastResult?.textMatched) {
      return {
        enabled: true,
        completed: true,
        elapsed_ms: Date.now() - startedAt,
        maximum_ms: maximumMs,
        selector: { enabled: selectorEnabled, selector, required_state: selectorState, matched: Boolean(lastResult.selectorMatched) },
        text: { enabled: textEnabled, text, scope: textScope, matched: Boolean(lastResult.textMatched) },
        unmet_conditions: [],
        reason: "All enabled page conditions were satisfied.",
      };
    }
    await delay(200);
  }

  const unmet = [];
  if (selectorEnabled && !lastResult?.selectorMatched) unmet.push("CSS selector");
  if (textEnabled && !lastResult?.textMatched) unmet.push("text");
  return {
    enabled: true,
    completed: false,
    elapsed_ms: Date.now() - startedAt,
    maximum_ms: maximumMs,
    selector: { enabled: selectorEnabled, selector, required_state: selectorState, matched: Boolean(lastResult?.selectorMatched) },
    text: { enabled: textEnabled, text, scope: textScope, matched: Boolean(lastResult?.textMatched) },
    unmet_conditions: unmet,
    reason: `The following page condition(s) were not satisfied before timeout: ${unmet.join(", ")}.`,
  };
}

async function applyReadinessTimeoutAction(client, actionValue, stage, message, warnings, timeoutRecords) {
  const action = normalizeReadinessTimeoutAction(actionValue);
  const record = {
    stage,
    action,
    action_label: readinessTimeoutActionLabel(action),
    message: String(message || "Readiness check timed out."),
    recorded_utc: nowIso(),
    page_stop_loading_attempted: false,
    page_stop_loading_succeeded: null,
  };

  if (action === "fail") {
    timeoutRecords.push(record);
    throw new Error(`${stage} readiness timeout: ${record.message}`);
  }
  if (action === "stop_and_capture") {
    record.page_stop_loading_attempted = true;
    try {
      await client.send("Page.stopLoading", {}, 10000);
      record.page_stop_loading_succeeded = true;
    } catch {
      record.page_stop_loading_succeeded = false;
    }
  }
  timeoutRecords.push(record);
  warnings.push(`${stage} readiness timeout: ${record.message} Action: ${record.action_label}.`);
  return record;
}

async function performLazyScroll(client, config) {
  if (!config.lazy_scroll) {
    await evaluate(client, "window.scrollTo(0, 0); true;");
    return {
      performed: false,
      iterations: 0,
      timed_out: false,
      initial_height: 0,
      final_height: 0,
      maximum_height: 0,
      detect_page_growth: Boolean(config.detect_page_growth),
      growth_cycles: 0,
      maximum_growth_cycles: Math.max(1, Math.min(500, Number(config.maximum_growth_cycles || 25))),
      growth_limit_reached: false,
      growth_limit_action: normalizeGrowthLimitAction(config.growth_limit_action),
      termination_reason: "disabled",
    };
  }

  const maxMs = Math.max(1000, Number(config.max_scroll_seconds || 60) * 1000);
  const waitMs = Math.max(50, Math.min(5000, Number(config.scroll_wait_ms || 400)));
  const stableChecks = Math.max(1, Math.min(20, Number(config.stable_height_checks || 3)));
  const detectGrowth = Boolean(config.detect_page_growth);
  const maximumGrowthCycles = Math.max(1, Math.min(500, Number(config.maximum_growth_cycles || 25)));
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
      const initialHeight = getHeight();
      let lastHeight = initialHeight;
      let maximumHeight = initialHeight;
      let stable = 0;
      let iterations = 0;
      let timedOut = false;
      let growthCycles = 0;
      let growthLimitReached = false;
      let terminationReason = "iteration_limit";
      window.scrollTo(0, 0);
      await sleep(Math.min(500, ${waitMs}));
      while (iterations < 2000) {
        const height = getHeight();
        const step = Math.max(240, Math.floor((window.innerHeight || 900) * 0.8));
        const nextY = Math.min(window.scrollY + step, Math.max(0, height - (window.innerHeight || 900)));
        window.scrollTo(0, nextY);
        await sleep(${waitMs});
        const newHeight = getHeight();
        maximumHeight = Math.max(maximumHeight, newHeight);
        const grew = newHeight > lastHeight;
        if (grew) {
          stable = 0;
          if (${detectGrowth}) growthCycles += 1;
        } else {
          stable += 1;
        }
        lastHeight = newHeight;
        iterations += 1;
        const atBottom = window.scrollY + (window.innerHeight || 0) >= newHeight - 4;
        if (${detectGrowth} && growthCycles >= ${maximumGrowthCycles}) {
          growthLimitReached = true;
          terminationReason = "growth_limit";
          break;
        }
        if (atBottom && stable >= ${stableChecks}) {
          terminationReason = "stable_height";
          break;
        }
        if (Date.now() - started >= ${maxMs}) {
          timedOut = true;
          terminationReason = "time_limit";
          break;
        }
      }
      window.scrollTo(0, 0);
      await sleep(Math.min(1000, ${waitMs} * 2));
      return {
        performed: true,
        iterations,
        timed_out: timedOut,
        initial_height: initialHeight,
        final_height: getHeight(),
        maximum_height: maximumHeight,
        detect_page_growth: ${detectGrowth},
        growth_cycles: growthCycles,
        maximum_growth_cycles: ${maximumGrowthCycles},
        growth_limit_reached: growthLimitReached,
        termination_reason: terminationReason,
      };
    })()
  `;
  const result = await evaluate(client, script, maxMs + 10000);
  return {
    ...result,
    growth_limit_action: normalizeGrowthLimitAction(config.growth_limit_action),
    growth_limit_action_label: growthLimitActionLabel(config.growth_limit_action),
  };
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
  const pngArtifacts = (capture?.artifacts || []).filter((artifact) => normalizeImageFormat(artifact.format) === "png");
  const fullPageArtifacts = pngArtifacts.filter((artifact) => String(artifact.role || "").startsWith("full_page"));
  const selected = fullPageArtifacts.length
    ? fullPageArtifacts
    : pngArtifacts.filter((artifact) => String(artifact.role || "") === "initial_viewport");
  return selected.sort((a, b) => (Number(a.y_css_px) || 0) - (Number(b.y_css_px) || 0));
}

function buildPaginatedPngPdfHtml(config, capture, sourceArtifacts, sourceUrlForIndex) {
  const geometry = getPdfGeometry(config);
  if (!sourceArtifacts.length) throw new Error("No PNG capture artifacts were available for paginated PDF output.");

  const pageWidthCssPx = Math.max(1, Math.ceil(Number(capture.page_width) || Number(sourceArtifacts[0].width_css_px) || 1));
  const totalHeightCssPx = Math.max(1, Math.ceil(
    capture?.segmentation?.limit_reached
      ? Number(capture.segmentation.captured_height_css_px) || Number(capture.page_height) || 0
      : Number(capture.page_height) || 0
  ));
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

async function writeCaptureImage(path, base64Data) {
  const bytes = bytesFromBase64(base64Data);
  await Deno.writeFile(path, bytes);
  return { bytes: bytes.length, sha256: await sha256Bytes(bytes) };
}

async function removeCaptureArtifacts(artifacts) {
  for (const artifact of artifacts || []) {
    try { await Deno.remove(artifact.path); } catch { /* best effort */ }
  }
}

async function captureViewportImage(client, config, outputFolder, baseName) {
  const artifacts = [];
  const encoding = getImageEncoding(config);
  try {
    const outputPath = await uniqueOutputPath(outputFolder, `${baseName}_viewport`, encoding.extension);
    const result = await client.send("Page.captureScreenshot", {
      ...encoding.cdpOptions,
      fromSurface: true,
      captureBeyondViewport: false,
    }, 120000);
    const record = await writeCaptureImage(outputPath, result.data);
    artifacts.push({
      kind: `initial_viewport_${encoding.format}`,
      role: "initial_viewport",
      format: encoding.format,
      quality: encoding.format === "png" ? null : encoding.quality,
      lossy: encoding.format !== "png",
      path: outputPath,
      sha256: record.sha256,
      size_bytes: record.bytes,
      x_css_px: 0,
      y_css_px: 0,
      width_css_px: Number(config.viewport_width) || 1440,
      height_css_px: Number(config.viewport_height) || 900,
    });
    return artifacts;
  } catch (error) {
    await removeCaptureArtifacts(artifacts);
    throw new CaptureStageError(`Initial viewport capture failed: ${error.message || error}`, error);
  }
}

async function captureFullPageImages(client, config, outputFolder, baseName, layout) {
  const artifacts = [];
  const encoding = getImageEncoding(config);
  const width = Math.max(1, Math.ceil(Number(layout.width) || Number(config.viewport_width) || 1440));
  const height = Math.max(1, Math.ceil(Number(layout.height) || Number(config.viewport_height) || 900));

  try {
    const hardMaximumDimension = Math.max(8000, Math.min(30000, Number(config.maximum_single_dimension || 30000)));
    const maximumSingleHeight = Math.max(2000, Math.min(hardMaximumDimension, Number(config.maximum_single_height || 30000)));
    const maximumSinglePixels = Math.max(20_000_000, Math.min(150_000_000, Number(config.maximum_single_pixels || 150_000_000)));
    const shouldSegment = height > maximumSingleHeight || width > hardMaximumDimension || width * height > maximumSinglePixels;
    let fallbackReason = shouldSegment ? "configured_limit" : "";

    if (!shouldSegment) {
      try {
        const outputPath = await uniqueOutputPath(outputFolder, `${baseName}_full`, encoding.extension);
        const result = await client.send("Page.captureScreenshot", {
          ...encoding.cdpOptions,
          fromSurface: true,
          captureBeyondViewport: true,
          clip: { x: 0, y: 0, width, height, scale: 1 },
        }, 180000);
        const record = await writeCaptureImage(outputPath, result.data);
        artifacts.push({
          kind: `full_page_${encoding.format}`,
          role: "full_page",
          format: encoding.format,
          quality: encoding.format === "png" ? null : encoding.quality,
          lossy: encoding.format !== "png",
          path: outputPath,
          sha256: record.sha256,
          size_bytes: record.bytes,
          x_css_px: 0,
          y_css_px: 0,
          width_css_px: width,
          height_css_px: height,
        });
        return {
          artifacts,
          segmented: false,
          page_width: width,
          page_height: height,
          segmentation: {
            used: false,
            reason: "single_image_within_limits",
            maximum_single_height: maximumSingleHeight,
            maximum_single_pixels: maximumSinglePixels,
            required_segments: 1,
            captured_segments: 1,
            maximum_segments: Math.max(1, Math.min(500, Number(config.maximum_segments || 100))),
            segment_height: Math.max(1000, Math.min(16000, Number(config.segment_height || 12000))),
            segment_overlap: Math.max(0, Math.min(1000, Number(config.segment_overlap || 0))),
            limit_reached: false,
            captured_height_css_px: height,
          },
        };
      } catch (error) {
        await removeCaptureArtifacts(artifacts);
        artifacts.length = 0;
        fallbackReason = `single_image_error: ${error.message || error}`;
        console.log(`Single-image capture failed; using segmented fallback: ${error.message || error}`);
      }
    }

    const segmentHeight = Math.max(1000, Math.min(16000, Number(config.segment_height || 12000)));
    const segmentOverlap = Math.max(0, Math.min(1000, Number(config.segment_overlap || 0), segmentHeight - 1));
    const segmentStep = Math.max(1, segmentHeight - segmentOverlap);
    const maximumSegments = Math.max(1, Math.min(500, Number(config.maximum_segments || 100)));
    const requiredParts = height <= segmentHeight ? 1 : Math.ceil((height - segmentOverlap) / segmentStep);
    const partCount = Math.min(requiredParts, maximumSegments);
    let capturedHeight = 0;
    for (let part = 0; part < partCount; part += 1) {
      const y = part * segmentStep;
      const partHeight = Math.min(segmentHeight, height - y);
      if (partHeight <= 0) break;
      const outputPath = await uniqueOutputPath(
        outputFolder,
        `${baseName}_full_part-${String(part + 1).padStart(3, "0")}`,
        encoding.extension,
      );
      const result = await client.send("Page.captureScreenshot", {
        ...encoding.cdpOptions,
        fromSurface: true,
        captureBeyondViewport: true,
        clip: { x: 0, y, width, height: partHeight, scale: 1 },
      }, 180000);
      const record = await writeCaptureImage(outputPath, result.data);
      capturedHeight = Math.max(capturedHeight, y + partHeight);
      artifacts.push({
        kind: `full_page_${encoding.format}_segment`,
        role: "full_page_segment",
        format: encoding.format,
        quality: encoding.format === "png" ? null : encoding.quality,
        lossy: encoding.format !== "png",
        part: part + 1,
        parts_total: partCount,
        required_parts_total: requiredParts,
        overlap_css_px: segmentOverlap,
        path: outputPath,
        sha256: record.sha256,
        size_bytes: record.bytes,
        x_css_px: 0,
        y_css_px: y,
        width_css_px: width,
        height_css_px: partHeight,
      });
    }
    const limitReached = requiredParts > artifacts.length;
    return {
      artifacts,
      segmented: true,
      page_width: width,
      page_height: height,
      segmentation: {
        used: true,
        reason: fallbackReason || "configured_limit",
        maximum_single_height: maximumSingleHeight,
        maximum_single_pixels: maximumSinglePixels,
        required_segments: requiredParts,
        captured_segments: artifacts.length,
        maximum_segments: maximumSegments,
        segment_height: segmentHeight,
        segment_overlap: segmentOverlap,
        segment_step: segmentStep,
        limit_reached: limitReached,
        captured_height_css_px: Math.min(height, capturedHeight),
      },
    };
  } catch (error) {
    await removeCaptureArtifacts(artifacts);
    if (error?.stage === "capture") throw error;
    throw new CaptureStageError(`Full-page capture failed: ${error.message || error}`, error);
  }
}

async function applyBrowserEnvironment(client, config) {
  const width = Math.max(320, Math.min(7680, Number(config.viewport_width) || 1440));
  const height = Math.max(240, Math.min(4320, Number(config.viewport_height) || 900));
  const deviceScaleFactor = Math.max(0.5, Math.min(4, Number(config.device_scale_factor) || 1));
  const mobile = Boolean(config.mobile_emulation);
  const touch = Boolean(config.touch_emulation);
  const orientation = normalizeOrientation(config.orientation);
  const locale = normalizeLocale(config.locale);
  const timezone = normalizeTimezone(config.timezone);
  const colorScheme = normalizeColorScheme(config.color_scheme);
  const reducedMotion = Boolean(config.reduced_motion);

  await client.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor,
    mobile,
    screenWidth: width,
    screenHeight: height,
    screenOrientation: {
      type: orientation === "portrait" ? "portraitPrimary" : "landscapePrimary",
      angle: orientation === "portrait" ? 0 : 90,
    },
  });
  await client.send("Emulation.setTouchEmulationEnabled", {
    enabled: touch,
    maxTouchPoints: touch ? 5 : 1,
  });
  if (locale !== "default") await client.send("Emulation.setLocaleOverride", { locale });
  if (timezone !== "default") await client.send("Emulation.setTimezoneOverride", { timezoneId: timezone });

  const features = [];
  if (colorScheme !== "default") features.push({ name: "prefers-color-scheme", value: colorScheme });
  if (reducedMotion) features.push({ name: "prefers-reduced-motion", value: "reduce" });
  await client.send("Emulation.setEmulatedMedia", { features });

  return {
    preset: String(config.environment_preset || "custom"),
    preset_label: environmentPresetLabel(config.environment_preset),
    viewport_width_css_px: width,
    viewport_height_css_px: height,
    device_scale_factor: deviceScaleFactor,
    mobile_layout_emulation: mobile,
    touch_emulation: touch,
    orientation,
    locale,
    timezone,
    color_scheme: colorScheme,
    reduced_motion: reducedMotion,
    exact_physical_device_claimed: false,
    note: "Environment presets configure viewport, scale, mobile layout, touch, orientation, locale, timezone, and media preferences without claiming exact physical-device reproduction or changing the browser user agent.",
  };
}

async function prepareBrowserStateForUrl(client, config, url, runContext) {
  const cacheDisabled = Boolean(config.disable_cache);
  const bypassServiceWorkers = Boolean(config.bypass_service_workers);
  const clearCookies = config.clear_cookies_between_urls !== false;
  const storageMode = normalizeStorageClearMode(config.storage_clear_mode);
  await client.send("Network.setCacheDisabled", { cacheDisabled });
  await client.send("Network.setBypassServiceWorker", { bypass: bypassServiceWorkers });

  if (!(runContext.visitedOrigins instanceof Set)) runContext.visitedOrigins = new Set();
  const requestedOrigin = safeHttpOrigin(url);
  const origins = new Set();
  if (storageMode === "requested_origin" && requestedOrigin) origins.add(requestedOrigin);
  if (storageMode === "all_visited_origins") {
    for (const origin of runContext.visitedOrigins) if (origin) origins.add(origin);
    if (requestedOrigin) origins.add(requestedOrigin);
  }

  const clearedOrigins = [];
  const storageTypes = "appcache,file_systems,indexeddb,local_storage,websql,service_workers,cache_storage";
  for (const origin of origins) {
    await client.send("Storage.clearDataForOrigin", { origin, storageTypes }, 30000);
    clearedOrigins.push(origin);
  }
  if (clearCookies) await client.send("Network.clearBrowserCookies", {}, 15000);
  if (requestedOrigin) runContext.visitedOrigins.add(requestedOrigin);

  return {
    cache_disabled: cacheDisabled,
    service_workers_bypassed: bypassServiceWorkers,
    reload_without_cache_requested: Boolean(config.reload_without_cache),
    storage_clear_mode: storageMode,
    storage_clear_mode_label: storageClearModeLabel(storageMode),
    storage_types_cleared: storageMode === "none" ? [] : storageTypes.split(","),
    requested_origin: requestedOrigin,
    origins_cleared: clearedOrigins,
    cookies_cleared_before_import: clearCookies,
    order: ["cache_and_service_worker_policy", "site_storage_clear", "cookie_clear", "cookie_import", "navigation"],
  };
}

function recordVisitedOrigins(runContext, values) {
  if (!(runContext.visitedOrigins instanceof Set)) runContext.visitedOrigins = new Set();
  for (const value of values || []) {
    const origin = safeHttpOrigin(value);
    if (origin) runContext.visitedOrigins.add(origin);
  }
}

async function performReadinessCycle(client, config, networkState, warnings, commandKind, commandCallback) {
  const cycleStartedMs = Date.now();
  const readinessTimeouts = [];
  const readinessEvent = normalizeReadinessEvent(config.readiness_event);
  const readinessMethod = readinessEventMethod(readinessEvent);
  const loadTimeoutMs = Math.max(5000, Math.min(600000, Number(config.page_load_timeout_seconds || 45) * 1000));
  networkState.inflight.clear();
  networkState.lastActivity = Date.now();
  networkState.maximumInflight = 0;
  client.clearEventBacklog(readinessMethod);
  const readinessEventStartedMs = Date.now();
  const readinessPromise = client.waitForEvent(readinessMethod, loadTimeoutMs);
  readinessPromise.catch(() => {});
  const commandStartedMs = Date.now();
  const commandResult = await commandCallback(loadTimeoutMs);
  const commandElapsedMs = Date.now() - commandStartedMs;
  if (commandResult?.errorText) throw new Error(`Navigation failed: ${commandResult.errorText}`);

  const readinessEventResult = {
    event: readinessEvent,
    event_label: readinessEventLabel(readinessEvent),
    cdp_method: readinessMethod,
    fired: false,
    timed_out: false,
    elapsed_ms: 0,
  };
  try {
    await readinessPromise;
    readinessEventResult.fired = true;
    readinessEventResult.elapsed_ms = Date.now() - readinessEventStartedMs;
  } catch (error) {
    readinessEventResult.timed_out = true;
    readinessEventResult.elapsed_ms = Date.now() - readinessEventStartedMs;
    readinessEventResult.error = String(error?.message || error);
    await applyReadinessTimeoutAction(
      client, config.readiness_timeout_action, readinessEventResult.event_label,
      readinessEventResult.error, warnings, readinessTimeouts,
    );
  }

  const networkQuiet = await waitForNetworkQuiet(
    networkState, Number(config.network_quiet_ms || 1000),
    Number(config.network_settle_timeout_seconds || 0) * 1000,
  );
  if (networkQuiet.enabled && networkQuiet.settled === false) {
    await applyReadinessTimeoutAction(
      client, config.readiness_timeout_action, "Network settling", networkQuiet.reason,
      warnings, readinessTimeouts,
    );
  }

  const pageConditions = await waitForPageConditions(client, config);
  if (pageConditions.enabled && !pageConditions.completed) {
    await applyReadinessTimeoutAction(
      client, config.readiness_timeout_action, "Page conditions", pageConditions.reason,
      warnings, readinessTimeouts,
    );
  }

  const additionalWaitMs = Math.max(0, Math.min(60000, Number(config.additional_wait_seconds || 2) * 1000));
  if (additionalWaitMs) await delay(additionalWaitMs);
  return {
    command_kind: commandKind,
    command_elapsed_ms: commandElapsedMs,
    command_result: commandResult || {},
    event: readinessEventResult,
    maximum_navigation_seconds: loadTimeoutMs / 1000,
    network_quiet: networkQuiet,
    page_conditions: pageConditions,
    timeout_action: normalizeReadinessTimeoutAction(config.readiness_timeout_action),
    timeout_action_label: readinessTimeoutActionLabel(config.readiness_timeout_action),
    timeouts: readinessTimeouts,
    additional_wait_seconds: additionalWaitMs / 1000,
    total_elapsed_ms: Date.now() - cycleStartedMs,
    classification: readinessTimeouts.length ? "ready_with_warnings" : "ready",
  };
}

async function captureUrl(client, config, url, index, browserVersion, runContext, attemptInfo = {}) {
  const startedAt = nowIso();
  const warnings = [];
  const consoleErrors = [];
  const consoleEntries = [];
  let consoleEntriesDropped = 0;
  const networkState = {
    inflight: new Set(),
    lastActivity: Date.now(),
    maximumInflight: 0,
    documentResponses: [],
    redirects: [],
    requests: new Map(),
    records: [],
    failedRequests: [],
    failed_requests_dropped: 0,
    record_limit: 5000,
    records_dropped: 0,
  };
  const securityState = { visible: [], legacy: [], certificateErrors: [] };
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

  const appendNetworkRecord = (record) => {
    if (!record) return;
    if (networkState.records.length < networkState.record_limit) networkState.records.push(record);
    else networkState.records_dropped += 1;
  };
  const eventListener = (method, params) => {
    if (method === "Network.requestWillBeSent") {
      if (params.redirectResponse) {
        const previous = networkState.requests.get(params.requestId) || {
          request_id: params.requestId,
          url: params.redirectResponse.url || "",
          resource_type: params.type || "",
          frame_id: params.frameId || "",
        };
        previous.redirect = params.redirectResponse;
        previous.response = params.redirectResponse;
        previous.completed = true;
        appendNetworkRecord(previous);
      }
      const request = params.request || {};
      networkState.requests.set(params.requestId, {
        request_id: params.requestId,
        url: request.url || "",
        document_url: params.documentURL || "",
        method: request.method || "",
        resource_type: params.type || "",
        frame_id: params.frameId || "",
        timestamp: params.timestamp || null,
        wall_time: params.wallTime || null,
        initiator_type: params.initiator?.type || "",
        has_post_data: Boolean(request.hasPostData || request.postDataEntries?.length),
        request_headers: request.headers || {},
        response: null,
        completed: false,
        failed: false,
      });
      networkState.inflight.add(params.requestId);
      networkState.maximumInflight = Math.max(networkState.maximumInflight, networkState.inflight.size);
      networkState.lastActivity = Date.now();
      if (params.type === "Document" && params.redirectResponse && (!mainFrameId || params.frameId === mainFrameId)) {
        networkState.redirects.push({
          from_url: params.redirectResponse.url || "",
          to_url: request.url || "",
          status: Number(params.redirectResponse.status) || null,
          status_text: params.redirectResponse.statusText || "",
        });
      }
    } else if (method === "Network.responseReceived") {
      const record = networkState.requests.get(params.requestId);
      if (record) record.response = params.response || {};
      if (params.type === "Document" && (!mainFrameId || params.frameId === mainFrameId)) {
        networkState.documentResponses.push({
          request_id: params.requestId,
          frame_id: params.frameId || "",
          response: params.response || {},
        });
      }
      networkState.lastActivity = Date.now();
    } else if (method === "Network.loadingFinished") {
      networkState.inflight.delete(params.requestId);
      networkState.lastActivity = Date.now();
      const record = networkState.requests.get(params.requestId);
      if (record) {
        record.completed = true;
        record.encoded_data_length = Number(params.encodedDataLength) || 0;
        appendNetworkRecord(record);
        networkState.requests.delete(params.requestId);
      }
    } else if (method === "Network.loadingFailed") {
      networkState.inflight.delete(params.requestId);
      networkState.lastActivity = Date.now();
      const record = networkState.requests.get(params.requestId) || { request_id: params.requestId };
      record.failed = true;
      record.completed = true;
      record.canceled = Boolean(params.canceled);
      record.resource_type = record.resource_type || params.type || "";
      record.error_text = params.errorText || "";
      record.blocked_reason = params.blockedReason || "";
      record.cors_error_status = params.corsErrorStatus || null;
      appendNetworkRecord(record);
      if (networkState.failedRequests.length < 1000) networkState.failedRequests.push({ ...record });
      else networkState.failed_requests_dropped += 1;
      networkState.requests.delete(params.requestId);
    } else if (method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(params.type)) {
      const text = (params.args || []).map(safeConsoleArgument).join(" ").trim();
      const entry = {
        kind: "console",
        level: params.type,
        text: boundedText(text),
        timestamp: params.timestamp || null,
        execution_context_id: params.executionContextId || null,
        stack_trace: params.stackTrace || null,
      };
      if (text && consoleErrors.length < 100) consoleErrors.push({ type: params.type, text: boundedText(text) });
      if (text && consoleEntries.length < 500) consoleEntries.push(entry);
      else if (text) consoleEntriesDropped += 1;
    } else if (method === "Runtime.exceptionThrown") {
      const details = params.exceptionDetails || {};
      const description = details.exception?.description || details.text || "Uncaught exception";
      if (consoleEntries.length < 500) consoleEntries.push({
        kind: "exception",
        level: "error",
        text: boundedText(description),
        timestamp: params.timestamp || null,
        url: details.url || "",
        line_number: details.lineNumber ?? null,
        column_number: details.columnNumber ?? null,
        stack_trace: details.stackTrace || details.exception?.preview || null,
      });
      else consoleEntriesDropped += 1;
      if (consoleErrors.length < 100) consoleErrors.push({ type: "exception", text: boundedText(description) });
    } else if (method === "Log.entryAdded") {
      const entry = params.entry || {};
      if (["error", "warning"].includes(entry.level)) {
        if (consoleErrors.length < 100) consoleErrors.push({ type: entry.level, text: boundedText(entry.text || "") });
        if (consoleEntries.length < 500) consoleEntries.push({
          kind: "log",
          level: entry.level,
          source: entry.source || "",
          text: boundedText(entry.text || ""),
          timestamp: entry.timestamp || null,
          url: entry.url || "",
          line_number: entry.lineNumber ?? null,
          stack_trace: entry.stackTrace || null,
        });
        else consoleEntriesDropped += 1;
      }
    } else if (method === "Security.visibleSecurityStateChanged") {
      if (securityState.visible.length < 100) securityState.visible.push(params.visibleSecurityState || params || {});
    } else if (method === "Security.securityStateChanged") {
      if (securityState.legacy.length < 100) securityState.legacy.push(params || {});
    } else if (method === "Security.certificateError") {
      if (securityState.certificateErrors.length < 100) securityState.certificateErrors.push({
        event_id: params.eventId || null,
        error_type: params.errorType || "",
        request_url: params.requestURL || "",
        recorded_utc: nowIso(),
      });
    }
  };
  client.addEventListener(eventListener);

  try {
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    await client.send("Network.enable", { maxTotalBufferSize: 50_000_000, maxResourceBufferSize: 20_000_000 });
    try { await client.send("Security.enable"); } catch { /* optional */ }
    const browserEnvironment = await applyBrowserEnvironment(client, config);
    const pageStatePreparation = await prepareBrowserStateForUrl(client, config, url, runContext);
    cookieImport = await importCookiesForUrl(client, config.cookie_jar, url, config.cookie_scope, { clear_first: false });
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

    const readinessStartedMs = Date.now();
    const initialReadiness = await performReadinessCycle(
      client, config, networkState, warnings, "navigate",
      (timeoutMs) => client.send("Page.navigate", { url }, timeoutMs),
    );
    const navigation = initialReadiness.command_result || {};
    mainFrameId = navigation.frameId || mainFrameId;

    let finalReadiness = initialReadiness;
    let reloadReadiness = null;
    if (Boolean(config.reload_without_cache)) {
      reloadReadiness = await performReadinessCycle(
        client, config, networkState, warnings, "reload_without_cache",
        (timeoutMs) => client.send("Page.reload", { ignoreCache: true }, timeoutMs),
      );
      finalReadiness = reloadReadiness;
    }
    const readinessInfo = {
      cycles: reloadReadiness ? [initialReadiness, reloadReadiness] : [initialReadiness],
      initial_navigation: initialReadiness,
      reload_without_cache: {
        enabled: Boolean(config.reload_without_cache),
        performed: Boolean(reloadReadiness),
        result: reloadReadiness,
      },
      event: finalReadiness.event,
      maximum_navigation_seconds: finalReadiness.maximum_navigation_seconds,
      navigation_command_elapsed_ms: initialReadiness.command_elapsed_ms,
      network_quiet: finalReadiness.network_quiet,
      page_conditions: finalReadiness.page_conditions,
      timeout_action: finalReadiness.timeout_action,
      timeout_action_label: finalReadiness.timeout_action_label,
      timeouts: [
        ...(initialReadiness.timeouts || []),
        ...((reloadReadiness && reloadReadiness.timeouts) || []),
      ],
      additional_wait_seconds: finalReadiness.additional_wait_seconds,
      total_elapsed_ms: Date.now() - readinessStartedMs,
      classification: (initialReadiness.timeouts?.length || reloadReadiness?.timeouts?.length)
        ? "ready_with_warnings" : "ready",
    };

    const captureMode = normalizeCaptureMode(config.capture_mode);
    let pageInfo = await evaluate(client, `({
      title: document.title || "",
      final_url: location.href,
      language: document.documentElement ? (document.documentElement.lang || "") : "",
      content_type: document.contentType || "",
      ready_state: document.readyState || "",
      viewport_width: window.innerWidth || 0,
      viewport_height: window.innerHeight || 0
    })`);

    recordVisitedOrigins(runContext, [
      url,
      pageInfo.final_url,
      ...networkState.redirects.flatMap((entry) => [entry.from_url, entry.to_url]),
      ...networkState.documentResponses.map((entry) => entry.response?.url || ""),
    ]);

    let domain = "unknown-domain";
    try { domain = new URL(pageInfo.final_url || url).hostname || "unknown-domain"; } catch { /* keep fallback */ }
    const captureDate = new Date();
    const baseName = renderFilenameTemplate(config.filename_template, {
      date: captureDate,
      domain,
      title: pageInfo.title,
      index,
      mode: captureMode,
      caseName: config.case_name || "",
    });

    const capture = {
      artifacts: [],
      segmented: false,
      page_width: Number(pageInfo.viewport_width) || Number(config.viewport_width) || 1440,
      page_height: Number(pageInfo.viewport_height) || Number(config.viewport_height) || 900,
      segmentation: { used: false, limit_reached: false },
    };
    const partialReasons = [];
    const warningReasons = [];
    let stabilizationInfo = null;
    let stabilizationCleanup = { cleaned: 0 };
    let measurementInfo = {
      remeasure_before_capture: Boolean(config.remeasure_before_capture),
      initial: null,
      final: null,
      used: null,
    };
    let scrollResult = { performed: false, reason: "Initial viewport-only capture does not scroll before capture." };
    try {
      stabilizationInfo = await applyCaptureStabilization(client, config);
      const initialMetrics = await client.send("Page.getLayoutMetrics");
      const initialContentSize = initialMetrics.cssContentSize || initialMetrics.contentSize || {};
      measurementInfo.initial = {
        width: Math.max(Number(initialContentSize.width) || 0, Number(config.viewport_width) || 1440),
        height: Math.max(Number(initialContentSize.height) || 0, Number(config.viewport_height) || 900),
      };

      if (captureMode === "viewport" || captureMode === "both") {
        const viewportArtifacts = await captureViewportImage(client, config, runContext.webMediaFolder, baseName);
        capture.artifacts.push(...viewportArtifacts);
      }

      if (captureMode === "full_page" || captureMode === "both") {
        scrollResult = await performLazyScroll(client, config);
        if (scrollResult?.timed_out) {
          const message = "Lazy-load scrolling reached its configured time limit; the result is marked partial.";
          warnings.push(message);
          partialReasons.push("scroll_time_limit_reached");
        }
        if (scrollResult?.growth_limit_reached) {
          const action = normalizeGrowthLimitAction(config.growth_limit_action);
          const message = `Page growth reached ${scrollResult.maximum_growth_cycles} configured cycle(s).`;
          if (action === "fail") throw new Error(`${message} Growth-limit behavior is Fail URL.`);
          warnings.push(`${message} Action: ${growthLimitActionLabel(action)}.`);
          if (action === "capture_partial") partialReasons.push("page_growth_limit_reached");
          else warningReasons.push("page_growth_limit_reached");
        }

        pageInfo = await evaluate(client, `({
          title: document.title || "",
          final_url: location.href,
          language: document.documentElement ? (document.documentElement.lang || "") : "",
          content_type: document.contentType || "",
          ready_state: document.readyState || "",
          viewport_width: window.innerWidth || 0,
          viewport_height: window.innerHeight || 0
        })`);
        let layout = measurementInfo.initial;
        if (config.remeasure_before_capture) {
          const finalMetrics = await client.send("Page.getLayoutMetrics");
          const finalContentSize = finalMetrics.cssContentSize || finalMetrics.contentSize || {};
          measurementInfo.final = {
            width: Math.max(Number(finalContentSize.width) || 0, Number(config.viewport_width) || 1440),
            height: Math.max(Number(finalContentSize.height) || 0, Number(config.viewport_height) || 900),
          };
          layout = measurementInfo.final;
        }
        measurementInfo.used = layout;
        const fullCapture = await captureFullPageImages(client, config, runContext.webMediaFolder, baseName, layout);
        capture.artifacts.push(...fullCapture.artifacts);
        capture.segmented = fullCapture.segmented;
        capture.page_width = fullCapture.page_width;
        capture.page_height = fullCapture.page_height;
        capture.segmentation = fullCapture.segmentation || capture.segmentation;
        if (capture.segmentation?.limit_reached) {
          warnings.push(`Long-page capture required ${capture.segmentation.required_segments} segments, exceeding the configured maximum of ${capture.segmentation.maximum_segments}; the result is marked partial.`);
          partialReasons.push("maximum_segment_count_reached");
        }
      }
    } catch (error) {
      await removeCaptureArtifacts(capture.artifacts);
      throw error;
    } finally {
      stabilizationCleanup = await cleanupCaptureStabilization(client);
    }
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

    const mainDocumentEntry = networkState.documentResponses.length
      ? networkState.documentResponses[networkState.documentResponses.length - 1]
      : {};
    const mainResponse = mainDocumentEntry.response || mainDocumentEntry || {};

    const supplementalEvidence = await captureSupplementalEvidence(client, config, {
      folder: runContext.webMediaFolder,
      baseName,
      requestedUrl: url,
      pageInfo,
      mainDocumentEntry,
      mainResponse,
      networkState,
      consoleEntries,
      consoleEntriesDropped,
      securityState,
    });
    for (const evidenceError of supplementalEvidence.errors) {
      const message = `Requested evidence artifact ${evidenceError.artifact} failed: ${evidenceError.error}`;
      warnings.push(message);
      console.log(message);
    }

    const allArtifacts = [...capture.artifacts, ...pdfArtifacts, ...supplementalEvidence.artifacts];
    if (readinessInfo.timeouts.length) warningReasons.push("readiness_timeout");
    const requestedArtifactErrors = [];
    if (pdfError) {
      warningReasons.push("requested_pdf_failed");
      requestedArtifactErrors.push({ artifact: "pdf", error: pdfError });
    }
    requestedArtifactErrors.push(...supplementalEvidence.errors);
    const captureCompleteness = buildCaptureCompleteness(
      partialReasons, warningReasons, warnings, requestedArtifactErrors, capture.artifacts.length,
    );
    const completenessClassification = captureCompleteness.classification;
    console.log(`Capture completeness: ${completenessClassification.replaceAll("_", " ")}.`);
    const sidecar = {
      type: "avi-capture-gui-web-page-capture",
      schema_version: SCRIPT_SCHEMA_VERSION,
      app_version: config.app_version || "",
      launcher_script: basename(config.wrapper_script_path || "script-webcapture.ps1"),
      helper_script: basename(config.script_path || "script-webcapture.ts"),
      job_id: config.job_id || "",
      capture_index: index,
      capture_attempt: Math.max(1, Number(attemptInfo.attempt) || 1),
      configured_capture_retries: Math.max(0, Number(config.capture_retry_count) || 0),
      prior_capture_retry_errors: Array.isArray(attemptInfo.prior_errors) ? attemptInfo.prior_errors : [],
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
      browser_environment: browserEnvironment,
      page_state: {
        preparation: pageStatePreparation,
        cache_disabled: Boolean(config.disable_cache),
        service_workers_bypassed: Boolean(config.bypass_service_workers),
        reload_without_cache: readinessInfo.reload_without_cache,
        storage_clear_mode: normalizeStorageClearMode(config.storage_clear_mode),
        storage_clear_mode_label: storageClearModeLabel(config.storage_clear_mode),
        cookies_cleared_between_urls: config.clear_cookies_between_urls !== false,
        visited_origins_tracked: runContext.visitedOrigins instanceof Set ? Array.from(runContext.visitedOrigins).sort() : [],
      },
      viewport_width_css_px: Number(pageInfo.viewport_width) || Number(config.viewport_width) || 1440,
      viewport_height_css_px: Number(pageInfo.viewport_height) || Number(config.viewport_height) || 900,
      page_width_css_px: capture.page_width,
      page_height_css_px: capture.page_height,
      capture_mode: normalizeCaptureMode(config.capture_mode),
      image_format: normalizeImageFormat(config.image_format),
      image_quality: normalizeImageFormat(config.image_format) === "png" ? null : normalizeImageQuality(config.image_quality),
      image_lossy: normalizeImageFormat(config.image_format) !== "png",
      segmented: capture.segmented,
      segmentation: capture.segmentation || {},
      lazy_scroll: scrollResult || {},
      page_measurement: measurementInfo,
      visual_stabilization: {
        ...(stabilizationInfo || {}),
        cleanup: stabilizationCleanup,
      },
      capture_completeness: captureCompleteness,
      readiness: readinessInfo,
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
      evidence_outputs: {
        requested: supplementalEvidence.requested,
        network_query_mode: normalizeNetworkQueryMode(config.network_query_mode),
        results: Object.fromEntries(Object.entries(supplementalEvidence.results).map(([name, result]) => [name, {
          ...result,
          path: result.path && result.path.startsWith(runContext.caseFolder)
            ? result.path.slice(runContext.caseFolder.length).replace(/^[\/]+/, "")
            : (result.path || ""),
        }])),
        errors: supplementalEvidence.errors,
        sensitive_headers_redacted: ["Authorization", "Proxy-Authorization", "Cookie", "Set-Cookie"],
        request_bodies_recorded: false,
      },
      security_metadata: await getCurrentSecurityMetadata(
        client, pageInfo, mainResponse, securityState, config.network_query_mode,
      ),
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
      browser_console_entry_count: consoleEntries.length,
      browser_console_entries_dropped: consoleEntriesDropped,
      failed_request_count: networkState.failedRequests.length,
      failed_requests_dropped: networkState.failed_requests_dropped,
      network_record_count: networkState.records.length + networkState.requests.size,
      network_records_dropped: networkState.records_dropped,
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
      captureAttempt: Math.max(1, Number(attemptInfo.attempt) || 1),
      completenessClassification,
      complete: captureCompleteness.requested_artifacts_complete,
      error: requestedArtifactErrors.map((entry) => entry.error).join(" | "),
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
  const locale = normalizeLocale(config.locale);
  if (locale !== "default") args.push(`--lang=${locale}`);
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
    const runContext = {
      caseFolder, webMediaFolder, logsFolder, manifestsFolder, manifestPath,
      visitedOrigins: new Set(),
    };

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
    const captureModeLabel = { full_page: "full page", viewport: "initial viewport", both: "full page + initial viewport" }[normalizeCaptureMode(config.capture_mode)];
    const imageFormat = normalizeImageFormat(config.image_format);
    const imageQualityLabel = imageFormat === "png" ? "lossless" : `quality ${normalizeImageQuality(config.image_quality)}`;
    await log(`Capture mode: ${captureModeLabel}`);
    await log(`Image format: ${imageFormat.toUpperCase()} (${imageQualityLabel})`);
    await log(
      `Browser environment: ${environmentPresetLabel(config.environment_preset)}; ` +
      `${Number(config.viewport_width) || 1440}×${Number(config.viewport_height) || 900}; ` +
      `scale ${Math.max(0.5, Math.min(4, Number(config.device_scale_factor) || 1))}; ` +
      `${config.mobile_emulation ? "mobile layout" : "desktop layout"}; ` +
      `${config.touch_emulation ? "touch" : "no touch"}; ${normalizeOrientation(config.orientation)}.`,
    );
    await log(
      `Browser preferences: locale ${normalizeLocale(config.locale)}; timezone ${normalizeTimezone(config.timezone)}; ` +
      `colour scheme ${normalizeColorScheme(config.color_scheme)}; reduced motion ${config.reduced_motion ? "on" : "off"}.`,
    );
    await log(
      `Page state: cache ${config.disable_cache ? "disabled" : "enabled"}; service workers ` +
      `${config.bypass_service_workers ? "bypassed" : "allowed"}; ${storageClearModeLabel(config.storage_clear_mode)}; ` +
      `cookies ${config.clear_cookies_between_urls !== false ? "cleared before each URL" : "retained between URLs"}; ` +
      `reload without cache ${config.reload_without_cache ? "on" : "off"}.`,
    );
    await log(`Capture retries: ${Math.max(0, Math.min(2, Number(config.capture_retry_count) || 0))}`);
    const evidenceLabels = [];
    if (config.save_mhtml) evidenceLabels.push("MHTML");
    if (config.save_response_html) evidenceLabels.push("final response HTML");
    if (config.save_rendered_dom) evidenceLabels.push("rendered DOM HTML");
    if (config.save_network_report) evidenceLabels.push(`network report (${normalizeNetworkQueryMode(config.network_query_mode)})`);
    if (config.save_console_report) evidenceLabels.push("console report");
    if (config.save_failed_request_report) evidenceLabels.push("failed-request report");
    if (config.save_security_report) evidenceLabels.push("security report");
    if (config.save_failure_screenshot) evidenceLabels.push("failure screenshot/metadata");
    await log(`Evidence outputs: ${evidenceLabels.length ? evidenceLabels.join(", ") : "none"}.`);
    await log(`Readiness event: ${readinessEventLabel(config.readiness_event)} (maximum navigation ${Math.max(5, Math.min(600, Number(config.page_load_timeout_seconds) || 45))}s).`);
    const configuredNetworkMaximum = Math.max(0, Math.min(300, Number(config.network_settle_timeout_seconds) || 0));
    await log(configuredNetworkMaximum > 0
      ? `Network settling: ${Math.max(100, Math.min(10000, Number(config.network_quiet_ms) || 1000))}ms quiet, ${configuredNetworkMaximum}s maximum.`
      : "Network settling: disabled.");
    const conditionLabels = [];
    if (config.wait_selector_enabled) conditionLabels.push(`CSS selector (${String(config.wait_selector_state || "visible")})`);
    if (config.wait_text_enabled) conditionLabels.push(`text (${String(config.wait_text_scope || "visible")})`);
    await log(conditionLabels.length
      ? `Page conditions: ${conditionLabels.join(" + ")} with ${Math.max(1, Math.min(300, Number(config.condition_timeout_seconds) || 15))}s shared timeout.`
      : "Page conditions: disabled.");
    await log(`Readiness timeout action: ${readinessTimeoutActionLabel(config.readiness_timeout_action)}.`);
    await log(`Additional readiness wait: ${Math.max(0, Math.min(60, Number(config.additional_wait_seconds) || 0))}s.`);
    await log(`Submitted URLs: ${(config.urls || []).length}`);

    const urls = Array.isArray(config.urls) ? config.urls : [];
    for (let i = 0; i < urls.length; i += 1) {
      const url = String(urls[i] || "").trim();
      const safeClassificationUrl = url.replace(/[\t\r\n]+/g, " ");
      if (!/^https?:\/\//i.test(url)) {
        failed += 1;
        await log(`URL ${i + 1}/${urls.length} rejected because it is not HTTP/HTTPS: ${url}`);
        console.log(`GUI_WEB_CAPTURE_CLASSIFICATION\t${i + 1}\t${urls.length}\tfailed\t${safeClassificationUrl}`);
        console.log(`GUI_QUEUE_URL_INCOMPLETE\t${i + 1}\t${urls.length}\t${safeClassificationUrl}`);
        continue;
      }

      const archiveSkip = config.universal_archive?.enabled
        ? config.universal_archive?.skips?.[String(i + 1)]
        : null;
      if (archiveSkip) {
        skipped += 1;
        const archiveId = String(archiveSkip.archive_id || "web:unknown").replace(/[\t\r\n]+/g, " ");
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
        console.log(`GUI_UNIVERSAL_ARCHIVE_SKIP\t${i + 1}\t${urls.length}\t${archiveId}\t${safeClassificationUrl}`);
        console.log(`GUI_QUEUE_URL_COMPLETE\t${i + 1}\t${urls.length}\t${safeClassificationUrl}`);
        continue;
      }

      await log(`URL ${i + 1}/${urls.length}: ${url}`);
      try {
        const retryLimit = Math.max(0, Math.min(2, Number(config.capture_retry_count) || 0));
        const priorCaptureErrors = [];
        let result = null;
        for (let attempt = 1; attempt <= retryLimit + 1; attempt += 1) {
          try {
            result = await captureUrl(
              browser.client,
              config,
              url,
              i + 1,
              browser.version,
              runContext,
              { attempt, prior_errors: [...priorCaptureErrors] },
            );
            break;
          } catch (error) {
            const message = String(error?.message || error);
            if (error?.stage === "capture" && attempt <= retryLimit) {
              priorCaptureErrors.push({ attempt, error: message, recorded_utc: nowIso() });
              await log(`Capture attempt ${attempt} failed; re-navigating for retry ${attempt + 1} of ${retryLimit + 1}: ${message}`);
              continue;
            }
            throw error;
          }
        }
        if (!result) throw new Error("Webpage Capture produced no result after the configured attempts.");
        for (const artifact of result.artifacts) manifestRecords.push(artifact);
        await log(`Captured: ${result.finalUrl}`);
        await log(`Title: ${result.title || "(untitled)"}`);
        await log(
          `Capture completeness: ${String(result.completenessClassification || "complete").replaceAll("_", " ")}.`,
        );
        if (Number(result.captureAttempt) > 1) {
          await log(`Visual capture succeeded on attempt ${result.captureAttempt} after ${Number(result.captureAttempt) - 1} retry/retries.`);
        }
        if (result.cookieImport?.enabled) {
          await log(
            `Cookies for URL (${result.cookieImport.scope_label}): ${result.cookieImport.accepted_cookie_count} of ` +
            `${result.cookieImport.selected_cookie_count} selected cookie(s) loaded from ` +
            `${result.cookieImport.selected_domain_count} domain(s); ` +
            `${result.cookieImport.browser_visible_cookie_count} visible to the submitted URL.`,
          );
        }
        if (result.warnings.length) await log(`Warnings: ${result.warnings.join(" | ")}`);
        console.log(
          `GUI_WEB_CAPTURE_CLASSIFICATION\t${i + 1}\t${urls.length}\t` +
          `${result.completenessClassification || "complete"}\t${safeClassificationUrl}`,
        );
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
          console.log(`GUI_QUEUE_URL_COMPLETE\t${i + 1}\t${urls.length}\t${safeClassificationUrl}`);
        } else {
          failed += 1;
          await log(`ERROR: ${result.error || "A requested Webpage Capture artifact was not created."}`);
          console.log(`GUI_QUEUE_URL_INCOMPLETE\t${i + 1}\t${urls.length}\t${safeClassificationUrl}`);
        }
      } catch (error) {
        failed += 1;
        await log(`ERROR capturing ${url}: ${error?.stack || error?.message || error}`);
        try {
          const failureEvidence = await captureFailureEvidence(
            browser.client,
            config,
            url,
            i + 1,
            browser.version,
            runContext,
            error,
          );
          for (const artifact of failureEvidence.artifacts) manifestRecords.push(artifact);
          if (failureEvidence.screenshotPath) await log(`Failure screenshot: ${failureEvidence.screenshotPath}`);
          if (failureEvidence.metadataPath) await log(`Failure metadata: ${failureEvidence.metadataPath}`);
        } catch (failureEvidenceError) {
          await log(`WARNING: Failure evidence could not be created: ${failureEvidenceError?.message || failureEvidenceError}`);
        }
        console.log(`GUI_WEB_CAPTURE_CLASSIFICATION\t${i + 1}\t${urls.length}\tfailed\t${safeClassificationUrl}`);
        console.log(`GUI_QUEUE_URL_INCOMPLETE\t${i + 1}\t${urls.length}\t${safeClassificationUrl}`);
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
