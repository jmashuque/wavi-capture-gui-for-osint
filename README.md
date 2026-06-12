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

`yt-dlp GUI for OSINT` is a portable Windows interface I created to make yt-dlp capture workflows easier, more consistent, and more approachable for OSINT users working inside managed organizations.

The app is intentionally narrow in scope. It wraps an approved local PowerShell and yt-dlp workflow, adds case organization and review helpers, and avoids acting as a downloader, installer, scraper, browser automation tool, or evidence analysis suite.

## Screenshots

<p align="center">
  <img src="/screenshots/main1.png" alt="yt-dlp GUI for OSINT main screenshot" width="750">
</p>

<p align="center">
  <img src="/screenshots/main2.png" alt="yt-dlp GUI for OSINT advanced options screenshot" width="750">
</p>

<p align="center">
  <img src="/screenshots/main3.png" alt="yt-dlp GUI for OSINT job queue screenshot" width="750">
</p>

## Intended Users

This app is intended for investigators, analysts, or support staff who need a repeatable way to collect media or metadata using yt-dlp without manually assembling command-line arguments each time.

It assumes the user is working under their organization's policies and has authorization to perform the captures they are attempting.

## What the App Does

The app provides a guided interface for:

- selecting required local tools and paths, including `script.ps1`, `yt-dlp.exe`, optional cookies, FFmpeg, and the Output Root
- entering or templating case names with tags such as `%date%`, `%time%`, `%datetime%`, and `%utcdatetime%`
- pasting URLs directly, loading URLs from a file, appending URLs from a file, saving URL box contents, and cleaning pasted URL lists
- validating URL lists, removing duplicates, grouping URLs by domain, viewing URL statistics, and toggling failed/all URL views
- selecting VPN/network adapter checks when required
- running preflight checks before capture
- choosing capture behavior such as source scope, archive mode, date filters, max resolution, sidecar artifacts, title keyword filters, failure handling, request pacing, concurrent captures, concurrent fragments, and optional download speed limiting
- using supported browser impersonation targets, with an option to view all targets returned by yt-dlp
- opening, browsing, sorting, filtering, and reviewing case folders through the Case Browser
- generating GUI thumbnails and cached media details when FFmpeg and FFprobe are available
- verifying case files against the latest SHA256 manifest
- tracking failed and captured URLs across runs
- copying successful case summaries and completed queue job summaries
- saving settings and reusable profiles
- using the Job Queue to run snapshotted capture jobs with optional concurrency and domain-collision checks

The goal is to reduce mistakes, make captures more repeatable, and keep the workflow understandable for users who are not comfortable building commands manually.

## What the App Does Not Do

The app does not:

- include or distribute yt-dlp, FFmpeg, Deno, Python, or any other binaries
- download binaries automatically
- bypass organizational security controls
- bypass website access controls
- perform credential collection
- automate logins
- perform browser automation
- perform content analysis
- perform identity matching
- determine whether a capture is legally or organizationally authorized

The app only helps run a local, approved capture workflow.

## Organizational Compatibility

This app is designed for managed environments. It does **not** bundle downloaded binaries and does **not** fetch executables from the internet.

All required tools should be obtained, reviewed, and staged separately according to the organization's process. The app should operate as a wrapper around approved local tools, not as a downloader or installer.

## Required Components

The following components must be present or provided separately:

- Python
- the Python GUI script, `gui.py`
- the PowerShell capture script, `script.ps1`
- `yt-dlp.exe`
- `ffmpeg.exe`
- `ffprobe.exe`
- `deno.exe`

Place `deno.exe` in the same folder as `yt-dlp.exe`. From the source repos/build packages, keep only the required binaries for this app: `yt-dlp.exe`, `deno.exe`, `ffmpeg.exe`, and `ffprobe.exe`. Other bundled files can be omitted or deleted after staging the needed executables.

Python may require administrative privileges to install, depending on the organization's software installation policies. For standard Windows users, I recommend installing Python through the Microsoft Store / Python install manager where permitted by policy:

- Microsoft Store - Python: <https://apps.microsoft.com/detail/9PNRBTZXMB4Z>
- Microsoft Store - Python Install Manager: <https://apps.microsoft.com/detail/9NQ7512CXL7T>

The GUI script and PowerShell script should stay together in the same portable app folder unless the paths are intentionally changed in the GUI.

All required binaries, including yt-dlp, FFmpeg, and Deno, should be official signed releases whenever available. They should be downloaded only from trusted official sources and staged by IT or another approved process.

Recommended source pages:

- yt-dlp nightly builds: <https://github.com/yt-dlp/yt-dlp-nightly-builds/releases>
- Deno releases: <https://github.com/denoland/deno/releases>
- FFmpeg Windows builds by Gyan.dev: <https://www.gyan.dev/ffmpeg/builds/>

