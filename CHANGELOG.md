# Changelog

Notable user-facing changes to WAVI Capture GUI for OSINT are listed below.

## [v2.2026.0722](https://github.com/jmashuque/wavi-capture-gui-for-osint/releases/tag/v2.2026.0722) - Output Log and Capture Layout Improvements

- Added a dedicated Output Log tab for live Audio/Video, Image, Webpage, and combined capture output, with follow, copy, save, and clear controls.
- Removed the embedded output logs from the capture tabs and reduced the main window height for a more compact layout.
- Added dynamically scrollable option panels across all capture engines, with Close buttons positioned directly after each panel’s content.
- Fixed option panels occasionally appearing blank the first time they were opened.
- Changed startup behavior to reopen the last selected capture tab rather than a queue, log, preview, or browser tab.
- Added automatic collapsing of capture option panels when switching away from their capture tab.

## [v2.2026.0721](https://github.com/jmashuque/wavi-capture-gui-for-osint/releases/tag/v2.2026.0721) - Large PDF Reliability and Window Placement

- Added streamed, atomic PDF writing with bounded memory use, partial-file cleanup, and improved browser/CDP failure diagnostics.
- Added automatic or manual Live Page PDF splitting with numbered parts, safety limits, preserved completed parts, and PDF-set metadata.
- Fixed main-window position persistence, including multi-monitor and off-screen recovery.
- Improved first-launch placement so the full interface remains visible above the taskbar.

## [v2.2026.0717](https://github.com/jmashuque/wavi-capture-gui-for-osint/releases/tag/v2.2026.0717) - Expanded Webpage Capture and Workflow Persistence

- Expanded Webpage Capture with organized options for output, readiness, long-page stability, browser environment, and supplemental evidence.
- Added flexible PNG/JPEG/WebP capture modes, capture-completeness reporting, and sanitized MHTML, HTML, network, console, security, and failure artifacts.
- Added Image and Webpage case summaries plus case-specific captured and failed URL copy/export actions with clipboard safeguards.
- Standardized all three capture tabs with the same twelve URL-management tools and captured/failed history support.
- Added the optional `%engine%` tag for case-name and filename templates.
- Added persistent active profiles, profile-specific autosaving, selected tab, window geometry, and maximized-window state.

## [v2.2026.0713](https://github.com/jmashuque/wavi-capture-gui-for-osint/releases/tag/v2.2026.0713) - Webpage Cookies, Archives, and Browser Selection

- Added cookies-file support to Webpage Capture using the isolated temporary browser profile.
- Added selectable cookie scope for requested-site cookies or the entire cookies file.
- Extended the Universal Download Archive to Webpage Capture with a separate SQLite archive and skip reports.
- Replaced Browser Path with an editable dropdown that detects installed Chromium-based browsers and supports manual paths.
- Updated in-app repository, release, and update-check links for the renamed WAVI project.

## [v2.2026.0711](https://github.com/jmashuque/wavi-capture-gui-for-osint/releases/tag/v2.2026.0711) - WAVI and Webpage Capture

- Renamed the app to **WAVI Capture GUI for OSINT**, with the full name **Webpage/Audio/Video/Image Capture GUI for OSINT**.
- Added a full **Webpage Capture** workflow using Deno and an isolated Edge/Chrome profile for full-page or viewport PNG captures.
- Added optional PDF output with **Live Page** and **Captured PNG** modes, configurable page layout, margins, headers, and footers.
- Integrated Webpage Capture with preflight checks, case naming, filename templates, Job Queue persistence/recovery, manifests, and metadata sidecars.
- Improved handling of very long webpages with segmented PNG capture and reliable image-based PDF generation.

## [v1.2026.0628](https://github.com/jmashuque/wavi-capture-gui-for-osint/releases/tag/v1.2026.0628) - Stability, Recovery, and Large Capture Polish

