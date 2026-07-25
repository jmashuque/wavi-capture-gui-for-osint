/*
WAVI Capture GUI for OSINT - Webpage Capture helper

This helper intentionally uses only built-in Deno and Chromium capabilities.
It launches a selected installed Chromium-family browser with a unique app-owned
--user-data-dir, connects over loopback through the Chrome DevTools Protocol,
and never reads the user's normal browser profile or cookie databases. When
explicitly enabled, it may read a user-selected Netscape cookies.txt file and
inject either site-applicable cookies or the entire file into the isolated browser session.
*/

const SCRIPT_SCHEMA_VERSION = 8;

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

const PDF_PRINT_COMMAND_TIMEOUT_MS = 180000;
const PDF_STREAM_READ_TIMEOUT_MS = 30000;
const PDF_STREAM_TOTAL_TIMEOUT_MS = 600000;
const PDF_STREAM_CHUNK_SIZE_BYTES = 2 * 1024 * 1024;
const BROWSER_STDERR_TAIL_CHARACTERS = 16384;

const SHA256_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotateRight32(value, bits) {
  return ((value >>> bits) | (value << (32 - bits))) >>> 0;
}

class IncrementalSha256 {
  constructor() {
    this.state = new Uint32Array([
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
      0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ]);
    this.buffer = new Uint8Array(64);
    this.bufferLength = 0;
    this.bytesHashed = 0n;
    this.finished = false;
  }

  update(input) {
    if (this.finished) throw new Error("SHA-256 digest has already been finalized.");
    const data = input instanceof Uint8Array ? input : new Uint8Array(input || 0);
    this.bytesHashed += BigInt(data.length);
    let offset = 0;

    if (this.bufferLength > 0) {
      const needed = 64 - this.bufferLength;
      const take = Math.min(needed, data.length);
      this.buffer.set(data.subarray(0, take), this.bufferLength);
      this.bufferLength += take;
      offset += take;
      if (this.bufferLength === 64) {
        this.processBlock(this.buffer);
        this.bufferLength = 0;
      }
    }

    while (offset + 64 <= data.length) {
      this.processBlock(data.subarray(offset, offset + 64));
      offset += 64;
    }

    if (offset < data.length) {
      this.buffer.set(data.subarray(offset), 0);
      this.bufferLength = data.length - offset;
    }
    return this;
  }