For FFmpeg, use the Gyan.dev **release essentials** build unless you specifically need the larger full build. The essentials release includes the expected `ffmpeg.exe` and `ffprobe.exe` tools used by this app.

## Basic Usage

1. Extract or place the app files in a local non-synced folder, such as a folder outside OneDrive, Dropbox, Google Drive, or other cloud sync locations.
2. Launch the app by running `gui.py`.
   - If `.py` files are associated with Python, double-click `gui.py`.
   - Otherwise, open the app folder in File Explorer, click the address bar, type `cmd`, press Enter, then run `python gui.py`.
   - If `python` is not available from that terminal, try `py gui.py`.
3. Confirm the paths for the PowerShell script, yt-dlp, optional cookies file, Output Root, and FFmpeg folder.
4. Set the Output Root to a local non-synced folder so captures, logs, manifests, GUI cache files, failed URL records, and captured URL records are not actively synchronized while captures are running.
5. Enter a case name or template. The default is `Case-%datetime%`; use **Insert Tag** for tags such as `%date%`, `%time%`, `%datetime%`, `%utcdatetime%`, `%year%`, `%month%`, `%day%`, `%hour%`, `%minute%`, and `%second%`.
6. Paste URLs into the URL box or select an input file. The URL box takes priority if both are used.
7. Use **Load** to replace the URL box contents with the input file, or **Append** to add the input file contents to the existing URL box.
8. Select the VPN/network adapter used for the capture, if applicable.
9. Press **Check VPN** to verify that the selected VPN/network adapter is connected, if VPN checking is enabled.
10. Run **Preflight Check** to confirm required files exist and determine whether the existing yt-dlp, FFmpeg, FFprobe, and Deno binaries are allowed to execute.
11. Start the capture with **Start Capture**.
12. Review the output log.
13. Open the case folder using **Open**, or use **Tools > Open Case Browser** to review case folders, thumbnails, media details, sidecar files, summaries, and manifest verification.
14. To stage multiple captures, use **Tools > Open Job Queue**, or use the **Start Capture** split-menu to add the current capture to the queue.

Case name templates are resolved when capture starts or when a job is added to the queue. The resolved case folder is previewed below the Case Name field, and the app warns before using an existing populated folder.

## Advanced Usage

### Case Name Templates

Case names support reusable tags. The default case name is `Case-%datetime%`.

Useful tags include:

- `%date%` for the local date, such as `2026-06-11`
- `%time%` for the local time as six digits, such as `143005`
- `%datetime%` for local date and time, such as `2026-06-11_143005`
- `%utcdatetime%` for UTC date and time ending in `Z`, such as `20260611_183005Z`

### URL Box Tools

The URL box includes two columns of quick actions.

The first column provides:

- **Load** to replace the URL box contents with the selected Input File
- **Append** to append the selected Input File contents to the URL box
- **Save** to save the URL box contents using a file selection dialog
- **Clear** to empty the URL box
- **Strip** to decode common HTML ampersands such as `&amp;` and remove trailing parameter-like segments that match `&name=`

The second column provides:

- **Failed** / **All** to toggle between failed URLs and the original URL list
- **Group** to group URLs by detected domain
- **Statistics** to show total URLs, unique URLs, domain count, and totals by domain
- **Duplicates** to remove duplicate URLs
- **Validate** to extract URLs from messy pasted text, remove blank/comment lines, check URL shape, warn about duplicate URLs, and warn about URLs previously captured under the current Output Root

Validation does not remove duplicates; use **Duplicates** when duplicate removal is desired.

### Failed and Captured URL Tracking

The capture script writes URL tracking files under the Output Root:

- `gui-failed-urls.txt`
- `gui-captured-urls.txt`

Failed URL records include the case name, URL, UTC timestamp, status, and failure detail. Captured URL records allow the URL validator to warn when a URL appears to have been captured in a previous run.

The **Add Failed to Queue** Start Capture menu option adds only failed URLs from the current URL context.

### Capture Options and Advanced Options

Capture and Advanced Options allow the user to control:

- media capture versus metadata/artifacts-only capture
- single-item capture versus playlist/multi-item capture
- archive mode
- date filters
- max resolution
- playlist metadata
- Windows URL shortcuts
- title match and reject keyword filters
- failure handling
- request pacing, including None, Fast, Normal, and Cautious presets
- optional download speed limiting through yt-dlp `--limit-rate`
- concurrent capture count from 1 to 4
- concurrent fragment workers per URL
- partial-file retention
- sidecar artifacts such as metadata JSON, source links, descriptions, thumbnails, subtitles, automatic subtitles, and comments

Request Rate Limit includes None, Fast, Normal, and Cautious presets. None uses a 0-second baseline with jitter up to 5 seconds between URLs and does not pass a yt-dlp request sleep value. Fast, Normal, and Cautious add progressively longer URL pacing.

Download speed limiting is disabled by default. When enabled, the app passes yt-dlp's `--limit-rate` option with the selected preset or a custom value such as `750K`, `20M`, or `1.5M`.