- Improved overall GUI responsiveness, scrolling, shutdown handling, and background task stability.
- Improved Job Queue performance and recovery clarity, including clearer direct-capture recovery jobs, queue filtering, and better handling of interrupted work.
- Improved large capture handling for Audio/Video and Image workflows, including more efficient logging, safer state saving, and better performance with large URL lists.
- Improved Case Browser performance for large folders with compact list handling, safer card rendering, better scrolling, and lazy hover previews for media thumbnails.
- Improved Audio/Video Preview behavior for large URL lists with clearer safeguards before loading heavy previews.
- Improved `--fresh` cleanup so it removes more app-created cache, temp, debug, and stale state files without deleting captured case output.
- Refreshed README setup, launch, recovery, and basic usage guidance for non-technical users.
- Increased the default GUI height to better fit the current layout.
- Cleaned up duplicated/internal GUI logic and removed Windows-irrelevant scroll handling.

## [v1.2026.0626](https://github.com/jmashuque/wavi-capture-gui-for-osint/releases/tag/v1.2026.0626) - AVI Capture, Image Capture, and Dual-Engine Queueing

- Renamed the app from **yt-dlp GUI for OSINT** to **AVI Capture GUI for OSINT**, with the full name **Audio/Video/Image Capture GUI for OSINT**.
- Added a full **Image Capture** workflow powered by `gallery-dl`, including its own tab, PowerShell script, URL/input handling, case naming, filename templates, cookies, output root, preflight checks, capture options, and output log.
- Added `script-gallerydl.ps1` for gallery-dl captures, with app-local temp handling, input/error files, metadata sidecars, item limits, pacing, retries, timeout, archive modes, cookies, and proxy support.
- Renamed **URL Preview** to **Audio/Video Preview** to separate yt-dlp preview workflows from gallery-dl Image Capture workflows.
- Expanded the shared **Job Queue** to support both `yt-dlp` and `gallery-dl` jobs, including Add Current selection, highlighted-job actions, persistence, interruption recovery, per-job recovery manifests, and engine-aware resume behavior.
- Added recoverable direct-capture tracking when Job Persistence is enabled, so interrupted direct Audio/Video and Image captures can be continued from the Job Queue.
- Added separate universal archive handling for Audio/Video and Image Capture, using `universal-download-archive.txt` for yt-dlp and `universal-gallerydl-archive.sqlite3` for gallery-dl.
- Added gallery-dl version checking and update support matching the yt-dlp update workflow.
- Expanded Domain Presets, Proxy Options, VPN checks, case-folder collision checks, and domain-collision detection across both capture workflows.
- Added separate concurrent-capture settings for Audio/Video and Image Capture, allowing yt-dlp and gallery-dl jobs to run alongside each other while guarding against same-domain concurrent captures.
- Added Image Capture support to Case Browser, URL history clearing, cookie cleanup, settings/profile persistence, reset-defaults behavior, and README guidance.
- Cleaned up deprecated code paths and fixed parity/stability issues around queue validation, output-template handling, universal archive state, duplicate helpers, and settings migration.

## [v0.2026.0623](https://github.com/jmashuque/wavi-capture-gui-for-osint/releases/tag/v0.2026.0623) - URL Preview Filters and Case Browser Polish

- Added in-memory filters for URL Preview URL rows, playlist/context item rows, and Case Browser file cards, with visible-row counts and clearer empty-state/status messages.
- Added context-sensitive URL Preview actions that switch from **All** to **Visible** when filters are active and apply only to currently visible rows.
- Improved case-folder handling so cache-only preview folders do not appear as captured cases or trigger existing-case warnings.
- Added a URL Preview cache-clearing action for temporary and reusable preview caches.

## [v0.2026.0621](https://github.com/jmashuque/wavi-capture-gui-for-osint/releases/tag/v0.2026.0621) - URL Preview, Universal Archive, and Cache Handling