  processBlock(block) {
    const words = new Uint32Array(64);
    for (let i = 0; i < 16; i += 1) {
      const offset = i * 4;
      words[i] = (
        (block[offset] << 24) |
        (block[offset + 1] << 16) |
        (block[offset + 2] << 8) |
        block[offset + 3]
      ) >>> 0;
    }
    for (let i = 16; i < 64; i += 1) {
      const s0 = (rotateRight32(words[i - 15], 7) ^ rotateRight32(words[i - 15], 18) ^ (words[i - 15] >>> 3)) >>> 0;
      const s1 = (rotateRight32(words[i - 2], 17) ^ rotateRight32(words[i - 2], 19) ^ (words[i - 2] >>> 10)) >>> 0;
      words[i] = (words[i - 16] + s0 + words[i - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = this.state;
    for (let i = 0; i < 64; i += 1) {
      const sum1 = (rotateRight32(e, 6) ^ rotateRight32(e, 11) ^ rotateRight32(e, 25)) >>> 0;
      const choice = ((e & f) ^ ((~e) & g)) >>> 0;
      const temp1 = (h + sum1 + choice + SHA256_CONSTANTS[i] + words[i]) >>> 0;
      const sum0 = (rotateRight32(a, 2) ^ rotateRight32(a, 13) ^ rotateRight32(a, 22)) >>> 0;
      const majority = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const temp2 = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    this.state[0] = (this.state[0] + a) >>> 0;
    this.state[1] = (this.state[1] + b) >>> 0;
    this.state[2] = (this.state[2] + c) >>> 0;
    this.state[3] = (this.state[3] + d) >>> 0;
    this.state[4] = (this.state[4] + e) >>> 0;
    this.state[5] = (this.state[5] + f) >>> 0;
    this.state[6] = (this.state[6] + g) >>> 0;
    this.state[7] = (this.state[7] + h) >>> 0;
  }

  digestHex() {
    if (this.finished) throw new Error("SHA-256 digest has already been finalized.");
    this.finished = true;
    const bitLength = this.bytesHashed * 8n;
    const finalLength = this.bufferLength < 56 ? 64 : 128;
    const finalBlock = new Uint8Array(finalLength);
    finalBlock.set(this.buffer.subarray(0, this.bufferLength), 0);
    finalBlock[this.bufferLength] = 0x80;
    for (let i = 0; i < 8; i += 1) {
      finalBlock[finalLength - 1 - i] = Number((bitLength >> BigInt(i * 8)) & 0xffn);
    }
    for (let offset = 0; offset < finalBlock.length; offset += 64) {
      this.processBlock(finalBlock.subarray(offset, offset + 64));
    }
    return Array.from(this.state, (word) => word.toString(16).padStart(8, "0")).join("").toUpperCase();
  }
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
    "%urlindex%": String(context.index).padStart(3, "0"),
    "%overlayindex%": String(context.overlayIndex == null ? 0 : context.overlayIndex).padStart(3, "0"),
    "%profile%": safeFileComponent(context.profile, "unknown-profile", 120),
    "%contentid%": safeFileComponent(context.contentId, "unknown-content", 120),
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

function normalizePdfLargeHandling(value) {
  const handling = String(value || "automatic").trim();
  return ["automatic", "single", "split", "fail"].includes(handling) ? handling : "automatic";
}

function pdfLargeHandlingLabel(value) {
  return {
    automatic: "Automatic",
    single: "Single PDF",
    split: "Split into parts",
    fail: "Fail above safety limit",
  }[normalizePdfLargeHandling(value)];
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
    profile: deriveWebpageProfile(pageInfo.final_url, url),
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
      const selector = '[' + ATTR + '="' + item.id + '"]';
      return MODE === "hide_likely_navigation_overlays"
        ? selector + "{display:none !important; visibility:hidden !important;}"
        : selector + "{position:static !important; top:auto !important; right:auto !important; bottom:auto !important; left:auto !important; inset:auto !important; transform:none !important;}";
    });
    const styleTag = document.createElement("style");
    styleTag.id = STYLE_ID;
    styleTag.textContent = cssRules.join("\\n");
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
    this.transportDiagnostics = {
      error: null,
      close: null,
      last_failure: null,
    };
    this.browserDiagnostics = null;

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

    const failAll = (reason, details = null) => {
      this.transportDiagnostics.last_failure = {
        recorded_utc: nowIso(),
        reason,
        details,
      };
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        const error = new Error(reason);
        error.cdp_transport = this.getTransportDiagnostics();
        pending.reject(error);
      }
      this.pending.clear();
      for (const waiters of this.eventWaiters.values()) {
        for (const waiter of waiters) {
          clearTimeout(waiter.timer);
          const error = new Error(reason);
          error.cdp_transport = this.getTransportDiagnostics();
          waiter.reject(error);
        }
      }
      this.eventWaiters.clear();
    };

    webSocket.onerror = (event) => {
      const detail = String(event?.message || event?.error?.message || "").trim();
      this.transportDiagnostics.error = {
        recorded_utc: nowIso(),
        message: detail,
      };
      failAll(detail ? `DevTools WebSocket error: ${detail}` : "DevTools WebSocket error.", this.transportDiagnostics.error);
    };
    webSocket.onclose = (event) => {
      const close = {
        recorded_utc: nowIso(),
        code: Number(event?.code) || 0,
        reason: String(event?.reason || ""),
        was_clean: Boolean(event?.wasClean),
      };
      this.transportDiagnostics.close = close;
      const reasonParts = [`code ${close.code}`];
      if (close.reason) reasonParts.push(close.reason);
      reasonParts.push(close.was_clean ? "clean" : "unclean");
      failAll(`DevTools WebSocket closed (${reasonParts.join(", ")}).`, close);
    };
  }

  setBrowserDiagnostics(diagnostics) {
    this.browserDiagnostics = diagnostics || null;
  }

  getTransportDiagnostics() {
    return JSON.parse(JSON.stringify(this.transportDiagnostics || {}));
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

async function collectBrowserStderrTail(readable, diagnostics, maximumCharacters = BROWSER_STDERR_TAIL_CHARACTERS) {
  if (!readable || typeof readable.getReader !== "function") return "";
  const reader = readable.getReader();
  const decoder = new TextDecoder();
  let tail = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      tail += decoder.decode(value, { stream: true });
      if (tail.length > maximumCharacters) tail = tail.slice(-maximumCharacters);
      if (diagnostics) diagnostics.stderr_tail = tail;
    }
    tail += decoder.decode();
    if (tail.length > maximumCharacters) tail = tail.slice(-maximumCharacters);
  } catch (error) {
    if (diagnostics) diagnostics.stderr_read_error = String(error?.message || error);
  } finally {
    try { reader.releaseLock(); } catch { /* ignore */ }
  }
  if (diagnostics) diagnostics.stderr_tail = tail;
  return tail;
}

function normalizeBrowserStatus(status) {
  if (!status) return null;
  return {
    success: Boolean(status.success),
    code: Number.isFinite(Number(status.code)) ? Number(status.code) : null,
    signal: status.signal == null ? null : String(status.signal),
  };
}

function normalizeDiagnosticText(value, maximumCharacters = 4000) {
  const text = String(value || "").replace(/[\r\n]+/g, " | ").trim();
  return text.length > maximumCharacters ? text.slice(-maximumCharacters) : text;
}

async function collectPdfFailureDiagnostics(client, streamState = null) {
  const browserDiagnostics = client?.browserDiagnostics || null;
  if (browserDiagnostics && !browserDiagnostics.status && browserDiagnostics.statusPromise) {
    try {
      await Promise.race([browserDiagnostics.statusPromise.catch(() => null), delay(350)]);
    } catch {
      // Best effort only.
    }
  }
  const transport = typeof client?.getTransportDiagnostics === "function"
    ? client.getTransportDiagnostics()
    : {};
  const browser = browserDiagnostics ? {
    pid: Number(browserDiagnostics.pid) || null,
    started_utc: String(browserDiagnostics.started_utc || ""),
    status: browserDiagnostics.status || null,
    stderr_tail: normalizeDiagnosticText(browserDiagnostics.stderr_tail || ""),
    stderr_read_error: String(browserDiagnostics.stderr_read_error || ""),
  } : null;
  return {
    transport,
    browser,
    stream: streamState ? { ...streamState } : null,
  };
}

function summarizePdfFailureDiagnostics(diagnostics) {
  const parts = [];
  const close = diagnostics?.transport?.close;
  if (close) {
    parts.push(`WebSocket close code ${Number(close.code) || 0}${close.reason ? ` (${normalizeDiagnosticText(close.reason, 300)})` : ""}`);
  } else if (diagnostics?.transport?.error) {
    const message = normalizeDiagnosticText(diagnostics.transport.error.message || "", 300);
    parts.push(message ? `WebSocket error: ${message}` : "WebSocket transport error");
  }
  const status = diagnostics?.browser?.status;
  if (status) {
    parts.push(`browser exited with code ${status.code}${status.signal ? `, signal ${status.signal}` : ""}`);
  }
  if (diagnostics?.stream) {
    const stream = diagnostics.stream;
    parts.push(`stream ${Number(stream.bytes_written) || 0} byte(s) in ${Number(stream.chunk_count) || 0} chunk(s)`);
  }
  return parts.join("; ");
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

async function writeAll(file, bytes) {
  let offset = 0;
  while (offset < bytes.length) {
    const written = await file.write(bytes.subarray(offset));
    if (!Number.isFinite(written) || written <= 0) throw new Error("PDF output file accepted no additional bytes.");
    offset += written;
  }
}

function cdpStreamBytes(data, base64Encoded) {
  if (base64Encoded) return bytesFromBase64(data);
  return new TextEncoder().encode(String(data || ""));
}

async function releaseMemoryBeforePdf(client) {
  const result = {
    renderer_garbage_collection_requested: false,
    helper_garbage_collection_requested: false,
  };
  await delay(0);
  try {
    await client.send("HeapProfiler.collectGarbage", {}, 15000);
    result.renderer_garbage_collection_requested = true;
  } catch {
    // Some Chromium-family browsers do not expose this optional CDP command.
  }
  try {
    if (typeof globalThis.gc === "function") {
      globalThis.gc();
      result.helper_garbage_collection_requested = true;
    }
  } catch {
    // Explicit helper GC is normally unavailable unless Deno was launched with a V8 flag.
  }
  await delay(0);
  return result;
}

async function streamPdfToAtomicFile(client, outputPath, params) {
  const partialPath = `${outputPath}.partial`;
  try { await Deno.remove(partialPath); } catch { /* no stale partial */ }

  const streamState = {
    transfer_mode: "ReturnAsStream",
    partial_filename: basename(partialPath),
    output_filename: basename(outputPath),
    chunk_size_bytes: PDF_STREAM_CHUNK_SIZE_BYTES,
    chunk_count: 0,
    bytes_written: 0,
    print_command_elapsed_ms: 0,
    stream_elapsed_ms: 0,
    total_elapsed_ms: 0,
    eof_received: false,
    stream_closed: false,
    partial_removed_after_failure: false,
  };
  const started = Date.now();
  let lastProgressAt = started;
  let handle = "";
  let file = null;
  const hasher = new IncrementalSha256();
  const signature = [];

  try {
    const printStarted = Date.now();
    const result = await client.send("Page.printToPDF", {
      ...params,
      transferMode: "ReturnAsStream",
    }, PDF_PRINT_COMMAND_TIMEOUT_MS);
    streamState.print_command_elapsed_ms = Date.now() - printStarted;
    handle = String(result.stream || "");
    if (!handle) {
      throw new Error("Chromium did not return a PDF stream handle.");
    }

    file = await Deno.open(partialPath, { createNew: true, write: true });
    const streamStarted = Date.now();
    while (!streamState.eof_received) {
      if (Date.now() - started > PDF_STREAM_TOTAL_TIMEOUT_MS) {
        throw new Error(`PDF streaming exceeded the ${Math.round(PDF_STREAM_TOTAL_TIMEOUT_MS / 1000)}-second safety timeout.`);
      }
      let chunk;
      try {
        chunk = await client.send("IO.read", {
          handle,
          size: PDF_STREAM_CHUNK_SIZE_BYTES,
        }, PDF_STREAM_READ_TIMEOUT_MS);
      } catch (error) {
        if (String(error?.message || error).includes("Timed out waiting for CDP command: IO.read")) {
          throw new Error(`PDF stream was idle for more than ${Math.round(PDF_STREAM_READ_TIMEOUT_MS / 1000)} seconds.`);
        }
        throw error;
      }
      const bytes = cdpStreamBytes(chunk.data, Boolean(chunk.base64Encoded));
      if (bytes.length > 0) {
        await writeAll(file, bytes);
        hasher.update(bytes);
        streamState.chunk_count += 1;
        streamState.bytes_written += bytes.length;
        lastProgressAt = Date.now();
        for (let index = 0; index < bytes.length && signature.length < 8; index += 1) signature.push(bytes[index]);
      } else if (!chunk.eof && Date.now() - lastProgressAt > PDF_STREAM_READ_TIMEOUT_MS) {
        throw new Error(`PDF stream produced no data for more than ${Math.round(PDF_STREAM_READ_TIMEOUT_MS / 1000)} seconds.`);
      } else if (!chunk.eof) {
        await delay(25);
      }
      streamState.eof_received = Boolean(chunk.eof);
    }
    streamState.stream_elapsed_ms = Date.now() - streamStarted;
    if (streamState.bytes_written <= 0) throw new Error("Chromium returned an empty PDF stream.");
    const signatureText = new TextDecoder().decode(new Uint8Array(signature));
    if (!signatureText.startsWith("%PDF-")) throw new Error("The streamed output did not contain a valid PDF signature.");

    await file.sync();
    file.close();
    file = null;
    try {
      await client.send("IO.close", { handle }, 15000);
      streamState.stream_closed = true;
    } finally {
      handle = "";
    }
    await Deno.rename(partialPath, outputPath);
    streamState.total_elapsed_ms = Date.now() - started;
    return {
      bytes: streamState.bytes_written,
      sha256: hasher.digestHex(),
      transport: {
        ...streamState,
        partial_filename: "",
        atomic_write_completed: true,
      },
    };
  } catch (error) {
    streamState.total_elapsed_ms = Date.now() - started;
    if (file) {
      try { file.close(); } catch { /* ignore */ }
      file = null;
    }
    if (handle) {
      try {
        await client.send("IO.close", { handle }, 5000);
        streamState.stream_closed = true;
      } catch {
        // The browser or transport may already be unavailable.
      }
    }
    try {
      await Deno.remove(partialPath);
      streamState.partial_removed_after_failure = true;
    } catch {
      streamState.partial_removed_after_failure = !(await pathExists(partialPath));
    }
    const diagnostics = await collectPdfFailureDiagnostics(client, streamState);
    const summary = summarizePdfFailureDiagnostics(diagnostics);
    const enhanced = new Error(`${error?.message || error}${summary ? ` (${summary})` : ""}`);
    enhanced.cause = error;
    enhanced.pdf_diagnostics = diagnostics;
    throw enhanced;
  } finally {
    if (file) {
      try { file.close(); } catch { /* ignore */ }
    }
  }
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

function isPdfPageRangeOutOfBoundsError(error) {
  const message = String(error?.message || error || "");
  return /page range|page ranges|exceeds page count|outside.*page|no pages|invalid.*page.*range/i.test(message);
}

async function estimateLivePdfPages(client, params) {
  const metrics = await client.send("Page.getLayoutMetrics", {}, 30000);
  const content = metrics.cssContentSize || metrics.contentSize || {};
  const contentHeightCssPx = Math.max(1, Number(content.height) || 1);
  const paperHeightIn = Boolean(params.landscape)
    ? Math.max(0.1, Number(params.paperWidth) || 8.5)
    : Math.max(0.1, Number(params.paperHeight) || 11);
  const printableHeightIn = Math.max(
    0.01,
    paperHeightIn - Math.max(0, Number(params.marginTop) || 0) - Math.max(0, Number(params.marginBottom) || 0),
  );
  const scale = Math.max(0.1, Number(params.scale) || 1);
  const printableHeightCssPx = (printableHeightIn * 96) / scale;
  const estimatedPages = Math.max(1, Math.ceil(contentHeightCssPx / Math.max(1, printableHeightCssPx)));
  return {
    estimated_pages: estimatedPages,
    content_height_css_px: contentHeightCssPx,
    printable_height_in: printableHeightIn,
    printable_height_css_px: printableHeightCssPx,
    scale,
    prefer_css_page_size: Boolean(params.preferCSSPageSize),
    note: "This is a lightweight estimate used only to choose the large-PDF policy; Chromium print CSS may change the actual page count.",
  };
}

async function probeLivePdfPageExists(client, params, pageNumber) {
  let handle = "";
  try {
    const result = await client.send("Page.printToPDF", {
      ...params,
      pageRanges: String(pageNumber),
      transferMode: "ReturnAsStream",
    }, PDF_PRINT_COMMAND_TIMEOUT_MS);
    handle = String(result.stream || "");
    if (!handle) throw new Error("Chromium did not return a PDF stream handle while probing the next page.");
    return { exists: true, error: "" };
  } catch (error) {
    if (isPdfPageRangeOutOfBoundsError(error)) return { exists: false, error: "" };
    return { exists: null, error: String(error?.message || error) };
  } finally {
    if (handle) {
      try { await client.send("IO.close", { handle }, 15000); } catch { /* best effort */ }
    }
  }
}

async function uniquePdfSetPaths(folder, baseName) {
  let attempt = 1;
  while (attempt < 10000) {
    const suffix = attempt === 1 ? "" : `_${attempt}`;
    const stem = joinPath(folder, `${baseName}${suffix}`);
    const descriptorPath = `${stem}.pdfset.json`;
    const firstPartPath = `${stem}_part001.pdf`;
    if (!(await pathExists(descriptorPath)) && !(await pathExists(firstPartPath))) {
      return { stem, descriptorPath };
    }
    attempt += 1;
  }
  throw new Error("Could not create a unique Live Page PDF set filename.");
}

async function writePdfSetDescriptor(path, payload) {
  const partialPath = `${path}.partial`;
  try { await Deno.remove(partialPath); } catch { /* no stale partial */ }
  try {
    await Deno.writeTextFile(partialPath, JSON.stringify(payload, null, 2) + "\n");
    await Deno.rename(partialPath, path);
    const info = await Deno.stat(path);
    return { bytes: info.size, sha256: await sha256File(path) };
  } catch (error) {
    try { await Deno.remove(partialPath); } catch { /* best effort */ }
    throw error;
  }
}

function livePdfPartArtifact(path, record, config, pageRange, partNumber) {
  return {
    kind: "web_page_pdf_part",
    role: "live_page_pdf_part",
    path,
    sha256: record.sha256,
    size_bytes: record.bytes,
    page_range: pageRange,
    part_number: partNumber,
    landscape: Boolean(config.pdf_landscape),
    display_header_footer: Boolean(config.pdf_display_header_footer),
    print_background: Boolean(config.pdf_print_background),
    paper_width_in: Number(config.pdf_paper_width_in) || 8.5,
    paper_height_in: Number(config.pdf_paper_height_in) || 11,
    scale: Number(config.pdf_scale) || 1,
    source_mode: "live_webpage",
    transfer_mode: record.transport.transfer_mode,
    stream_chunk_count: record.transport.chunk_count,
    stream_chunk_size_bytes: record.transport.chunk_size_bytes,
    stream_elapsed_ms: record.transport.stream_elapsed_ms,
    atomic_write: true,
  };
}

async function captureSplitLivePagePdf(client, config, outputFolder, baseName, pdfContext, params, estimate, memoryPreparation) {
  const pagesPerPart = Math.max(1, Math.min(500, Number(config.pdf_pages_per_part) || 50));
  const maximumTotalPages = Math.max(1, Math.min(5000, Number(config.pdf_max_total_pages) || 500));
  const maximumParts = Math.max(1, Math.min(100, Number(config.pdf_max_parts) || 20));
  const setPaths = await uniquePdfSetPaths(outputFolder, `${baseName}_print`);
  const descriptorPath = setPaths.descriptorPath;
  const stem = setPaths.stem;
  const artifacts = [];
  const parts = [];
  const warnings = [];
  const partialReasons = [];
  let nextPage = 1;
  let complete = false;
  let terminationReason = "";
  let terminalError = "";

  while (parts.length < maximumParts && nextPage <= maximumTotalPages) {
    const partNumber = parts.length + 1;
    const lastPage = Math.min(maximumTotalPages, nextPage + pagesPerPart - 1);
    const pageRange = `${nextPage}-${lastPage}`;
    const partPath = `${stem}_part${String(partNumber).padStart(3, "0")}.pdf`;
    try {
      const record = await streamPdfToAtomicFile(client, partPath, { ...params, pageRanges: pageRange });
      const artifact = livePdfPartArtifact(partPath, record, config, pageRange, partNumber);
      artifacts.push(artifact);
      parts.push({
        part_number: partNumber,
        filename: basename(partPath),
        page_range: pageRange,
        size_bytes: record.bytes,
        sha256: record.sha256,
        transport: record.transport,
      });
      console.log(`Live Page PDF part ${partNumber} completed: pages ${pageRange}.`);
      nextPage = lastPage + 1;
    } catch (error) {
      if (isPdfPageRangeOutOfBoundsError(error) && parts.length > 0) {
        complete = true;
        terminationReason = "document_end";
        break;
      }
      terminalError = String(error?.message || error);
      terminationReason = parts.length > 0 ? "part_failure" : "initial_part_failure";
      if (!parts.length) throw error;
      warnings.push(`Live Page PDF splitting stopped after ${parts.length} completed part(s): ${terminalError}`);
      partialReasons.push("pdf_split_part_failure");
      break;
    }
  }

  if (!complete && !terminalError && parts.length > 0) {
    const probe = await probeLivePdfPageExists(client, params, nextPage);
    if (probe.exists === false) {
      complete = true;
      terminationReason = "document_end_at_safety_boundary";
    } else {
      terminationReason = nextPage > maximumTotalPages ? "maximum_total_pages" : "maximum_parts";
      warnings.push(
        probe.exists === true
          ? `Live Page PDF reached the configured ${terminationReason === "maximum_total_pages" ? "maximum total pages" : "maximum parts"} limit; completed parts were preserved and the PDF result is partial.`
          : `Live Page PDF reached a configured safety limit and the next page could not be probed (${probe.error}); completed parts were preserved and the PDF result is partial.`,
      );
      partialReasons.push(terminationReason === "maximum_total_pages" ? "pdf_maximum_total_pages_reached" : "pdf_maximum_parts_reached");
      if (probe.error) terminalError = probe.error;
    }
  }

  const descriptor = {
    type: "wavi-live-page-pdf-set",
    schema_version: 1,
    created_utc: nowIso(),
    requested_url: String(pdfContext.requested_url || ""),
    final_url: String(pdfContext.final_url || ""),
    page_title: String(pdfContext.page_title || ""),
    capture_utc: String(pdfContext.capture_utc || ""),
    source_mode: "live_webpage",
    complete,
    partial: !complete,
    termination_reason: terminationReason,
    terminal_error: terminalError,
    page_estimate: estimate,
    pages_per_part: pagesPerPart,
    maximum_total_pages: maximumTotalPages,
    maximum_parts: maximumParts,
    parts_completed: parts.length,
    next_page_not_captured: complete ? null : nextPage,
    parts,
    warnings,
  };
  const descriptorRecord = await writePdfSetDescriptor(descriptorPath, descriptor);
  artifacts.push({
    kind: "web_page_pdf_set_metadata",
    role: "live_page_pdf_set_metadata",
    path: descriptorPath,
    sha256: descriptorRecord.sha256,
    size_bytes: descriptorRecord.bytes,
    source_mode: "live_webpage",
    complete,
    parts_completed: parts.length,
  });

  return {
    artifacts,
    warnings,
    partial_reasons: partialReasons,
    large_pdf: {
      requested_handling: normalizePdfLargeHandling(config.pdf_large_handling),
      requested_handling_label: pdfLargeHandlingLabel(config.pdf_large_handling),
      effective_handling: "split",
      estimate,
      pages_per_part: pagesPerPart,
      maximum_total_pages: maximumTotalPages,
      maximum_parts: maximumParts,
      complete,
      termination_reason: terminationReason,
      parts_completed: parts.length,
      descriptor_filename: basename(descriptorPath),
      terminal_error: terminalError,
    },
    transport: {
      transfer_mode: "ReturnAsStream",
      part_count: parts.length,
      total_bytes: parts.reduce((sum, part) => sum + Number(part.size_bytes || 0), 0),
      total_chunks: parts.reduce((sum, part) => sum + Number(part.transport?.chunk_count || 0), 0),
      memory_preparation: memoryPreparation,
    },
  };
}

async function capturePdf(client, config, outputFolder, baseName, pdfContext, capture) {
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
    const outputPath = await uniqueOutputPath(outputFolder, `${baseName}_print`, ".pdf");
    const pngServer = await startPaginatedPngPdfServer(config, capture);
    try {
      const preparedInfo = await navigateToPaginatedPdfDocument(client, pngServer.documentUrl);
      delete params.pageRanges;
      params.preferCSSPageSize = false;
      const memoryPreparation = await releaseMemoryBeforePdf(client);
      const record = await streamPdfToAtomicFile(client, outputPath, params);
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
          transfer_mode: record.transport.transfer_mode,
          stream_chunk_count: record.transport.chunk_count,
          stream_chunk_size_bytes: record.transport.chunk_size_bytes,
          stream_elapsed_ms: record.transport.stream_elapsed_ms,
          atomic_write: true,
        }],
        behavior: {
          behavior: normalizePdfPageBehavior(config.pdf_page_behavior),
          applied: false,
          matched_elements: 0,
          modified_elements: 0,
          hidden_elements: 0,
          note: "PDF generated by paginating the captured PNG; Live Page splitting settings were not applied.",
          sample_elements: [],
        },
        capture_mode: captureMode,
        source_info: { ...pngServer.sourceInfo, ...preparedInfo },
        large_pdf: {
          requested_handling: normalizePdfLargeHandling(config.pdf_large_handling),
          effective_handling: "not_applicable",
          note: "Large Live Page PDF handling applies only to Live Page PDFs.",
        },
        warnings: [],
        partial_reasons: [],
        transport: {
          ...record.transport,
          memory_preparation: memoryPreparation,
        },
      };
    } finally {
      await pngServer.close();
    }
  }

  const behaviorInfo = await applyPdfPageBehavior(client, config.pdf_page_behavior);
  try {
    const memoryPreparation = await releaseMemoryBeforePdf(client);
    const estimate = await estimateLivePdfPages(client, params);
    const requestedHandling = normalizePdfLargeHandling(config.pdf_large_handling);
    const automaticThreshold = Math.max(2, Math.min(5000, Number(config.pdf_auto_split_threshold_pages) || 100));
    const maximumTotalPages = Math.max(1, Math.min(5000, Number(config.pdf_max_total_pages) || 500));
    const manualPageRanges = String(params.pageRanges || "").trim();
    let effectiveHandling = requestedHandling;
    if (manualPageRanges) effectiveHandling = "single_manual_page_ranges";
    else if (requestedHandling === "automatic") effectiveHandling = estimate.estimated_pages >= automaticThreshold ? "split" : "single";
    else if (requestedHandling === "fail") {
      if (estimate.estimated_pages > maximumTotalPages) {
        throw new Error(`Estimated Live Page PDF length (${estimate.estimated_pages} pages) exceeds the configured safety limit of ${maximumTotalPages} pages.`);
      }
      effectiveHandling = "single";
    }
    console.log(
      `Live Page PDF handling: requested=${requestedHandling}, effective=${effectiveHandling}, estimated_pages=${estimate.estimated_pages}, ` +
      `automatic_threshold=${automaticThreshold}, maximum_total_pages=${maximumTotalPages}.`,
    );

    if (effectiveHandling === "split") {
      const splitResult = await captureSplitLivePagePdf(
        client, config, outputFolder, baseName, pdfContext, params, estimate, memoryPreparation,
      );
      return {
        ...splitResult,
        behavior: behaviorInfo,
        capture_mode: captureMode,
        source_info: null,
      };
    }

    const outputPath = await uniqueOutputPath(outputFolder, `${baseName}_print`, ".pdf");
    const record = await streamPdfToAtomicFile(client, outputPath, params);
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
        transfer_mode: record.transport.transfer_mode,
        stream_chunk_count: record.transport.chunk_count,
        stream_chunk_size_bytes: record.transport.chunk_size_bytes,
        stream_elapsed_ms: record.transport.stream_elapsed_ms,
        atomic_write: true,
      }],
      behavior: behaviorInfo,
      capture_mode: captureMode,
      source_info: null,
      warnings: [],
      partial_reasons: [],
      large_pdf: {
        requested_handling: requestedHandling,
        requested_handling_label: pdfLargeHandlingLabel(requestedHandling),
        effective_handling: effectiveHandling,
        automatic_split_threshold_pages: automaticThreshold,
        maximum_total_pages: maximumTotalPages,
        estimate,
        manual_page_ranges_override: Boolean(manualPageRanges),
      },
      transport: {
        ...record.transport,
        memory_preparation: memoryPreparation,
      },
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