Concurrent Fragments controls yt-dlp's per-URL fragment worker count. Values above 1 may speed up some fragmented media downloads, but they can also increase rate-limit or connection pressure and may interact poorly with download speed limits. Leave this at 1 unless there is a specific reason to raise it.

### Job Queue

The Job Queue snapshots the current GUI configuration and URL list when a job is added, then runs jobs through the queue. By default, it runs one job at a time. When **Concurrent Captures** is set above 1 in Advanced Options, the queue can run multiple non-colliding jobs at once.

The queue includes controls to add jobs, start the queue, pause after the current active work, stop active jobs, remove selected jobs, clear completed jobs, clear non-active jobs, open a case, and copy summaries for completed jobs.

The queue table supports horizontal scrolling so longer case names, domains, and Output Root paths can be reviewed without shrinking columns.

The Start Capture split-menu includes:

- **Add Job to Queue**
- **Add Job to Queue and Start**
- **Add Jobs to Queue by Domain**
- **Add Failed to Queue**

When concurrency is enabled, the queue checks queued and running jobs for matching URL domains and can warn before same-domain jobs run concurrently. The user can continue, queue after colliding jobs finish, or cancel the action.

Queued jobs run from their saved job object without rewriting the visible Case Name field. The progress bar is divided by total queued URLs, so each URL becomes one segment. A segment completes after the script reports that the URL capture finished successfully and GUI thumbnail/media information processing completed.

If the queue is active or contains pending/running jobs, pressing **Start Capture** adds the current capture to the queue instead of starting a separate direct capture. If the scheduler has available capacity and the domain rules allow it, the new job can start immediately.

### Case Browser and Verification

The Case Browser can open, browse, sort, filter, and review case folders from the selected Output Root. It supports:

- media and sidecar file cards
- folder tree navigation
- current-folder-only view
- icon scale options
- horizontal scrolling
- right-click actions for file cards
- FFmpeg-generated thumbnails stored in `.gui-cache\thumbnails`
- FFprobe-generated media details stored in `.gui-cache\metadata`
- SHA256 manifest verification

Case file verification runs only for a selected case folder or one of its subfolders. The Output Root itself cannot be verified. The GUI cache and manifests folders are excluded from SHA256 verification scope: `.gui-cache` contains regenerated display/cache data, and `manifests` contains verification records rather than captured evidence. Case summaries count manifest files even though manifests remain outside verification scope.

### App Update Checks

The update checker queries GitHub for the latest app release and opens the release page for manual download. It does not download, extract, replace, or run files.

yt-dlp updates are separate from normal capture runs and are controlled from the app's yt-dlp update workflow.

## Profiles and Settings

The app stores settings and profiles in a portable JSON settings file beside the app.

The **Default** profile is always loaded on startup and is used for normal persistent settings. Custom profiles can be created, loaded, saved, and deleted from the Profile menu.

App-level settings include Delete Cookies on Exit, Check VPN, Dark Mode, and Case Browser preferences such as filter, sort, icon scale, and current-folder-only view. These are not profile-specific. Use Cookies File is profile-specific.

The settings file uses a schema version. When an older settings file is loaded, recognized values are imported, new recognized values are created with defaults, and unrecognized values are preserved under `unrecognized_settings`.

Settings saves are skipped when the JSON payload has not changed to avoid unnecessary output log noise. Resetting defaults only resets the Default profile; deleting the settings file requires confirmation because it removes saved profiles and resets the current GUI settings.

## Cookies Handling

The app can optionally reference a cookies file and includes helper options to export, encrypt, decrypt, or delete the selected cookies file on exit.

Cookies files should be treated as sensitive because a raw cookies file may function like a browser session. The app does not display cookie contents in the GUI.

The Cookies File row includes a **Use** checkbox. When disabled, the cookies path field and Browse button are disabled, the cookies file is not passed to the capture script, and preflight skips cookies file validation.

**Use Cookies File** is a profile-level setting. **Delete Cookies on Exit** is an app-level setting, not a profile setting. When Delete Cookies on Exit is enabled, the app attempts to delete the file currently shown in the Cookies File field when the GUI closes.

## Limitations

The app depends on both `gui.py` and `script.ps1`, along with locally staged binaries. If those files or tools are missing, blocked, outdated, unsigned, or not permitted by policy, the app may not function.

The preflight check confirms common prerequisites, including whether yt-dlp, FFmpeg, FFprobe, and Deno can execute in the current environment. It cannot guarantee that every target URL will be accessible or capturable.

The VPN check only confirms whether the selected adapter is up. It does not prove that traffic is routed through the VPN.

The Case Browser depends on FFmpeg for thumbnails and FFprobe for cached media details. If either tool is unavailable, fallback placeholders or unavailable media details are shown.

The app is only a workflow wrapper. It does not make authorization, policy, or legal decisions.

## Changelog

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