- Replaced **Playlist Preview** with a broader **URL Preview** workflow for metadata preview, thumbnail preview, playlist/context item review, JSON export, and preview-derived start/queue actions.
- Added profile-level URL Preview options for preview pacing, thumbnail mode, thumbnail rate limiting, cache mode, playlist mode, max items, and preview timeout.
- Added playlist-aware URL Preview start/queue behavior, including expansion of confirmed playlist/context rows to extracted item URLs and `%playlist%` case-name support.
- Added optional **Universal Download Archive** skip logging and per-run skip summaries for direct captures and queued jobs.
- Added temporary and reusable URL Preview thumbnail cache modes, with Output Root `.gui-cache` treated as temporary and cleared by `--fresh`.
- Improved cache handling so case-level `.gui-cache` folders are hidden from Case Browser and excluded from verification/manifests.

## [v0.2026.0616](https://github.com/jmashuque/wavi-capture-gui-for-osint/releases/tag/v0.2026.0616) - Playlist Preview, URL Persistence, and Case Browser Polish

- Added the **Playlist Preview** tab with manual checked/selected preview scans, request pacing, rate-limit/backoff warnings, playlist/item checkmarks, playlist-split queueing, JSON export, and context menus.
- Added `%playlist%` case-name tag support and automatic playlist-title case naming for Playlist Preview queue jobs.
- Added app-level **URL Box Persistence**, silent Input File auto-population when the URL box is empty, and `--fresh` cleanup for persisted URL-box state.
- Changed default app startup behavior so **Check VPN** and **Use Cookies File** are disabled by default.
- Improved the **Case Browser** with better filename wrapping and dynamic file-card columns that reflow with available pane width.
- Refreshed README usage sections around the four main tabs while keeping prior changelog entries intact.

## [v0.2026.0614](https://github.com/jmashuque/wavi-capture-gui-for-osint/releases/tag/v0.2026.0614) - Tabs, Presets, Proxy, and Output Records

- Added a bottom-tab workflow for **Capture**, **Job Queue**, and **Case Browser**, with Case Browser loading the selected Output Root in the background and supporting Domain sort.
- Expanded input and queue workflows with multiple Input Files, queue checkmarks, Start Selected, split-and-add-to-queue, persisted jobs, interrupted job handling, and clearer active preset visibility.
- Reworked Domain Presets so presets use names plus one or more match domains, support priority ordering, import conflict choices, and expose matching preset information in the queue.
- Added app-level Proxy Options with protocol/address/port/credential fields, optional session-only storage, script-side proxy validation, and masked proxy logging.
- Added Output Records controls for Case Browser cache timing and file manifest scope; script success now follows yt-dlp results while cache warnings remain non-fatal.
- Improved responsiveness and cleanup by moving Case Browser scans/cache work off the main UI path, chunking large Case Browser renders, deferring startup work, and removing stale hidden UI/menu code.

## [v0.2026.0612](https://github.com/jmashuque/wavi-capture-gui-for-osint/releases/tag/v0.2026.0612) - Queue, URL Workflow, and Advanced Controls

- Added concurrent queue execution with domain-collision checks and queue-aware Start Capture behavior.
- Added failed/captured URL tracking, URL validation/statistics/grouping tools, and failed URL queueing.
- Added concurrent fragments, expanded request pacing options, and refined Advanced Options layout.
- Added Load versus Append URL behavior, duplicate removal, queue horizontal scrolling, and updated case name time tags.
- Reorganized README usage sections and expanded screenshot references.

## [v0.2026.0611](https://github.com/jmashuque/wavi-capture-gui-for-osint/releases/tag/v0.2026.0611) - Job Queue and Summary Refinements

- Added a sequential Job Queue window with queued job controls, URL-based progress, completed-job summary copying, and non-active job clearing.
- Added a Start Capture split-menu action to add the current configuration to the queue.
- Changed queued jobs to run from snapshotted job settings without rewriting the visible main GUI fields.
- Changed the default case name template to `Case-%datetime%`.
- Updated URL box saving to always prompt with a Save As dialog.
- Refined case summaries and verification so manifest files are counted in summaries while `.gui-cache` and `manifests` remain outside verification scope.

## [v0.2026.0529](https://github.com/jmashuque/wavi-capture-gui-for-osint/releases/tag/v0.2026.0529) - URL Controls, Cookie Scope, Download Limits, and Verification Scope