const IMMUTABLE_INTERACTIVE_BLOCK_TERMS = [
  "follow", "unfollow", "like", "unlike", "react", "share", "repost", "retweet",
  "send", "message", "comment", "reply", "subscribe", "unsubscribe", "join", "invite",
  "block", "mute", "report", "sign in", "signin", "log in", "login", "sign up", "signup",
  "register", "submit", "confirm", "approve", "delete", "remove", "edit", "upload",
  "publish", "buy", "purchase", "checkout", "cart", "payment", "donate", "book",
  "reserve", "download", "install", "open app", "launch app", "call", "mailto", "tel:",
  "javascript:", "cookie preferences", "cookie settings", "accept cookies", "notifications",
];

const GENERIC_INTERACTIVE_TRIGGER_TERMS = [
  "image", "img", "media", "card", "post", "photo", "picture", "video", "tile",
  "figure", "preview", "detail", "details", "story", "reel", "gallery", "slide",
  "album", "attachment", "thumb", "carousel", "slideshow", "viewer", "lightbox",
  "zoom", "expand", "permalink",
];

const INTERACTIVE_MEDIA_ROUTE_MARKERS = [
  "reel", "reels", "photo", "photos", "p", "post", "posts", "tv", "video", "videos",
  "story", "stories", "highlight", "highlights", "media", "image", "images", "gallery",
  "galleries", "album", "albums", "attachment", "attachments", "status", "statuses",
];

function normalizeInteractiveCaptureScope(value) {
  const scope = String(value || "overlay_only").trim();
  if (["overlay_only", "viewport_only", "overlay_and_viewport"].includes(scope)) return scope;
  return "overlay_only";
}

