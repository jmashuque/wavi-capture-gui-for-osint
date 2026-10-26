# <img src="gui-assets/wavi.png" width="36" height="36" alt="WAVI logo" align="absmiddle"> WAVI Capture GUI for OSINT

A portable Windows GUI for running webpage, audio, video, and gallery/profile capture workflows for OSINT-style collection and review using `yt-dlp`, `gallery-dl`, Deno, installed Chromium browsers, and companion scripts.

## Table of Contents

- [Overview](#overview)
- [Screenshots](#screenshots)
- [Intended Users](#intended-users)
- [What the App Does Not Do](#what-the-app-does-not-do)
- [Warnings](#warnings)
- [Required Components](#required-components)
- [Basic Usage](#basic-usage)
  - [Setup and Staging](#setup-and-staging)
  - [Start a Capture](#start-a-capture)
  - [Capture Audio or Video](#capture-audio-or-video)
  - [Capture a Gallery or Profile](#capture-a-gallery-or-profile)
  - [Capture a Webpage](#capture-a-webpage)
  - [Send a Firefox Tab to WAVI](#send-a-firefox-tab-to-wavi)
  - [Use the Job Queue](#use-the-job-queue)
  - [Preview Audio/Video Links](#preview-audiovideo-links)
  - [Generate a Report](#generate-a-report)
  - [Review a Case](#review-a-case)
- [Advanced Usage](#advanced-usage)
  - [Output Log](#output-log)
  - [URL List Tools](#url-list-tools)
  - [Template Tags](#template-tags)
  - [Audio/Video Capture](#audiovideo-capture)
  - [Audio/Video Preview](#audiovideo-preview)
  - [Gallery/Profile Capture](#galleryprofile-capture)
  - [Webpage Capture](#webpage-capture)
  - [Browser Integration](#browser-integration)
  - [Job Queue, Persistence, and Recovery](#job-queue-persistence-and-recovery)
  - [Queue Building and Case Folder Safety](#queue-building-and-case-folder-safety)
  - [Case Browser](#case-browser)
  - [Case Manifest Verification](#case-manifest-verification)
  - [Domain Presets, Proxy, VPN, and Archives](#domain-presets-proxy-vpn-and-archives)
  - [Update Checks](#update-checks)
- [Profiles and Settings](#profiles-and-settings)
- [Cookies Handling](#cookies-handling)
- [Limitations](#limitations)
- [Changelog](#changelog)

## Overview

`Webpage/Audio/Video/Image Capture GUI for OSINT` (`WAVI Capture GUI for OSINT`) is a local, portable interface for repeatable capture work in managed environments.

The app has eight main tabs:

- **Audio/Video Capture** for `yt-dlp` captures.
- **Gallery/Profile Capture** for `gallery-dl` captures.
- **Webpage Capture** for Chromium browser-based captures using Deno.
- **Job Queue** for staged, concurrent, and recoverable jobs.
- **Output Log** for combined, WAVI, engine-specific, and report output.
- **Audio/Video Preview** for metadata, thumbnails, playlist/context review, and queueing from preview results.
- **Generate Reports** for PDF reports from original case captures.
- **Case Browser** for local review, thumbnails, metadata, and hash verification.

Across the capture tabs, WAVI provides preflight checks, case and filename templates, optional capture controls, case summaries, local manifests, and queue/recovery support without requiring users to rebuild the underlying command lines manually.

The app does not bundle capture tools or make authorization decisions. Tools, credentials, network paths, cookies, proxy/VPN use, and capture scope should be approved separately through normal organizational processes.

## Screenshots

<p align="center">
  <img src="/screenshots/main1.png" alt="audio/video capture tab" width="31%">
  <img src="/screenshots/main2.png" alt="gallery/profile capture tab" width="31%">
  <img src="/screenshots/main3.png" alt="webpage capture tab" width="31%">
</p>

<p align="center">
  <img src="/screenshots/main4.png" alt="job queue tab" width="31%">
  <img src="/screenshots/main5.png" alt="output log tab" width="31%">
  <img src="/screenshots/main6.png" alt="audio/video preview tab" width="31%">
</p>

<p align="center">
  <img src="/screenshots/main7.png" alt="generate reports tab" width="31%">
  <img src="/screenshots/main8.png" alt="case browser tab" width="31%">
</p>

## Intended Users

This app is intended for investigators, analysts, and support staff who need a consistent way to collect approved audio/video, image, gallery, rendered webpage, or metadata output without manually rebuilding command-line arguments for every case.

This app is for authorized OSINT capture workflows, not general-purpose downloading, browsing, archiving, or personal media collection.


## What the App Does Not Do

The app does not:

- include or auto-install `yt-dlp`, `gallery-dl`, FFmpeg/FFprobe, Deno, Chromium browsers, Python, or PowerShell
- bypass endpoint security, firewalls, website controls, access restrictions, login requirements, bot challenges, or rate limits
- decide whether a capture is legal, approved, proportionate, or in scope
- collect passwords, automate sign-ins, automatically extract browser cookies during capture, solve interactive challenges, or perform unrestricted page interaction
- analyze evidence, identify people, assess authenticity, or determine evidentiary value
- upload, sync, or retain cases outside the selected local output paths
- transfer Firefox session cookies through the browser extension

## Warnings

### Item Navigation and Capture

Item Navigation and Capture sends real clicks to third-party pages. WAVI blocks forms, cross-origin links, disabled controls, known social/account actions, and ambiguous candidates, and it revalidates each target immediately before clicking. These safeguards reduce risk but cannot guarantee that every authenticated or highly dynamic site is free from unintended state-changing interaction.

Use a minimally privileged, organization-approved investigative account, begin with a low item limit, review platform-specific blacklist rules, and inspect the interactive report before larger authenticated captures.

### Investigative Accounts and Cookies

For authenticated OSINT captures, use only organization-approved investigative or "sock puppet" accounts and cookies created for those accounts. Never use personal accounts, personal browser profiles, or cookies from personal sessions.

Treat cookies files as sensitive operational data and handle them according to organizational policy.

## Required Components

Place the GUI, scripts, and approved tools in a local portable folder unless your organization uses a different staged path.

Required files/tools:

- `gui.py`
- `script-ytdlp.ps1`
- `script-gallerydl.ps1`
- `script-webcapture.ps1`
- `script-webcapture.ts`
- `interactive-whitelist.txt`
- `interactive-blacklist.txt`
- `gui-assets\wavi.png`
- `gui-assets\wavi.ico`
- `yt-dlp.exe`
- `gallery-dl.exe`
- `ffmpeg.exe`
- `ffprobe.exe`
- `deno.exe`
- Python 3
- Windows PowerShell
- A compatible Chromium-family browser installed locally for Webpage Capture, such as Microsoft Edge, Google Chrome, Brave, Vivaldi, Chromium, or Opera

Keep `interactive-whitelist.txt` and `interactive-blacklist.txt` beside `gui.py`. They are read only when **Item Navigation and Capture** is enabled, but they should remain in every staged app folder so the feature is available and its default safety rules are not lost. Keep the `gui-assets` folder beside `gui.py`; it contains `wavi.png` and `wavi.ico`, which the GUI window and About dialog use for WAVI branding.

`deno.exe` should be beside `yt-dlp.exe`. `gallery-dl.exe` can be beside the app or selected manually in the Gallery/Profile Capture tab. Webpage Capture uses the selected installed Chromium-family browser executable; the browser itself is not bundled.

The optional **WAVI Capture Helper** browser extension requires Firefox 142 or later. Firefox is not required for normal WAVI capture workflows.

Recommended source pages:

- WAVI Capture GUI releases: <https://github.com/jmashuque/wavi-capture-gui-for-osint/releases/latest>
- Python: <https://apps.microsoft.com/detail/9PNRBTZXMB4Z>
- yt-dlp releases: <https://github.com/yt-dlp/yt-dlp/releases>
- yt-dlp nightly builds: <https://github.com/yt-dlp/yt-dlp-nightly-builds/releases>
- gallery-dl releases: <https://codeberg.org/mikf/gallery-dl/releases>
- Deno releases: <https://github.com/denoland/deno/releases>
- FFmpeg Windows builds by Gyan.dev: <https://www.gyan.dev/ffmpeg/builds/>

Use approved releases for your environment. For FFmpeg, the Gyan.dev release essentials build is usually enough because it includes both `ffmpeg.exe` and `ffprobe.exe`.

For Deno, download `deno-x86_64-pc-windows-msvc.zip` by pressing **Show all assets** below the release.

## Basic Usage

This section covers the normal first-run workflow. Start with the defaults, run **Preflight Check**, and change advanced options only when the capture requires them.

### Setup and Staging

Do this once before the first capture, or whenever you prepare a fresh copy of WAVI.

1. Create a local folder, for example `C:\WAVI-Capture-GUI`.
2. Download and extract the latest WAVI release. If Windows shows an **Unblock** checkbox in the ZIP file's **Properties**, select it before extracting. Do not run WAVI from inside the ZIP.
3. Install Python 3 through an organization-approved source.
4. Stage the scripts, `gui-assets` folder, safety-list files, and approved capture tools listed under [Required Components](#required-components). Keep their relative folder structure intact unless you intentionally change paths in WAVI.
5. Keep the app folder and active case output on a local drive during capture. Avoid email attachments, browser previews, synced folders, and network shares for active work.

Webpage Capture also requires a compatible installed Chromium-family browser such as Microsoft Edge, Google Chrome, Brave, Vivaldi, Chromium, or Opera.

### Start a Capture

1. Open the WAVI folder and start `gui.py`.
   - Double-click it when `.py` files already open with Python.
   - Otherwise, click the File Explorer address bar, type `powershell`, press **Enter**, and run:

     ```powershell
     py .\gui.py
     ```

   - If `py` is unavailable, try `python .\gui.py`. If neither works, Python is not installed or is not available to your user session.

2. Select the appropriate tab:
   - **Audio/Video Capture** for video, audio, channels, playlists, and supported media posts.
   - **Gallery/Profile Capture** primarily for supported profiles and timelines, plus individual posts, galleries, albums, and other media collections handled by `gallery-dl`.
   - **Webpage Capture** for a rendered screenshot and optional PDF of an approved webpage.

3. Check the main fields:
   - **Output Root** is the parent folder where case folders will be created. It must be a writable folder; WAVI creates it when possible and checks write access before a capture is staged or started.
   - **Case Name** becomes the case subfolder. WAVI rejects resolved names that Windows reserves for devices, or that end in a space or period.
   - **Filename Template** controls names and subfolders inside the case. Common and engine-specific placeholders are documented under [Template Tags](#template-tags).
   - The **URL box** accepts one URL per line.
   - **Input File(s)** accepts text files containing one URL per line.

4. Paste the approved URL or URLs. The URL box takes priority over Input File(s); clear the URL box when you intend to use selected files.

   Every capture tab uses the same single-column URL toolbar:

   - **Load**, **Append**, **Save As**, **Clear**, and **Copy** manage the URL text. **Save As** opens a file picker, and the file you save becomes the selected Input File for that capture tab.
   - **Undo** and **Redo** restore or reapply URL-box edits and toolbar operations. The same actions are available with **Ctrl+Z**, **Ctrl+Y**, and **Ctrl+Shift+Z**.
   - **Advanced ▼** provides URL cleanup, grouping, statistics, normalization, duplicate removal, and validation tools. Some of these operations change the URL text, so preserve the original list first when that matters. See [URL List Tools](#url-list-tools) for the details.
   - **Show ▼** switches the URL box between **All**, **Failed**, and **Succeeded** URLs from the current Output Root. The menu marks the active view.

5. Run **Preflight Check**. Fix any failed item before continuing.

6. Click **Start Capture** and leave WAVI open until the run finishes.

7. Monitor the run in **Output Log**. See [Output Log](#output-log) for filtering, follow mode, copying, saving, and display clearing.

8. Open the case folder and confirm the expected files, logs, and manifest are present. **Copy Case Summary** produces a plain-text record of the completed case, including engine-specific settings and results. Its **▼** menu copies or exports captured and failed URLs for the current engine and case; failed-URL actions can remain available after an unsuccessful run. For large lists, use **Export** instead of **Copy**. Completed queue-job summaries can also be copied from the Job Queue.

### Capture Audio or Video

For a first capture, keep the defaults unless the source is a playlist or you specifically need audio-only, metadata-only, or a different format.

1. Open **Audio/Video Capture** and confirm the paths to the PowerShell script, `yt-dlp.exe`, and the FFmpeg folder.
2. Choose an Output Root and case name, then paste the approved URL.
3. For one video or media post, keep **Single item only**. For an approved playlist, channel, or multi-item page, open **Capture Options** and select **Include playlist / multi-item source**.
4. Run **Preflight Check**, then start the capture.
5. Review the media under the case `media` folder, the run log under `logs`, and the SHA-256 manifest under `manifests`.

Use **Audio/Video Preview** before capture when you need to inspect a playlist, title, thumbnail, or available metadata. See [Advanced Audio/Video Capture](#audiovideo-capture) for format strategies, metadata files, embeds, filtering, pacing, and archive controls.

### Capture a Gallery or Profile

Gallery/Profile Capture is primarily intended for supported profile and timeline collection through `gallery-dl`, while also handling individual posts, galleries, albums, and other supported media collections. A profile URL can expand to many media items, including images or video where the extractor supports them. When the size is uncertain, start with a small item limit or range.

1. Open **Gallery/Profile Capture** and confirm the paths to the PowerShell script and `gallery-dl.exe`.
2. Choose an Output Root and case name, then paste the approved profile, gallery, post, or other supported media URL.
3. For a profile capture, open **Capture Options** and select the applicable **Scope / include Keywords** such as `posts`, `stories`, `reels`, or `highlights`. Site support varies by extractor.
4. For a large or unfamiliar profile or collection, enable **Limit max items** and begin with a small number such as 10 or 25.
5. Run **Preflight Check**, then start the capture.
6. Review the captured media and metadata files under `media`, the gallery-dl log under `logs`, and the manifest under `manifests`.

See [Advanced Gallery/Profile Capture](#galleryprofile-capture) for capture modes, profile scope, metadata-only runs, item ranges, archive modes, pacing, retries, timeouts, and cookies. App-level concurrency is configured under **Settings > Concurrent Captures...**.

### Capture a Webpage

The default Webpage workflow creates a full-page PNG using a new isolated browser profile. It does not use the normal signed-in browser profile.

1. Open **Webpage Capture** and confirm **Tools > Deno Path** and the **Browser Path**. Use **Refresh** or **Browse** if the browser path is blank.
2. Choose an Output Root and case name, then paste an approved `http://` or `https://` URL.
3. Keep the default Capture Options for the first attempt. Open **PDF Options** only when a PDF is also required.
4. Run **Preflight Check**. This confirms that Deno and the selected browser can start correctly.
5. Start the capture and review the image, webpage capture record (`.webcapture.json`), run log, and SHA-256 manifest. Review any **Complete with warnings**, **Partial**, or **Failed** classification before treating the capture as complete.

**Item Navigation and Capture** remains disabled by default; read the [Item Navigation and Capture warning](#item-navigation-and-capture) before enabling it. See [Advanced Webpage Capture](#webpage-capture) for readiness, scrolling, browser environment, cookies, interactive capture, evidence outputs, PDFs, and long-page controls.

### Send a Firefox Tab to WAVI

The optional **WAVI Capture Helper** extension can send the active Firefox tab to a specific WAVI capture engine as a new **Pending** Job Queue entry. It requires Firefox 142 or later. Browser integration is disabled by default and does not start captures automatically.

Install the extension once before pairing it with WAVI:

1. Open the latest WAVI release at <https://github.com/jmashuque/wavi-capture-gui-for-osint/releases/latest>.
2. Under **Assets**, download the Mozilla-signed `wavi-capture-firefox-v<version>.xpi` file. Do not use GitHub's **Source code (zip)** as the browser extension.
3. In Firefox, open **Add-ons and themes** (`about:addons`). Select the gear button, choose **Install Add-on From File...**, select the downloaded `.xpi`, review Firefox's permission and data-use notice, and confirm the installation.
4. Optionally pin **WAVI Capture Helper** to the Firefox toolbar for easier access.

Pair the extension with WAVI:

5. In WAVI, open **Tools > Browser Integration...**.
6. Enable **Browser integration API**, confirm the listener port, and click **Apply Listener Settings**. The default port is `17654`.
7. Click **Copy Token**.
8. Open **WAVI Capture Helper**, select **Manage**, make sure its listener port matches WAVI, paste the pairing token, and click **Save**.

Send a tab to WAVI:

9. Open an approved `http://` or `https://` page in Firefox, open **WAVI Capture Helper**, and choose **Audio / Video**, **Gallery / Profile**, or **Webpage Capture**.
10. Confirm the returned WAVI Job ID, then review the new **Pending** job in WAVI before starting it.

If WAVI needs input for a same-domain collision or another prompt, its taskbar button can flash for attention. The browser request can continue if the extension popup closes while you switch to WAVI. See [Browser Integration](#browser-integration) for the local-only security model, token management, data handling, and troubleshooting.

### Use the Job Queue

All captures use the Job Queue, including **Start Capture** and Firefox submissions. The source column distinguishes Direct, Queue, and Extension jobs.

1. Use **Start Capture** to request execution, or **Start Capture ▼ > Add Job to Queue** to stage a Pending job without running it. Queue-only actions leave the capture tab selected.
2. Use **Start** for never-executed jobs and **Resume** for eligible previously executed jobs. These buttons act on the selected row together with checked rows, without running the same job twice.
3. A job waiting for permission to run is **Pending**. A job authorised to run when its blockers clear is **Queued**. Pending jobs never start automatically.
4. Monitor overall active/queued counts and URL progress at the bottom of Job Queue. Display filtering does not change execution order or admission rules.

See [Job Queue, Persistence, and Recovery](#job-queue-persistence-and-recovery) for actions, recovery, ordering and concurrency.

### Preview Audio/Video Links

Use **Audio/Video Preview** when you want to inspect media metadata or playlist/context entries before capture.

1. Add URLs to the preview list.
2. Use **Preview All** or check the rows you want and use **Preview Checked**.
3. Review metadata, thumbnails, and playlist/context items.
4. Start or queue the rows you want to capture.

Preview is best-effort. It can be incomplete or slow depending on the site, cookies, network path, and installed `yt-dlp` build. See [Audio/Video Preview](#audiovideo-preview) for preview modes, thumbnail behaviour, playlist scanning, caching, export, and Start/Queue actions.

### Generate a Report

1. Open **Generate Reports**, select **Gallery/Profile** or **Webpage Navigation**, and choose a case from the configured source Output Root.
2. Choose the sort field/order, one or two captures per page, page formatting and metadata. Fields unavailable for the source are disabled.
3. Optionally enable **Title Page**. Use **Insert Tag** for metadata and `<Left>` / `<Right>` for alignment; untagged text is centred. Title content is vertically centred by default. Title-page headers and numbers are independent of capture-page headers and numbers.
4. Select **Generate Report**. Reports use original capture images, not stamped derivatives, and do not enlarge images beyond their original size. Files are saved in the case's `reports` folder using the case name and local generation datetime.
5. Use **Open Last Report** to open the last successful output, or **View Report Log** for diagnostics. Changing the selected case does not change the last-report target.

Each report includes the captures from one selected case.

### Review a Case

Use **Case Browser** to review local case output.

- Case Browser reviews cases under the current capture Output Root.
- Filter or sort case files.
- Open case folders or individual files.
- Verify the SHA-256 manifests generated by captures.

See [Case Browser](#case-browser) for view modes, large-folder behaviour, search/filter controls, media details, and file actions.

## Advanced Usage

This section is for technical users who are comfortable with capture-tool behaviour, site behaviour, rate limits, browser state, and organizational handling requirements. It explains option tradeoffs and recovery/output behaviour rather than repeating the first-run steps above.

### Output Log

**Save Redacted...**, beside **Save Visible...**, exports a filtered copy of the selected output display. It removes known identifying case/user/capture values and common URLs, domains, paths, filenames, addresses, credentials, IDs and absolute timestamps. Commands and sensitive labelled payloads may be removed in full, while useful status and error diagnostics are retained where possible. The visible display and original logs are unchanged. Automatic filtering cannot recognise every sensitive detail in free-form text; review the exported copy before sharing.


The **Output Log** tab provides **All**, **WAVI**, **Audio/Video**, **Gallery/Profile**, **Webpage**, and **Reports** tabs. **All** is the initial default and combines output in recorded order. **WAVI** separates application activity such as startup, settings, cache operations, proxy/VPN and browser integration from capture-engine logs. **Highlight warnings/errors**, beside **Follow output**, is enabled by default and also colours recognised multiline diagnostic continuations. Copied and saved logs remain plain text.

- **Follow output** scrolls to new messages. Disable it while reviewing earlier output.
- **Copy Visible** uses WAVI's shared clipboard safeguards and refuses oversized content without truncating or replacing the current clipboard.
- **Save Visible** writes the complete selected view as UTF-8 text without the clipboard limit.
- **Clear Display** clears only the selected view. It does not delete timestamped case logs, captured artifacts, URL histories, archives, or queue state. Clearing **All** requires confirmation.

### URL List Tools

Each capture tab uses the same URL-box tools. **Load** replaces the current URL text from a file, **Append** adds a file without clearing the current list, and **Save As** writes the current URL box to a text file and selects that file as the tab's Input File. **Undo** and **Redo** cover both typing and toolbar operations.

**Advanced ▼** provides operations that are useful when preparing larger URL sets:

- **Strip Parameter-like Tags** removes trailing parameter-like `&name=value` segments. Use it only when those suffixes are known to be unwanted because removing them can change the requested resource.
- **Group by Domain** reorganizes the current list into domain groups without creating queue jobs. Use **Add Jobs to Queue by Domain** when separate queue jobs are required instead.
- **URL Statistics** summarizes the current URL set without changing it.
- **Normalize URLs** standardizes supported URL text for list handling; review the result when exact submitted syntax matters.
- **Remove Duplicates** keeps one copy of repeated URLs.
- **Validate URLs** identifies entries that WAVI does not recognize as valid submitted URLs.

**Show ▼** switches the box between all URLs and captured/failed URL history for the current Output Root. Those views are GUI history aids; they are separate from yt-dlp/gallery-dl download archives and Webpage universal archive records.

### Template Tags

WAVI uses the same capture-time tags across the capture engines wherever they apply:

- `%date%` — local capture date as `YYYY-MM-DD`
- `%time%` — local capture time as `HHMMSS`
- `%datetime%` — local capture date/time as `YYYY-MM-DD_HHMMSS`
- `%utcdatetime%` — UTC capture date/time as `YYYYMMDD_HHMMSSZ`
- `%engine%` — `audio-video`, `image`, or `webpage`

Filename templates also use `%domain%` for the source domain when WAVI can determine one. `%case%`, `%id%`, `%title%`, and `%ext%` keep the same purpose wherever the engine exposes those values. For Gallery/Profile Capture, gallery-dl keyword names differ substantially between extractors, so WAVI resolves the generic `%id%`, `%title%`, `%author%`, `%username%`, `%user%`, `%filename%`, and `%url%` tags through ordered equivalent-field fallbacks rather than emitting `None` simply because one generic key is absent.

**Source publication datetime tags** are separate from capture timestamps:

| Where | Tag | Meaning |
|---|---|---|
| Audio/Video filename | `%upload_datetime%` | Source availability/upload datetime where supplied, otherwise upload date only. |
| Audio/Video filename | `%release_datetime%` | Source release datetime where supplied, otherwise release date only. |
| Gallery/Profile filename and evidence stamp | `%item_datetime%` | The source item's date or datetime from `date`, `post_date`, `created` or `created_at`. |

**Datetime may return just a date or both a date and time**, depending on the source metadata. It does not imply that a time or timezone is known. Audio/Video full timestamps use UTC (`YYYY-MM-DD_HHMMSSZ`); date-only values use `YYYY-MM-DD`. Gallery/Profile filename values retain the extractor's formatting and normal filename sanitisation. Evidence stamps preserve available date/time precision and supplied offsets; timestamps without a timezone are not labelled UTC. Numeric Unix timestamps in evidence metadata are represented in UTC. Missing publication metadata never falls back to capture time or filesystem timestamps: filename tags use an unknown placeholder, and stamps show **Item datetime unavailable**.

Use **Insert Tag** to choose the tags supported by each field.

### Audio/Video Capture

Audio/Video Capture uses `script-ytdlp.ps1`, `yt-dlp.exe`, Deno where required by supported extractors, and FFmpeg/FFprobe. Output is written beneath `<Output Root>\<Case Name>\media` using the selected template. Capture runs use `--ignore-config`, so yt-dlp settings come from the WAVI job rather than external yt-dlp configuration files.

**Capture mode**

| Mode | What it does | Typical use |
|---|---|---|
| **Download media and selected sidecars** | Downloads media and writes the selected separate metadata files. | Recommended general-purpose capture. |
| **Media + embedded metadata; ignore sidecars** | Downloads media and applies selected embed options without retaining the normal sidecar set. | A compact playback copy when separate records are not required. |
| **Media only; ignore metadata options** | Downloads only the media output. | Minimal output when metadata artifacts are deliberately unnecessary. |
| **Metadata/artifacts only; do not download media** | Runs extraction and writes selected metadata artifacts without downloading the media stream. | Source assessment, scoping, or metadata collection. |

Separate sidecars are usually easier to inspect, hash, compare, and preserve than metadata embedded inside a media container.

**Source scope and playlist controls**

- **Single item only** is the safe default and prevents a submitted page from expanding into an entire playlist or channel.
- **Include playlist / multi-item source** allows playlist, channel, and other multi-item extraction.
- **Items** accepts yt-dlp indexes and ranges such as `1:10,30,35:40`.
- **Order** can be normal, reverse, or random.
- **Max items** caps the number of playlist entries considered.
- **Stop when archived item is found** is useful for chronologically ordered recurring sources when an older archived item means the remaining entries were probably captured previously.
- **Skip after failed items** stops working through a problematic playlist after the selected number of item failures.

Playlist controls are passed only when multi-item scope is enabled. Use **Audio/Video Preview** to inspect and select playlist/context entries when the source structure is uncertain.

**Format strategy**

| Strategy | Behaviour |
|---|---|
| `best` | Uses yt-dlp's best available media selection, optionally limited by maximum resolution. |
| `prefer_mp4` | Prefers MP4 video with M4A audio and merges to MP4, but retains fallback choices when MP4-specific formats are unavailable. |
| `strict_mp4` | Requires MP4-compatible video/audio choices. This is more predictable for compatibility but can fail on sources without a suitable MP4 combination. |
| `audio_only` | Selects the best audio and converts/extracts it to M4A. |
| `low_bandwidth` | Selects a low-quality/low-bandwidth format, still respecting the selected maximum resolution where applicable. |

**Max resolution** limits video height to Best, 2160p, 1440p, 1080p, 720p, or 480p. It does not improve a lower-resolution source. **Generate Windows `.url` shortcuts** creates source-link shortcuts when that additional record is useful.

**Metadata Options**

Sidecar choices include:

- metadata/info JSON
- source-link files
- description text
- thumbnails
- creator-provided subtitles
- automatic subtitles
- comments when supported
- playlist metadata for multi-item captures

Embed choices include metadata, cover art, subtitles, chapters, and info JSON for compatible media containers. Embedding depends on the selected format, available source metadata, and FFmpeg or mutagen support. Some embeds can modify or remux the final media file, so retain separate sidecars when independent preservation is preferred.

**Archive modes**

- **Use case download archive** records completed yt-dlp item identifiers in the case and skips matching items on later runs.
- **Ignore archive for this run** does not use the case archive for duplicate avoidance.
- **Force re-capture** deliberately requests another copy even when the item is already archived.


**Dates, title filters, and impersonation**

- **Date after** and **Date before** restrict supported sources by upload date.
- **Only capture titles matching** and **Reject titles matching** accept comma-separated keywords and build safe case-insensitive title filters.
- **Impersonate Target** is populated from the usable targets reported by the selected `yt-dlp.exe`. Use **Check Targets** before selecting impersonation because availability depends on the installed yt-dlp build and local dependencies.
- After a successful check, **Any available** lets yt-dlp choose any usable impersonation target, while entries such as **Chrome (automatic)** let yt-dlp choose among the available fingerprints for that client family. Enable **Show specific targets** and check again to expose exact client/OS fingerprints such as `chrome-136:macos-15`. The OS in a specific target is the environment being impersonated, not the operating system running WAVI.
- Impersonation does not bypass authentication or authorization controls and can affect download speed or stability.

**Failure handling and concurrency**

- **Continue after failed URL** keeps processing later submitted URLs after a failed yt-dlp invocation.
- **Stop on first failed URL** ends the run after the first failed URL.
- **Settings > Concurrent Captures...** controls app-level job limits, separately for each engine, up to 8. Domain, case-folder and universal-archive safeguards still apply.
- **Concurrent Fragments** controls parallel fragment downloads inside one yt-dlp job, from 1 to 8. This is different from queue concurrency and can increase load on the source and local network.

**Pacing and retry behaviour**

| Pacing preset | Between submitted URLs | yt-dlp request sleep |
|---|---:|---:|
| **None** | 0 to 5 seconds | none |
| **Fast** | 15 to 30 seconds | 2 seconds |
| **Normal** | 30 to 60 seconds | 5 seconds |
| **Cautious** | 60 to 120 seconds | 10 seconds |

| Retry profile | Main and fragment retries | Retry sleep window |
|---|---:|---|
| **Light** | 3 | exponential, 5 to 60 seconds |
| **Normal** | 5 | exponential, 10 to 120 seconds |
| **Aggressive** | 10 | exponential, 10 to 300 seconds |
| **Custom** | user-defined | user-defined maximum |

**Only between URLs sharing a domain** restricts the between-URL gap using the same domain grouping as Job Queue. It is off by default. Request and retry sleeps still apply within each submitted URL.

The retry fields display the selected profile's values. Built-in profiles show **Tool default** for socket timeout. Switching back to Custom restores its saved editable values. **Custom** exposes separate main and fragment retry counts, a socket timeout, and the maximum exponential retry-sleep time. Custom accepts 0 to 100 retries, 0 to 100 fragment retries, a socket timeout from 1 to 900 seconds, and a retry-sleep maximum from 1 to 3600 seconds. The socket timeout is passed only for the Custom profile; choosing Light, Normal, or Aggressive does not add a new timeout to those presets.

Additional controls:

- **Download Speed Limit** caps transfer speed for the job.
- **Throttle Detection** tells yt-dlp to restart a transfer when speed stays below the selected threshold.
- **HTTP Chunk Size** requests ranged/chunked HTTP transfers and should normally remain off unless a source or network path benefits from it.
- Retaining partial fragments can help troubleshooting or manual recovery but also leaves incomplete files that must not be mistaken for completed captures.

Increasing retries, concurrency, or fragments can worsen rate limiting. Start with the defaults and change one factor at a time.

**Filename templates**

The default Audio/Video filename template is:

```text
%datetime%_%domain%_%id%_%title%.%ext%
```

The default combines the common WAVI capture timestamp/domain tags with yt-dlp content ID, title, and extension values. Source-specific yt-dlp metadata tags such as `%upload_datetime%`, `%release_datetime%`, `%uploader%`, `%extractor%`, and `%playlist_index%` remain available when useful.

**Output records**

- **Case Browser cache** controls whether WAVI prepares hidden thumbnail/media-detail cache files after each URL, after the run, or not at all.
- **File manifest: Full** covers the eligible case evidence set; **This run** limits manifest generation to files attributed to the current run. See [Case Manifest Verification](#case-manifest-verification) for manifest scope, relative paths, exclusions, and verification.

Typical output:

```text
<case>\
  media\
    <extractor or template folders>\
      <captured media and selected sidecars>
  logs\
    yt-dlp-run_<timestamp>.log
  manifests\
    sha256-manifest_<timestamp>.csv
  download-archive.txt
```

### Audio/Video Preview

Audio/Video Preview is a pre-capture inspection workspace; it does not download the final media unless a **Start** or **Queue** action is selected. The top-level **Preview** checkmarks control which submitted URLs are queried for metadata, while **Include** checkmarks control the rows used by **Start Included** and **Queue Included**. Playlist/context rows have their own Include controls.

**Preview Options** controls how aggressively WAVI gathers information:

- **Preview pacing** inserts the selected base delay plus random jitter between metadata requests.
- **Thumbnails: Off** avoids thumbnail fetches. **Fast** uses the thumbnail URL already returned in metadata. **Reliable** can fall back to a yt-dlp thumbnail request when the direct metadata thumbnail is unavailable or fails.
- **Rate limit thumbnails** adds cooldowns between thumbnail requests to reduce burst traffic.
- **Cache mode: Temporary** uses app-owned temporary preview files. **Reuse cached thumbnails** keeps reusable thumbnail cache entries for later previews until the preview cache is cleared.
- **Playlist mode: Fast playlist scan** favours quick playlist structure discovery. **Deep metadata first N** performs deeper metadata work for the first **Max items** playlist entries.
- **Timeout sec** bounds an individual preview metadata operation.
- **Clear Audio/Video Preview Cache** removes the app-owned preview thumbnail cache; it does not delete captured case media.

The selected URL context shows thumbnail and metadata details and, when a multi-item source exposes entries, a playlist/context item table. **Start All**, **Start Included**, **Queue All**, and **Queue Included** hand the chosen URLs back to the normal capture/queue workflow. Included playlist items can also be copied, loaded into the Audio/Video URL box, appended to it, or started/queued directly. **Export JSON** exports the preview records; highlighted URL/item JSON can also be exported from the context menus.

For very large input lists, Preview can show a guard instead of immediately building every row. The guard can preview a small sample, queue the full list without previewing it, or explicitly load the full preview list. This protects GUI responsiveness and avoids unnecessary metadata traffic.

### Gallery/Profile Capture

Gallery/Profile Capture uses `script-gallerydl.ps1` and `gallery-dl.exe`. Its primary purpose is supported profile and timeline capture, where one submitted profile URL can expand to many media items. It also supports individual posts, galleries, albums, and other media collections handled by the active gallery-dl extractor. Captured media can include images, video, and other supported files. The filename template is relative to the case `media` folder; case tags resolve when the job is created, while gallery-dl fields such as category, subcategory, ID, filename, and extension resolve per item. Capture runs use `--config-ignore`, so gallery-dl settings come from the WAVI job rather than external gallery-dl configuration files.

**Capture mode**

- **Media + selected metadata** downloads supported media and writes the enabled metadata sidecars.
- **Media only; ignore metadata options** downloads supported media without the metadata JSON, profile/gallery info JSON, or tags sidecars.
- **Metadata/artifacts only; do not download media** runs gallery-dl extraction and the selected metadata postprocessors while disabling media download.

**Metadata sidecars**

- **Per-item metadata JSON** records metadata associated with individual extracted media items where the extractor supplies it.
- **Profile/gallery info JSON** records broader profile, gallery, or source information where supported.
- **Tags text files** writes available tags in a simple text form.

Sidecar availability and contents depend on the site and its gallery-dl extractor. A checked option does not guarantee that every source provides that data.

**HTTP 429 (Too Many Requests):** WAVI explicitly enables gallery-dl HTTP media-download retries. Before a retry, Fast uses a 60-second delay, Normal uses 120 seconds and Cautious uses 300 seconds. The selected retry count limits attempts per request. This is a delay for the affected downloader, not a pause of all WAVI activity: separate concurrent captures can continue, and gallery-dl may move on after retries are exhausted. Site-specific extraction handling may also differ. The capture log records the configured policy.

**Evidence stamping**

Evidence stamping is available under **Stamping Options** and is off by default. **Enable evidence stamping for newly captured static images** leaves the downloaded original untouched and creates a separate stamped derivative under `derived\evidence`. Stamped derivatives use **lossless PNG by default**, regardless of the source image format. Enable **Match evidence source format** when the derivative should retain the original image format instead.

The **Stamped text template** box controls the text rendered in the black footer beneath each supported image. **Insert Tag** adds WAVI placeholders at the cursor. The default template is:

```text
%url%
%utcdatetime%
```

To align text on the same row, use:

```text
<Left>%url%</Left><Right>%utcdatetime%</Right>
<Left>%filename%</Left><Right>%case%</Right>
```

Paired sections use independently sized columns separated by a gap. Each side wraps independently and the next row starts below both columns. A line with only one section uses the full width with that alignment; plain-text lines are centred across the full width. Keep each section's opening and closing tags on the same template line. Do not nest sections or repeat a side on one line. **Insert Tag** includes alignment helpers.

Available stamp tags are `%url%`, `%domain%`, `%source_count%`, `%item_datetime%`, `%date%`, `%time%`, `%datetime%`, `%utcdatetime%`, `%case%`, `%engine%`, `%version%`, `%filename%`, `%ext%`, `%original%`, and `%sha256%`. `%url%` resolves separately for each captured file: its item/post page URL where the extractor supplies one, otherwise its direct media URL. `%domain%` follows that resolved URL. Supported metadata fields are `post_url`, `webpage_url`, `permalink`, `canonical_url` and `page_url`; Twitter post and Pixiv artwork links can also be derived from their item IDs. Missing or unverified metadata produces **Item URL unavailable**, never the submitted gallery/profile URL. This applies equally to single-URL and batch captures. Long substituted values are wrapped in the footer rather than silently truncated. `%item_datetime%` uses the completed file's hash-verified metadata, retaining a date alone when no time is supplied. Its value, source field and date/datetime precision are recorded in the evidence sidecar. Missing, invalid or unverified publication metadata displays **Item datetime unavailable**. For example, use `<Left>Posted: %item_datetime%</Left><Right>Captured: %utcdatetime%</Right>` to keep publication and capture times distinct.

- Supported source-image formats are JPEG, PNG, WebP, BMP, and TIFF. Animated GIFs, video, and other media are not modified or converted by this option.
- By default, all supported stamped image derivatives are written as lossless PNG. This avoids an additional lossy JPEG generation when the captured source is JPEG.
- **Match evidence source format** retains the source format instead. JPEG derivatives are then re-encoded as high-quality JPEG, while PNG and WebP derivatives use lossless output settings.
- WAVI appends the black evidence footer below the image rather than covering original image pixels.
- **Left column width (%)** is a slider from 1–99, default 50. It divides paired `<Left>…</Left><Right>…</Right>` rows after subtracting outer padding and the gap: 25 gives 25% to the left and 75% to the right; 75 reverses that allocation. Text wraps at each boundary rather than being clipped. Plain lines and single-sided rows retain the full width. The setting is saved in profiles and queued jobs. Extreme splits may leave too little room for a character; shorten the text or move the slider towards 50 if a layout cannot fit.
- **Preferred footer height (% of source image height)** starts each footer at 1–100% of source height (default 10%, rounded up). WAVI chooses the largest fitting whole-pixel font and centres text vertically.
- **Prioritise stamp readability** is enabled by default. **Minimum font size (px)** defaults to 16 and accepts 8–72. When that font cannot fit, WAVI expands the footer. Narrow images may also receive a wider black canvas, with the source image centred above the footer at its original dimensions. The original file is untouched; the image content is not upscaled.
- With readability off, the percentage is fixed and a 6-pixel minimum applies. If text cannot fit, the derivative fails rather than clipping. Readability expansion is also bounded (32,768-pixel footer height and 100 million combined canvas pixels); shorten the template or reduce the minimum font size if that limit is reached. Settings persist in profiles and queued jobs.
- Each derivative has an adjacent `.evidence.json` provenance record containing the stamp template, resolved stamp text and rows, footer percentage, preferred and actual footer dimensions, readability/minimum-font settings, source dimensions, centring offset, left/right percentages and chosen font size, source and derivative formats, the selected format policy, the complete original and derivative paths, independent SHA-256 hashes, sizes, capture timestamp, and the submitted source URL list. The source section also identifies the per-item URL, whether it is an item page or direct media URL, the metadata field used, and whether the metadata hash matched.
- When stamping is enabled, WAVI records each completed file’s full path, source URL metadata and SHA-256 in a run-specific `logs/gallery-dl-evidence-sources_*.jsonl` file, even in media-only mode. The source mapping must match the file’s SHA-256 before being used. The adjacent configuration file and JSONL record are included in the case manifest. This adds one file-hashing pass during capture.
- WAVI verifies the original SHA-256 again after derivative generation. The derivative and provenance JSON are included in the case manifest independently from the original.
- Evidence stamping requires `ffmpeg.exe` and `ffprobe.exe` from the configured FFmpeg folder. The option is inactive for metadata-only captures because no media is downloaded.

Only images that are newly created or changed during the current Gallery/Profile run are candidates. Existing unchanged images already present in the case are not retroactively stamped. A stamping problem is logged as a warning and does not alter or delete the successfully captured original.

**Item limits and ranges**

- **Limit max items** converts the selected number into a range beginning at item 1.
- **Use item range** accepts gallery-dl range syntax such as `1-25`.
- When both are enabled and contain values, **item range takes precedence** over maximum items.

Use a small range for unfamiliar or very large profiles and collections. This reduces accidental over-collection and provides a manageable test of the filename template and metadata output.

**Scope / include keywords**

- **Scope / include keywords** lets a profile capture request the supported content categories that gallery-dl should include, using common terms such as `posts`, `stories`, `reels`, `highlights`, `avatar`, `background`, `timeline`, `profile`, `videos`, `images`, `albums`, `tagged`, `likes`, and `saved`.
- **Custom keywords** accepts additional comma-separated terms such as site-specific scope names.
- WAVI merges the selected built-in terms and custom terms, then passes them to gallery-dl's `include` option.

Extractor support varies by site. A keyword that is meaningful for one extractor may be ignored or unsupported by another.

**Archive modes**

- **Use case gallery-dl archive** records completed items in `manifests\gallery-dl-archive.sqlite3` and skips matching items on later case runs.
- **Ignore archive for this run** performs the run without archive-based skipping or recording for that run.
- **Force re-capture** passes gallery-dl's no-skip behaviour so matching files can be collected again deliberately.


**Pacing presets**

| Preset | Between submitted URLs / item download sleep | Per-request sleep | HTTP 429 sleep |
|---|---:|---:|---:|
| **Fast** | none added | none added | 60 seconds |
| **Normal** | 10 to 20 seconds | 5 to 10 seconds | 120 seconds |
| **Cautious** | 25 to 45 seconds | 15 to 30 seconds | 300 seconds |

Submitted Gallery/Profile URLs run sequentially. The preset sets the gap between submitted URLs as well as gallery-dl's own item/request pacing. **Only between URLs sharing a domain** restricts the URL gap; it does not remove within-gallery item/request sleeps or HTTP 429 cooldowns. It is off by default.

Use **Normal** for routine work. **Fast** is useful only when the source and policy permit rapid requests. **Cautious** is preferable for sensitive, unstable, or rate-limited sources.

**Retries, timeout, and concurrency**

- **Retries** controls gallery-dl retry attempts; the default is 4 and the accepted range is 1 to 100.
- **Timeout (s)** controls the HTTP timeout; the default is 30 seconds and the accepted range is 10 to 900 seconds.
- **Settings > Concurrent Captures...** controls separate active Gallery/Profile jobs, up to 8 when enabled. It does not parallelise URLs or items within one job.

Raising retries and concurrency can prolong a failing job or increase rate limiting. A larger timeout can help slow servers but also makes unreachable URLs take longer to fail.

**Templates and output organization**

The default template is:

```text
%datetime%_%domain%_%id%_%filename%.%ext%
```

Use the preview below the template to confirm the expected relative path before capture. Keep identifiers in the template where possible so similarly named profile or collection items do not overwrite one another. gallery-dl metadata keys vary by extractor, so WAVI's generic Gallery/Profile tags use ordered fallback fields instead of assuming one site-specific key. For example, `%id%` prefers `id` but can fall back through fields such as `media_id`, `post_id`, `shortcode`, and other common item identifiers; `%author%` can fall back to username/creator-style metadata; and `%url%` prefers post/source URLs before falling back to the current file URL. This keeps common templates useful on sources such as Instagram Reels where gallery-dl exposes `media_id`, `username`, and `post_url` instead of generic `id`, `author`, and `url` fields. `%filename%` also falls back through common file/item identifiers when an extractor has no literal `filename` value. Keep `%id%` and/or `%filename%` in multi-item templates; descriptive fields such as title or author are not guaranteed to be unique.

`%item_datetime%` exposes the source item's gallery-dl date or datetime metadata using common date-field fallbacks. For a mixed-domain job, `%domain%` resolves to `multiple-domains`. See [Template Tags](#template-tags) for current supported tags.

Typical output:

```text
<case>\
  media\
    <category or template folders>\
      <media and selected sidecars>
  derived\
    evidence\
      <matching media subfolders>\
        <name>[_<source extension>]_evidence_<run timestamp>.png     (default lossless PNG)
        <name>_evidence_<run timestamp>.<source extension>           (when matching source format)
        <matching derivative stem>.evidence.json
  logs\
    gallery-dl-run_<timestamp>.log
    gallery-dl-unsupported_<timestamp>.txt   (when applicable)
  manifests\
    gallery-dl-archive.sqlite3               (case archive mode)
    gallery-dl-sha256-manifest_<timestamp>.csv
```

The evidence derivative and its provenance JSON are separate case artifacts and are independently included in the manifest. See [Case Manifest Verification](#case-manifest-verification) for common manifest behaviour and [Job Queue, Persistence, and Recovery](#job-queue-persistence-and-recovery) for Gallery/Profile continuation behaviour.

### Webpage Capture

Webpage Capture uses `script-webcapture.ps1`, `script-webcapture.ts`, `deno.exe`, and a selected installed Chromium-family browser. Deno controls the browser through Chromium's DevTools interface. Primary webpage artifacts are written beneath `<Output Root>\<Case Name>\media\web` using the selected filename template.

**Capture mode**

| Mode | What it does | Typical use |
|---|---|---|
| **Full page only** | Captures the rendered document from top to bottom after the selected readiness and scrolling steps. Very tall pages may be saved as numbered segments. | Recommended general-purpose webpage capture. |
| **Initial viewport only** | Captures only the first visible browser viewport without full-page scrolling. | Preserving the initial presentation or avoiding interaction with long/dynamic pages. |
| **Full page + initial viewport** | Saves both the initial viewport and the full-page result. | Cases where both the first-screen context and the complete rendered page are useful. |

**Image format and execution**

**PNG** is lossless and is the recommended default. **JPEG** and **WebP** can reduce file size when lossy output is acceptable; their **Quality** setting does not apply to PNG. **Captured PNG (visual match)** PDF output requires PNG.

**Capture Options > Pacing & Readiness** groups URL pacing, retries and readiness checks. **Capture retries** allows 0, 1 or 2 retries (default 1) after a visual-capture failure; it does not retry every navigation/network failure.

**Pacing Preset** provides Fast (no added delay), Normal (10–20 seconds, default) and Cautious (25–45 seconds) between attempted submitted URLs. **Only between URLs sharing a domain** is off by default and uses Job Queue's domain grouping. The first URL and archive-skipped URLs add no pacing wait. This setting does not throttle individual browser resource requests or item-navigation interactions.

**Settings > Concurrent Captures...** controls separate Webpage jobs. Concurrent URLs within a single job are not supported.

**Readiness and page conditions**

The defaults are 45 seconds for maximum navigation, 15 seconds for maximum settling, and 15 seconds for the shared condition timeout. These are readiness limits, not individual HTTP-request timeouts.

Webpage Capture separates navigation from the point at which the page is considered ready to preserve. This is useful for sites that finish their initial load before important content appears.

- **Readiness event** can wait for **DOM content loaded** or **Full page load**. DOM content loaded is earlier; full page load waits for the browser's normal load event.
- **Maximum navigation** limits how long WAVI waits for the selected navigation event.
- **Network quiet** defines how long ordinary network activity must remain quiet before that stage is considered settled. Long-lived WebSocket, EventSource, and Ping traffic is ignored for readiness so a persistent background channel does not block capture by itself.
- **Maximum settling** limits the network-settling stage. Set it to `0` to skip that stage.
- After the event/network/condition checks and any **Additional wait**, WAVI automatically performs a bounded **visual-stability** check. It waits for the rendered DOM/layout to remain quiet and for currently discovered images and document fonts to finish loading. This check is also repeated after lazy scrolling before a full-page image is measured and captured.
- **Additional wait** adds a fixed delay before that final visual-stability check, giving delayed scripts/content an opportunity to appear before WAVI decides the rendered page has settled.
- **Wait for CSS selector** can require a specific element to **Exist** or be **Visible** before capture.
- **Wait for text** performs literal, case-sensitive matching against either visible page text or the complete DOM text.
- The selector and text checks share **Shared timeout**. It is disabled when neither check is enabled. **Network quiet** is disabled when Maximum settling is zero. Disabled fields retain their values.

When a readiness check times out, including the bounded visual-stability check, WAVI can **Capture with warning**, **Stop loading and capture**, or **Fail URL**. The default remains Capture with warning so continuously changing clocks, advertisements, feeds, or other dynamic elements cannot trap a capture indefinitely. Invalid selectors and navigation failures still fail. Use explicit selector/text conditions only when the source has a stable condition that meaningfully indicates capture readiness; brittle conditions can make otherwise usable pages fail unnecessarily.

**Scrolling, page growth, and long pages**

- **Scroll through the page before full-page capture** helps trigger lazy-loaded images and content. **Wait**, **Maximum**, and **Stable checks** control the pace and stopping conditions. Stable checks require the page to be at the bottom with unchanged height, no new DOM mutations during the check, no pending discovered images, and document fonts ready.
- **Detect continued document-height growth** identifies pages that keep expanding during scrolling. **Maximum cycles** bounds the work, and **At growth limit** can save a partial result, save with a warning, or fail the URL.
- **Re-measure before capture** checks the final page dimensions again immediately before the image is produced.
- **Single-image height** and **Single-image MP** place safety limits on one image. Single-image height is hard-limited to **16,382 px** for Chromium renderer reliability; taller pages are segmented. **Segment height** is also capped at **16,382 px** and cannot exceed the configured Single-image height. Pages beyond the active limits can be written as numbered segments using the configured **Segment height**, **Overlap**, and **Maximum segments**.

Long-page segmentation is a safety mechanism, not an error by itself. Review the `.webcapture.json` record to determine whether a result was complete, complete with warnings, partial, or failed and whether segmentation or continued growth affected the capture.

**Visual stabilization**

Optional visual controls can make highly animated or sticky pages easier to preserve:

- **Disable animations** and **Disable transitions** reduce motion during image capture.
- **Hide scrollbars** removes visible scrollbars from the captured image.
- **Fixed/sticky** can **Preserve** the site layout, **Neutralize** qualifying fixed/sticky positioning, or **Hide likely navigation** overlays.

These settings change the rendered presentation and are recorded in the webpage capture record. Leave them at their defaults when an unmodified rendered view is more important than reducing repeated or obstructive page elements. Live Page PDF has its own separate layout control.

**Environment and page state**

Environment presets provide repeatable browser-emulation settings without claiming to reproduce an exact physical device. Built-in desktop, tablet, and mobile presets configure the viewport, device scale factor, mobile layout, touch emulation, and orientation; **Custom** allows those values to be set individually.

Additional browser preferences include:

- **Locale** and **Timezone**, which can affect localized or time-sensitive page content.
- **Appearance** (`default`, light, or dark) and **Reduced motion**, which expose corresponding browser preferences to supporting sites.
- **Disable browser cache**, **Bypass service workers**, and **Reload once without cache** for captures where cached or service-worker-controlled content is undesirable.
- **Site storage** handling to keep storage, clear only the requested origin, or clear visited origins before capture.

These controls affect the isolated capture environment only. They do not modify the user's normal browser profile.

**Cookies and browser isolation**

Each Webpage Capture run uses a temporary app-owned browser profile rather than the user's everyday browser profile. WAVI does not read normal browser history, stored passwords, local storage, IndexedDB, or browser databases from that profile.

When an approved cookies file is enabled:

- **Requested site only** imports cookies applicable to the submitted hostname and is the safer default.
- **Entire cookies file** imports every valid row for redirect or SSO compatibility, which can expose authenticated cookies to additional matching domains contacted during the capture.
- **Clear browser cookies before each URL** prevents one submitted URL from carrying browser cookies into the next before the selected file is re-imported.

Normal browser security remains enabled and certificate errors are not bypassed.
**Cookie banners**

Under **Capture Options > Interactivity**, cookie handling occurs after page load and before capture. The default is **Leave unchanged**, which also disables **Fallback**. Other actions are Accept cookies, Reject optional cookies, and Dismiss / acknowledge. Fallback is off by default; when enabled it tries the remaining actions in Accept/Reject/Dismiss order if the selected action fails. Review the logged outcome rather than assuming every banner can be recognised.

**Item Navigation and Capture**

This optional feature captures the entire visible viewport for each opened item, without cropping to an overlay. Choose whether each item opens an overlay, opens a different page, or is unsure/automatically classified. Choose browsing through items or opening and dismissing them, plus the available navigation/end-of-items behaviour.

- **Maximum items** is optional; when disabled, WAVI continues through available browsable/selectable items until traversal ends or a safety/error condition stops it.
- **Scan step**, **Open timeout**, **Content wait**, **Close timeout**, and navigation timeout govern discovery and interaction.
- **Item Navigation Output Naming** supports Webpage tags plus `%overlayindex%` and `%contentid%`. The existing `%overlayindex%` tag remains the item sequence identifier despite the feature's new display name.
- Item captures preserve context, captions and surrounding controls as visible in the viewport. Content outside that viewport is not included in the item screenshot.

Discovery is rule-based. `interactive-whitelist.txt` identifies likely targets and `interactive-blacklist.txt` rejects known unsafe or irrelevant terms. Their documented `category|term` format can be extended for future captures. Obscured or ambiguous targets may be skipped; review the interaction report for warnings and incomplete traversal. A timeout alone does not prove that the last item was reached.

See [Warnings > Item Navigation and Capture](#item-navigation-and-capture).


**Evidence outputs**

The primary Webpage evidence remains the captured image/PDF, `.webcapture.json` record, run log, and SHA-256 manifest. Optional outputs can add context or troubleshooting detail:

| Evidence group | Available outputs | Notes |
|---|---|---|
| **Page snapshots** | MHTML snapshot, final response HTML, rendered DOM HTML | Useful for preserving browser-available page structure in addition to the visual capture. |
| **Network evidence** | Sanitized network report, failed-request report | Query values are redacted by default. Including full query strings can expose tokens or identifiers. |
| **Diagnostics** | Console warnings/errors, failure screenshot and metadata | Failure evidence is attempted after the final failed capture and does not make the URL complete. |
| **Security metadata** | TLS/browser-security report | Records browser-available security details without bypassing certificate validation. |

Response bodies, sensitive request headers, and request bodies are not recorded by the network evidence options. Enable only the supplemental outputs that are useful for the case; more evidence files also mean more material to review and retain.

**PDF options**

PDF creation is optional and is configured separately from the primary image capture.

| PDF source | What it does | Tradeoff |
|---|---|---|
| **Live Page (searchable)** | Prints the rendered webpage directly through Chromium. Text can remain searchable/selectable where the page permits it. | Site print CSS, fixed/sticky elements, and very long pages can affect pagination or output size. |
| **Captured PNG (visual match)** | Builds an image-only PDF from the captured PNG, filling successive pages at the selected page ratio. The final page may have unused space. | Better visual correspondence with the screenshot, but text is not searchable and PNG output is required. |

For **Captured PNG**, **Captured PNG Page Ratio** offers Letter, Legal, A4, Custom and Maximum. Portrait/Landscape applies to Letter, Legal and A4; only Custom enables manual ratio entry. Preset ratios recalculate when margins change. These presets define proportions rather than forcing standard physical paper dimensions: image scale is retained subject to the PDF size limit. WAVI fills each page's available height after margins and actual header/footer bands, then continues with the next image section. Empty footer/header templates create no band or automatic band space; explicitly configured page margins still apply.

For **Live Page**, common PDF controls include landscape orientation, headers/footers, scale, paper size, margins, site backgrounds, and CSS page sizing. **Pages** accepts ranges such as `1-5` or `1,3,5-8`; a manual page range takes precedence over the automatic large-PDF policy.

For **Live Page** PDFs, **Live Page Layout** can keep the site's print layout, remove qualifying fixed/sticky positioning, or hide likely top navigation. This is separate from the image-capture **Fixed/sticky** setting and does not alter the saved PNG.

Large Live Page PDFs can use:

- **Automatic**, which estimates page count and splits when the configured threshold is reached.
- **Single PDF**, which attempts one PDF subject to the configured safety limits.
- **Split into parts**, which writes numbered PDF parts using the selected pages-per-part value.
- **Fail above safety limit**, which stops rather than generating an oversized PDF.

**Maximum total pages** and **Maximum parts** bound large-PDF work. When a split capture reaches a safety cap after producing valid parts, completed parts are retained and the result can be classified as partial. Explicit page ranges are handled separately from this automatic splitting policy.

PDF header/footer editors support simple `<Left>` and `<Right>` alignment tags, with centre alignment for untagged text. Enable HTML mode for HTML templates. Colour, height and font-size controls apply to the bands; use `RRGGBB` colour values (lowercase is also accepted). Band spacing derives from height/font size with a minimum 2px difference. An empty editor means no band, in either mode.

**Insert Tag** offers `%url%`, `%requested_url%`, `%final_url%`, `%domain%`, `%title%`, `%date%`, `%time%`, `%datetime%`, `%utcdatetime%`, `%case%`, `%engine%`, `%version%`, `%page_number%`, and `%page_count%`. `%url%` uses the final URL when available, otherwise the requested URL. Use these WAVI tags for consistent original-capture metadata across Live Page and Captured PNG output.

For **Captured PNG** PDFs, enable **Header on first page and footer on last page only** in **PDF Options > Header & Footer** to limit the header and footer to the document ends. Single-page PDFs show both. This setting is off by default, is saved with profiles and queued jobs, and is unavailable for Live Page PDFs.

**Filename templates and output records**

The default Webpage filename template is:

```text
%datetime%_%domain%_%title%
```

Webpage-specific filename tags include `%index%`, `%urlindex%`, `%profile%`, and `%mode%`. Webpage output does not expose `%ext%`/`%extension%` because one base template can produce different output formats and extensions, and a general webpage may not expose a stable `%id%`. Capture-time tags resolve from the start of the individual URL capture. See [Template Tags](#template-tags) for the supported common tags, and use the template preview before a large run.

Typical output:

```text
<case>\
  media\
    web\
      <captured images, optional PDFs, .webcapture.json records, and enabled evidence files>
  logs\
    web-capture_<timestamp>.log
  manifests\
    sha256-manifest-web_<timestamp>.csv
```

The `.webcapture.json` record documents the requested and final URLs, page title, browser and capture settings, readiness/scrolling outcomes, generated artifacts, hashes, warnings, and final completeness classification. Readiness telemetry includes network-settling results, ignored long-lived background request types, DOM/layout visual-stability results, pending/failed image counts, font readiness, and lazy-scroll mutation/media statistics. See [Case Manifest Verification](#case-manifest-verification), [Domain Presets, Proxy, VPN, and Archives](#domain-presets-proxy-vpn-and-archives), and [Job Queue, Persistence, and Recovery](#job-queue-persistence-and-recovery) for the common manifest, universal-archive, and continuation rules. Site design, authentication challenges, anti-automation controls, browser or endpoint policy, infinite/virtualized content, and Chromium's own image/PDF limits can still prevent a complete capture.

### Browser Integration

**WAVI Capture Helper** is an optional convenience feature for sending the page currently open in Firefox to WAVI without copying and pasting the URL. It does not perform the capture itself. Every browser submission becomes an ordinary **Pending** WAVI Job Queue entry, so the user can review it before starting the capture.

Configure the connection from **Tools > Browser Integration...**. The browser-integration API is disabled by default. When enabled, WAVI listens only on the local computer (`127.0.0.1`), not on the local network or the public Internet. WAVI and the Firefox extension must use the same listener port. If WAVI cannot use a newly selected port, it keeps the previous working listener instead of silently leaving browser integration unavailable.

**Pairing and access control**

WAVI creates a random pairing token that acts as the local authorization secret between Firefox and WAVI. When a token is saved in the extension, WAVI verifies it first, and every later browser submission must authenticate again. If a saved token should no longer be trusted, use **Regenerate Token** in WAVI and pair the extension again; the previous token stops working immediately.

Treat the pairing token like a password for the local browser-integration interface. Do not post it in screenshots, case notes, tickets, or shared documentation.

**What the extension can send**

The extension sends only:

- the full URL of the active Firefox tab
- the capture engine selected by the user: **Audio / Video**, **Gallery / Profile**, or **Webpage Capture**

It does not send Firefox cookies, page contents, saved passwords, browsing history, or arbitrary capture settings. The extension does not have permission to read Firefox cookies. A URL can still contain sensitive information in its path, query parameters, or fragment, so review unusually sensitive URLs before submitting them.

Firefox stores the listener port and pairing token in the extension's local storage. The extension also keeps limited status information, such as the latest result and WAVI Job ID, so it can show whether a submission succeeded. It does not keep a browser-side history of submitted URLs. The resulting Pending job is stored by WAVI in the same way as other Job Queue entries.

**Local-only connection**

Firefox displays permission for the extension to communicate with `127.0.0.1`, which means the local computer. WAVI Capture Helper uses that permission only for the listener port configured in the extension and WAVI. It does not send browser submissions to the WAVI developer, Mozilla, analytics services, or another remote service. See [PRIVACY.md](PRIVACY.md) for the project privacy policy.

Private Browsing is intentionally disabled for WAVI Capture Helper because browser-submitted URLs become normal WAVI Job Queue records.

**If browser integration does not work**

- Confirm WAVI is open and **Browser integration API** is enabled.
- Confirm WAVI reports that it is listening and that the same port is set in **WAVI Capture Helper > Manage**.
- If the extension reports that the token was rejected, copy the current token from WAVI and save it again in the extension.
- If the WAVI taskbar button flashes, switch to WAVI and respond to the displayed prompt. The browser request can continue while the extension popup is closed.
- If Firefox will not install the extension, use the Mozilla-signed `.xpi` from an official WAVI release.


### Job Queue, Persistence, and Recovery

Direct, Queue and Extension submissions share one execution system and the same domain, concurrency, archive and case-folder checks.

| State | Meaning |
|---|---|
| Pending | Staged; requires a command to run. |
| Queued | Authorised to run when its blockers clear. |
| Running | Execution is active. |
| Completed | Execution succeeded; warnings may still be present. |
| Failed | Execution failed. |
| Interrupted | An execution was stopped or interrupted. |
| Cancelled | A start/queue decision was cancelled; execution history determines whether Start or Resume applies. |
| Stopped | Work was stopped before execution and is no longer waiting to run automatically. |

The toolbar has two rows:

- **Start / Resume / Stop / Clear Completed**
- **Start All / Resume All / Stop All / Clear Non-active**

Start, Resume and Stop target the selected row plus checked rows. With neither selected nor checked, they do nothing. Start applies to never-executed Pending, Stopped or Cancelled jobs; Resume applies to eligible previously executed Failed, Interrupted or Cancelled jobs. **Resume All** requests all resumable jobs. **Clear Non-active** removes non-active rows without deleting evidence.

**Stop All** interrupts active jobs and withdraws pending/queued work. It does not disable future submissions. **Restart** begins the submitted URL list again while still respecting download-history/archive skips, and warns for an existing case folder. Active jobs must stop before restart or removal.

Right-click actions apply to the clicked job and include available start/resume/restart/stop actions, **Force Start**, queue-order movement and case actions. **Copy Case Summary** is available when summary information exists. Double-click opens an existing case folder; otherwise it toggles the row's checkbox. Column sorting changes the display order. Moving a job up/down changes queue order; its physical position follows that order only when the table is sorted by the order column.

**Settings > Concurrent Captures...** provides live per-engine limits of 1–8. Concurrency is disabled by default. Lowering a limit below the active count warns without interrupting active jobs. The new limit controls subsequent starts. These are job limits, not parallel-URL settings.

- Domain collisions apply across engines, using the current domain grouping, including subdomains.
- No two engines may write concurrently to the same case folder.
- Shared universal-archive use imposes same-engine serial execution.
- **Force Start** can bypass the configured engine slot limit, but never the hard eight-job limit, domain collisions, case-folder locks, archive restrictions or pacing waits.
- A hard-block dialog offers **Queue after active** or **Cancel**. Queuing waits for active same-engine jobs and applicable domain collisions. Force Start during cooldown explains the wait and does not promote the job.

**Settings > Queue Pacing...** adds an optional cooldown after a job finishes. It is disabled by default. Presets are None (0–5s), Fast (15–30s), Normal (30–60s, default), and Cautious (60–120s). With **Only between jobs sharing a domain** off, it applies within the same engine or across engines with matching domains. With it on, it applies only to matching domains across engines. It is separate from the capture tabs' within-job URL pacing.

**Job Persistence** saves queue state to `gui-jobs.json`. Reopening does not automatically start saved work: Running jobs become Interrupted and Queued jobs become Pending. Turning persistence off removes `gui-jobs.json`, while keeping current jobs in memory. Re-enabling saves current state.

Recovery differs by engine:

- **Audio/Video:** resubmits unresolved original URL indexes.
- **Gallery/Profile:** resubmits original URLs and uses the selected archive policy to skip completed items.
- **Webpage:** resubmits unresolved original URL indexes; review the per-URL completeness classifications. Partial results are terminal for recovery, while Failed results remain retryable. Universal archive skips include Complete/Complete with warnings, not Partial.

Case-level `manifests/gui-job-recovery-<job-id>.json` records explain attempted recovery. They are separate from queue persistence and are not deleted when persistence is switched off.

### Queue Building and Case Folder Safety

The **Start Capture ▼** menus can stage work without immediately running it. All three engines support **Add Job to Queue** and the following options:

- **Split and Add Jobs to Queue** — splits the current URL list by either URLs per group or requested number of groups. URL order is preserved and each generated job receives a `-partXX` suffix on the resolved case name.
- **Add Jobs to Queue by Domain** — creates separate jobs for each source domain. When the case template does not already contain a dynamic domain/preset tag, WAVI appends the domain to the resolved case name.
- **Add Failed to Queue** — creates a new job from failed URL history that matches the current Output Root/current URL context.

**Start Capture** requests immediate execution through the unified queue and becomes Running or Queued according to admission rules. Queue-only actions create Pending jobs, do not switch tabs, and do not enable the capture Stop button by themselves.

Before a capture or queue job starts, WAVI warns when the resolved case folder already exists and contains files or folders. Continuing can add files to that existing case and reuse its case archive/history. Review the resolved case path before proceeding when case separation matters.

**Capture > Delete Current Case Folder** permanently deletes the resolved current case folder and everything inside it after confirmation. This is a destructive convenience command, not an archive/reset operation; use it only when the displayed case path is definitely the folder intended for removal.

### Case Browser

List and tile views show the containing **Relative Folder** separately from the filename. Hover overlays also omit the filename from the folder location. Media hover overlays use the same metadata as cards, including image resolution and codec. Duration appears only when applicable and available. Files directly in the selected folder show **(current folder)**.

Case Browser automatically follows the current Output Root and provides a local review view over captured case folders. Its controls are display/review aids and do not alter captured files unless a separate destructive action is explicitly chosen elsewhere.

- **Filter** limits the displayed files by media/type category; **Sort** can order by name, domain, type, size, newest, or oldest.
- **Current folder only** prevents recursive display of files below the selected folder.
- **Search** filters the visible file set by the current search text.
- **Icon scale** changes card/thumbnail sizing without changing the source files.
- **View: Auto** chooses a suitable presentation for the number of matching files. **Cards** provides visual file cards; **Compact** uses a lighter list. For very large folders, Auto can switch to compact mode or a large-folder summary rather than generating thousands of cards at once. Card view initially limits the number of rendered cards and can load more on request.

Media thumbnails/details are generated lazily and may depend on FFmpeg/FFprobe. Compact-list hover previews also load on demand. Hidden `.gui-cache` content is used for GUI display/cache work and is not shown as case evidence.

Double-clicking a file opens it. The file context menu can open the containing folder, open related metadata JSON or source-link files when present, and copy the full path, file name, or path relative to the selected case folder. Manifest verification is described separately below.

### Case Manifest Verification

Case Browser recognizes Audio/Video, Gallery/Profile, and Webpage SHA-256 manifest CSVs. **Verify Case Files** combines all recognized manifests in the selected case. When more than one manifest records the same case file, the newest applicable record supplies the expected current hash.

Manifest paths are relative to the case folder, allowing the complete case folder to be moved without changing those paths.

Verification excludes `.gui-cache` and the `manifests` control folder, which contain display cache and capture-control data outside the evidence-manifest scope. Files elsewhere in the case that are not represented by any recognized manifest are reported as new/untracked. Hash verification confirms byte-level agreement with the recorded SHA-256 values; it does not determine authenticity, context, or evidentiary sufficiency.

### Domain Presets, Proxy, VPN, and Archives

**Domain Presets** are engine-specific and can automatically apply selected Audio/Video, Gallery/Profile or Webpage settings when submitted URLs match configured domains. Presets can be enabled or disabled independently and can contain one or more match domains. When more than one enabled preset matches the same URL set, presets are merged in priority order; a higher numeric priority is applied later and therefore wins when two presets store different values for the same setting. **Priority Up/Down** and normalization controls manage that ordering.

The save dialog selects the capture tab whose URLs supply suggested domains and whose settings are saved. The manager can filter presets by capture tab. A preset never carries settings from other engines. The Domain Presets window can create presets from the current settings, edit match domains and stored settings, enable/disable presets, and import or export preset definitions. Import conflicts can be skipped or renamed instead of silently overwriting an existing preset. Applied preset names are recorded with queued-job details where applicable.

**Proxy Options** are app-level and support `http`, `https`, `socks4`, and `socks5`. Audio/Video and Gallery/Profile can pass configured proxy credentials to their capture tools; Webpage Capture supports only proxies that do not require credentials. Proxy usernames/passwords are sensitive: when proxy settings are saved, they are stored unencrypted in `gui-settings.json`, and credentials may also be visible to local administrators or process-inspection tools while a capture runs. Enable **Do not save proxy options to settings file; keep them only until the app closes** when the proxy should remain session-only.

**Check VPN** is disabled by default. When enabled, WAVI shows the shared VPN panel on capture tabs. **Refresh Adapters** enumerates local network adapters; select the adapter that represents the VPN, then **Check VPN** tests whether that adapter is present and Up. Before capture, an unsuccessful check produces a warning and lets the user decide whether to continue. This is an adapter-state safeguard, not proof that all capture traffic is routed through the VPN.

**Universal Download Archive** provides cross-case duplicate avoidance with separate app-level files:

- `universal-download-archive.txt` for Audio/Video Capture. Jobs using this shared archive run serially; an archive skip records prior completion but does not mean the current case contains a fresh copy.
- `universal-gallerydl-archive.sqlite3` for Gallery/Profile Capture. Metadata/artifacts-only entries are tracked separately from media-download entries, so metadata-only work does not mark media as already downloaded.
- `universal-webcapture-archive.sqlite3` for Webpage Capture. It records **Complete** and **Complete with warnings** requested/final URLs plus capture history; **Partial** results are excluded so they cannot suppress a later cross-case capture. Matching archived URLs are skipped before navigation and case-level JSON/CSV skip reports are written under `manifests`.

Universal archives are app-level duplicate-avoidance records, not evidence artifacts for a specific case. Disable the applicable universal archive when a deliberate fresh cross-case capture is required. **Settings > Delete Universal Archive Files...** removes the existing app-level universal archive files after confirmation and can therefore allow previously captured items to be captured again; it does not delete case-specific archives.

### Update Checks

**Help > Check for App Updates** queries the latest official WAVI GitHub release on demand. **Download Latest Release** downloads GitHub's **Source code (zip)** archive for the latest release tag, validates the archive structure and release version, and extracts the complete repository snapshot to the `gui-update` folder beside the app. GitHub's generated outer archive folder is removed so the repository contents are staged directly under `gui-update`. **Open Update Folder** opens the staged source tree so it can be reviewed. Close WAVI before manually copying the staged files over the current installation. WAVI does not automatically replace or run the staged application files.

The app also has user-triggered update helpers for staged local tools:

- **Check/Update yt-dlp** can update to the latest stable build, latest nightly, or a specifically selected nightly release from the queried list. Very recent nightlies can be blocked by ASR/endpoint protection because they are low-prevalence executables.
- **Check/Update gallery-dl** can update to latest stable, latest development, or a specifically selected stable release from the queried list.
- **Tools > Deno Path** selects the shared `deno.exe` used by A/V and Webpage captures; the default is in the WAVI folder. **Check Deno Version** shows the version or an error if unavailable.
- **Tools > Update Deno** runs the detected local `deno.exe upgrade`. The newest Deno may not always be the desired version for a controlled environment.
- **Tools > Clear yt-dlp Cache** clears the extractor cache; **Tools > Clear Deno Cache** clears the Deno runtime cache. Wait for relevant captures, previews, and other tool operations to finish before clearing. WAVI uses `.ytdlp-cache` and `.deno-cache` in the application folder for these caches; folders are created when needed and are not automatically cleared when WAVI closes. These actions do not clear browser cookies, capture archives, or captured media. Existing user-profile caches are left untouched.

The app does not auto-update tools on launch. Review and approve update targets according to the environment before replacing staged binaries.

## Profiles and Settings

WAVI stores its normal portable settings beside the app in `gui-settings.json`. Capture-tab values are stored in profiles, while app-level settings include items such as the active profile, dark mode, persistence toggles, Case Browser preferences, browser-integration settings, proxy settings, and window state. Changes normally autosave to the active profile/default portable settings file.

**Profiles**

- **Default** is the initial profile and cannot be deleted. Switching profiles saves pending edits to the profile being left before loading the selected profile.
- **Profile > Save Current Settings to Profile...** creates a named profile from the current capture settings or deliberately overwrites an existing profile after confirmation.
- **Delete Selected Profile...** removes the selected custom profile from the current settings file, switches back to Default, and does not delete cases, cookies, media, or logs.
- **Settings > Save Settings As...** writes the complete current settings store, including profiles/app settings/domain presets, to a selected JSON file. It is an exported settings copy; normal autosave continues to use the portable `gui-settings.json` beside WAVI. **Load Settings...** loads a selected settings JSON into the current session; the file must use a supported format. Subsequent normal autosaves again use the portable `gui-settings.json`.
- **Save Default Portable Settings** explicitly writes the current settings store to the normal `gui-settings.json` beside WAVI.

**App-level settings**

- **Delete Cookies on Exit** deletes the selected cookies files for capture tabs that currently have cookie use enabled when WAVI closes. It does not delete unrelated cookie files.
- **Check VPN** enables the shared VPN adapter safeguard described under [Domain Presets, Proxy, VPN, and Archives](#domain-presets-proxy-vpn-and-archives).
- **Dark Mode** changes WAVI's GUI theme and is persisted as an app preference.
- **Job Persistence** saves the unified job list to `gui-jobs.json`. Disabling it removes that file but retains the current job list in memory and preserves case recovery records.
- **URL Box Persistence** writes the three capture URL boxes to `gui-box-av.txt`, `gui-box-gp.txt`, and `gui-box-web.txt` and restores them on later launches. It is disabled by default. Turning it off removes all three files without clearing the current URL boxes.
- **Universal Download Archive** enables the app-level cross-case archives; **Delete Universal Archive Files...** removes those app-level files after confirmation.
- **Clear URL History...** removes only WAVI's captured/failed GUI URL-history files under the currently configured Output Roots. It does not delete captured media or download/universal archives.

**Reset and deletion commands**

- **Reset Defaults** resets the current GUI/app settings and overwrites only the **Default** profile with defaults. Custom profiles are preserved.
- **Delete Settings File...** deletes `gui-settings.json`, removes all profiles stored in that file, and resets the current GUI/app settings to defaults. It does not delete case folders or captured evidence.
- `python gui.py --fresh` performs a broader app-state cleanup: app settings/state files, Job Queue persistence, URL-box persistence, app-owned temp files, the app debug log, universal archives, and GUI cache folders under known Output Roots are cleared. It does not delete captured case folders, media files, cookies, binaries, scripts, case logs, manifests, or case-specific capture archives.

Common state files:

- `gui-settings.json` for settings, profiles, app settings, and domain presets
- `gui-jobs.json` for persisted queue jobs when Job Persistence is enabled
- `gui-box-av.txt`, `gui-box-gp.txt`, and `gui-box-web.txt` when URL Box Persistence is enabled
- `universal-download-archive.txt`, `universal-gallerydl-archive.sqlite3`, and `universal-webcapture-archive.sqlite3` when universal archives are enabled
- case-level `manifests/gui-job-recovery-<job-id>.json` files for recovery details

## Cookies Handling

When **Use** is enabled for a capture tab, select an existing cookies file.

Cookies can help with approved authenticated captures or previews, but they are sensitive operational data. Cookie use does not guarantee access to restricted, private, expired, challenge-protected, or unsupported content.

The app can:

- use a selected cookies file for Audio/Video Capture, Gallery/Profile Capture, Webpage Capture, and Audio/Video Preview when enabled
- export Mozilla Firefox cookies through yt-dlp's supported `--cookies-from-browser` flow
- optionally encrypt or decrypt local cookies files
- delete selected Audio/Video, Gallery/Profile Capture, and/or Webpage Capture cookies files on exit when configured

The built-in exporter supports Mozilla Firefox only. Run WAVI as the same Windows user who is signed into Firefox, and close Firefox if profile locking prevents export. Cookies files produced by compatible browser extensions can still be selected manually.

Webpage Capture expects a standard Netscape `cookies.txt` file when cookie import is enabled. WAVI validates the file structure before capture and records summary counts/source filename in its Webpage capture diagnostics rather than retaining cookie names or values in those summaries/log messages.

The app does not collect credentials or automate website logins. Cookies do not include local storage, IndexedDB, service-worker state, device-bound tokens, or every modern partitioned-cookie attribute, so some authenticated sites may still fail. See [Webpage Capture > Cookies and browser isolation](#webpage-capture) for Webpage-specific cookie scope and temporary-browser behaviour.

## Limitations

- Source support depends on the installed `yt-dlp` and `gallery-dl` versions, the selected Chromium browser and version, browser policy, and the source platform.
- Preview metadata and thumbnails are best-effort and may be incomplete, stale, unavailable, or slow.
- Large playlists, large galleries, very tall/dynamic webpages, and large cases may take time to capture, scan, cache, export, or verify.
- Browser impersonation depends on the installed `yt-dlp` build and may be blocked by endpoint policy.
- Webpage Capture may be blocked when browser remote debugging, developer tools, Deno child-process launches, loopback automation, or writes to the selected Output Root are restricted by enterprise policy.
- Infinite feeds, virtualized lists, canvas/WebGL content, animations, autoplaying video, bot challenges, login/MFA flows, and pages that detect headless automation may be incomplete or unavailable. Environment presets are controlled browser emulation settings, not proof of an exact physical device or network location.
- Item Navigation and Capture may skip unsupported, ambiguous, virtualized, shadow-DOM, iframe, obscured, moving, or automation-resistant interfaces.
- Proxy/VPN behaviour depends on local routing, policy, and source-platform handling.
- Case Browser thumbnails and media details generally require FFmpeg/FFprobe.

## Changelog

See the [full changelog](CHANGELOG.md).