### URL Box Workflow

- Added one-word URL box buttons for Load, Save, Clear, and Strip.
- Changed URL loading so input file contents append to the existing URL box instead of replacing it.
- Removed URL load, save, and clear commands from the File menu.
- Refined the optional Strip action to decode common HTML ampersands and remove parameter-like ampersand segments.

### Cookies and Profiles

- Added a profile-level Use Cookies File setting.
- Added a Cookies File row checkbox that disables the path field and Browse button when cookies are not in use.
- Made preflight and capture skip cookies file validation and `-CookiesFile` passing when Use Cookies File is disabled.
- Changed browser cookie export to use `https://example.com/` as the generic reference URL.
- Removed the separate Load Default Profile command because Default is already available from the profile selection list.

### Advanced Capture Controls

- Added an Advanced Options download speed limit control with disabled as the default.
- Added download speed presets including 500K, 1M, 2M, 5M, 10M, and 50M.
- Added custom download speed limit support for yt-dlp `--limit-rate` values.
- Changed yt-dlp nightly build querying from 30 releases to 20 releases.

### PowerShell Capture Script

- Added PowerShell support for passing yt-dlp `--limit-rate` when a download speed limit is selected.
- Removed yt-dlp `--sleep-interval` and `--max-sleep-interval` while keeping `--sleep-requests` and the script-level pause between URLs.
- Added logging for whether a cookies file is provided or disabled.

### Case Browser Verification

- Excluded `.gui-cache` and `manifests` from SHA256 manifest generation and verification scope.
- Updated case file verification to ignore `.gui-cache` and `manifests` paths, including older manifests that may reference cache files.
- Changed Verify Case Files so Output Root cannot be verified directly; users must select a case folder or one of its subfolders.

## [v0.2026.0528](https://github.com/jmashuque/wavi-capture-gui-for-osint/releases/tag/v0.2026.0528) - Workflow Polish, Preflight Validation, and Case Browser Refinements

### App Workflow and Update Checks

- Added Help menu entries for About and Check for Updates.
- Added GitHub latest-release lookup for app updates without downloading, extracting, replacing, or running files.
- Updated the app version to `v0.2026.0528`.

### Case Naming and Case Safety

- Added case name templates with an Insert Tag menu and default `Case-%date%` naming.
- Added resolved case folder preview under the Case Name field.
- Added a warning before using an existing populated case folder.

### Preflight and Logging

- Changed Preflight Check to append to the output log instead of clearing previous entries.
- Added preflight execution/version checks for yt-dlp, FFmpeg, FFprobe, and Deno.
- Updated the yt-dlp version status label when preflight confirms yt-dlp is runnable.
- Reduced unnecessary settings and Dark Mode log noise.

### Case Browser Improvements

- Added Case Browser filter, sort, current-folder-only view, and icon scale preferences.
- Added horizontal scrolling and Small, Medium, and Large icon scale options.
- Added right-click actions for file cards, including open, open folder, open related metadata, open related source link, and copy path/name actions.
- Added case file verification against the latest SHA256 manifest.

### Settings and Appearance

- Added settings schema migration with recognized-value import, default creation for newer settings, and preservation of unrecognized values.
- Added app-level Dark Mode using built-in Tk/ttk styling only.
- Added app-level Delete Settings File option with confirmation and reset behavior.
- Saved Case Browser preferences as app-level settings.

## [v0.2026.0527](https://github.com/jmashuque/wavi-capture-gui-for-osint/releases/tag/v0.2026.0527) - Advanced Capture, App Settings, and Case Browser

### Capture Options and Advanced Options

- Added archive mode controls for using the case download archive, ignoring the archive for a run, or forcing a re-capture.
- Added date filters for capture date after and date before values.
- Added max resolution presets.
- Added playlist metadata capture when playlist or multi-item capture is enabled.
- Added Windows URL shortcut generation.
- Added match and reject keyword filters with clear buttons.
- Added failure handling options to continue after failed URLs or stop on the first failed URL.
- Moved rate limit controls into the Advanced Options panel.
- Added keep partial files/fragments on failure.
- Preserved persistent settings and profile support for the new capture options.