function normalizeInteractiveRules(rules) {
  const allowed = new Set(["trigger", "overlay", "close", "next", "previous", "any"]);
  const output = [];
  const seen = new Set();
  for (const rule of Array.isArray(rules) ? rules : []) {
    const category = allowed.has(String(rule?.category || "").trim().toLowerCase())
      ? String(rule.category).trim().toLowerCase()
      : "any";
    const term = String(rule?.term || "").trim();
    if (!term || term.length > 200) continue;
    const key = `${category}|${term.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push({ category, term });
  }
  return output;
}

function interactiveRulesForCategory(rules, category) {
  return normalizeInteractiveRules(rules)
    .filter((rule) => rule.category === category || rule.category === "any")
    .map((rule) => rule.term);
}

async function dispatchMouseClick(client, point) {
  const x = Math.max(1, Number(point?.x) || 1);
  const y = Math.max(1, Number(point?.y) || 1);
  await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none" }, 10000);
  await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 }, 10000);
  await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 }, 10000);
}

async function dispatchEscapeKey(client) {
  await client.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 }, 10000);
  await client.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 }, 10000);
}

async function getInteractiveOverlayFingerprints(client, rules) {
  const overlayTerms = interactiveRulesForCategory(rules, "overlay");
  return await evaluate(client, `(() => {
    const TERMS = ${JSON.stringify(overlayTerms)};
    const norm = (value) => String(value || "").replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const termMatch = (haystack, term) => {
      const raw = String(haystack || "").toLowerCase();
      const rawTerm = String(term || "").toLowerCase().trim();
      const h = norm(haystack); const t = norm(rawTerm);
      if (!rawTerm) return false;
      if (!t) return raw.includes(rawTerm);
      const exactWords = (" " + h + " ").includes(" " + t + " ");
      const punctuatedRaw = /[^a-z0-9\\s]/.test(rawTerm) && raw.includes(rawTerm);
      return t.length <= 4 ? (exactWords || punctuatedRaw) : (exactWords || h.includes(t) || punctuatedRaw);
    };
    const descriptor = (el) => [
      el.tagName, el.getAttribute("role"), el.getAttribute("aria-label"), el.getAttribute("aria-modal"),
      el.id, el.className, el.getAttribute("title"), el.getAttribute("aria-labelledby"),
      el.getAttribute("aria-describedby"), el.getAttribute("data-testid"), el.getAttribute("data-test"),
      el.getAttribute("data-role"), el.getAttribute("data-state"), el.textContent
    ].map((value) => typeof value === "string" ? value : "").join(" ").slice(0, 1600);
    const visible = (el) => {
      if (!(el instanceof Element)) return false;
      const style = getComputedStyle(el); const rect = el.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > 0.02 && rect.width >= 80 && rect.height >= 60;
    };
    const candidates = new Set();
    for (const selector of ["dialog", "[role='dialog']", "[aria-modal='true']", "[class*='modal' i]", "[class*='lightbox' i]", "[class*='overlay' i]", "[class*='viewer' i]", "[id*='modal' i]", "[id*='lightbox' i]", "[id*='overlay' i]", "[id*='viewer' i]"]) {
      for (const el of document.querySelectorAll(selector)) candidates.add(el);
    }
    const output = [];
    for (const el of candidates) {
      if (!visible(el)) continue;
      const desc = descriptor(el);
      const semantic = el.tagName === "DIALOG" || el.getAttribute("role") === "dialog" || el.getAttribute("aria-modal") === "true";
      if (!semantic && TERMS.length && !TERMS.some((term) => termMatch(desc, term))) continue;
      const rect = el.getBoundingClientRect();
      output.push(norm(desc).slice(0, 320) + "|" + Math.round(rect.width) + "x" + Math.round(rect.height) + "|" + Math.round(rect.left) + "," + Math.round(rect.top));
    }
    return output;
  })()`, 30000);
}

async function discoverInteractiveTrigger(client, config, processedFingerprints) {
  const whitelist = normalizeInteractiveRules(config?.whitelist_rules);
  const blacklist = normalizeInteractiveRules(config?.blacklist_rules);
  const triggerRules = whitelist
    .filter((rule) => rule.category === "trigger" || rule.category === "any")
    .map((rule) => ({
      term: String(rule.term || "").replace(/^safe\s*:/i, "").trim(),
      explicit_safe: /^safe\s*:/i.test(String(rule.term || "")),
    }))
    .filter((rule) => rule.term);
  const blockedTerms = [...interactiveRulesForCategory(blacklist, "trigger"), ...IMMUTABLE_INTERACTIVE_BLOCK_TERMS];
  return await evaluate(client, `(() => {
    const TRIGGER_RULES = ${JSON.stringify(triggerRules)};
    const BLOCKED_TERMS = ${JSON.stringify(blockedTerms)};
    const GENERIC_TERMS = new Set(${JSON.stringify(GENERIC_INTERACTIVE_TRIGGER_TERMS)});
    const MEDIA_ROUTE_MARKERS = new Set(${JSON.stringify(INTERACTIVE_MEDIA_ROUTE_MARKERS)});
    const PROCESSED = new Set(${JSON.stringify(Array.from(processedFingerprints || []))});
    const ATTR = "data-wavi-interactive-trigger";
    for (const node of document.querySelectorAll("[" + ATTR + "]")) node.removeAttribute(ATTR);
    const norm = (value) => String(value || "").replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const termMatch = (haystack, term) => {
      const raw = String(haystack || "").toLowerCase();
      const rawTerm = String(term || "").toLowerCase().trim();
      const h = norm(haystack); const t = norm(rawTerm);
      if (!rawTerm) return false;
      if (!t) return raw.includes(rawTerm);
      const exactWords = (" " + h + " ").includes(" " + t + " ");
      const punctuatedRaw = /[^a-z0-9\\s]/.test(rawTerm) && raw.includes(rawTerm);
      return t.length <= 4 ? (exactWords || punctuatedRaw) : (exactWords || h.includes(t) || punctuatedRaw);
    };
    const visible = (el) => {
      if (!(el instanceof Element)) return false;
      const style = getComputedStyle(el); const rect = el.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > 0.02 && rect.width >= 24 && rect.height >= 24;
    };
    const descriptor = (el) => {
      const media = el.matches("img,video,picture,figure") ? el : el.querySelector("img,video,picture,figure");
      return [
        el.tagName, el.getAttribute("role"), el.getAttribute("aria-label"), el.id, el.className,
        el.getAttribute("title"), el.getAttribute("alt"), el.getAttribute("href"), el.getAttribute("src"),
        el.getAttribute("aria-haspopup"), el.getAttribute("aria-controls"), el.getAttribute("aria-expanded"),
        el.getAttribute("data-testid"), el.getAttribute("data-test"), el.getAttribute("data-role"),
        el.getAttribute("data-action"), el.getAttribute("data-target"), el.getAttribute("data-toggle"),
        el.getAttribute("data-id"), el.getAttribute("data-item-id"), el.getAttribute("data-media-id"),
        media?.getAttribute("alt"), media?.getAttribute("src"), el.innerText
      ].map((value) => typeof value === "string" ? value : "").join(" ").slice(0, 2400);
    };
    const routeLooksLikeMedia = (href) => {
      if (!href) return false;
      try {
        const url = new URL(href, location.href);
        const segments = url.pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part).toLowerCase());
        for (let i = 0; i < segments.length; i += 1) {
          if (MEDIA_ROUTE_MARKERS.has(segments[i]) && Boolean(segments[i + 1])) return true;
        }
        if (["id", "media_id", "post_id", "content_id", "photo_id", "video_id"].some((key) => Boolean(url.searchParams.get(key)))) return true;
        return /\\.(?:jpe?g|png|webp|gif|avif|mp4|webm|mov)(?:$|[?#])/i.test(url.pathname + url.search + url.hash);
      } catch {
        return false;
      }
    };
    const explicitOverlaySignal = (el) => {
      const hasPopup = String(el.getAttribute("aria-haspopup") || "").toLowerCase();
      if (["dialog", "true"].includes(hasPopup)) return true;
      const controls = String(el.getAttribute("aria-controls") || "").trim();
      if (controls) {
        const controlled = document.getElementById(controls);
        if (controlled && (
          controlled.matches("dialog,[role='dialog'],[aria-modal='true']") ||
          /modal|dialog|lightbox|overlay|viewer|preview|gallery/i.test(String(controlled.id || "") + " " + String(controlled.className || ""))
        )) return true;
      }
      const target = [el.getAttribute("data-target"), el.getAttribute("data-toggle"), el.getAttribute("data-action")].filter(Boolean).join(" ");
      return /modal|dialog|lightbox|overlay|viewer|preview|gallery|open[-_ ]?(?:image|photo|video|media|post)/i.test(target);
    };
    const candidateElements = [];
    const seenElements = new Set();
    for (const raw of document.querySelectorAll("a,button,[role='button'],[role='link'],[tabindex]:not([tabindex='-1']),[onclick],[aria-haspopup],img,video,picture,figure")) {
      let el = raw;
      if (raw.matches("img,video,picture,figure")) {
        const actionableAncestor = raw.closest("a,button,[role='button'],[role='link'],[tabindex]:not([tabindex='-1']),[onclick],[aria-haspopup]");
        const rawStyle = getComputedStyle(raw);
        const rawIsActionable = raw.matches("[role='button'],[role='link'],[tabindex]:not([tabindex='-1']),[onclick],[aria-haspopup],[aria-controls],[data-action],[data-target],[data-toggle]") || rawStyle.cursor === "pointer";
        if (!actionableAncestor && !rawIsActionable) continue;
        el = actionableAncestor || raw;
      }
      if (seenElements.has(el)) continue;
      seenElements.add(el);
      candidateElements.push(el);
    }
    const pageOrigin = location.origin;
    const ranked = [];
    for (const el of candidateElements) {
      if (!visible(el)) continue;
      if (el.closest("form")) continue;
      if (el.matches("input,select,textarea") || el.getAttribute("type") === "submit" || el.getAttribute("type") === "reset") continue;
      if (el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true") continue;
      const href = el.closest("a")?.href || el.getAttribute("href") || "";
      if (/^(javascript:|mailto:|tel:)/i.test(href)) continue;
      if (href) {
        try { if (new URL(href, location.href).origin !== pageOrigin) continue; } catch { continue; }
      }
      const desc = descriptor(el);
      if (BLOCKED_TERMS.some((term) => termMatch(desc, term))) continue;
      const matchedRules = TRIGGER_RULES.filter((rule) => termMatch(desc, rule.term));
      const matched = matchedRules.map((rule) => rule.term);
      const matchedSafeRules = matchedRules.filter((rule) => rule.explicit_safe).map((rule) => rule.term);
      const hasMedia = Boolean(el.matches("img,video,picture,figure") || el.querySelector("img,video,picture,figure"));
      const role = String(el.getAttribute("role") || "").toLowerCase();
      if (!matched.length) continue;
      if (!hasMedia && !["button", "link"].includes(role) && !el.matches("a,button")) continue;
      const isLink = Boolean(href) || el.matches("a,[role='link']");
      const routeMedia = routeLooksLikeMedia(href);
      const overlaySignal = explicitOverlaySignal(el);
      const genericOnly = matchedRules.every((rule) => GENERIC_TERMS.has(norm(rule.term)));
      if (isLink) {
        if (!routeMedia && !matchedSafeRules.length && genericOnly) continue;
      } else {
        if (!overlaySignal && !matchedSafeRules.length) continue;
        if (genericOnly && !matchedSafeRules.length && !overlaySignal) continue;
      }
      const rect = el.getBoundingClientRect();
      const absoluteY = Math.round(window.scrollY + rect.top);
      let hrefKey = "";
      if (href) {
        try {
          const url = new URL(href, location.href);
          hrefKey = String(url.origin || "") + String(url.pathname || "") + String(url.search || "");
        } catch {
          hrefKey = String(href);
        }
      }
      const fingerprint = hrefKey
        ? ("href|" + String(hrefKey || "")).slice(0, 900)
        : [
          el.tagName, el.id, el.getAttribute("data-id"), el.getAttribute("data-item-id"),
          el.getAttribute("data-media-id"), el.getAttribute("aria-label"), el.getAttribute("alt"),
          norm(el.innerText).slice(0, 180), absoluteY
        ].map((value) => String(value || "")).join("|").slice(0, 900);
      if (PROCESSED.has(fingerprint)) continue;
      const inViewport = rect.bottom > 0 && rect.top < window.innerHeight;
      const score = matched.length * 10 + (hasMedia ? 8 : 0) + (inViewport ? 5 : 0) + (routeMedia ? 12 : 0) + (overlaySignal ? 10 : 0) + (matchedSafeRules.length ? 15 : 0) + Math.min(5, Math.round((rect.width * rect.height) / 50000));
      ranked.push({ el, desc, href, fingerprint, matched, matchedSafeRules, score, absoluteY, rect, routeMedia, overlaySignal, genericOnly });
    }
    ranked.sort((a, b) => b.score - a.score || a.absoluteY - b.absoluteY);
    const selected = ranked[0];
    if (!selected) return null;
    const id = "trigger-" + Date.now() + "-" + Math.random().toString(36).slice(2);
    selected.el.setAttribute(ATTR, id);
    selected.el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    const rect = selected.el.getBoundingClientRect();
    return {
      id,
      fingerprint: selected.fingerprint,
      descriptor: selected.desc.slice(0, 1200),
      matched_terms: selected.matched,
      matched_safe_rules: selected.matchedSafeRules,
      href: selected.href,
      page_url_before: location.href,
      scroll_x_before: window.scrollX,
      scroll_y_before: window.scrollY,
      x: Math.max(1, Math.min(window.innerWidth - 1, rect.left + rect.width / 2)),
      y: Math.max(1, Math.min(window.innerHeight - 1, rect.top + rect.height / 2)),
      width: rect.width,
      height: rect.height,
      absolute_y: selected.absoluteY,
      qualification: {
        route_looks_like_media: selected.routeMedia,
        explicit_overlay_signal: selected.overlaySignal,
        generic_terms_only: selected.genericOnly,
        explicit_safe_rule: selected.matchedSafeRules.length > 0,
      },
    };
  })()`, 30000);
}

async function validateInteractiveTriggerBeforeClick(client, config, trigger) {
  const whitelist = normalizeInteractiveRules(config?.whitelist_rules);
  const blacklist = normalizeInteractiveRules(config?.blacklist_rules);
  const triggerRules = whitelist
    .filter((rule) => rule.category === "trigger" || rule.category === "any")
    .map((rule) => ({
      term: String(rule.term || "").replace(/^safe\s*:/i, "").trim(),
      explicit_safe: /^safe\s*:/i.test(String(rule.term || "")),
    }))
    .filter((rule) => rule.term);
  const blockedTerms = [...interactiveRulesForCategory(blacklist, "trigger"), ...IMMUTABLE_INTERACTIVE_BLOCK_TERMS];
  return await evaluate(client, `(() => {
    const TRIGGER = ${JSON.stringify(trigger || {})};
    const TRIGGER_RULES = ${JSON.stringify(triggerRules)};
    const BLOCKED_TERMS = ${JSON.stringify(blockedTerms)};
    const GENERIC_TERMS = new Set(${JSON.stringify(GENERIC_INTERACTIVE_TRIGGER_TERMS)});
    const MEDIA_ROUTE_MARKERS = new Set(${JSON.stringify(INTERACTIVE_MEDIA_ROUTE_MARKERS)});
    const ATTR = "data-wavi-interactive-trigger";
    const norm = (value) => String(value || "").replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const termMatch = (haystack, term) => {
      const raw = String(haystack || "").toLowerCase();
      const rawTerm = String(term || "").toLowerCase().trim();
      const h = norm(haystack); const t = norm(rawTerm);
      if (!rawTerm) return false;
      if (!t) return raw.includes(rawTerm);
      const exactWords = (" " + h + " ").includes(" " + t + " ");
      const punctuatedRaw = /[^a-z0-9\\s]/.test(rawTerm) && raw.includes(rawTerm);
      return t.length <= 4 ? (exactWords || punctuatedRaw) : (exactWords || h.includes(t) || punctuatedRaw);
    };
    const descriptor = (el) => {
      if (!(el instanceof Element)) return "";
      const media = el.matches("img,video,picture,figure") ? el : el.querySelector("img,video,picture,figure");
      return [
        el.tagName, el.getAttribute("role"), el.getAttribute("aria-label"), el.id, el.className,
        el.getAttribute("title"), el.getAttribute("alt"), el.getAttribute("href"), el.getAttribute("src"),
        el.getAttribute("aria-haspopup"), el.getAttribute("aria-controls"), el.getAttribute("aria-expanded"),
        el.getAttribute("data-testid"), el.getAttribute("data-test"), el.getAttribute("data-role"),
        el.getAttribute("data-action"), el.getAttribute("data-target"), el.getAttribute("data-toggle"),
        el.getAttribute("data-id"), el.getAttribute("data-item-id"), el.getAttribute("data-media-id"),
        media?.getAttribute("alt"), media?.getAttribute("src"), el.innerText
      ].map((value) => typeof value === "string" ? value : "").join(" ").slice(0, 2400);
    };
    const summarizeElement = (el) => {
      if (!(el instanceof Element)) return null;
      return {
        tag: el.tagName,
        role: el.getAttribute("role") || "",
        id: el.id || "",
        class_name: typeof el.className === "string" ? el.className.slice(0, 400) : "",
        aria_label: el.getAttribute("aria-label") || "",
        href: el.closest("a")?.href || el.getAttribute("href") || "",
        descriptor: descriptor(el).slice(0, 1200),
      };
    };
    const routeLooksLikeMedia = (href) => {
      if (!href) return false;
      try {
        const url = new URL(href, location.href);
        const segments = url.pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part).toLowerCase());
        for (let i = 0; i < segments.length; i += 1) {
          if (MEDIA_ROUTE_MARKERS.has(segments[i]) && Boolean(segments[i + 1])) return true;
        }
        if (["id", "media_id", "post_id", "content_id", "photo_id", "video_id"].some((key) => Boolean(url.searchParams.get(key)))) return true;
        return /\\.(?:jpe?g|png|webp|gif|avif|mp4|webm|mov)(?:$|[?#])/i.test(url.pathname + url.search + url.hash);
      } catch {
        return false;
      }
    };
    const explicitOverlaySignal = (el) => {
      const hasPopup = String(el.getAttribute("aria-haspopup") || "").toLowerCase();
      if (["dialog", "true"].includes(hasPopup)) return true;
      const controls = String(el.getAttribute("aria-controls") || "").trim();
      if (controls) {
        const controlled = document.getElementById(controls);
        if (controlled && (
          controlled.matches("dialog,[role='dialog'],[aria-modal='true']") ||
          /modal|dialog|lightbox|overlay|viewer|preview|gallery/i.test(String(controlled.id || "") + " " + String(controlled.className || ""))
        )) return true;
      }
      const target = [el.getAttribute("data-target"), el.getAttribute("data-toggle"), el.getAttribute("data-action")].filter(Boolean).join(" ");
      return /modal|dialog|lightbox|overlay|viewer|preview|gallery|open[-_ ]?(?:image|photo|video|media|post)/i.test(target);
    };
    const el = document.querySelector("[" + ATTR + "=" + CSS.escape(String(TRIGGER.id || "")) + "]");
    if (!(el instanceof Element)) return { allowed: false, reason: "trigger_missing_before_click" };
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity || 1) <= 0.02 || rect.width < 24 || rect.height < 24) {
      return { allowed: false, reason: "trigger_not_visible_before_click", current_rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
    }
    if (el.closest("form") || el.matches("input,select,textarea") || el.getAttribute("type") === "submit" || el.getAttribute("type") === "reset") {
      return { allowed: false, reason: "form_control_blocked_before_click" };
    }
    if (el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true") {
      return { allowed: false, reason: "disabled_control_before_click" };
    }
    const desc = descriptor(el);
    const blockedMatches = BLOCKED_TERMS.filter((term) => termMatch(desc, term));
    if (blockedMatches.length) {
      return { allowed: false, reason: "blocked_term_detected_before_click", blocked_terms: blockedMatches.slice(0, 20), descriptor: desc.slice(0, 1200) };
    }
    const matchedRules = TRIGGER_RULES.filter((rule) => termMatch(desc, rule.term));
    if (!matchedRules.length) return { allowed: false, reason: "whitelist_no_longer_matches_before_click", descriptor: desc.slice(0, 1200) };
    const matchedSafeRules = matchedRules.filter((rule) => rule.explicit_safe).map((rule) => rule.term);
    const genericOnly = matchedRules.every((rule) => GENERIC_TERMS.has(norm(rule.term)));
    const href = el.closest("a")?.href || el.getAttribute("href") || "";
    if (/^(javascript:|mailto:|tel:)/i.test(href)) return { allowed: false, reason: "active_or_external_scheme_blocked_before_click", href };
    if (href) {
      try {
        if (new URL(href, location.href).origin !== location.origin) return { allowed: false, reason: "cross_origin_link_blocked_before_click", href };
      } catch {
        return { allowed: false, reason: "invalid_link_before_click", href };
      }
    }
    const isLink = Boolean(href) || el.matches("a,[role='link']");
    const routeMedia = routeLooksLikeMedia(href);
    const overlaySignal = explicitOverlaySignal(el);
    if (isLink) {
      if (!routeMedia && !matchedSafeRules.length && genericOnly) {
        return { allowed: false, reason: "ambiguous_generic_link_blocked_before_click", href, matched_terms: matchedRules.map((rule) => rule.term) };
      }
    } else {
      if (!overlaySignal && !matchedSafeRules.length) {
        return { allowed: false, reason: "non_link_without_overlay_signal_blocked", matched_terms: matchedRules.map((rule) => rule.term) };
      }
      if (genericOnly && !matchedSafeRules.length && !overlaySignal) {
        return { allowed: false, reason: "generic_non_link_blocked_before_click", matched_terms: matchedRules.map((rule) => rule.term) };
      }
    }
    const oldCenterX = Number(TRIGGER.x) || 0;
    const oldCenterY = Number(TRIGGER.y) || 0;
    const newCenterX = Math.max(1, Math.min(window.innerWidth - 1, rect.left + rect.width / 2));
    const newCenterY = Math.max(1, Math.min(window.innerHeight - 1, rect.top + rect.height / 2));
    const centerDistance = Math.hypot(newCenterX - oldCenterX, newCenterY - oldCenterY);
    const widthChange = Math.abs(rect.width - (Number(TRIGGER.width) || rect.width)) / Math.max(1, Number(TRIGGER.width) || rect.width);
    const heightChange = Math.abs(rect.height - (Number(TRIGGER.height) || rect.height)) / Math.max(1, Number(TRIGGER.height) || rect.height);
    const movementThreshold = Math.max(12, Math.min(40, Math.max(rect.width, rect.height) * 0.10));
    if (centerDistance > movementThreshold || widthChange > 0.20 || heightChange > 0.20) {
      return {
        allowed: false,
        reason: "trigger_moved_materially_before_click",
        movement: { center_distance_px: centerDistance, threshold_px: movementThreshold, width_change_ratio: widthChange, height_change_ratio: heightChange },
        original_rect: { center_x: oldCenterX, center_y: oldCenterY, width: Number(TRIGGER.width) || 0, height: Number(TRIGGER.height) || 0 },
        current_rect: { center_x: newCenterX, center_y: newCenterY, width: rect.width, height: rect.height },
      };
    }
    const hit = document.elementFromPoint(newCenterX, newCenterY);
    const topmostMatches = hit === el || (hit instanceof Element && el.contains(hit));
    if (!topmostMatches) {
      return {
        allowed: false,
        reason: "trigger_obscured_before_click",
        click_point: { x: newCenterX, y: newCenterY },
        selected_element: summarizeElement(el),
        hit_tested_element: summarizeElement(hit),
      };
    }
    return {
      allowed: true,
      reason: "validated",
      x: newCenterX,
      y: newCenterY,
      href,
      descriptor: desc.slice(0, 1200),
      matched_terms: matchedRules.map((rule) => rule.term),
      matched_safe_rules: matchedSafeRules,
      route_looks_like_media: routeMedia,
      explicit_overlay_signal: overlaySignal,
      generic_terms_only: genericOnly,
      movement: { center_distance_px: centerDistance, threshold_px: movementThreshold, width_change_ratio: widthChange, height_change_ratio: heightChange },
      selected_element: summarizeElement(el),
      hit_tested_element: summarizeElement(hit),
      click_point: { x: newCenterX, y: newCenterY },
    };
  })()`, 30000);
}

async function findInteractiveOverlay(client, config, baselineFingerprints) {
  const whitelist = normalizeInteractiveRules(config?.whitelist_rules);
  const blacklist = normalizeInteractiveRules(config?.blacklist_rules);
  const overlayTerms = interactiveRulesForCategory(whitelist, "overlay");
  const blockedTerms = [...interactiveRulesForCategory(blacklist, "overlay"), ...IMMUTABLE_INTERACTIVE_BLOCK_TERMS];
  return await evaluate(client, `(() => {
    const OVERLAY_TERMS = ${JSON.stringify(overlayTerms)};
    const BLOCKED_TERMS = ${JSON.stringify(blockedTerms)};
    const BASELINE = new Set(${JSON.stringify(Array.isArray(baselineFingerprints) ? baselineFingerprints : [])});
    const ATTR = "data-wavi-interactive-overlay";
    for (const node of document.querySelectorAll("[" + ATTR + "]")) node.removeAttribute(ATTR);
    const norm = (value) => String(value || "").replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const termMatch = (haystack, term) => {
      const raw = String(haystack || "").toLowerCase();
      const rawTerm = String(term || "").toLowerCase().trim();
      const h = norm(haystack); const t = norm(rawTerm);
      if (!rawTerm) return false;
      if (!t) return raw.includes(rawTerm);
      const exactWords = (" " + h + " ").includes(" " + t + " ");
      const punctuatedRaw = /[^a-z0-9\\s]/.test(rawTerm) && raw.includes(rawTerm);
      return t.length <= 4 ? (exactWords || punctuatedRaw) : (exactWords || h.includes(t) || punctuatedRaw);
    };
    const visible = (el) => {
      if (!(el instanceof Element)) return false;
      const style = getComputedStyle(el); const rect = el.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > 0.02 && rect.width >= 100 && rect.height >= 80 && rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth;
    };
    const descriptor = (el) => [
      el.tagName, el.getAttribute("role"), el.getAttribute("aria-label"), el.getAttribute("aria-modal"),
      el.id, el.className, el.getAttribute("title"), el.getAttribute("aria-labelledby"),
      el.getAttribute("aria-describedby"), el.getAttribute("data-testid"), el.getAttribute("data-test"),
      el.getAttribute("data-role"), el.getAttribute("data-state"), el.innerText
    ].map((value) => typeof value === "string" ? value : "").join(" ").slice(0, 2400);
    const candidates = new Set();
    for (const selector of ["dialog", "[role='dialog']", "[aria-modal='true']", "[class*='modal' i]", "[class*='lightbox' i]", "[class*='overlay' i]", "[class*='viewer' i]", "[id*='modal' i]", "[id*='lightbox' i]", "[id*='overlay' i]", "[id*='viewer' i]"]) {
      for (const el of document.querySelectorAll(selector)) candidates.add(el);
    }
    for (const el of Array.from(document.body ? document.body.querySelectorAll("*") : []).slice(0, 12000)) {
      const style = getComputedStyle(el);
      const z = Number.parseInt(style.zIndex || "0", 10) || 0;
      if ((style.position === "fixed" || style.position === "sticky") && z >= 10) candidates.add(el);
    }
    const ranked = [];
    for (const el of candidates) {
      if (!visible(el)) continue;
      const desc = descriptor(el);
      if (BLOCKED_TERMS.some((term) => termMatch(desc, term))) continue;
      const semantic = el.tagName === "DIALOG" || el.getAttribute("role") === "dialog" || el.getAttribute("aria-modal") === "true";
      const matched = OVERLAY_TERMS.filter((term) => termMatch(desc, term));
      const rect = el.getBoundingClientRect();
      const areaRatio = Math.min(1, (rect.width * rect.height) / Math.max(1, window.innerWidth * window.innerHeight));
      if (!semantic && !matched.length && areaRatio < 0.30) continue;
      const fingerprint = norm(desc).slice(0, 320) + "|" + Math.round(rect.width) + "x" + Math.round(rect.height) + "|" + Math.round(rect.left) + "," + Math.round(rect.top);
      if (BASELINE.has(fingerprint)) continue;
      const style = getComputedStyle(el);
      const z = Number.parseInt(style.zIndex || "0", 10) || 0;
      const score = (semantic ? 30 : 0) + matched.length * 10 + Math.round(areaRatio * 20) + Math.min(10, Math.max(0, z / 100));
      ranked.push({ el, desc, matched, fingerprint, score, rect });
    }
    ranked.sort((a, b) => b.score - a.score);
    const selected = ranked[0];
    if (!selected) return null;
    const id = "overlay-" + Date.now() + "-" + Math.random().toString(36).slice(2);
    selected.el.setAttribute(ATTR, id);
    const rect = selected.el.getBoundingClientRect();
    const left = Math.max(0, rect.left);
    const top = Math.max(0, rect.top);
    const right = Math.min(window.innerWidth, rect.right);
    const bottom = Math.min(window.innerHeight, rect.bottom);
    return {
      id,
      fingerprint: selected.fingerprint,
      descriptor: selected.desc.slice(0, 1600),
      matched_terms: selected.matched,
      page_url: location.href,
      viewport_x: left,
      viewport_y: top,
      page_x: window.scrollX + left,
      page_y: window.scrollY + top,
      width: Math.max(1, right - left),
      height: Math.max(1, bottom - top),
      element_width: rect.width,
      element_height: rect.height,
      clipped_to_viewport: rect.left < 0 || rect.top < 0 || rect.right > window.innerWidth || rect.bottom > window.innerHeight,
    };
  })()`, 30000);
}

async function waitForInteractiveUrl(client, expectedUrl, timeoutSeconds = 10) {
  const maximumMs = Math.max(1000, Math.min(30000, Number(timeoutSeconds || 10) * 1000));
  const started = Date.now();
  while (Date.now() - started < maximumMs) {
    const currentUrl = await evaluate(client, "location.href");
    if (currentUrl === expectedUrl) return { matched: true, elapsed_ms: Date.now() - started, current_url: currentUrl };
    await delay(150);
  }
  return { matched: false, elapsed_ms: Date.now() - started, current_url: await evaluate(client, "location.href") };
}

async function waitForInteractiveOpenResult(client, config, baselineFingerprints, originalUrl) {
  const maximumMs = Math.max(1000, Math.min(60000, Number(config?.open_timeout_seconds || 10) * 1000));
  const started = Date.now();
  while (Date.now() - started < maximumMs) {
    const overlay = await findInteractiveOverlay(client, config, baselineFingerprints);
    if (overlay) {
      return { kind: "overlay", opened: true, elapsed_ms: Date.now() - started, overlay, current_url: await evaluate(client, "location.href") };
    }
    const currentUrl = await evaluate(client, "location.href");
    if (currentUrl && currentUrl !== originalUrl) {
      let sameOrigin = false;
      try { sameOrigin = new URL(currentUrl).origin === new URL(originalUrl).origin; } catch { sameOrigin = false; }
      return {
        kind: sameOrigin ? "route_navigation" : "cross_origin_navigation",
        opened: false,
        elapsed_ms: Date.now() - started,
        overlay: null,
        current_url: currentUrl,
      };
    }
    await delay(150);
  }
  return { kind: "timeout", opened: false, elapsed_ms: Date.now() - started, overlay: null, current_url: await evaluate(client, "location.href") };
}

async function findInteractiveCloseControl(client, config, overlayId) {
  const whitelist = normalizeInteractiveRules(config?.whitelist_rules);
  const blacklist = normalizeInteractiveRules(config?.blacklist_rules);
  const closeTerms = interactiveRulesForCategory(whitelist, "close");
  const blockedTerms = [...interactiveRulesForCategory(blacklist, "close"), ...IMMUTABLE_INTERACTIVE_BLOCK_TERMS];
  return await evaluate(client, `(() => {
    const CLOSE_TERMS = ${JSON.stringify(closeTerms)};
    const BLOCKED_TERMS = ${JSON.stringify(blockedTerms)};
    const overlay = document.querySelector('[data-wavi-interactive-overlay=${JSON.stringify(String(overlayId || ""))}]');
    if (!overlay) return null;
    const norm = (value) => String(value || "").replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const termMatch = (haystack, term) => {
      const raw = String(haystack || "").toLowerCase();
      const rawTerm = String(term || "").toLowerCase().trim();
      const h = norm(haystack); const t = norm(rawTerm);
      if (!rawTerm) return false;
      if (!t) return raw.includes(rawTerm);
      const exactWords = (" " + h + " ").includes(" " + t + " ");
      const punctuatedRaw = /[^a-z0-9\\s]/.test(rawTerm) && raw.includes(rawTerm);
      return t.length <= 4 ? (exactWords || punctuatedRaw) : (exactWords || h.includes(t) || punctuatedRaw);
    };
    const visible = (el) => {
      const style = getComputedStyle(el); const rect = el.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > 0.02 && rect.width >= 12 && rect.height >= 12 && rect.bottom > 0 && rect.top < window.innerHeight;
    };
    const descriptor = (el) => [
      el.tagName, el.getAttribute("role"), el.getAttribute("aria-label"), el.getAttribute("aria-controls"),
      el.id, el.className, el.getAttribute("title"), el.getAttribute("data-testid"),
      el.getAttribute("data-action"), el.innerText
    ].join(" ").slice(0, 1200);
    const ranked = [];
    for (const el of overlay.querySelectorAll("button,a,[role='button'],[tabindex]:not([tabindex='-1']),[onclick]")) {
      if (!visible(el) || el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true") continue;
      const desc = descriptor(el);
      if (BLOCKED_TERMS.some((term) => termMatch(desc, term))) continue;
      const matched = CLOSE_TERMS.filter((term) => termMatch(desc, term));
      if (!matched.length) continue;
      const rect = el.getBoundingClientRect();
      const upperRightBonus = rect.top < window.innerHeight * 0.35 && rect.left > window.innerWidth * 0.55 ? 5 : 0;
      ranked.push({ el, desc, matched, score: matched.length * 10 + upperRightBonus, rect });
    }
    ranked.sort((a, b) => b.score - a.score);
    const selected = ranked[0];
    if (!selected) return null;
    selected.el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    const rect = selected.el.getBoundingClientRect();
    return {
      descriptor: selected.desc,
      matched_terms: selected.matched,
      x: Math.max(1, Math.min(window.innerWidth - 1, rect.left + rect.width / 2)),
      y: Math.max(1, Math.min(window.innerHeight - 1, rect.top + rect.height / 2)),
    };
  })()`, 30000);
}

async function findInteractivePageCloseControl(client, config) {
  const whitelist = normalizeInteractiveRules(config?.whitelist_rules);
  const blacklist = normalizeInteractiveRules(config?.blacklist_rules);
  const closeTerms = interactiveRulesForCategory(whitelist, "close");
  const blockedTerms = [...interactiveRulesForCategory(blacklist, "close"), ...IMMUTABLE_INTERACTIVE_BLOCK_TERMS];
  return await evaluate(client, `(() => {
    const CLOSE_TERMS = ${JSON.stringify(closeTerms)};
    const BLOCKED_TERMS = ${JSON.stringify(blockedTerms)};
    const norm = (value) => String(value || "").replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const termMatch = (haystack, term) => {
      const raw = String(haystack || "").toLowerCase();
      const rawTerm = String(term || "").toLowerCase().trim();
      const h = norm(haystack); const t = norm(rawTerm);
      if (!rawTerm) return false;
      if (!t) return raw.includes(rawTerm);
      const exactWords = (" " + h + " ").includes(" " + t + " ");
      const punctuatedRaw = /[^a-z0-9\s]/.test(rawTerm) && raw.includes(rawTerm);
      return t.length <= 4 ? (exactWords || punctuatedRaw) : (exactWords || h.includes(t) || punctuatedRaw);
    };
    const visible = (el) => {
      const style = getComputedStyle(el); const rect = el.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > 0.02 && rect.width >= 12 && rect.height >= 12 && rect.bottom > 0 && rect.top < window.innerHeight;
    };
    const descriptor = (el) => [
      el.tagName, el.getAttribute("role"), el.getAttribute("aria-label"), el.getAttribute("aria-controls"),
      el.id, el.className, el.getAttribute("title"), el.getAttribute("data-testid"),
      el.getAttribute("data-action"), el.getAttribute("href"), el.innerText
    ].join(" ").slice(0, 1200);
    const ranked = [];
    for (const el of document.querySelectorAll("button,a,[role='button'],[tabindex]:not([tabindex='-1']),[onclick]")) {
      if (!visible(el) || el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true") continue;
      if (el.closest("form")) continue;
      const desc = descriptor(el);
      if (BLOCKED_TERMS.some((term) => termMatch(desc, term))) continue;
      const matched = CLOSE_TERMS.filter((term) => termMatch(desc, term));
      if (!matched.length) continue;
      const rect = el.getBoundingClientRect();
      const upperRightBonus = rect.top < window.innerHeight * 0.35 && rect.left > window.innerWidth * 0.55 ? 8 : 0;
      const href = String(el.getAttribute("href") || "");
      const linkBonus = href && (href === "#" || href.startsWith("/")) ? 2 : 0;
      ranked.push({ el, desc, matched, score: matched.length * 10 + upperRightBonus + linkBonus, rect });
    }
    ranked.sort((a, b) => b.score - a.score);
    const selected = ranked[0];
    if (!selected) return null;
    selected.el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    const rect = selected.el.getBoundingClientRect();
    return {
      descriptor: selected.desc,
      matched_terms: selected.matched,
      x: Math.max(1, Math.min(window.innerWidth - 1, rect.left + rect.width / 2)),
      y: Math.max(1, Math.min(window.innerHeight - 1, rect.top + rect.height / 2)),
    };
  })()`, 30000);
}

async function waitForInteractiveOverlayClosed(client, overlayId, timeoutSeconds) {
  const maximumMs = Math.max(1000, Math.min(30000, Number(timeoutSeconds || 5) * 1000));
  const started = Date.now();
  while (Date.now() - started < maximumMs) {
    const closed = await evaluate(client, `(() => {
      const el = document.querySelector('[data-wavi-interactive-overlay=${JSON.stringify(String(overlayId || ""))}]');
      if (!el || !el.isConnected) return true;
      const style = getComputedStyle(el); const rect = el.getBoundingClientRect();
      return style.display === "none" || style.visibility === "hidden" || Number(style.opacity || 1) <= 0.02 || rect.width < 2 || rect.height < 2;
    })()`);
    if (closed) return { closed: true, elapsed_ms: Date.now() - started };
    await delay(150);
  }
  return { closed: false, elapsed_ms: Date.now() - started };
}

async function dismissInteractiveOverlay(client, config, overlay) {
  let closeControl = null;
  let closeControlError = "";
  try {
    closeControl = await findInteractiveCloseControl(client, config, overlay?.id);
  } catch (error) {
    closeControlError = String(error?.message || error);
  }
  if (closeControl) {
    try {
      await dispatchMouseClick(client, closeControl);
      const result = await waitForInteractiveOverlayClosed(client, overlay?.id, config?.close_timeout_seconds);
      if (result.closed) {
        return {
          ...result,
          method: "matched_close_control",
          close_control: closeControl,
          close_control_error: closeControlError || undefined,
        };
      }
    } catch (error) {
      closeControlError = String(error?.message || error);
    }
  }
  await dispatchEscapeKey(client);
  const escapeResult = await waitForInteractiveOverlayClosed(client, overlay?.id, config?.close_timeout_seconds);
  return {
    ...escapeResult,
    method: escapeResult.closed ? "escape" : "failed",
    close_control: closeControl || null,
    close_control_error: closeControlError || undefined,
  };
}


function interactiveMediaReadyTimeoutMs(contentWaitMs) {
  const base = Math.max(5000, Number(contentWaitMs) || 0);
  return Math.max(3000, Math.min(15000, base));
}

async function inspectInteractiveMediaState(client, options = {}) {
  const scope = String(options?.scope || "page");
  const overlayId = scope === "overlay" ? String(options?.overlayId || "") : "";
  return await evaluate(client, `(() => {
    const SCOPE = ${JSON.stringify(scope)};
    const OVERLAY_ID = ${JSON.stringify(overlayId)};
    const root = SCOPE === "overlay"
      ? document.querySelector('[data-wavi-interactive-overlay=' + JSON.stringify(String(OVERLAY_ID || "")) + ']')
      : document.body;
    const norm = (value) => String(value || "").replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const visible = (el) => {
      if (!(el instanceof Element)) return false;
      const style = getComputedStyle(el); const rect = el.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > 0.02 && rect.width >= 16 && rect.height >= 16 && rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth;
    };
    if (!root) {
      return {
        root_found: false,
        scope: SCOPE,
        media_candidate_count: 0,
        ready_media_count: 0,
        image_ready_count: 0,
        video_ready_count: 0,
        background_media_count: 0,
        background_ready_count: 0,
        loading_indicator_count: 0,
        signature: "missing-root",
      };
    }

    const mediaNodes = new Set();
    for (const el of root.querySelectorAll("img,video,canvas,svg,picture img")) mediaNodes.add(el);
    const loadingNodes = new Set();
    for (const selector of [
      "[aria-busy='true']", "[role='progressbar']", "[class*='loading' i]", "[class*='loader' i]",
      "[class*='spinner' i]", "[class*='skeleton' i]", "[id*='loading' i]", "[id*='spinner' i]",
      "[data-testid*='loading' i]", "[data-testid*='spinner' i]", "[data-testid*='skeleton' i]"
    ]) {
      for (const el of root.querySelectorAll(selector)) loadingNodes.add(el);
    }

    let visibleMedia = 0;
    let readyMedia = 0;
    let readyImages = 0;
    let readyVideos = 0;
    let backgroundMedia = 0;
    let backgroundReady = 0;
    let maxMediaArea = 0;

    for (const el of mediaNodes) {
      if (!visible(el)) continue;
      const rect = el.getBoundingClientRect();
      const area = Math.round(rect.width * rect.height);
      if (area > maxMediaArea) maxMediaArea = area;
      visibleMedia += 1;
      const tag = String(el.tagName || "").toLowerCase();
      if (tag === "img") {
        if (el.complete && Number(el.naturalWidth || 0) > 0 && Number(el.naturalHeight || 0) > 0) {
          readyMedia += 1;
          readyImages += 1;
        }
      } else if (tag === "video") {
        const hasFrame = Number(el.readyState || 0) >= 2 && Number(el.videoWidth || 0) > 0 && Number(el.videoHeight || 0) > 0;
        const hasPoster = Boolean(el.poster) && rect.width >= 40 && rect.height >= 40;
        if (hasFrame || hasPoster) {
          readyMedia += 1;
          readyVideos += 1;
        }
      } else if (tag === "canvas") {
        if (Number(el.width || 0) > 0 && Number(el.height || 0) > 0) readyMedia += 1;
      } else if (tag === "svg") {
        if (rect.width >= 24 && rect.height >= 24) readyMedia += 1;
      }
    }

    for (const el of Array.from(root.querySelectorAll("*"))) {
      if (!visible(el)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 80 || rect.height < 80) continue;
      const style = getComputedStyle(el);
      const bg = String(style.backgroundImage || "");
      if (!bg || bg === "none") continue;
      backgroundMedia += 1;
      backgroundReady += 1;
      const area = Math.round(rect.width * rect.height);
      if (area > maxMediaArea) maxMediaArea = area;
    }

    let loadingCount = 0;
    for (const el of loadingNodes) {
      if (!visible(el)) continue;
      const desc = norm([
        el.tagName, el.getAttribute("role"), el.getAttribute("aria-label"), el.id, el.className,
        el.getAttribute("title"), el.getAttribute("data-testid"), el.textContent
      ].join(" "));
      if (desc.includes("loading") || desc.includes("spinner") || desc.includes("progress") || desc.includes("skeleton") || el.getAttribute("aria-busy") === "true" || el.getAttribute("role") === "progressbar") {
        loadingCount += 1;
      }
    }

    const candidateCount = visibleMedia + backgroundMedia;
    const readyCount = readyMedia + backgroundReady;
    return {
      root_found: true,
      scope: SCOPE,
      media_candidate_count: candidateCount,
      ready_media_count: readyCount,
      image_ready_count: readyImages,
      video_ready_count: readyVideos,
      background_media_count: backgroundMedia,
      background_ready_count: backgroundReady,
      loading_indicator_count: loadingCount,
      max_media_area: maxMediaArea,
      current_url: location.href,
      signature: [candidateCount, readyCount, readyImages, readyVideos, backgroundMedia, loadingCount, maxMediaArea].join("|"),
    };
  })()`, 30000);
}

async function waitForInteractiveMediaReady(client, options = {}) {
  const minimumWaitMs = Math.max(0, Math.min(30000, Number(options?.minimum_wait_ms) || 0));
  const timeoutMs = Math.max(1000, Math.min(30000, Number(options?.timeout_ms) || interactiveMediaReadyTimeoutMs(minimumWaitMs)));
  const pollMs = Math.max(150, Math.min(1000, Number(options?.poll_ms) || 250));
  if (minimumWaitMs) await delay(minimumWaitMs);
  const started = Date.now();
  let lastState = null;
  let lastSignature = "";
  let stableCount = 0;
  while (Date.now() - started < timeoutMs) {
    const state = await inspectInteractiveMediaState(client, options);
    lastState = state;
    if (state?.signature && state.signature === lastSignature) stableCount += 1;
    else stableCount = 1;
    lastSignature = String(state?.signature || "");

    const noLoading = Number(state?.loading_indicator_count || 0) === 0;
    const hasReadyMedia = Number(state?.ready_media_count || 0) > 0;
    const hasMediaCandidates = Number(state?.media_candidate_count || 0) > 0;
    const stableEnough = stableCount >= 3;

    if (state?.root_found === false) {
      return { ready: false, reason: "root_not_found", elapsed_ms: Date.now() - started, stable_polls: stableCount, ...(state || {}) };
    }
    if (noLoading && hasReadyMedia && stableEnough) {
      return { ready: true, reason: "ready_media_stable", elapsed_ms: Date.now() - started, stable_polls: stableCount, ...(state || {}) };
    }
    if (noLoading && !hasMediaCandidates && stableEnough) {
      return { ready: true, reason: "stable_without_media_candidates", elapsed_ms: Date.now() - started, stable_polls: stableCount, ...(state || {}) };
    }
    if (noLoading && hasMediaCandidates && Number(state?.ready_media_count || 0) >= Number(state?.media_candidate_count || 0) && stableEnough) {
      return { ready: true, reason: "all_visible_media_ready", elapsed_ms: Date.now() - started, stable_polls: stableCount, ...(state || {}) };
    }
    await delay(pollMs);
  }
  return { ready: false, reason: "timeout", elapsed_ms: Date.now() - started, stable_polls: stableCount, ...(lastState || {}) };
}

function normalizeInteractiveMetadataSegment(value) {
  return decodeURIComponent(String(value || "").trim()).replace(/^@+/, "").trim();
}

function parseInteractiveRouteMetadata(urlLike) {
  const fallback = { profile: "", contentId: "", source_url: String(urlLike || "") };
  if (!urlLike) return fallback;
  try {
    const url = new URL(String(urlLike));
    const segments = url.pathname
      .split("/")
      .filter(Boolean)
      .map(normalizeInteractiveMetadataSegment)
      .filter(Boolean);
    const lowerSegments = segments.map((value) => value.toLowerCase());
    const queryId = normalizeInteractiveMetadataSegment(
      url.searchParams.get("id") ||
      url.searchParams.get("media_id") ||
      url.searchParams.get("post_id") ||
      url.searchParams.get("content_id") ||
      "",
    );
    const markers = new Set([
      "reel", "reels", "photo", "photos", "p", "post", "posts", "tv", "video", "videos",
      "story", "stories", "highlight", "highlights", "media",
    ]);
    const profileFirstMarkers = new Set(["story", "stories", "highlight", "highlights"]);
    const reservedSingleSegments = new Set([
      "document", "explore", "accounts", "account", "login", "logout", "settings", "about", "help", "privacy", "terms",
    ]);

    let profile = "";
    let contentId = queryId;
    for (let i = 0; i < segments.length; i += 1) {
      const marker = lowerSegments[i];
      if (!markers.has(marker)) continue;

      if (i > 0 && !markers.has(lowerSegments[i - 1])) {
        profile = profile || segments[i - 1];
      } else if (i === 0 && profileFirstMarkers.has(marker) && segments[i + 1]) {
        profile = profile || segments[i + 1];
      }

      if (!contentId) {
        if (i === 0 && profileFirstMarkers.has(marker)) {
          contentId = segments[i + 2] || "";
        } else {
          contentId = segments[i + 1] || "";
        }
      }
    }

    if (!profile && segments.length === 1 && !reservedSingleSegments.has(lowerSegments[0])) {
      profile = segments[0];
    }
    if (!profile && segments.length >= 2 && !markers.has(lowerSegments[0]) && !reservedSingleSegments.has(lowerSegments[0])) {
      profile = segments[0];
    }

    return {
      profile: profile || "",
      contentId: contentId || "",
      source_url: url.href,
    };
  } catch {
    return fallback;
  }
}

function extractInteractiveDescriptorUrls(descriptor) {
  const matches = String(descriptor || "").match(/https?:\/\/[^\s"'<>]+/gi) || [];
  return matches.slice(0, 10);
}

function deriveInteractiveFilenameMetadata(trigger, currentUrl, fallbackUrl) {
  const candidates = [
    trigger?.href,
    currentUrl,
    fallbackUrl,
    ...extractInteractiveDescriptorUrls(trigger?.descriptor),
  ].filter(Boolean);
  const parsedCandidates = candidates.map(parseInteractiveRouteMetadata);
  const complete = parsedCandidates.find((parsed) => parsed.profile && parsed.contentId);
  if (complete) return complete;

  const profileResult = parsedCandidates.find((parsed) => parsed.profile);
  const contentResult = parsedCandidates.find((parsed) => parsed.contentId);
  return {
    profile: profileResult?.profile || "",
    contentId: contentResult?.contentId || "",
    source_url: contentResult?.source_url || profileResult?.source_url || "",
  };
}

function deriveWebpageProfile(...urlLikes) {
  for (const urlLike of urlLikes) {
    const parsed = parseInteractiveRouteMetadata(urlLike);
    if (parsed.profile) return parsed.profile;
  }
  return "unknown-profile";
}

function renderInteractiveItemBaseName(config, fileNamingContext, itemNumber, metadata) {
  const template = String(config?.interactive_capture?.filename_template || "%datetime%_%domain%_%title%_interactive-%overlayindex%");
  const resolvedMetadata = metadata || { profile: "", contentId: "" };
  return renderFilenameTemplate(template, {
    date: new Date(),
    domain: fileNamingContext?.domain || "unknown-domain",
    title: fileNamingContext?.title || "untitled",
    index: Number(fileNamingContext?.index) || 1,
    overlayIndex: Number(itemNumber) || 1,
    profile: resolvedMetadata.profile || "unknown-profile",
    contentId: resolvedMetadata.contentId || "unknown-content",
    mode: fileNamingContext?.mode || "full_page",
    caseName: fileNamingContext?.caseName || "",
  });
}

async function captureInteractiveOverlayArtifacts(client, config, outputFolder, baseName, itemNumber, overlay) {
  const artifacts = [];
  const captureScope = normalizeInteractiveCaptureScope(config?.capture_scope);

  if (captureScope !== "viewport_only") {
    const overlayPath = await uniqueOutputPath(outputFolder, `${baseName}_overlay`, ".png");
    const overlayResult = await client.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: true,
      clip: {
        x: Math.max(0, Number(overlay.page_x) || 0),
        y: Math.max(0, Number(overlay.page_y) || 0),
        width: Math.max(1, Number(overlay.width) || 1),
        height: Math.max(1, Number(overlay.height) || 1),
        scale: 1,
      },
    }, 120000);
    const overlayRecord = await writeCaptureImage(overlayPath, overlayResult.data);
    artifacts.push({
      kind: "interactive_overlay_png",
      role: "interactive_overlay",
      format: "png",
      item: itemNumber,
      path: overlayPath,
      sha256: overlayRecord.sha256,
      size_bytes: overlayRecord.bytes,
      x_css_px: overlay.page_x,
      y_css_px: overlay.page_y,
      width_css_px: overlay.width,
      height_css_px: overlay.height,
      clipped_to_viewport: Boolean(overlay.clipped_to_viewport),
      capture_mode: "overlay_clip",
    });
  }

  if (captureScope !== "overlay_only") {
    const viewportPath = await uniqueOutputPath(outputFolder, `${baseName}_viewport`, ".png");
    const viewportResult = await client.send("Page.captureScreenshot", { format: "png", fromSurface: true }, 120000);
    const viewportRecord = await writeCaptureImage(viewportPath, viewportResult.data);
    artifacts.push({
      kind: "interactive_viewport_png",
      role: "interactive_viewport",
      format: "png",
      item: itemNumber,
      path: viewportPath,
      sha256: viewportRecord.sha256,
      size_bytes: viewportRecord.bytes,
      capture_mode: captureScope === "viewport_only" ? "viewport_only" : "overlay_clip_with_viewport",
    });
  }
  return artifacts;
}

async function captureInteractiveRouteArtifacts(client, config, outputFolder, baseName, itemNumber) {
  const artifacts = [];
  const captureScope = normalizeInteractiveCaptureScope(config?.capture_scope);
  const viewportResult = await client.send("Page.captureScreenshot", { format: "png", fromSurface: true }, 120000);

  if (captureScope !== "viewport_only") {
    const overlayPath = await uniqueOutputPath(outputFolder, `${baseName}_overlay`, ".png");
    const overlayRecord = await writeCaptureImage(overlayPath, viewportResult.data);
    artifacts.push({
      kind: "interactive_overlay_png",
      role: "interactive_overlay",
      format: "png",
      item: itemNumber,
      path: overlayPath,
      sha256: overlayRecord.sha256,
      size_bytes: overlayRecord.bytes,
      capture_mode: "route_viewport",
    });
  }

  if (captureScope !== "overlay_only") {
    const viewportPath = await uniqueOutputPath(outputFolder, `${baseName}_viewport`, ".png");
    const viewportRecord = await writeCaptureImage(viewportPath, viewportResult.data);
    artifacts.push({
      kind: "interactive_viewport_png",
      role: "interactive_viewport",
      format: "png",
      item: itemNumber,
      path: viewportPath,
      sha256: viewportRecord.sha256,
      size_bytes: viewportRecord.bytes,
      capture_mode: "route_viewport",
    });
  }
  return artifacts;
}

async function restoreInteractiveScrollPosition(client, x, y) {
  try {
    await evaluate(client, `window.scrollTo(${JSON.stringify(Number(x) || 0)}, ${JSON.stringify(Number(y) || 0)}); true`);
  } catch {
    // Best effort only.
  }
}

async function recoverInteractiveNavigation(client, originalUrl, timeoutSeconds = 10) {
  const current = await evaluate(client, "location.href");
  if (!current || current === originalUrl) return { needed: false, recovered: true, current_url: current || originalUrl, method: "none" };
  let sameOrigin = false;
  try { sameOrigin = new URL(current).origin === new URL(originalUrl).origin; } catch { sameOrigin = false; }
  if (!sameOrigin) return { needed: true, recovered: false, current_url: current, reason: "cross_origin_navigation", method: "none" };
  await evaluate(client, "history.back(); true");
  const waitResult = await waitForInteractiveUrl(client, originalUrl, timeoutSeconds);
  return waitResult.matched
    ? { needed: true, recovered: true, current_url: waitResult.current_url, elapsed_ms: waitResult.elapsed_ms, method: "history_back" }
    : { needed: true, recovered: false, current_url: waitResult.current_url, reason: "history_back_timeout", elapsed_ms: waitResult.elapsed_ms, method: "history_back" };
}

async function dismissInteractiveRouteView(client, config, originalUrl, scrollState = {}) {
  const closeControl = await findInteractivePageCloseControl(client, config);
  if (closeControl) {
    await dispatchMouseClick(client, closeControl);
    const waitResult = await waitForInteractiveUrl(client, originalUrl, config?.close_timeout_seconds);
    if (waitResult.matched) {
      await restoreInteractiveScrollPosition(client, scrollState.x, scrollState.y);
      return { closed: true, elapsed_ms: waitResult.elapsed_ms, method: "matched_close_control", close_control: closeControl, current_url: waitResult.current_url };
    }
  }
  await evaluate(client, "history.back(); true");
  const historyResult = await waitForInteractiveUrl(client, originalUrl, config?.close_timeout_seconds || config?.open_timeout_seconds || 10);
  if (historyResult.matched) {
    await restoreInteractiveScrollPosition(client, scrollState.x, scrollState.y);
    return { closed: true, elapsed_ms: historyResult.elapsed_ms, method: "history_back", close_control: closeControl || null, current_url: historyResult.current_url };
  }
  return { closed: false, elapsed_ms: historyResult.elapsed_ms, method: "failed", close_control: closeControl || null, current_url: historyResult.current_url };
}

function buildInteractiveCaptureReport(settings, state) {
  return {
    enabled: true,
    capture_scope: normalizeInteractiveCaptureScope(settings.capture_scope),
    maximum_items: state.maximum_items,
    maximum_candidate_attempts: state.maximum_candidate_attempts,
    maximum_consecutive_noncaptures: state.maximum_consecutive_noncaptures,
    whitelist_filename: String(settings.whitelist_filename || "interactive-whitelist.txt"),
    blacklist_filename: String(settings.blacklist_filename || "interactive-blacklist.txt"),
    whitelist_rule_count: normalizeInteractiveRules(settings.whitelist_rules).length,
    blacklist_rule_count: normalizeInteractiveRules(settings.blacklist_rules).length,
    built_in_block_term_count: IMMUTABLE_INTERACTIVE_BLOCK_TERMS.length,
    captured_items: state.captured_items,
    processed_candidates: state.processed_candidates,
    attempted_candidates: state.attempted_candidates,
    consecutive_noncaptures: state.consecutive_noncaptures,
    scan_steps: state.scan_steps,
    scan_wait_ms: state.scan_wait_ms,
    stopped_reason: state.stopped_reason,
    report_in_progress: Boolean(state.report_in_progress),
    records: state.records,
    warnings: state.warnings,
  };
}

async function persistInteractiveCaptureReport(reportPath, settings, state) {
  const report = buildInteractiveCaptureReport(settings, state);
  await Deno.writeTextFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  return report;
}

function isWaviTemporaryPdfDocumentUrl(urlLike) {
  try {
    const url = new URL(String(urlLike || ""));
    const loopback = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(String(url.hostname || "").toLowerCase());
    return loopback && /^\/[a-f0-9]{32}\/document\/?$/i.test(String(url.pathname || ""));
  } catch {
    return false;
  }
}

async function performInteractiveOverlayCapture(client, config, outputFolder, baseName, fileNamingContext = {}) {
  const settings = config?.interactive_capture || {};
  if (!settings.enabled) {
    return {
      enabled: false,
      artifacts: [],
      records: [],
      warnings: [],
      captured_items: 0,
      processed_candidates: 0,
      note: "Interactive overlay capture was disabled.",
    };
  }

  const interactiveStartUrl = await evaluate(client, "location.href");
  if (isWaviTemporaryPdfDocumentUrl(interactiveStartUrl)) {
    const warning = "Interactive overlay capture was skipped because Chromium was on WAVI's temporary Captured PNG PDF document instead of the live source page.";
    console.log(warning);
    return {
      enabled: true,
      artifacts: [],
      records: [],
      warnings: [warning],
      captured_items: 0,
      processed_candidates: 0,
      attempted_candidates: 0,
      scan_steps: 0,
      stopped_reason: "temporary_pdf_document_detected",
      error: "",
    };
  }

  const maximumItems = Math.max(1, Math.min(500, Number(settings.maximum_items) || 25));
  const maximumCandidateAttempts = Math.max(maximumItems, Math.min(1000, Math.max(40, maximumItems * 8)));
  const maximumConsecutiveNonCaptures = Math.max(5, Math.min(25, Math.ceil(Math.max(maximumItems, 10) / 2)));
  const contentWaitMs = Math.max(0, Math.min(30000, Number(settings.content_wait_ms) || 0));
  const scanStepPercent = Math.max(25, Math.min(100, Number(settings.scan_step_percent) || 75));
  const scanWaitMs = Math.max(250, Math.min(3000, Number(config.scroll_wait_ms) || 500));
  const processed = new Set();
  const artifacts = [];
  const records = [];
  const warnings = [];
  const originalState = await evaluate(client, `({ url: location.href, x: window.scrollX, y: window.scrollY })`);
  const reportPath = await uniqueOutputPath(outputFolder, `${baseName}_interactive-report`, ".json");
  let capturedItems = 0;
  let attemptedCandidates = 0;
  let consecutiveNonCaptures = 0;
  let scanSteps = 0;
  let reachedEnd = false;
  let stoppedReason = "no_more_matching_items";

  const persist = async (reportInProgress = true) => await persistInteractiveCaptureReport(reportPath, settings, {
    maximum_items: maximumItems,
    maximum_candidate_attempts: maximumCandidateAttempts,
    maximum_consecutive_noncaptures: maximumConsecutiveNonCaptures,
    captured_items: capturedItems,
    processed_candidates: processed.size,
    attempted_candidates: attemptedCandidates,
    consecutive_noncaptures: consecutiveNonCaptures,
    scan_steps: scanSteps,
    scan_wait_ms: scanWaitMs,
    stopped_reason: stoppedReason,
    report_in_progress: reportInProgress,
    records,
    warnings,
  });

  console.log(
    `Interactive overlay capture started: maximum ${maximumItems} capture(s), ` +
    `${maximumCandidateAttempts} candidate attempt(s), stop after ${maximumConsecutiveNonCaptures} consecutive non-captures.`
  );
  await persist(true);

  await evaluate(client, "window.scrollTo(0, 0); true");
  await delay(250);

  while (capturedItems < maximumItems && scanSteps <= 250 && attemptedCandidates < maximumCandidateAttempts) {
    const trigger = await discoverInteractiveTrigger(client, settings, processed);
    if (!trigger) {
      const scan = await evaluate(client, `(() => {
        const before = window.scrollY;
        const maximum = Math.max(0, (document.scrollingElement || document.documentElement).scrollHeight - window.innerHeight);
        const step = Math.max(100, Math.round(window.innerHeight * ${JSON.stringify(scanStepPercent / 100)}));
        const next = Math.min(maximum, before + step);
        window.scrollTo(0, next);
        return { before, next, maximum, at_end: next >= maximum - 2 };
      })()`);
      scanSteps += 1;
      if (scanSteps <= 5 || scanSteps % 10 === 0) {
        console.log(`Interactive scan step ${scanSteps}: no matching trigger in the current view; scrolling for more items.`);
      }
      if (scan?.at_end && Math.abs(Number(scan.next) - Number(scan.before)) < 2) {
        reachedEnd = true;
        break;
      }
      if (scanSteps <= 3 || scanSteps % 10 === 0) await persist(true);
      await delay(scanWaitMs);
      continue;
    }

    attemptedCandidates += 1;
    processed.add(trigger.fingerprint);
    const itemRecord = {
      candidate: records.length + 1,
      item: capturedItems + 1,
      trigger,
      opened: false,
      captured: false,
      dismissed: false,
      status: "pending",
      interaction_kind: "unknown",
      artifacts: [],
    };
    console.log(
      `Interactive candidate ${itemRecord.candidate}: validating ${trigger.href || trigger.descriptor || "matched item"} before click.`
    );
    const baseline = await getInteractiveOverlayFingerprints(client, settings.whitelist_rules);
    await delay(150);
    const preClickValidation = await validateInteractiveTriggerBeforeClick(client, settings, trigger);
    itemRecord.pre_click_validation = preClickValidation;
    itemRecord.final_hit_tested_element = preClickValidation?.hit_tested_element || null;
    if (!preClickValidation?.allowed) {
      itemRecord.status = "click_skipped_safety";
      itemRecord.error = String(preClickValidation?.reason || "pre_click_validation_failed");
      records.push(itemRecord);
      consecutiveNonCaptures += 1;
      warnings.push(`Interactive candidate ${itemRecord.candidate} was skipped by the pre-click safety check: ${itemRecord.error}.`);
      console.log(`Interactive candidate ${itemRecord.candidate}: skipped by safety check (${itemRecord.error}).`);
      await persist(true);
      if (consecutiveNonCaptures >= maximumConsecutiveNonCaptures) {
        stoppedReason = "maximum_consecutive_noncaptures_reached";
        warnings.push(`Interactive overlay capture stopped after ${consecutiveNonCaptures} consecutive non-captures.`);
        break;
      }
      continue;
    }
    console.log(`Interactive candidate ${itemRecord.candidate}: safety validation passed; clicking selected media control.`);
    try {
      await dispatchMouseClick(client, preClickValidation);
    } catch (error) {
      itemRecord.status = "click_failed";
      itemRecord.error = String(error?.message || error);
      records.push(itemRecord);
      consecutiveNonCaptures += 1;
      warnings.push(`Interactive candidate ${itemRecord.candidate} could not be clicked: ${itemRecord.error}`);
      console.log(`Interactive candidate ${itemRecord.candidate}: click failed.`);
      await persist(true);
      if (consecutiveNonCaptures >= maximumConsecutiveNonCaptures) {
        stoppedReason = "maximum_consecutive_noncaptures_reached";
        warnings.push(`Interactive overlay capture stopped after ${consecutiveNonCaptures} consecutive non-captures.`);
        break;
      }
      continue;
    }

    const opened = await waitForInteractiveOpenResult(client, settings, baseline, trigger.page_url_before);
    itemRecord.open_wait_ms = opened.elapsed_ms;

    if (opened.kind === "overlay" && opened.overlay) {
      itemRecord.opened = true;
      itemRecord.interaction_kind = "overlay";
      itemRecord.overlay = opened.overlay;
      console.log(`Interactive candidate ${itemRecord.candidate}: overlay detected.`);
      const refreshedOverlay = await findInteractiveOverlay(client, settings, []);
      const activeOverlay = refreshedOverlay || opened.overlay;
      itemRecord.media_readiness = await waitForInteractiveMediaReady(client, {
        scope: "overlay",
        overlayId: activeOverlay?.id,
        minimum_wait_ms: contentWaitMs,
        timeout_ms: interactiveMediaReadyTimeoutMs(contentWaitMs),
      });
      console.log(
        `Interactive candidate ${itemRecord.candidate}: media readiness ${itemRecord.media_readiness.ready ? "ready" : "timed out"} ` +
        `(${String(itemRecord.media_readiness.reason || "unknown").replaceAll("_", " ")}; ` +
        `${Number(itemRecord.media_readiness.ready_media_count) || 0}/${Number(itemRecord.media_readiness.media_candidate_count) || 0} media ready).`
      );
      if (!itemRecord.media_readiness.ready) {
        warnings.push(`Interactive candidate ${itemRecord.candidate} media readiness timed out before capture; WAVI captured the best available view.`);
      }
      try {
        const interactiveCurrentUrl = await evaluate(client, "location.href");
        itemRecord.filename_metadata = deriveInteractiveFilenameMetadata(
          trigger,
          interactiveCurrentUrl,
          fileNamingContext?.sourceUrl || "",
        );
        const interactiveBaseName = renderInteractiveItemBaseName(
          config,
          fileNamingContext,
          itemRecord.item,
          itemRecord.filename_metadata,
        );
        const itemArtifacts = await captureInteractiveOverlayArtifacts(
          client, settings, outputFolder, interactiveBaseName, itemRecord.item, activeOverlay,
        );
        artifacts.push(...itemArtifacts);
        itemRecord.artifacts = itemArtifacts.map((artifact) => ({
          kind: artifact.kind,
          path: basename(artifact.path),
          sha256: artifact.sha256,
          size_bytes: artifact.size_bytes,
          capture_mode: artifact.capture_mode,
        }));
        itemRecord.captured = true;
        itemRecord.status = "captured";
        capturedItems += 1;
        consecutiveNonCaptures = 0;
        console.log(`Interactive candidate ${itemRecord.candidate}: overlay captured.`);
      } catch (error) {
        itemRecord.status = "capture_failed";
        itemRecord.error = String(error?.message || error);
        consecutiveNonCaptures += 1;
        warnings.push(`Interactive candidate ${itemRecord.candidate} overlay capture failed: ${itemRecord.error}`);
        console.log(`Interactive candidate ${itemRecord.candidate}: overlay capture failed.`);
      }

      const dismissal = await dismissInteractiveOverlay(client, settings, activeOverlay);
      itemRecord.dismissal = dismissal;
      itemRecord.dismissed = Boolean(dismissal.closed);
      if (!dismissal.closed) {
        itemRecord.status = itemRecord.captured ? "captured_overlay_not_closed" : "overlay_not_closed";
        records.push(itemRecord);
        warnings.push(`Interactive candidate ${itemRecord.candidate} overlay could not be dismissed safely; automatic overlay capture stopped.`);
        console.log(`Interactive candidate ${itemRecord.candidate}: overlay could not be dismissed safely.`);
        stoppedReason = "overlay_close_failed";
        await persist(true);
        break;
      }
      console.log(`Interactive candidate ${itemRecord.candidate}: overlay dismissed by ${dismissal.method}.`);
      records.push(itemRecord);
      await persist(true);
      await delay(250);
      continue;
    }

    if (opened.kind === "route_navigation") {
      itemRecord.interaction_kind = "route_navigation";
      itemRecord.route_url = opened.current_url;
      console.log(`Interactive candidate ${itemRecord.candidate}: same-origin route opened at ${opened.current_url}.`);
      itemRecord.media_readiness = await waitForInteractiveMediaReady(client, {
        scope: "page",
        minimum_wait_ms: contentWaitMs,
        timeout_ms: interactiveMediaReadyTimeoutMs(contentWaitMs),
      });
      console.log(
        `Interactive candidate ${itemRecord.candidate}: media readiness ${itemRecord.media_readiness.ready ? "ready" : "timed out"} ` +
        `(${String(itemRecord.media_readiness.reason || "unknown").replaceAll("_", " ")}; ` +
        `${Number(itemRecord.media_readiness.ready_media_count) || 0}/${Number(itemRecord.media_readiness.media_candidate_count) || 0} media ready).`
      );
      if (!itemRecord.media_readiness.ready) {
        warnings.push(`Interactive candidate ${itemRecord.candidate} media readiness timed out before capture; WAVI captured the best available route view.`);
      }
      try {
        itemRecord.filename_metadata = deriveInteractiveFilenameMetadata(
          trigger,
          opened.current_url,
          fileNamingContext?.sourceUrl || "",
        );
        const interactiveBaseName = renderInteractiveItemBaseName(
          config,
          fileNamingContext,
          itemRecord.item,
          itemRecord.filename_metadata,
        );
        const itemArtifacts = await captureInteractiveRouteArtifacts(
          client, settings, outputFolder, interactiveBaseName, itemRecord.item,
        );
        artifacts.push(...itemArtifacts);
        itemRecord.artifacts = itemArtifacts.map((artifact) => ({
          kind: artifact.kind,
          path: basename(artifact.path),
          sha256: artifact.sha256,
          size_bytes: artifact.size_bytes,
          capture_mode: artifact.capture_mode,
        }));
        itemRecord.captured = true;
        itemRecord.status = "captured_route_view";
        capturedItems += 1;
        consecutiveNonCaptures = 0;
        console.log(`Interactive candidate ${itemRecord.candidate}: route view captured.`);
      } catch (error) {
        itemRecord.status = "route_capture_failed";
        itemRecord.error = String(error?.message || error);
        consecutiveNonCaptures += 1;
        warnings.push(`Interactive candidate ${itemRecord.candidate} route-view capture failed: ${itemRecord.error}`);
        console.log(`Interactive candidate ${itemRecord.candidate}: route-view capture failed.`);
      }

      const dismissal = await dismissInteractiveRouteView(client, settings, trigger.page_url_before, {
        x: trigger.scroll_x_before,
        y: trigger.scroll_y_before,
      });
      itemRecord.dismissal = dismissal;
      itemRecord.dismissed = Boolean(dismissal.closed);
      if (!dismissal.closed) {
        itemRecord.status = itemRecord.captured ? "captured_route_not_closed" : "route_not_closed";
        records.push(itemRecord);
        warnings.push(`Interactive candidate ${itemRecord.candidate} route view could not be dismissed safely; automatic overlay capture stopped.`);
        console.log(`Interactive candidate ${itemRecord.candidate}: route view could not be dismissed safely.`);
        stoppedReason = "route_close_failed";
        await persist(true);
        break;
      }
      console.log(`Interactive candidate ${itemRecord.candidate}: route view dismissed by ${dismissal.method}.`);
      records.push(itemRecord);
      await persist(true);
      await delay(250);
      continue;
    }

    if (opened.kind === "cross_origin_navigation") {
      itemRecord.interaction_kind = "cross_origin_navigation";
      itemRecord.navigation_recovery = {
        needed: true,
        recovered: false,
        current_url: opened.current_url,
        reason: "cross_origin_navigation",
      };
      itemRecord.status = "cross_origin_navigation";
      records.push(itemRecord);
      consecutiveNonCaptures += 1;
      warnings.push(`Interactive candidate ${itemRecord.candidate} navigated cross-origin; automatic overlay capture skipped that item.`);
      console.log(`Interactive candidate ${itemRecord.candidate}: cross-origin navigation skipped.`);
      await persist(true);
      if (consecutiveNonCaptures >= maximumConsecutiveNonCaptures) {
        stoppedReason = "maximum_consecutive_noncaptures_reached";
        warnings.push(`Interactive overlay capture stopped after ${consecutiveNonCaptures} consecutive non-captures.`);
        break;
      }
      continue;
    }

    const recovery = await recoverInteractiveNavigation(client, trigger.page_url_before, settings.open_timeout_seconds);
    itemRecord.navigation_recovery = recovery;
    itemRecord.interaction_kind = recovery.needed ? "navigation_recovery" : "no_overlay_detected";
    itemRecord.status = recovery.needed ? "navigation_instead_of_overlay" : "overlay_not_detected";
    records.push(itemRecord);
    consecutiveNonCaptures += 1;
    console.log(
      recovery.needed
        ? `Interactive candidate ${itemRecord.candidate}: no overlay detected; returned by ${recovery.method || "history back"}.`
        : `Interactive candidate ${itemRecord.candidate}: no supported overlay or route detected.`
    );
    if (recovery.needed && !recovery.recovered) {
      warnings.push(`Interactive candidate ${itemRecord.candidate} navigated away and WAVI could not safely return; automatic overlay capture stopped.`);
      stoppedReason = "navigation_recovery_failed";
      await persist(true);
      break;
    }
    await persist(true);
    if (consecutiveNonCaptures >= maximumConsecutiveNonCaptures) {
      stoppedReason = "maximum_consecutive_noncaptures_reached";
      warnings.push(`Interactive overlay capture stopped after ${consecutiveNonCaptures} consecutive non-captures.`);
      break;
    }
  }

  if (capturedItems >= maximumItems) stoppedReason = "maximum_items_reached";
  else if (attemptedCandidates >= maximumCandidateAttempts && stoppedReason === "no_more_matching_items") stoppedReason = "maximum_candidate_attempts_reached";
  else if (reachedEnd && stoppedReason === "no_more_matching_items") stoppedReason = "end_of_page_reached";
  if (scanSteps > 250) stoppedReason = "maximum_scan_steps_reached";

  const unsuccessfulCandidates = records.filter((record) => !record.captured).length;
  if (capturedItems === 0) {
    warnings.push("Interactive overlay capture produced no overlay images; no safely matching item opened a supported overlay or route view.");
  } else if (unsuccessfulCandidates > 0) {
    warnings.push(
      `Interactive overlay capture skipped or could not capture ${unsuccessfulCandidates} of ${records.length} processed candidate(s); review the interaction report.`
    );
  }
  if (stoppedReason === "maximum_scan_steps_reached") {
    warnings.push("Interactive overlay capture reached its bounded page-scan limit before confirming the end of the page.");
  }
  if (stoppedReason === "maximum_candidate_attempts_reached") {
    warnings.push("Interactive overlay capture reached its bounded candidate-attempt limit before reaching the maximum item count.");
  }
  if (stoppedReason === "maximum_consecutive_noncaptures_reached") {
    warnings.push("Interactive overlay capture stopped after too many consecutive non-captures.");
  }

  try {
    const current = await evaluate(client, "location.href");
    if (current === originalState.url) {
      await restoreInteractiveScrollPosition(client, originalState.x, originalState.y);
    }
  } catch {
    // Restoring the prior position is best effort.
  }

  await persist(false);
  const reportInfo = await Deno.stat(reportPath);
  artifacts.push({
    kind: "interactive_capture_report_json",
    role: "interactive_capture_report",
    path: reportPath,
    sha256: await sha256File(reportPath),
    size_bytes: reportInfo.size,
  });
  console.log(
    `Interactive overlay capture finished: ${capturedItems} capture(s) from ${records.length} processed candidate(s); ` +
    `stop reason: ${String(stoppedReason || "unknown").replaceAll("_", " ")}.`
  );
  return {
    ...buildInteractiveCaptureReport(settings, {
      maximum_items: maximumItems,
      maximum_candidate_attempts: maximumCandidateAttempts,
      maximum_consecutive_noncaptures: maximumConsecutiveNonCaptures,
      captured_items: capturedItems,
      processed_candidates: processed.size,
      attempted_candidates: attemptedCandidates,
      consecutive_noncaptures: consecutiveNonCaptures,
      scan_steps: scanSteps,
      scan_wait_ms: scanWaitMs,
      stopped_reason: stoppedReason,
      report_in_progress: false,
      records,
      warnings,
    }),
    artifacts,
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
      profile: deriveWebpageProfile(pageInfo.final_url, url),
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
    let interactiveCapture = {
      enabled: Boolean(config.interactive_capture?.enabled),
      artifacts: [],
      records: [],
      warnings: [],
      captured_items: 0,
      processed_candidates: 0,
      scan_steps: 0,
      stopped_reason: config.interactive_capture?.enabled ? "not_started" : "disabled",
      error: "",
    };
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
    // Interactive capture must run while Chromium is still on the live source page.
    // Captured PNG PDF generation may navigate to WAVI's temporary loopback /document page.
    if (config.interactive_capture?.enabled) {
      try {
        interactiveCapture = await performInteractiveOverlayCapture(
          client, config, runContext.webMediaFolder, baseName,
          { date: captureDate, domain, title: pageInfo.title, index, mode: captureMode, caseName: config.case_name || "", sourceUrl: url },
        );
        for (const interactiveWarning of interactiveCapture.warnings || []) {
          warnings.push(interactiveWarning);
          console.log(interactiveWarning);
        }
        if ((interactiveCapture.warnings || []).length) warningReasons.push("interactive_capture_warning");
        console.log(
          `Interactive overlay capture: ${Number(interactiveCapture.captured_items) || 0} captured from ` +
          `${Number(interactiveCapture.processed_candidates) || 0} candidate(s); stop reason: ` +
          `${String(interactiveCapture.stopped_reason || "unknown").replaceAll("_", " ")}.`,
        );
      } catch (error) {
        const message = `Interactive overlay capture failed: ${error.message || error}`;
        interactiveCapture = {
          enabled: true,
          artifacts: [],
          records: [],
          warnings: [message],
          captured_items: 0,
          processed_candidates: 0,
          scan_steps: 0,
          stopped_reason: "capture_error",
          error: message,
        };
        warnings.push(message);
        warningReasons.push("interactive_capture_failed");
        console.log(message);
      }
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
    let pdfTransportInfo = null;
    let pdfLargeInfo = null;
    let pdfFailureDiagnostics = null;
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
        pdfTransportInfo = pdfCapture.transport || null;
        pdfLargeInfo = pdfCapture.large_pdf || null;
        for (const pdfWarning of pdfCapture.warnings || []) {
          warnings.push(pdfWarning);
          warningReasons.push("pdf_large_handling_warning");
          console.log(pdfWarning);
        }
        for (const pdfPartialReason of pdfCapture.partial_reasons || []) partialReasons.push(pdfPartialReason);
      } catch (error) {
        pdfFailureDiagnostics = error?.pdf_diagnostics || await collectPdfFailureDiagnostics(client);
        pdfError = `PDF capture failed: ${error.message || error}`;
        warnings.push(pdfError);
        console.log(pdfError);
        const diagnosticSummary = summarizePdfFailureDiagnostics(pdfFailureDiagnostics);
        if (diagnosticSummary) console.log(`PDF transport diagnostics: ${diagnosticSummary}`);
        const stderrTail = normalizeDiagnosticText(pdfFailureDiagnostics?.browser?.stderr_tail || "", 2000);
        if (stderrTail) console.log(`Chromium stderr tail during PDF failure: ${stderrTail}`);
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

    const securityMetadata = await getCurrentSecurityMetadata(
      client, pageInfo, mainResponse, securityState, config.network_query_mode,
    );


    const allArtifacts = [
      ...capture.artifacts,
      ...pdfArtifacts,
      ...supplementalEvidence.artifacts,
      ...(interactiveCapture.artifacts || []),
    ];
    if (readinessInfo.timeouts.length) warningReasons.push("readiness_timeout");
    const requestedArtifactErrors = [];
    if (pdfError) {
      warningReasons.push("requested_pdf_failed");
      requestedArtifactErrors.push({ artifact: "pdf", error: pdfError });
    }
    requestedArtifactErrors.push(...supplementalEvidence.errors);
    if (interactiveCapture.error) {
      requestedArtifactErrors.push({ artifact: "interactive_overlay_capture", error: interactiveCapture.error });
    }
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
      interactive_capture: {
        enabled: Boolean(config.interactive_capture?.enabled),
        capture_scope: normalizeInteractiveCaptureScope(config.interactive_capture?.capture_scope),
        maximum_items: Math.max(1, Math.min(500, Number(config.interactive_capture?.maximum_items) || 25)),
        open_timeout_seconds: Math.max(1, Math.min(60, Number(config.interactive_capture?.open_timeout_seconds) || 10)),
        content_wait_ms: Math.max(0, Math.min(30000, Number(config.interactive_capture?.content_wait_ms) || 0)),
        close_timeout_seconds: Math.max(1, Math.min(30, Number(config.interactive_capture?.close_timeout_seconds) || 5)),
        scan_step_percent: Math.max(25, Math.min(100, Number(config.interactive_capture?.scan_step_percent) || 75)),
        whitelist_filename: String(config.interactive_capture?.whitelist_filename || "interactive-whitelist.txt"),
        blacklist_filename: String(config.interactive_capture?.blacklist_filename || "interactive-blacklist.txt"),
        whitelist_rule_count: normalizeInteractiveRules(config.interactive_capture?.whitelist_rules).length,
        blacklist_rule_count: normalizeInteractiveRules(config.interactive_capture?.blacklist_rules).length,
        built_in_block_term_count: IMMUTABLE_INTERACTIVE_BLOCK_TERMS.length,
        captured_items: Number(interactiveCapture.captured_items) || 0,
        processed_candidates: Number(interactiveCapture.processed_candidates) || 0,
        scan_steps: Number(interactiveCapture.scan_steps) || 0,
        stopped_reason: String(interactiveCapture.stopped_reason || ""),
        record_count: Array.isArray(interactiveCapture.records) ? interactiveCapture.records.length : 0,
        warnings: Array.isArray(interactiveCapture.warnings) ? interactiveCapture.warnings : [],
        error: String(interactiveCapture.error || ""),
        report_created: Array.isArray(interactiveCapture.artifacts) && interactiveCapture.artifacts.some(
          (artifact) => artifact.kind === "interactive_capture_report_json",
        ),
        note: config.interactive_capture?.enabled
          ? "Candidate controls were selected using the packaged editable whitelist and blacklist plus immutable high-risk action exclusions; user-entered CSS selectors were not required."
          : "Interactive overlay capture was disabled.",
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
      security_metadata: securityMetadata,
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
        transport_result: pdfTransportInfo,
        large_pdf_handling: {
          requested: normalizePdfLargeHandling(config.pdf_large_handling),
          requested_label: pdfLargeHandlingLabel(config.pdf_large_handling),
          automatic_split_threshold_pages: Math.max(2, Number(config.pdf_auto_split_threshold_pages) || 100),
          pages_per_part: Math.max(1, Number(config.pdf_pages_per_part) || 50),
          maximum_total_pages: Math.max(1, Number(config.pdf_max_total_pages) || 500),
          maximum_parts: Math.max(1, Number(config.pdf_max_parts) || 20),
          result: pdfLargeInfo,
        },
        failure_diagnostics: pdfFailureDiagnostics,
        completed: !pdfError,
        fully_complete: !pdfError && pdfLargeInfo?.complete !== false,
        partial: !pdfError && pdfLargeInfo?.complete === false,
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
    stderr: "piped",
  }).spawn();
  const diagnostics = {
    pid: Number(child.pid) || null,
    started_utc: nowIso(),
    status: null,
    stderr_tail: "",
    stderr_read_error: "",
    statusPromise: null,
    stderrPromise: null,
  };
  diagnostics.stderrPromise = collectBrowserStderrTail(child.stderr, diagnostics);
  const statusPromise = child.status.then((status) => {
    diagnostics.status = normalizeBrowserStatus(status);
    return status;
  });
  diagnostics.statusPromise = statusPromise;
  const port = await waitForDevTools(config.profile_root, statusPromise, Number(config.browser_start_timeout_seconds || 20) * 1000);
  const pageTarget = await getPageTarget(port);
  const client = await connectWebSocket(pageTarget.webSocketDebuggerUrl, 15000);
  client.setBrowserDiagnostics(diagnostics);
  const version = await getBrowserVersion(port);
  return { child, statusPromise, port, client, version, diagnostics };
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
  if (browser.diagnostics?.stderrPromise) {
    try { await Promise.race([browser.diagnostics.stderrPromise, delay(1000)]); } catch { /* ignore */ }
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
    if (config.interactive_capture?.enabled) {
      await log(
        `Interactive overlays: enabled (${normalizeInteractiveCaptureScope(config.interactive_capture.capture_scope).replaceAll("_", " ")}; ` +
        `maximum ${Math.max(1, Math.min(500, Number(config.interactive_capture.maximum_items) || 25))} item(s); ` +
        `${normalizeInteractiveRules(config.interactive_capture.whitelist_rules).length} whitelist / ` +
        `${normalizeInteractiveRules(config.interactive_capture.blacklist_rules).length} blacklist rules).`,
      );
      await log(
        `Interactive rule files: ${String(config.interactive_capture.whitelist_filename || "interactive-whitelist.txt")} and ` +
        `${String(config.interactive_capture.blacklist_filename || "interactive-blacklist.txt")}.`,
      );
    } else {
      await log("Interactive overlays: disabled.");
    }
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
