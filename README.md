# yt-dlp GUI for OSINT

A lightweight, portable Windows GUI for running an approved yt-dlp capture workflow in an organizational environment.

## Table of Contents

- [Overview](#overview)
- [Screenshots](#screenshots)
- [Intended Users](#intended-users)
- [What the App Does](#what-the-app-does)
- [What the App Does Not Do](#what-the-app-does-not-do)
- [Organizational Compatibility](#organizational-compatibility)
- [Required Components](#required-components)
- [Basic Usage](#basic-usage)
- [Advanced Usage](#advanced-usage)
- [Profiles and Settings](#profiles-and-settings)
- [Cookies Handling](#cookies-handling)
- [Limitations](#limitations)
- [Changelog](#changelog)

## Overview

`yt-dlp GUI for OSINT` is a portable Windows interface for running a consistent yt-dlp capture workflow with local, organization-approved tools.

The app is intentionally narrow in scope. It wraps a local PowerShell capture script and `yt-dlp`, organizes captured material into case folders, provides review and queue tooling, and keeps executable downloads, credential handling, legal authorization, and evidence interpretation outside the app.

The current workflow is organized into three bottom tabs:

- **Capture** for paths, URLs, options, proxy settings, and starting work
- **Job Queue** for staged captures, persisted jobs, selected-job starts, interrupted job recovery, and queue progress
- **Case Browser** for browsing captured cases, viewing media/sidecar files, sorting/filtering, and verifying manifests

## Screenshots

<p align="center">
  <img src="/screenshots/main1.png" alt="capture tab" width="750">
</p>

<p align="center">
  <img src="/screenshots/main2.png" alt="job queue tab" width="750">
</p>

<p align="center">
  <img src="/screenshots/main3.png" alt="case browser tab" width="750">
</p>

## Intended Users

This app is intended for investigators, analysts, or support staff who need a repeatable way to collect media or metadata with yt-dlp without manually assembling command-line arguments every time.

It is designed for internal use in managed environments where binaries, scripts, proxy/VPN usage, cookies, storage locations, and capture authority are reviewed separately through normal organizational processes.

## What the App Does

The app helps users run a repeatable, local yt-dlp capture workflow without manually building long command lines.

Key capabilities include:

- **Guided capture setup**: select the local script, yt-dlp, FFmpeg/FFprobe, optional cookies file, Output Root, case name, URL list, and capture options.
- **URL list preparation**: paste URLs or use one or more Input Files, then normalize, validate, group, deduplicate, copy, save, or review failed/captured URL history.
- **Case-oriented output**: organize captures under case folders with media, logs, sidecar artifacts, URL records, manifests, and optional Case Browser cache files.
- **Capture control**: choose media, media-only, or metadata/artifact-focused workflows; control playlist scope, archive behavior, output format, date filters, sidecar files, keyword filters, pacing, retries, speed limits, and failure behavior.
- **Queue workflow**: stage jobs, split large URL sets, select jobs with checkmarks, run selected jobs, persist the queue, and recover interrupted jobs.
- **Domain Presets**: save named capture-option presets for one or more domains, prioritize them, import/export them, and automatically apply matching active presets.
- **Proxy and network awareness**: pass an app-level proxy to yt-dlp, optionally keep proxy settings session-only, mask proxy details in logs, and optionally check the selected VPN/network adapter before capture.
- **Case review**: browse case folders in the Case Browser tab, filter/sort files, review media and sidecar artifacts, generate thumbnails/media details, and verify files against SHA256 manifests.
- **Portable settings**: keep profiles, app settings, domain presets, and persisted queue jobs beside the app so the workflow can remain self-contained.

## What the App Does Not Do

The app is not a downloader bundle, browser automation tool, authorization system, or evidence analysis platform.

Important limitations for users and administrators:

- **No bundled tools**: it does not include or install yt-dlp, FFmpeg/FFprobe, Deno, Python, or PowerShell. Those tools must be obtained, reviewed, staged, and approved separately.
- **No security bypass**: it does not bypass EDR/AV, ASR rules, firewall rules, proxy controls, application allow-listing, website restrictions, login requirements, paywalls, or rate limits.
- **No authorization decision**: it does not decide whether a capture is legal, policy-approved, proportionate, or in scope.
- **No credential collection or login automation**: it does not collect passwords, automate website sign-ins, solve challenges, or operate a browser on the user's behalf.
- **No guaranteed site support**: source support depends on the installed yt-dlp build and the source platform's current behavior.
- **No hidden network path**: proxy and VPN settings only affect the local workflow as configured; they do not make traffic anonymous or invisible to local administrators, endpoint tools, network controls, or process inspection.
- **No content analysis**: it does not identify people, assess authenticity, classify evidence, summarize media content, or determine evidentiary value.
- **No cloud workflow**: it does not upload, sync, retain, or archive case folders to external services.

## Organizational Compatibility

This app is designed for managed Windows environments.

The app should be placed in a local non-synced folder. Required tools should be obtained, reviewed, staged, and approved separately according to the organization's process. The app should operate as a wrapper around approved local tools, not as a downloader or installer.

Recommended operating assumptions:

- keep the app folder and Output Root outside OneDrive, Dropbox, Google Drive, or other active sync locations
- use organization-approved builds of yt-dlp, FFmpeg/FFprobe, Deno, and Python
- expect endpoint protection to review or block newly downloaded binaries until they are allowed
- keep case folders local during capture, then move or archive them through approved evidence-handling processes
- treat proxy settings, cookies, and URL lists as sensitive operational data

## Required Components

The following components must be present or provided separately:

- Python
- PowerShell
- the Python GUI script, `gui.py`
- the PowerShell capture script, `script.ps1`
- `yt-dlp.exe`
- `ffmpeg.exe`
- `ffprobe.exe`
- `deno.exe`

The GUI script and PowerShell script should stay together in the same portable app folder unless the paths are intentionally changed in the GUI.

Place `deno.exe` in the same folder as `yt-dlp.exe`. From the source repos/build packages, keep only the required binaries for this app: `yt-dlp.exe`, `deno.exe`, `ffmpeg.exe`, and `ffprobe.exe`. Other bundled files can be omitted or deleted after staging the needed executables.

Python may require administrative privileges to install, depending on the organization's software installation policies. For standard Windows users, use an organization-approved Python install method where permitted by policy.

Windows includes Windows PowerShell, which is sufficient for the included `script.ps1`; PowerShell 7 is not required.

Recommended source pages:

- Python downloads: <https://www.python.org/downloads/windows/>
- Microsoft Store - Python: <https://apps.microsoft.com/detail/9PNRBTZXMB4Z>
- Microsoft Store - Python Install Manager: <https://apps.microsoft.com/detail/9NQ7512CXL7T>
- yt-dlp releases: <https://github.com/yt-dlp/yt-dlp/releases>
- yt-dlp nightly builds: <https://github.com/yt-dlp/yt-dlp-nightly-builds/releases>
- Deno releases: <https://github.com/denoland/deno/releases>
- FFmpeg Windows builds by Gyan.dev: <https://www.gyan.dev/ffmpeg/builds/>

All required binaries, including yt-dlp, FFmpeg/FFprobe, and Deno, should be official releases whenever available. They should be downloaded only from trusted official sources and staged by IT or another approved process.

For FFmpeg, use the Gyan.dev **release essentials** build unless you specifically need the larger full build. The essentials release includes the expected `ffmpeg.exe` and `ffprobe.exe` tools used by this app.

## Basic Usage

1. Extract or place the app files in a local non-synced folder.
2. Launch the app by running `gui.py`.
   - If `.py` files are associated with Python, double-click `gui.py`.
   - Otherwise, open the app folder in File Explorer, click the address bar, type `cmd`, press Enter, then run `python gui.py`.
   - If `python` is not available from that terminal, try `py gui.py`.
3. Confirm the paths for the PowerShell script, yt-dlp, optional cookies file, Output Root, and FFmpeg folder.
4. Set the Output Root to a local non-synced folder.
5. Enter a case name or template.
6. Paste URLs into the URL box or select one or more Input Files.
7. Use the URL box tools to normalize, validate, deduplicate, or summarize the URL list.
8. Set Capture Options, Pacing Options, Advanced Options, Domain Presets, and Proxy Options as needed.
9. Run **Preflight Check**.
10. Start the capture directly or add it to the Job Queue.
11. Review results in the case folder or the Case Browser tab.

## Advanced Usage

### Case Name Templates

Case names can include tags inserted from the **Insert Tag** menu. Tags are resolved when a capture starts or when a job is queued.

Useful tags include date/time tags, URL-domain tags, and preset-related tags. The default case name is `Case-%datetime%`.

### URL Box Tools

The URL box supports direct paste input and one or more selected Input Files. When the URL box is empty, capture and queue actions fall back to the selected Input Files.

Common URL tools include:

- **Load** to replace the URL box with selected Input File contents
- **Append** to append selected Input File contents
- **Save** to save URL box contents
- **Clear** to empty the URL box
- **Strip** to clean common copied HTML/query fragments
- **Copy** to copy URL box contents, or selected Input File contents if the box is empty
- **Failed / All** to toggle failed URLs and the original URL list
- **Group** to group URLs by domain
- **Statistics** to summarize URL totals and domains
- **Normalize** to extract and clean valid URLs
- **Duplicates** to remove duplicate URLs
- **Validate** to check URL/input-file contents without changing them

Multiple Input Files are stored in the field as a semicolon-separated list.

### Failed and Captured URL Tracking

The capture script writes URL tracking files under the Output Root:

- `gui-failed-urls.txt`
- `gui-captured-urls.txt`

Captured URL status is based on yt-dlp success. Case Browser cache warnings are logged separately and do not mark a successful yt-dlp capture as failed.

### Capture, Advanced, and Pacing Options

Capture-related options are split into three panels:

- **Capture Options** for capture mode, source scope, format, archive behavior, date filters, sidecar artifacts, and Output Records
- **Pacing Options** for request pacing, retry behavior, throttling detection, HTTP chunk size, download speed limiting, and fragment concurrency
- **Advanced Options** for browser impersonation, failure behavior, concurrent queue captures, keyword filters, and partial-file handling

The **Output Records** area controls:

- **Case Browser cache**: prepare thumbnails/media details after the run, after each URL, or not during capture
- **File manifest**: hash the full case folder or only files from the current run

### Proxy Options

Proxy Options are managed from **Tools > Proxy Options** and are app-level settings.

Supported protocol choices are:

- **None**
- `http`
- `https`
- `socks4`
- `socks5`

The dialog includes address, port, username, and password fields. Proxy settings can include credentials. If saved, they are stored unencrypted in `gui-settings.json`. Enable **Do not save proxy options to settings file** to keep proxy settings only in memory until the app closes.

Queue jobs use the current app-level proxy setting at run time. Proxy settings are not stored inside individual job snapshots. The script validates the proxy URL before capture and writes only a masked proxy value to logs.

### Domain Presets

Domain Presets are managed from **Tools > Domain Presets**.

A preset has a user-defined name and one or more match domains. Multiple presets can target the same domain. Presets can be checked/unchecked, reordered by priority, exported, imported, and normalized by priority.

Each preset stores capture-related options, not paths or app-level settings. Higher-priority presets override lower-priority presets when both match the same URL set. The Job Queue can show matching active presets for each job.

Import conflict choices include overwrite, rename, or skip existing presets.

### Job Queue

The Job Queue tab stages and runs multiple jobs.

It supports:

- adding the current capture to the queue
- splitting a URL set into multiple queued jobs
- selecting jobs with checkmarks
- starting all jobs or only selected jobs
- pausing after the current job
- restarting or continuing interrupted jobs
- clearing completed, failed, interrupted, or selected jobs
- persistent queued jobs in `gui-jobs.json`
- schema warnings when older queued jobs are loaded

Queued jobs store their own capture settings. App-level proxy settings are evaluated at run time.

### Case Browser and Verification

The Case Browser tab loads the current Output Root in the background and allows captured case review.

It supports:

- folder tree navigation
- media and sidecar file cards
- current-folder-only view
- filtering by file type
- sorting by name, domain, type, size, newest, or oldest
- icon scale options
- right-click file actions
- FFmpeg-generated thumbnails stored in `.gui-cache\thumbnails`
- FFprobe-generated media details stored in `.gui-cache\metadata`
- SHA256 manifest verification

Case file verification runs only for a selected case folder or one of its subfolders. The Output Root itself cannot be verified. The GUI cache and manifests folders are excluded from SHA256 verification scope because they contain regenerated display/cache data and verification records rather than captured evidence.

### App Update Checks

The app update checker queries GitHub for the latest app release and opens the release page for manual download. It does not download, extract, replace, or run app files.

yt-dlp updates are separate from normal capture runs and are controlled from the app's yt-dlp update workflow for the selected local yt-dlp executable.

## Profiles and Settings

The app stores settings, profiles, domain presets, and app-level settings in `gui-settings.json` beside the app.

The **Default** profile is always loaded on startup. Custom profiles can be created, loaded, saved, and deleted from the Profile menu.

Profile-level settings include capture paths, capture options, pacing options, advanced options, URL/input settings, and selected VPN adapter. App-level settings include Delete Cookies on Exit, Check VPN, Dark Mode, Job Persistence, Case Browser preferences, and Proxy Options.

Queued jobs are stored separately in `gui-jobs.json` when Job Persistence is enabled.

## Cookies Handling

The app can use a user-provided cookies file and can invoke yt-dlp's supported browser cookie export workflow.

Cookie-related notes:

- cookies are not required for every capture
- cookies are sensitive and should be handled as operational data
- exported cookies can optionally be applied to the main Cookies File field
- the app can encrypt/decrypt cookie files with a password-based local helper
- temporary/session behavior depends on how the user manages the cookies file and Delete Cookies on Exit setting

The app does not automate website logins or collect credentials.

## Limitations

- Site support depends on the installed yt-dlp build and the source platform.
- Browser impersonation targets depend on the installed yt-dlp build.
- Proxy and VPN behavior depends on local network policy and the selected path.
- Case Browser thumbnails and media details require FFmpeg/FFprobe.
- yt-dlp, FFmpeg, FFprobe, Deno, Python, and PowerShell must be available separately.
- Very large case folders can take time to scan, render, or verify.
- Manifest verification confirms file hashes against the manifest; it does not assess content authenticity or legal sufficiency.
- The app is not a replacement for organizational authorization, evidence-handling policy, or analyst judgment.

## Changelog

### v0.2026.0614 - Tabs, Presets, Proxy, and Output Records

- Added a bottom-tab workflow for **Capture**, **Job Queue**, and **Case Browser**, with Case Browser loading the selected Output Root in the background and supporting Domain sort.
- Expanded input and queue workflows with multiple Input Files, queue checkmarks, Start Selected, split-and-add-to-queue, persisted jobs, interrupted job handling, and clearer active preset visibility.
- Reworked Domain Presets so presets use names plus one or more match domains, support priority ordering, import conflict choices, and expose matching preset information in the queue.
- Added app-level Proxy Options with protocol/address/port/credential fields, optional session-only storage, script-side proxy validation, and masked proxy logging.
- Added Output Records controls for Case Browser cache timing and file manifest scope; script success now follows yt-dlp results while cache warnings remain non-fatal.
- Improved responsiveness and cleanup by moving Case Browser scans/cache work off the main UI path, chunking large Case Browser renders, deferring startup work, and removing stale hidden UI/menu code.

### v0.2026.0612 - Queue, URL Workflow, and Advanced Controls

- Added concurrent queue execution with domain-collision checks and queue-aware Start Capture behavior.
- Added failed/captured URL tracking, URL validation/statistics/grouping tools, and failed URL queueing.
- Added concurrent fragments, expanded request pacing options, and refined Advanced Options layout.
- Added Load versus Append URL behavior, duplicate removal, queue horizontal scrolling, and updated case name time tags.
- Reorganized README usage sections and expanded screenshot references.

### v0.2026.0611 - Job Queue and Summary Refinements

- Added a sequential Job Queue window with queued job controls, URL-based progress, completed-job summary copying, and non-active job clearing.
- Added a Start Capture split-menu action to add the current configuration to the queue.
- Changed queued jobs to run from snapshotted job settings without rewriting the visible main GUI fields.
- Changed the default case name template to `Case-%datetime%`.
- Updated URL box saving to always prompt with a Save As dialog.
- Refined case summaries and verification so manifest files are counted in summaries while `.gui-cache` and `manifests` remain outside verification scope.

### v0.2026.0529 - URL Controls, Cookie Scope, Download Limits, and Verification Scope

#### URL Box Workflow

- Added one-word URL box buttons for Load, Save, Clear, and Strip.
- Changed URL loading so input file contents append to the existing URL box instead of replacing it.
- Removed URL load, save, and clear commands from the File menu.
- Refined the optional Strip action to decode common HTML ampersands and remove parameter-like ampersand segments.

#### Cookies and Profiles

- Added a profile-level Use Cookies File setting.
- Added a Cookies File row checkbox that disables the path field and Browse button when cookies are not in use.
- Made preflight and capture skip cookies file validation and `-CookiesFile` passing when Use Cookies File is disabled.
- Changed browser cookie export to use `https://example.com/` as the generic reference URL.
- Removed the separate Load Default Profile command because Default is already available from the profile selection list.

#### Advanced Capture Controls

- Added an Advanced Options download speed limit control with disabled as the default.
- Added download speed presets including 500K, 1M, 2M, 5M, 10M, and 50M.
- Added custom download speed limit support for yt-dlp `--limit-rate` values.
- Changed yt-dlp nightly build querying from 30 releases to 20 releases.

#### PowerShell Capture Script

- Added PowerShell support for passing yt-dlp `--limit-rate` when a download speed limit is selected.
- Removed yt-dlp `--sleep-interval` and `--max-sleep-interval` while keeping `--sleep-requests` and the script-level pause between URLs.
- Added logging for whether a cookies file is provided or disabled.

#### Case Browser Verification

- Excluded `.gui-cache` and `manifests` from SHA256 manifest generation and verification scope.
- Updated case file verification to ignore `.gui-cache` and `manifests` paths, including older manifests that may reference cache files.
- Changed Verify Case Files so Output Root cannot be verified directly; users must select a case folder or one of its subfolders.

### v0.2026.0528 - Workflow Polish, Preflight Validation, and Case Browser Refinements

#### App Workflow and Update Checks

- Added Help menu entries for About and Check for Updates.
- Added GitHub latest-release lookup for app updates without downloading, extracting, replacing, or running files.
- Updated the app version to `v0.2026.0528`.

#### Case Naming and Case Safety

- Added case name templates with an Insert Tag menu and default `Case-%date%` naming.
- Added resolved case folder preview under the Case Name field.
- Added a warning before using an existing populated case folder.

#### Preflight and Logging

- Changed Preflight Check to append to the output log instead of clearing previous entries.
- Added preflight execution/version checks for yt-dlp, FFmpeg, FFprobe, and Deno.
- Updated the yt-dlp version status label when preflight confirms yt-dlp is runnable.
- Reduced unnecessary settings and Dark Mode log noise.

#### Case Browser Improvements

- Added Case Browser filter, sort, current-folder-only view, and icon scale preferences.
- Added horizontal scrolling and Small, Medium, and Large icon scale options.
- Added right-click actions for file cards, including open, open folder, open related metadata, open related source link, and copy path/name actions.
- Added case file verification against the latest SHA256 manifest.

#### Settings and Appearance

- Added settings schema migration with recognized-value import, default creation for newer settings, and preservation of unrecognized values.
- Added app-level Dark Mode using built-in Tk/ttk styling only.
- Added app-level Delete Settings File option with confirmation and reset behavior.
- Saved Case Browser preferences as app-level settings.

### v0.2026.0527 - Advanced Capture, App Settings, and Case Browser

#### Capture Options and Advanced Options

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

#### PowerShell Capture Script Changes

- Added PowerShell handling for archive mode, date filters, max resolution, playlist metadata, URL shortcuts, keyword filters, failure handling, rate limits, and partial-file retention.
- Added FFmpeg-driven GUI thumbnail generation at the end of each URL capture, independent of the capture thumbnail checkbox.
- Added FFprobe-driven media information caching at the end of each URL capture.
- Fixed single-URL input handling so one pasted URL is treated as one URL instead of being indexed as individual characters.
- Continued keeping yt-dlp updating separate from the capture script.

#### Case Browser

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

#### Settings and Profiles

- Added app-level `Delete Cookies on Exit` setting under the Settings menu.
- Added app-level `Check VPN` setting under the Settings menu.
- Made `Delete Cookies on Exit` and `Check VPN` save to the settings file but not to individual profiles.
- Made `Check VPN` show or hide the VPN Status section.
- Made Start Capture skip the VPN warning when `Check VPN` is disabled.
- Disabled VPN-related Tools menu actions when `Check VPN` is disabled.
- Changed custom profile saving so saving a custom profile no longer overwrites the Default profile.

#### Impersonate Target Handling

- Added `Show all targets` behavior for impersonate target discovery.
- Kept the main yt-dlp-supported browser choices visible: `chrome`, `edge`, and `firefox`.
- Added OS labels beside discovered impersonate targets when available.
- Filtered yt-dlp log/status lines such as `[info]` from the target list.
- Preserved Windows-focused target discovery as the default behavior.

### v0.2026.0526 - yt-dlp Update Workflow and Capture Options Foundation

#### yt-dlp Update Changes

- Removed yt-dlp updating from the normal capture workflow.
- Removed the previous update checkbox from the main GUI capture options.
- Added dedicated controls to check the current yt-dlp version and run updates on request.
- Added a Python-based update dialog that runs independently of the PowerShell script.
- Added update choices for latest stable, latest nightly, or a selected nightly build from GitHub.
- Added a warning that very recent nightlies may be blocked by ASR or endpoint protection.

#### Capture Options Foundation

- Replaced the always-visible `Prefer MP4` checkbox with a `Capture Options` button.
- Moved MP4 preference into the Capture Options panel.
- Added capture mode options for media capture or metadata/artifacts-only capture.
- Added source scope options for single-item capture or playlist/multi-item capture.
- Added sidecar artifact options for metadata JSON, source links, descriptions, thumbnails, subtitles, automatic subtitles, and comments.
- Added persistent settings and profile support for capture options.

#### PowerShell Capture Script Foundation

- Added support for GUI-driven capture options.
- Added switches for MP4 preference, metadata-only capture, playlist inclusion, metadata JSON, source links, descriptions, thumbnails, subtitles, automatic subtitles, and comments.
- Preserved single-item capture by default unless playlist or multi-item capture is explicitly selected.
- Added FFmpeg folder support through yt-dlp's FFmpeg location option.
- Kept yt-dlp updating separate from the PowerShell capture process.