### PowerShell Capture Script Changes

- Added PowerShell handling for archive mode, date filters, max resolution, playlist metadata, URL shortcuts, keyword filters, failure handling, rate limits, and partial-file retention.
- Added FFmpeg-driven GUI thumbnail generation at the end of each URL capture, independent of the capture thumbnail checkbox.
- Added FFprobe-driven media information caching at the end of each URL capture.
- Fixed single-URL input handling so one pasted URL is treated as one URL instead of being indexed as individual characters.
- Continued keeping yt-dlp updating separate from the capture script.

### Case Browser

- Added `Tools > Open Case Browser`.
- Added a separate case browser window with a folder tree for the selected Output Root.
- Added media and sidecar file cards for selected folders.
- Added double-click file opening from the case browser.
- Added an `Open Folder` button for the selected folder.
- Added single-click folder behavior that expands the selected tree item and shows its contents.
- Added FFmpeg-generated PNG thumbnails stored in `.gui-cache\thumbnails`.
- Added FFprobe-generated media metadata stored in `.gui-cache\metadata`.
- Added case browser card summaries and hover tooltips with media details such as duration, size, bitrate, codec, resolution, frame rate, audio channels, and sample rate.
- Added fallback placeholders when thumbnails or media information cannot be generated.

### Settings and Profiles

- Added app-level `Delete Cookies on Exit` setting under the Settings menu.
- Added app-level `Check VPN` setting under the Settings menu.
- Made `Delete Cookies on Exit` and `Check VPN` save to the settings file but not to individual profiles.
- Made `Check VPN` show or hide the VPN Status section.
- Made Start Capture skip the VPN warning when `Check VPN` is disabled.
- Disabled VPN-related Tools menu actions when `Check VPN` is disabled.
- Changed custom profile saving so saving a custom profile no longer overwrites the Default profile.

### Impersonate Target Handling

- Added `Show all targets` behavior for impersonate target discovery.
- Kept the main yt-dlp-supported browser choices visible: `chrome`, `edge`, and `firefox`.
- Added OS labels beside discovered impersonate targets when available.
- Filtered yt-dlp log/status lines such as `[info]` from the target list.
- Preserved Windows-focused target discovery as the default behavior.

## [v0.2026.0526](https://github.com/jmashuque/wavi-capture-gui-for-osint/releases/tag/v0.2026.0526) - yt-dlp Update Workflow and Capture Options Foundation

### yt-dlp Update Changes

- Removed yt-dlp updating from the normal capture workflow.
- Removed the previous update checkbox from the main GUI capture options.
- Added dedicated controls to check the current yt-dlp version and run updates on request.
- Added a Python-based update dialog that runs independently of the PowerShell script.
- Added update choices for latest stable, latest nightly, or a selected nightly build from GitHub.
- Added a warning that very recent nightlies may be blocked by ASR or endpoint protection.

### Capture Options Foundation

- Replaced the always-visible `Prefer MP4` checkbox with a `Capture Options` button.
- Moved MP4 preference into the Capture Options panel.
- Added capture mode options for media capture or metadata/artifacts-only capture.
- Added source scope options for single-item capture or playlist/multi-item capture.
- Added sidecar artifact options for metadata JSON, source links, descriptions, thumbnails, subtitles, automatic subtitles, and comments.
- Added persistent settings and profile support for capture options.

### PowerShell Capture Script Foundation

- Added support for GUI-driven capture options.
- Added switches for MP4 preference, metadata-only capture, playlist inclusion, metadata JSON, source links, descriptions, thumbnails, subtitles, automatic subtitles, and comments.
- Preserved single-item capture by default unless playlist or multi-item capture is explicitly selected.
- Added FFmpeg folder support through yt-dlp's FFmpeg location option.
- Kept yt-dlp updating separate from the PowerShell capture process.
